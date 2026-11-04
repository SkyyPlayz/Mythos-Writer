// PLANT for #1805's red-then-green proof. Removed in a later commit.
// Appends to build/uninstall-vaults.nsh, so the electron-main uninstall-nsh
// integrity guard (composed in tmp-guard.setup.mjs) must fail the run.
import { appendFileSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { defaultUninstallVaultsNshPath } from './uninstallVaultsNsh.path.js';

it('C1 plant: mutates the build uninstall-vaults.nsh', () => {
  const file = defaultUninstallVaultsNshPath();
  appendFileSync(file, '\n; c1 plant\n', 'utf-8');
  expect(readFileSync(file, 'utf-8')).toContain('; c1 plant');
});
