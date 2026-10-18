#!/usr/bin/env node
/**
 * Fixture matrix for the workflow bot-token / secrets-fallback guard.
 * Run: node .github/scripts/no-bot-token.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const SCRIPT = path.join(__dirname, 'no-bot-token.js');
const REPO = path.resolve(__dirname, '..', '..');

function writeTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'no-bot-token-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}

function run(root) {
  return spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' });
}

function withTree(files, fn) {
  const root = writeTree(files);
  try {
    fn(run(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function assertFails(result, rule, needle) {
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, new RegExp(rule));
  assert.match(result.stderr, needle);
}

function countScanTargets(root) {
  let count = 0;
  const workflows = path.join(root, '.github', 'workflows');
  if (fs.existsSync(workflows)) {
    for (const name of fs.readdirSync(workflows)) {
      if (name.endsWith('.yml') || name.endsWith('.yaml')) count += 1;
    }
  }
  const actions = path.join(root, '.github', 'actions');
  if (fs.existsSync(actions)) {
    const walk = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(full);
        else if (ent.isFile() && (ent.name === 'action.yml' || ent.name === 'action.yaml')) count += 1;
      }
    };
    walk(actions);
  }
  return count;
}

test('dot form secrets.MYTHOS_BOT_TOKEN fails the scan', () => {
  withTree(
    {
      '.github/workflows/red.yml': 'name: red\nenv: ${{ secrets.MYTHOS_BOT_TOKEN }}\n',
    },
    (result) => {
      assertFails(result, 'mythos-bot-token-dot', /secrets\.MYTHOS_BOT_TOKEN/);
      assert.match(result.stderr, /\.github\/workflows\/red\.yml:2:/);
    }
  );
});

test("bracket form secrets['MYTHOS_BOT_TOKEN'] fails the scan", () => {
  withTree(
    {
      '.github/workflows/red.yml': "name: red\nenv: ${{ secrets['MYTHOS_BOT_TOKEN'] }}\n",
    },
    (result) => {
      assertFails(result, 'mythos-bot-token-bracket', /secrets\['MYTHOS_BOT_TOKEN'\]/);
      assert.match(result.stderr, /\.github\/workflows\/red\.yml:2:/);
    }
  );
});

test('bracket form secrets["MYTHOS_BOT_TOKEN"] fails the scan', () => {
  withTree(
    {
      '.github/workflows/red.yml': 'name: red\nenv: ${{ secrets["MYTHOS_BOT_TOKEN"] }}\n',
    },
    (result) => {
      assertFails(result, 'mythos-bot-token-bracket', /secrets\["MYTHOS_BOT_TOKEN"\]/);
      assert.match(result.stderr, /\.github\/workflows\/red\.yml:2:/);
    }
  );
});

test('PAT fallback || secrets. fails the scan', () => {
  withTree(
    {
      '.github/workflows/red.yaml':
        'name: red\nenv: ${{ secrets.GITHUB_TOKEN || secrets.OTHER_PAT }}\n',
    },
    (result) => {
      assertFails(result, 'secrets-fallback', /\|\| secrets\./);
      assert.doesNotMatch(result.stderr, /mythos-bot-token/);
      assert.match(result.stderr, /\.github\/workflows\/red\.yaml:2:/);
    }
  );
});

test('PAT fallback || secrets[ fails the scan', () => {
  withTree(
    {
      '.github/actions/demo/action.yml':
        "name: red\nruns: ${{ secrets.GITHUB_TOKEN || secrets['OTHER_PAT'] }}\n",
    },
    (result) => {
      assertFails(result, 'secrets-fallback', /\|\| secrets\[/);
      assert.doesNotMatch(result.stderr, /mythos-bot-token/);
      assert.match(result.stderr, /\.github\/actions\/demo\/action\.yml:2:/);
    }
  );
});

test('dot, bracket, and fallback forms fail in any case', () => {
  withTree(
    {
      '.github/workflows/dot.yml': 'env: ${{ Secrets.mythos_bot_token }}\n',
      '.github/workflows/bracket.yaml': "env: ${{ SECRETS['Mythos_Bot_Token'] }}\n",
      '.github/actions/nested/leaf/action.yaml': 'env: ${{ secrets.GITHUB_TOKEN || SeCrEtS.OTHER }}\n',
    },
    (result) => {
      assert.equal(result.status, 1, result.stderr || result.stdout);
      assert.match(result.stderr, /mythos-bot-token-dot/);
      assert.match(result.stderr, /mythos-bot-token-bracket/);
      assert.match(result.stderr, /secrets-fallback/);
    }
  );
});

test('a split-line || secrets. fallback fails the scan', () => {
  withTree(
    {
      '.github/workflows/red.yml': 'env: ${{ secrets.GITHUB_TOKEN ||\n  secrets.OTHER_PAT }}\n',
    },
    (result) => {
      assertFails(result, 'secrets-fallback', /\|\| secrets\./);
    }
  );
});

test('clean workflow and composite action pass', () => {
  withTree(
    {
      '.github/workflows/ok.yml':
        'name: ok\nenv:\n  GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n  WHEN: ${{ secrets.MYTHOS_BOT_TOKEN_SET_AT }}\n',
      '.github/actions/demo/action.yml': 'runs:\n  env:\n    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n',
    },
    (result) => {
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /no-bot-token: clean \(2 files\)/);
    }
  );
});

test('files outside workflows and action.yml are not scanned', () => {
  withTree(
    {
      '.github/workflows/ok.yml': 'env:\n  GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n',
      '.github/workflows/README.md': 'env: ${{ secrets.MYTHOS_BOT_TOKEN }}\n',
      '.github/actions/helper.js': "const t = secrets['MYTHOS_BOT_TOKEN'] || secrets.OTHER\n",
      '.github/workflows/notes.yaml.bak': 'env: ${{ secrets.GITHUB_TOKEN || secrets.OTHER }}\n',
    },
    (result) => {
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /no-bot-token: clean \(1 files\)/);
    }
  );
});

test('current repo tree passes', () => {
  const result = run(REPO);
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
  const expected = countScanTargets(REPO);
  assert.ok(expected >= 1);
  assert.match(result.stdout, new RegExp(`no-bot-token: clean \\(${expected} files\\)`));
});

test('a missing root is an error, not a clean pass', () => {
  const missing = path.join(os.tmpdir(), `no-bot-token-missing-${process.pid}`);
  const result = run(missing);
  assert.equal(result.status, 2, result.stderr || result.stdout);
});

test('zero files scanned fails the scan', () => {
  withTree(
    {
      '.github/workflows/.gitkeep': '',
      '.github/README.md': 'env: ${{ secrets.MYTHOS_BOT_TOKEN }}\n',
    },
    (result) => {
      assert.equal(result.status, 1, result.stderr || result.stdout);
      assert.match(result.stderr, /no-bot-token: scanned 0 files/);
      assert.doesNotMatch(result.stderr, /mythos-bot-token/);
    }
  );
});

test('invalid YAML fails the scan', () => {
  withTree(
    {
      '.github/workflows/broken.yml': ':\n  - [ unterminated\n',
    },
    (result) => {
      assert.equal(result.status, 1, result.stderr || result.stdout);
      assert.match(result.stderr, /no-bot-token: \.github\/workflows\/broken\.yml: invalid YAML:/);
      assert.doesNotMatch(result.stderr, /mythos-bot-token/);
    }
  );
});

// mode 000 does not deny read when the process is root, and Windows ACLs do not
// follow that Unix mode, so this case is skipped only there.
const skipUnreadable =
  process.platform === 'win32' || (typeof process.getuid === 'function' && process.getuid() === 0);

test('an unreadable workflow file fails the scan', {
  skip: skipUnreadable ? 'mode 000 does not deny read as root or on Windows' : false,
}, () => {
  const root = writeTree({
    '.github/workflows/secret.yml': 'name: blocked\n',
  });
  const target = path.join(root, '.github', 'workflows', 'secret.yml');
  try {
    fs.chmodSync(target, 0);
    const result = run(root);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /EACCES/);
  } finally {
    try {
      fs.chmodSync(target, 0o644);
    } catch {
      // The file may already be gone.
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
