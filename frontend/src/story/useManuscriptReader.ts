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
// SKY-11229: the state machine itself now lives in useFlowReader, shared
// with the Notes editor's useNoteReader — this hook is the story/cursor
// adapter that feeds it a manuscript-shaped flow.

import { useMemo } from 'react';
import type { TtsEngineSettings, TtsVoicePrefs } from '../hooks/useTtsPlayer';
import {
  buildReaderFlow,
  flowScopeKey,
  flowStartIndex,
  type ReaderFlowItem,
} from './readerFlow';
import { useFlowReader, type ReaderFlowProvider } from './useFlowReader';
import type { ManuscriptCursor } from './manuscriptModel';
import type { Story } from '../types';

export {
  READER_MIN_RATE,
  READER_MAX_RATE,
  type ManuscriptReader,
  type ReaderSentenceRange,
} from './useFlowReader';

export function useManuscriptReader(
  story: Story,
  cursor: ManuscriptCursor,
  ttsSettings?: TtsEngineSettings,
  voicePrefs?: TtsVoicePrefs
) {
  const provider = useMemo<ReaderFlowProvider>(
    () => ({
      buildFlow: (): ReaderFlowItem[] => buildReaderFlow(story, cursor),
      scopeKey: () => flowScopeKey(story, cursor),
      startIndex: (flow) => flowStartIndex(flow, story, cursor),
      // Book/part zoom has no single "cursor scene" worth resuming into.
      preferFromCursor: () => cursor.zoom !== 'book',
    }),
    [story, cursor]
  );
  return useFlowReader(provider, ttsSettings, voicePrefs);
}
