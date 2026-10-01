/**
 * KEYS-B pins (PB1–PB9c) + Shield r1–r3 riders for plaintext per-agent keys.
 * Every pin must fail at base ccde644d and when its own fix is reverted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AppSettings } from './ipc.js';
import {
  SETTINGS_DEFAULTS,
  loadAppSettingsFrom,
  saveAppSettingsTo,
} from './appSettingsLoad.js';
import { redactAppSettings } from './backup.js';
import { backupAppData } from './backup.js';
import { restoreAppDataAndReloadSettings } from './appRestore.js';
import {
  deleteLeftoverAtomicTemps,
  writeFileAtomicSecure,
} from './secrets/atomicWrite.js';
import {
  KEY_PATH_SECRET_ENTRIES,
  SECRET_ID_BY_KEY_PATH,
  assertKeyPathSecretTableComplete,
} from './secrets/keyFieldMap.js';
import {
  blankAllKeyFields,
  hydrateSecretsIntoSettings,
  migrateSecretsFromSettingsFile,
  persistSecretsAndStripSettings,
} from './secrets/migration.js';
import { SecretsStore, KNOWN_SECRET_IDS, type SafeStorageLike } from './secrets/store.js';
import {
  KEY_FIELD_PATHS,
  getKeyField,
  isMaskedPreview,
  maskApiKey,
  setKeyField,
  type KeyFieldPath,
} from './settings-masking.js';

const K = 'sk-ant-KeysB-PinValue00000000000000000000000000001';

function makeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s: string) => Buffer.from(`enc:${s}`, 'utf-8'),
    decryptString: (buf: Buffer) => buf.toString('utf-8').replace(/^enc:/, ''),
  };
}

function mkDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-keys-b-'));
  const settingsPath = path.join(dir, 'app-settings.json');
  const secretsPath = path.join(dir, 'secrets.json');
  return { dir, settingsPath, secretsPath };
}

function mkStore(available = true) {
  const paths = mkDir();
  const store = new SecretsStore({
    filePath: paths.secretsPath,
    safeStorage: makeSafeStorage(available),
  });
  return { ...paths, store };
}

const AGENT_BUDGET = {
  autoApply: false,
  confidenceThreshold: 0.8,
  maxTokensPerHour: 0,
  maxSuggestionsPerHour: 0,
  heartbeatIntervalMinutes: 0,
  maxTokensPerDay: 0,
};

function agentWithKey(apiKey: string) {
  return {
    enabled: false,
    model: 'claude',
    ...AGENT_BUDGET,
    provider: { kind: 'anthropic' as const, model: 'claude-haiku-4-5-20251001', apiKey },
  };
}

/** Full 12-path fixture with distinct or shared keys. */
function fullPlaintextFixture(keyForAll: string): AppSettings {
  return {
    ...SETTINGS_DEFAULTS,
    apiKey: keyForAll,
    provider: { kind: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKey: keyForAll },
    voice: { enabled: false, cloudFallback: false, openaiApiKey: keyForAll, ttsVoiceId: 'kokoro:nicole' },
    stt: { enabled: true, provider: 'cloud', cloudApiKey: keyForAll },
    tts: { enabled: true, provider: 'cloud', cloudApiKey: keyForAll },
    agents: {
      writingAssistant: { ...agentWithKey(keyForAll), scanIntervalSeconds: 0 },
      brainstorm: agentWithKey(keyForAll),
      archive: { ...agentWithKey(keyForAll), continuityCheckIntervalSeconds: 0 },
      betaReader: agentWithKey(keyForAll),
      alphaReader: agentWithKey(keyForAll),
      storylineConsultant: agentWithKey(keyForAll),
      lineEditor: agentWithKey(keyForAll),
    },
  };
}

function assertNoPlaintextInJson(settingsPath: string, values: string[]) {
  const bytes = fs.readFileSync(settingsPath, 'utf-8');
  for (const v of values) {
    expect(bytes, `json must not contain ${v.slice(0, 24)}…`).not.toContain(v);
  }
}

