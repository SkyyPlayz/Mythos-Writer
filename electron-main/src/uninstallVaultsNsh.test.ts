import { describe, it, expect } from 'vitest';

import { loadUninstallVaultsNsh } from './uninstallVaultsNsh.path.js';

import {
  APP_CACHE_DIRS,
  APP_CACHE_FILES,
  APP_USER_DIRS,
  APP_USER_FILES,
  UNINSTALL_DELETE_PATHS_FILENAME,
} from './appUserDataManifest.js';
import {
  assertAllowlistDenySkipsSidecarLine,
  assertDefaultVaultsFallbackRmdir,
  assertDeleteVaultsSectionOffByDefault,
  assertKeepBranchInsertsCacheMacroOnly,
  assertKeepElseEndIfInsertsOnlyAppCachesMacro,
  assertNoExecutableMessageBox,
  assertUninstallerCheckboxSectionTokens,
  MYTHOS_DELETE_VAULTS_SECTION_O_LINE,
  assertRemoveAllDeletesStrictlyBetweenSectionIfAndElse,
  assertSidecarAllowlistBeforeDelete,
  assertSidecarDeleteAfterFileOpenAndClose,
  assertSettingsJsonDeletesOnRemoveAllNotKeep,
  assertTraversalRejectedBeforeSidecarDelete,
  assertTraversalThenAllowlistThenSidecarDelete,
  DELETE_APP_SETTINGS_JSON,
  DELETE_VAULT_SETTINGS_JSON,
  nshMacroBody,
  assertAppDataMythosWriterRootSelfMatchGuard,
  assertMythosRmdirUnlessReparseHelper,
  assertShellVarContextCurrentThenRestorePrevious,
  assertSidecarReparseWalkBeforeDelete,
  assertWildcardAndControlCharReject,
  mutantM5_dropAppDataRootSelfMatch,
  MYTHOS_RMDIR_UNLESS_REPARSE_APPDATA,
  MYTHOS_RMDIR_UNLESS_REPARSE_VAULTS,
} from './uninstallVaultsNsh.test-helpers.js';

const NSH = loadUninstallVaultsNsh();

function expectPinFails(mutant: string, pin: (src: string) => void, message: RegExp): void {
  expect(() => pin(mutant)).toThrow(message);
}

function expectPinFailsOnCustomUnInstall(
  mutantNsh: string,
  pin: (body: string) => void,
  message: RegExp,
): void {
  const body = nshMacroBody(mutantNsh, 'customUnInstall');
  expect(() => pin(body)).toThrow(message);
}

