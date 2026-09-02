// SKY-11244 — content-source-agnostic TTS reader engine, extracted out of
// useManuscriptReader so a flat note's prose can drive the exact same state
// machine (useTtsPlayer playback, highlight tracking, play/pause/stop/seek/
// rate/voice) as the Story Editor's scene/chapter manuscript. The Story
// Editor keeps its Story/ManuscriptCursor-shaped source (useManuscriptReader);
// the Notes Editor gets a note-shaped source (useNoteReader) that speaks a
// single linear block instead of a book's scenes/chapters.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  hasTtsEngine,
  useTtsPlayer,
  type TtsEngineSettings,
  type TtsPlaybackEndReason,
  type TtsVoicePrefs,
} from '../hooks/useTtsPlayer';
import {
  sceneSkipIndex,
  timeSkipIndex,
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

/** M11: the sentence being read, as offsets into the block's content. */
export interface ReaderSentenceRange {
  start: number;
  end: number;
}

export interface ManuscriptReader {
  /** Reader bar visibility (prototype reader.open). */
  open: boolean;
  playing: boolean;
  /** Current utterance index into the flow. */
  idx: number;
  flowLength: number;
  /** Block id of the paragraph being read, or null (heading/selection/idle). */
  curKey: string | null;
  /** M11: sentence offsets inside curKey's block, or null (heading/idle). */
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
  /** Build a fresh flow and play from the start or the source's cursor. */
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

/**
 * The reader engine's view of "where the content comes from" — a Story +
 * ManuscriptCursor for the Story Editor, a note's plain text for the Notes
 * Editor. Everything else (playback, highlight, transport) is identical.
 */
export interface ReaderFlowSource {
  /** Linearize the current scope into utterances. Called fresh on every play. */
  buildFlow: () => ReaderFlowItem[];
  /** Identity of the scope buildFlow() covers (prototype `reader.sk`) — a
   *  change invalidates a same-scope resume (see toggle()). */
  scopeKey: () => string;
  /** Start index for a "from cursor" play. Omit for sources with no cursor
   *  concept (e.g. a flat note) — defaults to the top of the flow. */
  startIndex?: (flow: ReaderFlowItem[]) => number;
  /** Whether toggle()'s fresh (no resumable flow) play defaults to "from
   *  cursor" vs "from start". Defaults to true; irrelevant when startIndex
   *  is omitted, since both resolve to index 0. */
  freshPlayFromCursor?: boolean;
}

function clampReaderRate(rate: number | undefined): number {
  if (typeof rate !== 'number' || Number.isNaN(rate)) return 1;
  return Math.min(READER_MAX_RATE, Math.max(READER_MIN_RATE, rate));
}

export function useReaderEngine(
  source: ReaderFlowSource,
  ttsSettings?: TtsEngineSettings,
  voicePrefs?: TtsVoicePrefs
): ManuscriptReader {
  // The source closes over whatever the caller's render captured (story +
  // cursor, or a note's latest text) — mirror it into a ref every render so
  // the stable callbacks below always read the current scope, not a stale
  // closure from the render that created them.
  const sourceRef = useRef(source);
  sourceRef.current = source;

  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [idx, setIdx] = useState(0);
  const [curKey, setCurKey] = useState<string | null>(null);
  const [curRange, setCurRange] = useState<ReaderSentenceRange | null>(null);
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
      const src = sourceRef.current;
      const items = src.buildFlow();
      scopeRef.current = src.scopeKey();
      const startAt = opts?.fromCursor && src.startIndex ? src.startIndex(items) : 0;
      return begin(items, startAt, false);
    },
    [begin]
  );

  const readSelection = useCallback(
    (text: string): boolean => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      scopeRef.current = sourceRef.current.scopeKey();
      return begin(
        [{ text: trimmed, key: null, sceneId: null, sceneOrdinal: 0, start: 0, end: 0 }],
        0,
        true
      );
    },
    [begin]
  );

  // Prototype readerToggle: pause; or resume the same-scope flow; or start
  // fresh (from the source's cursor unless it opts out, e.g. book zoom).
  const toggle = useCallback((): boolean => {
    if (playingRef.current) {
      pause();
      return true;
    }
    if (
      flowRef.current.length > 0 &&
      !selOnlyRef.current &&
      scopeRef.current === sourceRef.current.scopeKey()
    ) {
      if (!availableRef.current || mutedRef.current) return false;
      speakIdx(idxRef.current);
      return true;
    }
    return playFrom({ fromCursor: sourceRef.current.freshPlayFromCursor ?? true });
  }, [pause, speakIdx, playFrom]);

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
  const hasContent = useCallback(() => sourceRef.current.buildFlow().length > 0, []);

  const openReader = useCallback(() => setOpen(true), []);

  const close = useCallback(() => {
    pause();
    setOpen(false);
  }, [pause]);

  // Stop speaking when the host view unmounts (tab switch, story/note close)
  // — an OS utterance would otherwise keep talking over the next view.
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
