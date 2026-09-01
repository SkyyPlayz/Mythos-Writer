// Beta 4 M4 (FULL-SPEC §4, §1.5): workspace tabs are DOCUMENTS (scenes/notes),
// not module mirrors. Pure helpers — DesktopShell applies the returned state.
//
// Prototype references ("Mythos Writer - Liquid Neon.dc.html"):
//   ~490–533  tab strip markup (status dot + label + × + provisional "+")
//   ~4788     addProvScene (provisional scene, §1.5)
//   ~5350     tabDown zoneOf (drag DOWN = lower 45%, RIGHT = right 44%)
//   ~5613     componentDidUpdate provisional discard ("Empty scene discarded…")
//   ~5713     tabList / showTabStrip (per-view strips, static pseudo-tab)

import type { DraftState, Scene, Story } from './types';

export type SceneTabStatus = 'todo' | 'draft' | 'done';

/** §1.5/§1.6 toast copy — verbatim from the prototype. */
export const PROVISIONAL_CREATED_TOAST =
  'New scene — it saves the moment you type. Close it untouched and it vanishes.';
export const PROVISIONAL_DISCARDED_TOAST = 'Empty scene discarded — nothing was saved';

const defaultMakeId = () => crypto.randomUUID();

/** Scene status → tab/tree dot: todo | draft | done (§2 scene status). */
export function sceneStatusFromDraftState(draftState?: DraftState): SceneTabStatus {
  if (draftState === 'final') return 'done';
  if (draftState === 'in-progress' || draftState === 'review') return 'draft';
  return 'todo';
}

export function makeSceneTab(
  scene: Scene,
  makeId: () => string = defaultMakeId,
  provisional = false,
): WorkspaceTab {
  return {
    id: makeId(),
    kind: 'scene',
    title: scene.title,
    icon: '📄',
    docId: scene.id,
    storyId: scene.storyId,
    status: sceneStatusFromDraftState(scene.draftState),
    ...(provisional ? { provisional: true } : {}),
  };
}

/** "Notes Vault/Characters/Mira Veynn.md" → "Mira Veynn". */
export function noteTitleFromPath(notePath: string): string {
  const base = notePath.split(/[\\/]/).filter(Boolean).pop() ?? notePath;
  return base.replace(/\.md$/i, '');
}

export function makeNoteTab(notePath: string, makeId: () => string = defaultMakeId): WorkspaceTab {
  return { id: makeId(), kind: 'note', title: noteTitleFromPath(notePath), icon: '📝', docPath: notePath };
}

/** SKY-9920 (M5 item 5): Entity Browser as an openable document tab — no
 * docId/docPath, so identity is the tab kind itself (one per strip). */
export function makeEntityBrowserTab(makeId: () => string = defaultMakeId): WorkspaceTab {
  return { id: makeId(), kind: 'entities', title: 'Entity Browser', icon: '🗂️' };
}

/** SKY-10019: Outline Planning as an openable Story-strip document tab —
 * M6 removed its only mount point (the collapsible right-sidebar panel
 * stack); this mirrors makeEntityBrowserTab's "one per strip" identity. */
export function makeOutlineTab(makeId: () => string = defaultMakeId): WorkspaceTab {
  return { id: makeId(), kind: 'outline', title: 'Outline Planning', icon: '🗒️' };
}

export interface UpsertDocTabResult {
  tabs: WorkspaceTab[];
  activeId: string;
  /** True when a new tab was appended (vs focusing an existing one). */
  created: boolean;
}

/**
 * Focus the existing tab for this scene (refreshing its title/status), or
 * append a new one — opening a document never duplicates its tab.
 */
export function upsertSceneTab(
  tabs: WorkspaceTab[],
  scene: Scene,
  makeId: () => string = defaultMakeId,
): UpsertDocTabResult {
  const existing = tabs.find((t) => t.kind === 'scene' && t.docId === scene.id);
  if (existing) {
    const title = scene.title;
    const status = sceneStatusFromDraftState(scene.draftState);
    const stale = existing.title !== title || existing.status !== status;
    return {
      tabs: stale ? tabs.map((t) => (t === existing ? { ...t, title, status } : t)) : tabs,
      activeId: existing.id,
      created: false,
    };
  }
  const tab = makeSceneTab(scene, makeId);
  return { tabs: [...tabs, tab], activeId: tab.id, created: true };
}

