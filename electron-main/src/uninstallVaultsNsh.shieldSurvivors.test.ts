import { describe, expect, it } from 'vitest';

import { sidecarGuardModeTwoFailure } from './sidecarOracleMutants.test-helpers.js';
import {
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
  { name: ':167 else +6', line: 167, text: 'StrCmp $4 "\\" 0 +6', rowNeedle: 'Desk prefix' },
  {
    name: ':167 else mythos_al_not_desktop',
    line: 167,
    text: 'StrCmp $4 "\\" 0 mythos_al_not_desktop',
    rowNeedle: 'Desk prefix',
  },
  {
    name: ':167 else mythos_al_deny',
    line: 167,
    text: 'StrCmp $4 "\\" 0 mythos_al_deny',
    rowNeedle: 'Desk prefix',
  },
  {
    name: ':299 Goto mythos_trim_chop (a3719f95 :220)',
    line: 299,
    text: 'Goto mythos_trim_chop',
    rowNeedle: 'one act per sidecar file line',
  },
];

describe('Shield 5462286933 four sweep survivors', () => {
  it('canonical still deletes the Desk-prefix Desktop vault and the one-act file', () => {
    expect(fileLines[166]!.trim()).toBe('StrCmp $4 "\\" 0 mythos_al_not_documents');
    expect(fileLines[298]!.trim()).toBe('Goto uninstall_vault_read');
    expect(SIDECAR_RF7_SHIELD_SURVIVOR_ROWS).toHaveLength(2);
    expect(SIDECAR_RF7_DESK_PREFIX_DESKTOP_VAULT).toBe('C:\\Users\\me\\Desktop\\MyVault\\x');
    expect(SIDECAR_RF7_ONE_ACT_FILE_PATH).toBe('C:\\Users\\me\\Documents\\note.txt');
    expect(() => assertSidecarRf7ShieldSurvivorTables(nsh)).not.toThrow();
  });

  for (const spec of RF7_SHIELD_SURVIVOR_MUTANTS) {
    it(`${spec.name} dies pin-free on a behavioural row`, () => {
      const mutant = withFileLine(spec.line, spec.text);
      const failure = sidecarGuardModeTwoFailure(mutant, nsh);
      expect(failure, spec.name).toBeDefined();
      expect(failure, spec.name).toMatch(/RF-7 Shield survivor parity/);
      expect(failure, spec.name).toMatch(new RegExp(spec.rowNeedle));
      expect(failure, spec.name).not.toMatch(/unsupported|markers missing/);
    });
  }
});
