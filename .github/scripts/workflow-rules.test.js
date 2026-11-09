#!/usr/bin/env node
/**
 * Uses js-yaml, which is only a transitive dependency (package-lock `node_modules/js-yaml`); if it disappears this test fails closed (red). js-yaml keeps `on` as a string key; a PyYAML reader must use `doc.get('on', doc.get(True))`.
 *
 * Run: node .github/scripts/workflow-rules.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const yaml = require('js-yaml');

const REPO = path.resolve(__dirname, '..', '..');
const WORKFLOWS = path.join(REPO, '.github', 'workflows');

function loadWorkflow(name) {
  const full = path.join(WORKFLOWS, name);
  return yaml.load(fs.readFileSync(full, 'utf8'));
}

function triggerOf(doc) {
  if (doc && Object.prototype.hasOwnProperty.call(doc, 'on')) return doc.on;
  if (doc && Object.prototype.hasOwnProperty.call(doc, true)) return doc[true];
  return undefined;
}

function workflowNames() {
  return fs.readdirSync(WORKFLOWS).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));
}

function deletedWorkflows() {
  const root = '.github/workflows/';
  return [
    root + 'mythos-' + 'token-' + 'audit.yml',
    root + 'vr-' + 'baselines.yml',
    root + 'mythos-' + 'standing-' + 'context-' + 'compress.yml',
    root + 'issue-' + 'finder.yml',
  ];
}

test('ci pull_request branches are main and batch/**', () => {
  const on = triggerOf(loadWorkflow('ci.yml'));
  assert.deepEqual(on.pull_request.branches, ['main', 'batch/**']);
});

test('ci push branches stay main', () => {
  const on = triggerOf(loadWorkflow('ci.yml'));
  assert.deepEqual(on.push.branches, ['main']);
});

test('no workflow triggers merge_group', () => {
  for (const name of workflowNames()) {
    const on = triggerOf(loadWorkflow(name)) || {};
    assert.equal(JSON.stringify(on).includes('merge_group'), false, name);
  }
});

test('ci needs includes diff-guard', () => {
  const doc = loadWorkflow('ci.yml');
  assert.ok(doc.jobs.ci.needs.includes('diff-guard'));
});

test('stage1 includes needs.diff-guard.result', () => {
  const doc = loadWorkflow('ci.yml');
  const run = doc.jobs.ci.steps.map((step) => step.run || '').join('\n');
  const stage = run.match(/stage1="([^"]*)"/);
  assert.ok(stage, 'stage1 assignment');
  assert.match(stage[1], /needs\.diff-guard\.result/);
});

test('draft-ready-on-green skips non-main bases before ready', () => {
  const doc = loadWorkflow('mythos-pr-hygiene.yml');
  const run = doc.jobs['draft-ready-on-green'].steps.map((step) => step.run || '').join('\n');
  const baseCheck = 'if [ "$BASE" != "main" ]; then echo "skip #$n base $BASE"; continue; fi';
  const baseAt = run.indexOf(baseCheck);
  const readyAt = run.indexOf('gh pr ready');
  assert.ok(run.includes('baseRefName'));
  assert.ok(baseAt >= 0, 'base check');
  assert.ok(readyAt >= 0, 'gh pr ready');
  assert.ok(baseAt < readyAt);
});

test('ops health is quarterly secrets-rotation only', () => {
  const doc = loadWorkflow('mythos-ops-health.yml');
  assert.deepEqual(Object.keys(doc.jobs), ['secrets-rotation']);
  const dispatch = triggerOf(doc).workflow_dispatch;
  assert.ok(dispatch == null || dispatch.inputs == null);
  assert.deepEqual(doc.permissions, { issues: 'write' });
});

test('diff-guard permissions are contents read', () => {
  const doc = loadWorkflow('ci.yml');
  assert.deepEqual(doc.jobs['diff-guard'].permissions, { contents: 'read' });
});

function checkoutSteps(file, jobName) {
  return loadWorkflow(file).jobs[jobName].steps.filter((step) => String(step.uses || '').startsWith('actions/checkout'));
}

test('diff-guard and carve-out checkouts do not persist credentials', () => {
  for (const [file, jobName] of [['ci.yml', 'diff-guard'], ['carve-out-check.yml', 'carve-out-check']]) {
    const checkouts = checkoutSteps(file, jobName);
    assert.ok(checkouts.length >= 1, file);
    for (const step of checkouts) {
      assert.equal(step.with['persist-credentials'], false, file);
    }
  }
});

test('diff-guard steps do not name secrets in env', () => {
  const steps = loadWorkflow('ci.yml').jobs['diff-guard'].steps;
  for (const step of steps) {
    assert.equal(JSON.stringify(step.env || {}).includes('secrets.'), false);
  }
});

test('no workflow uses pull_request_target', () => {
  for (const name of workflowNames()) {
    const text = fs.readFileSync(path.join(WORKFLOWS, name), 'utf8');
    assert.equal(text.includes('pull_request_target'), false, name);
  }
});

test('carve-out-check checks out the PR head and can create a label', () => {
  const doc = loadWorkflow('carve-out-check.yml');
  const checkout = checkoutSteps('carve-out-check.yml', 'carve-out-check')[0];
  assert.equal(checkout.with.ref, 'refs/pull/${{ github.event.pull_request.number }}/head');
  assert.equal(doc.permissions.issues, 'write');
  assert.equal(doc.permissions['pull-requests'], 'write');
  assert.equal(doc.permissions.contents, 'read');
});

test('deleted workflows are absent', () => {
  for (const rel of deletedWorkflows()) {
    assert.equal(fs.existsSync(path.join(REPO, rel)), false, rel);
  }
});
