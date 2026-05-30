import { useState, useCallback } from 'react';

export type SaveStatus = 'saved' | 'saving' | 'unsaved';

interface UseSaveStatusReturn {
  saveStatus: SaveStatus;
  markDirty: () => void;
  markSaving: () => void;
  /** Only transitions saved if currently 'saving' — guards against typing mid-save. */
  markSaved: () => void;
  /** Only transitions to 'unsaved' if currently 'saving'. */
  markError: () => void;
}

export function useSaveStatus(initial: SaveStatus = 'saved'): UseSaveStatusReturn {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(initial);

  const markDirty = useCallback(() => setSaveStatus('unsaved'), []);
  const markSaving = useCallback(() => setSaveStatus('saving'), []);
  const markSaved = useCallback(
    () => setSaveStatus(prev => (prev === 'saving' ? 'saved' : prev)),
    [],
  );
  const markError = useCallback(
    () => setSaveStatus(prev => (prev === 'saving' ? 'unsaved' : prev)),
    [],
  );

  return { saveStatus, markDirty, markSaving, markSaved, markError };
}
