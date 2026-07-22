#!/usr/bin/env node
// Scans recent Fuzz workflow runs and files deduplicated `auto-found` GitHub
// issues for failures (SKY-7774). Fuzz failures have no other routing path;
// CI failures are intentionally NOT scanned here — they are routed by
// GitHubManager and the daily GitHub sync sweep.
//
// Dedupe model: each failure maps to a deterministic fingerprint (the issue
// title). Runs sharing a fingerprint collapse into one issue; later matching
// runs are appended as comments instead of new issues. An in-process `seen`
// grouping makes this immune to GitHub's issue-list index lag, which is what
// produced the #1013–#1020 duplicate spray.
//
// All `gh` invocations use execFileSync with argument arrays — run metadata
// (branch names, job names) never passes through a shell.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = process.env.REPO;
if (!REPO || !/^[\w.-]+\/[\w.-]+$/.test(REPO)) {
  console.error('REPO env var (owner/name) is required');
  process.exit(1);
}
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

function failingJobNames(runId) {
  const data = ghJson(['api', `repos/${REPO}/actions/runs/${runId}/jobs?per_page=100`], { jobs: [] });
  return data.jobs
    .filter((j) => j.conclusion === 'failure')
    .map((j) => j.name)
    .sort();
}

// Deterministic fingerprint of a failure. Returned as the issue title so the
// title itself is the dedupe key across runs and across scanner invocations.
function fingerprint(run, jobs) {
  const date = run.created_at.split('T')[0];
  if (jobs.length === 0) {
    // Zero jobs means the workflow failed before any job started (typically an
    // invalid workflow file). That failure belongs to the workflow, not the
    // branch, so all such runs collapse into one fingerprint per day.
    return `[auto-found] Fuzz workflow failed before any job started on ${date}`;
  }
  const pr = run.pull_requests && run.pull_requests[0] ? `PR #${run.pull_requests[0].number}` : 'no PR';
  const title = `[auto-found] Fuzz failure ${date} · ${run.head_branch} (${pr}) · ${jobs.join(', ')}`;
  // GitHub caps titles at 256 chars.
  return title.length > 250 ? `${title.slice(0, 247)}…` : title;
}

function runLine(run) {
  return `- [Run ${run.id}](https://github.com/${REPO}/actions/runs/${run.id}) — \`${run.head_branch}\` — ${run.created_at}`;
}

function issueBody(group) {
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
    ...group.runs.map(runLine),
    '',
    '_Filed by issue-finder.yml. Deduped by fingerprint (the issue title); further matching runs are added as comments, not new issues._',
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

// 1. Collect failed fuzz runs.
console.log('🐛 Checking recent Fuzz runs...');
const runsData = ghJson(['api', `repos/${REPO}/actions/workflows/fuzz.yml/runs?per_page=20`], { workflow_runs: [] });
const failedRuns = runsData.workflow_runs.filter((r) => r.status === 'completed' && r.conclusion === 'failure');
console.log(`Found ${failedRuns.length} failed run(s) in the scan window`);

// 2. Group by fingerprint in-process, before any issue-list lookup, so GitHub
//    index lag can never cause duplicates within a run.
const groups = new Map();
for (const run of failedRuns) {
  const jobs = failingJobNames(run.id);
  const key = fingerprint(run, jobs);
  if (!groups.has(key)) groups.set(key, { jobs, runs: [] });
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
const existingByTitle = new Map(existing.map((i) => [i.title, i.number]));

// 4. One issue (or one comment on the existing issue) per fingerprint.
let created = 0;
let commented = 0;
for (const [title, group] of groups) {
  const existingNumber = existingByTitle.get(title);
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
    const comment = ['New matching failed run(s):', ...newRuns.map(runLine)].join('\n');
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
    withBodyFile(issueBody(group), (file) =>
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
