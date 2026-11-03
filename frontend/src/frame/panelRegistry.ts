/** Owns the ordered sidebar panel id catalog (WidgetId), each panel's scope, and the design panel ids with their app-id aliases. Never reads settings, never renders, and never imports vault, TipTap, or agent code. */

import { GLOBAL_SCOPE, pageScope, type PageView, type PanelScope } from './scopeModel';

export const RIGHT_PANEL_IDS = [
  'writing-assistant',
  'archive-continuity',
  'scene-preview',
  'scene-notes',
  'scene-properties',
  'scenes',
  'references',
  'brainstorm',
] as const;

export const LEFT_PANEL_IDS = [
  'stories',
  'entities',
  'vault',
  'vault-graph',
  'review',
  'progress',
  'timeline',
] as const;

export type RightPanelId = (typeof RIGHT_PANEL_IDS)[number];
export type LeftPanelId = (typeof LEFT_PANEL_IDS)[number];

/** Generic widget id. Today this is every sidebar panel id. */
export type WidgetId = LeftPanelId | RightPanelId;

export interface PanelRegistryEntry {
  id: WidgetId;
  side: 'left' | 'right';
  scope: PanelScope;
}

/**
 * W1: the scope of every app panel id. `global` panels belong in the global
 * sidebars; `page:<view>` panels open inside that page's window.
 */
export const APP_PANEL_SCOPES: Readonly<Record<WidgetId, PanelScope>> = {
  'writing-assistant': GLOBAL_SCOPE,
  'archive-continuity': GLOBAL_SCOPE,
  'scene-preview': pageScope('editor'),
  'scene-notes': pageScope('editor'),
  'scene-properties': pageScope('editor'),
  scenes: pageScope('editor'),
  references: pageScope('editor'),
  brainstorm: pageScope('brainstorm'),
  stories: pageScope('editor'),
  entities: pageScope('notes'),
  vault: pageScope('notes'),
  'vault-graph': pageScope('graph'),
  review: GLOBAL_SCOPE,
  progress: GLOBAL_SCOPE,
  timeline: pageScope('timeline'),
};

/** Right-panel ids, then left-panel ids: the order those unions had in global.d.ts. */
export const PANEL_REGISTRY: readonly PanelRegistryEntry[] = [
  ...RIGHT_PANEL_IDS.map((id) => ({ id, side: 'right' as const, scope: APP_PANEL_SCOPES[id] })),
  ...LEFT_PANEL_IDS.map((id) => ({ id, side: 'left' as const, scope: APP_PANEL_SCOPES[id] })),
];

/**
 * Where a design panel sits by default: `sidebar` = a global sidebar,
 * `pageLeft` / `pageRight` = the page window's in-page nav / inspector.
 */
export type DesignPanelSlot = 'sidebar' | 'pageLeft' | 'pageRight';

export interface DesignPanelDef {
  id: string;
  label: string;
  scope: PanelScope;
  slot: DesignPanelSlot;
  /** Today's app panel id this design id bridges to, if one exists. */
  appAlias: WidgetId | null;
  /** Other story pages that share this page panel (e.g. the Story Navigator). */
  alsoOn?: readonly PageView[];
  /** True when the panel shows AI output or runs AI work (AI-mode rules apply). */
  ai: boolean;
  /** True when the app has a component that can mount this panel today. */
  hosted: boolean;
}

