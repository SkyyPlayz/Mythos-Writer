/**
 * PLAN-COACHING-OPT-IN — appSettingsLoad default + normalize for `coaching`.
 *
 * Owns: the main-process truth table for a stored `coaching` value (missing,
 * partial, malformed, valid) and the no-write-on-read guarantee.
 * Never touches: renderer prompt gating (frontend partnerPersonality tests).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  COACHING_DEFAULTS,
  loadAppSettingsFrom,
  normalizeCoachingSettings,
} from './appSettingsLoad.js';
import * as atomicWrite from './secrets/atomicWrite.js';
import type { SecretsStore } from './secrets/store.js';

const dirs: string[] = [];

function writeSettings(body: Record<string, unknown> | string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-coaching-'));
  dirs.push(dir);
  const settingsPath = path.join(dir, 'app-settings.json');
  const text = typeof body === 'string'
    ? body
    : JSON.stringify({ theme: 'dark', slice2AutonomyOffMigrated: true, ...body });
  fs.writeFileSync(settingsPath, text, 'utf-8');
  return settingsPath;
}

/** Store not initialized yet — loader takes its documented early-boot path. */
const noStore = (): SecretsStore => {
  throw new Error('store not initialized');
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('normalizeCoachingSettings', () => {
  it('missing / null / non-object → off with a dormant Teacher mode', () => {
    for (const raw of [undefined, null, 'teacher', 1, true, []]) {
      expect(normalizeCoachingSettings(raw)).toEqual({ optIn: false, mode: 'teacher' });
    }
  });

  it('only optIn === true enables Coaching (truthy garbage stays off)', () => {
    for (const optIn of ['true', 1, 'yes', {}, null, undefined, false]) {
      expect(normalizeCoachingSettings({ optIn, mode: 'teacher' }).optIn).toBe(false);
    }
    expect(normalizeCoachingSettings({ optIn: true, mode: 'teacher' }).optIn).toBe(true);
  });

  it('mode outside assistant | teacher falls back to teacher', () => {
    for (const mode of ['Teacher', 'ASSISTANT', 'coach', '', 3, null, undefined]) {
      expect(normalizeCoachingSettings({ optIn: true, mode }).mode).toBe('teacher');
    }
    expect(normalizeCoachingSettings({ optIn: true, mode: 'assistant' }).mode).toBe('assistant');
  });

  it('keeps a user-chosen Assistant mode while Coaching is off (restored on next enable)', () => {
    expect(normalizeCoachingSettings({ optIn: false, mode: 'assistant' }))
      .toEqual({ optIn: false, mode: 'assistant' });
  });

  it('returns a fresh object, never the shared default', () => {
    const a = normalizeCoachingSettings(undefined);
    a.optIn = true;
    expect(COACHING_DEFAULTS.optIn).toBe(false);
    expect(normalizeCoachingSettings(undefined).optIn).toBe(false);
  });
});

describe('loadAppSettingsFrom — coaching', () => {
  it('a settings file without coaching loads as off + dormant Teacher', () => {
    const loaded = loadAppSettingsFrom(writeSettings({}), noStore);
    expect(loaded.coaching).toEqual({ optIn: false, mode: 'teacher' });
  });

  it('no settings file at all → off + dormant Teacher', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-coaching-'));
    dirs.push(dir);
    const loaded = loadAppSettingsFrom(path.join(dir, 'app-settings.json'), noStore);
    expect(loaded.coaching).toEqual({ optIn: false, mode: 'teacher' });
  });

  it('an unparseable file falls back to off (never enables teaching from garbage)', () => {
    const loaded = loadAppSettingsFrom(writeSettings('{ "coaching": { "optIn": true'), noStore);
    expect(loaded.coaching).toEqual({ optIn: false, mode: 'teacher' });
  });

  it('a stored Assistant opt-in survives a relaunch load unchanged', () => {
    const loaded = loadAppSettingsFrom(
      writeSettings({ coaching: { optIn: true, mode: 'assistant' } }),
      noStore,
    );
    expect(loaded.coaching).toEqual({ optIn: true, mode: 'assistant' });
  });

  it('malformed stored values are normalized in memory without writing the file', () => {
    const settingsPath = writeSettings({ coaching: { optIn: 'yes', mode: 'lecturer' } });
    const before = fs.readFileSync(settingsPath, 'utf-8');
    const writeSpy = vi.spyOn(atomicWrite, 'writeJsonAtomicSecure');
    const loaded = loadAppSettingsFrom(settingsPath, noStore);
    expect(loaded.coaching).toEqual({ optIn: false, mode: 'teacher' });
    expect(writeSpy).not.toHaveBeenCalled();
    expect(fs.readFileSync(settingsPath, 'utf-8')).toBe(before);
  });

  it('coaching never changes the Writing Coach master pair (waEnabled / agents.writingAssistant.enabled)', () => {
    const loaded = loadAppSettingsFrom(
      writeSettings({
        waEnabled: false,
        agents: { writingAssistant: { enabled: false, model: '', scanIntervalSeconds: 60 } },
        coaching: { optIn: true, mode: 'teacher' },
      }),
      noStore,
    );
    expect(loaded.coaching).toEqual({ optIn: true, mode: 'teacher' });
    expect(loaded.waEnabled).toBe(false);
    expect(loaded.agents.writingAssistant.enabled).toBe(false);
  });
});
