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
const { scanUnifiedDiff, contentHits, isTestPath } = require('./diff-guard.js');

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

function runGuard(root, eventName, event, extraEnv) {
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
        ...(extraEnv || {}),
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
    writeFile(root, 'src/app.test.js', `${key} ${allowMarker()}\n`);
    commitAll(root, 'head');
    const result = runGuard(root, 'push', pushEvent(base));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'src/app.test.js:1 gh-token');
    assertNoValue(result, key);
  });
});

test('an allow marker on a product path is red', () => {
  const key = fakes()[0][1];
  withRepo((root) => {
    writeFile(root, 'README.md', 'clean\n');
    const base = commitAll(root, 'base');
    writeFile(root, 'src/app.js', `${key} ${allowMarker()}\n`);
    commitAll(root, 'head');
    const result = runGuard(root, 'push', pushEvent(base));
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /^src\/app\.js:1 gh-token$/m);
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

test('an added line that starts with two plus signs is still a secret hit', () => {
  const key = fakes()[0][1];
  const second = fakes()[2][1];
  withRepo((root) => {
    writeFile(root, 'README.md', 'clean\n');
    const base = commitAll(root, 'base');
    writeFile(root, 'plus.txt', `++ ${key}\n${second}\n`);
    commitAll(root, 'head');
    const result = runGuard(root, 'push', pushEvent(base));
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /^plus\.txt:1 gh-token$/m);
    assert.match(result.stdout, /^plus\.txt:2 sk-ant$/m);
    assertNoValue(result, key);
    assertNoValue(result, second);
  });
});

test('a plus-plus dev-null line inside a hunk does not hide the next token', () => {
  const key = fakes()[0][1];
  const diff = [
    'diff --git a/notes.txt b/notes.txt',
    '--- a/notes.txt',
    '+++ b/notes.txt',
    '@@ -0,0 +1,2 @@',
    '+++ /dev/null',
    `+${key}`,
  ].join('\n');
  const hits = scanUnifiedDiff(diff);
  assert.deepEqual(hits, [{ file: 'notes.txt', line: 2, rule: 'gh-token', allowed: false }]);
});

test('a diff larger than the default git buffer passes when it has no secret', () => {
  withRepo((root) => {
    writeFile(root, 'README.md', 'clean\n');
    const base = commitAll(root, 'base');
    const line = `${'a'.repeat(80)}\n`;
    writeFile(root, 'lockfile.txt', line.repeat(Math.ceil((2 * 1024 * 1024) / line.length)));
    commitAll(root, 'head');
    const result = runGuard(root, 'push', pushEvent(base));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '');
    assert.doesNotMatch(result.stderr, /git error/);
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

test('a gitattributes binary file still reports an added fake key', () => {
  const key = fakes()[0][1];
  withRepo((root) => {
    writeFile(root, 'README.md', 'clean\n');
    const base = commitAll(root, 'base');
    writeFile(root, '.gitattributes', 'secret.bin binary\n');
    writeFile(root, 'secret.bin', `${key}\n`);
    commitAll(root, 'head');
    const result = runGuard(root, 'push', pushEvent(base));
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /^secret\.bin:1 gh-token$/m);
    assertNoValue(result, key);
  });
});

test('a gitattributes -diff file still reports an added fake key', () => {
  const key = fakes()[2][1];
  withRepo((root) => {
    writeFile(root, 'README.md', 'clean\n');
    const base = commitAll(root, 'base');
    writeFile(root, '.gitattributes', 'nodiff.bin -diff\n');
    writeFile(root, 'nodiff.bin', `${key}\n`);
    commitAll(root, 'head');
    const result = runGuard(root, 'push', pushEvent(base));
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /^nodiff\.bin:1 sk-ant$/m);
    assertNoValue(result, key);
  });
});

test('a file with a NUL byte still reports an added fake key', () => {
  const key = fakes()[6][1];
  withRepo((root) => {
    writeFile(root, 'README.md', 'clean\n');
    const base = commitAll(root, 'base');
    const full = path.join(root, 'nul.bin');
    fs.writeFileSync(full, Buffer.concat([Buffer.from(`${key}\n`), Buffer.from([0])]));
    commitAll(root, 'head');
    const result = runGuard(root, 'push', pushEvent(base));
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /^nul\.bin:1 aws-akia$/m);
    assertNoValue(result, key);
  });
});

test('local textconv, external diff, and color.ui=always still report an added fake key', () => {
  const key = fakes()[0][1];
  withRepo((root) => {
    writeFile(root, 'README.md', 'clean\n');
    const base = commitAll(root, 'base');
    writeFile(root, '.gitattributes', '*.txt diff=stripper\n');
    writeFile(root, 'secret.txt', `${key}\n`);
    commitAll(root, 'head');
    // Untracked drivers. The commit range does not include them. Each one
    // hides the added line unless the matching git flag is set.
    const strip = path.join(root, 'strip-textconv.js');
    const external = path.join(root, 'external-diff.js');
    fs.writeFileSync(strip, "process.stdout.write('redacted\\n');\n");
    fs.writeFileSync(
      external,
      "process.stdout.write('diff --git a/secret.txt b/secret.txt\\n--- a/secret.txt\\n+++ b/secret.txt\\n@@ -0,0 +1 @@\\n+clean\\n');\n",
    );
    git(root, ['config', 'diff.stripper.textconv', `${process.execPath} ${strip}`]);
    git(root, ['config', 'diff.external', `${process.execPath} ${external}`]);
    git(root, ['config', 'color.ui', 'always']);
    const result = runGuard(root, 'push', pushEvent(base));
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /^secret\.txt:1 gh-token$/m);
    assertNoValue(result, key);
  });
});

test('a git diff over the injected buffer limit fails closed', () => {
  withRepo((root) => {
    writeFile(root, 'README.md', 'clean\n');
    const base = commitAll(root, 'base');
    writeFile(root, 'big.txt', `${'a'.repeat(80)}\n`.repeat(200));
    commitAll(root, 'head');
    const result = runGuard(root, 'push', pushEvent(base), { DIFF_GUARD_MAX_BUFFER: '1024' });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /diff-guard: git error/);
    assert.equal(result.stdout.trim(), '');
  });
});