describe('build/uninstall-vaults.nsh token contract', () => {
  const customUnInstall = () => nshMacroBody(NSH, 'customUnInstall');

  it('ships pre-Uninstall checkbox page (customUnInstallSection + Section /o)', () => {
    expect(NSH).toContain('!macro customUnInstallSection');
    expect(NSH).toMatch(/Section\s+\/o\s+"un\.Also delete my Mythos vaults \/ writing data"/);
    expect(NSH).toContain('SEC_DELETE_MYTHOS_VAULTS');
    expect(NSH).toContain('SectionIsSelected');
    expect(NSH).toContain('!ifdef BUILD_UNINSTALLER');
    assertUninstallerCheckboxSectionTokens(NSH);
    expect(NSH).toContain(MYTHOS_DELETE_VAULTS_SECTION_O_LINE);
  });

  it('(1) delete-vaults section is Section /o — off by default (MW-delete-vault)', () => {
    assertDeleteVaultsSectionOffByDefault(NSH);
  });

  it('(2) SectionIsSelected gate — Remove-all deletes only between If and Else (Critic H4)', () => {
    const body = customUnInstall();
    const gate = '${If} ${SectionIsSelected} ${SEC_DELETE_MYTHOS_VAULTS}';
    expect(body).toContain(gate);
    expect(body.indexOf('FileOpen $0 "$APPDATA\\Mythos Writer\\uninstall-delete-paths.txt"')).toBeGreaterThan(
      body.indexOf(gate),
    );
    expect(body.indexOf('!insertmacro mythos_delete_remove_all_user_data')).toBeGreaterThan(
      body.indexOf(gate),
    );
    expect(body.indexOf(MYTHOS_RMDIR_UNLESS_REPARSE_VAULTS)).toBeGreaterThan(body.indexOf(gate));
    expect(body.indexOf(MYTHOS_RMDIR_UNLESS_REPARSE_APPDATA)).toBeGreaterThan(body.indexOf(gate));
    assertRemoveAllDeletesStrictlyBetweenSectionIfAndElse(body, NSH);
  });

  it('Remove-all gate deletes *-settings.json; KEEP branch does not (Ivy)', () => {
    const body = customUnInstall();
    const gate = '${If} ${SectionIsSelected} ${SEC_DELETE_MYTHOS_VAULTS}';
    const elseAt = body.indexOf('${Else}');
    const removeAllRegion = body.slice(body.indexOf(gate), elseAt);
    expect(removeAllRegion).toContain('!insertmacro mythos_delete_remove_all_user_data');
    expect(NSH).toContain(DELETE_VAULT_SETTINGS_JSON);
    expect(NSH).toContain(DELETE_APP_SETTINGS_JSON);
    const keepRegion = body.slice(elseAt);
    expect(keepRegion).not.toContain(DELETE_VAULT_SETTINGS_JSON);
    expect(keepRegion).not.toContain(DELETE_APP_SETTINGS_JSON);
    assertSettingsJsonDeletesOnRemoveAllNotKeep(NSH, body);
  });

  it('(3) default vaults/ fallback RMDir inside Remove-all gate', () => {
    const body = customUnInstall();
    expect(body).toContain(MYTHOS_RMDIR_UNLESS_REPARSE_VAULTS);
    assertDefaultVaultsFallbackRmdir(body);
  });

  it('(4) allowlist-then-traversal chain before sidecar RMDir "$3" (Critic H4)', () => {
    const executable = NSH.replace(/;[^\n]*/g, '');
    expect(executable.indexOf('uninstall_vault_trav_ok:')).toBeLessThan(executable.indexOf('StrCpy $5 "$WINDIR"'));
    expect(executable.indexOf('mythos_al_deny')).toBeLessThan(executable.indexOf('uninstall_vault_do_delete:'));
    expect(executable.indexOf('uninstall_vault_do_delete:')).toBeLessThan(executable.indexOf('RMDir /r "$3"'));
    assertTraversalThenAllowlistThenSidecarDelete(NSH);
    assertTraversalRejectedBeforeSidecarDelete(NSH);
    assertSidecarAllowlistBeforeDelete(NSH);
    assertAllowlistDenySkipsSidecarLine(NSH);
  });

  it('(5) KEEP branch cache-only — no Remove-all user macro (R-5 / Probe H-A)', () => {
    assertKeepBranchInsertsCacheMacroOnly(customUnInstall());
    assertRemoveAllDeletesStrictlyBetweenSectionIfAndElse(customUnInstall(), NSH);
  });

  it('(6) KEEP ${Else}..${EndIf} inserts only mythos_delete_app_caches (M13)', () => {
    const body = customUnInstall();
    const elseAt = body.indexOf('${Else}');
    const endIfAt = body.indexOf('${EndIf}', elseAt);
    expect(elseAt).toBeGreaterThan(-1);
    expect(endIfAt).toBeGreaterThan(elseAt);
    expect(body.slice(elseAt, endIfAt)).toContain('!insertmacro mythos_delete_app_caches');
    expect(body.slice(elseAt, endIfAt)).not.toContain('!insertmacro mythos_delete_remove_all_user_data');
    assertKeepElseEndIfInsertsOnlyAppCachesMacro(body);
  });

  it('ce96676c — settings/secrets only in remove-all macro, not cache macro', () => {
    const cacheMacro = nshMacroBody(NSH, 'mythos_delete_app_caches');
    const userMacro = nshMacroBody(NSH, 'mythos_delete_remove_all_user_data');
    expect(userMacro).toContain('brainstorm-settings.json');
    expect(userMacro).toContain('secrets.json');
    expect(cacheMacro).not.toContain('secrets.json');
    expect(cacheMacro).not.toContain('app-settings.json');
    expect(cacheMacro).not.toContain('vault-settings.json');
    expect(cacheMacro).not.toContain('templates');
    expect(cacheMacro).not.toContain('agent-personas');
  });

  it('default KEEP — no executable MessageBox / DEFBUTTON polarity on this tip', () => {
    const executable = NSH.replace(/;[^\n]*/g, '');
    expect(executable).not.toMatch(/\bMessageBox\b/);
    expect(executable).not.toContain('MB_DEFBUTTON1');
    expect(NSH).toMatch(/unchecked by default|KEEP/i);
    assertNoExecutableMessageBox(NSH);
  });

  it('names the sidecar file', () => {
    expect(NSH).toContain('uninstall-delete-paths.txt');
    expect(NSH).toContain(UNINSTALL_DELETE_PATHS_FILENAME);
  });

  it('FileOpens and FileReads the sidecar', () => {
    expect(NSH).toMatch(/\bFileOpen\b/);
    expect(NSH).toMatch(/\bFileRead\b/);
  });

  it('always falls back to default AppData vaults + both settings files', () => {
    expect(NSH).toContain(MYTHOS_RMDIR_UNLESS_REPARSE_VAULTS);
    expect(NSH).toContain(DELETE_VAULT_SETTINGS_JSON);
    expect(NSH).toContain(DELETE_APP_SETTINGS_JSON);
    assertSettingsJsonDeletesOnRemoveAllNotKeep(NSH, customUnInstall());
  });

  it('delete path only runs when checkbox section is selected', () => {
    expect(NSH).toMatch(/\$\{If\}\s+\$\{SectionIsSelected\}\s+\$\{SEC_DELETE_MYTHOS_VAULTS\}/);
    expect(NSH).toContain('${EndIf}');
  });

  it('re-checks sidecar lines with prefix + depth allowlist before RMDir', () => {
    const executable = NSH.replace(/;[^\n]*/g, '');
    expect(executable).toContain('$WINDIR');
    expect(executable).toContain('$PROGRAMFILES');
    expect(executable).toContain('$PROGRAMFILES64');
    expect(executable).toContain('$DOCUMENTS');
    expect(executable).toContain('$DESKTOP');
    expect(executable).toContain('$PROFILE\\Downloads');
    expect(executable).toContain('$APPDATA\\Mythos Writer');
    expect(executable).toContain('mythos_al_deny');
    expect(executable).toContain('uninstall_vault_do_delete');
    const denyAt = executable.indexOf('mythos_al_deny');
    const doDeleteAt = executable.indexOf('uninstall_vault_do_delete:');
    const sidecarRmAt = executable.indexOf('RMDir /r "$3"');
    expect(denyAt).toBeGreaterThan(-1);
    expect(doDeleteAt).toBeGreaterThan(denyAt);
    expect(sidecarRmAt).toBeGreaterThan(doDeleteAt);
    assertSidecarAllowlistBeforeDelete(NSH);
  });

  it('Remove-all user paths (manifest sync) only inside SectionIsSelected gate', () => {
    expect(NSH).toContain('!macro mythos_delete_remove_all_user_data');
    const body = customUnInstall();
    const vaultIfAt = body.indexOf('${If} ${SectionIsSelected} ${SEC_DELETE_MYTHOS_VAULTS}');
    const insertAt = body.indexOf('!insertmacro mythos_delete_remove_all_user_data');
    const elseAt = body.indexOf('${Else}', vaultIfAt);
    expect(insertAt).toBeGreaterThan(-1);
    expect(vaultIfAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(vaultIfAt);
    expect(insertAt).toBeLessThan(elseAt);
    for (const name of APP_USER_FILES) {
      expect(NSH).toContain(`Mythos Writer\\${name}`);
    }
    for (const name of APP_USER_DIRS) {
      expect(NSH).toContain(`Mythos Writer\\${name}`);
    }
  });

  it('PLAN-058 L8 / 00:46 — Remove all RMDirs entire Roaming Mythos Writer folder', () => {
    const executable = NSH.replace(/;[^\n]*/g, '');
    expect(executable).toContain(MYTHOS_RMDIR_UNLESS_REPARSE_APPDATA);
    const vaultIfAt = executable.indexOf('${If} ${SectionIsSelected} ${SEC_DELETE_MYTHOS_VAULTS}');
    const fullRmAt = executable.indexOf(MYTHOS_RMDIR_UNLESS_REPARSE_APPDATA);
    const endIfAt = executable.indexOf('${EndIf}', vaultIfAt);
    expect(vaultIfAt).toBeGreaterThan(-1);
    expect(fullRmAt).toBeGreaterThan(vaultIfAt);
    expect(fullRmAt).toBeLessThan(endIfAt);
  });

  it('rejects .. / . path segments before RMDir (Shield tip-3 traversal)', () => {
    const executable = NSH.replace(/;[^\n]*/g, '');
    expect(executable).toContain('mythos_trav_scan');
    expect(executable).toContain('uninstall_vault_trav_ok');
    const travAt = executable.indexOf('mythos_trav_scan');
    const travOkAt = executable.indexOf('uninstall_vault_trav_ok');
    const doDeleteAt = executable.indexOf('uninstall_vault_do_delete:');
    const sidecarRmAt = executable.indexOf('RMDir /r "$3"');
    expect(travAt).toBeGreaterThan(-1);
    expect(travOkAt).toBeGreaterThan(travAt);
    expect(doDeleteAt).toBeGreaterThan(travOkAt);
    expect(sidecarRmAt).toBeGreaterThan(doDeleteAt);
    expect(executable).toMatch(/StrCmp \$4 "\."/);
    assertTraversalRejectedBeforeSidecarDelete(NSH);
    assertAppDataMythosWriterRootSelfMatchGuard(NSH);
  });

  it('wraps uninstall deletes in ${IfNot} ${isUpdated} (upgrade must delete nothing)', () => {
    const body = customUnInstall();
    expect(body).toMatch(/\$\{IfNot\}\s+\$\{isUpdated\}/);
    const isUpdatedAt = body.indexOf('${IfNot} ${isUpdated}');
    const cacheInsert = body.indexOf('!insertmacro mythos_delete_app_caches');
    expect(isUpdatedAt).toBeGreaterThan(-1);
    expect(cacheInsert).toBeGreaterThan(isUpdatedAt);
  });

  it('KEEP path runs cache macro only inside isUpdated guard', () => {
    const body = customUnInstall();
    expect(body).toContain('!insertmacro mythos_delete_app_caches');
    expect(body).not.toContain('mythos_delete_app_private');
    const cacheMacro = nshMacroBody(NSH, 'mythos_delete_app_caches');
    for (const name of APP_CACHE_DIRS) {
      expect(cacheMacro).toContain(`Mythos Writer\\${name}`);
    }
    for (const name of APP_CACHE_FILES) {
      expect(cacheMacro).toContain(`Mythos Writer\\${name}`);
    }
    for (const name of APP_USER_DIRS) {
      expect(cacheMacro).not.toMatch(
        new RegExp(`RMDir /r "\\$APPDATA\\\\Mythos Writer\\\\${name}"`),
      );
    }
    for (const name of APP_USER_FILES) {
      expect(cacheMacro).not.toContain(`Mythos Writer\\${name}`);
    }
  });

  it('sidecar Delete runs after FileOpen and FileClose (Shield RF-1)', () => {
    assertSidecarDeleteAfterFileOpenAndClose(customUnInstall());
  });

  it('RF-7a: SetShellVarContext current then restore previous (installMode) on every exit', () => {
    assertShellVarContextCurrentThenRestorePrevious(NSH);
    const body = customUnInstall();
    expect(body.indexOf('SetShellVarContext current')).toBeLessThan(body.indexOf('${IfNot} ${isUpdated}'));
    expect(body).toContain('${If} $installMode == "all"');
    expect(body).toContain('SetShellVarContext all');
  });

  it('RF-7b / HARD-1 / HARD-2: walk, wildcard charset, nested-root guard', () => {
    assertSidecarReparseWalkBeforeDelete(NSH);
    assertMythosRmdirUnlessReparseHelper(NSH);
    assertWildcardAndControlCharReject(NSH);
  });

  it('mutant: sidecar Delete before FileOpen fails the ordering pin', () => {
    const body = customUnInstall();
    const fileOpenNeedle = 'FileOpen $0 "$APPDATA\\Mythos Writer\\uninstall-delete-paths.txt"';
    const mutant = body.replace(
      fileOpenNeedle,
      `Delete "$APPDATA\\Mythos Writer\\uninstall-delete-paths.txt"\n    ${fileOpenNeedle}`,
    );
    expect(() => assertSidecarDeleteAfterFileOpenAndClose(mutant)).toThrow(/before FileOpen/);
  });

  describe('mutants (must fail restored pins)', () => {
    it('M-A: section checked by default (remove /o) fails', () => {
      const mutant = NSH.replace(
        /Section\s+\/o\s+"un\.Also delete my Mythos vaults \/ writing data"/,
        'Section "un.Also delete my Mythos vaults / writing data"',
      );
      expectPinFails(mutant, assertDeleteVaultsSectionOffByDefault, /Section \/o/);
    });

    it('M5: drop APPDATA Mythos Writer root self-match guard fails (S8/S5)', () => {
      expectPinFails(
        mutantM5_dropAppDataRootSelfMatch(NSH),
        assertAppDataMythosWriterRootSelfMatchGuard,
        /M5|StrCmp \$1 \$5/,
      );
    });

    it('M-C: adding MessageBox or MB_DEFBUTTON1 fails', () => {
      const mutant = NSH.replace(
        '!macro customUnInstall',
        '!macro customUnInstall\n  MessageBox MB_OK "mutant"',
      );
      expectPinFails(mutant, assertNoExecutableMessageBox, /MessageBox/);
      const mutantDef = NSH.replace(
        '!macro customUnInstall',
        '!macro customUnInstall\n  MessageBox MB_OK|MB_DEFBUTTON1 "mutant"',
      );
      expectPinFails(mutantDef, assertNoExecutableMessageBox, /MessageBox|MB_DEFBUTTON1/);
    });

    it('M19: section checked by default (exact Section /o line removed) fails', () => {
      const mutant = NSH.replace('Section /o "un.Also delete my Mythos vaults / writing data"', 'Section "un.Also delete my Mythos vaults / writing data"');
      expectPinFails(mutant, assertDeleteVaultsSectionOffByDefault, /Section \/o/);
    });

    it('M23: dropping vaults/ fallback RMDir fails', () => {
      const mutant = NSH.replace(MYTHOS_RMDIR_UNLESS_REPARSE_VAULTS, '');
      expectPinFailsOnCustomUnInstall(mutant, assertDefaultVaultsFallbackRmdir, /vaults\/ fallback/);
      expectPinFailsOnCustomUnInstall(
        mutant,
        assertRemoveAllDeletesStrictlyBetweenSectionIfAndElse,
        /vaults/,
      );
    });

    it('M24: SectionIsSelected gate forced always-true (${If} 1 == 1) fails gate pin', () => {
      const body = customUnInstall();
      const gate = '${If} ${SectionIsSelected} ${SEC_DELETE_MYTHOS_VAULTS}';
      const mutantBody = body.replace(gate, '${If} 1 == 1');
      const mutantNsh = NSH.replace(body, mutantBody);
      expect(mutantBody).not.toContain(gate);
      expect(mutantBody).toContain('${If} 1 == 1');
      expectPinFailsOnCustomUnInstall(
        mutantNsh,
        assertRemoveAllDeletesStrictlyBetweenSectionIfAndElse,
        /SectionIsSelected|SEC_DELETE_MYTHOS_VAULTS/,
      );
      expect(NSH).toContain(gate);
    });

    it('M-D: allowlist deny -> allow (Goto do_delete) fails', () => {
      const mutant = NSH.replace(
        /mythos_al_deny:\s*\r?\n\s*Goto uninstall_vault_read/,
        'mythos_al_deny:\n        Goto uninstall_vault_do_delete',
      );
      expect(mutant).not.toBe(NSH);
      expectPinFails(mutant, assertAllowlistDenySkipsSidecarLine, /do_delete|uninstall_vault_read/);
    });

    it('RF-7a drop-restore: removing the installMode restore fails the context pin', () => {
      const mutant = NSH.replace(
        /\$\{If\} \$installMode == "all"\s*\r?\n\s*SetShellVarContext all\s*\r?\n\s*\$\{EndIf\}/,
        '',
      );
      expect(mutant).not.toBe(NSH);
      expectPinFails(mutant, assertShellVarContextCurrentThenRestorePrevious, /RF-7a|installMode|SetShellVarContext all/);
    });

    it('RF-7a always-all: restoring all without installMode fails the context pin', () => {
      const mutant = NSH.replace(
        '${If} $installMode == "all"\n    SetShellVarContext all\n  ${EndIf}',
        'SetShellVarContext all',
      );
      expect(mutant).not.toBe(NSH);
      expectPinFails(mutant, assertShellVarContextCurrentThenRestorePrevious, /RF-7a|installMode|Else/);
    });

    it('RF-7b drop-walk: Goto do_delete without the reparse walk fails the walk pin', () => {
      const mutant = NSH.replace('Goto mythos_reparse_walk', 'Goto uninstall_vault_do_delete');
      expect(mutant).not.toBe(NSH);
      expectPinFails(mutant, assertSidecarReparseWalkBeforeDelete, /RF-7b|walk/);
    });

    it('M-E / M13: KEEP ${Else} branch also inserts Remove-all macro fails', () => {
      const body = customUnInstall();
      const elseAt = body.indexOf('${Else}');
      const mutantBody =
        body.slice(0, elseAt) +
        body.slice(elseAt).replace(
          '!insertmacro mythos_delete_app_caches',
          '!insertmacro mythos_delete_remove_all_user_data\n      !insertmacro mythos_delete_app_caches',
        );
      const mutantNsh = NSH.replace(body, mutantBody);
      expectPinFailsOnCustomUnInstall(
        mutantNsh,
        assertKeepElseEndIfInsertsOnlyAppCachesMacro,
        /M13|mythos_delete_app_caches/,
      );
      expectPinFailsOnCustomUnInstall(
        mutantNsh,
        assertKeepBranchInsertsCacheMacroOnly,
        /R-5|mythos_delete_remove_all_user_data/,
      );
    });
  });
});
