import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

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
});
