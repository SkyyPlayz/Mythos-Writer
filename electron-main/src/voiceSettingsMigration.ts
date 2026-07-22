import type { AppSettings } from './ipc.js';

/**
 * SKY-7771: voice.pushToTalkMode was a second, independent capture-mode
 * boolean that shipped alongside the canonical voice.voiceMode radio group.
 * Back-fill voiceMode for installs that only ever set the checkbox, then
 * drop the legacy key — but never overwrite an explicit voiceMode choice
 * already on disk.
 */
export type LegacyVoiceSettings = NonNullable<AppSettings['voice']> & { pushToTalkMode?: boolean };

export function migrateVoicePushToTalk(voice: LegacyVoiceSettings | undefined): AppSettings['voice'] | undefined {
  if (!voice) return voice;
  let next: LegacyVoiceSettings = voice;
  if (next.pushToTalkMode === true && next.voiceMode === undefined) {
    next = { ...next, voiceMode: 'push-to-talk' };
  }
  if ('pushToTalkMode' in next) {
    const { pushToTalkMode: _legacy, ...rest } = next;
    next = rest;
  }
  return next;
}
