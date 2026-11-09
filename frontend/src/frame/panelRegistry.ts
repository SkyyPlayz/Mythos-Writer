/** Owns the ordered sidebar panel id catalog (WidgetId). Never reads settings, never renders, and never imports vault, TipTap, or agent code. */

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
}

/** Right-panel ids, then left-panel ids: the order those unions had in global.d.ts. */
export const PANEL_REGISTRY: readonly PanelRegistryEntry[] = [
  ...RIGHT_PANEL_IDS.map((id) => ({ id, side: 'right' as const })),
  ...LEFT_PANEL_IDS.map((id) => ({ id, side: 'left' as const })),
];

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
