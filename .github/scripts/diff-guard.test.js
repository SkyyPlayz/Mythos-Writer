#!/usr/bin/env node
/**
 * Fixture matrix for the PR-diff secret scan.
 * Run: node .github/scripts/diff-guard.test.js
 *
 * Fakes and the allow marker are built at run time. This file must not
 * contain a literal key or that marker, or the scan fails on its own diff.
 */
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const SCRIPT = path.join(__dirname, 'diff-guard.js');
const REPO = path.resolve(__dirname, '..', '..');
const { scanUnifiedDiff, contentHits } = require('./diff-guard.js');

function allowMarker() {
  return 'diff-' + 'guard: ' + 'allow-' + 'fake';
}

function fakes() {
  return [
    ['gh-token', 'gh' + 'p_' + 'A'.repeat(36)],
    ['github-pat', 'github_' + 'pat_' + 'a'.repeat(82)],
    ['sk-ant', 'sk-' + 'ant-' + 'x'.repeat(40)],
    ['sk-or', 'sk-' + 'or-' + 'v1-' + 'ab'.repeat(32)],
    ['sk-proj', 'sk-' + 'proj-' + 'x'.repeat(40)],
    ['live-key', 's' + 'k_live_' + 'a'.repeat(24)],
    ['aws-akia', 'AK' + 'IA' + '0'.repeat(16)],
    ['slack-token', 'xox' + 'b-' + 'a'.repeat(12)],
    ['private-key', '-----' + 'BEGIN ' + 'PRIVATE KEY' + '-----'],
    ['private-key', '-----' + 'BEGIN ' + 'RSA PRIVATE KEY' + '-----'],
  ];
}

function greenBody() {
  return [
    'sk-' + 'ant-',
    'sk-' + 'or-' + 'v1-' + 'placeholder',
    'rotate the ' + 'sk_' + 'live_' + ' credential',
  ].join('\n') + '\n';
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
  }
  return (result.stdout || '').trim();
}

function initRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-guard-'));
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'diff-guard@example.com']);
  git(root, ['config', 'user.name', 'diff-guard']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  return root;
}

function writeFile(root, rel, body) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

function commitAll(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function runGuard(root, eventName, event) {
  const eventPath = path.join(os.tmpdir(), `diff-guard-event-${process.pid}-${Date.now()}-${Math.random()}.json`);
  fs.writeFileSync(eventPath, JSON.stringify(event || {}));
  try {
    return spawnSync(process.execPath, [SCRIPT], {
      cwd: root,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        LANG: process.env.LANG || 'C.UTF-8',
        TMPDIR: process.env.TMPDIR || os.tmpdir(),
        GITHUB_EVENT_NAME: eventName,
        GITHUB_EVENT_PATH: eventPath,
      },
    });
  } finally {
    fs.rmSync(eventPath, { force: true });
  }
}

function withRepo(fn) {
  const root = initRepo();
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function assertNoValue(result, secret) {
  const blob = `${result.stdout}\n${result.stderr}`;
  if (blob.includes(secret)) assert.fail('output contained a matched value');
}

function assertFindingShape(stdout) {
  for (const line of stdout.split('\n')) {
    if (!line) continue;
    assert.match(line, /^[^:\n]+:\d+ [a-z0-9-]+$/);
  }
}

function pushEvent(before) {
  return { before, after: 'HEAD' };
}

test('each real-length fake is reported as file:line rule-id and the value is not printed', () => {
  const rows = fakes();
  withRepo((root) => {
    writeFile(root, 'README.md', 'clean\n');
    const base = commitAll(root, 'base');
    const body = rows.map((row) => row[1]).join('\n') + '\n';
    writeFile(root, 'keys.txt', body);
    commitAll(root, 'head');
    const result = runGuard(root, 'push', pushEvent(base));
    assert.equal(result.status, 1, result.stderr);
    assertFindingShape(result.stdout);
    const seen = new Set();
    const lines = result.stdout.split('\n').filter(Boolean);
    rows.forEach((row, index) => {
      const expected = `keys.txt:${index + 1} ${row[0]}`;
      assert.ok(lines.includes(expected), expected);
      seen.add(row[0]);
      assertNoValue(result, row[1]);
    });
    for (const id of ['gh-token', 'github-pat', 'sk-ant', 'sk-or', 'sk-proj', 'live-key', 'aws-akia', 'slack-token', 'private-key']) {
      assert.ok(seen.has(id), id);
    }
  });
});

test('a bare prefix, a short placeholder, and a prose fragment are green', () => {
  withRepo((root) => {
    writeFile(root, 'README.md', 'clean\n');
    const base = commitAll(root, 'base');
    writeFile(root, 'prose.txt', greenBody());
    commitAll(root, 'head');
    const result = runGuard(root, 'push', pushEvent(base));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '');
  });
});

