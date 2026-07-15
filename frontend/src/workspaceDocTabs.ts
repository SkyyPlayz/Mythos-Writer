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
  | { kind: 'docs'; strip: 'story' | 'notes' }
  | { kind: 'static'; label: string }
  | { kind: 'hidden' };

export function workspaceStripModeFor(
  activeTab: AppTab,
  storySubView: StorySubView,
  notesSubView: NotesSubView,
): WorkspaceStripMode {
  if (activeTab === 'brainstorm') return { kind: 'hidden' };
  if (activeTab === 'story') {
    if (storySubView === 'timeline') return { kind: 'hidden' };
    if (storySubView === 'kanban') return { kind: 'static', label: 'Scene Crafter' };
    return { kind: 'docs', strip: 'story' };
  }
  if (notesSubView === 'graph') return { kind: 'hidden' };
  if (notesSubView === 'entities') return { kind: 'static', label: 'Entities' };
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
