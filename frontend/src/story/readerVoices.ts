// Beta 3 M13 / Beta 4 M11 — reader voice-picker enumeration.
//
// The prototype's voice list (v2 prototype 6733–6735) shows English OS voices
// plus Edge natural + Piper/Kokoro entries whose picks toast an explanation.
// The shipped list mirrors that shape honestly:
//   · the OS speechSynthesis voices that actually exist (Windows surfaces its
//     Edge natural voices here — they're detected and labeled as such),
//   · the configured Piper/cloud engine voice when one is set up,
//   · catalog entries for Edge naturals and offline Piper/Kokoro voices that
//     are NOT available yet — each carries a setupHint the UI toasts on pick
//     while playback falls back to the default voice (§1.2 "nothing is dead"),
//   · whatever voice id the user stored in Settings → Voice.
// Degrades to a Default entry + catalog when nothing is enumerable.

import { hasTtsEngine, type TtsEngineSettings } from '../hooks/useTtsPlayer';

export interface ReaderVoiceOption {
  /** '' = engine default; otherwise a voice name/id forwarded as ttsVoiceId. */
  value: string;
  label: string;
  /**
   * Present when picking this entry can't drive its engine yet — the UI
   * must explain it (toast) and playback falls back to the default voice.
   */
  setupHint?: string;
}

/** AppSettings.tts carries the engine's voice id alongside the engine config. */
export type ReaderTtsSettings = TtsEngineSettings & { voiceId?: string };

/** Keep the dropdown scannable — the OS can report dozens of voices. */
const MAX_OS_VOICES = 12;

// ── catalog entries (prototype voiceOpts e0–e6) ──────────────────────────────

const EDGE_HINT =
  'Edge natural voices are provided by Windows — not on this system yet, so the default voice reads for now';
const PIPER_HINT =
  'Piper voices run fully offline once the Piper engine is set up in Settings → Voice — the default voice reads for now';
const KOKORO_HINT =
  'Kokoro voices run offline once a Kokoro engine is set up in Settings → Voice — the default voice reads for now';

const EDGE_CATALOG: ReadonlyArray<readonly [string, string]> = [
  ['edge:aria', 'Aria Natural — Edge'],
  ['edge:guy', 'Guy Natural — Edge'],
  ['edge:jenny', 'Jenny Natural — Edge'],
];

const OFFLINE_CATALOG: ReadonlyArray<readonly [string, string, string]> = [
  ['piper:amy', 'Amy — Piper (offline)', PIPER_HINT],
  ['piper:ryan', 'Ryan — Piper (offline)', PIPER_HINT],
  ['kokoro:nicole', 'Nicole — Kokoro (offline)', KOKORO_HINT],
  ['kokoro:sky', 'Sky — Kokoro (offline)', KOKORO_HINT],
];

/** True for catalog picks (edge:/piper:/kokoro:) that name an engine, not a voice id. */
export function isCatalogReaderVoice(value: string): boolean {
  return /^(edge|piper|kokoro):/.test(value);
}

/**
 * The voice id to actually forward to the TTS stack for a picker value:
 * catalog picks resolve to '' (engine default) so playback never dies on an
 * engine that isn't set up; everything else passes through unchanged.
 */
export function resolveReaderVoiceId(value: string): string {
  return isCatalogReaderVoice(value) ? '' : value;
}

/** The self-explanation to toast when `value` is picked, if it needs one. */
export function readerVoiceSetupHint(value: string): string | undefined {
  if (value.startsWith('edge:')) return EDGE_HINT;
  if (value.startsWith('piper:')) return PIPER_HINT;
  if (value.startsWith('kokoro:')) return KOKORO_HINT;
  return undefined;
}

// ── OS voice enumeration ─────────────────────────────────────────────────────

function osVoices(): SpeechSynthesisVoice[] {
  try {
    const synth = (window as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
    return synth?.getVoices?.() ?? [];
  } catch {
    return [];
  }
}

/** Windows surfaces Edge natural voices via speechSynthesis ("… (Natural)"). */
function isEdgeNatural(voice: SpeechSynthesisVoice): boolean {
  return /natural/i.test(voice.name ?? '');
}

function osVoiceLabel(voice: SpeechSynthesisVoice): string {
  const base = (voice.name ?? '')
    .split('(')[0]
    .trim()
    .replace(/^Microsoft\s+/i, '')
    .replace(/\s+Online$/i, '');
  return isEdgeNatural(voice) ? `${base} — Edge natural` : `${base} — system`;
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
  const push = (value: string | undefined, label: string, setupHint?: string) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    options.push(setupHint ? { value, label, setupHint } : { value, label });
  };

  // OS voices — English first (prototype voices() filter), everything as a
  // fallback so non-English systems still get a usable list. Edge naturals
  // sort to the front (prototype ranks them "· best").
  const voices = osVoices();
  const english = voices.filter((v) => (v.lang ?? '').toLowerCase().startsWith('en'));
  const pool = english.length > 0 ? english : voices;
  const ranked = [...pool.filter(isEdgeNatural), ...pool.filter((v) => !isEdgeNatural(v))];
  let hasNatural = false;
  for (const v of ranked.slice(0, MAX_OS_VOICES)) {
    if (isEdgeNatural(v)) hasNatural = true;
    push(v.name, osVoiceLabel(v));
  }

  // Edge natural catalog — only when the OS doesn't surface real ones. Picks
  // explain themselves (setupHint toast) and read with the default voice.
  if (!hasNatural) {
    for (const [value, label] of EDGE_CATALOG) push(value, label, EDGE_HINT);
  }

  // Configured engine voice (Piper local / cloud) from Settings → Voice.
  if (hasTtsEngine(ttsSettings) && ttsSettings?.voiceId) {
    const engine =
      ttsSettings.provider === 'cloud' || (!ttsSettings.localBinaryPath && ttsSettings.cloudApiKey)
        ? 'cloud'
        : 'Piper (local)';
    push(ttsSettings.voiceId, `${ttsSettings.voiceId} — ${engine}`);
  }

  // Offline Piper/Kokoro catalog — never dead: picking one toasts how to set
  // the engine up and keeps reading with the default voice meanwhile.
  for (const [value, label, hint] of OFFLINE_CATALOG) push(value, label, hint);

  // Whatever is currently selected must stay selectable, even if the OS list
  // changed underneath it (voice prefs roam between machines).
  push(selectedVoiceId, `${selectedVoiceId ?? ''} — configured`);

  return options;
}
