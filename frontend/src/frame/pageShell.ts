/** Owns the widget-shell page defaults: which panels open inside each page window, what the global sidebars hold, and the beta flag read. Pure; imports only the panel registry and scope model. */

import { designPanel, panelBelongsToPage, type DesignPanelId } from './panelRegistry';
import { isGlobalScope, PAGE_VIEWS, type PageView } from './scopeModel';

/** Beta flag (read-only in W1). W1 never writes it; saving the layout and a Settings toggle arrive with W3. */
export const WIDGET_SHELL_FLAG_KEY = 'widgetShell';

/** True only when the loaded settings hold the beta flag set to `true`. Flag off = the old shell, unchanged. */
export function isWidgetShellOn(settings: unknown): boolean {
  if (typeof settings !== 'object' || settings === null) return false;
  return (settings as Record<string, unknown>)[WIDGET_SHELL_FLAG_KEY] === true;
}

export interface PageChromeDefaults {
  /** In-page left nav, or null for none. */
  left: DesignPanelId | null;
  /** In-page right inspector, or null for none. */
  right: DesignPanelId | null;
}

const PAGE_CHROME_DEFAULTS: Readonly<Record<PageView, PageChromeDefaults>> = {
  editor: { left: 'navEditor', right: 'edPanel' },
  book: { left: 'navEditor', right: null },
  structure: { left: 'navEditor', right: 'beats' },
  notes: { left: 'navNotes', right: 'noteProps' },
  boards: { left: 'navBoards', right: 'boardInsp' },
  // Scene Crafter has no reader or scene-tools inspector yet, so its right side stays empty.
  crafter: { left: 'navCrafter', right: null },
  brainstorm: { left: 'navBrainstorm', right: 'bsPanel' },
  beta: { left: 'navBeta', right: 'betaPanel' },
  timeline: { left: 'navTimeline', right: 'tlDetails' },
  graph: { left: 'navGraph', right: 'graphDetails' },
  artifacts: { left: 'navArtifacts', right: 'artBuilder' },
  settings: { left: null, right: null },
};

/** A fresh copy of the in-page defaults for one page. */
export function pageChromeDefaults(view: PageView): PageChromeDefaults {
  const defaults = PAGE_CHROME_DEFAULTS[view];
  return { left: defaults.left, right: defaults.right };
}

/** Story Editor inspector (`edPanel`) page tabs. Findings and Suggestions are global panels, never page tabs. */
export const EDITOR_INSPECTOR_TABS = [
  { id: 'scenes', label: 'Scenes' },
  { id: 'notes-analysis', label: 'Notes & Analysis' },
] as const;

export type EditorInspectorTabId = (typeof EDITOR_INSPECTOR_TABS)[number]['id'];

/** Brainstorm's page panel (`bsPanel`) faces. The partner chat face is global-only. */
export const BRAINSTORM_PAGE_FACES = ['board'] as const;

export interface GlobalSidebarDefaults {
  left: DesignPanelId[];
  right: DesignPanelId[];
}

/** Global sidebars hold global panels only: left starts empty, right starts with the writing partner. */
export function defaultGlobalSidebars(): GlobalSidebarDefaults {
  return { left: [], right: ['agent'] };
}

export interface ShellLayoutDefaults {
  center: PageView;
  page: PageChromeDefaults;
  global: GlobalSidebarDefaults;
}

/** Fresh-profile layout: the Story Editor in the center with its own page panels, the partner in the right sidebar. */
export function defaultShellLayout(): ShellLayoutDefaults {
  return { center: 'editor', page: pageChromeDefaults('editor'), global: defaultGlobalSidebars() };
}

export interface ShellViewState {
  activeTab: string;
  storySubView: string;
  settingsOpen?: boolean;
  betaReaderOpen?: boolean;
}

const STORY_SUB_VIEW_PAGES: Readonly<Record<string, PageView>> = {
  editor: 'editor',
  book: 'book',
  structure: 'structure',
  kanban: 'crafter',
  timeline: 'timeline',
};

const TAB_PAGES: Readonly<Record<string, PageView>> = {
  notes: 'notes',
  boards: 'boards',
  brainstorm: 'brainstorm',
  'vault-graph': 'graph',
};

/** Maps today's tab / sub-view / overlay state to a design page, or null when the view has no page chrome (e.g. Coach). */
export function pageViewFor(state: ShellViewState): PageView | null {
  if (state.settingsOpen) return 'settings';
  if (state.betaReaderOpen) return 'beta';
  if (state.activeTab === 'story') return STORY_SUB_VIEW_PAGES[state.storySubView] ?? null;
  return TAB_PAGES[state.activeTab] ?? null;
}

export interface PageDefaultViolation {
  view: PageView;
  side: 'left' | 'right';
  id: DesignPanelId;
  problem: 'global-panel' | 'wrong-page';
}

/** Every default that breaks the scope rule: a global panel in page chrome, or another page's panel. Empty = clean. */
export function pageDefaultViolations(): PageDefaultViolation[] {
  const violations: PageDefaultViolation[] = [];
  for (const view of PAGE_VIEWS) {
    const defaults = PAGE_CHROME_DEFAULTS[view];
    for (const side of ['left', 'right'] as const) {
      const id = defaults[side];
      if (id === null) continue;
      if (isGlobalScope(designPanel(id).scope)) violations.push({ view, side, id, problem: 'global-panel' });
      else if (!panelBelongsToPage(id, view)) violations.push({ view, side, id, problem: 'wrong-page' });
    }
  }
  return violations;
}
