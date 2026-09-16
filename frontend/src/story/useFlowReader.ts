// SKY-11229 — the reader state machine, generalized off a caller-supplied
// flow source so the Notes editor can share it with the Story editor's
// useManuscriptReader instead of growing a second TTS pipeline. Body ported
// unchanged from the original useManuscriptReader (Beta 3 M13 / Beta 4 M11);
// only the story/cursor-specific flow building moved out to a
// ReaderFlowProvider that each caller supplies.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  hasTtsEngine,
  useTtsPlayer,
  type TtsEngineSettings,
  type TtsPlaybackEndReason,
  type TtsVoicePrefs,
} from '../hooks/useTtsPlayer';
import {
  timeSkipIndex,
  sceneSkipIndex,
  READER_SKIP_SECONDS,
  type ReaderFlowItem,
} from './readerFlow';
import { resolveReaderVoiceId } from './readerVoices';

/** Reader utterances are tagged with this card-id prefix in useTtsPlayer. */
const READER_CARD_PREFIX = 'msr-';
/** Stop instead of skipping forever when every utterance fails to play. */
const MAX_CONSECUTIVE_ERRORS = 3;
/** Reader speed range — prototype slider 50–200% (== useTtsPlayer's clamp). */
export const READER_MIN_RATE = 0.5;
export const READER_MAX_RATE = 2;

/**
 * Everything a caller must supply to drive the shared reader engine: how to
 * build the flow of utterances, an identity for the scope it was built for
 * (so resuming can tell a stale flow apart from the current one), and,
 * optionally, where "from cursor" should start (omit when the concept
 * doesn't apply — e.g. a note has no cursor position to resume from).
 */
export interface ReaderFlowProvider {
  buildFlow: () => ReaderFlowItem[];
  scopeKey: () => string;
  startIndex?: (flow: ReaderFlowItem[]) => number;
  /** Whether toggle()'s fresh-start play should resume from cursor (default
   *  true) rather than the top of the flow — the manuscript reader says no
   *  at book zoom, where "the cursor's scene" isn't a meaningful resume point. */
  preferFromCursor?: () => boolean;
}

/** M11: the sentence being read, as offsets into the source text. */
export interface ReaderSentenceRange {
  start: number;
  end: number;
}

/**
 * Reader state + controls handed back to the UI (ReaderBar/ReaderCard and the
 * manuscript/notes toolbar Read buttons). Generic over what's being read —
 * the manuscript's chapter/scene tree via useManuscriptReader, or a single
 * note's prose via useNoteReader.
 */
export interface ManuscriptReader {
  /** Reader bar visibility (prototype reader.open). */
  open: boolean;
  playing: boolean;
  /** Current utterance index into the flow. */
  idx: number;
  flowLength: number;
  /** Block id (or note paragraph id) of the item being read, or null (heading/selection/idle). */
  curKey: string | null;
  /** M11: sentence offsets inside curKey's source text, or null (heading/idle). */
  curRange: ReaderSentenceRange | null;
  /** Session speed, 0.5–2.0 (seeded from voice prefs). */
  rate: number;
  /** Session voice id ('' = default; seeded from voice prefs). */
  voiceId: string;
  /** True while reading a one-off selection (no auto-advance). */
  selOnly: boolean;
  /** Mirrors useTtsPlayer's session mute — playback is a no-op while true. */
  muted: boolean;
  /** False when no engine is configured AND OS speechSynthesis is missing. */
  available: boolean;
  /** Prototype readerStatus: "Reading N of M" / "Paused" / "Ready". */
  status: string;
  /** True when the current scope linearizes to any utterance — false is the
   *  "nothing to read" refusal, distinct from muted/unavailable (GH#946). */
  hasContent: () => boolean;
  openReader: () => void;
  /** Stop playback and hide the bar. */
  close: () => void;
  /** Play/pause. Returns false when playback can't start (muted/unavailable). */
  toggle: () => boolean;
  /** Build a fresh flow and play from the start or the cursor's scene. */
  playFrom: (opts?: { fromCursor?: boolean }) => boolean;
  /** Read exactly this text, once (selection-bar Read action). */
  readSelection: (text: string) => boolean;
  pause: () => void;
  /** Jump to a flow index and play it. */
  seek: (idx: number) => void;
  /** M11: ±~10s of estimated speech (the transport's ∓10s buttons). */
  skipTime: (dir: 1 | -1) => void;
  skipScene: (dir: 1 | -1) => void;
  setRate: (rate: number) => void;
  setVoiceId: (voiceId: string) => void;
}

function clampReaderRate(rate: number | undefined): number {
  if (typeof rate !== 'number' || Number.isNaN(rate)) return 1;
  return Math.min(READER_MAX_RATE, Math.max(READER_MIN_RATE, rate));
}

