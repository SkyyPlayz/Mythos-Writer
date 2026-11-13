#!/usr/bin/env node
/**
 * Tests for .github/workflows/batch-automerge.yml: its static rules and its run step.
 * The run step is extracted from the YAML and executed with bash against a fake `gh` on PATH.
 * The fake never touches the network. Needs bash and jq (both on ubuntu-latest).
 * Also loaded by workflow-rules.test.js, so CI runs it with no ci.yml change.
 *
 * Run: node .github/scripts/batch-automerge.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const yaml = require('js-yaml');

const REPO = path.resolve(__dirname, '..', '..');
const FILE = path.join(REPO, '.github', 'workflows', 'batch-automerge.yml');
const TEXT = fs.readFileSync(FILE, 'utf8');
const DOC = yaml.load(TEXT);
const JOB = DOC.jobs['arm-auto-merge'];
const STEP = JOB.steps[0];
const SHA = 'a'.repeat(40);
const GATE_RULES = [
  { type: 'required_status_checks', parameters: { required_status_checks: [
    { context: 'ci', integration_id: 15368 },
    { context: 'mythos/final-gate', integration_id: 5736520 },
  ] } },
  { type: 'non_fast_forward' },
];

const FAKE_GH = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_LOG"
case "$*" in
  "pr view "*"state,isDraft,isCrossRepository"*) printf '%s\\n' "$FAKE_LIVE" ;;
  "pr view "*"state,headRefOid,mergeStateStatus"*) printf '%s\\n' "$FAKE_NOW" ;;
  "api repos/"*"/rules/branches/"*) cat "$FAKE_RULES" ;;
  "api repos/"*"/pulls/"*"--jq .changed_files") printf '%s\\n' "$FAKE_TOTAL" ;;
  "api --paginate"*"previous_filename"*) printf '%s' "$FAKE_FILES" ;;
  "api --paginate"*) printf '%s' "$FAKE_NAMES" ;;
  "pr merge "*"--disable-auto"*) exit "\${FAKE_DISABLE_RC:-0}" ;;
  "pr merge "*"--auto"*) exit "\${FAKE_AUTO_RC:-0}" ;;
  "pr merge "*) exit "\${FAKE_MERGE_RC:-0}" ;;
  *) echo "fake gh: unexpected: $*" >&2; exit 99 ;;
esac
`;

function live(over = {}) {
  const f = { state: 'OPEN', draft: 'false', cross: 'false', base: 'batch/b1', head: SHA, mstate: 'BLOCKED', ...over };
  return [f.state, f.draft, f.cross, f.base, f.head, f.mstate].join('\t');
}

function run(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-automerge-'));
  try {
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'gh'), FAKE_GH, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, 'rules.json'), JSON.stringify(over.rules || GATE_RULES));
    const names = over.names || ['frontend/src/a.ts', 'frontend/src/a.test.ts'];
    const prev = over.prev || [];
    const env = {
      PATH: bin + path.delimiter + process.env.PATH,
      GH_TOKEN: 'fake',
      GH_REPO: 'o/r',
      PR: '7',
      EVENT_BASE: over.eventBase || 'batch/b1',
      EVENT_HEAD: SHA,
      FAKE_LOG: path.join(dir, 'log'),
      FAKE_RULES: path.join(dir, 'rules.json'),
      FAKE_LIVE: over.live || live(),
      FAKE_NOW: over.now || ['OPEN', SHA, 'CLEAN'].join('\t'),
      FAKE_TOTAL: String(over.total === undefined ? names.length : over.total),
      FAKE_FILES: names.concat(prev).map((n) => n + '\n').join(''),
      FAKE_NAMES: names.map((n) => n + '\n').join(''),
      FAKE_AUTO_RC: String(over.autoRc || 0),
      FAKE_MERGE_RC: String(over.mergeRc || 0),
      FAKE_DISABLE_RC: String(over.disableRc || 0),
    };
    const r = spawnSync('bash', ['-c', STEP.run], { env, encoding: 'utf8' });
    const log = fs.existsSync(env.FAKE_LOG) ? fs.readFileSync(env.FAKE_LOG, 'utf8').split('\n').filter(Boolean) : [];
    const merges = log.filter((l) => l.startsWith('pr merge '));
    return { code: r.status, out: r.stdout + r.stderr, log, merges };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---- static rules ----------------------------------------------------------------------------
test('triggers: pull_request only, five types, no branches filter', () => {
  const on = DOC.on || DOC[true];
  assert.deepEqual(Object.keys(on), ['pull_request']);
  assert.deepEqual(on.pull_request.types, ['opened', 'reopened', 'ready_for_review', 'synchronize', 'edited']);
  assert.equal(on.pull_request.branches, undefined);
  assert.equal(TEXT.includes('pull_request_target'), false);
});

test('permissions: none at the top, contents and pull-requests write on the one job', () => {
  assert.deepEqual(DOC.permissions, {});
  assert.deepEqual(Object.keys(DOC.jobs), ['arm-auto-merge']);
  assert.deepEqual(JOB.permissions, { contents: 'write', 'pull-requests': 'write' });
});

test('job guard: not a draft, same-repo head, not Dependabot', () => {
  assert.match(JOB.if, /pull_request\.draft == false/);
  assert.match(JOB.if, /head\.repo\.full_name == github\.repository/);
  assert.match(JOB.if, /user\.login != 'dependabot\[bot\]'/);
});

test('one run step: no checkout, no actions, only the built-in token, no secrets', () => {
  assert.equal(JOB.steps.length, 1);
  assert.equal(STEP.uses, undefined);
  assert.equal(STEP.env.GH_TOKEN, '${{ github.token }}');
  assert.equal(TEXT.includes('secrets.'), false);
  assert.equal(/actions\/checkout/.test(TEXT), false);
});

test('untrusted event values reach the script through env, never inline', () => {
  assert.equal(/\$\{\{/.test(STEP.run), false);
});

test('merge calls are squash, pinned to the head, never admin', () => {
  const merges = STEP.run.split('\n').filter((l) => /gh pr merge/.test(l) && !/--disable-auto/.test(l));
  assert.equal(merges.length, 2);
  for (const l of merges) {
    assert.match(l, /--squash/);
    assert.match(l, /--match-head-commit "\$head"/);
  }
  assert.match(merges[0], /--auto/);
  assert.equal(/--admin|--merge\b|--rebase/.test(STEP.run), false);
});

// ---- behavior of the run step ----------------------------------------------------------------
test('clean case: arms squash auto-merge pinned to the head', () => {
  const r = run();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.merges, [`pr merge 7 --auto --squash --match-head-commit ${SHA}`]);
});

test('draft, closed, fork, moved head, moved batch base: skip with no merge call', () => {
  for (const over of [
    { live: live({ draft: 'true' }) },
    { live: live({ state: 'CLOSED' }) },
    { live: live({ cross: 'true' }) },
    { live: live({ base: 'batch/b2' }) },
    { live: live({ head: 'b'.repeat(40) }) },
  ]) {
    const r = run(over);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(r.merges, [], JSON.stringify(over));
  }
});

test('retarget batch/** to main disables auto-merge and never enables', () => {
  for (const over of [
    { live: live({ base: 'main' }), eventBase: 'main' },
    { live: live({ base: 'main' }), eventBase: 'batch/b1' },
    { live: live({ base: 'main' }), eventBase: 'main', disableRc: 1 },
  ]) {
    const r = run(over);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(r.merges, ['pr merge 7 --disable-auto'], JSON.stringify(over));
  }
});

test('edited title on a batch/** base re-evaluates and arms', () => {
  const r = run({ eventBase: 'batch/b1', live: live({ base: 'batch/b1' }) });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.merges, [`pr merge 7 --auto --squash --match-head-commit ${SHA}`]);
});

test('non-batch base on opened disables auto-merge and does not enable', () => {
  for (const over of [
    { live: live({ base: 'main' }), eventBase: 'main' },
    { live: live({ base: 'batch/' }), eventBase: 'batch/' },
    { live: live({ base: 'main' }), eventBase: 'main', disableRc: 1 },
  ]) {
    const r = run(over);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(r.merges, ['pr merge 7 --disable-auto'], JSON.stringify(over));
  }
});

test('fails closed (exit 1, no merge) when the base does not require the gate from the gate App', () => {
  const noRules = [{ type: 'non_fast_forward' }];
  const wrongApp = [{ type: 'required_status_checks', parameters: { required_status_checks: [
    { context: 'mythos/final-gate', integration_id: 15368 }] } }];
  const wrongName = [{ type: 'required_status_checks', parameters: { required_status_checks: [
    { context: 'ci', integration_id: 5736520 }] } }];
  for (const rules of [[], noRules, wrongApp, wrongName]) {
    const r = run({ rules });
    assert.equal(r.code, 1, r.out);
    assert.deepEqual(r.merges, []);
    assert.match(r.out, /refusing to arm/);
  }
});

test('protected paths: not armed, auto-merge disabled, exit 0', () => {
  const paths = [
    '.github/workflows/ci.yml', 'package.json', 'package-lock.json', 'electron-main/src/db.ts',
    'electron-main/src/vault/manifest/migrations/v1.ts', 'electron-main/src/authStore.ts', 'electron-main/src/secrets.ts',
    '.env', 'AGENTS.md', 'CLAUDE.md', 'electron-builder.json', 'build/installer.nsh', 'frontend/vite.config.ts',
    'docs/CODEOWNERS', 'release-notes/0.5.7.md', 'electron-main/src/stripeClient.ts', '.husky/pre-commit',
  ];
  for (const p of paths) {
    const r = run({ names: ['frontend/src/a.ts', p] });
    assert.equal(r.code, 0, `${p}: ${r.out}`);
    assert.deepEqual(r.merges, ['pr merge 7 --disable-auto'], p);
  }
});

test('a rename out of a protected path counts as touching it', () => {
  const r = run({ names: ['frontend/src/ok.ts'], prev: ['.github/workflows/old.yml'] });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.merges, ['pr merge 7 --disable-auto']);
});

test('ordinary paths are not protected', () => {
  const names = ['frontend/src/components/Editor.tsx', 'frontend/src/components/Editor.test.tsx', 'e2e/past-chats.spec.ts',
    'electron-main/src/ipc/handlers.ts', 'docs/notes.md', 'electron-main/src/vault/join.ts'];
  const r = run({ names });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.merges.length, 1);
  assert.match(r.merges[0], /--auto --squash/);
});

test('fails closed on an empty or incomplete file list', () => {
  for (const over of [{ names: [], total: 0 }, { names: ['a.ts'], total: 3 }, { names: ['a.ts'], total: 'x' }]) {
    const r = run(over);
    assert.equal(r.code, 1, r.out);
    assert.deepEqual(r.merges, []);
  }
});

test('arming refused on a clean PR: merges now, squash, pinned to the head', () => {
  const r = run({ autoRc: 1 });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.merges, [
    `pr merge 7 --auto --squash --match-head-commit ${SHA}`,
    `pr merge 7 --squash --match-head-commit ${SHA}`,
  ]);
});

test('arming refused and not clean (or head moved): exit 1, no direct merge', () => {
  for (const now of [['OPEN', SHA, 'BLOCKED'], ['OPEN', 'c'.repeat(40), 'CLEAN'], ['CLOSED', SHA, 'CLEAN']]) {
    const r = run({ autoRc: 1, now: now.join('\t') });
    assert.equal(r.code, 1, r.out);
    assert.deepEqual(r.merges, [`pr merge 7 --auto --squash --match-head-commit ${SHA}`]);
  }
});

test('a failed disable on a protected PR does not fail the job', () => {
  const r = run({ names: ['package.json'], disableRc: 1 });
  assert.equal(r.code, 0, r.out);
});
