import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import JSZip from 'jszip';
import { backupAppData, restoreAppData, BACKUP_SCHEMA_VERSION } from './backup.js';

const tmpDirs: string[] = [];

function mkTmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-backup-test-'));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

describe('backupAppData', () => {
  it('produces a valid zip with header and userData/vault files', async () => {
    const userData = mkTmp();
    const storyVault = mkTmp();
    const notesVault = mkTmp();
    const out = path.join(mkTmp(), 'backup.mwbackup');

    fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({ theme: 'dark' }));
    fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: storyVault }));
    fs.writeFileSync(path.join(storyVault, 'manifest.json'), JSON.stringify({ schemaVersion: 1 }));

    const mythosDir = path.join(storyVault, '.mythos');
    fs.mkdirSync(mythosDir);
    fs.writeFileSync(path.join(mythosDir, 'state.db'), Buffer.from('fake-db'));

    const snapshotDir = path.join(mythosDir, 'snapshots', 'scene-abc');
    fs.mkdirSync(snapshotDir, { recursive: true });
    fs.writeFileSync(path.join(snapshotDir, 'snap1.json'), JSON.stringify({ content: 'hello' }));

    const result = await backupAppData({
      userDataPath: userData,
      storyVaultRoot: storyVault,
      notesVaultRoot: notesVault,
      appVersion: '0.1.0',
      manifestSchemaVersion: 1,
      outputPath: out,
    });

    expect(result.path).toBe(out);
    expect(result.bytes).toBeGreaterThan(0);
    expect(fs.existsSync(out)).toBe(true);

    const zip = await JSZip.loadAsync(fs.readFileSync(out));
    const header = JSON.parse(await zip.file('header.json')!.async('text'));
    expect(header.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(header.appVersion).toBe('0.1.0');
    expect(header.manifestSchemaVersion).toBe(1);
    expect(zip.file('userData/app-settings.json')).not.toBeNull();
    expect(zip.file('userData/vault-settings.json')).not.toBeNull();
    expect(zip.file('storyVault/manifest.json')).not.toBeNull();
    expect(zip.file('storyVault/.mythos/state.db')).not.toBeNull();
    expect(zip.file('storyVault/.mythos/snapshots/scene-abc/snap1.json')).not.toBeNull();
  });

  it('skips missing optional paths without error', async () => {
    const out = path.join(mkTmp(), 'backup.mwbackup');
    const result = await backupAppData({
      userDataPath: mkTmp(),
      storyVaultRoot: mkTmp(),
      notesVaultRoot: mkTmp(),
      appVersion: '0.1.0',
      manifestSchemaVersion: 0,
      outputPath: out,
    });
    expect(result.bytes).toBeGreaterThan(0);
    const zip = await JSZip.loadAsync(fs.readFileSync(out));
    expect(zip.file('header.json')).not.toBeNull();
    expect(zip.file('userData/app-settings.json')).toBeNull();
  });

  it('includes notes vault .mythos when present', async () => {
    const userData = mkTmp();
    const storyVault = mkTmp();
    const notesVault = mkTmp();
    const out = path.join(mkTmp(), 'backup.mwbackup');

    const notesMythos = path.join(notesVault, '.mythos');
    fs.mkdirSync(notesMythos);
    fs.writeFileSync(path.join(notesMythos, 'state.db'), Buffer.from('notes-db'));
    fs.writeFileSync(path.join(notesVault, 'manifest.json'), JSON.stringify({ schemaVersion: 1 }));

    await backupAppData({
      userDataPath: userData,
      storyVaultRoot: storyVault,
      notesVaultRoot: notesVault,
      appVersion: '0.1.0',
      manifestSchemaVersion: 1,
      outputPath: out,
    });

    const zip = await JSZip.loadAsync(fs.readFileSync(out));
    expect(zip.file('notesVault/manifest.json')).not.toBeNull();
    expect(zip.file('notesVault/.mythos/state.db')).not.toBeNull();
  });
});

