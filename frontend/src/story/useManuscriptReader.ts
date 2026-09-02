// Beta 3 M13 — manuscript TTS reader state machine.
//
// Port of the Liquid Neon prototype's reader logic (design-handoff/prototype/
// "Mythos Writer - Liquid Neon.dc.html": reader state 3243, speakIdx
// 3660–3675, readerStart/Stop/Toggle 3676–3696, readerSkip/Scene 3697–3702)
// on top of the existing Beta-2 TTS stack: playback goes through
// useTtsPlayer (Piper/cloud IPC when configured, OS speechSynthesis
// otherwise) — no new TTS engine here. Utterances chain via the hook's
// additive onPlaybackEnd callback; the moving highlight is per paragraph
// (`curKey` = Block id) because neither playback path emits word boundaries.
//
// SKY-11244: the state machine itself now lives in readerEngine.ts
// (content-source-agnostic, shared with the Notes Editor's useNoteReader) —
// this hook is just the Story/ManuscriptCursor-shaped ReaderFlowSource.

import {
  useReaderEngine,
  READER_MIN_RATE,
  READER_MAX_RATE,
  type ManuscriptReader,
  type ReaderFlowSource,
} from './readerEngine';
import {
  buildReaderFlow,
  flowScopeKey,
  flowStartIndex,
} from './readerFlow';
import type { TtsEngineSettings, TtsVoicePrefs } from '../hooks/useTtsPlayer';
import type { ManuscriptCursor } from './manuscriptModel';
import type { Story } from '../types';

export { READER_MIN_RATE, READER_MAX_RATE, type ManuscriptReader };

export function useManuscriptReader(
  story: Story,
  cursor: ManuscriptCursor,
  ttsSettings?: TtsEngineSettings,
  voicePrefs?: TtsVoicePrefs
): ManuscriptReader {
  const source: ReaderFlowSource = {
    buildFlow: () => buildReaderFlow(story, cursor),
    scopeKey: () => flowScopeKey(story, cursor),
    startIndex: (flow) => flowStartIndex(flow, story, cursor),
    // Prototype readerToggle: book zoom has no "cursor scene" to jump to, so
    // a fresh play starts at the top of the book, not wherever the cursor
    // last pointed.
    freshPlayFromCursor: cursor.zoom !== 'book',
  };
  return useReaderEngine(source, ttsSettings, voicePrefs);
}
