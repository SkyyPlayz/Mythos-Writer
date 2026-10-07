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
import { assertSidecarDeleteAfterFileOpenAndClose } from './uninstallNshOrder.js';

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

describe('build/uninstall-vaults.nsh token contract', () => {
  const customUnInstall = () => nshMacroBody(NSH, 'customUnInstall');

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
    for (const name of APP_USER_DIRS) {
      expect(cacheMacro).not.toMatch(
        new RegExp(`RMDir /r "\\$APPDATA\\\\Mythos Writer\\\\${name}"`),
      );
    }
    for (const name of APP_USER_FILES) {
      expect(cacheMacro).not.toContain(`Mythos Writer\\${name}`);
    }
  });

  it('Remove all user items live only inside SEC_DELETE_MYTHOS_VAULTS', () => {
    const body = customUnInstall();
    const vaultIfAt = body.indexOf('${If} ${SectionIsSelected} ${SEC_DELETE_MYTHOS_VAULTS}');
    const endIfAt = body.indexOf('${Else}');
    const removeAllMacro = nshMacroBody(NSH, 'mythos_delete_remove_all_user_data');
    for (const name of APP_USER_FILES) {
      expect(removeAllMacro).toContain(`Mythos Writer\\${name}`);
    }
    for (const name of APP_USER_DIRS) {
      expect(removeAllMacro).toContain(`Mythos Writer\\${name}`);
    }
    const insertRemoveAll = body.indexOf('!insertmacro mythos_delete_remove_all_user_data');
    expect(insertRemoveAll).toBeGreaterThan(vaultIfAt);
    expect(insertRemoveAll).toBeLessThan(endIfAt);
    const sidecarDel = body.indexOf(`Delete "$APPDATA\\Mythos Writer\\${UNINSTALL_DELETE_PATHS_FILENAME}"`);
    expect(sidecarDel).toBeGreaterThan(vaultIfAt);
    expect(sidecarDel).toBeLessThan(endIfAt);
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

  it('Remove all ends with full userData RMDir inside vault section', () => {
    const body = customUnInstall();
    const vaultIfAt = body.indexOf('${If} ${SectionIsSelected} ${SEC_DELETE_MYTHOS_VAULTS}');
    const fullRmAt = body.indexOf('RMDir /r "$APPDATA\\Mythos Writer"');
    const elseAt = body.indexOf('${Else}');
    expect(fullRmAt).toBeGreaterThan(vaultIfAt);
    expect(fullRmAt).toBeLessThan(elseAt);
  });

  it('re-checks sidecar lines with allowlist before RMDir (Shield tip-3)', () => {
    const executable = NSH.replace(/;[^\n]*/g, '');
    expect(executable).toContain('mythos_trav_scan');
    expect(executable).toContain('uninstall_vault_do_delete');
  });
});