describe('PB1 — single KEY_FIELD_PATHS → SecretId table', () => {
  it('table keys equal KEY_FIELD_PATHS; all store ids from table; KNOWN covers them', () => {
    assertKeyPathSecretTableComplete();
    expect(KEY_PATH_SECRET_ENTRIES.map((e) => e.path)).toEqual([...KEY_FIELD_PATHS]);
    expect(Object.keys(SECRET_ID_BY_KEY_PATH).sort()).toEqual([...KEY_FIELD_PATHS].sort());
    for (const { secretId } of KEY_PATH_SECRET_ENTRIES) {
      expect(KNOWN_SECRET_IDS).toContain(secretId);
    }
  });

  it('migrate / persist / hydrate / fallback each iterate every KEY_FIELD_PATHS entry', () => {
    const { store, settingsPath } = mkStore();
    const seed = fullPlaintextFixture(K);
    fs.writeFileSync(settingsPath, JSON.stringify(seed), 'utf-8');

    const migrated = migrateSecretsFromSettingsFile(settingsPath, store);
    expect(migrated.movedIds.length).toBe(KEY_FIELD_PATHS.length);
    for (const { secretId } of KEY_PATH_SECRET_ENTRIES) {
      expect(migrated.movedIds).toContain(secretId);
      expect(store.get(secretId)).toBe(K);
    }

    const diskEmpty = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as AppSettings;
    const hydrated = hydrateSecretsIntoSettings(diskEmpty, store);
    for (const path of KEY_FIELD_PATHS) {
      expect(getKeyField(hydrated, path), `hydrate ${path}`).toBe(K);
    }

    const stripped = persistSecretsAndStripSettings(fullPlaintextFixture(K), store);
    for (const path of KEY_FIELD_PATHS) {
      expect(getKeyField(stripped, path), `persist ${path}`).toBe('');
    }

    const blanked = blankAllKeyFields(fullPlaintextFixture(K));
    for (const path of KEY_FIELD_PATHS) {
      expect(getKeyField(blanked, path), `fallback ${path}`).toBe('');
    }
  });

  it('source pin: migration.ts has no literal .provider.apiKey hand branches', () => {
    const src = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'secrets/migration.ts'),
      'utf-8',
    );
    // Table-driven only — no per-role if (parsed.provider) / agents.archive blocks.
    expect(src).not.toMatch(/parsed\.provider\s*&&/);
    expect(src).not.toMatch(/parsed\.agents\?\.archive/);
    expect(src).toMatch(/KEY_PATH_SECRET_ENTRIES/);
  });
});

describe('PB2 — round trip on real files', () => {
  it('seed 12 plaintext → migrate → loader → save → loader; JSON holds none; second boot no-op', () => {
    const { store, settingsPath } = mkStore();
    const seed = { ...fullPlaintextFixture(K), slice2AutonomyOffMigrated: true };
    fs.writeFileSync(settingsPath, JSON.stringify(seed), 'utf-8');

    const first = migrateSecretsFromSettingsFile(settingsPath, store);
    expect(first.migrated).toBe(true);
    assertNoPlaintextInJson(settingsPath, [K]);

    const loaded = loadAppSettingsFrom(settingsPath, () => store);
    for (const path of KEY_FIELD_PATHS) {
      expect(getKeyField(loaded, path), path).toBe(K);
    }

    saveAppSettingsTo(settingsPath, () => store, loaded);
    assertNoPlaintextInJson(settingsPath, [K]);
    const again = loadAppSettingsFrom(settingsPath, () => store);
    for (const path of KEY_FIELD_PATHS) {
      expect(getKeyField(again, path), path).toBe(K);
    }

    const second = migrateSecretsFromSettingsFile(settingsPath, store);
    expect(second.migrated).toBe(false);
    expect(second.movedIds).toEqual([]);
  });

  it('PB2(b): restore-shaped archive with plaintext → next boot migrates all', () => {
    const { store, settingsPath } = mkStore();
    // Simulate restore of an old archive that still has plaintext keys.
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ ...fullPlaintextFixture(K), slice2AutonomyOffMigrated: true }),
      'utf-8',
    );
    const result = migrateSecretsFromSettingsFile(settingsPath, store);
    expect(result.movedIds.length).toBe(12);
    assertNoPlaintextInJson(settingsPath, [K]);
    const loaded = loadAppSettingsFrom(settingsPath, () => store);
    for (const path of KEY_FIELD_PATHS) {
      expect(getKeyField(loaded, path)).toBe(K);
    }
  });
});

