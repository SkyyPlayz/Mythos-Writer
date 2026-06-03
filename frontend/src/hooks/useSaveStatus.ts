import { useState, useCallback } from 'react';

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

interface UseSaveStatusState {
  status: SaveStatus;
  savedAt: Date | null;
}

interface UseSaveStatusReturn {
  saveStatus: SaveStatus;
  savedAt: Date | null;
  markDirty: () => void;
  markSaving: () => void;
  /** Only transitions to saved if currently 'saving' — guards against typing mid-save. */
  markSaved: () => void;
  /** Only transitions to 'error' if currently 'saving'. */
  markError: () => void;
}

export function useSaveStatus(initial: SaveStatus = 'saved'): UseSaveStatusReturn {
  const [state, setState] = useState<UseSaveStatusState>({
    status: initial,
    savedAt: initial === 'saved' ? new Date() : null,
  });

  const markDirty = useCallback(
    () => setState(prev => ({ ...prev, status: 'unsaved' })),
    [],
  );

  const markSaving = useCallback(
    () => setState(prev => ({ ...prev, status: 'saving' })),
    [],
  );

  const markSaved = useCallback(
    () =>
      setState(prev =>
        prev.status === 'saving'
          ? { status: 'saved', savedAt: new Date() }
          : prev,
      ),
    [],
  );

  const markError = useCallback(
    () =>
      setState(prev =>
        prev.status === 'saving' ? { ...prev, status: 'error' } : prev,
      ),
    [],
  );

  return {
    saveStatus: state.status,
    savedAt: state.savedAt,
    markDirty,
    markSaving,
    markSaved,
    markError,
  };
}
