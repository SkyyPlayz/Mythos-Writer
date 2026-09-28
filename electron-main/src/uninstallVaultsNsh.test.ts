import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * MW-delete-vault — locked NSIS token contract (PLAN §1).
 * Soft "mentions sidecar" greps are not enough.
 */
const NSH = readFileSync(resolve(process.cwd(), '../build/uninstall-vaults.nsh'), 'utf-8');

describe('build/uninstall-vaults.nsh token contract (MW-delete-vault)', () => {
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

  it('keeps Yes=keep / No=delete polarity (MB_YESNO + MB_DEFBUTTON1)', () => {
    expect(NSH).toContain('MB_YESNO');
    expect(NSH).toContain('MB_DEFBUTTON1');
    expect(NSH).toContain('IDYES uninstall_vault_keep');
    expect(NSH).toContain('IDNO uninstall_vault_delete');
  });

  it('dialog copy no longer claims custom locations are skipped', () => {
    expect(NSH).not.toMatch(/custom locations will not be removed/i);
    expect(NSH).toMatch(/custom paths/i);
  });
});
