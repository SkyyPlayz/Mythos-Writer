import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import JSZip from 'jszip';
import { backupAppData, restoreAppData, redactAppSettings, safeRestoreJoin, BACKUP_SCHEMA_VERSION } from './backup.js';

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
  it('restores all files and matches original content; apiKey is redacted in backup', async () => {
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
    // apiKey MUST NOT round-trip through backup (#628 regression guard)
    expect(restoredSettings.apiKey).toBe('');

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

// --- #628: secret redaction --------------------------------------------------

describe('redactAppSettings', () => {
  it('zeros top-level apiKey', () => {
    const out = redactAppSettings({ apiKey: 'sk-ant-abc123', theme: 'dark' });
    expect(out.apiKey).toBe('');
    expect(out.theme).toBe('dark');
  });

  it('zeros provider.apiKey', () => {
    const out = redactAppSettings({ provider: { model: 'claude-3', apiKey: 'sk-ant-xyz' } });
    const p = out.provider as Record<string, unknown>;
    expect(p.apiKey).toBe('');
    expect(p.model).toBe('claude-3');
  });

  it('zeros voice.openaiApiKey', () => {
    const out = redactAppSettings({ voice: { openaiApiKey: 'sk-openai', ttsVoice: 'alloy' } });
    const v = out.voice as Record<string, unknown>;
    expect(v.openaiApiKey).toBe('');
    expect(v.ttsVoice).toBe('alloy');
  });

  it('zeros stt.cloudApiKey', () => {
    const out = redactAppSettings({ stt: { cloudApiKey: 'secret', provider: 'openai' } });
    const s = out.stt as Record<string, unknown>;
    expect(s.cloudApiKey).toBe('');
    expect(s.provider).toBe('openai');
  });

  it('zeros tts.cloudApiKey', () => {
    const out = redactAppSettings({ tts: { cloudApiKey: 'secret', provider: 'openai' } });
    const t = out.tts as Record<string, unknown>;
    expect(t.cloudApiKey).toBe('');
  });

  it('zeros agents.*.provider.apiKey', () => {
    const out = redactAppSettings({
      agents: {
        writingAssistant: { provider: { apiKey: 'wa-key', model: 'claude-3' } },
        brainstorm: { enabled: true },
      },
    });
    const agents = out.agents as Record<string, Record<string, unknown>>;
    const wa = agents.writingAssistant.provider as Record<string, unknown>;
    expect(wa.apiKey).toBe('');
    expect(wa.model).toBe('claude-3');
    expect((agents.brainstorm as Record<string, unknown>).enabled).toBe(true);
  });

  it('passes through settings with no secret fields unchanged', () => {
    const input = { theme: 'dark', fontSize: 14 };
    expect(redactAppSettings(input)).toEqual(input);
  });
});

describe('backupAppData — secret redaction regression (#628)', () => {
  it('does not include apiKey in the archived app-settings.json', async () => {
    const userData = mkTmp();
    const out = path.join(mkTmp(), 'backup.mwbackup');

    const rawSettings = {
      theme: 'dark',
      apiKey: 'sk-ant-secret-key',
      provider: { model: 'claude-3', apiKey: 'sk-ant-provider-key' },
      voice: { openaiApiKey: 'sk-openai-voice' },
    };
    fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(rawSettings));

    await backupAppData({
      userDataPath: userData,
      storyVaultRoot: mkTmp(),
      notesVaultRoot: mkTmp(),
      appVersion: '0.1.0',
      manifestSchemaVersion: 1,
      outputPath: out,
    });

    const zip = await JSZip.loadAsync(fs.readFileSync(out));
    const archived = JSON.parse(await zip.file('userData/app-settings.json')!.async('text'));

    expect(archived.theme).toBe('dark');
    expect(archived.apiKey).toBe('');
    expect((archived.provider as Record<string, unknown>).apiKey).toBe('');
    expect((archived.voice as Record<string, unknown>).openaiApiKey).toBe('');
    // Verify the raw secret strings do not appear anywhere in the archive bytes
    const raw = fs.readFileSync(out);
    expect(raw.toString('latin1')).not.toContain('sk-ant-secret-key');
    expect(raw.toString('latin1')).not.toContain('sk-ant-provider-key');
    expect(raw.toString('latin1')).not.toContain('sk-openai-voice');
  });
});

// --- #733: zip-slip guard ----------------------------------------------------

describe('safeRestoreJoin', () => {
  it('allows safe relative paths', () => {
    const base = mkTmp();
    const result = safeRestoreJoin(base, 'subdir/file.json');
    expect(result).toBe(path.join(base, 'subdir', 'file.json'));
  });

  it('rejects traversal with ../', () => {
    const base = mkTmp();
    expect(() => safeRestoreJoin(base, '../../etc/passwd')).toThrow('Zip-slip rejected');
  });

  it('rejects traversal with single ..', () => {
    const base = mkTmp();
    expect(() => safeRestoreJoin(base, '../sibling')).toThrow('Zip-slip rejected');
  });

  it('rejects null byte in entry name', () => {
    const base = mkTmp();
    expect(() => safeRestoreJoin(base, 'file\0.txt')).toThrow('Zip-slip rejected');
  });

  it('rejects Windows drive-letter paths', () => {
    const base = mkTmp();
    expect(() => safeRestoreJoin(base, 'C:\\Windows\\system32\\evil.dll')).toThrow('Zip-slip rejected');
  });

  it('rejects UNC paths', () => {
    const base = mkTmp();
    expect(() => safeRestoreJoin(base, '\\\\server\\share\\evil')).toThrow('Zip-slip rejected');
  });

  it('rejects absolute paths', () => {
    const base = mkTmp();
    expect(() => safeRestoreJoin(base, '/etc/passwd')).toThrow('Zip-slip rejected');
  });
});

/** Build a minimal STORE-compressed zip buffer with un-normalized entry names.
 *  JSZip's file() API normalises paths, so we craft raw bytes to bypass that.
 */
function buildRawZip(entries: Array<{ name: string; content: string }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const e of entries) {
    const nameBytes = Buffer.from(e.name, 'utf-8');
    const dataBytes = Buffer.from(e.content, 'utf-8');

    // Local file header (30 bytes) + name + data
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);  // PK\x03\x04
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0, 6);            // flags
    local.writeUInt16LE(0, 8);            // compression=STORE
    local.writeUInt16LE(0, 10);           // mod time
    local.writeUInt16LE(0, 12);           // mod date
    local.writeUInt32LE(0, 14);           // crc32 (unchecked in tests)
    local.writeUInt32LE(dataBytes.length, 18); // compressed size
    local.writeUInt32LE(dataBytes.length, 22); // uncompressed size
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);           // extra field length
    nameBytes.copy(local, 30);

    // Central directory entry (46 bytes) + name
    const cd = Buffer.alloc(46 + nameBytes.length);
    cd.writeUInt32LE(0x02014b50, 0);      // PK\x01\x02
    cd.writeUInt16LE(20, 4);             // version made by
    cd.writeUInt16LE(20, 6);             // version needed
    cd.writeUInt16LE(0, 8);              // flags
    cd.writeUInt16LE(0, 10);             // compression=STORE
    cd.writeUInt16LE(0, 12);             // mod time
    cd.writeUInt16LE(0, 14);             // mod date
    cd.writeUInt32LE(0, 16);             // crc32
    cd.writeUInt32LE(dataBytes.length, 20);
    cd.writeUInt32LE(dataBytes.length, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt16LE(0, 30);             // extra
    cd.writeUInt16LE(0, 32);             // comment
    cd.writeUInt16LE(0, 34);             // disk start
    cd.writeUInt16LE(0, 36);             // internal attrs
    cd.writeUInt32LE(0, 38);             // external attrs
    cd.writeUInt32LE(localOffset, 42);   // local header offset
    nameBytes.copy(cd, 46);

    localParts.push(local, dataBytes);
    centralParts.push(cd);
    localOffset += local.length + dataBytes.length;
  }

  const localData = Buffer.concat(localParts);
  const cdData = Buffer.concat(centralParts);

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);     // PK\x05\x06
  eocd.writeUInt16LE(0, 4);             // disk number
  eocd.writeUInt16LE(0, 6);             // cd start disk
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdData.length, 12);
  eocd.writeUInt32LE(localData.length, 16);
  eocd.writeUInt16LE(0, 20);            // comment length

  return Buffer.concat([localData, cdData, eocd]);
}