/** Focus the existing tab for this note path, or append a new one. */
export function upsertNoteTab(
  tabs: WorkspaceTab[],
  notePath: string,
  makeId: () => string = defaultMakeId,
): UpsertDocTabResult {
  const existing = tabs.find((t) => t.kind === 'note' && t.docPath === notePath);
  if (existing) return { tabs, activeId: existing.id, created: false };
  const tab = makeNoteTab(notePath, makeId);
  return { tabs: [...tabs, tab], activeId: tab.id, created: true };
}

/**
 * Focus the existing Entity Browser tab in this strip, or append a new one —
 * §M5 item 5: opening it never duplicates the tab (only one per strip).
 */
export function upsertEntityBrowserTab(
  tabs: WorkspaceTab[],
  makeId: () => string = defaultMakeId,
): UpsertDocTabResult {
  const existing = tabs.find((t) => t.kind === 'entities');
  if (existing) return { tabs, activeId: existing.id, created: false };
  const tab = makeEntityBrowserTab(makeId);
  return { tabs: [...tabs, tab], activeId: tab.id, created: true };
}

/** SKY-11069: identity of a Scene Crafter canvas board for tab purposes —
 * the id is the board's vault file path (stable across restarts). */
export interface BoardTabRef {
  id: string;
  name: string;
  storyId: string;
}

/** SKY-11069: the synthetic pinned Setup tab shown first in the Scene Crafter
 * strip. Never persisted — composed at render time; active board id null
 * means this tab is active. */
export const SCENE_CRAFTER_SETUP_TAB_ID = 'scene-crafter-setup';

export function makeSceneCrafterSetupTab(): WorkspaceTab {
  return {
    id: SCENE_CRAFTER_SETUP_TAB_ID,
    kind: 'kanban',
    title: 'Scene Crafter',
    icon: '🗂️',
    permanent: true,
  };
}

export function makeBoardTab(board: BoardTabRef, makeId: () => string = defaultMakeId): WorkspaceTab {
  return {
    id: makeId(),
    kind: 'board',
    title: board.name,
    icon: '🗺️',
    docId: board.id,
    storyId: board.storyId,
  };
}

/**
 * SKY-11069: focus the existing tab for this board (refreshing a stale title,
 * boards are renamed on disk), or append a new one — the owner ruling's
 * "same board twice = focus existing".
 */
export function upsertBoardTab(
  tabs: WorkspaceTab[],
  board: BoardTabRef,
  makeId: () => string = defaultMakeId,
): UpsertDocTabResult {
  const existing = tabs.find((t) => t.kind === 'board' && t.docId === board.id);
  if (existing) {
    const stale = existing.title !== board.name;
    return {
      tabs: stale ? tabs.map((t) => (t === existing ? { ...t, title: board.name } : t)) : tabs,
      activeId: existing.id,
      created: false,
    };
  }
  const tab = makeBoardTab(board, makeId);
  return { tabs: [...tabs, tab], activeId: tab.id, created: true };
}

/**
 * SKY-11069: reconcile one story's board tabs against the boards actually on
 * disk (mirrors reconcileSceneTabs): drop tabs whose board file is gone,
 * refresh renamed titles. Other stories' tabs are never touched.
 */
export function reconcileBoardTabs(
  tabs: WorkspaceTab[],
  storyId: string,
  boards: { id: string; name: string }[],
): { tabs: WorkspaceTab[]; changed: boolean } {
  const byId = new Map(boards.map((b) => [b.id, b]));
  let changed = false;
  const next: WorkspaceTab[] = [];
  for (const tab of tabs) {
    if (tab.kind !== 'board' || tab.storyId !== storyId) {
      next.push(tab);
      continue;
    }
    const board = tab.docId ? byId.get(tab.docId) : undefined;
    if (!board) {
      changed = true;
      continue;
    }
    if (board.name !== tab.title) {
      changed = true;
      next.push({ ...tab, title: board.name });
    } else {
      next.push(tab);
    }
  }
  return { tabs: changed ? next : tabs, changed };
}

/**
 * Focus the existing Outline Planning tab in this strip, or append a new
 * one — SKY-10019, same "one per strip" rule as upsertEntityBrowserTab.
 */
