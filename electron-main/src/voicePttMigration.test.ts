/**
 * voicePttMigration.test.ts (SKY-7771)
 *
 * Unit tests for the voice.pushToTalkMode → voice.voiceMode migration
 * applied by loadAppSettings() via migrateVoicePushToTalk():
 *   §1  Back-fills voiceMode='push-to-talk' when pushToTalkMode=true and voiceMode absent
 *   §2  Leaves an explicit voiceMode alone, even if pushToTalkMode=true
 *   §3  Drops the legacy pushToTalkMode key from the migrated settings
 *   §4  No-ops when voice is absent or pushToTalkMode was never set
 */

import { describe, it, expect } from 'vitest';
import { migrateVoicePushToTalk, type LegacyVoiceSettings } from './voiceSettingsMigration.js';

const legacy = (v: Partial<LegacyVoiceSettings>): LegacyVoiceSettings =>
  ({ enabled: true, cloudFallback: false, ...v }) as LegacyVoiceSettings;

describe('voice settings — pushToTalkMode migration (§1)', () => {
  it('back-fills voiceMode=push-to-talk when pushToTalkMode=true and voiceMode is absent', () => {
    const voice = migrateVoicePushToTalk(legacy({ pushToTalkMode: true }));
    expect(voice?.voiceMode).toBe('push-to-talk');
  });
});

describe('voice settings — explicit voiceMode preserved (§2)', () => {
  it('does not override an explicit voiceMode=toggle even when pushToTalkMode=true', () => {
    const voice = migrateVoicePushToTalk(legacy({ pushToTalkMode: true, voiceMode: 'toggle' }));
    expect(voice?.voiceMode).toBe('toggle');
  });

  it('does not touch voiceMode when pushToTalkMode is absent', () => {
    const voice = migrateVoicePushToTalk(legacy({ voiceMode: 'toggle' }));
    expect(voice?.voiceMode).toBe('toggle');
  });
});

describe('voice settings — legacy key dropped (§3)', () => {
  it('removes pushToTalkMode from the migrated voice settings', () => {
    const voice = migrateVoicePushToTalk(legacy({ pushToTalkMode: true }));
    expect((voice as unknown as Record<string, unknown>).pushToTalkMode).toBeUndefined();
    expect(voice && 'pushToTalkMode' in voice).toBe(false);
  });

  it('removes pushToTalkMode=false without setting voiceMode', () => {
    const voice = migrateVoicePushToTalk(legacy({ pushToTalkMode: false }));
    expect(voice && 'pushToTalkMode' in voice).toBe(false);
    expect(voice?.voiceMode).toBeUndefined();
  });
});

describe('voice settings — no-op cases (§4)', () => {
  it('returns undefined when voice is absent entirely', () => {
    expect(migrateVoicePushToTalk(undefined)).toBeUndefined();
  });

  it('returns the same object untouched when there is nothing to migrate', () => {
    const voice = legacy({ voiceMode: 'push-to-talk' });
    expect(migrateVoicePushToTalk(voice)).toBe(voice);
  });

  it('is idempotent — running migration twice gives the same result', () => {
    const first = migrateVoicePushToTalk(legacy({ pushToTalkMode: true }));
    const second = migrateVoicePushToTalk(first as LegacyVoiceSettings);
    expect(second).toEqual(first);
  });
});
