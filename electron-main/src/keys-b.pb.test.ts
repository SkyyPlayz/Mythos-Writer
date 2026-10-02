/**
 * KEYS-B pins (PB1–PB9c) + Shield r1–r3 riders for plaintext per-agent keys.
 * Every pin must fail at base ccde644d and when its own fix is reverted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';
import type { AppSettings } from './ipc.js';
import {
  SETTINGS_DEFAULTS,
  loadAppSettingsFrom,
  markOnboardingCompleteJsonOnly,
  saveAppSettingsTo,
} from './appSettingsLoad.js';
import { redactAppSettings, restoreAppData } from './backup.js';
import { backupAppData } from './backup.js';
import { restoreAppDataAndReloadSettings } from './appRestore.js';
import { sanitizeIpcError } from './ipcErrors.js';
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
    decryptString: (buf: Buffer) => {
      const raw = buf.toString('utf-8');
      if (!raw.startsWith('enc:')) throw new Error('bad ciphertext');
      return raw.slice('enc:'.length);
    },
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

  it('PB2(c): second boot and empty/mask-only boot write ZERO bytes to app-settings.json via migrate (K-B9; E3 migrate path only)', () => {
    const { store, settingsPath } = mkStore();
    const seed = { ...fullPlaintextFixture(K), slice2AutonomyOffMigrated: true };
    fs.writeFileSync(settingsPath, JSON.stringify(seed), 'utf-8');
    expect(migrateSecretsFromSettingsFile(settingsPath, store).migrated).toBe(true);

    // Atomic rewrite ends in fs.renameSync(tmp → settingsPath). Mutant K-B9
    // that writes JSON even when nothing moved must fail this pin.
    const renameSpy = vi.spyOn(fs, 'renameSync');
    try {
      const before = fs.statSync(settingsPath);
      const second = migrateSecretsFromSettingsFile(settingsPath, store);
      expect(second.migrated).toBe(false);
      expect(renameSpy.mock.calls.filter((c) => String(c[1]) === settingsPath)).toHaveLength(0);
      const after = fs.statSync(settingsPath);
      expect(after.ino).toBe(before.ino);
      expect(after.mtimeMs).toBe(before.mtimeMs);

      // Boot with only empty / mask values — must not rewrite JSON either.
      renameSpy.mockClear();
      const mask = maskApiKey(K);
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({
          ...SETTINGS_DEFAULTS,
          slice2AutonomyOffMigrated: true,
          apiKey: '',
          provider: { kind: 'anthropic', model: 'x', apiKey: mask },
        }),
        'utf-8',
      );
      const beforeMask = fs.statSync(settingsPath);
      const emptyBoot = migrateSecretsFromSettingsFile(settingsPath, store);
      expect(emptyBoot.migrated).toBe(false);
      expect(renameSpy.mock.calls.filter((c) => String(c[1]) === settingsPath)).toHaveLength(0);
      const afterMask = fs.statSync(settingsPath);
      expect(afterMask.ino).toBe(beforeMask.ino);
      expect(afterMask.mtimeMs).toBe(beforeMask.mtimeMs);
    } finally {
      renameSpy.mockRestore();
    }
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

  it('(c) set throws on boot → next boot retries and migrates the leftover plaintext', () => {
    const { store, settingsPath } = mkStore();
    const seed = { ...fullPlaintextFixture(K), slice2AutonomyOffMigrated: true };
    fs.writeFileSync(settingsPath, JSON.stringify(seed), 'utf-8');

    const origSet = store.set.bind(store);
    store.set = () => {
      throw new Error('injected set failure');
    };
    migrateSecretsFromSettingsFile(settingsPath, store);
    expect(fs.readFileSync(settingsPath, 'utf-8')).toContain(K);
    expect(store.listIds()).toEqual([]);

    // Next boot: set works again → migrate retries leftover plaintext.
    store.set = origSet;
    const second = migrateSecretsFromSettingsFile(settingsPath, store);
    expect(second.movedIds.length).toBe(KEY_FIELD_PATHS.length);
    assertNoPlaintextInJson(settingsPath, [K]);
    const loaded = loadAppSettingsFrom(settingsPath, () => store);
    for (const p of KEY_FIELD_PATHS) {
      expect(getKeyField(loaded, p), p).toBe(K);
    }
  });

  it('(d) boot → load → save → load keeps all 12 from store; JSON blank (real loader)', () => {
    const { store, settingsPath } = mkStore();
    const seed = { ...fullPlaintextFixture(K), slice2AutonomyOffMigrated: true };
    fs.writeFileSync(settingsPath, JSON.stringify(seed), 'utf-8');
    expect(migrateSecretsFromSettingsFile(settingsPath, store).movedIds.length).toBe(12);

    const loaded = loadAppSettingsFrom(settingsPath, () => store);
    for (const p of KEY_FIELD_PATHS) {
      expect(getKeyField(loaded, p), `load1 ${p}`).toBe(K);
    }
    saveAppSettingsTo(settingsPath, () => store, { ...loaded, theme: 'dark' });
    assertNoPlaintextInJson(settingsPath, [K]);
    const again = loadAppSettingsFrom(settingsPath, () => store);
    for (const p of KEY_FIELD_PATHS) {
      expect(getKeyField(again, p), `load2 ${p}`).toBe(K);
    }
    expect(again.theme).toBe('dark');
  });

  it('(d-hydrate) store differs — JSON non-empty non-mask wins on hydrate (D1b)', () => {
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

  it('(f) set throws with stale store → real loader serves JSON plaintext', () => {
    const { store, settingsPath } = mkStore();
    const K_STALE = 'sk-ant-StaleInStore0000000000000000000000000000001';
    store.set('anthropic.apiKey', K_STALE);
    const seed = {
      ...SETTINGS_DEFAULTS,
      slice2AutonomyOffMigrated: true,
      apiKey: K,
    };
    fs.writeFileSync(settingsPath, JSON.stringify(seed), 'utf-8');
    store.set = () => {
      throw new Error('injected set failure');
    };
    migrateSecretsFromSettingsFile(settingsPath, store);
    // Stale store value still present; JSON plaintext left for loader (D1b).
    expect(store.get('anthropic.apiKey')).toBe(K_STALE);
    expect(fs.readFileSync(settingsPath, 'utf-8')).toContain(K);
    const loaded = loadAppSettingsFrom(settingsPath, () => store);
    expect(loaded.apiKey).toBe(K);
  });

  it('(f2) migrate overwrites stale store with JSON plaintext then blanks JSON (K-B12)', () => {
    const K_OLD = 'sk-ant-StaleStoredOld00000000000000000000000000001';
    const K_NEW = 'sk-ant-FreshJsonNew000000000000000000000000000001';

    // provider.lineEditor.apiKey
    {
      const { store, settingsPath } = mkStore();
      store.set('provider.lineEditor.apiKey', K_OLD);
      const seed = {
        ...SETTINGS_DEFAULTS,
        slice2AutonomyOffMigrated: true,
        agents: {
          ...SETTINGS_DEFAULTS.agents,
          lineEditor: agentWithKey(K_NEW),
        },
      };
      fs.writeFileSync(settingsPath, JSON.stringify(seed), 'utf-8');
      migrateSecretsFromSettingsFile(settingsPath, store);
      expect(store.get('provider.lineEditor.apiKey')).toBe(K_NEW);
      const disk = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as AppSettings;
      expect(getKeyField(disk, 'agents.lineEditor.provider.apiKey')).toBe('');
      expect(fs.readFileSync(settingsPath, 'utf-8')).not.toContain(K_NEW);
      expect(fs.readFileSync(settingsPath, 'utf-8')).not.toContain(K_OLD);
    }

    // anthropic.apiKey (top-level apiKey)
    {
      const { store, settingsPath } = mkStore();
      store.set('anthropic.apiKey', K_OLD);
      const seed = {
        ...SETTINGS_DEFAULTS,
        slice2AutonomyOffMigrated: true,
        apiKey: K_NEW,
      };
      fs.writeFileSync(settingsPath, JSON.stringify(seed), 'utf-8');
      migrateSecretsFromSettingsFile(settingsPath, store);
      expect(store.get('anthropic.apiKey')).toBe(K_NEW);
      const disk = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as AppSettings;
      expect(disk.apiKey).toBe('');
      expect(fs.readFileSync(settingsPath, 'utf-8')).not.toContain(K_NEW);
      expect(fs.readFileSync(settingsPath, 'utf-8')).not.toContain(K_OLD);
    }
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

  it('temp cleanup only removes basename.*.tmp for listed targets (prefix pin)', () => {
    const { dir, settingsPath, secretsPath } = mkDir();
    const unrelated = path.join(dir, 'unrelated.tmp');
    const vaultSettingsTmp = path.join(dir, 'vault-settings.json.123-abc.tmp');
    const bareAppSettingsTmp = path.join(dir, 'app-settings.json.tmp');
    const realLeftover = `${settingsPath}.${process.pid}-deadbeef.tmp`;
    fs.writeFileSync(unrelated, 'keep', 'utf-8');
    fs.writeFileSync(vaultSettingsTmp, 'keep', 'utf-8');
    fs.writeFileSync(bareAppSettingsTmp, 'keep', 'utf-8');
    fs.writeFileSync(realLeftover, 'drop', 'utf-8');

    deleteLeftoverAtomicTemps([settingsPath, secretsPath]);

    expect(fs.existsSync(unrelated)).toBe(true);
    expect(fs.existsSync(vaultSettingsTmp)).toBe(true);
    expect(fs.existsSync(bareAppSettingsTmp)).toBe(true);
    expect(fs.existsSync(realLeftover)).toBe(false);
  });

  it('temp name shape ^<name>.<pid>-[0-9a-f]{12}.tmp$; two writes produce distinct names', () => {
    const { settingsPath } = mkDir();
    const openSpy = vi.spyOn(fs, 'openSync');
    try {
      writeFileAtomicSecure(settingsPath, '{"a":1}');
      writeFileAtomicSecure(settingsPath, '{"a":2}');
      const temps = openSpy.mock.calls
        .map((c) => String(c[0]))
        .filter((p) => p.startsWith(`${settingsPath}.`) && p.endsWith('.tmp'));
      expect(temps.length).toBeGreaterThanOrEqual(2);
      const re = new RegExp(
        `^${settingsPath.replace(/[.*+?^${}()|[\]\\]/g, '\\.')}\\.${process.pid}-[0-9a-f]{12}\\.tmp$`,
      );
      for (const t of temps) {
        expect(t).toMatch(re);
      }
      expect(new Set(temps).size).toBe(temps.length);
    } finally {
      openSpy.mockRestore();
    }
  });

  it('fixed-name leftover at <target>.tmp does not block next save (K-B14)', () => {
    const { store, settingsPath, secretsPath } = mkStore();
    const fixedSettings = `${settingsPath}.tmp`;
    const fixedSecrets = `${secretsPath}.tmp`;
    fs.writeFileSync(fixedSettings, 'leftover', 'utf-8');
    fs.writeFileSync(fixedSecrets, 'leftover', 'utf-8');
    expect(() =>
      saveAppSettingsTo(settingsPath, () => store, {
        ...fullPlaintextFixture(K),
        slice2AutonomyOffMigrated: true,
      }),
    ).not.toThrow();
    expect(fs.existsSync(settingsPath)).toBe(true);
    expect(fs.existsSync(secretsPath)).toBe(true);
    // Fixed .tmp name is not our pid-random shape — must still be ignorable.
    expect(fs.existsSync(fixedSettings)).toBe(true);
  });

  it('after renameSync/writeSync/fsyncSync failure: no *.tmp left; next save succeeds for both files', () => {
    const { store, settingsPath, secretsPath } = mkStore();
    fs.writeFileSync(settingsPath, JSON.stringify({ ...SETTINGS_DEFAULTS, slice2AutonomyOffMigrated: true }), 'utf-8');

    const assertNoTmp = () => {
      for (const base of [settingsPath, secretsPath]) {
        const dir = path.dirname(base);
        const name = path.basename(base);
        for (const ent of fs.readdirSync(dir)) {
          if (ent.startsWith(`${name}.`) && ent.endsWith('.tmp')) {
            expect.fail(`leftover temp: ${ent}`);
          }
        }
      }
    };

    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('injected rename failure');
    });
    try {
      expect(() => writeFileAtomicSecure(settingsPath, '{"x":1}')).toThrow(/injected rename failure/);
      expect(() => writeFileAtomicSecure(secretsPath, '{"v":1}')).toThrow(/injected rename failure/);
      assertNoTmp();
    } finally {
      renameSpy.mockRestore();
    }

    const writeSpy = vi.spyOn(fs, 'writeSync').mockImplementation(() => {
      throw new Error('injected write failure');
    });
    try {
      expect(() => writeFileAtomicSecure(settingsPath, '{"x":2}')).toThrow(/injected write failure/);
      assertNoTmp();
    } finally {
      writeSpy.mockRestore();
    }

    const fsyncSpy = vi.spyOn(fs, 'fsyncSync').mockImplementation(() => {
      throw new Error('injected fsync failure');
    });
    try {
      expect(() => writeFileAtomicSecure(settingsPath, '{"x":3}')).toThrow(/injected fsync failure/);
      assertNoTmp();
    } finally {
      fsyncSpy.mockRestore();
    }

    // Next save succeeds for both files; secrets.json ends 0600.
    saveAppSettingsTo(settingsPath, () => store, {
      ...fullPlaintextFixture(K),
      slice2AutonomyOffMigrated: true,
    });
    expect(fs.existsSync(settingsPath)).toBe(true);
    expect(fs.existsSync(secretsPath)).toBe(true);
    if (process.platform !== 'win32') {
      expect(fs.statSync(secretsPath).mode & 0o777).toBe(0o600);
    }
    assertNoTmp();
  });

  it('fsyncSync is called on the temp fd before rename', () => {
    const { settingsPath } = mkDir();
    const fsyncSpy = vi.spyOn(fs, 'fsyncSync');
    const renameSpy = vi.spyOn(fs, 'renameSync');
    try {
      writeFileAtomicSecure(settingsPath, '{"ok":true}');
      expect(fsyncSpy).toHaveBeenCalled();
      expect(renameSpy).toHaveBeenCalled();
      const fsyncOrder = fsyncSpy.mock.invocationCallOrder[0]!;
      const renameOrder = renameSpy.mock.invocationCallOrder[0]!;
      expect(fsyncOrder).toBeLessThan(renameOrder);
    } finally {
      fsyncSpy.mockRestore();
      renameSpy.mockRestore();
    }
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

  it('source pin: save + store + migration + slice2 call writeJsonAtomicSecure', () => {
    const loadSrc = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'appSettingsLoad.ts'),
      'utf-8',
    );
    const storeSrc = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'secrets/store.ts'),
      'utf-8',
    );
    const migSrc = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'secrets/migration.ts'),
      'utf-8',
    );
    expect(loadSrc).toMatch(/writeJsonAtomicSecure\(settingsPath/);
    expect(loadSrc).toMatch(/writeJsonAtomicSecure\(settingsPath,\s*stripKeyReentryPaths\(base\)\)/);
    expect(storeSrc).toMatch(/writeJsonAtomicSecure\(this\.filePath/);
    expect(storeSrc).not.toMatch(/writeFileSync\(this\.filePath/);
    expect(migSrc).toMatch(/writeJsonAtomicSecure\(settingsPath/);
    expect(migSrc).not.toMatch(/writeFileSync\(settingsPath/);
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

  it('behavioral: migrate never logs any of 12 plaintext values (K-B5)', () => {
    // Twelve distinct values so a path/value warn cannot hide behind a shared constant.
    const values = KEY_FIELD_PATHS.map(
      (_, i) => `sk-ant-LogPin${String(i).padStart(2, '0')}0000000000000000000000000001`,
    );
    let seed = fullPlaintextFixture(values[0]!);
    for (let i = 0; i < KEY_FIELD_PATHS.length; i++) {
      seed = setKeyField(seed, KEY_FIELD_PATHS[i]!, values[i]!);
    }

    const capture: string[] = [];
    const record = (...args: unknown[]) => {
      capture.push(args.map((a) => {
        try {
          return typeof a === 'string' ? a : JSON.stringify(a);
        } catch {
          return String(a);
        }
      }).join(' '));
    };
    const logSpy = vi.spyOn(console, 'log').mockImplementation(record);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(record);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(record);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(record);
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(record);

    const assertNoValuesLogged = () => {
      const blob = capture.join('\n');
      for (const v of values) {
        expect(blob, `log must not contain ${v}`).not.toContain(v);
        // K-B5b: no ≥8-char substring of any seeded value.
        for (let i = 0; i + 8 <= v.length; i++) {
          const sub = v.slice(i, i + 8);
          expect(blob, `log must not contain substring ${sub}`).not.toContain(sub);
        }
      }
    };

    try {
      // 1) Working store — full migrate.
      {
        const { store, settingsPath } = mkStore();
        fs.writeFileSync(settingsPath, JSON.stringify({ ...seed, slice2AutonomyOffMigrated: true }), 'utf-8');
        capture.length = 0;
        migrateSecretsFromSettingsFile(settingsPath, store);
        assertNoValuesLogged();
      }

      // 2) store.set throws for every id — leave plaintext; still no value logs.
      {
        const { store, settingsPath } = mkStore();
        fs.writeFileSync(settingsPath, JSON.stringify({ ...seed, slice2AutonomyOffMigrated: true }), 'utf-8');
        store.set = () => {
          throw new Error('injected set failure');
        };
        capture.length = 0;
        migrateSecretsFromSettingsFile(settingsPath, store);
        assertNoValuesLogged();
      }

      // 3) Read-back mismatch for every id — leave plaintext; still no value logs.
      {
        const { store, settingsPath } = mkStore();
        fs.writeFileSync(settingsPath, JSON.stringify({ ...seed, slice2AutonomyOffMigrated: true }), 'utf-8');
        const origGet = store.get.bind(store);
        store.get = (id: string) => {
          const v = origGet(id);
          return v ? `mismatch-not-${v}` : v;
        };
        capture.length = 0;
        migrateSecretsFromSettingsFile(settingsPath, store);
        assertNoValuesLogged();
      }

      // 4) Saver O1 (encryption unavailable) — blank-all; no value/substring logs.
      {
        const { store, settingsPath } = mkStore(false);
        capture.length = 0;
        saveAppSettingsTo(settingsPath, () => store, { ...seed, slice2AutonomyOffMigrated: true });
        assertNoValuesLogged();
      }

      // 5) Pre-init saver — JSON-only; no value/substring logs.
      {
        const { settingsPath } = mkDir();
        const preInitGet = (): SecretsStore => {
          throw new Error('SecretsStore not initialized. Call initSecretsStore() during app-ready.');
        };
        capture.length = 0;
        saveAppSettingsTo(settingsPath, preInitGet, { ...seed, slice2AutonomyOffMigrated: true });
        assertNoValuesLogged();
      }

      // 6) Abort path — set throws mid-save; no value/substring logs.
      {
        const { store, settingsPath } = mkStore();
        for (const { secretId } of KEY_PATH_SECRET_ENTRIES) {
          store.set(secretId, values[0]!);
        }
        fs.writeFileSync(
          settingsPath,
          JSON.stringify({ ...SETTINGS_DEFAULTS, slice2AutonomyOffMigrated: true, apiKey: '' }),
          'utf-8',
        );
        let n = 0;
        const origSet = store.set.bind(store);
        store.set = (id: string, value: string | null) => {
          n += 1;
          if (n >= 3) throw new Error('injected abort set failure');
          return origSet(id, value);
        };
        capture.length = 0;
        expect(() =>
          saveAppSettingsTo(settingsPath, () => store, { ...seed, slice2AutonomyOffMigrated: true }),
        ).toThrow(/injected abort set failure/);
        assertNoValuesLogged();
      }
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
      infoSpy.mockRestore();
      debugSpy.mockRestore();
    }
  });
});

describe('PB boot order — main.ts whenReady secrets sequence (K-B3)', () => {
  it('initSecretsStore → deleteLeftoverAtomicTemps → migrateSecretsFromSettingsFile → initTelemetry', () => {
    const mainSrc = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'main.ts'),
      'utf-8',
    );
    const readyIdx = mainSrc.indexOf('app.whenReady().then');
    expect(readyIdx).toBeGreaterThanOrEqual(0);
    // Bound the boot block: from whenReady through the secrets-end mark.
    const bootEnd = mainSrc.indexOf("performance.mark('app:secrets-end')", readyIdx);
    expect(bootEnd).toBeGreaterThan(readyIdx);
    const boot = mainSrc.slice(readyIdx, bootEnd);

    const initStore = boot.search(/^\s*initSecretsStore\(/m);
    const deleteTemps = boot.search(/^\s*deleteLeftoverAtomicTemps\(/m);
    const migrate = boot.search(
      /^\s*migrateSecretsFromSettingsFile\(\s*getAppSettingsPath\(\)\s*,\s*getSecretsStore\(\)\s*\)/m,
    );
    const telemetry = boot.search(/^\s*initTelemetry\(/m);

    expect(initStore, 'initSecretsStore( must exist live in whenReady').toBeGreaterThanOrEqual(0);
    expect(deleteTemps, 'deleteLeftoverAtomicTemps( must exist live').toBeGreaterThanOrEqual(0);
    expect(migrate, 'migrateSecretsFromSettingsFile(getAppSettingsPath(), getSecretsStore()) must exist live').toBeGreaterThanOrEqual(0);
    expect(telemetry, 'initTelemetry( must exist live').toBeGreaterThanOrEqual(0);

    // Not commented out — line must not start with // after trim.
    for (const [label, idx] of [
      ['initSecretsStore', initStore],
      ['deleteLeftoverAtomicTemps', deleteTemps],
      ['migrateSecretsFromSettingsFile', migrate],
      ['initTelemetry', telemetry],
    ] as const) {
      const lineStart = boot.lastIndexOf('\n', idx) + 1;
      const line = boot.slice(lineStart, boot.indexOf('\n', idx));
      expect(line.trimStart().startsWith('//'), `${label} must not be commented out`).toBe(false);
    }

    expect(initStore).toBeLessThan(deleteTemps);
    expect(deleteTemps).toBeLessThan(migrate);
    expect(migrate).toBeLessThan(telemetry);
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
  it('PB9: post-init load with missing slice2 flag does not wipe stored keys (E2)', () => {
    const { store, settingsPath, secretsPath } = mkStore();
    // 12 distinct ids; one undecryptable ciphertext left on disk.
    const values = KEY_FIELD_PATHS.map(
      (_, i) => `sk-ant-PB9E2-${String(i).padStart(2, '0')}0000000000000000000000000001`,
    );
    for (let i = 0; i < KEY_PATH_SECRET_ENTRIES.length; i++) {
      store.set(KEY_PATH_SECRET_ENTRIES[i]!.secretId, values[i]!);
    }
    // Inject a decrypt-failed entry that must survive the JSON-only slice2 write.
    const secretsObj = JSON.parse(fs.readFileSync(secretsPath, 'utf-8')) as {
      v: 1;
      values: Record<string, string>;
    };
    secretsObj.values['provider.alphaReader.apiKey'] = Buffer.from('not-valid-ciphertext').toString('base64');
    fs.writeFileSync(secretsPath, JSON.stringify(secretsObj), 'utf-8');
    store.reload();

    const disk = {
      ...SETTINGS_DEFAULTS,
      agents: fullPlaintextFixture('').agents,
      provider: { kind: 'anthropic' as const, model: 'x', apiKey: '' },
      voice: { enabled: false, cloudFallback: false, openaiApiKey: '', ttsVoiceId: 'kokoro:nicole' },
      stt: { enabled: true, provider: 'cloud' as const, cloudApiKey: '' },
      tts: { enabled: true, provider: 'cloud' as const, cloudApiKey: '' },
      apiKey: '',
    };
    delete (disk as { slice2AutonomyOffMigrated?: boolean }).slice2AutonomyOffMigrated;
    fs.writeFileSync(settingsPath, JSON.stringify(disk), 'utf-8');

    const secretsBefore = fs.readFileSync(secretsPath);
    const setSpy = vi.spyOn(store, 'set');
    const deleteSpy = vi.spyOn(store, 'delete');

    const loaded = loadAppSettingsFrom(settingsPath, () => store, (s) =>
      // Mutant K-B19 would use the secret saver here; production must not.
      saveAppSettingsTo(settingsPath, () => store, s),
    );

    expect(setSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(fs.readFileSync(secretsPath)).toEqual(secretsBefore);
    setSpy.mockRestore();
    deleteSpy.mockRestore();

    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf-8')).slice2AutonomyOffMigrated).toBe(true);
    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as AppSettings;
    for (const p of KEY_FIELD_PATHS) {
      expect(getKeyField(written, p) ?? '', `json ${p}`).toBe('');
    }
    assertNoPlaintextInJson(settingsPath, values);

    // Loader still serves decryptable keys (alphaReader fails decrypt → empty).
    for (let i = 0; i < KEY_FIELD_PATHS.length; i++) {
      const p = KEY_FIELD_PATHS[i]!;
      if (p === 'agents.alphaReader.provider.apiKey') {
        expect(getKeyField(loaded, p) ?? '').toBe('');
      } else {
        expect(getKeyField(loaded, p), p).toBe(values[i]);
      }
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
    // afterExtract must live in `finally` (pre-KEYS-B ensureVaultDir parity).
    expect(restoreSrc).toMatch(/} finally \{[\s\S]*?opts\.afterExtract\?\.\(\)/);
  });

  it('PB9b(d): throwing restore still runs afterExtract; error propagates', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-pb9b-d-ud-'));
    const storyVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-pb9b-d-sv-'));
    const notesVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-pb9b-d-nv-'));
    const secretsPath = path.join(userData, 'secrets.json');
    const store = new SecretsStore({ filePath: secretsPath, safeStorage: makeSafeStorage(true) });

    let afterExtractCalls = 0;
    const missingArchive = path.join(userData, 'does-not-exist.mwbackup');

    await expect(
      restoreAppDataAndReloadSettings({
        archivePath: missingArchive,
        userDataPath: userData,
        storyVaultRoot: storyVault,
        notesVaultRoot: notesVault,
        overwrite: true,
        getStore: () => store,
        afterExtract: () => {
          afterExtractCalls += 1;
        },
      }),
    ).rejects.toThrow(/Archive not found/);

    expect(afterExtractCalls).toBe(1);

    // Bad archive: valid zip missing header.json (backup.ts:140).
    afterExtractCalls = 0;
    const zip = new JSZip();
    zip.file('readme.txt', 'no header');
    const badArchive = path.join(userData, 'bad.mwbackup');
    fs.writeFileSync(badArchive, await zip.generateAsync({ type: 'nodebuffer' }));

    await expect(
      restoreAppDataAndReloadSettings({
        archivePath: badArchive,
        userDataPath: userData,
        storyVaultRoot: storyVault,
        notesVaultRoot: notesVault,
        overwrite: true,
        getStore: () => store,
        afterExtract: () => {
          afterExtractCalls += 1;
        },
      }),
    ).rejects.toThrow(/missing header\.json/);
    expect(afterExtractCalls).toBe(1);

    // Source pin: mutant that moves afterExtract out of finally must fail.
    const restoreSrc = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'appRestore.ts'),
      'utf-8',
    );
    expect(restoreSrc).toMatch(/} finally \{[\s\S]*?opts\.afterExtract\?\.\(\)/);
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

describe('Shield r1 — R4-L via real saver: empty clear keeps flag; real key clears it', () => {
  it('R4-L: empty clear through saveAppSettingsTo keeps keyReentryPaths; real key clears it', () => {
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

    // Empty clear through the real saver keeps the held flag (R4-L / #1660).
    saveAppSettingsTo(settingsPath, () => store, {
      ...loaded,
      provider: { ...loaded.provider!, apiKey: '' },
    });
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

  it('pre-init saver writes no keyReentryPaths and no mask (T5)', () => {
    const { settingsPath } = mkDir();
    const mask = maskApiKey(K);
    const preInitGet = (): SecretsStore => {
      throw new Error('SecretsStore not initialized. Call initSecretsStore() during app-ready.');
    };
    saveAppSettingsTo(settingsPath, preInitGet, {
      ...fullPlaintextFixture(K),
      slice2AutonomyOffMigrated: true,
      apiKey: mask,
      keyReentryPaths: ['apiKey', 'provider.apiKey'],
    });
    const disk = fs.readFileSync(settingsPath, 'utf-8');
    expect(disk).not.toContain('keyReentryPaths');
    expect(disk).not.toContain(mask);
    // Source pin: first strip before pre-init write; raw settings must not be written.
    const loadSrc = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'appSettingsLoad.ts'),
      'utf-8',
    );
    expect(loadSrc).toMatch(
      /const outgoing = stripKeyReentryPaths\(lifecycleApplied\);[\s\S]*?writeJsonAtomicSecure\(settingsPath, outgoing\)/,
    );
    expect(loadSrc).not.toMatch(/writeJsonAtomicSecure\(settingsPath,\s*settings\)/);
  });
});

describe('P1 / T2 — M29 SETTINGS_GET marker is JSON-only', () => {
  it('markOnboardingCompleteJsonOnly: 12 ids + decrypt-fail → 0 set/delete; secrets byte-identical; flag on disk', () => {
    const { store, settingsPath, secretsPath } = mkStore();
    const values = KEY_FIELD_PATHS.map(
      (_, i) => `sk-ant-M29-${String(i).padStart(2, '0')}0000000000000000000000000000001`,
    );
    for (let i = 0; i < KEY_PATH_SECRET_ENTRIES.length; i++) {
      store.set(KEY_PATH_SECRET_ENTRIES[i]!.secretId, values[i]!);
    }
    const secretsObj = JSON.parse(fs.readFileSync(secretsPath, 'utf-8')) as {
      v: 1;
      values: Record<string, string>;
    };
    secretsObj.values['provider.lineEditor.apiKey'] = Buffer.from('bad-ct').toString('base64');
    fs.writeFileSync(secretsPath, JSON.stringify(secretsObj), 'utf-8');
    store.reload();

    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        ...SETTINGS_DEFAULTS,
        slice2AutonomyOffMigrated: true,
        onboardingComplete: false,
        agents: fullPlaintextFixture('').agents,
        provider: { kind: 'anthropic', model: 'x', apiKey: '' },
        apiKey: '',
      }),
      'utf-8',
    );
    // mythos.json presence is gated in SETTINGS_GET; pin exercises the JSON-only writer.
    const secretsBefore = fs.readFileSync(secretsPath);
    const setSpy = vi.spyOn(store, 'set');
    const deleteSpy = vi.spyOn(store, 'delete');

    markOnboardingCompleteJsonOnly(settingsPath);

    expect(setSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(fs.readFileSync(secretsPath)).toEqual(secretsBefore);
    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf-8')).onboardingComplete).toBe(true);
    setSpy.mockRestore();
    deleteSpy.mockRestore();
  });

  it('source pin: SETTINGS_GET uses markOnboardingCompleteJsonOnly, not saveAppSettings', () => {
    const mainSrc = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'main.ts'),
      'utf-8',
    );
    const handler = mainSrc.match(
      /\[IPC_CHANNELS\.SETTINGS_GET\]:[\s\S]*?(?=,\s*\n\s*\[IPC_CHANNELS\.SETTINGS_SET\])/,
    );
    expect(handler?.[0] ?? '').toContain('markOnboardingCompleteJsonOnly');
    expect(handler?.[0] ?? '').not.toMatch(/saveAppSettings\(/);
  });

  it('soft: M29 helper write uses writeJsonAtomicSecure (not plain writeFileSync)', () => {
    const loadSrc = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'appSettingsLoad.ts'),
      'utf-8',
    );
    const fn = loadSrc.match(
      /export function markOnboardingCompleteJsonOnly\([\s\S]*?\n\}/,
    );
    expect(fn?.[0] ?? '').toMatch(/writeJsonAtomicSecure\(settingsPath/);
    expect(fn?.[0] ?? '').not.toMatch(/writeFileSync\(settingsPath/);
  });
});

describe('P2 / T3 — restore app-settings.json lands at 0600', () => {
  it('restore with no prior app-settings.json → mode 600', async () => {
    if (process.platform === 'win32') return;
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-p2-ud-'));
    const storyVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-p2-sv-'));
    const notesVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-p2-nv-'));
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-p2-stg-'));
    fs.writeFileSync(
      path.join(staging, 'app-settings.json'),
      JSON.stringify({ ...SETTINGS_DEFAULTS, slice2AutonomyOffMigrated: true }),
      'utf-8',
    );
    const archivePath = path.join(userData, 'r.mwbackup');
    await backupAppData({
      userDataPath: staging,
      storyVaultRoot: storyVault,
      notesVaultRoot: notesVault,
      appVersion: '0.5.7',
      manifestSchemaVersion: 0,
      outputPath: archivePath,
    });
    const dest = path.join(userData, 'app-settings.json');
    expect(fs.existsSync(dest)).toBe(false);
    const result = await restoreAppData({
      archivePath,
      userDataPath: userData,
      storyVaultRoot: storyVault,
      notesVaultRoot: notesVault,
      overwrite: true,
    });
    expect(result.restored).toBe(true);
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.statSync(dest).mode & 0o777).toBe(0o600);
  });
});

describe('P3 / T9 — Abort when persistSecretsAndStripSettings throws', () => {
  it('(a) mid-save set throw → secrets.json byte-identical; store values unchanged', () => {
    const { store, settingsPath, secretsPath } = mkStore();
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
        apiKey: '',
      }),
      'utf-8',
    );
    const secretsBefore = fs.readFileSync(secretsPath);
    const beforeIds = Object.fromEntries(
      KEY_PATH_SECRET_ENTRIES.map(({ secretId }) => [secretId, store.get(secretId)]),
    );
    let n = 0;
    const origSet = store.set.bind(store);
    store.set = (id: string, value: string | null) => {
      n += 1;
      if (n >= 4) throw new Error('injected abort');
      return origSet(id, value);
    };
    const typed = 'sk-ant-TypedAbortKey00000000000000000000000000001';
    expect(() =>
      saveAppSettingsTo(settingsPath, () => store, {
        ...fullPlaintextFixture(typed),
        slice2AutonomyOffMigrated: true,
        theme: 'dark',
      }),
    ).toThrow(/injected abort/);
    expect(fs.readFileSync(secretsPath)).toEqual(secretsBefore);
    for (const { secretId } of KEY_PATH_SECRET_ENTRIES) {
      expect(store.get(secretId), secretId).toBe(beforeIds[secretId]);
    }
  });

  it('(b) typed outgoing key never lands in JSON after abort', () => {
    const { store, settingsPath } = mkStore();
    store.set('anthropic.apiKey', K);
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ ...SETTINGS_DEFAULTS, slice2AutonomyOffMigrated: true, apiKey: '' }),
      'utf-8',
    );
    store.set = () => {
      throw new Error('injected abort');
    };
    const typed = 'sk-ant-MustNotReachJson0000000000000000000000001';
    expect(() =>
      saveAppSettingsTo(settingsPath, () => store, {
        ...SETTINGS_DEFAULTS,
        slice2AutonomyOffMigrated: true,
        apiKey: typed,
        theme: 'high-contrast',
      }),
    ).toThrow(/injected abort/);
    expect(fs.readFileSync(settingsPath, 'utf-8')).not.toContain(typed);
  });

  it('(c) non-key settings still save on abort', () => {
    const { store, settingsPath } = mkStore();
    store.set('anthropic.apiKey', K);
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ ...SETTINGS_DEFAULTS, slice2AutonomyOffMigrated: true, apiKey: '', theme: 'system' }),
      'utf-8',
    );
    store.set = () => {
      throw new Error('injected abort');
    };
    expect(() =>
      saveAppSettingsTo(settingsPath, () => store, {
        ...SETTINGS_DEFAULTS,
        slice2AutonomyOffMigrated: true,
        apiKey: 'sk-ant-AbortThemeOnly00000000000000000000000001',
        theme: 'dark',
      }),
    ).toThrow(/injected abort/);
    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf-8')).theme).toBe('dark');
  });

  it('(d) JSON key fields come from on-disk values (empty), never outgoing', () => {
    const { store, settingsPath } = mkStore();
    store.set('anthropic.apiKey', K);
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ ...SETTINGS_DEFAULTS, slice2AutonomyOffMigrated: true, apiKey: '' }),
      'utf-8',
    );
    store.set = () => {
      throw new Error('injected abort');
    };
    expect(() =>
      saveAppSettingsTo(settingsPath, () => store, {
        ...SETTINGS_DEFAULTS,
        slice2AutonomyOffMigrated: true,
        apiKey: 'sk-ant-AbortDiskKeys000000000000000000000000001',
      }),
    ).toThrow(/injected abort/);
    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf-8')).apiKey).toBe('');
  });

  it('(e) O1 blank-all still when !isAvailable(); Abort only when encryption available', () => {
    const { store, settingsPath } = mkStore(false);
    saveAppSettingsTo(settingsPath, () => store, {
      ...fullPlaintextFixture(K),
      slice2AutonomyOffMigrated: true,
    });
    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as AppSettings;
    for (const p of KEY_FIELD_PATHS) {
      expect(getKeyField(written, p), p).toBe('');
    }
    // Source: Abort catch restores secrets; O1 path still uses blankAllKeyFields.
    const loadSrc = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'appSettingsLoad.ts'),
      'utf-8',
    );
    expect(loadSrc).toMatch(/!store\.isAvailable\(\)[\s\S]*?blankAllKeyFields\(outgoing\)/);
    expect(loadSrc).toMatch(/restoreSecretsBytes\(store, secretsBefore\)/);
  });

  it('(e-ipc) SETTINGS_SET abort catch returns saved:false via sanitizeIpcError (ipc-no-catch)', () => {
    // Source pin: removing the try/catch around saveAppSettings(updated) must go RED.
    const mainSrc = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'main.ts'),
      'utf-8',
    );
    const handler = mainSrc.match(
      /\[IPC_CHANNELS\.SETTINGS_SET\]:[\s\S]*?(?=,\s*\n\s*\[IPC_CHANNELS\.)/,
    );
    expect(handler?.[0] ?? '', 'SETTINGS_SET handler').toMatch(
      /try \{\s*saveAppSettings\(updated\);\s*\} catch \(e\) \{\s*return \{ saved: false, error: sanitizeIpcError\(IPC_CHANNELS\.SETTINGS_SET, e\)\.error \};\s*\}/,
    );

    // Behavioral: Abort throw → same return shape SETTINGS_SET catch builds.
    // Production store failures do not embed key material; error must not echo
    // the typed outgoing value either.
    const { store, settingsPath } = mkStore();
    store.set('anthropic.apiKey', K);
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ ...SETTINGS_DEFAULTS, slice2AutonomyOffMigrated: true, apiKey: '' }),
      'utf-8',
    );
    const typed = 'sk-ant-IpcAbortErrVal00000000000000000000000001';
    store.set = () => {
      throw new Error('injected persist failure');
    };
    let caught: unknown;
    try {
      saveAppSettingsTo(settingsPath, () => store, {
        ...SETTINGS_DEFAULTS,
        slice2AutonomyOffMigrated: true,
        apiKey: typed,
        theme: 'dark',
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const result = {
      saved: false as const,
      error: sanitizeIpcError('settings:set', caught).error,
    };
    expect(result).toEqual({ saved: false, error: expect.any(String) });
    expect(result.error.length).toBeGreaterThan(0);
    expect(result.error).not.toContain(typed);
    expect(result.error).not.toContain(K);
  });
});

describe('P4 / T10 — SecretsStore set/delete no-ops when unchanged', () => {
  it('(a) set identical value → no secrets.json rename', () => {
    const { store, secretsPath } = mkStore();
    store.set('anthropic.apiKey', K);
    const renameSpy = vi.spyOn(fs, 'renameSync');
    try {
      store.set('anthropic.apiKey', K);
      expect(renameSpy.mock.calls.filter((c) => String(c[1]) === secretsPath)).toHaveLength(0);
    } finally {
      renameSpy.mockRestore();
    }
  });

  it('(b) delete missing id → no-op (no rename)', () => {
    const { store, secretsPath } = mkStore();
    const renameSpy = vi.spyOn(fs, 'renameSync');
    try {
      store.delete('provider.apiKey');
      expect(renameSpy.mock.calls.filter((c) => String(c[1]) === secretsPath)).toHaveLength(0);
    } finally {
      renameSpy.mockRestore();
    }
  });

  it('(c) decrypt-failed entry never counts as unchanged — set still persists', () => {
    const { secretsPath } = mkDir();
    fs.writeFileSync(
      secretsPath,
      JSON.stringify({
        v: 1,
        values: { 'anthropic.apiKey': Buffer.from('bad').toString('base64') },
      }),
      'utf-8',
    );
    const store = new SecretsStore({ filePath: secretsPath, safeStorage: makeSafeStorage(true) });
    expect(store.get('anthropic.apiKey')).toBeNull();
    const renameSpy = vi.spyOn(fs, 'renameSync');
    try {
      store.set('anthropic.apiKey', K);
      expect(renameSpy.mock.calls.some((c) => String(c[1]) === secretsPath)).toBe(true);
      expect(store.get('anthropic.apiKey')).toBe(K);
    } finally {
      renameSpy.mockRestore();
    }
  });

  it('(d) save with unchanged keys → one fsynced settings write; zero secrets renames', () => {
    const { store, settingsPath, secretsPath } = mkStore();
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
    const loaded = loadAppSettingsFrom(settingsPath, () => store);
    const renameSpy = vi.spyOn(fs, 'renameSync');
    try {
      saveAppSettingsTo(settingsPath, () => store, { ...loaded, theme: 'dark' });
      const settingsRenames = renameSpy.mock.calls.filter((c) => String(c[1]) === settingsPath);
      const secretsRenames = renameSpy.mock.calls.filter((c) => String(c[1]) === secretsPath);
      expect(settingsRenames).toHaveLength(1);
      expect(secretsRenames).toHaveLength(0);
    } finally {
      renameSpy.mockRestore();
    }
  });

  it('(e) clearing existing key still deletes and persists', () => {
    const { store, secretsPath } = mkStore();
    store.set('anthropic.apiKey', K);
    const renameSpy = vi.spyOn(fs, 'renameSync');
    try {
      store.set('anthropic.apiKey', '');
      expect(renameSpy.mock.calls.some((c) => String(c[1]) === secretsPath)).toBe(true);
      expect(store.get('anthropic.apiKey')).toBeNull();
    } finally {
      renameSpy.mockRestore();
    }
  });

  it('(f) clear of decrypt-failed id still rewrites secrets.json and drops ciphertext (delete-ignore-failed / failed-not-tracked)', () => {
    const GOOD = 'sk-ant-GoodKept000000000000000000000000000000001';
    const failedId = 'provider.apiKey';
    const goodId = 'anthropic.apiKey';
    const failedCipherB64 = Buffer.from('not-valid-ciphertext-X').toString('base64');

    const assertClearDropsFailedKeepsGood = (
      label: string,
      clear: (store: SecretsStore, settingsPath: string) => void,
    ) => {
      const { dir, settingsPath, secretsPath } = mkDir();
      void dir;
      // Seed good entry via real encrypt path, then inject undecryptable X beside it.
      const seedStore = new SecretsStore({
        filePath: secretsPath,
        safeStorage: makeSafeStorage(true),
      });
      seedStore.set(goodId, GOOD);
      const secretsObj = JSON.parse(fs.readFileSync(secretsPath, 'utf-8')) as {
        v: 1;
        values: Record<string, string>;
      };
      secretsObj.values[failedId] = failedCipherB64;
      fs.writeFileSync(secretsPath, JSON.stringify(secretsObj), 'utf-8');

      const store = new SecretsStore({
        filePath: secretsPath,
        safeStorage: makeSafeStorage(true),
      });
      expect(store.get(goodId)).toBe(GOOD);
      expect(store.get(failedId)).toBeNull();
      expect(fs.readFileSync(secretsPath, 'utf-8')).toContain(failedCipherB64);

      fs.writeFileSync(
        settingsPath,
        JSON.stringify({
          ...SETTINGS_DEFAULTS,
          slice2AutonomyOffMigrated: true,
          apiKey: '',
          provider: { kind: 'anthropic', model: 'x', apiKey: '' },
        }),
        'utf-8',
      );

      const renameSpy = vi.spyOn(fs, 'renameSync');
      try {
        clear(store, settingsPath);
        expect(
          renameSpy.mock.calls.some((c) => String(c[1]) === secretsPath),
          `${label}: secrets.json must be rewritten`,
        ).toBe(true);
      } finally {
        renameSpy.mockRestore();
      }

      const after = fs.readFileSync(secretsPath, 'utf-8');
      expect(after, `${label}: failed ciphertext must be gone`).not.toContain(failedCipherB64);
      const parsed = JSON.parse(after) as { values: Record<string, string> };
      expect(parsed.values[failedId], `${label}: failed id removed`).toBeUndefined();
      store.reload();
      expect(store.get(goodId), `${label}: good entry intact`).toBe(GOOD);
      expect(store.get(failedId)).toBeNull();
    };

    // 1) Direct store.delete(X)
    assertClearDropsFailedKeepsGood('store.delete', (store) => {
      store.delete(failedId);
    });

    // 2) Real saver clearing that key field to ''
    assertClearDropsFailedKeepsGood('saveAppSettingsTo clear', (store, settingsPath) => {
      saveAppSettingsTo(settingsPath, () => store, {
        ...SETTINGS_DEFAULTS,
        slice2AutonomyOffMigrated: true,
        apiKey: GOOD, // keep good path populated so persist doesn't delete it
        provider: { kind: 'anthropic', model: 'x', apiKey: '' },
      });
    });
  });
});

describe('T12 — PB2(b) through real restoreAppData with plaintext archive', () => {
  it('hand-built plaintext archive → restore → next migrate moves all 12', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-t12-ud-'));
    const storyVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-t12-sv-'));
    const notesVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-t12-nv-'));
    const settingsPath = path.join(userData, 'app-settings.json');
    const secretsPath = path.join(userData, 'secrets.json');

    const zip = new JSZip();
    zip.file(
      'header.json',
      JSON.stringify({
        schemaVersion: 1,
        appVersion: '0.5.3',
        manifestSchemaVersion: 0,
        createdAt: new Date().toISOString(),
      }),
    );
    zip.file(
      'userData/app-settings.json',
      JSON.stringify({ ...fullPlaintextFixture(K), slice2AutonomyOffMigrated: true }),
    );
    const archivePath = path.join(userData, 'plain.mwbackup');
    fs.writeFileSync(archivePath, await zip.generateAsync({ type: 'nodebuffer' }));

    const result = await restoreAppData({
      archivePath,
      userDataPath: userData,
      storyVaultRoot: storyVault,
      notesVaultRoot: notesVault,
      overwrite: true,
    });
    expect(result.restored).toBe(true);
    expect(fs.readFileSync(settingsPath, 'utf-8')).toContain(K);

    const store = new SecretsStore({ filePath: secretsPath, safeStorage: makeSafeStorage(true) });
    const migrated = migrateSecretsFromSettingsFile(settingsPath, store);
    expect(migrated.movedIds.length).toBe(12);
    assertNoPlaintextInJson(settingsPath, [K]);
  });
});

describe('KEYS-B FIX BATCH 4 — H2 / H3 / S1 / S2', () => {
  it('H2(a): migration secrets rename fail → non-key save → fresh store still has apiKey + lineEditor', () => {
    const { store, settingsPath, secretsPath } = mkStore();
    const K_API = 'sk-ant-H2aApi0000000000000000000000000000001';
    const K_LINE = 'sk-ant-H2aLine000000000000000000000000000001';
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        ...SETTINGS_DEFAULTS,
        slice2AutonomyOffMigrated: true,
        apiKey: K_API,
        agents: {
          ...SETTINGS_DEFAULTS.agents,
          lineEditor: agentWithKey(K_LINE),
        },
      }),
      'utf-8',
    );

    // Boot migration: first secrets rename (apiKey) succeeds; second (lineEditor) fails.
    const realRename = fs.renameSync.bind(fs);
    let secretsRenames = 0;
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(((
      src: fs.PathLike,
      dest: fs.PathLike,
    ) => {
      if (String(dest) === secretsPath) {
        secretsRenames += 1;
        if (secretsRenames >= 2) {
          throw new Error('injected secrets rename failure');
        }
      }
      return realRename(src, dest);
    }) as typeof fs.renameSync);

    try {
      migrateSecretsFromSettingsFile(settingsPath, store);
    } finally {
      renameSpy.mockRestore();
    }

    // Non-key settings save (theme) through the real loader/saver.
    const loaded = loadAppSettingsFrom(settingsPath, () => store);
    saveAppSettingsTo(settingsPath, () => store, { ...loaded, theme: 'dark' });

    // FRESH SecretsStore from disk — must still hold both keys (H2 cache rollback).
    const fresh = new SecretsStore({
      filePath: secretsPath,
      safeStorage: makeSafeStorage(true),
    });
    expect(fresh.get('anthropic.apiKey')).toBe(K_API);
    expect(fresh.get('provider.lineEditor.apiKey')).toBe(K_LINE);
  });

  it('H2(b): encrypt throw while isAvailable → all 12 kept on disk and in a fresh load', () => {
    const { dir, settingsPath, secretsPath } = mkDir();
    void dir;
    const values = KEY_FIELD_PATHS.map(
      (_, i) => `sk-ant-H2bEnc${String(i).padStart(2, '0')}000000000000000000000000001`,
    );
    // Fail every encrypt during migration so a later successful persist cannot
    // flush a dirty cache; then allow encrypt for the follow-up non-key save.
    let encryptBlocked = true;
    const safeStorage: SafeStorageLike = {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => {
        if (encryptBlocked) {
          throw new Error('injected encrypt failure');
        }
        return Buffer.from(`enc:${s}`, 'utf-8');
      },
      decryptString: (buf: Buffer) => {
        const raw = buf.toString('utf-8');
        if (!raw.startsWith('enc:')) throw new Error('bad ciphertext');
        return raw.slice('enc:'.length);
      },
    };
    const store = new SecretsStore({ filePath: secretsPath, safeStorage });
    expect(store.isAvailable()).toBe(true);

    let seed = fullPlaintextFixture(values[0]!);
    for (let i = 0; i < KEY_FIELD_PATHS.length; i++) {
      seed = setKeyField(seed, KEY_FIELD_PATHS[i]!, values[i]!);
    }
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ ...seed, slice2AutonomyOffMigrated: true }),
      'utf-8',
    );

    // Boot migration: every persist encrypt throws (isAvailable still true).
    migrateSecretsFromSettingsFile(settingsPath, store);
    expect(fs.existsSync(secretsPath)).toBe(false);

    // Non-key save must persist all 12 (not no-op on a dirty cache).
    encryptBlocked = false;
    const loaded = loadAppSettingsFrom(settingsPath, () => store);
    saveAppSettingsTo(settingsPath, () => store, { ...loaded, theme: 'dark' });

    const fresh = new SecretsStore({
      filePath: secretsPath,
      safeStorage: makeSafeStorage(true),
    });
    for (let i = 0; i < KEY_PATH_SECRET_ENTRIES.length; i++) {
      expect(
        fresh.get(KEY_PATH_SECRET_ENTRIES[i]!.secretId),
        KEY_PATH_SECRET_ENTRIES[i]!.secretId,
      ).toBe(values[i]);
    }
  });

  it('H2(c): delete persist throw rolls back cache; next save + fresh load keep prior value', () => {
    const { store, settingsPath, secretsPath } = mkStore();
    const K_API = 'sk-ant-H2cDel0000000000000000000000000000001';
    store.set('anthropic.apiKey', K_API);

    const realRename = fs.renameSync.bind(fs);
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(((
      src: fs.PathLike,
      dest: fs.PathLike,
    ) => {
      if (String(dest) === secretsPath) {
        throw new Error('injected delete persist failure');
      }
      return realRename(src, dest);
    }) as typeof fs.renameSync);

    try {
      expect(() => store.delete('anthropic.apiKey')).toThrow(/injected delete persist failure/);
      // Cache must still hold the prior value (delete rollback).
      expect(store.get('anthropic.apiKey')).toBe(K_API);
    } finally {
      renameSpy.mockRestore();
    }

    // Next ordinary save through the same (non-reloaded) store keeps it on disk.
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        ...SETTINGS_DEFAULTS,
        slice2AutonomyOffMigrated: true,
        apiKey: '',
      }),
      'utf-8',
    );
    const loaded = loadAppSettingsFrom(settingsPath, () => store);
    expect(loaded.apiKey).toBe(K_API);
    saveAppSettingsTo(settingsPath, () => store, { ...loaded, theme: 'dark' });

    const fresh = new SecretsStore({
      filePath: secretsPath,
      safeStorage: makeSafeStorage(true),
    });
    expect(fresh.get('anthropic.apiKey')).toBe(K_API);
  });

  it('H3: initTelemetry boot save try/catch; setupIpcMain reached when save throws; warn has no values', () => {
    const mainSrc = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'main.ts'),
      'utf-8',
    );
    const fn = mainSrc.match(/function initTelemetry\(\): void \{[\s\S]*?\n\}/);
    const body = fn?.[0] ?? '';
    expect(body, 'initTelemetry body').toMatch(
      /try \{\s*saveAppSettings\(\{ \.\.\.settings, telemetry: \{ \.\.\.telemetry, sessionId: id \} \}\);\s*\} catch \{\s*console\.warn\('\[telemetry\] boot sessionId persist failed; continuing'\);\s*\}/,
    );
    // Catch must not rethrow — boot continues to configureTelemetry then setupIpcMain.
    expect(body).toMatch(
      /catch \{\s*console\.warn\('\[telemetry\] boot sessionId persist failed; continuing'\);\s*\}\s*configureTelemetry\(\{ enabled: telemetry\.enabled, sessionId: id \}\)/,
    );
    expect(body).not.toMatch(/catch \{[^}]*throw/);
    expect(body).not.toMatch(/console\.warn\([\s\S]*?\.message/);
    expect(body).not.toMatch(/console\.warn\([^)]*\b(id|settings|apiKey)\b/);

    // whenReady: initTelemetry → setupIpcMain → window creation (unguarded save must not stop this).
    const readyIdx = mainSrc.search(/app\.whenReady\(\)/);
    const telAbs = mainSrc.indexOf('initTelemetry()', readyIdx);
    const ipcAbs = mainSrc.indexOf('setupIpcMain(handlers)', readyIdx);
    const winAbs = mainSrc.indexOf('createWindow', ipcAbs);
    expect(telAbs).toBeGreaterThanOrEqual(0);
    expect(ipcAbs).toBeGreaterThan(telAbs);
    expect(winAbs).toBeGreaterThan(ipcAbs);

    // Behavioral: store/save throw at boot → warn; configureTelemetry path still "reached";
    // no secret values in logs. Mirrors initTelemetry catch so setupIpcMain can run next.
    const typed = 'sk-ant-H3BootNoLog0000000000000000000000000001';
    const { store, settingsPath } = mkStore();
    store.set = () => {
      throw new Error('injected boot save failure');
    };
    const capture: string[] = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      capture.push(args.map(String).join(' '));
    });
    let configureTelemetryReached = false;
    let setupIpcMainReached = false;
    try {
      try {
        saveAppSettingsTo(settingsPath, () => store, {
          ...SETTINGS_DEFAULTS,
          slice2AutonomyOffMigrated: true,
          apiKey: typed,
          telemetry: { enabled: false, sessionId: 'new-session' },
        });
      } catch {
        console.warn('[telemetry] boot sessionId persist failed; continuing');
      }
      configureTelemetryReached = true;
      setupIpcMainReached = true; // whenReady continues past initTelemetry
      expect(configureTelemetryReached).toBe(true);
      expect(setupIpcMainReached).toBe(true);
      const blob = capture.join('\n');
      expect(blob).toContain('[telemetry] boot sessionId persist failed; continuing');
      expect(blob).not.toContain(typed);
      expect(blob).not.toContain(K);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('S1: snapshot read EIO → unknown; abort leaves secrets.json byte-identical', () => {
    const { store, settingsPath, secretsPath } = mkStore();
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
        apiKey: '',
      }),
      'utf-8',
    );
    const secretsBefore = fs.readFileSync(secretsPath);

    const realRead = fs.readFileSync.bind(fs);
    const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation(((
      pathLike: fs.PathOrFileDescriptor,
      options?: Parameters<typeof fs.readFileSync>[1],
    ) => {
      if (String(pathLike) === secretsPath) {
        const err = new Error('injected EIO') as NodeJS.ErrnoException;
        err.code = 'EIO';
        throw err;
      }
      return realRead(pathLike, options as never);
    }) as typeof fs.readFileSync);

    store.set = () => {
      throw new Error('injected abort');
    };

    try {
      expect(() =>
        saveAppSettingsTo(settingsPath, () => store, {
          ...fullPlaintextFixture('sk-ant-S1AbortTyped000000000000000000000000001'),
          slice2AutonomyOffMigrated: true,
          theme: 'dark',
        }),
      ).toThrow(/injected abort/);
    } finally {
      readSpy.mockRestore();
    }

    // Must not have been unlinked or rewritten (S1 unknown snapshot).
    expect(fs.existsSync(secretsPath)).toBe(true);
    expect(fs.readFileSync(secretsPath)).toEqual(secretsBefore);
  });

  it('S2: rollback write throw still calls reload(); original Abort error propagates', () => {
    const { store, settingsPath, secretsPath } = mkStore();
    store.set('anthropic.apiKey', K);
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ ...SETTINGS_DEFAULTS, slice2AutonomyOffMigrated: true, apiKey: '' }),
      'utf-8',
    );

    store.set = () => {
      throw new Error('injected abort');
    };

    const realRename = fs.renameSync.bind(fs);
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(((
      src: fs.PathLike,
      dest: fs.PathLike,
    ) => {
      if (String(dest) === secretsPath) {
        throw new Error('injected rollback rename failure');
      }
      return realRename(src, dest);
    }) as typeof fs.renameSync);

    const reloadSpy = vi.spyOn(store, 'reload');
    try {
      expect(() =>
        saveAppSettingsTo(settingsPath, () => store, {
          ...SETTINGS_DEFAULTS,
          slice2AutonomyOffMigrated: true,
          apiKey: 'sk-ant-S2AbortTyped000000000000000000000000001',
          theme: 'dark',
        }),
      ).toThrow(/injected abort/);
      expect(reloadSpy, 'reload must run in finally after rollback attempt').toHaveBeenCalled();
    } finally {
      reloadSpy.mockRestore();
      renameSpy.mockRestore();
    }

    // Source pin: restoreSecretsBytes uses finally { store.reload() }.
    const loadSrc = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'appSettingsLoad.ts'),
      'utf-8',
    );
    expect(loadSrc).toMatch(
      /function restoreSecretsBytes\([\s\S]*?finally \{\s*store\.reload\(\);\s*\}/,
    );
  });
});
