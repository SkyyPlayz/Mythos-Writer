import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import {
  assertTraversalBranchBehaviourPins,
  assertWindirProgramFilesDenyBehaviourPins,
  mythosPrefixDenyOutcome,
  mythosTravScanOutcome,
  mutantMB1_neutralizeBackslashDotBackslashReject,
  mutantMB2_neutralizeBackslashDotDotBackslashReject,
  mutantMB3_deleteBackslashDotDotRejectPair,
  mutantMB4_neutralizeAllBackslashTravRejects,
  mutantMB5_neutralizeBackslashDotCheck,
  mutantMB6_neutralizeForwardSlashTravRejects,
  mutantWindirDenyDrop,
  mutantProgramFilesDenyDrop,
  mutantProgramFiles64DenyDrop,
} from './sidecarTraversalScan.harness.js';

export const UNINSTALL_VAULTS_NSH_PATH = resolve(process.cwd(), '../build/uninstall-vaults.nsh');

export function loadUninstallVaultsNsh(): string {
  return readFileSync(UNINSTALL_VAULTS_NSH_PATH, 'utf-8');
}

const REJECTED_TRAV_PATHS = [
  'C:\\vault\\.\\note',
  'C:\\vault\\..\\note',
  'C:/vault/./note',
  'C:/vault/../note',
  '...\\Documents\\..\\..\\Windows',
];

const ALLOWED_TRAV_PATHS = ['C:\\Users\\me\\Mythos Writer\\vaults\\x', 'D:/data/vault'];

describe('sidecar traversal + WINDIR deny behaviour (reads build/uninstall-vaults.nsh from disk)', () => {
  it('pins each traversal branch reject in nsh context', () => {
    assertTraversalBranchBehaviourPins(loadUninstallVaultsNsh());
  });

  it('simulator rejects traversal sidecar lines', () => {
    for (const path of REJECTED_TRAV_PATHS) {
      expect(mythosTravScanOutcome(path)).toBe('vault_read');
    }
    for (const path of ALLOWED_TRAV_PATHS) {
      expect(mythosTravScanOutcome(path)).toBe('trav_ok');
    }
  });

  it('pins WINDIR / PROGRAMFILES / PROGRAMFILES64 StrCmp uninstall_vault_read denies', () => {
    assertWindirProgramFilesDenyBehaviourPins(loadUninstallVaultsNsh());
    const prefixes = ['C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)'];
    for (const path of [
      'C:\\Windows\\System32',
      'C:\\Program Files\\Foo',
      'C:\\Program Files (x86)\\Bar',
    ]) {
      expect(mythosPrefixDenyOutcome(path, prefixes)).toBe('vault_read');
    }
    expect(mythosPrefixDenyOutcome('C:\\Users\\vault', prefixes)).toBe('allowlist_continue');
  });

  describe('in-memory traversal / allowlist mutants (must fail branch pins)', () => {
    const expectBranchPinFails = (mutant: string): void => {
      expect(() => assertTraversalBranchBehaviourPins(mutant)).toThrow();
    };
    const expectWindirPinFails = (mutant: string): void => {
      expect(() => assertWindirProgramFilesDenyBehaviourPins(mutant)).toThrow();
    };

    it('M-B1: neutralize .\\ backslash reject fails branch pins', () => {
      expectBranchPinFails(mutantMB1_neutralizeBackslashDotBackslashReject(loadUninstallVaultsNsh()));
    });

    it('M-B2: neutralize ..\\ backslash reject fails branch pins', () => {
      expectBranchPinFails(mutantMB2_neutralizeBackslashDotDotBackslashReject(loadUninstallVaultsNsh()));
    });

    it('M-B3: delete .. reject pair fails branch pins', () => {
      expectBranchPinFails(mutantMB3_deleteBackslashDotDotRejectPair(loadUninstallVaultsNsh()));
    });

    it('M-B4: neutralize all backslash traversal rejects fails branch pins', () => {
      expectBranchPinFails(mutantMB4_neutralizeAllBackslashTravRejects(loadUninstallVaultsNsh()));
    });

    it('M-B5: neutralize backslash dot check fails branch pins', () => {
      expectBranchPinFails(mutantMB5_neutralizeBackslashDotCheck(loadUninstallVaultsNsh()));
    });

    it('M-B6: neutralize forward-slash traversal rejects fails branch pins', () => {
      expectBranchPinFails(mutantMB6_neutralizeForwardSlashTravRejects(loadUninstallVaultsNsh()));
    });

    it('M-B-WINDIR: drop $WINDIR deny fails allowlist pins', () => {
      expectWindirPinFails(mutantWindirDenyDrop(loadUninstallVaultsNsh()));
    });

    it('M-B-PROGRAMFILES: drop $PROGRAMFILES deny fails allowlist pins', () => {
      expectWindirPinFails(mutantProgramFilesDenyDrop(loadUninstallVaultsNsh()));
    });

    it('M-B-PROGRAMFILES64: drop $PROGRAMFILES64 deny fails allowlist pins', () => {
      expectWindirPinFails(mutantProgramFiles64DenyDrop(loadUninstallVaultsNsh()));
    });
  });
});