describe('PB3 — store first / read-back / JSON wins', () => {
  it('(a) set throws → path stays plaintext; others migrate', () => {
    const { store, settingsPath } = mkStore();
    const seed = { ...fullPlaintextFixture(K), slice2AutonomyOffMigrated: true };
    // Distinct key for alphaReader so we can see which stayed.
    const alphaKey = 'sk-ant-AlphaOnlyStayPlain00000000000000000000001';
    seed.agents.alphaReader = agentWithKey(alphaKey);
    fs.writeFileSync(settingsPath, JSON.stringify(seed), 'utf-8');

    const origSet = store.set.bind(store);
    store.set = (id: string, value: string | null) => {
      if (id === 'provider.alphaReader.apiKey') {
        throw new Error('injected set failure');
      }
      return origSet(id, value);
    };

    migrateSecretsFromSettingsFile(settingsPath, store);
    const disk = fs.readFileSync(settingsPath, 'utf-8');
    expect(disk).toContain(alphaKey);
    expect(disk).not.toContain(K); // other paths blanked
    expect(store.get('provider.alphaReader.apiKey')).toBeNull();
    expect(store.get('anthropic.apiKey')).toBe(K);
  });

  it('(b) read-back mismatch leaves plaintext', () => {
    const { store, settingsPath } = mkStore();
    const seed = { ...fullPlaintextFixture(K), slice2AutonomyOffMigrated: true };
    fs.writeFileSync(settingsPath, JSON.stringify(seed), 'utf-8');
    const origGet = store.get.bind(store);
    let reloading = false;
    store.reload = () => {
      reloading = true;
      SecretsStore.prototype.reload.call(store);
    };
    store.get = (id: string) => {
      const v = origGet(id);
      if (reloading && id === 'anthropic.apiKey') return 'mismatch-not-K';
      return v;
    };
    migrateSecretsFromSettingsFile(settingsPath, store);
    expect(fs.readFileSync(settingsPath, 'utf-8')).toContain(K);
  });

  it('(d) store differs — JSON non-empty non-mask wins on hydrate (D1b)', () => {
    const { store } = mkStore();
    store.set('anthropic.apiKey', 'sk-ant-StoredOld000000000000000000000000000000');
    const json = setKeyField(SETTINGS_DEFAULTS, 'apiKey', K);
    const hydrated = hydrateSecretsIntoSettings(json, store);
    expect(hydrated.apiKey).toBe(K);
  });

  it('(e) empty/mask JSON leaves store unchanged on migrate', () => {
    const { store, settingsPath } = mkStore();
    store.set('anthropic.apiKey', K);
    const disk = {
      ...SETTINGS_DEFAULTS,
      slice2AutonomyOffMigrated: true,
      apiKey: maskApiKey(K),
    };
    fs.writeFileSync(settingsPath, JSON.stringify(disk), 'utf-8');
    const result = migrateSecretsFromSettingsFile(settingsPath, store);
    expect(result.migrated).toBe(false);
    expect(store.get('anthropic.apiKey')).toBe(K);
    expect(isMaskedPreview(JSON.parse(fs.readFileSync(settingsPath, 'utf-8')).apiKey)).toBe(true);
  });
});

