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

import { useCallback } from 'react';
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

export function useVaultAgentActions({ agentNames }: VaultAgentActionsOptions = {}): VaultAgentActions {
  const betaReadNote = useCallback((path: string) => {
    const agentLabel = resolveAgentDisplayName('betaReader', agentNames);
    const title = noteTitleFromPath(path);
    const release = beginAgentActivity();
    void (async () => {
      try {
        const content = await readNoteContent(path);
        if (!content.trim()) {
          pushNotification({
            kind: 'beta',
            title: `${agentLabel} skipped “${title}”`,
            detail: 'The note is empty — nothing to read.',
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
        });
      } catch (err) {
        pushNotification({
          kind: 'beta',
          title: `${agentLabel} couldn’t read “${title}”`,
          detail: err instanceof Error ? err.message : 'Unknown error.',
        });
      } finally {
        release();
      }
    })();
  }, [agentNames]);

  const continuityCheckNote = useCallback((path: string) => {
    const agentLabel = resolveAgentDisplayName('archive', agentNames);
    const title = noteTitleFromPath(path);
    const release = beginAgentActivity();
    void (async () => {
      try {
        const content = await readNoteContent(path);
        if (!content.trim()) {
          pushNotification({
            kind: 'archive',
            title: `${agentLabel} skipped “${title}”`,
            detail: 'The note is empty — nothing to check.',
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
        });
      } catch (err) {
        pushNotification({
          kind: 'archive',
          title: `${agentLabel} couldn’t check “${title}”`,
          detail: err instanceof Error ? err.message : 'Unknown error.',
        });
      } finally {
        release();
      }
    })();
  }, [agentNames]);

  return { betaReadNote, continuityCheckNote };
}
