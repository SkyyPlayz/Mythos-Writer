import { describe, expect, it } from 'vitest';

import {
  assertSidecarRf7ShieldSurvivorSweepParity,
  assertSidecarRf7ShieldSurvivorTables,
  SIDECAR_RF7_DESK_PREFIX_DESKTOP_VAULT,
  SIDECAR_RF7_ONE_ACT_FILE_PATH,
  SIDECAR_RF7_SHIELD_SURVIVOR_ROWS,
} from './sidecarTraversalScan.test-helpers.js';
import { loadUninstallVaultsNsh } from './uninstallVaultsNsh.path.js';

const nsh = loadUninstallVaultsNsh();
const fileLines = nsh.split('\n');

function withFileLine(line: number, text: string): string {
  const next = [...fileLines];
  const indent = next[line - 1]!.match(/^\s*/)?.[0] ?? '';
  next[line - 1] = `${indent}${text}`;
  return next.join('\n');
}

/** Shield 5462286933 four pin-free survivors (a3719f95 :167 ×3, :220). */
export const RF7_SHIELD_SURVIVOR_MUTANTS: readonly {
  name: string;
  line: number;
  text: string;
  rowNeedle: string;
}[] = [
  { name: ':206 else +6', line: 206, text: 'StrCmp $4 "\\" 0 +6', rowNeedle: 'Desk prefix' },
  {
    name: ':206 else mythos_al_not_desktop',
    line: 206,
    text: 'StrCmp $4 "\\" 0 mythos_al_not_desktop',
    rowNeedle: 'Desk prefix',
  },
  {
    name: ':206 else mythos_al_deny',
    line: 206,
    text: 'StrCmp $4 "\\" 0 mythos_al_deny',
    rowNeedle: 'Desk prefix',
  },
  {
    name: ':376 Goto mythos_trim_chop (a3719f95 :220)',
    line: 376,
    text: 'Goto mythos_trim_chop',
    rowNeedle: 'one act per sidecar file line',
  },
];

describe('Shield 5462286933 four sweep survivors', () => {
  it('canonical still deletes the Desk-prefix Desktop vault and the one-act file', () => {
    const documentsSep = fileLines.findIndex((l) => l.trim() === 'StrCmp $4 "\\" 0 mythos_al_not_documents');
    expect(documentsSep + 1).toBe(206);
    expect(fileLines[documentsSep]!.trim()).toBe('StrCmp $4 "\\" 0 mythos_al_not_documents');
    expect(fileLines[375]!.trim()).toBe('Goto uninstall_vault_read');
    expect(SIDECAR_RF7_SHIELD_SURVIVOR_ROWS).toHaveLength(2);
    expect(SIDECAR_RF7_DESK_PREFIX_DESKTOP_VAULT).toBe('C:\\Users\\me\\Desktop\\MyVault\\x');
    expect(SIDECAR_RF7_ONE_ACT_FILE_PATH).toBe('C:\\Users\\me\\Documents\\note.txt');
    expect(() => assertSidecarRf7ShieldSurvivorTables(nsh)).not.toThrow();
  });

  for (const spec of RF7_SHIELD_SURVIVOR_MUTANTS) {
    it(`${spec.name} dies pin-free on a behavioural row`, () => {
      const mutant = withFileLine(spec.line, spec.text);
      expect(() => assertSidecarRf7ShieldSurvivorSweepParity(mutant, nsh)).toThrow(
        new RegExp(`RF-7 Shield survivor parity.*${spec.rowNeedle}`),
      );
    });
  }
});