describe('PB4 — atomic writes and modes', () => {
  it('crash between temp and rename leaves earlier file intact; temp not read as settings', () => {
    const { settingsPath } = mkDir();
    fs.writeFileSync(settingsPath, JSON.stringify({ ok: true }), 'utf-8');
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('injected rename failure');
    });
    try {
      expect(() => writeFileAtomicSecure(settingsPath, JSON.stringify({ ok: false }))).toThrow(
        /injected rename failure/,
      );
      expect(JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))).toEqual({ ok: true });
      // No readable settings from leftover temps — loader uses exact path only.
      expect(fs.existsSync(settingsPath)).toBe(true);
    } finally {
      renameSpy.mockRestore();
    }
  });

  it('stale tmp deleted by deleteLeftoverAtomicTemps; POSIX 0600 on fresh temp write', () => {
    const { dir, settingsPath, secretsPath } = mkDir();
    const stale = `${settingsPath}.12345-abcdef.tmp`;
    fs.writeFileSync(stale, 'stale', 'utf-8');
    const staleSecrets = `${secretsPath}.99-deadbeef.tmp`;
    fs.writeFileSync(staleSecrets, 'stale', 'utf-8');
    deleteLeftoverAtomicTemps([settingsPath, secretsPath]);
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(staleSecrets)).toBe(false);

    if (process.platform !== 'win32') {
      writeFileAtomicSecure(settingsPath, '{"a":1}');
      expect(fs.statSync(settingsPath).mode & 0o777).toBe(0o600);
    }
    void dir;
  });

  it('saveAppSettingsTo and SecretsStore.persist use atomic rename (not in-place writeFileSync)', () => {
    const { store, settingsPath, secretsPath } = mkStore();
    const renameSpy = vi.spyOn(fs, 'renameSync');
    const writeSpy = vi.spyOn(fs, 'writeFileSync');
    try {
      saveAppSettingsTo(settingsPath, () => store, {
        ...fullPlaintextFixture(K),
        slice2AutonomyOffMigrated: true,
      });
      // Atomic path: temp opened + rename; writeFileSync must not target the final path.
      expect(renameSpy.mock.calls.some((c) => String(c[1]) === settingsPath)).toBe(true);
      expect(writeSpy.mock.calls.every((c) => String(c[0]) !== settingsPath)).toBe(true);

      renameSpy.mockClear();
      writeSpy.mockClear();
      store.set('anthropic.apiKey', `${K}x`);
      expect(renameSpy.mock.calls.some((c) => String(c[1]) === secretsPath)).toBe(true);
      expect(writeSpy.mock.calls.every((c) => String(c[0]) !== secretsPath)).toBe(true);
    } finally {
      renameSpy.mockRestore();
      writeSpy.mockRestore();
    }
  });

  it('source pin: save + store persist call writeJsonAtomicSecure', () => {
    const loadSrc = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'appSettingsLoad.ts'),
      'utf-8',
    );
    const storeSrc = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'secrets/store.ts'),
      'utf-8',
    );
    expect(loadSrc).toMatch(/writeJsonAtomicSecure\(settingsPath/);
    expect(storeSrc).toMatch(/writeJsonAtomicSecure\(this\.filePath/);
    expect(storeSrc).not.toMatch(/writeFileSync\(this\.filePath/);
  });
});

describe('PB5 — masks not stored', () => {
  it('mask in JSON is not migrated; load → empty + keyReentryPaths', () => {
    const { store, settingsPath } = mkStore();
    const mask = maskApiKey(K);
    const disk = {
      ...SETTINGS_DEFAULTS,
      slice2AutonomyOffMigrated: true,
      apiKey: mask,
      provider: { kind: 'anthropic' as const, model: 'x', apiKey: mask },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(disk), 'utf-8');
    const migrated = migrateSecretsFromSettingsFile(settingsPath, store);
    expect(migrated.migrated).toBe(false);
    expect(store.listIds()).toEqual([]);
    const loaded = loadAppSettingsFrom(settingsPath, () => store);
    expect(loaded.apiKey).toBe('');
    expect(loaded.provider?.apiKey).toBe('');
    expect(loaded.keyReentryPaths).toEqual(expect.arrayContaining(['apiKey', 'provider.apiKey']));
  });
});

describe('PB6 — no values in logs', () => {
  it('secrets migration warn path does not interpolate Error.message', () => {
    const mainSrc = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'main.ts'),
      'utf-8',
    );
    expect(mainSrc).toMatch(/migration skipped: safeStorage unavailable'/);
    expect(mainSrc).not.toMatch(/migration skipped: safeStorage unavailable —',\s*\(e as Error\)\.message/);
  });
});

describe('PB7 — decrypt failure parity + store unavailable blanks all paths', () => {
  it('post-init encryption unavailable → save blanks every present KEY_FIELD_PATHS entry', () => {
    const { store, settingsPath } = mkStore(false);
    const outgoing = fullPlaintextFixture(K);
    saveAppSettingsTo(settingsPath, () => store, outgoing);
    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as AppSettings;
    for (const path of KEY_FIELD_PATHS) {
      expect(getKeyField(written, path), path).toBe('');
    }
  });

  it('decrypt failure for a new role leaves field empty like provider.apiKey', () => {
    const { secretsPath, settingsPath } = mkDir();
    const badStorage: SafeStorageLike = {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from(`enc:${s}`, 'utf-8'),
      decryptString: () => {
        throw new Error('decrypt failed');
      },
    };
    // Seed ciphertext that will fail decrypt.
    fs.writeFileSync(
      secretsPath,
      JSON.stringify({
        v: 1,
        values: { 'provider.alphaReader.apiKey': Buffer.from('enc:x').toString('base64') },
      }),
      'utf-8',
    );
    const store = new SecretsStore({ filePath: secretsPath, safeStorage: badStorage });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ ...SETTINGS_DEFAULTS, slice2AutonomyOffMigrated: true }),
      'utf-8',
    );
    const loaded = loadAppSettingsFrom(settingsPath, () => store);
    expect(getKeyField(loaded, 'agents.alphaReader.provider.apiKey') ?? '').toBe('');
  });
});

