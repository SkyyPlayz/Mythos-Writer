// SKY-11154 — reusable "gate a notes-vault switch behind the broken-wikilink
// report" logic (parent spec SKY-11141: "Any change to the active notes
// vault — manual or via a paired switch — must run the broken-wikilink
// report... Never silent.").
//
// Extracted from frontend/src/components/NotesVaultPicker.tsx (SKY-11058),
// which had the only prior implementation of this preview-then-confirm flow,
// so both NotesVaultPicker (a manual switch) and the new Settings-page
// Notes/Story columns (SKY-11154, a manual switch OR a switch that rides
// along with a dot-pairing) share ONE implementation instead of two copies
// of the same dialog. Behavior-preserving — NotesVaultPicker's existing
// flow is unchanged by this extraction.
import { useCallback, useRef, useState } from 'react';

export interface LinkResolutionReport {
  resolvedCount: number;
  unresolvedStems: string[];
  totalStems: number;
}

export interface NotesVaultLinkGatePending {
  targetId: string;
  /** Display name of the vault being switched to — for the confirm dialog title. */
  targetDisplayName: string;
  report: LinkResolutionReport;
}

export interface UseNotesVaultLinkGateResult {
  /** Non-null while a confirm dialog should be shown. */
  pending: NotesVaultLinkGatePending | null;
  /** True while `confirm()`'s commit callback is in flight. */
  busy: boolean;
  /**
   * Run the SKY-11058 link-resolution preview for `targetId`. When the
   * story vault has no wikilinks at all (`totalStems === 0`), `onCommit`
   * runs immediately with no dialog — matching NotesVaultPicker's existing
   * behavior. Otherwise `pending` is populated so the caller can render a
   * confirm dialog; `onCommit` only runs if the caller then calls `confirm()`.
   */
  requestGatedSwitch: (
    targetId: string,
    targetDisplayName: string,
    onCommit: (targetId: string) => Promise<void> | void,
  ) => Promise<void>;
  /** Runs the pending switch's commit callback, then clears `pending`. */
  confirm: () => Promise<void>;
  /** Discards the pending switch without running its commit callback. */
  cancel: () => void;
}

export function useNotesVaultLinkGate(): UseNotesVaultLinkGateResult {
  const [pending, setPending] = useState<NotesVaultLinkGatePending | null>(null);
  const [busy, setBusy] = useState(false);
  const commitRef = useRef<((targetId: string) => Promise<void> | void) | null>(null);

  const requestGatedSwitch = useCallback(async (
    targetId: string,
    targetDisplayName: string,
    onCommit: (targetId: string) => Promise<void> | void,
  ): Promise<void> => {
    const report = await window.api?.notesVaultRegistrySetActivePreview?.(targetId);
    if (!report) return;

    if (report.totalStems === 0) {
      // No links in the active story to break — switch immediately, no dialog.
      await onCommit(targetId);
      return;
    }

    commitRef.current = onCommit;
    setPending({ targetId, targetDisplayName, report });
  }, []);

  const confirm = useCallback(async () => {
    if (!pending) return;
    const commit = commitRef.current;
    setBusy(true);
    try {
      await commit?.(pending.targetId);
    } finally {
      setBusy(false);
      setPending(null);
      commitRef.current = null;
    }
  }, [pending]);

  const cancel = useCallback(() => {
    setPending(null);
    commitRef.current = null;
  }, []);

  return { pending, busy, requestGatedSwitch, confirm, cancel };
}
