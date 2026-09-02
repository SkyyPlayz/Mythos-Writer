// Beta 3 M13 / Beta 4 M11 — reader voice-picker enumeration.
//
// The prototype's voice list (v2 prototype 6733–6735) shows English OS voices
// plus Edge natural + Piper/Kokoro entries. The shipped list mirrors that
// shape honestly:
//   · the OS speechSynthesis voices that actually exist (Windows surfaces its
//     Edge natural voices here — they're detected and labeled as such),
//   · the configured Piper/cloud engine voice when one is set up,
//   · catalog entries for Edge naturals and offline Piper/Kokoro voices whose
//     engines are NOT wired yet (SKY-11230 Part 2) — each is flagged
//     `available: false` and carries a setupHint. The picker marks these
//     unavailable and refuses to switch playback to them, so a natural voice
//     never silently plays the system voice instead (SKY-11242).
//   · whatever voice id the user stored in Settings → Voice.
// Degrades to a Default entry + catalog when nothing is enumerable.

import { hasTtsEngine, type TtsEngineSettings } from '../hooks/useTtsPlayer';

/** Which engine drives a voice — used to group the picker (SKY-11242 AC4). */
export type ReaderVoiceEngine = 'default' | 'system' | 'edge' | 'piper' | 'kokoro' | 'cloud';

export interface ReaderVoiceOption {
  /** '' = engine default; otherwise a voice name/id forwarded as ttsVoiceId. */
  value: string;
  label: string;
  /** The engine this voice belongs to; the picker groups options by it. */
  engine: ReaderVoiceEngine;
  /**
   * False when picking this entry can't drive its engine yet (Part 1: every
   * Edge/Piper/Kokoro catalog voice). The picker marks it visibly unavailable
   * and does NOT switch playback to it — so it never plays a different voice
   * than the label promises (SKY-11242 AC1/AC5).
   */
  available: boolean;
  /**
   * Present for unavailable voices — the self-explanation the UI surfaces
   * (toast) when the entry is picked, instead of quietly reading with the
   * wrong voice.
   */
  setupHint?: string;
}

/** AppSettings.tts carries the engine's voice id alongside the engine config. */
export type ReaderTtsSettings = TtsEngineSettings & { voiceId?: string };

/** Keep the dropdown scannable — the OS can report dozens of voices. */
const MAX_OS_VOICES = 12;

// ── catalog entries (prototype voiceOpts e0–e6) ──────────────────────────────

const EDGE_HINT =
  'Edge natural voices are provided by Windows — not installed on this system yet, so this voice can’t play. The current voice keeps reading.';
const PIPER_HINT =
  'Piper voices run fully offline once the Piper engine is set up in Settings → Voice — until then this voice can’t play and the current voice keeps reading.';
const KOKORO_HINT =
  'Kokoro voices run offline once a Kokoro engine is set up in Settings → Voice — until then this voice can’t play and the current voice keeps reading.';

const EDGE_CATALOG: ReadonlyArray<readonly [string, string]> = [
  ['edge:aria', 'Aria Natural — Edge'],
  ['edge:guy', 'Guy Natural — Edge'],
  ['edge:jenny', 'Jenny Natural — Edge'],
];

const OFFLINE_CATALOG: ReadonlyArray<readonly [string, string, ReaderVoiceEngine, string]> = [
  ['piper:amy', 'Amy — Piper (offline)', 'piper', PIPER_HINT],
  ['piper:ryan', 'Ryan — Piper (offline)', 'piper', PIPER_HINT],
  ['kokoro:nicole', 'Nicole — Kokoro (offline)', 'kokoro', KOKORO_HINT],
  ['kokoro:sky', 'Sky — Kokoro (offline)', 'kokoro', KOKORO_HINT],
];

/** True for catalog picks (edge:/piper:/kokoro:) that name an engine, not a voice id. */
export function isCatalogReaderVoice(value: string): boolean {
  return /^(edge|piper|kokoro):/.test(value);
}

/**
 * Whether picking `value` can actually drive its engine right now.
 *
 * Part 1 scope (SKY-11242): the Edge/Piper/Kokoro catalog engines are not
 * wired yet (SKY-11230 Part 2), so every catalog voice is unavailable. OS
 * speechSynthesis voices, the configured engine voice, and the default ('')
 * are available. The picker uses this to mark entries and to refuse a switch
 * to an unavailable voice.
 */
export function isReaderVoiceAvailable(value: string): boolean {
  return !isCatalogReaderVoice(value);
}

/**
 * The voice id to actually forward to the TTS stack for a picker value.
 *
 * An unavailable catalog value (its engine isn't set up) resolves to ''
 * (engine default) as a safety net for a roamed/stored preference — the picker
 * itself refuses to *switch* to such a value, so a fresh pick never reaches
 * here. Everything else passes through unchanged.
 */
export function resolveReaderVoiceId(value: string): string {
  return isReaderVoiceAvailable(value) ? value : '';
}

/** The self-explanation to surface when an unavailable `value` is picked. */
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
 * Every option carries `engine` (for grouping) and `available` (for the
 * unavailable-marking + no-silent-fallback behavior, SKY-11242).
 */
export function listReaderVoices(
  ttsSettings?: ReaderTtsSettings,
  selectedVoiceId?: string
): ReaderVoiceOption[] {
  const options: ReaderVoiceOption[] = [
    { value: '', label: 'Default voice', engine: 'default', available: true },
  ];
  const seen = new Set<string>(['']);
  const push = (
    value: string | undefined,
    label: string,
    engine: ReaderVoiceEngine,
    setupHint?: string
  ) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    const available = isReaderVoiceAvailable(value);
    options.push(available ? { value, label, engine, available } : { value, label, engine, available, setupHint });
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
    const natural = isEdgeNatural(v);
    if (natural) hasNatural = true;
    push(v.name, osVoiceLabel(v), natural ? 'edge' : 'system');
  }

  // Edge natural catalog — only when the OS doesn't surface real ones. These
  // are unavailable (engine not wired); the picker marks them and explains.
  if (!hasNatural) {
    for (const [value, label] of EDGE_CATALOG) push(value, label, 'edge', EDGE_HINT);
  }

  // Configured engine voice (Piper local / cloud) from Settings → Voice.
  if (hasTtsEngine(ttsSettings) && ttsSettings?.voiceId) {
    const isCloud =
      ttsSettings.provider === 'cloud' || (!ttsSettings.localBinaryPath && !!ttsSettings.cloudApiKey);
    push(ttsSettings.voiceId, `${ttsSettings.voiceId} — ${isCloud ? 'cloud' : 'Piper (local)'}`, isCloud ? 'cloud' : 'piper');
  }

  // Offline Piper/Kokoro catalog — unavailable in Part 1: the picker marks them
  // and, on pick, toasts the setup hint instead of playing the wrong voice.
  for (const [value, label, engine, hint] of OFFLINE_CATALOG) push(value, label, engine, hint);

  // Whatever is currently selected must stay selectable, even if the OS list
  // changed underneath it (voice prefs roam between machines). A roamed catalog
  // value lands here as unavailable so the picker shows why it isn't playing.
  if (selectedVoiceId && !seen.has(selectedVoiceId)) {
    const engine: ReaderVoiceEngine = isCatalogReaderVoice(selectedVoiceId)
      ? (selectedVoiceId.split(':')[0] as ReaderVoiceEngine)
      : 'system';
    push(selectedVoiceId, `${selectedVoiceId} — configured`, engine, readerVoiceSetupHint(selectedVoiceId));
  }

  return options;
}
