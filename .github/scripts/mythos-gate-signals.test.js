#!/usr/bin/env node
/**
 * Fixture matrix for mythos-gate Critic + Shield + Probe tip-bound signals.
 * Run: node .github/scripts/mythos-gate-signals.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  criticDecision,
  shieldDecision,
  probeDecision,
  isTrustedGateAuthor,
  isGateSignalBody,
  shaInBody,
  evaluateTipBoundSignals,
  TRUSTED_GATE_LOGINS,
} = require('./mythos-gate-signals.js');

const TIP_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TIP_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const TRUSTED = 'SkyyPlayz';
const BOT = 'SkyHigh-Mythos-Bot';

function item(body, { login = TRUSTED, at = '2026-09-28T12:00:00Z', commitId = null, reviewState = null } = {}) {
  return { body, login, createdAt: at, commitId, reviewState };
}

test('trusted authors allowlist excludes cursor[bot]', () => {
  assert.equal(isTrustedGateAuthor('SkyyPlayz'), true);
  assert.equal(isTrustedGateAuthor('SkyHigh-Mythos-Bot'), true);
  assert.equal(isTrustedGateAuthor('cursor[bot]'), false);
  assert.equal(isTrustedGateAuthor('dependabot[bot]'), false);
  assert.equal(TRUSTED_GATE_LOGINS.has('cursor[bot]'), false);
});

test('tokens are case-insensitive (COMMENT OK)', () => {
  assert.equal(criticDecision('## Critic\nAPPROVE — tip deadbeef'), 'APPROVE');
  assert.equal(criticDecision('critic: approve'), 'APPROVE');
  assert.equal(criticDecision('Critic CHANGES REQUIRED on tip'), 'CHANGES_REQUIRED');
  assert.equal(criticDecision('Critic: changes requested'), 'CHANGES_REQUIRED');
  assert.equal(criticDecision('Critic CHANGES_REQUESTED'), 'CHANGES_REQUIRED');
  assert.equal(shieldDecision('Shield CLEAR'), 'CLEAR');
  assert.equal(shieldDecision('shield: block'), 'BLOCK');
  assert.equal(probeDecision('Probe VERIFY PASS'), 'VERIFY_PASS');
  assert.equal(probeDecision('probe verify fail'), 'VERIFY_FAIL');
});

test('fail beats pass in the same body', () => {
  assert.equal(
    criticDecision('Critic APPROVE\n…also Critic CHANGES REQUIRED'),
    'CHANGES_REQUIRED'
  );
  assert.equal(shieldDecision('Shield CLEAR and Shield BLOCK'), 'BLOCK');
  assert.equal(probeDecision('Probe VERIFY PASS then VERIFY FAIL'), 'VERIFY_FAIL');
});

test('bare / far-apart tokens do not satisfy probe or shield', () => {
  assert.equal(probeDecision('VERIFY PASS alone'), null);
  assert.equal(shieldDecision('CLEAR alone'), null);
  const far = `Probe${'x'.repeat(200)}VERIFY PASS`;
  assert.equal(probeDecision(far), null);
});

test('isGateSignalBody includes fail tokens so evaluate re-triggers', () => {
  assert.equal(isGateSignalBody('Shield BLOCK'), true);
  assert.equal(isGateSignalBody('Critic CHANGES REQUIRED'), true);
  assert.equal(isGateSignalBody('Probe VERIFY FAIL'), true);
  assert.equal(isGateSignalBody('hello world'), false);
});

test('fixture: CLEAR-only → no merge', () => {
  const result = evaluateTipBoundSignals({
    headSha: TIP_A,
    items: [item(`Shield CLEAR — tip \`${TIP_A.slice(0, 7)}\``)],
  });
  assert.equal(result.allowMerge, false);
  assert.equal(result.shield, 'CLEAR');
  assert.equal(result.critic, null);
  assert.equal(result.probe, null);
});

test('fixture: CLEAR + CHANGES + FAIL → no merge', () => {
  const result = evaluateTipBoundSignals({
    headSha: TIP_A,
    items: [
      item(`Shield CLEAR — tip ${TIP_A.slice(0, 7)}`, { at: '2026-09-28T12:00:00Z' }),
      item(`Critic CHANGES REQUIRED — tip ${TIP_A.slice(0, 7)}`, { at: '2026-09-28T12:01:00Z' }),
      item(`Probe VERIFY FAIL — tip ${TIP_A.slice(0, 7)}`, { at: '2026-09-28T12:02:00Z' }),
    ],
  });
  assert.equal(result.allowMerge, false);
  assert.equal(result.critic, 'CHANGES_REQUIRED');
  assert.equal(result.shield, 'CLEAR');
  assert.equal(result.probe, 'VERIFY_FAIL');
});

test('fixture: APPROVE + CLEAR + PASS same tip → allow', () => {
  const result = evaluateTipBoundSignals({
    headSha: TIP_A,
    items: [
      item(`## Critic\nAPPROVE\ntip ${TIP_A}`, { login: TRUSTED, at: '2026-09-28T12:00:00Z' }),
      item(`Shield CLEAR tip ${TIP_A.slice(0, 7)}`, { login: BOT, at: '2026-09-28T12:01:00Z' }),
      item(`Probe VERIFY PASS tip ${TIP_A.slice(0, 12)}`, { login: TRUSTED, at: '2026-09-28T12:02:00Z' }),
    ],
  });
  assert.equal(result.allowMerge, true);
  assert.equal(result.critic, 'APPROVE');
  assert.equal(result.shield, 'CLEAR');
  assert.equal(result.probe, 'VERIFY_PASS');
});

test('fixture: tip A trio + tip B FAIL/CHANGES → no merge for B', () => {
  const tipATrio = [
    item(`Critic APPROVE tip ${TIP_A}`, { at: '2026-09-28T12:00:00Z' }),
    item(`Shield CLEAR tip ${TIP_A}`, { at: '2026-09-28T12:01:00Z' }),
    item(`Probe VERIFY PASS tip ${TIP_A}`, { at: '2026-09-28T12:02:00Z' }),
  ];
  const tipBFail = [
    item(`Critic CHANGES REQUIRED tip ${TIP_B}`, { at: '2026-09-28T13:00:00Z' }),
    item(`Probe VERIFY FAIL tip ${TIP_B}`, { at: '2026-09-28T13:01:00Z' }),
  ];

  const onA = evaluateTipBoundSignals({ headSha: TIP_A, items: [...tipATrio, ...tipBFail] });
  assert.equal(onA.allowMerge, true, 'tip A trio still allows tip A');

  const onB = evaluateTipBoundSignals({ headSha: TIP_B, items: [...tipATrio, ...tipBFail] });
  assert.equal(onB.allowMerge, false, 'stale tip A must not clear tip B');
  assert.equal(onB.critic, 'CHANGES_REQUIRED');
  assert.equal(onB.probe, 'VERIFY_FAIL');
  assert.equal(onB.shield, null, 'tip A Shield must not bind tip B');
});

test('latest tip-bound Probe FAIL revokes earlier PASS on same tip', () => {
  const result = evaluateTipBoundSignals({
    headSha: TIP_A,
    items: [
      item(`Critic APPROVE tip ${TIP_A}`, { at: '2026-09-28T12:00:00Z' }),
      item(`Shield CLEAR tip ${TIP_A}`, { at: '2026-09-28T12:01:00Z' }),
      item(`Probe VERIFY PASS tip ${TIP_A}`, { at: '2026-09-28T12:02:00Z' }),
      item(`Probe VERIFY FAIL tip ${TIP_A}`, { at: '2026-09-28T12:03:00Z' }),
    ],
  });
  assert.equal(result.allowMerge, false);
  assert.equal(result.probe, 'VERIFY_FAIL');
});

test('cursor[bot] Probe PASS is ignored', () => {
  const result = evaluateTipBoundSignals({
    headSha: TIP_A,
    items: [
      item(`Critic APPROVE tip ${TIP_A}`, { login: TRUSTED }),
      item(`Shield CLEAR tip ${TIP_A}`, { login: TRUSTED }),
      item(`Probe VERIFY PASS tip ${TIP_A}`, { login: 'cursor[bot]' }),
    ],
  });
  assert.equal(result.allowMerge, false);
  assert.equal(result.probe, null);
});

test('shaInBody matches ≥7-char tip prefix', () => {
  assert.equal(shaInBody(`tip ${TIP_A.slice(0, 7)}`, TIP_A), true);
  assert.equal(shaInBody(`tip ${TIP_A}`, TIP_A), true);
  assert.equal(shaInBody(`tip ${TIP_B.slice(0, 7)}`, TIP_A), false);
});
