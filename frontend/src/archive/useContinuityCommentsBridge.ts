// Beta 3 M23 — the live flags→comments bridge hook (mounted in DesktopShell).
//
// Three wires, all guarded so environments without the IPC surface (unit
// tests, storybook) are no-ops:
//
//   1. On story open: load persisted flags (archive:list-continuity, ALL
//      statuses) and reconcile them into the comments gutter — open flags
//      surface as kind:'archive' comments, resolved/ignored flags clear any
//      stale card. Waits for `<story>/comments.json` to load first so the
//      suggestionId dedupe sees persisted comments.
//   2. On archive:cont-scan-result: reconcile the scene's current open set
//      (the M23 scan event carries persisted + fresh open items) so new flags
//      appear in the gutter live, mid-session.
//   3. On archive:cont-item-resolved: drop the card for a flag resolved
//      anywhere (Continuity panel or the card's own agent actions).
//
// Comments are labeled with the Archive agent's display name so M22 renames
// propagate (resolveAgentDisplayName).

import { useEffect, useRef } from 'react';
import { commentsStore } from '../comments';
import { resolveAgentDisplayName, type NamedAgentId } from '../agents/agentIdentity';
import type { Story } from '../types';
import {
  removeCommentForResolvedFlag,
  syncContinuityFlagsToComments,
} from './continuityComments';

export function useContinuityCommentsBridge(
  story: Story | null | undefined,
  agentNames?: Partial<Record<NamedAgentId, string>>,
): void {
  const storyId = story?.id ?? null;
  const storyPath = story?.path ?? null;

  // The reconcilers need the latest story shape (scene ids) without
  // re-subscribing on every manuscript edit — keep it in a ref.
  const storyRef = useRef<Story | null>(story ?? null);
  storyRef.current = story ?? null;
  const agentNamesRef = useRef(agentNames);
  agentNamesRef.current = agentNames;

  useEffect(() => {
    if (!storyId || !storyPath) return;
    const api = window.api;
    if (typeof api?.archiveListContinuity !== 'function') return;

    let cancelled = false;
    const label = () => resolveAgentDisplayName('archive', agentNamesRef.current);

    // 1. Initial reconcile of persisted flags (after comments.json merges in).
    void (async () => {
      try {
        await commentsStore.open(storyId, storyPath);
        const res = await api.archiveListContinuity({});
        if (cancelled) return;
        const current = storyRef.current;
        if (!current || current.id !== storyId) return;
        syncContinuityFlagsToComments(current, res.items ?? [], label());
      } catch {
        // Archive store unavailable — the Continuity panel stays authoritative.
      }
    })();

    // 2. Live scan results → new gutter comments.
    const unsubResult =
      typeof api.onArchiveContScanResult === 'function'
        ? api.onArchiveContScanResult((data) => {
            const current = storyRef.current;
            if (!current || current.id !== storyId) return;
            syncContinuityFlagsToComments(current, data.items ?? [], label());
          })
        : undefined;

    // 3. Flag resolved anywhere → drop its card.
    const unsubResolved = api.onArchiveContItemResolved?.((data) => {
      removeCommentForResolvedFlag(storyId, data.itemId);
    });

    return () => {
      cancelled = true;
      unsubResult?.();
      unsubResolved?.();
    };
  }, [storyId, storyPath]);
}
