// SKY-1700 (Wave 2f): Built-in layouts and layout management helpers.

export const BUILTIN_LAYOUT_IDS = {
  WRITING_FOCUS: 'builtin-writing-focus',
  WORLD_BUILDING: 'builtin-world-building',
  DUAL_MANUSCRIPT: 'builtin-dual-manuscript',
} as const;

/** Built-in layouts — versioned in code, cannot be deleted by user. */
export const BUILTIN_LAYOUTS: WorkspaceLayout[] = [
  {
    id: BUILTIN_LAYOUT_IDS.WRITING_FOCUS,
    name: 'Writing Focus',
    isDefault: true,
    isBuiltIn: true,
    createdAt: 0,
    leftSidebar: {
      visible: false,
      width: 240,
      panels: [
        { id: 'stories', collapsed: false },
        { id: 'entities', collapsed: false },
      ],
    },
    rightSidebar: {
      visible: true,
      width: 300,
      panels: [
        { id: 'writing-assistant', collapsed: false },
      ],
    },
    floatingPanels: [],
    dockedTabs: [],
    splitWindow: { enabled: false, splitRatio: 50 },
  },
  {
    id: BUILTIN_LAYOUT_IDS.WORLD_BUILDING,
    name: 'World-building',
    isDefault: false,
    isBuiltIn: true,
    createdAt: 0,
    leftSidebar: {
      visible: true,
      width: 240,
      panels: [
        { id: 'entities', collapsed: false },
        { id: 'stories', collapsed: true },
      ],
    },
    rightSidebar: {
      visible: true,
      width: 320,
      panels: [
        { id: 'archive-continuity', collapsed: false },
        { id: 'scene-preview', collapsed: false },
      ],
    },
    floatingPanels: [],
    dockedTabs: [],
    splitWindow: { enabled: false, splitRatio: 50 },
  },
  {
    id: BUILTIN_LAYOUT_IDS.DUAL_MANUSCRIPT,
    name: 'Dual Manuscript',
    isDefault: false,
    isBuiltIn: true,
    createdAt: 0,
    leftSidebar: {
      visible: false,
      width: 240,
      panels: [
        { id: 'stories', collapsed: false },
      ],
    },
    rightSidebar: {
      visible: true,
      width: 300,
      panels: [
        { id: 'writing-assistant', collapsed: false },
        { id: 'archive-continuity', collapsed: false },
      ],
    },
    floatingPanels: [],
    dockedTabs: [],
    splitWindow: { enabled: true, splitRatio: 50 },
  },
];

/** Merge user layouts with built-ins, replacing built-ins with canonical versions. */
export function mergeWithBuiltins(userLayouts: WorkspaceLayout[]): WorkspaceLayout[] {
  const userNonBuiltin = userLayouts.filter((l) => !l.isBuiltIn);
  return [...BUILTIN_LAYOUTS, ...userNonBuiltin];
}

/** Return all layouts (built-ins + user), normalized. */
export function getAllLayouts(settings: AppSettings): WorkspaceLayout[] {
  const stored = settings.workspaceLayouts ?? [];
  return mergeWithBuiltins(stored);
}

/** Snapshot the current live panel state into a WorkspaceLayout object. */
export function snapshotCurrentLayout(params: {
  id: string;
  name: string;
  isDefault: boolean;
  isBuiltIn?: boolean;
  leftSidebarLayout: LeftSidebarLayout;
  leftSidebarVisible: boolean;
  leftSidebarWidth: number;
  rightSidebarVisible: boolean;
  rightSidebarWidth: number;
  rightSidebarPanels: RightSidebarPanel[];
  floatingPanels: FloatingPanelEntry[];
  dockedTabs: DockedTab[];
  splitWindowEnabled: boolean;
  splitRatio: number;
}): WorkspaceLayout {
  return {
    id: params.id,
    name: params.name,
    isDefault: params.isDefault,
    isBuiltIn: params.isBuiltIn ?? false,
    createdAt: params.isBuiltIn ? 0 : Date.now(),
    leftSidebar: {
      visible: params.leftSidebarVisible,
      width: params.leftSidebarWidth,
      panels: params.leftSidebarLayout.panels as LeftPanelConfig[],
    },
    rightSidebar: {
      visible: params.rightSidebarVisible,
      width: params.rightSidebarWidth,
      panels: params.rightSidebarPanels,
    },
    floatingPanels: params.floatingPanels,
    dockedTabs: params.dockedTabs,
    splitWindow: {
      enabled: params.splitWindowEnabled,
      splitRatio: params.splitRatio,
    },
  };
}

/**
 * v1 → v2 migration: construct activeLayout.rightSidebar from legacy top-level fields
 * and seed the 3 built-in layouts into workspaceLayouts.
 */
export function migrateV1Layout(settings: AppSettings): Partial<AppSettings> {
  const rightSidebar = {
    visible: settings.rightSidebarVisible ?? true,
    width: settings.rightSidebarWidth ?? 300,
    panels: settings.rightSidebarPanels ?? [
      { id: 'writing-assistant' as SidebarPanelId, collapsed: false },
      { id: 'archive-continuity' as SidebarPanelId, collapsed: false },
      { id: 'scene-preview' as SidebarPanelId, collapsed: false },
    ],
  };

  return {
    workspaceLayouts: BUILTIN_LAYOUTS,
    activeLayoutId: null,
    layoutMigrationDone: true,
    activeLayout: {
      ...settings.activeLayout,
      leftSidebar: settings.activeLayout?.leftSidebar ?? {
        panels: [{ id: 'stories' as SidebarPanelId, collapsed: false }],
        sidebarCollapsed: false,
      },
      rightSidebar,
    },
  };
}
