#!/usr/bin/env node
// Scans recent Fuzz workflow runs and files deduplicated `auto-found` GitHub
// issues for failures (SKY-7774). Fuzz failures have no other routing path;
// CI failures are intentionally NOT scanned here — they are routed by
// GitHubManager and the daily GitHub sync sweep.
//
// Dedupe model (SKY-8741): the issue TITLE stays human-readable and embeds the
// run date, but the raw title is no longer the dedupe key. A recurring
// failure fingerprints identically day to day except for that date, so using
// the title as the key made the same failure spray a new ticket every day it
// recurred. `dedupeKey()` strips dates out of the title to get a stable,
// structural key; that key — not the title — is what groups runs in-process
// and what existing open issues are matched against. An in-process `seen`
// grouping (keyed the same way) makes this immune to GitHub's issue-list
// index lag, which is what produced the #1013–#1020 duplicate spray.
//
// All `gh` invocations use execFileSync with argument arrays — run metadata
// (branch names, job names) never passes through a shell.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DRY_RUN = Boolean(process.env.DRY_RUN);
const LABELS = ['auto-found', 'needs-triage'];
// Spray guard: a single run never files more than this many new issues.
const MAX_NEW_ISSUES = 5;

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function ghJson(args, fallback) {
  try {
    return JSON.parse(gh(args));
  } catch (e) {
    console.log(`⚠️  gh ${args.slice(0, 2).join(' ')} failed: ${e.message.split('\n')[0]}`);
    return fallback;
  }
}

function failingJobNames(repo, runId) {
  const data = ghJson(['api', `repos/${repo}/actions/runs/${runId}/jobs?per_page=100`], { jobs: [] });
  return data.jobs
    .filter((j) => j.conclusion === 'failure')
    .map((j) => j.name)
    .sort();
}

// Human-readable issue title. Embeds the run date for context, but is NOT the
// dedupe key — see dedupeKey() below.
function fingerprint(run, jobs) {
  const date = run.created_at.split('T')[0];
  if (jobs.length === 0) {
    // Zero jobs means the workflow failed before any job started (typically an
    // invalid workflow file). That failure belongs to the workflow, not a
    // particular day, so all such runs share one fingerprint (see dedupeKey).
    return `[auto-found] Fuzz workflow failed before any job started on ${date}`;
  }
  const pr = run.pull_requests && run.pull_requests[0] ? `PR #${run.pull_requests[0].number}` : 'no PR';
  const title = `[auto-found] Fuzz failure ${date} · ${run.head_branch} (${pr}) · ${jobs.join(', ')}`;
  // GitHub caps titles at 256 chars.
  return title.length > 250 ? `${title.slice(0, 247)}…` : title;
}

// Stable dedupe key derived from a title: strips dates so the SAME recurring
// failure fingerprints identically regardless of which day it happened on
// (SKY-8741). Applied to both freshly-generated titles and existing GitHub
// issue titles so the two are comparable.
function dedupeKey(title) {
  return title.replace(/\d{4}-\d{2}-\d{2}/g, '<date>').replace(/\s+/g, ' ').trim();
}

function runLine(repo, run) {
  return `- [Run ${run.id}](https://github.com/${repo}/actions/runs/${run.id}) — \`${run.head_branch}\` — ${run.created_at}`;
}

function issueBody(repo, group) {
  const first = group.runs[0];
  const pr = first.pull_requests && first.pull_requests[0] ? `#${first.pull_requests[0].number}` : 'none';
  const jobs = group.jobs.length > 0
    ? group.jobs.join(', ')
    : 'none — the workflow failed before any job started (likely an invalid workflow file)';
  return [
    'Auto-discovered failing runs of `.github/workflows/fuzz.yml`.',
    '',
    `- Head branch: \`${first.head_branch}\``,
    `- Pull request: ${pr}`,
    `- Failing job(s): ${jobs}`,
    `- Date: ${first.created_at.split('T')[0]}`,
    '',
    'Matching runs:',
    ...group.runs.map((run) => runLine(repo, run)),
    '',
    '_Filed by issue-finder.yml. Deduped by a date-stripped fingerprint key (SKY-8741); further matching runs — including on later dates — are added as comments, not new issues._',
  ].join('\n');
}

function withBodyFile(body, fn) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'issue-finder-')), 'body.md');
  fs.writeFileSync(file, body);
  try {
    return fn(file);
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
}

