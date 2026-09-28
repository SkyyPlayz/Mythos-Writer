#!/usr/bin/env node
/**
 * Tip-bound Critic / Shield / Probe matchers for mythos-gate-auto-merge.
 *
 * Tokens (case-insensitive; COMMENT reviews OK):
 *   Critic: APPROVE | CHANGES REQUIRED (also CHANGES REQUESTED / CHANGES_REQUESTED)
 *   Shield: CLEAR | BLOCK
 *   Probe:  VERIFY PASS | VERIFY FAIL
 *
 * Fail-closed rules:
 * - Fail beats pass in the same body.
 * - Latest tip-bound review wins per lane.
 * - Signals must cite the evaluated tip SHA (full or ≥7-char prefix).
 * - Trusted authors only: SkyyPlayz, SkyHigh-Mythos-Bot (ignore cursor[bot] et al.).
 *
 * Used by `.github/workflows/mythos-gate-auto-merge.yml`.
 * Tests: `node .github/scripts/mythos-gate-signals.test.js`
 */

'use strict';

const OWNER_LOGIN = 'SkyyPlayz';
// Gate posts today are authored by the owner account (Paperclip/MCP) or the
// Mythos bot. Expand only via PR — fail-closed allowlist. cursor[bot] is NOT trusted.
const TRUSTED_GATE_LOGINS = new Set([OWNER_LOGIN, 'SkyHigh-Mythos-Bot']);

const PROXIMITY = 120;

function shaInBody(body, headSha) {
  if (!body || !headSha) return false;
  const lower = String(body).toLowerCase();
  const full = headSha.toLowerCase();
  for (let n = Math.min(40, full.length); n >= 7; n--) {
    const p = full.slice(0, n);
    const re = new RegExp(`(^|[^a-f0-9])${p}([^a-f0-9]|$)`, 'i');
    if (re.test(lower)) return true;
  }
  return false;
}

function near(role, token, body) {
  // Bidirectional proximity: role within PROXIMITY of token (either order).
  const re = new RegExp(
    `\\b${role}\\b[\\s\\S]{0,${PROXIMITY}}\\b${token}\\b|\\b${token}\\b[\\s\\S]{0,${PROXIMITY}}\\b${role}\\b`,
    'i'
  );
  return re.test(body);
}

function isGateSignalBody(body) {
  if (!body) return false;
  // Include fail tokens so tip-bound BLOCK / CHANGES REQUIRED / VERIFY FAIL re-trigger evaluate.
  return /approve|clear|block|verify\s+pass|verify\s+fail|carve-out|changes[_\s-]*requir(?:ed|e)?d?/i.test(
    body
  );
}

function isTrustedGateAuthor(login) {
  return !!(login && TRUSTED_GATE_LOGINS.has(login));
}

/**
 * Critic decision from a comment/review body.
 * Fail beats pass: CHANGES REQUIRED wins over APPROVE in the same body.
 * Accepts CHANGES REQUIRED / CHANGES REQUESTED / CHANGES_REQUESTED (case-insensitive).
 */
