#!/usr/bin/env node
/**
 * Owns the PR-diff secret scan; never prints a matched value.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

const MARKER = 'diff-guard: allow-fake';

const RULES = [
  { id: 'gh-token', source: String.raw`\bgh[opusr]_[A-Za-z0-9]{36}\b` },
  { id: 'github-pat', source: String.raw`github_pat_[A-Za-z0-9_]{80,}` },
  { id: 'sk-ant', source: String.raw`sk-ant-[A-Za-z0-9_-]{40,}` },
  { id: 'sk-or', source: String.raw`sk-or-v1-[a-f0-9]{64}` },
  { id: 'sk-proj', source: String.raw`sk-proj-[A-Za-z0-9_-]{40,}` },
  { id: 'live-key', source: String.raw`\b[sr]k_live_[A-Za-z0-9]{24,}` },
  { id: 'aws-akia', source: String.raw`\bAKIA[0-9A-Z]{16}\b` },
  { id: 'slack-token', source: String.raw`\bxox[abprs]-[A-Za-z0-9-]{10,}` },
  { id: 'private-key', source: String.raw`-----BEGIN ([A-Z]+ )?PRIVATE KEY-----` },
];

function contentHits(line) {
  const allowed = line.includes(MARKER);
  const hits = [];
  for (const rule of RULES) {
    if (new RegExp(rule.source).test(line)) hits.push({ id: rule.id, allowed });
  }
  return hits;
}

function scanUnifiedDiff(diffText) {
  const findings = [];
  let file = null;
  let newLine = 0;
  let inHunk = false;
  for (const line of String(diffText || '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = null;
      inHunk = false;
      continue;
    }
    // '--- ' / '+++ ' are file headers only before the first hunk. Inside a
    // hunk, '+++ …' is an added line whose text starts with '++ '.
    if (!inHunk && (line.startsWith('--- ') || line.startsWith('+++ '))) {
      if (line.startsWith('+++ ')) {
        const raw = line.slice(4).trim();
        file = raw === '/dev/null' ? null : raw.startsWith('b/') ? raw.slice(2) : raw;
      }
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      inHunk = true;
      newLine = Number(hunk[1]);
      continue;
    }
    if (file == null) continue;
    if (line.startsWith('+')) {
      const text = line.slice(1);
      for (const hit of contentHits(text)) {
        findings.push({ file, line: newLine, rule: hit.id, allowed: hit.allowed });
      }
      newLine += 1;
      continue;
    }
    if (line.startsWith('-') || line.startsWith('\\')) continue;
    if (line.startsWith(' ')) newLine += 1;
  }
  return findings;
}

function isDisallowedEnv(file) {
  const norm = String(file || '').replace(/\\/g, '/');
  const base = norm.slice(norm.lastIndexOf('/') + 1);
  if (base === '.env.example') return false;
  return /(^|\/)\.env(\..+)?$/.test(norm);
}

function scanNameStatus(text) {
  const findings = [];
  for (const raw of String(text || '').split('\n')) {
    if (!raw.trim()) continue;
    const parts = raw.split('\t');
    const status = parts[0] || '';
    let file = '';
    if (status.startsWith('R') || status.startsWith('C')) file = parts[2] || '';
    else if (status.startsWith('A')) file = parts[1] || '';
    if (file && isDisallowedEnv(file)) {
      findings.push({ file, line: 1, rule: 'env-file', allowed: false });
    }
  }
  return findings;
}

const MAX_GIT_BUFFER = 256 * 1024 * 1024;

function git(args, cwd) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: MAX_GIT_BUFFER,
  });
  if (result.error || result.status !== 0) return { ok: false };
  return { ok: true, stdout: result.stdout || '' };
}

function isHex(value) {
  return typeof value === 'string' && /^[0-9a-fA-F]+$/.test(value);
}

function isZeroSha(value) {
  return isHex(value) && /^0+$/.test(value);
}

function hasCommit(cwd, rev) {
  return git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], cwd).ok;
}

function resolveRange(eventName, event, cwd) {
  if (eventName === 'pull_request') {
    const pull = event && event.pull_request;
    const base = pull && pull.base && pull.base.sha;
    const head = pull && pull.head && pull.head.sha;
    if (!isHex(base) || !isHex(head)) return { fail: true };
    return { base, head };
  }
  if (eventName === 'push') {
    let before = event && event.before;
    if (!isHex(before) || isZeroSha(before) || !hasCommit(cwd, before)) {
      if (!hasCommit(cwd, 'HEAD~1')) return { empty: 'diff-guard: no base, nothing to scan' };
      before = 'HEAD~1';
    }
    return { base: before, head: 'HEAD' };
  }
  if (eventName === 'workflow_dispatch') {
    const merged = git(['merge-base', 'origin/main', 'HEAD'], cwd);
    if (!merged.ok) return { fail: true };
    const head = git(['rev-parse', 'HEAD'], cwd);
    if (!head.ok) return { fail: true };
    const base = merged.stdout.trim();
    if (base === head.stdout.trim()) return { empty: 'diff-guard: empty diff, nothing to scan' };
    return { base, head: 'HEAD' };
  }
  return { fail: true };
}

function loadEvent() {
  const name = process.env.GITHUB_EVENT_NAME || '';
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!name || !eventPath) return { error: true };
  try {
    return { name, event: JSON.parse(fs.readFileSync(eventPath, 'utf8')) };
  } catch {
    return { error: true };
  }
}

function failClosed() {
  process.stderr.write('diff-guard: fail closed\n');
  process.exit(1);
}

function main() {
  const loaded = loadEvent();
  if (loaded.error) failClosed();
  const range = resolveRange(loaded.name, loaded.event, process.cwd());
  if (range.fail) failClosed();
  if (range.empty) {
    process.stderr.write(`${range.empty}\n`);
    process.exit(0);
  }
  const spec = `${range.base}...${range.head}`;
  const diff = git(['diff', '--unified=0', spec], process.cwd());
  const names = git(['diff', '--name-status', '--find-renames', spec], process.cwd());
  if (!diff.ok || !names.ok) {
    process.stderr.write('diff-guard: git error\n');
    process.exit(1);
  }
  const findings = scanUnifiedDiff(diff.stdout).concat(scanNameStatus(names.stdout));
  for (const finding of findings) {
    process.stdout.write(`${finding.file}:${finding.line} ${finding.rule}\n`);
  }
  process.exit(findings.some((finding) => !finding.allowed) ? 1 : 0);
}

if (require.main === module) main();

module.exports = { scanUnifiedDiff, contentHits, scanNameStatus, isDisallowedEnv };