describe('restoreAppData — zip-slip guard (#733)', () => {
  it('rejects a crafted archive with a null-byte injection in storyVault/.mythos/', async () => {
    const out = path.join(mkTmp(), 'crafted.mwbackup');

    // JSZip normalises `..` away, but it preserves null bytes in entry names.
    // A crafted zip with 'storyVault/.mythos/file\0evil.txt' passes the prefix filter;
    // safeRestoreJoin must catch the null byte and throw before any write.
    //
    // The raw zip is built by hand so JSZip's high-level file() API (which would
    // also normalise or reject) is bypassed. This models real-world zip tools
    // (Python zipfile, 7z, etc.) that can produce such entries.
    const buf = buildRawZip([
      {
        name: 'header.json',
        content: JSON.stringify({
          schemaVersion: BACKUP_SCHEMA_VERSION,
          appVersion: '0.0.0',
          manifestSchemaVersion: 0,
          createdAt: '',
        }),
      },
      {
        name: 'storyVault/.mythos/file\0evil.txt',
        content: 'malicious content',
      },
    ]);
    fs.writeFileSync(out, buf);

    await expect(
      restoreAppData({
        archivePath: out,
        userDataPath: mkTmp(),
        storyVaultRoot: mkTmp(),
        notesVaultRoot: mkTmp(),
        overwrite: false,
      }),
    ).rejects.toThrow('Zip-slip rejected');
  });

  it('restores a clean archive without errors', async () => {
    const userData = mkTmp();
    const storyVault = mkTmp();
    const notesVault = mkTmp();
    const out = path.join(mkTmp(), 'backup.mwbackup');

    const mythosDir = path.join(storyVault, '.mythos');
    fs.mkdirSync(mythosDir);
    fs.writeFileSync(path.join(mythosDir, 'state.db'), Buffer.from('db'));

    await backupAppData({
      userDataPath: userData,
      storyVaultRoot: storyVault,
      notesVaultRoot: notesVault,
      appVersion: '0.1.0',
      manifestSchemaVersion: 1,
      outputPath: out,
    });

    const result = await restoreAppData({
      archivePath: out,
      userDataPath: mkTmp(),
      storyVaultRoot: mkTmp(),
      notesVaultRoot: mkTmp(),
      overwrite: false,
    });
    expect(result.restored).toBe(true);
  });
});
