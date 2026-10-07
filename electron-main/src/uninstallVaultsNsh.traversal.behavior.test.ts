import { describe, it, expect } from 'vitest';

import { loadUninstallVaultsNsh, resolveUninstallVaultsNshPath } from './uninstallVaultsNsh.path.js';

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
  mutantXF1_gotoIncLine79,
  mutantXF2_gotoIncLine80,
  mutantXF3_gotoIncLine85,
  mutantXF4_gotoIncLine86,
  mutantXF5_gotoIncLine75,
  mutantXF6_gotoIncLine81,
  mutantXB7_gotoIncLine65,
  mutantMB5a_neutralizeLine78,
  mutantMB6a_neutralizeLine84,
  assertTraversalFileLinePins,
} from './sidecarTraversalScan.harness.js';

export { loadUninstallVaultsNsh, resolveUninstallVaultsNshPath };

const REJECTED_TRAV_PATHS = [
  'C:\\vault\\.\\note',
  'C:\\vault\\..\\note',
  'C:/vault/./note',
  'C:/vault/../note',
  'C:/vault/.',
  'C:/vault/..',
  String.raw`C:/vault/.\note`,
  String.raw`C:/vault/..\note`,
  '...\\Documents\\..\\..\\Windows',
];

const ALLOWED_TRAV_PATHS = ['C:\\Users\\me\\Mythos Writer\\vaults\\x', 'D:/data/vault'];

describe('sidecar traversal + WINDIR deny behaviour (reads build/uninstall-vaults.nsh from disk)', () => {
  it('pins each traversal branch reject in nsh context', () => {
    assertTraversalBranchBehaviourPins(loadUninstallVaultsNsh());
    assertTraversalFileLinePins(loadUninstallVaultsNsh());
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

    it('X-F1: ./ reject at line 79 fails file line pins', () => {
      expectBranchPinFails(mutantXF1_gotoIncLine79(loadUninstallVaultsNsh()));
    });

    it('X-F2: /.\\ reject at line 80 fails file line pins', () => {
      expectBranchPinFails(mutantXF2_gotoIncLine80(loadUninstallVaultsNsh()));
    });

    it('X-F3: ../ reject at line 85 fails file line pins', () => {
      expectBranchPinFails(mutantXF3_gotoIncLine85(loadUninstallVaultsNsh()));
    });

    it('X-F4: /..\\ reject at line 86 fails file line pins', () => {
      expectBranchPinFails(mutantXF4_gotoIncLine86(loadUninstallVaultsNsh()));
    });

    it('X-F5: forward dot check at line 75 fails file line pins', () => {
      expectBranchPinFails(mutantXF5_gotoIncLine75(loadUninstallVaultsNsh()));
    });

    it('X-F6: forward second dot check at line 81 fails file line pins', () => {
      expectBranchPinFails(mutantXF6_gotoIncLine81(loadUninstallVaultsNsh()));
    });

    it('X-B7: backslash second dot check at line 65 fails file line pins', () => {
      expectBranchPinFails(mutantXB7_gotoIncLine65(loadUninstallVaultsNsh()));
    });

    it('MB5a: forward /. end-of-path empty reject at line 78 fails pins', () => {
      expectBranchPinFails(mutantMB5a_neutralizeLine78(loadUninstallVaultsNsh()));
    });

    it('MB6a: forward /.. end-of-path empty reject at line 84 fails pins', () => {
      expectBranchPinFails(mutantMB6a_neutralizeLine84(loadUninstallVaultsNsh()));
    });
  });
});