test('an unchanged context line is ignored and an added line is still reported', () => {
  const rows = fakes();
  const contextKey = rows[0][1];
  const addedKey = rows[2][1];
  const diff = [
    'diff --git a/notes.txt b/notes.txt',
    '--- a/notes.txt',
    '+++ b/notes.txt',
    '@@ -1,3 +1,3 @@',
    ` ${contextKey}`,
    '-old',
    `+${addedKey}`,
  ].join('\n');
  const hits = scanUnifiedDiff(diff);
  assert.deepEqual(hits, [{ file: 'notes.txt', line: 2, rule: 'sk-ant', allowed: false }]);
});

test('a real git diff ignores a key that was already on an unchanged line', () => {
  const key = fakes()[0][1];
  withRepo((root) => {
    writeFile(root, 'notes.txt', `${key}\nold\n`);
    const base = commitAll(root, 'base');
    writeFile(root, 'notes.txt', `${key}\nnew\n`);
    commitAll(root, 'head');
    const result = runGuard(root, 'push', pushEvent(base));
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(result.stdout.trim(), '');
    assertNoValue(result, key);
  });
});

test('the allow marker lists its own line and does not fail the build', () => {
  const key = fakes()[0][1];
  withRepo((root) => {
    writeFile(root, 'README.md', 'clean\n');
    const base = commitAll(root, 'base');
    writeFile(root, 'fake.txt', `${key} ${allowMarker()}\n`);
    commitAll(root, 'head');
    const result = runGuard(root, 'push', pushEvent(base));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'fake.txt:1 gh-token');
    assertNoValue(result, key);
  });
});

test('a marker on the next line does not allow the hit', () => {
  const key = fakes()[0][1];
  withRepo((root) => {
    writeFile(root, 'README.md', 'clean\n');
    const base = commitAll(root, 'base');
    writeFile(root, 'fake.txt', `${key}\n${allowMarker()}\n`);
    commitAll(root, 'head');
    const result = runGuard(root, 'push', pushEvent(base));
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /^fake\.txt:1 gh-token$/m);
    assertNoValue(result, key);
  });
});

test('adding .env is red', () => {
  withRepo((root) => {
    writeFile(root, 'README.md', 'clean\n');
    const base = commitAll(root, 'base');
    writeFile(root, '.env', 'TOKEN=1\n');
    commitAll(root, 'head');
    const result = runGuard(root, 'push', pushEvent(base));
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /^\.env:1 env-file$/m);
  });
});

test('renaming foo.txt to .env.local is red', () => {
  withRepo((root) => {
    writeFile(root, 'foo.txt', 'hello\n');
    const base = commitAll(root, 'base');
    git(root, ['mv', 'foo.txt', '.env.local']);
    commitAll(root, 'head');
    const result = runGuard(root, 'push', pushEvent(base));
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /^\.env\.local:1 env-file$/m);
  });
});

test('adding .env.example is green', () => {
  withRepo((root) => {
    writeFile(root, 'README.md', 'clean\n');
    const base = commitAll(root, 'base');
    writeFile(root, '.env.example', 'TOKEN=1\n');
    commitAll(root, 'head');
    const result = runGuard(root, 'push', pushEvent(base));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '');
  });
});