describe('restoreAppData — smoke: backup → wipe → restore → equality', () => {
  it('restores all files and matches original content', async () => {
    const srcUserData = mkTmp();
    const srcStoryVault = mkTmp();
    const srcNotesVault = mkTmp();
    const out = path.join(mkTmp(), 'backup.mwbackup');

    const settings = { theme: 'dark', apiKey: 'test-key' };
    const vaultSettings = { vaultRoot: srcStoryVault };
    const manifest = { schemaVersion: 1, stories: [] };
    const dbContent = Buffer.from('binary-db-data');

    fs.writeFileSync(path.join(srcUserData, 'app-settings.json'), JSON.stringify(settings));
    fs.writeFileSync(path.join(srcUserData, 'vault-settings.json'), JSON.stringify(vaultSettings));
    fs.writeFileSync(path.join(srcStoryVault, 'manifest.json'), JSON.stringify(manifest));
    const mythosDir = path.join(srcStoryVault, '.mythos');
    fs.mkdirSync(mythosDir);
    fs.writeFileSync(path.join(mythosDir, 'state.db'), dbContent);
    const snapDir = path.join(mythosDir, 'snapshots', 'scene-1');
    fs.mkdirSync(snapDir, { recursive: true });
    fs.writeFileSync(path.join(snapDir, 'ts1.json'), JSON.stringify({ content: 'snap' }));

    await backupAppData({
      userDataPath: srcUserData,
      storyVaultRoot: srcStoryVault,
      notesVaultRoot: srcNotesVault,
      appVersion: '0.1.0',
      manifestSchemaVersion: 1,
      outputPath: out,
    });

    // Fresh destinations (wipe simulated by using empty temp dirs)
    const destUserData = mkTmp();
    const destStoryVault = mkTmp();
    const destNotesVault = mkTmp();

    const result = await restoreAppData({
      archivePath: out,
      userDataPath: destUserData,
      storyVaultRoot: destStoryVault,
      notesVaultRoot: destNotesVault,
      overwrite: false,
    });

    expect(result.restored).toBe(true);
    expect(result.requiresConfirmation).toBeUndefined();

    const restoredSettings = JSON.parse(
      fs.readFileSync(path.join(destUserData, 'app-settings.json'), 'utf-8'),
    );
    expect(restoredSettings.theme).toBe('dark');
    expect(restoredSettings.apiKey).toBe('test-key');

    const restoredManifest = JSON.parse(
      fs.readFileSync(path.join(destStoryVault, 'manifest.json'), 'utf-8'),
    );
    expect(restoredManifest.schemaVersion).toBe(1);

    const restoredDb = fs.readFileSync(path.join(destStoryVault, '.mythos', 'state.db'));
    expect(restoredDb).toEqual(dbContent);

    const restoredSnap = JSON.parse(
      fs.readFileSync(path.join(destStoryVault, '.mythos', 'snapshots', 'scene-1', 'ts1.json'), 'utf-8'),
    );
    expect(restoredSnap.content).toBe('snap');
  });
});

describe('restoreAppData — overwrite guard', () => {
  it('refuses to overwrite when confirmed is false', async () => {
    const userData = mkTmp();
    const out = path.join(mkTmp(), 'backup.mwbackup');

    fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({ theme: 'dark' }));
    await backupAppData({
      userDataPath: userData,
      storyVaultRoot: mkTmp(),
      notesVaultRoot: mkTmp(),
      appVersion: '0.1.0',
      manifestSchemaVersion: 0,
      outputPath: out,
    });

    const destUserData = mkTmp();
    fs.writeFileSync(
      path.join(destUserData, 'app-settings.json'),
      JSON.stringify({ theme: 'light' }),
    );

    const result = await restoreAppData({
      archivePath: out,
      userDataPath: destUserData,
      storyVaultRoot: mkTmp(),
      notesVaultRoot: mkTmp(),
      overwrite: false,
    });

    expect(result.restored).toBe(false);
    expect(result.requiresConfirmation).toBe(true);
    // Existing file untouched
    const existing = JSON.parse(
      fs.readFileSync(path.join(destUserData, 'app-settings.json'), 'utf-8'),
    );
    expect(existing.theme).toBe('light');
  });

  it('overwrites when confirmed is true', async () => {
    const userData = mkTmp();
    const out = path.join(mkTmp(), 'backup.mwbackup');

    fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({ theme: 'dark' }));
    await backupAppData({
      userDataPath: userData,
      storyVaultRoot: mkTmp(),
      notesVaultRoot: mkTmp(),
      appVersion: '0.1.0',
      manifestSchemaVersion: 0,
      outputPath: out,
    });

    const destUserData = mkTmp();
    fs.writeFileSync(
      path.join(destUserData, 'app-settings.json'),
      JSON.stringify({ theme: 'light' }),
    );

    const result = await restoreAppData({
      archivePath: out,
      userDataPath: destUserData,
      storyVaultRoot: mkTmp(),
      notesVaultRoot: mkTmp(),
      overwrite: true,
    });

    expect(result.restored).toBe(true);
    const overwritten = JSON.parse(
      fs.readFileSync(path.join(destUserData, 'app-settings.json'), 'utf-8'),
    );
    expect(overwritten.theme).toBe('dark');
  });
});

describe('restoreAppData — error cases', () => {
  it('throws on missing archive file', async () => {
    await expect(
      restoreAppData({
        archivePath: '/nonexistent/backup.mwbackup',
        userDataPath: mkTmp(),
        storyVaultRoot: mkTmp(),
        notesVaultRoot: mkTmp(),
      }),
    ).rejects.toThrow('Archive not found');
  });

  it('throws on archive with wrong schema version', async () => {
    const out = path.join(mkTmp(), 'bad.mwbackup');

    // Manually craft a zip with wrong schema version
    const zip = new JSZip();
    zip.file('header.json', JSON.stringify({ schemaVersion: 999, appVersion: '0.0.0', manifestSchemaVersion: 0, createdAt: '' }));
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    fs.writeFileSync(out, buf);

    await expect(
      restoreAppData({
        archivePath: out,
        userDataPath: mkTmp(),
        storyVaultRoot: mkTmp(),
        notesVaultRoot: mkTmp(),
      }),
    ).rejects.toThrow('Unsupported backup schema version');
  });

  it('throws on archive missing header.json', async () => {
    const out = path.join(mkTmp(), 'noheader.mwbackup');
    const zip = new JSZip();
    zip.file('some-file.txt', 'data');
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    fs.writeFileSync(out, buf);

    await expect(
      restoreAppData({
        archivePath: out,
        userDataPath: mkTmp(),
        storyVaultRoot: mkTmp(),
        notesVaultRoot: mkTmp(),
      }),
    ).rejects.toThrow('missing header.json');
  });
});
