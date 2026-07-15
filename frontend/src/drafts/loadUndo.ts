// Beta 4 M10 — Load draft + exact Undo (prototype loadDraftH / draftUndoH).
//
// Contract (BETA-REFINE M10 acceptance + CF-4):
//   · Load draft snapshots the pre-load state FIRST (the store rollback writes
//     a `pre-rollback` draft), then replaces the scene with the chosen draft.
//   · The yellow Undo chip restores EXACTLY the pre-load state: the editor
//     text is captured verbatim in the renderer BEFORE anything is written,
//     and undo re-applies that byte-identical string — never a re-read that
//     could lag behind a debounced save.
import type { SceneDraftEntry } from './useSceneDrafts';

export interface DraftUndoState {
  sceneId: string;
  /** Byte-identical pre-load editor text. */
  content: string;
  /** Label of the draft that was loaded (for the chip tooltip / toasts). */
  loadedLabel: string;
}

export interface DraftLoadDeps {
  /** Read the live editor text at this instant (exactness source of truth). */
  getCurrentContent: () => string;
  /** Apply text to the editor + persist through the normal save pipeline. */
  applyContent: (content: string) => void;
  /**
   * Store-side load: snapshots the current scene file as `pre-rollback`
   * (CF-4) and writes the target draft to disk. `window.api.versionRollback`
   * bound to the scene in hosts.
   */
  rollback: (ts: string) => Promise<unknown>;
}

/**
 * Load `draft` into the scene. Resolves with the undo state on success;
 * throws (after leaving the editor untouched) when the store write fails.
 *
 * Failure detection covers BOTH shapes non-enveloped IPC produces: a rejected
 * promise AND a resolved `{ error: string }` payload (setupIpcMain sanitizes
 * thrown handler errors into the latter — MYT-790).
 */
export async function loadDraft(
  deps: DraftLoadDeps,
  sceneId: string,
  draft: SceneDraftEntry,
): Promise<DraftUndoState> {
  // Capture BEFORE any write so undo can restore the exact pre-load state.
  const preLoadContent = deps.getCurrentContent();
  const res = await deps.rollback(draft.ts);
  const ipcError = (res as { error?: unknown } | null | undefined)?.error;
  if (typeof ipcError === 'string' && ipcError.length > 0) {
    throw new Error(ipcError);
  }
  deps.applyContent(draft.content);
  return { sceneId, content: preLoadContent, loadedLabel: draft.label };
}

/** Put the pre-load text back, byte-identical. */
export function undoLoadDraft(
  deps: Pick<DraftLoadDeps, 'applyContent'>,
  undoState: DraftUndoState,
): void {
  deps.applyContent(undoState.content);
}