test('pull_request scans base.sha to head.sha', () => {
  const key = fakes()[4][1];
  withRepo((root) => {
    writeFile(root, 'README.md', 'clean\n');
    const base = commitAll(root, 'base');
    writeFile(root, 'added.txt', `${key}\n`);
    const head = commitAll(root, 'head');
    const result = runGuard(root, 'pull_request', {
      pull_request: { base: { sha: base }, head: { sha: head } },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /^added\.txt:1 sk-proj$/m);
    assertNoValue(result, key);
  });
});

test('push uses before when it is in history, not only HEAD~1', () => {
  const key = fakes()[6][1];
  withRepo((root) => {
    writeFile(root, 'README.md', 'clean\n');
    const rootSha = commitAll(root, 'root');
    writeFile(root, 'secret.txt', `${key}\n`);
    commitAll(root, 'adds key');
    writeFile(root, 'other.txt', 'ok\n');
    commitAll(root, 'later');
    const result = runGuard(root, 'push', pushEvent(rootSha));
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /^secret\.txt:1 aws-akia$/m);
    assertNoValue(result, key);
  });
});

test('push with an all-zero before scans HEAD~1', () => {
  const key = fakes()[7][1];
  withRepo((root) => {
    writeFile(root, 'README.md', 'clean\n');
    commitAll(root, 'root');
    writeFile(root, 'secret.txt', `${key}\n`);
    commitAll(root, 'adds key');
    const result = runGuard(root, 'push', pushEvent('0'.repeat(40)));
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /^secret\.txt:1 slack-token$/m);
    assertNoValue(result, key);
  });
});

test('push with no parent logs and passes', () => {
  const key = fakes()[0][1];
  withRepo((root) => {
    writeFile(root, 'secret.txt', `${key}\n`);
    commitAll(root, 'root');
    const result = runGuard(root, 'push', pushEvent('0'.repeat(40)));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /diff-guard: no base, nothing to scan/);
    assert.equal(result.stdout.trim(), '');
    assertNoValue(result, key);
  });
});

test('workflow_dispatch on main logs and passes', () => {
  withRepo((root) => {
    writeFile(root, 'README.md', 'clean\n');
    commitAll(root, 'root');
    git(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    const result = runGuard(root, 'workflow_dispatch', {});
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /diff-guard: empty diff, nothing to scan/);
    assert.equal(result.stdout.trim(), '');
  });
});

test('workflow_dispatch scans commits ahead of origin/main', () => {
  const key = fakes()[3][1];
  withRepo((root) => {
    writeFile(root, 'README.md', 'clean\n');
    commitAll(root, 'root');
    git(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    writeFile(root, 'secret.txt', `${key}\n`);
    commitAll(root, 'ahead');
    const result = runGuard(root, 'workflow_dispatch', {});
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /^secret\.txt:1 sk-or$/m);
    assertNoValue(result, key);
  });
});

test('an unknown event fails closed', () => {
  withRepo((root) => {
    writeFile(root, 'README.md', 'clean\n');
    commitAll(root, 'root');
    const result = runGuard(root, 'issues', {});
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout.trim(), '');
  });
});

test('a missing pull_request sha fails closed', () => {
  withRepo((root) => {
    writeFile(root, 'README.md', 'clean\n');
    commitAll(root, 'root');
    const missing = 'a'.repeat(40);
    const result = runGuard(root, 'pull_request', {
      pull_request: { base: { sha: missing }, head: { sha: missing } },
    });
    assert.equal(result.status, 1, result.stderr);
  });
});

function isExemptPath(rel) {
  if (rel === 'e2e' || rel.startsWith('e2e/')) return true;
  if (rel.split('/').includes('__fixtures__')) return true;
  const base = rel.slice(rel.lastIndexOf('/') + 1);
  return base.includes('.test.') || base.includes('.spec.');
}

test('tracked tree at HEAD has 0 content hits outside test paths', () => {
  const listed = git(REPO, ['ls-files', '-z']);
  const hits = [];
  for (const rel of listed.split('\0')) {
    if (!rel || isExemptPath(rel)) continue;
    const full = path.join(REPO, rel);
    let buf;
    try {
      buf = fs.readFileSync(full);
    } catch {
      continue;
    }
    if (buf.includes(0)) continue;
    const text = buf.toString('utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      for (const hit of contentHits(lines[i])) {
        hits.push(`${rel}:${i + 1} ${hit.id}`);
      }
    }
  }
  assert.deepEqual(hits, []);
});