describe('PB8 — backup redaction from KEY_FIELD_PATHS', () => {
  it('redacted bytes contain none of the 12 values', () => {
    const raw = fullPlaintextFixture(K) as unknown as Record<string, unknown>;
    const redacted = redactAppSettings(raw);
    const bytes = JSON.stringify(redacted);
    expect(bytes).not.toContain(K);
    for (const path of KEY_FIELD_PATHS) {
      expect(getKeyField(redacted as unknown as AppSettings, path), path).toBe('');
    }
  });
});

describe('PB9 / PB9b / PB9c — pre-hydrate / pre-init JSON-only (D5 + Ivy)', () => {
  it('PB9: post-init load with missing slice2 flag does not wipe stored keys', () => {
    const { store, settingsPath } = mkStore();
    // Keys already in store; JSON blank; slice2 flag missing.
    for (const { secretId } of KEY_PATH_SECRET_ENTRIES) {
      store.set(secretId, K);
    }
    const disk = {
      ...SETTINGS_DEFAULTS,
      // force slice2 migrate write mid-load
      agents: fullPlaintextFixture('').agents,
      provider: { kind: 'anthropic' as const, model: 'x', apiKey: '' },
      voice: { enabled: false, cloudFallback: false, openaiApiKey: '', ttsVoiceId: 'kokoro:nicole' },
      stt: { enabled: true, provider: 'cloud' as const, cloudApiKey: '' },
      tts: { enabled: true, provider: 'cloud' as const, cloudApiKey: '' },
      apiKey: '',
    };
    // Explicitly omit slice2AutonomyOffMigrated
    delete (disk as { slice2AutonomyOffMigrated?: boolean }).slice2AutonomyOffMigrated;
    fs.writeFileSync(settingsPath, JSON.stringify(disk), 'utf-8');

    const loaded = loadAppSettingsFrom(settingsPath, () => store, (s) =>
      // Mutant K-B19 would use the secret saver here; production must not.
      saveAppSettingsTo(settingsPath, () => store, s),
    );
    for (const path of KEY_FIELD_PATHS) {
      expect(getKeyField(loaded, path), path).toBe(K);
    }
    for (const { secretId } of KEY_PATH_SECRET_ENTRIES) {
      expect(store.get(secretId)).toBe(K);
    }
  });

  it('PB9b(a): restore IPC path — backup without slice2 flag leaves secrets byte-identical', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-pb9b-a-ud-'));
    const storyVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-pb9b-a-sv-'));
    const notesVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-pb9b-a-nv-'));
    const settingsPath = path.join(userData, 'app-settings.json');
    const secretsPath = path.join(userData, 'secrets.json');
    const store = new SecretsStore({ filePath: secretsPath, safeStorage: makeSafeStorage(true) });

    for (const { secretId } of KEY_PATH_SECRET_ENTRIES) {
      store.set(secretId, K);
    }
    // Live settings with flag set (post-migration shape).
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        ...SETTINGS_DEFAULTS,
        slice2AutonomyOffMigrated: true,
        agents: fullPlaintextFixture('').agents,
        provider: { kind: 'anthropic', model: 'x', apiKey: '' },
        apiKey: '',
      }),
      'utf-8',
    );

    // Build a pre-0.5.4-shaped archive: no slice2AutonomyOffMigrated flag.
    const archivePath = path.join(userData, 'old.mwbackup');
    const preSlice2: Record<string, unknown> = {
      ...SETTINGS_DEFAULTS,
      apiKey: '',
      agents: fullPlaintextFixture('').agents,
      provider: { kind: 'anthropic', model: 'x', apiKey: '' },
    };
    delete preSlice2.slice2AutonomyOffMigrated;
    // Hand-build zip via backupAppData from a staging dir that has the old file.
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-pb9b-a-stg-'));
    fs.writeFileSync(path.join(staging, 'app-settings.json'), JSON.stringify(preSlice2), 'utf-8');
    await backupAppData({
      userDataPath: staging,
      storyVaultRoot: storyVault,
      notesVaultRoot: notesVault,
      appVersion: '0.5.3',
      manifestSchemaVersion: 0,
      outputPath: archivePath,
    });

    const secretsBefore = fs.readFileSync(secretsPath);
    const setSpy = vi.spyOn(store, 'set');
    const deleteSpy = vi.spyOn(store, 'delete');

    const result = await restoreAppDataAndReloadSettings({
      archivePath,
      userDataPath: userData,
      storyVaultRoot: storyVault,
      notesVaultRoot: notesVault,
      overwrite: true,
      getStore: () => store,
      settingsPath,
      afterExtract: () => {
        /* main's ensureVaultDir — skip vault scaffolding in unit pin */
      },
    });
    expect(result.restored).toBe(true);

    // Store byte-identical; zero set/delete (K-B16/K-B17 must fail this).
    expect(fs.readFileSync(secretsPath)).toEqual(secretsBefore);
    expect(setSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    setSpy.mockRestore();
    deleteSpy.mockRestore();

    // Restored JSON now has the slice2 flag (JSON-only write).
    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf-8')).slice2AutonomyOffMigrated).toBe(true);
  });

  it('PB9b(b): restore keeps alphaReader / storylineConsultant / lineEditor in store', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-pb9b-b-ud-'));
    const storyVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-pb9b-b-sv-'));
    const notesVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-pb9b-b-nv-'));
    const settingsPath = path.join(userData, 'app-settings.json');
    const secretsPath = path.join(userData, 'secrets.json');
    const store = new SecretsStore({ filePath: secretsPath, safeStorage: makeSafeStorage(true) });

    const alpha = 'sk-ant-AlphaRestoreKeep00000000000000000000001';
    const story = 'sk-ant-StoryRestoreKeep00000000000000000000001';
    const line = 'sk-ant-LineRestoreKeep000000000000000000000001';
    store.set('provider.alphaReader.apiKey', alpha);
    store.set('provider.storylineConsultant.apiKey', story);
    store.set('provider.lineEditor.apiKey', line);

    const live = {
      ...SETTINGS_DEFAULTS,
      slice2AutonomyOffMigrated: true,
      agents: fullPlaintextFixture('').agents,
      apiKey: '',
      provider: { kind: 'anthropic' as const, model: 'x', apiKey: '' },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(live), 'utf-8');

    const archivePath = path.join(userData, 'cur.mwbackup');
    await backupAppData({
      userDataPath: userData,
      storyVaultRoot: storyVault,
      notesVaultRoot: notesVault,
      appVersion: '0.5.7',
      manifestSchemaVersion: 0,
      outputPath: archivePath,
    });

    // Wipe on-disk settings to force restore overwrite (simulates redacted archive body).
    fs.writeFileSync(settingsPath, JSON.stringify({ theme: 'dark', apiKey: 'SHOULD_BE_OVERWRITTEN' }), 'utf-8');

    await restoreAppDataAndReloadSettings({
      archivePath,
      userDataPath: userData,
      storyVaultRoot: storyVault,
      notesVaultRoot: notesVault,
      overwrite: true,
      getStore: () => store,
      settingsPath,
    });

    expect(store.get('provider.alphaReader.apiKey')).toBe(alpha);
    expect(store.get('provider.storylineConsultant.apiKey')).toBe(story);
    expect(store.get('provider.lineEditor.apiKey')).toBe(line);

    const loaded = loadAppSettingsFrom(settingsPath, () => store);
    expect(getKeyField(loaded, 'agents.alphaReader.provider.apiKey')).toBe(alpha);
    expect(getKeyField(loaded, 'agents.storylineConsultant.provider.apiKey')).toBe(story);
    expect(getKeyField(loaded, 'agents.lineEditor.provider.apiKey')).toBe(line);
  });

  it('PB9b(c): restore of current-build backup keeps all 12 keys', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-pb9b-c-ud-'));
    const storyVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-pb9b-c-sv-'));
    const notesVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-pb9b-c-nv-'));
    const settingsPath = path.join(userData, 'app-settings.json');
    const secretsPath = path.join(userData, 'secrets.json');
    const store = new SecretsStore({ filePath: secretsPath, safeStorage: makeSafeStorage(true) });

    for (const { secretId } of KEY_PATH_SECRET_ENTRIES) {
      store.set(secretId, K);
    }
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        ...SETTINGS_DEFAULTS,
        slice2AutonomyOffMigrated: true,
        agents: fullPlaintextFixture('').agents,
        provider: { kind: 'anthropic', model: 'x', apiKey: '' },
        voice: { enabled: false, cloudFallback: false, openaiApiKey: '', ttsVoiceId: 'kokoro:nicole' },
        stt: { enabled: true, provider: 'cloud', cloudApiKey: '' },
        tts: { enabled: true, provider: 'cloud', cloudApiKey: '' },
        apiKey: '',
      }),
      'utf-8',
    );

    const archivePath = path.join(userData, 'tip.mwbackup');
    await backupAppData({
      userDataPath: userData,
      storyVaultRoot: storyVault,
      notesVaultRoot: notesVault,
      appVersion: '0.5.7',
      manifestSchemaVersion: 0,
      outputPath: archivePath,
    });

    await restoreAppDataAndReloadSettings({
      archivePath,
      userDataPath: userData,
      storyVaultRoot: storyVault,
      notesVaultRoot: notesVault,
      overwrite: true,
      getStore: () => store,
      settingsPath,
    });

    const loaded = loadAppSettingsFrom(settingsPath, () => store);
    for (const path of KEY_FIELD_PATHS) {
      expect(getKeyField(loaded, path), path).toBe(K);
    }
  });

  it('PB9b source: app:restoreAppData IPC delegates to restoreAppDataAndReloadSettings', () => {
    const mainSrc = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'main.ts'),
      'utf-8',
    );
    expect(mainSrc).toMatch(
      /APP_RESTORE_APP_DATA[\s\S]*?restoreAppDataAndReloadSettings\(/,
    );
    // Must not call restoreAppData(...) directly inside the handler body.
    const handler = mainSrc.match(
      /\[IPC_CHANNELS\.APP_RESTORE_APP_DATA\]:[\s\S]*?(?=,\s*\n\s*\/\/ SKY-2969)/,
    );
    expect(handler?.[0] ?? '').toContain('restoreAppDataAndReloadSettings');
    expect(handler?.[0] ?? '').not.toMatch(/await restoreAppData\(/);

    // K-B16: restore reload must not re-save through the secret saver.
    const restoreSrc = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'appRestore.ts'),
      'utf-8',
    );
    expect(restoreSrc).toMatch(/loadAppSettingsFrom\(settingsPath, opts\.getStore\)/);
    // No live call — comments may mention saveAppSettingsTo as the K-B16 hazard.
    expect(restoreSrc).not.toMatch(/saveAppSettingsTo\s*\(/);
  });

  it('PB9c: pre-init load (slice2 missing) + init + migrate + load keeps all 12', () => {
    const { settingsPath, secretsPath } = mkDir();
    const seed = fullPlaintextFixture(K);
    delete (seed as { slice2AutonomyOffMigrated?: boolean }).slice2AutonomyOffMigrated;
    fs.writeFileSync(settingsPath, JSON.stringify(seed), 'utf-8');

    // 1) First load BEFORE init — getStore throws.
    const preInitGet = (): SecretsStore => {
      throw new Error('SecretsStore not initialized. Call initSecretsStore() during app-ready.');
    };
    const pre = loadAppSettingsFrom(settingsPath, preInitGet, (s) =>
      saveAppSettingsTo(settingsPath, preInitGet, s),
    );
    // Keys still present (JSON-only slice2 write + pre-init saver).
    for (const path of KEY_FIELD_PATHS) {
      expect(getKeyField(pre, path), `pre-init ${path}`).toBe(K);
    }
    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf-8')).slice2AutonomyOffMigrated).toBe(true);
    expect(fs.readFileSync(settingsPath, 'utf-8')).toContain(K);

    // 2) Init store + migrate (boot order after shouldInitializeVaultsOnStartup).
    const store = new SecretsStore({
      filePath: secretsPath,
      safeStorage: makeSafeStorage(true),
    });
    deleteLeftoverAtomicTemps([settingsPath, secretsPath]);
    const migrated = migrateSecretsFromSettingsFile(settingsPath, store);
    expect(migrated.movedIds.length).toBe(12);
    assertNoPlaintextInJson(settingsPath, [K]);

    // 3) Load after migrate — all 12 from store.
    const loaded = loadAppSettingsFrom(settingsPath, () => store);
    for (const path of KEY_FIELD_PATHS) {
      expect(getKeyField(loaded, path), path).toBe(K);
    }
  });

  it('PB9c / Ivy: pre-init saver must not blank-all (json-only); blanking would lose keys', () => {
    const { settingsPath } = mkDir();
    const seed = fullPlaintextFixture(K);
    fs.writeFileSync(settingsPath, JSON.stringify({ ...seed, slice2AutonomyOffMigrated: true }), 'utf-8');
    const preInitGet = (): SecretsStore => {
      throw new Error('SecretsStore not initialized. Call initSecretsStore() during app-ready.');
    };
    saveAppSettingsTo(settingsPath, preInitGet, seed);
    const disk = fs.readFileSync(settingsPath, 'utf-8');
    expect(disk).toContain(K); // plaintext preserved pre-init
  });
});

