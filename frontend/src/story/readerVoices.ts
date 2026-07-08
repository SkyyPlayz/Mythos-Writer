// Beta 3 M13 — reader voice-picker enumeration.
//
// The prototype's voice list (4603–4605) shows English OS voices plus mocked
// Edge/Piper/Kokoro entries. The shipped list is honest instead: the OS
// speechSynthesis voices that actually exist (Windows surfaces its natural
// voices here), plus the configured Piper/cloud engine voice when one is set
// up, plus whatever voice id the user stored in Settings → Voice — degrading
// to a single "Default voice" entry when nothing is enumerable.

import { hasTtsEngine, type TtsEngineSettings } from '../hooks/useTtsPlayer';

export interface ReaderVoiceOption {
  /** '' = engine default; otherwise a voice name/id forwarded as ttsVoiceId. */
  value: string;
  label: string;
}

/** AppSettings.tts carries the engine's voice id alongside the engine config. */
export type ReaderTtsSettings = TtsEngineSettings & { voiceId?: string };

/** Keep the dropdown scannable — the OS can report dozens of voices. */
const MAX_OS_VOICES = 12;

function osVoices(): SpeechSynthesisVoice[] {
  try {
    const synth = (window as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
    return synth?.getVoices?.() ?? [];
  } catch {
    return [];
  }
}

/**
 * Voice options for the reader's picker. Always starts with the default
 * entry; never throws when speechSynthesis is missing (headless/jsdom).
 */
export function listReaderVoices(
  ttsSettings?: ReaderTtsSettings,
  selectedVoiceId?: string
): ReaderVoiceOption[] {
  const options: ReaderVoiceOption[] = [{ value: '', label: 'Default voice' }];
  const seen = new Set<string>(['']);
  const push = (value: string | undefined, label: string) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    options.push({ value, label });
  };

  // OS voices — English first (prototype voices() filter), everything as a
  // fallback so non-English systems still get a usable list.
  const voices = osVoices();
  const english = voices.filter((v) => (v.lang ?? '').toLowerCase().startsWith('en'));
  for (const v of (english.length > 0 ? english : voices).slice(0, MAX_OS_VOICES)) {
    push(v.name, `${v.name.split('(')[0].trim()} — system`);
  }

  // Configured engine voice (Piper local / cloud) from Settings → Voice.
  if (hasTtsEngine(ttsSettings) && ttsSettings?.voiceId) {
    const engine =
      ttsSettings.provider === 'cloud' || (!ttsSettings.localBinaryPath && ttsSettings.cloudApiKey)
        ? 'cloud'
        : 'Piper (local)';
    push(ttsSettings.voiceId, `${ttsSettings.voiceId} — ${engine}`);
  }

  // Whatever is currently selected must stay selectable, even if the OS list
  // changed underneath it (voice prefs roam between machines).
  push(selectedVoiceId, `${selectedVoiceId ?? ''} — configured`);

  return options;
}
