// PLANT for #1805's red-then-green proof. Removed in a later commit.
// Leaves one mythos-test-<run>-* directory in tmpdir, so the frontend
// guard-only globalSetup must fail the run with "mythos-test guard leak".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

it('C1 plant: leaves a run-prefixed temp dir behind', () => {
  const run = process.env.MYTHOS_TEST_RUN_ID;
  expect(run).toMatch(/^[0-9a-f]{8}$/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mythos-test-${run}-c1plant-`));
  expect(fs.existsSync(dir)).toBe(true);
});
