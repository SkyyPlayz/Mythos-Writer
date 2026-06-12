import { describe, expect, it } from 'vitest';

import { buildVoiceProviderSwitchEvents } from './voiceTelemetry.js';
import type { SttSettings, TtsSettings } from './ipc.js';

const stt = (provider: SttSettings['provider']): SttSettings => ({
  enabled: true,
  provider,
});

const tts = (provider: TtsSettings['provider']): TtsSettings => ({
  enabled: true,
  provider,
});

describe('buildVoiceProviderSwitchEvents', () => {
  it('emits one structured event for an STT provider transition', () => {
    const events = buildVoiceProviderSwitchEvents(stt('cloud'), stt('local'), undefined, undefined, 12.7);

    expect(events).toEqual([
      {
        type: 'feature:voice-provider-switch',
        meta: {
          kind: 'stt',
          from: 'cloud',
          to: 'local',
          latencyMs: 13,
        },
      },
    ]);
  });

  it('emits one structured event per changed voice provider', () => {
    const events = buildVoiceProviderSwitchEvents(stt('cloud'), stt('local'), tts('local'), tts('cloud'), 4);

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.meta)).toEqual([
      { kind: 'stt', from: 'cloud', to: 'local', latencyMs: 4 },
      { kind: 'tts', from: 'local', to: 'cloud', latencyMs: 4 },
    ]);
  });

  it('does not emit for unchanged or missing provider settings', () => {
    expect(buildVoiceProviderSwitchEvents(stt('auto'), stt('auto'), undefined, tts('cloud'), 2)).toEqual([]);
  });
});