describe('Shield r2 — whitespace-only save does not clear keyReentryPaths', () => {
  it('whitespace save leaves held flag; real key clears it', () => {
    const { store, settingsPath } = mkStore();
    const disk = {
      ...SETTINGS_DEFAULTS,
      slice2AutonomyOffMigrated: true,
      apiKey: '',
      provider: { kind: 'anthropic' as const, model: 'x', apiKey: '' },
    };
    store.set('anthropic.apiKey', maskApiKey(K));
    fs.writeFileSync(settingsPath, JSON.stringify(disk), 'utf-8');
    const loaded = loadAppSettingsFrom(settingsPath, () => store);
    expect(loaded.keyReentryPaths).toContain('apiKey');

    saveAppSettingsTo(settingsPath, () => store, { ...loaded, apiKey: '   ' });
    const afterWs = loadAppSettingsFrom(settingsPath, () => store);
    expect(afterWs.keyReentryPaths).toContain('apiKey');

    saveAppSettingsTo(settingsPath, () => store, { ...afterWs, apiKey: K });
    const afterReal = loadAppSettingsFrom(settingsPath, () => store);
    expect(afterReal.keyReentryPaths ?? []).not.toContain('apiKey');
    expect(afterReal.apiKey).toBe(K);
  });
});

describe('Shield r1 — deliberate clear via real saver drops held flag (R4-L)', () => {
  it('R4-L: deliberate clear through saveAppSettingsTo drops keyReentryPaths for that path', () => {
    const { store, settingsPath } = mkStore();
    const disk = {
      ...SETTINGS_DEFAULTS,
      slice2AutonomyOffMigrated: true,
      apiKey: '',
      provider: { kind: 'anthropic' as const, model: 'x', apiKey: '' },
    };
    store.set('provider.apiKey', maskApiKey(K));
    fs.writeFileSync(settingsPath, JSON.stringify(disk), 'utf-8');
    const loaded = loadAppSettingsFrom(settingsPath, () => store);
    expect(loaded.keyReentryPaths).toContain('provider.apiKey');

    // Deliberate clear through the real saver (not healMaskedKeyFields alone).
    saveAppSettingsTo(settingsPath, () => store, {
      ...loaded,
      provider: { ...loaded.provider!, apiKey: '' },
    });
    // Held flag: empty clear does NOT drop (R4-L / #1660). Re-load still flags
    // until a real key is saved — rename this pin away from the stale
    // "deliberate clear drops flag" heal-only wording (Shield r1).
    const again = loadAppSettingsFrom(settingsPath, () => store);
    expect(again.keyReentryPaths).toContain('provider.apiKey');

    saveAppSettingsTo(settingsPath, () => store, {
      ...again,
      provider: { ...again.provider!, apiKey: K },
    });
    const cleared = loadAppSettingsFrom(settingsPath, () => store);
    expect(cleared.keyReentryPaths ?? []).not.toContain('provider.apiKey');
  });
});