/** Design panel ids (PLAN-WIDGET-SYSTEM-v2). Globals first, then page panels in page order. */
export const DESIGN_PANELS = [
  { id: 'agent', label: 'Writing partner', scope: GLOBAL_SCOPE, slot: 'sidebar', appAlias: 'writing-assistant', ai: true, hosted: true },
  { id: 'findings', label: 'Findings', scope: GLOBAL_SCOPE, slot: 'sidebar', appAlias: 'archive-continuity', ai: true, hosted: true },
  { id: 'suggestions', label: 'Suggestions', scope: GLOBAL_SCOPE, slot: 'sidebar', appAlias: 'review', ai: true, hosted: true },
  { id: 'activity', label: 'AI activity', scope: GLOBAL_SCOPE, slot: 'sidebar', appAlias: null, ai: true, hosted: false },
  { id: 'inbox', label: 'Inbox', scope: GLOBAL_SCOPE, slot: 'sidebar', appAlias: null, ai: true, hosted: false },
  { id: 'navEditor', label: 'Story Navigator', scope: pageScope('editor'), slot: 'pageLeft', appAlias: 'stories', alsoOn: ['book', 'structure'], ai: false, hosted: true },
  { id: 'edPanel', label: 'Editor inspector', scope: pageScope('editor'), slot: 'pageRight', appAlias: null, ai: false, hosted: true },
  { id: 'beats', label: 'Beat sheet', scope: pageScope('structure'), slot: 'pageRight', appAlias: null, ai: false, hosted: true },
  { id: 'navNotes', label: 'Notes tree', scope: pageScope('notes'), slot: 'pageLeft', appAlias: 'vault', ai: false, hosted: true },
  { id: 'noteProps', label: 'Note properties', scope: pageScope('notes'), slot: 'pageRight', appAlias: null, ai: false, hosted: true },
  { id: 'navBoards', label: 'Board folders', scope: pageScope('boards'), slot: 'pageLeft', appAlias: null, ai: false, hosted: true },
  { id: 'boardInsp', label: 'Board inspector', scope: pageScope('boards'), slot: 'pageRight', appAlias: null, ai: false, hosted: false },
  { id: 'navCrafter', label: 'Suggested cards', scope: pageScope('crafter'), slot: 'pageLeft', appAlias: null, ai: false, hosted: true },
  { id: 'navBrainstorm', label: 'Idea collections', scope: pageScope('brainstorm'), slot: 'pageLeft', appAlias: null, ai: false, hosted: true },
  { id: 'bsPanel', label: 'Idea Board', scope: pageScope('brainstorm'), slot: 'pageRight', appAlias: 'brainstorm', ai: false, hosted: true },
  { id: 'navBeta', label: 'Beta reads', scope: pageScope('beta'), slot: 'pageLeft', appAlias: null, ai: false, hosted: true },
  { id: 'betaPanel', label: 'Beta reader', scope: pageScope('beta'), slot: 'pageRight', appAlias: null, ai: true, hosted: true },
  { id: 'navTimeline', label: 'Timelines', scope: pageScope('timeline'), slot: 'pageLeft', appAlias: 'timeline', ai: false, hosted: true },
  { id: 'tlDetails', label: 'Timeline details', scope: pageScope('timeline'), slot: 'pageRight', appAlias: null, ai: false, hosted: true },
  { id: 'navGraph', label: 'Graph filters', scope: pageScope('graph'), slot: 'pageLeft', appAlias: null, ai: false, hosted: true },
  { id: 'graphDetails', label: 'Node inspector', scope: pageScope('graph'), slot: 'pageRight', appAlias: null, ai: false, hosted: true },
  { id: 'navArtifacts', label: 'Artifacts', scope: pageScope('artifacts'), slot: 'pageLeft', appAlias: null, ai: false, hosted: false },
  { id: 'artBuilder', label: 'Artifact builder', scope: pageScope('artifacts'), slot: 'pageRight', appAlias: null, ai: false, hosted: false },
] as const satisfies readonly DesignPanelDef[];

export type DesignPanelId = (typeof DESIGN_PANELS)[number]['id'];

const DESIGN_PANEL_BY_ID: ReadonlyMap<string, DesignPanelDef> = new Map<string, DesignPanelDef>(
  DESIGN_PANELS.map((panel): [string, DesignPanelDef] => [panel.id, panel]),
);

export function isDesignPanelId(value: unknown): value is DesignPanelId {
  return typeof value === 'string' && DESIGN_PANEL_BY_ID.has(value);
}

export function designPanel(id: DesignPanelId): DesignPanelDef {
  const panel = DESIGN_PANEL_BY_ID.get(id);
  if (!panel) throw new Error(`Unknown design panel id: ${id}`);
  return panel;
}

/** App id → design id bridge (e.g. `stories` → `navEditor`, `writing-assistant` → `agent`). */
export function designIdForAppPanel(appId: WidgetId): DesignPanelId | null {
  const match = DESIGN_PANELS.find((panel) => panel.appAlias === appId);
  return match ? match.id : null;
}

/** True when a page-scoped design panel belongs on `view` (its own page or a page that shares it). */
export function panelBelongsToPage(id: DesignPanelId, view: PageView): boolean {
  const panel = designPanel(id);
  if (panel.scope === pageScope(view)) return true;
  return panel.alsoOn?.includes(view) ?? false;
}

/** Fresh copy of the v1→v2 default right-sidebar rows. */
export function defaultMigrateRightPanels(): { id: WidgetId; collapsed: boolean }[] {
  return [
    { id: 'writing-assistant', collapsed: false },
    { id: 'archive-continuity', collapsed: false },
    { id: 'scene-preview', collapsed: false },
  ];
}

/** Fresh copy of the v1→v2 default left-sidebar rows. */
export function defaultMigrateLeftPanels(): { id: WidgetId; collapsed: boolean }[] {
  return [{ id: 'stories', collapsed: false }];
}
