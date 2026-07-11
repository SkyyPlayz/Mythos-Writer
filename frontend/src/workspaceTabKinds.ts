// GH #643: workspace-tab kind metadata + pure create-or-focus semantics.
// Beta 4 M4: the strip now shows DOCUMENT tabs (see workspaceDocTabs.ts);
// the module-kind helpers below remain for the legacy right-hand
// WorkspaceSplitPane restore path and old persisted layouts.

export const TAB_KIND_META: Record<WorkspaceTabKind, { title: string; icon: string }> = {
  'story-editor': { title: 'Story', icon: '📖' },
  'notes-editor': { title: 'Notes', icon: '📁' },
  kanban: { title: 'Scene Crafter', icon: '🗂️' },
  timeline: { title: 'Timeline', icon: '📅' },
  entities: { title: 'Entities', icon: '👤' },
  'vault-graph': { title: 'Graph', icon: '🕸️' },
  brainstorm: { title: 'Brainstorm', icon: '💡' },
  // Beta 4 M4: document tab kinds (per-document titles are set on the tab itself).
  scene: { title: 'Scene', icon: '📄' },
  note: { title: 'Note', icon: '📝' },
};

/** ≤Beta 3: every module kind the old new-tab picker offered, in display
 * order. Kept for the legacy split-pane metadata sweep in tests. */
export const PICKABLE_TAB_KINDS: WorkspaceTabKind[] = [
  'story-editor',
  'notes-editor',
  'brainstorm',
  'kanban',
  'timeline',
  'entities',
  'vault-graph',
];

/** The workspace-tab kind that represents a top-level nav section. */
export function tabKindForSection(section: AppTab): WorkspaceTabKind {
  if (section === 'notes') return 'notes-editor';
  if (section === 'brainstorm') return 'brainstorm';
  return 'story-editor';
}

/**
 * GH#643 split panes v1: kinds whose surfaces are self-contained enough to
 * render in the right-hand split pane. Story/Notes editors keep their existing
 * dedicated split mechanisms (SplitEditorPane) for now.
 */
export const SPLITTABLE_TAB_KINDS: ReadonlySet<WorkspaceTabKind> = new Set([
  'kanban',
  'timeline',
  'entities',
  'vault-graph',
  'brainstorm',
]);

export interface CreateOrFocusResult {
  tabs: WorkspaceTab[];
  activeId: string;
  /** True when a new tab was appended (vs focusing an existing one). */
  created: boolean;
}

/**
 * Focus the existing tab of `kind`, or append a new one built from
 * TAB_KIND_META. Pure — the caller applies the returned state and persists.
 */
export function createOrFocusTab(
  tabs: WorkspaceTab[],
  kind: WorkspaceTabKind,
  makeId: () => string = () => crypto.randomUUID(),
): CreateOrFocusResult {
  const existing = tabs.find((t) => t.kind === kind);
  if (existing) {
    return { tabs, activeId: existing.id, created: false };
  }
  const meta = TAB_KIND_META[kind];
  const tab: WorkspaceTab = { id: makeId(), kind, title: meta.title, icon: meta.icon };
  return { tabs: [...tabs, tab], activeId: tab.id, created: true };
}
