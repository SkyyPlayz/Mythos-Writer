import type { SttSettings, TtsSettings } from './ipc.js';
import type { TelemetryEvent } from './telemetry.js';

type VoiceProviderKind = 'stt' | 'tts';
type VoiceProvider = SttSettings['provider'] | TtsSettings['provider'];

function normalizeLatencyMs(latencyMs: number): number {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return 0;
  return Math.round(latencyMs);
}

function providerSwitchEvent(
  kind: VoiceProviderKind,
  from: VoiceProvider,
  to: VoiceProvider,
  latencyMs: number,
): TelemetryEvent {
  return {
    type: 'feature:voice-provider-switch',
    meta: {
      kind,
      from,
      to,
      latencyMs: normalizeLatencyMs(latencyMs),
    },
  };
}

export function buildVoiceProviderSwitchEvents(
  currentStt: SttSettings | undefined,
  nextStt: SttSettings | undefined,
  currentTts: TtsSettings | undefined,
  nextTts: TtsSettings | undefined,
  latencyMs: number,
): TelemetryEvent[] {
  const events: TelemetryEvent[] = [];

  if (currentStt && nextStt && currentStt.provider !== nextStt.provider) {
    events.push(providerSwitchEvent('stt', currentStt.provider, nextStt.provider, latencyMs));
  }

  if (currentTts && nextTts && currentTts.provider !== nextTts.provider) {
    events.push(providerSwitchEvent('tts', currentTts.provider, nextTts.provider, latencyMs));
  }

  return events;
}
