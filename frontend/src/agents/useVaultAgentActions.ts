// Beta 3 M22 — live wiring for the VaultBrowser context-menu agent actions.
//
// M15 shipped the notes-tree "Beta read" / "Continuity check" items disabled
// (VaultBrowser onBetaRead/onContinuityCheck undefined), waiting for this
// milestone. This hook gives DesktopShell the two handlers:
//
//  - Beta read: reads the note, runs the Beta Reader agent's betaRead:scan
//    (persona-driven since M22) keyed `note:<path>`, and reports the reaction
//    count through the notification bell.
//  - Continuity check: reads the note, runs the Archive agent's
//    archive:scan-continuity keyed `note:<path>` (prototype: "Archive Agent
//    checking ‘X’ ↔ story"), then counts open flags for that key. Flags
//    persist in SQLite under the same key — M23 converts them into comments.
//
// Activity windows are tracked via beginAgentActivity so the workspace tab
// strip's agents chip lights while either action runs.

import { useCallback, useRef } from 'react';
import { pushNotification } from '../notificationStore';
import { beginAgentActivity } from './agentActivity';
import { resolveAgentDisplayName, type NamedAgentId } from './agentIdentity';

/** Stable key under which note-scoped agent results are stored (M23 contract). */
export function noteAgentScanKey(notePath: string): string {
  return `note:${notePath}`;
}

function noteTitleFromPath(notePath: string): string {
  const base = notePath.split('/').pop() ?? notePath;
  return base.replace(/\.md$/i, '');
}

interface VaultAgentActionsOptions {
  agentNames?: Partial<Record<NamedAgentId, string>>;
  /** Beta 4 M2 (§4): bell rows deep-link to their source — navigates to the
   *  scanned note. Kept in a ref so the latest navigation handlers win. */
  onOpenNote?: (path: string) => void;
  /** Beta 4 M2: deep-link for continuity results — opens the Continuity panel. */
  onOpenContinuity?: () => void;
}

export interface VaultAgentActions {
  /** "Beta read" context-menu item — Beta Reader reads the note. */
  betaReadNote: (path: string) => void;
  /** "Continuity check" context-menu item — Archive checks note ↔ story. */
  continuityCheckNote: (path: string) => void;
}

async function readNoteContent(path: string): Promise<string> {
  const res = await window.api.readNotesVault(path);
  if ('error' in res) throw new Error(res.error);
  return res.content ?? '';
}

export function useVaultAgentActions({ agentNames, onOpenNote, onOpenContinuity }: VaultAgentActionsOptions = {}): VaultAgentActions {
  // Latest-wins refs: notifications fire long after render, so their
  // deep-links must use the freshest navigation handlers.
  const onOpenNoteRef = useRef(onOpenNote);
  onOpenNoteRef.current = onOpenNote;
  const onOpenContinuityRef = useRef(onOpenContinuity);
  onOpenContinuityRef.current = onOpenContinuity;

  const betaReadNote = useCallback((path: string) => {
    const agentLabel = resolveAgentDisplayName('betaReader', agentNames);
    const title = noteTitleFromPath(path);
    // Beta 4 M2: every row deep-links to its source note (§4).
    const openNote = () => onOpenNoteRef.current?.(path);
    const release = beginAgentActivity();
    void (async () => {
      try {
        const content = await readNoteContent(path);
        if (!content.trim()) {
          pushNotification({
            kind: 'beta',
            title: `${agentLabel} skipped “${title}”`,
            detail: 'The note is empty — nothing to read.',
            onOpen: openNote,
          });
          return;
        }
        const result = await window.api.betaReadScan(noteAgentScanKey(path), content, path);
        if ('error' in result) throw new Error(result.error);
        const n = result.comments.length;
        pushNotification({
          kind: 'beta',
          title: `${agentLabel} read “${title}”`,
          detail: n > 0
            ? `${n} reaction${n === 1 ? '' : 's'} recorded.`
            : 'No reactions this pass.',
          onOpen: openNote,
        });
      } catch (err) {
        pushNotification({
          kind: 'beta',
          title: `${agentLabel} couldn’t read “${title}”`,
          detail: err instanceof Error ? err.message : 'Unknown error.',
          onOpen: openNote,
        });
      } finally {
        release();
      }
    })();
  }, [agentNames]);

  const continuityCheckNote = useCallback((path: string) => {
    const agentLabel = resolveAgentDisplayName('archive', agentNames);
    const title = noteTitleFromPath(path);
    const openNote = () => onOpenNoteRef.current?.(path);
    const release = beginAgentActivity();
    void (async () => {
      try {
        const content = await readNoteContent(path);
        if (!content.trim()) {
          pushNotification({
            kind: 'archive',
            title: `${agentLabel} skipped “${title}”`,
            detail: 'The note is empty — nothing to check.',
            onOpen: openNote,
          });
          return;
        }
        await window.api.archiveScanContinuity(noteAgentScanKey(path), content);
        const { items } = await window.api.archiveListContinuity({
          sceneId: noteAgentScanKey(path),
          filter: { status: 'open' },
        });
        const n = items.length;
        pushNotification({
          kind: 'archive',
          title: `${agentLabel} checked “${title}” ↔ story`,
          detail: n > 0
            ? `${n} open flag${n === 1 ? '' : 's'} — review in the Continuity panel.`
            : 'No continuity flags found.',
          // Open flags → the Continuity panel is the source; else the note.
          onOpen: n > 0 && onOpenContinuityRef.current
            ? () => onOpenContinuityRef.current?.()
            : openNote,
        });
      } catch (err) {
        pushNotification({
          kind: 'archive',
          title: `${agentLabel} couldn’t check “${title}”`,
          detail: err instanceof Error ? err.message : 'Unknown error.',
          onOpen: openNote,
        });
      } finally {
        release();
      }
    })();
  }, [agentNames]);

  return { betaReadNote, continuityCheckNote };
}
