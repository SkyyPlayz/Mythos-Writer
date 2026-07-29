#!/usr/bin/env node
// Unit tests for the SKY-8741 dedupe-key fix: a recurring failure that spans
// multiple days must produce the SAME dedupe key, so runs on different dates
// collapse into one ticket instead of spraying a new one per day.
// Run directly: node .github/scripts/issue-finder.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { fingerprint, dedupeKey } = require('./issue-finder.js');

test('dedupeKey collapses the same failure fingerprinted on different dates', () => {
  const jobs = ['unit-tests', 'lint'];
  const runDay1 = { created_at: '2026-07-21T03:00:00Z', head_branch: 'main', pull_requests: [] };
  const runDay2 = { created_at: '2026-07-22T03:00:00Z', head_branch: 'main', pull_requests: [] };

  const titleDay1 = fingerprint(runDay1, jobs);
  const titleDay2 = fingerprint(runDay2, jobs);

  // Titles still differ — they embed the date for humans reading the ticket...
  assert.notEqual(titleDay1, titleDay2);
  // ...but the dedupe key must be identical across dates, otherwise the same
  // recurring failure sprays a new ticket every day it happens.
  assert.equal(dedupeKey(titleDay1), dedupeKey(titleDay2));
});

test('dedupeKey collapses the zero-jobs "failed before any job started" case across dates', () => {
  const runDay1 = { created_at: '2026-07-21T03:00:00Z', head_branch: 'main', pull_requests: [] };
  const runDay2 = { created_at: '2026-08-01T03:00:00Z', head_branch: 'main', pull_requests: [] };

  const titleDay1 = fingerprint(runDay1, []);
  const titleDay2 = fingerprint(runDay2, []);

  assert.equal(dedupeKey(titleDay1), dedupeKey(titleDay2));
});

test('dedupeKey still distinguishes genuinely different failures', () => {
  const run = { created_at: '2026-07-21T03:00:00Z', head_branch: 'main', pull_requests: [] };
  const titleUnitTests = fingerprint(run, ['unit-tests']);
  const titleLint = fingerprint(run, ['lint']);

  assert.notEqual(dedupeKey(titleUnitTests), dedupeKey(titleLint));
});

test('dedupeKey matches a stored GitHub issue title from an earlier date', () => {
  // Simulates: an issue was filed yesterday with today's title format, and a
  // fresh run today re-fingerprints the same underlying failure.
  const storedIssueTitle = '[auto-found] Fuzz failure 2026-07-20 · main (PR #42) · lint, unit-tests';
  const freshRun = { created_at: '2026-07-29T09:00:00Z', head_branch: 'main', pull_requests: [{ number: 42 }] };
  const freshTitle = fingerprint(freshRun, ['lint', 'unit-tests']);

  assert.equal(dedupeKey(storedIssueTitle), dedupeKey(freshTitle));
});
