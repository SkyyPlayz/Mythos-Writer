import { describe, it, expect } from 'vitest';

import { loadUninstallVaultsNsh, resolveUninstallVaultsNshPath } from './uninstallVaultsNsh.path.js';

import {
  assertTraversalBranchBehaviourPins,
  assertSidecarGuardRegionExact,
  assertSidecarGuardRejectAllowTables,
  assertTraversalRejectAllowTables,
  assertDenyPrefixRejectAllowTables,
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
  assertTraversalScanBlockExact,
  mutantN1_forwardSlashCheckPipe,
  mutantN2_intOpLine58Plus2,
  mutantN3_intOpLine73Plus2,
  mutantF11_strcpy4Windir,
  mutantF11_strcpy4ProgramFiles,
  mutantF11_strcpy4ProgramFiles64,
  mutantE58_intOpFirstPlus1,
  mutantE59_strcpyUse7,
  mutantE61_intOp8Plus1,
  mutantE62_strcpySecondUse7,
  mutantE67_intOp8Plus1Second,
  mutantE74_strcpyFwdBranch,
  mutantE77_intOpFwdInner,
  mutantE83_strcpyFwdInner,
  mutantU1_intOp58Plus2,
  mutantU3_disableEmptyEndCheck,
  mutantU4_strcpy4Uses8,
  mutantU5_forwardSlashPipe,
  mutantU6_strcpy7PastEnd,
  mutantU7_intOp7Plus3,
} from './sidecarTraversalScan.test-helpers.js';

export { loadUninstallVaultsNsh, resolveUninstallVaultsNshPath };

describe('sidecar traversal + WINDIR deny behaviour (reads build/uninstall-vaults.nsh from disk)', () => {
  it('pins sidecar guard region :43-:126 (read/trim + traversal + deny + M5)', () => {
    const nsh = loadUninstallVaultsNsh();
    assertTraversalBranchBehaviourPins(nsh);
    assertSidecarGuardRegionExact(nsh);
    assertTraversalScanBlockExact(nsh);
  });

  it('VM reject/allow tables from pinned :43-:126 region (read/trim + traversal + deny + APPDATA M5)', () => {
    assertSidecarGuardRejectAllowTables(loadUninstallVaultsNsh());
  });

  describe('in-memory traversal / allowlist mutants (must fail branch pins)', () => {
    const expectBranchPinFails = (mutant: string): void => {
      expect(() => assertTraversalBranchBehaviourPins(mutant)).toThrow();
    };
    const expectRegionPinFails = (mutant: string): void => {
      expect(() => assertSidecarGuardRegionExact(mutant)).toThrow();
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

    it('M-B-WINDIR: drop $WINDIR deny fails region pin', () => {
      expectRegionPinFails(mutantWindirDenyDrop(loadUninstallVaultsNsh()));
    });

    it('M-B-PROGRAMFILES: drop $PROGRAMFILES deny fails region pin', () => {
      expectRegionPinFails(mutantProgramFilesDenyDrop(loadUninstallVaultsNsh()));
    });

    it('M-B-PROGRAMFILES64: drop $PROGRAMFILES64 deny fails region pin', () => {
      expectRegionPinFails(mutantProgramFiles64DenyDrop(loadUninstallVaultsNsh()));
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

    it('N1: line 72 `/` check -> `|` fails block pins and traversal table', () => {
      const mutant = mutantN1_forwardSlashCheckPipe(loadUninstallVaultsNsh());
      expectBranchPinFails(mutant);
      expect(() => assertTraversalRejectAllowTables(mutant)).toThrow();
    });

    it('N2: line 58 IntOp +2 fails block pins', () => {
      expectBranchPinFails(mutantN2_intOpLine58Plus2(loadUninstallVaultsNsh()));
    });

    it('N3: line 73 IntOp +2 fails block pins', () => {
      expectBranchPinFails(mutantN3_intOpLine73Plus2(loadUninstallVaultsNsh()));
    });

    it('E-58: first IntOp $8 $7 + 1 fails block pins', () => {
      expectBranchPinFails(mutantE58_intOpFirstPlus1(loadUninstallVaultsNsh()));
    });

    it('E-59: StrCpy $8->$7 fails block pins and traversal table', () => {
      const mutant = mutantE59_strcpyUse7(loadUninstallVaultsNsh());
      expectBranchPinFails(mutant);
      expect(() => assertTraversalRejectAllowTables(mutant)).toThrow();
    });

    it('E-61: inner IntOp $8 $8 + 1 fails block pins', () => {
      expectBranchPinFails(mutantE61_intOp8Plus1(loadUninstallVaultsNsh()));
    });

    it('E-62: inner StrCpy index fails block pins', () => {
      expectBranchPinFails(mutantE62_strcpySecondUse7(loadUninstallVaultsNsh()));
    });

    it('E-67: nested IntOp $8 $8 + 1 fails block pins', () => {
      expectBranchPinFails(mutantE67_intOp8Plus1Second(loadUninstallVaultsNsh()));
    });

    it('E-74: forward-branch StrCpy index fails block pins', () => {
      expectBranchPinFails(mutantE74_strcpyFwdBranch(loadUninstallVaultsNsh()));
    });

    it('E-77: forward inner IntOp fails block pins', () => {
      expectBranchPinFails(mutantE77_intOpFwdInner(loadUninstallVaultsNsh()));
    });

    it('E-83: forward nested StrCpy fails block pins', () => {
      expectBranchPinFails(mutantE83_strcpyFwdInner(loadUninstallVaultsNsh()));
    });

    it('U1: :58 IntOp +2 fails block pins', () => {
      expectBranchPinFails(mutantU1_intOp58Plus2(loadUninstallVaultsNsh()));
    });

    it('U3: :56 scan end check disabled fails block pins and reject table', () => {
      const mutant = mutantU3_disableEmptyEndCheck(loadUninstallVaultsNsh());
      expectBranchPinFails(mutant);
      expect(() => assertTraversalRejectAllowTables(mutant)).toThrow();
    });

    it('U4: :55 StrCpy $8 fails block pins', () => {
      expectBranchPinFails(mutantU4_strcpy4Uses8(loadUninstallVaultsNsh()));
    });

    it('U5: :72 forward `/` pipe fails block pins and traversal table', () => {
      const mutant = mutantU5_forwardSlashPipe(loadUninstallVaultsNsh());
      expectBranchPinFails(mutant);
      expect(() => assertTraversalRejectAllowTables(mutant)).toThrow();
    });

    it('U6: :53 StrCpy $7 past end fails block pins', () => {
      expectBranchPinFails(mutantU6_strcpy7PastEnd(loadUninstallVaultsNsh()));
    });

    it('U7: :88 IntOp $7 +3 fails block pins', () => {
      expectBranchPinFails(mutantU7_intOp7Plus3(loadUninstallVaultsNsh()));
    });

    it('F11: :92 StrCpy $1 1 breaks region pin and deny-prefix table', () => {
      const mutant = mutantF11_strcpy4Windir(loadUninstallVaultsNsh());
      expectRegionPinFails(mutant);
      expect(() => assertDenyPrefixRejectAllowTables(mutant)).toThrow();
    });

    it('F11: :95 StrCpy $1 1 breaks region pin', () => {
      expectRegionPinFails(mutantF11_strcpy4ProgramFiles(loadUninstallVaultsNsh()));
    });

    it('F11: :98 StrCpy $1 1 breaks region pin', () => {
      expectRegionPinFails(mutantF11_strcpy4ProgramFiles64(loadUninstallVaultsNsh()));
    });
  });
});
