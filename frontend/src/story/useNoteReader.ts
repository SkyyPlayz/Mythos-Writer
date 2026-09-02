// SKY-11244 — Notes Editor TTS reader: the note-shaped sibling of
// useManuscriptReader. A note has no scenes/chapters, just one flat block of
// prose, so it drives the same shared engine (readerEngine.ts) with
// buildNoteReaderFlow instead of buildReaderFlow, scoped by the note's vault
// path instead of a Story id + ManuscriptCursor.

import { useReaderEngine, type ManuscriptReader, type ReaderFlowSource } from './readerEngine';
import { buildNoteReaderFlow } from './readerFlow';
import type { TtsEngineSettings, TtsVoicePrefs } from '../hooks/useTtsPlayer';

export function useNoteReader(
  text: string,
  path: string,
  ttsSettings?: TtsEngineSettings,
  voicePrefs?: TtsVoicePrefs
): ManuscriptReader {
  const source: ReaderFlowSource = {
    buildFlow: () => buildNoteReaderFlow(text),
    // A flat note is one scope, keyed by path — switching notes (or this
    // note's content going empty/non-empty) invalidates a resumed flow the
    // same way a Story Editor scope change does.
    scopeKey: () => `note|${path}`,
  };
  return useReaderEngine(source, ttsSettings, voicePrefs);
}
