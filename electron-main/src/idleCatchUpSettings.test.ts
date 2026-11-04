/**
 * PLAN-IDLE-CATCH-UP — main-process `AppSettings.idleCatchUp` clamp.
 *
 * Purpose: owns the main normalizer matrix and the load / save wiring in
 * appSettingsLoad.ts; never boots Electron. Expected values are written out
 * on purpose — do not derive them from the constants under test.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { AppSettings } from './ipc.js';
import { SETTINGS_DEFAULTS, loadAppSettingsFrom, saveAppSettingsTo } from './appSettingsLoad.js';
import { normalizeIdleCatchUpSettings } from './idleCatchUpSettings.aug.js';
import { SecretsStore } from './secrets/index.js';

const tempDirs: string[] = [];

function mkSettingsStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-catch-up-settings-'));
  tempDirs.push(dir);
  const settingsPath = path.join(dir, 'app-settings.json');
  const store = new SecretsStore({
    filePath: path.join(dir, 'secrets.json'),
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (s: string) => Buffer.from(s, 'utf-8'),
      decryptString: (b: Buffer) => b.toString('utf-8'),
    },
  });
  return { settingsPath, store };
}

function readDisk(settingsPath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('normalizeIdleCatchUpSettings', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'on'],
    ['a number', 5],
    ['an array', [true, 5]],
    ['an empty object', {}],
  ])('missing / malformed (%s) → { enabled: true, minutes: 2 }', (_label, raw) => {
    expect(normalizeIdleCatchUpSettings(raw)).toEqual({ enabled: true, minutes: 2 });
  });

  it('enabled is false only when it is explicitly false', () => {
    expect(normalizeIdleCatchUpSettings({ enabled: false, minutes: 2 }).enabled).toBe(false);
    for (const enabled of [true, undefined, null, 0, '', 'false', 'no']) {
      expect(normalizeIdleCatchUpSettings({ enabled, minutes: 2 }).enabled, String(enabled)).toBe(true);
    }
  });

  it.each([
    [0, 1],
    [-4, 1],
    [1, 1],
    [2, 2],
    [30, 30],
    [99, 30],
    [2.6, 3],
    [2.4, 2],
    ['5', 5],
    [' 7 ', 7],
    ['40', 30],
  ])('minutes %j clamps to %j', (minutes, expected) => {
    expect(normalizeIdleCatchUpSettings({ enabled: true, minutes }).minutes).toBe(expected);
  });

  it.each([
    ['NaN', Number.NaN],
    ["'abc'", 'abc'],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ["''", ''],
    ["'   '", '   '],
    ['null', null],
    ['undefined', undefined],
    ['an object', { n: 5 }],
    ['a boolean', true],
  ])('junk minutes (%s) → 2', (_label, minutes) => {
    expect(normalizeIdleCatchUpSettings({ enabled: true, minutes }).minutes).toBe(2);
  });

  it('drops unknown keys', () => {
    expect(normalizeIdleCatchUpSettings({ enabled: false, minutes: 4, extra: 'x' })).toEqual({
      enabled: false,
      minutes: 4,
    });
  });
});

describe('loadAppSettingsFrom — idleCatchUp', () => {
  it('leaves idleCatchUp absent when the saved file has no key', () => {
    const { settingsPath, store } = mkSettingsStore();
    fs.writeFileSync(settingsPath, JSON.stringify({ slice2AutonomyOffMigrated: true }));

    const loaded = loadAppSettingsFrom(settingsPath, () => store);

    expect('idleCatchUp' in loaded).toBe(false);
  });

  it('leaves idleCatchUp absent when there is no settings file', () => {
    const { settingsPath, store } = mkSettingsStore();
    const loaded = loadAppSettingsFrom(settingsPath, () => store);
    expect(loaded.idleCatchUp).toBeUndefined();
  });

  it('clamps a saved out-of-range value in memory and does not write on read', () => {
    const { settingsPath, store } = mkSettingsStore();
    const raw = JSON.stringify({ slice2AutonomyOffMigrated: true, idleCatchUp: { enabled: 'no', minutes: 0 } });
    fs.writeFileSync(settingsPath, raw);

    const loaded = loadAppSettingsFrom(settingsPath, () => store);

    expect(loaded.idleCatchUp).toEqual({ enabled: true, minutes: 1 });
    expect(fs.readFileSync(settingsPath, 'utf-8')).toBe(raw);
  });

  it('keeps a valid saved value, rounding fractional minutes', () => {
    const { settingsPath, store } = mkSettingsStore();
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ slice2AutonomyOffMigrated: true, idleCatchUp: { enabled: false, minutes: 2.6 } }),
    );

    const loaded = loadAppSettingsFrom(settingsPath, () => store);

    expect(loaded.idleCatchUp).toEqual({ enabled: false, minutes: 3 });
  });

  it('a saved null becomes the defaults', () => {
    const { settingsPath, store } = mkSettingsStore();
    fs.writeFileSync(settingsPath, JSON.stringify({ slice2AutonomyOffMigrated: true, idleCatchUp: null }));

    const loaded = loadAppSettingsFrom(settingsPath, () => store);

    expect(loaded.idleCatchUp).toEqual({ enabled: true, minutes: 2 });
  });
});

describe('saveAppSettingsTo — idleCatchUp', () => {
  it('clamps minutes before persisting', () => {
    const { settingsPath, store } = mkSettingsStore();
    const settings: AppSettings = {
      ...SETTINGS_DEFAULTS,
      idleCatchUp: { enabled: false, minutes: 99 },
    };

    saveAppSettingsTo(settingsPath, () => store, settings);

    expect(readDisk(settingsPath).idleCatchUp).toEqual({ enabled: false, minutes: 30 });
    // The caller's object is not mutated.
    expect(settings.idleCatchUp).toEqual({ enabled: false, minutes: 99 });
  });

  it('replaces junk from the renderer with the defaults', () => {
    const { settingsPath, store } = mkSettingsStore();
    const settings = {
      ...SETTINGS_DEFAULTS,
      idleCatchUp: { enabled: 'yes', minutes: 'abc' },
    } as unknown as AppSettings;

    saveAppSettingsTo(settingsPath, () => store, settings);

    expect(readDisk(settingsPath).idleCatchUp).toEqual({ enabled: true, minutes: 2 });
  });

  it('does not add idleCatchUp when the saved object has none', () => {
    const { settingsPath, store } = mkSettingsStore();

    saveAppSettingsTo(settingsPath, () => store, { ...SETTINGS_DEFAULTS });

    expect('idleCatchUp' in readDisk(settingsPath)).toBe(false);
  });

  it('round-trips: save then load gives the clamped value', () => {
    const { settingsPath, store } = mkSettingsStore();
    saveAppSettingsTo(settingsPath, () => store, {
      ...SETTINGS_DEFAULTS,
      slice2AutonomyOffMigrated: true,
      idleCatchUp: { enabled: true, minutes: 0 },
    });

    const loaded = loadAppSettingsFrom(settingsPath, () => store);

    expect(loaded.idleCatchUp).toEqual({ enabled: true, minutes: 1 });
  });
});
