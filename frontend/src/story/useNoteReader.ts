// SKY-11229 — the Notes editor's TTS reader. Same engine as the Story
// editor's useManuscriptReader (useFlowReader), scoped to one note's prose
// instead of a story's chapter/scene tree: no headings, no real scene skip,
// one flat flow built from the note's display body (frontmatter/kanban
// trailer already stripped by the caller, markdown syntax stripped here).

import { useMemo } from 'react';
import type { TtsEngineSettings, TtsVoicePrefs } from '../hooks/useTtsPlayer';
import { buildNoteReaderFlow } from './readerFlow';
import { useFlowReader, type ReaderFlowProvider } from './useFlowReader';

export function useNoteReader(
  path: string,
  displayBody: string,
  ttsSettings?: TtsEngineSettings,
  voicePrefs?: TtsVoicePrefs
) {
  const provider = useMemo<ReaderFlowProvider>(
    () => ({
      buildFlow: () => buildNoteReaderFlow(displayBody),
      // A note is one flat scope — its path is its own identity, and there's
      // no cursor position to resume into (startIndex/preferFromCursor
      // omitted, so toggle()'s fresh-start always plays from the top).
      scopeKey: () => path,
    }),
    [path, displayBody]
  );
  return useFlowReader(provider, ttsSettings, voicePrefs);
}