export function useFlowReader(
  provider: ReaderFlowProvider,
  ttsSettings?: TtsEngineSettings,
  voicePrefs?: TtsVoicePrefs
): ManuscriptReader {
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [idx, setIdx] = useState(0);
  const [curKey, setCurKey] = useState<string | null>(null);
  const [curRange, setCurRange] = useState<{ start: number; end: number } | null>(null);
  const [flow, setFlow] = useState<ReaderFlowItem[]>([]);
  const [selOnly, setSelOnly] = useState(false);
  const [rate, setRateState] = useState(() => clampReaderRate(voicePrefs?.ttsRate));
  const [voiceId, setVoiceIdState] = useState(voicePrefs?.ttsVoiceId ?? '');

  // Refs mirror state for the playback-end callback / imperative actions.
  const flowRef = useRef<ReaderFlowItem[]>(flow);
  const idxRef = useRef(0);
  const playingRef = useRef(false);
  const selOnlyRef = useRef(false);
  const errorStreakRef = useRef(0);
  /** Scope the current flow was built for (prototype reader.sk). */
  const scopeRef = useRef<string | null>(null);

  // Settings load after mount — follow stored prefs until the user takes over
  // (same pattern as useTtsPlayer's persistentMute seeding).
  const touchedRateRef = useRef(false);
  const touchedVoiceRef = useRef(false);
  const prefRate = voicePrefs?.ttsRate;
  const prefVoiceId = voicePrefs?.ttsVoiceId;
  useEffect(() => {
    if (touchedRateRef.current || typeof prefRate !== 'number') return;
    setRateState(clampReaderRate(prefRate));
  }, [prefRate]);
  useEffect(() => {
    if (touchedVoiceRef.current || typeof prefVoiceId !== 'string') return;
    setVoiceIdState(prefVoiceId);
  }, [prefVoiceId]);

  // The reader's session speed/voice override the stored prefs for its own
  // utterances (volume/mute still follow Settings → Voice). Catalog picks
  // (Edge/Piper/Kokoro entries whose engine isn't set up) resolve to the
  // engine default so playback never dies (§1.2).
  const mergedPrefs = useMemo<TtsVoicePrefs>(
    () => ({ ...voicePrefs, ttsRate: rate, ttsVoiceId: resolveReaderVoiceId(voiceId) || undefined }),
    [voicePrefs, rate, voiceId]
  );

  // Break the tts ⇄ advance-callback cycle with a ref filled after both exist.
  const onEndRef = useRef<(cardId: string, reason: TtsPlaybackEndReason) => void>(() => {});
  const ttsOptions = useMemo(
    () => ({
      onPlaybackEnd: (cardId: string, reason: TtsPlaybackEndReason) =>
        onEndRef.current(cardId, reason),
    }),
    []
  );
  const tts = useTtsPlayer(ttsSettings, mergedPrefs, ttsOptions);

  const muted = tts.sessionMuted;
  const mutedRef = useRef(muted);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  const available = useMemo(
    () => hasTtsEngine(ttsSettings) || typeof window.speechSynthesis !== 'undefined',
    [ttsSettings]
  );
  const availableRef = useRef(available);
  useEffect(() => { availableRef.current = available; }, [available]);

  /** Playback stopped (end of flow, error streak, pause) — keep flow + idx. */
  const halt = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    setCurKey(null);
    setCurRange(null);
  }, []);

  const noopAnnounce = useCallback(() => {}, []);

  /** Prototype speakIdx: point the reader at flow[i] and speak it. */
  const speakIdx = useCallback(
    (i: number) => {
      const items = flowRef.current;
      if (i < 0 || i >= items.length || mutedRef.current || !availableRef.current) {
        halt();
        return;
      }
      idxRef.current = i;
      setIdx(i);
      const item = items[i];
      setCurKey(item.key);
      setCurRange(item.key && item.end > item.start ? { start: item.start, end: item.end } : null);
      playingRef.current = true;
      setPlaying(true);
      tts.speakCard(item.text, `${READER_CARD_PREFIX}${i}`, noopAnnounce);
    },
    [tts, halt, noopAnnounce]
  );

  // Chain utterances: natural end advances; errors advance too (prototype
  // u.onerror = done) but a streak of failures stops instead of zipping
  // silently through the whole book.
  useEffect(() => {
    onEndRef.current = (cardId, reason) => {
      if (!cardId.startsWith(READER_CARD_PREFIX) || !playingRef.current) return;
      if (reason === 'error') {
        errorStreakRef.current += 1;
        if (errorStreakRef.current >= MAX_CONSECUTIVE_ERRORS) {
          halt();
          return;
        }
      } else {
        errorStreakRef.current = 0;
      }
      if (selOnlyRef.current) {
        halt();
        return;
      }
      speakIdx(idxRef.current + 1);
    };
  }, [halt, speakIdx]);

  const pause = useCallback(() => {
    playingRef.current = false; // before cancel so a sync end event is ignored
    tts.cancelCurrent();
    setPlaying(false);
    setCurKey(null);
    setCurRange(null);
  }, [tts]);

  /** Install a flow and start speaking at startAt. */
  const begin = useCallback(
    (items: ReaderFlowItem[], startAt: number, sel: boolean): boolean => {
      if (!availableRef.current || mutedRef.current || items.length === 0) return false;
      errorStreakRef.current = 0;
      flowRef.current = items;
      setFlow(items);
      selOnlyRef.current = sel;
      setSelOnly(sel);
      setOpen(true);
      speakIdx(Math.max(0, Math.min(startAt, items.length - 1)));
      return true;
    },
    [speakIdx]
  );

  const playFrom = useCallback(
    (opts?: { fromCursor?: boolean }): boolean => {
      const items = provider.buildFlow();
      scopeRef.current = provider.scopeKey();
      const startAt = opts?.fromCursor ? (provider.startIndex?.(items) ?? 0) : 0;
      return begin(items, startAt, false);
    },
    [provider, begin]
  );

  const readSelection = useCallback(
    (text: string): boolean => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      scopeRef.current = provider.scopeKey();
      return begin(
        [{ text: trimmed, key: null, sceneId: null, sceneOrdinal: 0, start: 0, end: 0 }],
        0,
        true
      );
    },
    [provider, begin]
  );

  // Prototype readerToggle: pause; or resume the same-scope flow; or start
  // fresh (from the cursor's scene except at book zoom).
  const toggle = useCallback((): boolean => {
    if (playingRef.current) {
      pause();
      return true;
    }
    if (
      flowRef.current.length > 0 &&
      !selOnlyRef.current &&
      scopeRef.current === provider.scopeKey()
    ) {
      if (!availableRef.current || mutedRef.current) return false;
      speakIdx(idxRef.current);
      return true;
    }
    return playFrom({ fromCursor: provider.preferFromCursor?.() ?? true });
  }, [pause, provider, speakIdx, playFrom]);

  const seek = useCallback(
    (i: number) => {
      const len = flowRef.current.length;
      if (len === 0) return;
      speakIdx(Math.max(0, Math.min(len - 1, Math.round(i))));
    },
    [speakIdx]
  );

  // ±10s of estimated speech at the current rate (prototype's ∓10s buttons,
  // recalibrated for M11's sentence-level flow items).
  const rateRef = useRef(rate);
  useEffect(() => { rateRef.current = rate; }, [rate]);
  const skipTime = useCallback(
    (dir: 1 | -1) => {
      const target = timeSkipIndex(
        flowRef.current,
        idxRef.current,
        dir,
        READER_SKIP_SECONDS,
        rateRef.current
      );
      if (target > -1) speakIdx(target);
    },
    [speakIdx]
  );

  const skipScene = useCallback(
    (dir: 1 | -1) => {
      const target = sceneSkipIndex(flowRef.current, idxRef.current, dir);
      if (target > -1) speakIdx(target);
    },
    [speakIdx]
  );

  const setRate = useCallback((next: number) => {
    touchedRateRef.current = true;
    setRateState(clampReaderRate(next));
  }, []);

  const setVoiceId = useCallback((next: string) => {
    touchedVoiceRef.current = true;
    setVoiceIdState(next);
  }, []);

  // Only consulted on a refused play (rare, user-initiated), so building the
  // flow to test emptiness is fine — and can't drift from playFrom's own build.
  const hasContent = useCallback(() => provider.buildFlow().length > 0, [provider]);

  const openReader = useCallback(() => setOpen(true), []);

  const close = useCallback(() => {
    pause();
    setOpen(false);
  }, [pause]);

  // Stop speaking when the view unmounts (tab switch, story/note close) — an
  // OS utterance would otherwise keep talking over the next view.
  const cancelRef = useRef(tts.cancelCurrent);
  useEffect(() => { cancelRef.current = tts.cancelCurrent; }, [tts.cancelCurrent]);
  useEffect(
    () => () => {
      playingRef.current = false;
      cancelRef.current();
    },
    []
  );

  const status = playing
    ? `Reading ${idx + 1} of ${flow.length}`
    : flow.length > 0
      ? 'Paused'
      : 'Ready';

  return {
    open,
    playing,
    idx,
    flowLength: flow.length,
    curKey,
    curRange,
    rate,
    voiceId,
    selOnly,
    muted,
    available,
    status,
    hasContent,
    openReader,
    close,
    toggle,
    playFrom,
    readSelection,
    pause,
    seek,
    skipTime,
    skipScene,
    setRate,
    setVoiceId,
  };
}