function criticDecision(body) {
  if (!body) return null;
  // Fail beats pass: CHANGES REQUIRED / CHANGES REQUESTED / CHANGES_REQUESTED
  // wins over APPROVE in the same body (case-insensitive; COMMENT OK).
  const changesHit =
    /(?:##\s*)?critic\s*:?\s*changes[_\s-]*(?:required|requested)|critic[\s\S]{0,120}changes[_\s-]*(?:required|requested)/i.test(
      body
    );
  const approveHit =
    /(?:##\s*)?critic\s*:?\s*approve|critic[\s\S]{0,120}approve/i.test(body);

  if (changesHit) return 'CHANGES_REQUIRED';
  if (approveHit) return 'APPROVE';
  return null;
}

/**
 * Shield decision. BLOCK beats CLEAR in the same body.
 */
function shieldDecision(body) {
  if (!body) return null;
  const block = near('shield', 'block', body);
  const clear = near('shield', 'clear', body);
  if (block) return 'BLOCK';
  if (clear) return 'CLEAR';
  return null;
}

/**
 * Probe decision. VERIFY FAIL beats VERIFY PASS in the same body.
 * Requires Probe near the verify token (not bare "verify pass/fail" alone).
 */
function probeDecision(body) {
  if (!body) return null;
  const fail =
    /\bprobe\b[\s\S]{0,120}verify\s+fail|verify\s+fail[\s\S]{0,120}\bprobe\b/i.test(body);
  const pass =
    /\bprobe\b[\s\S]{0,120}verify\s+pass|verify\s+pass[\s\S]{0,120}\bprobe\b/i.test(body);
  if (fail) return 'VERIFY_FAIL';
  if (pass) return 'VERIFY_PASS';
  return null;
}

function hasCarveOutApprove(body) {
  return /carve-out\s+approve/i.test(body);
}

/**
 * Collect latest tip-bound Critic / Shield / Probe decisions from trusted authors.
 *
 * @param {{ headSha: string, items: Array<{ body?: string, login?: string, createdAt?: string|number, commitId?: string|null, reviewState?: string|null }> }} input
 * @returns {{ critic: string|null, shield: string|null, probe: string|null, carveOwnerOk: boolean, allowMerge: boolean, reasons: string[] }}
 */
function evaluateTipBoundSignals({ headSha, items }) {
  const criticEvents = [];
  const shieldEvents = [];
  const probeEvents = [];
  let carveOwnerOk = false;
  const reasons = [];

  for (const item of items || []) {
    const body = item.body || '';
    const login = item.login;
    const at = new Date(item.createdAt || 0).getTime();
    const onTipByCommit =
      item.commitId &&
      (item.commitId === headSha ||
        headSha.startsWith(item.commitId) ||
        item.commitId.startsWith(headSha.slice(0, 7)));

    // Formal GitHub CHANGES_REQUESTED on this tip counts even without SHA in body.
    if (
      item.reviewState === 'CHANGES_REQUESTED' &&
      onTipByCommit &&
      isTrustedGateAuthor(login)
    ) {
      criticEvents.push({ decision: 'CHANGES_REQUIRED', at, login });
    }

    if (!body || !isTrustedGateAuthor(login) || !shaInBody(body, headSha)) continue;

    const critic = criticDecision(body);
    if (critic) criticEvents.push({ decision: critic, at, login });

    const shield = shieldDecision(body);
    if (shield) shieldEvents.push({ decision: shield, at, login });

    const probe = probeDecision(body);
    if (probe) probeEvents.push({ decision: probe, at, login });

    if (login === OWNER_LOGIN && hasCarveOutApprove(body)) carveOwnerOk = true;
  }

  const latest = (events) => {
    if (!events.length) return null;
    events.sort((a, b) => a.at - b.at);
    return events[events.length - 1].decision;
  };

  const critic = latest(criticEvents);
  const shield = latest(shieldEvents);
  const probe = latest(probeEvents);

  if (!critic || critic !== 'APPROVE') {
    reasons.push(
      critic
        ? `latest tip-bound Critic decision is ${critic} (not APPROVE)`
        : 'no tip-bound Critic APPROVE from trusted author'
    );
  }
  if (!shield || shield !== 'CLEAR') {
    reasons.push(
      shield
        ? `latest tip-bound Shield decision is ${shield} (not CLEAR)`
        : 'no tip-bound Shield CLEAR from trusted author'
    );
  }
  if (!probe || probe !== 'VERIFY_PASS') {
    reasons.push(
      probe
        ? `latest tip-bound Probe decision is ${probe} (not VERIFY PASS)`
        : 'no tip-bound Probe VERIFY PASS from trusted author'
    );
  }

  return {
    critic,
    shield,
    probe,
    carveOwnerOk,
    allowMerge: reasons.length === 0,
    reasons,
  };
}

module.exports = {
  OWNER_LOGIN,
  TRUSTED_GATE_LOGINS,
  PROXIMITY,
  shaInBody,
  isGateSignalBody,
  isTrustedGateAuthor,
  criticDecision,
  shieldDecision,
  probeDecision,
  hasCarveOutApprove,
  evaluateTipBoundSignals,
};
