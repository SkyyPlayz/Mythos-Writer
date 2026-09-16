/**
 * vaultWorkspaceTabs.ts — SKY-11236
 *
 * Per-vault open-tab workspace state. The tab bar used to be GLOBAL while note
 * paths resolve against the ACTIVE vault, so every vault switch left behind
 * tabs that could not load ("Could not load note."). Tabs are now keyed by
 * Story-Vault root path (AppSettings.vaultWorkspaces) — switching vaults swaps
 * the whole set out and back.
 *
 * This module holds the PURE state logic (restore filtering, per-vault merge on
 * persist, one-time legacy migration) so it is unit-testable without the
 * 6k-line DesktopShell. WorkspaceTab / VaultWorkspaceTabs are ambient globals
 * (frontend/src/global.d.ts).
 */

/** The three per-section strips DesktopShell restores, already filtered + with
 *  validated active ids. Always fully populated (empty arrays, never absent) so
 *  a restore unconditionally CLEARS the outgoing vault's tabs — the leak fix. */
export interface RestoredVaultTabs {
  storyDocTabs: WorkspaceTab[];
  activeStoryDocTabId: string | null;
  notesDocTabs: WorkspaceTab[];
  activeNotesDocTabId: string | null;
  boardDocTabs: WorkspaceTab[];
  activeBoardDocTabId: string | null;
}

/** The legacy flat shape held under activeLayout before SKY-11236. */
export interface LegacyDocTabs {
  storyDocTabs?: WorkspaceTab[];
  activeStoryDocTabId?: string | null;
  notesDocTabs?: WorkspaceTab[];
  activeNotesDocTabId?: string | null;
  boardDocTabs?: WorkspaceTab[];
  activeBoardDocTabId?: string | null;
}

// Restore filters — identical to the pre-SKY-11236 inline filters so relaunch
// behavior is unchanged: provisional scenes never persist; only document +
// singleton kinds survive; a board tab needs both ids to render.
const keepStory = (t: WorkspaceTab): boolean =>
  (t.kind === 'scene' && !t.provisional) || t.kind === 'entities' || t.kind === 'outline';
const keepNotes = (t: WorkspaceTab): boolean => t.kind === 'note' || t.kind === 'entities';
const keepBoard = (t: WorkspaceTab): boolean => t.kind === 'board' && !!t.docId && !!t.storyId;

/** An active id is only honored if it still points at a surviving tab. */
function pickActive(tabs: WorkspaceTab[], id: string | null | undefined): string | null {
  return id != null && tabs.some((t) => t.id === id) ? id : null;
}

/**
 * Restore a vault's tab set for display. `undefined` (a vault never opened, or
 * opened before this feature) yields empty strips — NOT another vault's tabs.
 */
export function restoreVaultTabs(ws: VaultWorkspaceTabs | undefined): RestoredVaultTabs {
  const storyDocTabs = (ws?.storyDocTabs ?? []).filter(keepStory);
  const notesDocTabs = (ws?.notesDocTabs ?? []).filter(keepNotes);
  const boardDocTabs = (ws?.boardDocTabs ?? []).filter(keepBoard);
  return {
    storyDocTabs,
    activeStoryDocTabId: pickActive(storyDocTabs, ws?.activeStoryDocTabId),
    notesDocTabs,
    activeNotesDocTabId: pickActive(notesDocTabs, ws?.activeNotesDocTabId),
    boardDocTabs,
    activeBoardDocTabId: pickActive(boardDocTabs, ws?.activeBoardDocTabId),
  };
}

/** A single section's persist patch, mirroring DesktopShell.persistDocTabs. */
export interface DocTabsPatch {
  story?: { tabs: WorkspaceTab[]; activeId: string | null };
  notes?: { tabs: WorkspaceTab[]; activeId: string | null };
  board?: { tabs: WorkspaceTab[]; activeId: string | null };
}

/**
 * Merge a persist patch into the vault-keyed workspace map, returning a NEW map
 * (never mutates). Only the patched sections change; the target vault's other
 * sections and every other vault are preserved untouched — this is what keeps
 * vault A's tabs intact while the user works in vault B. Provisional scene tabs
 * never persist (§1.5).
 */
export function writeVaultWorkspace(
  prev: Record<string, VaultWorkspaceTabs> | undefined,
  vaultRoot: string,
  patch: DocTabsPatch,
): Record<string, VaultWorkspaceTabs> {
  const prevWs = prev?.[vaultRoot] ?? {};
  const nextWs: VaultWorkspaceTabs = {
    ...prevWs,
    ...(patch.story
      ? { storyDocTabs: patch.story.tabs.filter((t) => !t.provisional), activeStoryDocTabId: patch.story.activeId }
      : {}),
    ...(patch.notes ? { notesDocTabs: patch.notes.tabs, activeNotesDocTabId: patch.notes.activeId } : {}),
    ...(patch.board ? { boardDocTabs: patch.board.tabs, activeBoardDocTabId: patch.board.activeId } : {}),
  };
  return { ...prev, [vaultRoot]: nextWs };
}

/**
 * Snapshot the legacy flat activeLayout doc-tabs as a single vault's workspace.
 * Used once, at the first load after upgrade, to adopt the previous session's
 * global tabs for whatever vault was active then — so they survive switching
 * away and back instead of being stranded in the dead legacy fields.
 */
export function migrateLegacyDocTabs(legacy: LegacyDocTabs | undefined): VaultWorkspaceTabs {
  return {
    storyDocTabs: legacy?.storyDocTabs,
    activeStoryDocTabId: legacy?.activeStoryDocTabId ?? null,
    notesDocTabs: legacy?.notesDocTabs,
    activeNotesDocTabId: legacy?.activeNotesDocTabId ?? null,
    boardDocTabs: legacy?.boardDocTabs,
    activeBoardDocTabId: legacy?.activeBoardDocTabId ?? null,
  };
}

/**
 * Decide whether the one-time legacy adoption should run for this load.
 *
 * ONLY on the very first load after upgrade (no vaultWorkspaces on disk yet)
 * AND only when this is the initial boot, never a vault switch. Gating on
 * "not a switch" is the crux of the leak fix: switching to a vault that has no
 * saved workspace must yield EMPTY tabs, never the legacy global set (which
 * belongs to whatever vault was active at the previous shutdown).
 */
export function shouldMigrateLegacy(
  vaultWorkspaces: Record<string, VaultWorkspaceTabs> | undefined,
  isVaultSwitch: boolean,
  vaultRoot: string,
): boolean {
  return !vaultWorkspaces && !isVaultSwitch && !!vaultRoot;
}
