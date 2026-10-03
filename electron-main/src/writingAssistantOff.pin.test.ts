/**
 * TC-WA-26 pins — Writing Assistant "off" survives settings migration + SCAN_NOW gate.
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
  buildWaPairRepair,
} from './appSettingsLoad.js';
import { backupAppData } from './backup.js';
import { restoreAppDataAndReloadSettings } from './appRestore.js';
import { assertWritingAssistantScanAllowed } from './writingAssistantScanGate.js';
import { AI_DISABLED_MESSAGE } from './provider.js';
import * as atomicWrite from './secrets/atomicWrite.js';
import {
  KEY_FIELD_PATHS,
  getKeyField,
  setKeyField,
} from './settings-masking.js';
import {
  migrateSecretsFromSettingsFile,
  persistSecretsAndStripSettings,
} from './secrets/migration.js';
import { SecretsStore, type SafeStorageLike } from './secrets/store.js';
import { DatabaseSync } from 'node:sqlite';

const COACH_OFF = 'Writing Coach is disabled in settings.';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wa26-'));
  const settingsPath = path.join(dir, 'app-settings.json');
  const secretsPath = path.join(dir, 'secrets.json');
  return { dir, settingsPath, secretsPath };
}

function mkStore() {
  const paths = mkDir();
  const store = new SecretsStore({
    filePath: paths.secretsPath,
    safeStorage: makeSafeStorage(true),
  });
  return { ...paths, store };
}

const preInitGet = (): SecretsStore => {
  throw new Error('SecretsStore not initialized. Call initSecretsStore() during app-ready.');
};

function waOffP1Shape(): Record<string, unknown> {
  const { writingAssistant, ...restAgents } = SETTINGS_DEFAULTS.agents;
  const wa = { ...writingAssistant, enabled: false };
  return {
    ...SETTINGS_DEFAULTS,
    slice2AutonomyOffMigrated: undefined,
    waEnabled: undefined,
    agents: { ...restAgents, writingAssistant: wa },
  };
}

function readDiskPair(settingsPath: string): { waEnabled: boolean; agentEnabled: boolean } {
  const disk = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
  const agents = disk.agents as Record<string, unknown> | undefined;
  const wa = agents?.writingAssistant as Record<string, unknown> | undefined;
  return {
    waEnabled: disk.waEnabled as boolean,
    agentEnabled: wa?.enabled as boolean,
  };
}

function assertPairFalse(loaded: AppSettings) {
  expect(loaded.waEnabled).toBe(false);
  expect(loaded.agents.writingAssistant.enabled).toBe(false);
}

describe('WA26-P1 Ivy migration pin', () => {
  it('pre-migration WA off: pair false on disk after each load; second load zero writes', () => {
    const { settingsPath, store } = mkStore();
    fs.writeFileSync(settingsPath, JSON.stringify(waOffP1Shape()), 'utf-8');

    const writeSpy = vi.spyOn(atomicWrite, 'writeJsonAtomicSecure');
    const renameSpy = vi.spyOn(fs, 'renameSync');

    const first = loadAppSettingsFrom(settingsPath, () => store);
    assertPairFalse(first);
    expect(readDiskPair(settingsPath)).toEqual({ waEnabled: false, agentEnabled: false });
    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf-8')).slice2AutonomyOffMigrated).toBe(true);

    const mtimeAfterFirst = fs.statSync(settingsPath).mtimeMs;
    const bytesAfterFirst = fs.readFileSync(settingsPath);

    writeSpy.mockClear();
    renameSpy.mockClear();

    const second = loadAppSettingsFrom(settingsPath, () => store);
    assertPairFalse(second);
    expect(readDiskPair(settingsPath)).toEqual({ waEnabled: false, agentEnabled: false });
    expect(writeSpy).not.toHaveBeenCalled();
    expect(renameSpy).not.toHaveBeenCalled();
    expect(fs.statSync(settingsPath).mtimeMs).toBe(mtimeAfterFirst);
    expect(fs.readFileSync(settingsPath)).toEqual(bytesAfterFirst);

    writeSpy.mockRestore();
    renameSpy.mockRestore();
  });
});

describe('WA26-P2 cadence', () => {
  it('legacy WA without cadenceTrigger gets idle_heartbeat flat fields on disk', () => {
    const { settingsPath, store } = mkStore();
    const wa = { ...SETTINGS_DEFAULTS.agents.writingAssistant, enabled: false };
    delete (wa as Record<string, unknown>).cadenceTrigger;
    wa.idleDebounceSeconds = 45;
    const seed: Record<string, unknown> = {
      agents: { writingAssistant: wa },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(seed), 'utf-8');

    loadAppSettingsFrom(settingsPath, () => store);
    loadAppSettingsFrom(settingsPath, () => store);

    const disk = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
    expect(disk.waCadenceTrigger).toBe('idle_heartbeat');
    expect(disk.waIdleHeartbeatConstantInterval).toBe(true);
    expect(disk.waIdleDebounceSeconds).toBe(45);
  });
});

describe('WA26-P3 repair', () => {
  it('repairs disagreeing disk pair; second load zero writes', () => {
    const { settingsPath, store } = mkStore();
    const seed = {
      ...SETTINGS_DEFAULTS,
      slice2AutonomyOffMigrated: true,
      waEnabled: true,
      agents: {
        ...SETTINGS_DEFAULTS.agents,
        writingAssistant: { ...SETTINGS_DEFAULTS.agents.writingAssistant, enabled: false },
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(seed), 'utf-8');
    const seedParsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

    const writeSpy = vi.spyOn(atomicWrite, 'writeJsonAtomicSecure');
    const loaded = loadAppSettingsFrom(settingsPath, () => store);
    assertPairFalse(loaded);
    const disk = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(disk.waEnabled).toBe(false);
    expect(disk.agents.writingAssistant.enabled).toBe(false);
    const { waEnabled: _w, agents: diskAgents, ...restDisk } = disk;
    const { waEnabled: _s, agents: seedAgents, ...restSeed } = seedParsed;
    expect(restDisk).toEqual(restSeed);
    expect(diskAgents.writingAssistant.enabled).toBe(false);

    writeSpy.mockClear();
    loadAppSettingsFrom(settingsPath, () => store);
    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });
});

describe('WA26-P4 off wins', () => {
  it('(a) waEnabled false without enabled key', () => {
    const { settingsPath, store } = mkStore();
    const wa = { ...SETTINGS_DEFAULTS.agents.writingAssistant };
    delete (wa as { enabled?: boolean }).enabled;
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        ...SETTINGS_DEFAULTS,
        slice2AutonomyOffMigrated: true,
        waEnabled: false,
        agents: { ...SETTINGS_DEFAULTS.agents, writingAssistant: wa },
      }),
      'utf-8',
    );
    const loaded = loadAppSettingsFrom(settingsPath, () => store);
    expect(loaded.agents.writingAssistant.enabled).toBe(false);
  });

  it('(b) waEnabled false with enabled true', () => {
    const { settingsPath, store } = mkStore();
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        ...SETTINGS_DEFAULTS,
        slice2AutonomyOffMigrated: true,
        waEnabled: false,
        agents: {
          ...SETTINGS_DEFAULTS.agents,
          writingAssistant: { ...SETTINGS_DEFAULTS.agents.writingAssistant, enabled: true },
        },
      }),
      'utf-8',
    );
    const loaded = loadAppSettingsFrom(settingsPath, () => store);
    assertPairFalse(loaded);
  });

  it('(c) writingAssistant null with waEnabled false', () => {
    const { settingsPath, store } = mkStore();
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        theme: 'dark',
        wikiAutonomy: SETTINGS_DEFAULTS.wikiAutonomy,
        slice2AutonomyOffMigrated: true,
        waEnabled: false,
        agents: {
          ...SETTINGS_DEFAULTS.agents,
          brainstorm: { ...SETTINGS_DEFAULTS.agents.brainstorm, enabled: false },
          writingAssistant: null,
        },
      }),
      'utf-8',
    );
    const writeSpy = vi.spyOn(atomicWrite, 'writeJsonAtomicSecure');
    const loaded = loadAppSettingsFrom(settingsPath, () => store);
    assertPairFalse(loaded);
    expect(loaded.theme).toBe('dark');
    expect(loaded.wikiAutonomy).toEqual(SETTINGS_DEFAULTS.wikiAutonomy);
    expect(loaded.agents.brainstorm.enabled).toBe(false);
    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });
});

describe('WA26-P5 on stays on', () => {
  it('no file returns true without write', () => {
    const { settingsPath, store } = mkStore();
    const writeSpy = vi.spyOn(atomicWrite, 'writeJsonAtomicSecure');
    const loaded = loadAppSettingsFrom(settingsPath, () => store);
    expect(loaded.waEnabled).toBe(true);
    expect(loaded.agents.writingAssistant.enabled).toBe(true);
    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it('legacy WA on without waEnabled: disk true after two loads', () => {
    const { settingsPath, store } = mkStore();
    const seed = { ...SETTINGS_DEFAULTS };
    delete (seed as { waEnabled?: boolean }).waEnabled;
    fs.writeFileSync(settingsPath, JSON.stringify(seed), 'utf-8');
    loadAppSettingsFrom(settingsPath, () => store);
    loadAppSettingsFrom(settingsPath, () => store);
    expect(readDiskPair(settingsPath)).toEqual({ waEnabled: true, agentEnabled: true });
  });

  it('both true with flag: zero extra writes on second load', () => {
    const { settingsPath, store } = mkStore();
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        ...SETTINGS_DEFAULTS,
        slice2AutonomyOffMigrated: true,
        waEnabled: true,
      }),
      'utf-8',
    );
    loadAppSettingsFrom(settingsPath, () => store);
    const writeSpy = vi.spyOn(atomicWrite, 'writeJsonAtomicSecure');
    loadAppSettingsFrom(settingsPath, () => store);
    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it('both false with flag: false, zero writes on second load', () => {
    const { settingsPath, store } = mkStore();
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        ...SETTINGS_DEFAULTS,
        slice2AutonomyOffMigrated: true,
        waEnabled: false,
        agents: {
          ...SETTINGS_DEFAULTS.agents,
          writingAssistant: { ...SETTINGS_DEFAULTS.agents.writingAssistant, enabled: false },
        },
      }),
      'utf-8',
    );
    loadAppSettingsFrom(settingsPath, () => store);
    const writeSpy = vi.spyOn(atomicWrite, 'writeJsonAtomicSecure');
    const loaded = loadAppSettingsFrom(settingsPath, () => store);
    assertPairFalse(loaded);
    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });
});

describe('WA26-P6 restore path', () => {
  it('restore archive with P1 shape leaves disk pair false', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wa26-p6-'));
    const storyVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wa26-p6-sv-'));
    const notesVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wa26-p6-nv-'));
    const settingsPath = path.join(userData, 'app-settings.json');
    const secretsPath = path.join(userData, 'secrets.json');
    const store = new SecretsStore({ filePath: secretsPath, safeStorage: makeSafeStorage(true) });

    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wa26-p6-stg-'));
    fs.writeFileSync(path.join(staging, 'app-settings.json'), JSON.stringify(waOffP1Shape()), 'utf-8');
    const archivePath = path.join(userData, 'backup.mwbackup');
    await backupAppData({
      userDataPath: staging,
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
    loadAppSettingsFrom(settingsPath, () => store);
    expect(readDiskPair(settingsPath)).toEqual({ waEnabled: false, agentEnabled: false });
  });
});

describe('WA26-P7 secrets unaffected', () => {
  const K = 'sk-ant-WA26-PinValue00000000000000000000001';

  function p3PlusKeysShape(): AppSettings {
    let base: AppSettings = {
      ...SETTINGS_DEFAULTS,
      slice2AutonomyOffMigrated: true,
      waEnabled: true,
      agents: {
        ...SETTINGS_DEFAULTS.agents,
        writingAssistant: { ...SETTINGS_DEFAULTS.agents.writingAssistant, enabled: false },
      },
    };
    for (const keyPath of KEY_FIELD_PATHS) {
      base = setKeyField(base, keyPath, K);
    }
    return base;
  }

  it('pre-init: plaintext keys byte-identical; pair false', () => {
    const { settingsPath } = mkDir();
    const seed = p3PlusKeysShape();
    fs.writeFileSync(settingsPath, JSON.stringify(seed), 'utf-8');

    const loaded = loadAppSettingsFrom(settingsPath, preInitGet);
    assertPairFalse(loaded);
    const disk = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as AppSettings;
    for (const keyPath of KEY_FIELD_PATHS) {
      expect(getKeyField(disk, keyPath), `disk ${keyPath}`).toBe(K);
    }
  });

  it('post-init: zero store mutations; JSON holds no stored secrets', () => {
    const { settingsPath, secretsPath, store } = mkStore();
    const seed = p3PlusKeysShape();
    fs.writeFileSync(settingsPath, JSON.stringify(seed), 'utf-8');
    migrateSecretsFromSettingsFile(settingsPath, store);

    const setSpy = vi.spyOn(store, 'set');
    const deleteSpy = vi.spyOn(store, 'delete');
    const loaded = loadAppSettingsFrom(settingsPath, () => store);
    assertPairFalse(loaded);
    expect(setSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    const json = fs.readFileSync(settingsPath, 'utf-8');
    expect(json).not.toContain(K);
    setSpy.mockRestore();
    deleteSpy.mockRestore();
  });
});

function makeGenerationLogDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE generation_log (
      id TEXT PRIMARY KEY,
      agent TEXT NOT NULL,
      model TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      request_id TEXT,
      tokens_in INTEGER,
      tokens_out INTEGER,
      latency_ms INTEGER NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      payload_digest TEXT
    );
  `);
  return db;
}

describe('WA26-P8a scan gate behavior', () => {
  let budgetDb: DatabaseSync;
  let dbGetterCalls: number;

  beforeEach(() => {
    budgetDb = makeGenerationLogDb();
    dbGetterCalls = 0;
  });

  function settings(overrides: Partial<AppSettings> = {}): AppSettings {
    return {
      ...SETTINGS_DEFAULTS,
      agents: {
        ...SETTINGS_DEFAULTS.agents,
        writingAssistant: {
          ...SETTINGS_DEFAULTS.agents.writingAssistant,
          enabled: true,
          maxTokensPerHour: 10_000,
          maxTokensPerDay: 500_000,
        },
      },
      ...overrides,
    };
  }

  const getDbTracked = () => {
    dbGetterCalls += 1;
    return budgetDb;
  };

  it('(i) enabled false throws coach message; getDb not called', () => {
    const s = settings({
      agents: {
        ...SETTINGS_DEFAULTS.agents,
        writingAssistant: { ...SETTINGS_DEFAULTS.agents.writingAssistant, enabled: false },
      },
    });
    expect(() => assertWritingAssistantScanAllowed(s, getDbTracked)).toThrow(COACH_OFF);
    expect(dbGetterCalls).toBe(0);
  });

  it('(ii) bug shape waEnabled true with enabled false throws coach message', () => {
    const s = settings({
      waEnabled: true,
      agents: {
        ...SETTINGS_DEFAULTS.agents,
        writingAssistant: { ...SETTINGS_DEFAULTS.agents.writingAssistant, enabled: false },
      },
    });
    expect(() => assertWritingAssistantScanAllowed(s, getDbTracked)).toThrow(COACH_OFF);
    expect(dbGetterCalls).toBe(0);
  });

  it('(iii) ai.enabled false throws AI_DISABLED_MESSAGE; getDb not called', () => {
    const s = settings({ ai: { enabled: false } });
    expect(() => assertWritingAssistantScanAllowed(s, getDbTracked)).toThrow(AI_DISABLED_MESSAGE);
    expect(dbGetterCalls).toBe(0);
  });

  it('(iv) enabled true with budget room returns', () => {
    const s = settings();
    expect(() => assertWritingAssistantScanAllowed(s, getDbTracked)).not.toThrow();
    expect(dbGetterCalls).toBe(1);
  });

  it('(v) budget exhausted throws hourly cap message', () => {
    const s = settings({
      agents: {
        ...SETTINGS_DEFAULTS.agents,
        writingAssistant: {
          ...SETTINGS_DEFAULTS.agents.writingAssistant,
          enabled: true,
          maxTokensPerHour: 100,
          maxTokensPerDay: 500_000,
        },
      },
    });
    budgetDb
      .prepare(
        `INSERT INTO generation_log
         (id, agent, model, endpoint, request_id, tokens_in, tokens_out, latency_ms, error, created_at, payload_digest)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'wa26-budget',
        'writing-assistant',
        'claude',
        'messages.stream',
        null,
        60,
        60,
        1,
        null,
        new Date().toISOString(),
        'x',
      );
    expect(() => assertWritingAssistantScanAllowed(s, getDbTracked)).toThrow(
      'Writing Coach paused: hourly token cap reached. Try again next window.',
    );
  });
});

describe('WA26-P8b source pin', () => {
  it('SCAN_NOW handler calls assertWritingAssistantScanAllowed first', () => {
    const mainSrc = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'main.ts'),
      'utf-8',
    );
    const gateSrc = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'writingAssistantScanGate.ts'),
      'utf-8',
    );
    expect(gateSrc).not.toMatch(/\bwaEnabled\b/);

    const handler = mainSrc.match(
      /\[IPC_CHANNELS\.WRITING_ASSISTANT_SCAN_NOW\]:[\s\S]*?(?=\n\s*\[IPC_CHANNELS\.)/,
    );
    const body = handler?.[0] ?? '';
    expect(body).toMatch(
      /assertWritingAssistantScanAllowed\(loadAppSettings\(\), getDb\);/,
    );
    const guardIdx = body.indexOf('assertWritingAssistantScanAllowed');
    const scanStartIdx = body.indexOf('WRITING_ASSISTANT_SCAN_START');
    const runScanIdx = body.indexOf('runWritingScan(');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(scanStartIdx).toBeGreaterThan(guardIdx);
    expect(runScanIdx).toBeGreaterThan(guardIdx);
    const handlerBodyStart = body.indexOf('async (payload) => {');
    const afterOpenBrace = body.indexOf('{', handlerBodyStart) + 1;
    const beforeGuard = body.slice(afterOpenBrace, guardIdx);
    expect(beforeGuard.trim()).toBe('');
  });
});

describe('WA26-P9 F3 write error', () => {
  it('write failure does not throw; retries repair on next load', () => {
    const { settingsPath, store } = mkStore();
    const seed = {
      ...SETTINGS_DEFAULTS,
      slice2AutonomyOffMigrated: true,
      waEnabled: true,
      agents: {
        ...SETTINGS_DEFAULTS.agents,
        writingAssistant: { ...SETTINGS_DEFAULTS.agents.writingAssistant, enabled: false },
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(seed), 'utf-8');
    const diskBefore = fs.readFileSync(settingsPath, 'utf-8');

    const realWrite = atomicWrite.writeJsonAtomicSecure;
    let failRepair = true;
    vi.spyOn(atomicWrite, 'writeJsonAtomicSecure').mockImplementation((p, data) => {
      const parsed = data as Record<string, unknown>;
      if (failRepair && parsed.waEnabled === false && parsed.slice2AutonomyOffMigrated === true) {
        throw new Error('EACCES');
      }
      return realWrite(p, data);
    });

    const loaded = loadAppSettingsFrom(settingsPath, () => store);
    assertPairFalse(loaded);
    expect(fs.readFileSync(settingsPath, 'utf-8')).toBe(diskBefore);

    failRepair = false;
    loadAppSettingsFrom(settingsPath, () => store);
    expect(readDiskPair(settingsPath)).toEqual({ waEnabled: false, agentEnabled: false });

    vi.restoreAllMocks();
  });
});

describe('WA26-P10a odd shapes', () => {
  it('array raw: no throw; false when saved false exists', () => {
    const { settingsPath, store } = mkStore();
    fs.writeFileSync(settingsPath, JSON.stringify([]), 'utf-8');
    expect(() => loadAppSettingsFrom(settingsPath, () => store)).not.toThrow();
  });

  it('agents null with waEnabled false: pair false, settings kept, zero writes', () => {
    const { settingsPath, store } = mkStore();
    for (const agents of [null, 'x', [], 5]) {
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({
          theme: 'dark',
          slice2AutonomyOffMigrated: true,
          waEnabled: false,
          agents,
        }),
        'utf-8',
      );
      const writeSpy = vi.spyOn(atomicWrite, 'writeJsonAtomicSecure');
      const loaded = loadAppSettingsFrom(settingsPath, () => store);
      assertPairFalse(loaded);
      expect(loaded.theme).toBe('dark');
      expect(writeSpy).not.toHaveBeenCalled();
      writeSpy.mockRestore();
    }
  });

  it('writingAssistant odd shapes with waEnabled false', () => {
    const { settingsPath, store } = mkStore();
    for (const writingAssistant of [null, [], 'abc']) {
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({
          slice2AutonomyOffMigrated: true,
          waEnabled: false,
          agents: { writingAssistant },
        }),
        'utf-8',
      );
      const writeSpy = vi.spyOn(atomicWrite, 'writeJsonAtomicSecure');
      const loaded = loadAppSettingsFrom(settingsPath, () => store);
      assertPairFalse(loaded);
      expect(writeSpy).not.toHaveBeenCalled();
      writeSpy.mockRestore();
    }
  });

  it('non-boolean waEnabled and enabled combinations', () => {
    const { settingsPath, store } = mkStore();
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        slice2AutonomyOffMigrated: true,
        waEnabled: 'false',
        agents: {
          writingAssistant: { ...SETTINGS_DEFAULTS.agents.writingAssistant, enabled: false },
        },
      }),
      'utf-8',
    );
    assertPairFalse(loadAppSettingsFrom(settingsPath, () => store));

    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        slice2AutonomyOffMigrated: true,
        waEnabled: false,
        agents: {
          writingAssistant: { ...SETTINGS_DEFAULTS.agents.writingAssistant, enabled: 'false' },
        },
      }),
      'utf-8',
    );
    assertPairFalse(loadAppSettingsFrom(settingsPath, () => store));

    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        slice2AutonomyOffMigrated: true,
        agents: {
          writingAssistant: { ...SETTINGS_DEFAULTS.agents.writingAssistant, enabled: 'false' },
        },
      }),
      'utf-8',
    );
    const onDefault = loadAppSettingsFrom(settingsPath, () => store);
    expect(onDefault.waEnabled).toBe(true);
    expect(onDefault.agents.writingAssistant.enabled).toBe(true);
  });
});

describe('WA26-P10b buildWaPairRepair', () => {
  it('returns null for invalid shapes; creates missing objects; preserves siblings', () => {
    expect(buildWaPairRepair([], false)).toBeNull();
    expect(buildWaPairRepair({ agents: null }, false)).toBeNull();
    expect(buildWaPairRepair({ agents: [] }, false)).toBeNull();
    expect(buildWaPairRepair({ agents: 'x' }, false)).toBeNull();
    expect(buildWaPairRepair({ agents: { writingAssistant: null } }, false)).toBeNull();
    expect(buildWaPairRepair({ agents: { writingAssistant: [] } }, false)).toBeNull();
    expect(buildWaPairRepair({ agents: { writingAssistant: 'abc' } }, false)).toBeNull();

    const raw = {
      theme: 'dark',
      agents: { brainstorm: { enabled: true }, writingAssistant: { model: 'x' } },
    };
    const repaired = buildWaPairRepair(raw, false);
    expect(repaired).not.toBeNull();
    expect(repaired!.waEnabled).toBe(false);
    expect((repaired!.agents as Record<string, unknown>).writingAssistant).toEqual({ model: 'x', enabled: false });
    expect((repaired!.agents as Record<string, unknown>).brainstorm).toEqual({ enabled: true });
    expect(raw).toEqual({
      theme: 'dark',
      agents: { brainstorm: { enabled: true }, writingAssistant: { model: 'x' } },
    });

    const noAgents = { theme: 'light' };
    const created = buildWaPairRepair(noAgents, true);
    expect(created?.agents).toEqual({ writingAssistant: { enabled: true } });
  });
});
