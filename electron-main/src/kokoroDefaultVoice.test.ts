/**
 * kokoroDefaultVoice.test.ts (SKY-11241 AC1)
 *
 * loadAppSettings() in main.ts seeds SETTINGS_DEFAULTS (which now includes
 * `voice.ttsVoiceId = 'kokoro:nicole'`) via a shallow `{ ...SETTINGS_DEFAULTS,
 * ...raw }` merge. Mirrors that merge shape (same pattern as
 * waSettingsMigration.test.ts / voicePttMigration.test.ts) to lock in:
 *   §1  A fresh install (no settings file) hears Kokoro with no setup step.
 *   §2  A settings file that never touched `voice` also gets the Kokoro seed.
 *   §3  Any install that already saved a `voice` block keeps its own
 *       ttsVoiceId (or lack of one) — the seed never overrides a real choice.
 */

import { describe, it, expect } from 'vitest';
import type { AppSettings } from './ipc.js';

const SETTINGS_DEFAULTS_VOICE: NonNullable<AppSettings['voice']> = {
  enabled: false,
  cloudFallback: false,
  ttsVoiceId: 'kokoro:nicole',
};

/** Mirrors loadAppSettings()'s `{ ...SETTINGS_DEFAULTS, ...raw }` shallow merge. */
function mergeSettings(raw: Partial<AppSettings>): NonNullable<AppSettings['voice']> {
  const base = { voice: SETTINGS_DEFAULTS_VOICE };
  const merged = { ...base, ...raw }.voice;
  if (!merged) throw new Error('expected a voice block after the merge');
  return merged;
}

describe('SETTINGS_DEFAULTS.voice — Kokoro first-launch default (§1)', () => {
  it('fresh install (no raw settings at all) defaults to kokoro:nicole', () => {
    expect(mergeSettings({}).ttsVoiceId).toBe('kokoro:nicole');
  });
});

describe('SETTINGS_DEFAULTS.voice — settings file present but voice never touched (§2)', () => {
  it('still seeds kokoro:nicole when raw has no voice key', () => {
    const raw: Partial<AppSettings> = { theme: 'dark' };
    expect(mergeSettings(raw).ttsVoiceId).toBe('kokoro:nicole');
  });
});

describe('SETTINGS_DEFAULTS.voice — an install that already saved voice keeps its own value (§3)', () => {
  it('preserves an explicit stored ttsVoiceId', () => {
    const raw: Partial<AppSettings> = {
      voice: { enabled: true, cloudFallback: false, ttsVoiceId: 'en_US/vctk_low' },
    };
    expect(mergeSettings(raw).ttsVoiceId).toBe('en_US/vctk_low');
  });

  it('does not force kokoro onto a saved voice block that never picked a TTS voice', () => {
    const raw: Partial<AppSettings> = {
      voice: { enabled: true, cloudFallback: false, persistentMute: true },
    };
    expect(mergeSettings(raw).ttsVoiceId).toBeUndefined();
  });
});