export function upsertOutlineTab(
  tabs: WorkspaceTab[],
  makeId: () => string = defaultMakeId,
): UpsertDocTabResult {
  const existing = tabs.find((t) => t.kind === 'outline');
  if (existing) return { tabs, activeId: existing.id, created: false };
  const tab = makeOutlineTab(makeId);
  return { tabs: [...tabs, tab], activeId: tab.id, created: true };
}

/**
 * Reconcile scene tabs against the loaded stories: refresh titles/status and
 * drop tabs whose scene no longer exists (deleted/moved vaults). Provisional
 * tabs are never touched — their scene lives only in editor state (§1.5).
 */
export function reconcileSceneTabs(
  tabs: WorkspaceTab[],
  stories: Story[],
): { tabs: WorkspaceTab[]; changed: boolean } {
  const scenesById = new Map<string, Scene>();
  for (const story of stories) {
    for (const chapter of story.chapters) {
      for (const scene of chapter.scenes) scenesById.set(scene.id, scene);
    }
  }
  let changed = false;
  const next: WorkspaceTab[] = [];
  for (const tab of tabs) {
    if (tab.kind !== 'scene' || tab.provisional) {
      next.push(tab);
      continue;
    }
    const scene = tab.docId ? scenesById.get(tab.docId) : undefined;
    if (!scene) {
      changed = true;
      continue;
    }
    const title = scene.title;
    const status = sceneStatusFromDraftState(scene.draftState);
    if (title !== tab.title || status !== tab.status) {
      changed = true;
      next.push({ ...tab, title, status });
    } else {
      next.push(tab);
    }
  }
  return { tabs: changed ? next : tabs, changed };
}

/**
 * §4: which strip (if any) shows for the current shell route. The strip is a
 * document strip on Story (editor/structure/book) and Notes (editor) views,
 * a static view pseudo-tab on Scene Crafter/Entities (prototype tabList
 * fallback), and hidden on Brainstorm/Timeline/Graph (+ Settings/Beta, which
 * are overlays here) — prototype showTabStrip, line ~7404.
 */
export type WorkspaceStripMode =
  | { kind: 'docs'; strip: 'story' | 'notes' | 'board' }
  | { kind: 'static'; label: string }
  | { kind: 'hidden' };

// SKY-9019 M5: vault-graph is a standalone AppTab (hidden strip); notes is always
// 'editor' subview now (graph→vault-graph rail, entities→tab strip).
export function workspaceStripModeFor(
  activeTab: AppTab,
  storySubView: StorySubView,
  _notesSubView: NotesSubView,
): WorkspaceStripMode {
  if (activeTab === 'brainstorm' || activeTab === 'vault-graph') return { kind: 'hidden' };
  if (activeTab === 'story') {
    if (storySubView === 'timeline') return { kind: 'hidden' };
    // SKY-11069 owner ruling: Scene Crafter is a docs strip — pinned Setup
    // tab + one tab per open canvas board.
    if (storySubView === 'kanban') return { kind: 'docs', strip: 'board' };
    return { kind: 'docs', strip: 'story' };
  }
  return { kind: 'docs', strip: 'notes' };
}

/** The placeholder title a provisional scene is born with (prototype addProvScene). */
export const PROVISIONAL_SCENE_TITLE = 'Untitled Scene';

/**
 * M8 (§1.5): does renaming a provisional scene commit (persist) it?
 * Prototype editTitle ~5142: only a real title does — an empty rename or the
 * default placeholder leaves the scene provisional.
 */
export function renameCommitsProvisional(title: string): boolean {
  const t = title.trim();
  return t.length > 0 && t !== PROVISIONAL_SCENE_TITLE;
}

/**
 * §1.5 discard rule: a provisional scene is "navigated away from" (→ silently
 * discarded with a toast) when the shell leaves the Story editor at scene
 * depth or shows a different document (prototype componentDidUpdate ~5613).
 */
export function provisionalSceneIsAway(args: {
  activeTab: AppTab;
  storySubView: StorySubView;
  viewDepth: string;
  selectedSceneId: string | null;
  provisionalSceneId: string;
}): boolean {
  return (
    args.activeTab !== 'story' ||
    args.storySubView !== 'editor' ||
    args.viewDepth !== 'scene' ||
    args.selectedSceneId !== args.provisionalSceneId
  );
}