function main() {
  const REPO = process.env.REPO;
  if (!REPO || !/^[\w.-]+\/[\w.-]+$/.test(REPO)) {
    console.error('REPO env var (owner/name) is required');
    process.exit(1);
  }

  // 1. Collect failed fuzz runs.
  console.log('🐛 Checking recent Fuzz runs...');
  const runsData = ghJson(['api', `repos/${REPO}/actions/workflows/fuzz.yml/runs?per_page=20`], { workflow_runs: [] });
  const failedRuns = runsData.workflow_runs.filter((r) => r.status === 'completed' && r.conclusion === 'failure');
  console.log(`Found ${failedRuns.length} failed run(s) in the scan window`);

  // 2. Group by dedupe key in-process, before any issue-list lookup, so GitHub
  //    index lag can never cause duplicates within a run, and so the SAME
  //    failure recurring across different dates in this scan window collapses
  //    into one group instead of one group per date (SKY-8741).
  const groups = new Map();
  for (const run of failedRuns) {
    const jobs = failingJobNames(REPO, run.id);
    const title = fingerprint(run, jobs);
    const key = dedupeKey(title);
    if (!groups.has(key)) groups.set(key, { title, jobs, runs: [] });
    groups.get(key).runs.push(run);
  }
  console.log(`Grouped into ${groups.size} distinct fingerprint(s)`);

  // 3. Fetch existing open auto-found issues ONCE (previous runs' issues are
  //    long-indexed; within-run dedupe never touches this list). This lookup is
  //    fatal on failure: treating "list failed" as "no existing issues" would
  //    recreate every open issue — the exact duplicate spray this script exists
  //    to prevent.
  let existing;
  try {
    existing = JSON.parse(
      gh(['issue', 'list', '-R', REPO, '-l', 'auto-found', '--state', 'open', '--json', 'number,title', '--limit', '200']),
    );
  } catch (e) {
    console.error(`❌ Could not list existing auto-found issues; aborting to avoid duplicates: ${e.message.split('\n')[0]}`);
    process.exit(1);
  }
  // Match on the same date-stripped key as fresh groups, not the raw title, so
  // an issue filed yesterday still matches today's recurrence of the same
  // failure (SKY-8741).
  const existingByKey = new Map(existing.map((i) => [dedupeKey(i.title), i.number]));

  // 4. One issue (or one comment on the existing issue) per dedupe key.
  let created = 0;
  let commented = 0;
  for (const [key, group] of groups) {
    const { title } = group;
    const existingNumber = existingByKey.get(key);
    if (existingNumber !== undefined) {
      const view = ghJson(
        ['issue', 'view', String(existingNumber), '-R', REPO, '--json', 'body,comments'],
        { body: '', comments: [] },
      );
      const knownText = [view.body, ...view.comments.map((c) => c.body)].join('\n');
      const newRuns = group.runs.filter((r) => !knownText.includes(String(r.id)));
      if (newRuns.length === 0) {
        console.log(`⏭️  Up to date: #${existingNumber} ${title}`);
        continue;
      }
      const comment = ['New matching failed run(s):', ...newRuns.map((run) => runLine(REPO, run))].join('\n');
      if (DRY_RUN) {
        console.log(`[dry-run] would comment on #${existingNumber} with ${newRuns.length} run(s): ${title}`);
      } else {
        withBodyFile(comment, (file) =>
          gh(['issue', 'comment', String(existingNumber), '-R', REPO, '--body-file', file]),
        );
        console.log(`💬 Commented on #${existingNumber}: ${title}`);
      }
      commented++;
      continue;
    }

    if (created >= MAX_NEW_ISSUES) {
      console.log(`🚫 Spray guard: MAX_NEW_ISSUES=${MAX_NEW_ISSUES} reached; NOT creating: ${title}`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`[dry-run] would create (${group.runs.length} run(s)): ${title}`);
    } else {
      withBodyFile(issueBody(REPO, group), (file) =>
        gh([
          'issue', 'create', '-R', REPO,
          '-t', title,
          '--body-file', file,
          ...LABELS.flatMap((l) => ['-l', l]),
        ]),
      );
      console.log(`✏️  Created: ${title}`);
    }
    created++;
  }

  console.log(`✅ Done: ${created} issue(s) created, ${commented} issue(s) commented${DRY_RUN ? ' (dry run)' : ''}`);
}

if (require.main === module) {
  main();
}

module.exports = { fingerprint, dedupeKey };