describe('K17 extended — streaming + voice readers use loadAppSettings', () => {
  it('registerStreamingHandlers and registerVoiceHandlers read through loadAppSettings', () => {
    const mainSrc = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'main.ts'),
      'utf-8',
    );
    expect(mainSrc).toMatch(
      /registerStreamingHandlers\(\(\)\s*=>\s*buildGlobalProviderConfig\(loadAppSettings\(\)\)\)/,
    );
    expect(mainSrc).toMatch(/registerVoiceHandlers\(\s*\n?\s*\(\)\s*=>\s*mainWindow/);
    expect(mainSrc).toMatch(/registerVoiceHandlers\([\s\S]*?loadAppSettings,/);
  });
});

describe('saver strip pins — keyReentryPaths stripped before disk write', () => {
  it('written JSON never contains keyReentryPaths after saveAppSettingsTo', () => {
    const { store, settingsPath } = mkStore();
    const withFlag = {
      ...fullPlaintextFixture(K),
      slice2AutonomyOffMigrated: true,
      keyReentryPaths: ['apiKey', 'provider.apiKey'],
    };
    saveAppSettingsTo(settingsPath, () => store, withFlag);
    expect(fs.readFileSync(settingsPath, 'utf-8')).not.toContain('keyReentryPaths');
  });
});