test('isTestPath is true only for an e2e path, a __fixtures__ segment, or a test or spec basename', () => {
  const rows = [
    ['src/app.js', false],
    ['src/a.test.helpers/x.js', false],
    ['e2eutils/x.js', false],
    ['src/fixture/x.js', false],
    ['src/app.testing.js', false],
    ['src/testdata/x.js', false],
    ['src/latest.js', false],
    ['e2e/x.ts', true],
    ['src/__fixtures__/k.json', true],
    ['a/b.spec.ts', true],
    ['a/b.test.js', true],
    ['e2e/sub/y.spec.ts', true],
    ['src/foo.test.ts', true],
    ['lib/__fixtures__/deep/n.json', true],
  ];
  const misses = [];
  for (const [file, expected] of rows) {
    const actual = isTestPath(file);
    if (actual !== expected) misses.push(`${file} -> ${actual}`);
  }
  assert.deepEqual(misses, []);
});

test('contentHits with no file never allows a marker hit', () => {
  const line = `${fakes()[0][1]} ${allowMarker()}`;
  const rows = [
    ['omitted', contentHits(line)],
    ['undefined', contentHits(line, undefined)],
    ['null', contentHits(line, null)],
    ['empty', contentHits(line, '')],
  ];
  for (const [label, hits] of rows) {
    assert.deepEqual(hits, [{ id: 'gh-token', allowed: false }], label);
  }
});

function disallowedContentHits(line, file) {
  return contentHits(line, file).filter((hit) => !hit.allowed);
}

function hitsOutsideTestPaths(entries) {
  const hits = [];
  for (const [rel, text] of entries) {
    if (!rel || isTestPath(rel)) continue;
    const lines = String(text).split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      for (const hit of contentHits(lines[i], rel)) {
        hits.push(`${rel}:${i + 1} ${hit.id}`);
      }
    }
  }
  return hits;
}

test('full-tree accounting counts a same-line allow marker on a product path', () => {
  const key = fakes()[0][1];
  const line = `${key} ${allowMarker()}`;
  assert.equal(isTestPath('src/app.js'), false);
  assert.equal(isTestPath('src/app.test.js'), true);
  assert.deepEqual(contentHits(line, 'src/app.js'), [{ id: 'gh-token', allowed: false }]);
  assert.deepEqual(contentHits(line, 'src/app.test.js'), [{ id: 'gh-token', allowed: true }]);
  assert.deepEqual(disallowedContentHits(line, 'src/app.js'), [{ id: 'gh-token', allowed: false }]);
  assert.deepEqual(disallowedContentHits(line, 'src/app.test.js'), []);
  assert.deepEqual(hitsOutsideTestPaths([['src/app.js', `${line}\n`]]), ['src/app.js:1 gh-token']);
  assert.deepEqual(hitsOutsideTestPaths([['src/app.test.js', `${line}\n`]]), []);
});

test('tracked tree at HEAD has 0 content hits outside test paths', () => {
  const listed = git(REPO, ['ls-files', '-z']);
  const entries = [];
  for (const rel of listed.split('\0')) {
    if (!rel || isTestPath(rel)) continue;
    const full = path.join(REPO, rel);
    let buf;
    try {
      buf = fs.readFileSync(full);
    } catch {
      continue;
    }
    if (buf.includes(0)) continue;
    entries.push([rel, buf.toString('utf8')]);
  }
  assert.deepEqual(hitsOutsideTestPaths(entries), []);
});
