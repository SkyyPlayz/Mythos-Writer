import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import {
  APP_USER_DATA_DIRS,
  APP_USER_DATA_FILES,
} from './appUserDataManifest.js';

/**
 * MW-delete-vault — locked NSIS token contract (PLAN draft 3 / owner UX lock).
 * Soft "mentions sidecar" greps are not enough.
 *
 * Shipped UX path: pre-Uninstall checkbox via customUnInstallSection
 * (Section /o = unchecked = KEEP). Post-start Yes/No dialog is NOT used.
 */
const NSH = readFileSync(resolve(process.cwd(), '../build/uninstall-vaults.nsh'), 'utf-8');

describe('build/uninstall-vaults.nsh token contract (MW-delete-vault UX lock)', () => {
  it('ships pre-Uninstall checkbox page (customUnInstallSection + Section /o)', () => {
    expect(NSH).toContain('!macro customUnInstallSection');
    expect(NSH).toMatch(/Section\s+\/o\s+"un\.Also delete my Mythos vaults \/ writing data"/);
    expect(NSH).toContain('SEC_DELETE_MYTHOS_VAULTS');
    expect(NSH).toContain('SectionIsSelected');
    expect(NSH).toContain('!ifdef BUILD_UNINSTALLER');
  });

  it('default KEEP — no executable MessageBox / DEFBUTTON polarity on this tip', () => {
    // Checkbox path shipped; strip comments so a prose mention cannot false-fail.
    const executable = NSH.replace(/;[^\n]*/g, '');
    expect(executable).not.toMatch(/\bMessageBox\b/);
    expect(executable).not.toContain('MB_DEFBUTTON1');
    expect(NSH).toMatch(/unchecked by default|KEEP/i);
  });

  it('names the sidecar file', () => {
    expect(NSH).toContain('uninstall-delete-paths.txt');
  });

  it('FileOpens and FileReads the sidecar', () => {
    expect(NSH).toMatch(/\bFileOpen\b/);
    expect(NSH).toMatch(/\bFileRead\b/);
  });

  it('always falls back to default AppData vaults + both settings files', () => {
    expect(NSH).toContain('RMDir /r "$APPDATA\\Mythos Writer\\vaults"');
    expect(NSH).toContain('Delete "$APPDATA\\Mythos Writer\\vault-settings.json"');
    expect(NSH).toContain('Delete "$APPDATA\\Mythos Writer\\app-settings.json"');
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
    // RMDir of a sidecar $1 only after the allowlist gate.
    const denyAt = executable.indexOf('mythos_al_deny');
    const doDeleteAt = executable.indexOf('uninstall_vault_do_delete:');
    const sidecarRmAt = executable.indexOf('RMDir /r "$1"');
    expect(denyAt).toBeGreaterThan(-1);
    expect(doDeleteAt).toBeGreaterThan(denyAt);
    expect(sidecarRmAt).toBeGreaterThan(doDeleteAt);
  });

  it('always deletes app-private paths (manifest sync) before vault opt-in', () => {
    expect(NSH).toContain('!macro mythos_delete_app_private');
    expect(NSH).toMatch(/!insertmacro mythos_delete_app_private/);
    const insertAt = NSH.indexOf('!insertmacro mythos_delete_app_private');
    const vaultIfAt = NSH.indexOf('${If} ${SectionIsSelected} ${SEC_DELETE_MYTHOS_VAULTS}');
    expect(insertAt).toBeGreaterThan(-1);
    expect(vaultIfAt).toBeGreaterThan(insertAt);
    for (const name of APP_USER_DATA_FILES) {
      expect(NSH).toContain(`Mythos Writer\\${name}`);
    }
    for (const name of APP_USER_DATA_DIRS) {
      expect(NSH).toContain(`Mythos Writer\\${name}`);
    }
  });

  it('PLAN-058 L8 / 00:46 — Remove all RMDirs entire Roaming Mythos Writer folder', () => {
    const executable = NSH.replace(/;[^\n]*/g, '');
    expect(executable).toContain('RMDir /r "$APPDATA\\Mythos Writer"');
    const vaultIfAt = executable.indexOf('${If} ${SectionIsSelected} ${SEC_DELETE_MYTHOS_VAULTS}');
    const fullRmAt = executable.indexOf('RMDir /r "$APPDATA\\Mythos Writer"');
    const endIfAt = executable.indexOf('${EndIf}', vaultIfAt);
    expect(vaultIfAt).toBeGreaterThan(-1);
    expect(fullRmAt).toBeGreaterThan(vaultIfAt);
    expect(fullRmAt).toBeLessThan(endIfAt);
  });

  it('rejects .. / . path segments before RMDir (Shield tip-3 traversal)', () => {
    const executable = NSH.replace(/;[^\n]*/g, '');
    expect(executable).toContain('mythos_trav_scan');
    expect(executable).toContain('uninstall_vault_trav_ok');
    // Dot-segment scan must run before do_delete / RMDir "$1".
    const travAt = executable.indexOf('mythos_trav_scan');
    const travOkAt = executable.indexOf('uninstall_vault_trav_ok');
    const doDeleteAt = executable.indexOf('uninstall_vault_do_delete:');
    const sidecarRmAt = executable.indexOf('RMDir /r "$1"');
    expect(travAt).toBeGreaterThan(-1);
    expect(travOkAt).toBeGreaterThan(travAt);
    expect(doDeleteAt).toBeGreaterThan(travOkAt);
    expect(sidecarRmAt).toBeGreaterThan(doDeleteAt);
    // Segment reject: compare against literal "." after a separator.
    expect(executable).toMatch(/StrCmp \$4 "\."/);
  });
});
