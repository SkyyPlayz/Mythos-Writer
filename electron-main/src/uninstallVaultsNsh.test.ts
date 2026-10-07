import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

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
  assertNoExecutableMessageBox,
  assertRemoveAllDeletesStrictlyBetweenSectionIfAndElse,
  assertSidecarAllowlistBeforeDelete,
  assertSidecarDeleteAfterFileOpenAndClose,
  assertTraversalRejectedBeforeSidecarDelete,
  assertTraversalThenAllowlistThenSidecarDelete,
} from './uninstallNshOrder.js';

const NSH = readFileSync(resolve(process.cwd(), '../build/uninstall-vaults.nsh'), 'utf-8');

function nshMacroBody(source: string, macroName: string): string {
  const needle = `!macro ${macroName}`;
  let pos = 0;
  while (pos < source.length) {
    const start = source.indexOf(needle, pos);
    if (start < 0) return '';
    const after = start + needle.length;
    const next = source[after];
    if (next === ' ' || next === '\n' || next === '\r' || after === source.length) {
      const end = source.indexOf('!macroend', start);
      return end < 0 ? source.slice(start) : source.slice(start, end + '!macroend'.length);
    }
    pos = start + 1;
  }
  return '';
}

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

  it('(1) delete-vaults section is Section /o — off by default (MW-delete-vault)', () => {
    assertDeleteVaultsSectionOffByDefault(NSH);
    expect(NSH).toContain('!ifdef BUILD_UNINSTALLER');
    expect(NSH).toContain('SectionIsSelected');
  });

  it('(2) SectionIsSelected gate — Remove-all deletes only between If and Else (Critic H4)', () => {
    assertRemoveAllDeletesStrictlyBetweenSectionIfAndElse(customUnInstall());
  });

  it('(3) default vaults/ fallback RMDir inside Remove-all gate', () => {
    assertDefaultVaultsFallbackRmdir(customUnInstall());
  });

  it('(4) allowlist-then-traversal chain before sidecar RMDir "$1" (Critic H4)', () => {
    assertTraversalThenAllowlistThenSidecarDelete(NSH);
    assertTraversalRejectedBeforeSidecarDelete(NSH);
    assertSidecarAllowlistBeforeDelete(NSH);
    assertAllowlistDenySkipsSidecarLine(NSH);
  });

  it('(5) KEEP branch cache-only — no Remove-all user macro (R-5 / Probe H-A)', () => {
    assertKeepBranchInsertsCacheMacroOnly(customUnInstall());
    assertRemoveAllDeletesStrictlyBetweenSectionIfAndElse(customUnInstall());
  });

  it('(b) default KEEP — no executable MessageBox in uninstall nsh', () => {
    assertNoExecutableMessageBox(NSH);
    expect(NSH).toMatch(/unchecked by default|KEEP/i);
  });

  it('names the sidecar and FileOpens / FileReads it', () => {
    expect(NSH).toContain(UNINSTALL_DELETE_PATHS_FILENAME);
    expect(NSH).toMatch(/\bFileOpen\b/);
    expect(NSH).toMatch(/\bFileRead\b/);
  });

  it('delete path only runs when checkbox section is selected', () => {
    expect(NSH).toMatch(/\$\{If\}\s+\$\{SectionIsSelected\}\s+\$\{SEC_DELETE_MYTHOS_VAULTS\}/);
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
    it('M-A / M19: section checked by default (remove /o) fails (1)', () => {
      const mutant = NSH.replace(
        /Section\s+\/o\s+"un\.Also delete my Mythos vaults \/ writing data"/,
        'Section "un.Also delete my Mythos vaults / writing data"',
      );
      expectPinFails(mutant, assertDeleteVaultsSectionOffByDefault, /Section \/o/);
    });

    it('M-B: disabling .. reject at traversal backslash branch fails (4)', () => {
      const mutant = NSH.split('StrCmp $4 "\" uninstall_vault_read').join('StrCmp $4 "\" mythos_trav_inc');
      expectPinFails(mutant, assertTraversalRejectedBeforeSidecarDelete, /reject \.\.|uninstall_vault_read/);
    });

    it('M-C: adding MessageBox fails (b)', () => {
      const mutant = NSH.replace(
        '!macro customUnInstall',
        '!macro customUnInstall\n  MessageBox MB_OK "mutant"',
      );
      expectPinFails(mutant, assertNoExecutableMessageBox, /MessageBox/);
    });

    it('M-C: MB_DEFBUTTON1 in executable fails (b)', () => {
      const mutant = NSH.replace(
        '!macro customUnInstall',
        '!macro customUnInstall\n  MessageBox MB_OK|MB_DEFBUTTON1 "mutant"',
      );
      expectPinFails(mutant, assertNoExecutableMessageBox, /MessageBox|MB_DEFBUTTON1/);
    });

    it('M19: section checked by default (same as M-A) fails (1)', () => {
      const mutant = NSH.replace('Section /o "un.Also delete my Mythos vaults / writing data"', 'Section "un.Also delete my Mythos vaults / writing data"');
      expectPinFails(mutant, assertDeleteVaultsSectionOffByDefault, /Section \/o/);
    });

    it('M23: dropping vaults/ fallback RMDir fails (3)', () => {
      const mutant = NSH.replace('RMDir /r "$APPDATA\\Mythos Writer\\vaults"', '');
      expectPinFailsOnCustomUnInstall(mutant, assertDefaultVaultsFallbackRmdir, /vaults\/ fallback/);
      expectPinFailsOnCustomUnInstall(
        mutant,
        assertRemoveAllDeletesStrictlyBetweenSectionIfAndElse,
        /vaults/,
      );
    });

    it('M24: Remove-all gate always true (macro in KEEP branch) fails (2)', () => {
      const body = customUnInstall();
      const elseAt = body.indexOf('${Else}');
      const mutantBody =
        body.slice(0, elseAt) +
        body.slice(elseAt).replace(
          '!insertmacro mythos_delete_app_caches',
          '!insertmacro mythos_delete_app_caches\n      !insertmacro mythos_delete_remove_all_user_data',
        );
      const mutantNsh = NSH.replace(body, mutantBody);
      expectPinFailsOnCustomUnInstall(
        mutantNsh,
        assertRemoveAllDeletesStrictlyBetweenSectionIfAndElse,
        /KEEP|Remove-all|mythos_delete_remove_all_user_data/,
      );
    });

    it('Probe H-A (a): allowlist deny -> allow (Goto do_delete) fails (4)', () => {
      const mutant = NSH.replace(
        /mythos_al_deny:\s*\r?\n\s*Goto uninstall_vault_read/,
        'mythos_al_deny:\n        Goto uninstall_vault_do_delete',
      );
      expect(mutant).not.toBe(NSH);
      expectPinFails(mutant, assertAllowlistDenySkipsSidecarLine, /do_delete|uninstall_vault_read/);
    });

    it('Probe H-A (b): KEEP branch also inserts Remove-all macro fails (R-5)', () => {
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
        assertKeepBranchInsertsCacheMacroOnly,
        /R-5|mythos_delete_remove_all_user_data/,
      );
      expectPinFailsOnCustomUnInstall(
        mutantNsh,
        assertRemoveAllDeletesStrictlyBetweenSectionIfAndElse,
        /KEEP|mythos_delete_remove_all_user_data/,
      );
    });
  });
});
