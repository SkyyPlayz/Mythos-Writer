// SKY-1700 (Wave 2f): tests for layout manager helpers.
import { describe, it, expect } from 'vitest';
import {
  BUILTIN_LAYOUTS,
  BUILTIN_LAYOUT_IDS,
  mergeWithBuiltins,
  getAllLayouts,
  snapshotCurrentLayout,
  migrateV1Layout,
} from './WorkspaceLayoutManager';

describe('BUILTIN_LAYOUTS (AC-W-01)', () => {
  it('contains exactly 3 built-in layouts', () => {
    expect(BUILTIN_LAYOUTS).toHaveLength(3);
  });

  it('has Writing Focus, World-building, Dual Manuscript', () => {
    const names = BUILTIN_LAYOUTS.map((l) => l.name);
    expect(names).toContain('Writing Focus');
    expect(names).toContain('World-building');
    expect(names).toContain('Dual Manuscript');
  });

  it('all built-in layouts have isBuiltIn=true', () => {
    BUILTIN_LAYOUTS.forEach((l) => expect(l.isBuiltIn).toBe(true));
  });

  it('Writing Focus is the default layout', () => {
    const wf = BUILTIN_LAYOUTS.find((l) => l.id === BUILTIN_LAYOUT_IDS.WRITING_FOCUS);
    expect(wf?.isDefault).toBe(true);
  });

  it('exactly one layout is default', () => {
    const defaults = BUILTIN_LAYOUTS.filter((l) => l.isDefault);
    expect(defaults).toHaveLength(1);
  });

  it('Dual Manuscript has split enabled', () => {
    const dm = BUILTIN_LAYOUTS.find((l) => l.id === BUILTIN_LAYOUT_IDS.DUAL_MANUSCRIPT);
    expect(dm?.splitWindow.enabled).toBe(true);
  });

  it('Writing Focus has right sidebar visible, left hidden', () => {
    const wf = BUILTIN_LAYOUTS.find((l) => l.id === BUILTIN_LAYOUT_IDS.WRITING_FOCUS);
    expect(wf?.rightSidebar.visible).toBe(true);
    expect(wf?.leftSidebar.visible).toBe(false);
  });
});

describe('mergeWithBuiltins', () => {
  it('always includes all 3 built-in layouts', () => {
    const result = mergeWithBuiltins([]);
    expect(result).toHaveLength(3);
  });

  it('appends user layouts after built-ins', () => {
    const userLayout: WorkspaceLayout = {
      id: 'user-1',
      name: 'My Layout',
      isDefault: false,
      isBuiltIn: false,
      createdAt: 1000,
      leftSidebar: { visible: true, width: 240, panels: [] },
      rightSidebar: { visible: false, width: 300, panels: [] },
      floatingPanels: [],
      dockedTabs: [],
      splitWindow: { enabled: false, splitRatio: 50 },
    };
    const result = mergeWithBuiltins([userLayout]);
    expect(result).toHaveLength(4);
    expect(result[3].id).toBe('user-1');
  });

  it('strips isBuiltIn user layouts passed in (cannot inject built-in replacements)', () => {
    const fake: WorkspaceLayout = {
      id: BUILTIN_LAYOUT_IDS.WRITING_FOCUS,
      name: 'Hacked',
      isDefault: false,
      isBuiltIn: true,
      createdAt: 0,
      leftSidebar: { visible: true, width: 240, panels: [] },
      rightSidebar: { visible: false, width: 300, panels: [] },
      floatingPanels: [],
      dockedTabs: [],
      splitWindow: { enabled: false, splitRatio: 50 },
    };
    const result = mergeWithBuiltins([fake]);
    // built-in from code wins; the passed-in one is filtered out
    const wf = result.find((l) => l.id === BUILTIN_LAYOUT_IDS.WRITING_FOCUS);
    expect(wf?.name).toBe('Writing Focus');
    // Total should still be 3 (fake is isBuiltIn=true so filtered by userNonBuiltin)
    expect(result).toHaveLength(3);
  });
});

describe('getAllLayouts', () => {
  it('returns 3 built-in layouts when settings has no workspaceLayouts', () => {
    const settings = {} as AppSettings;
    expect(getAllLayouts(settings)).toHaveLength(3);
  });

  it('merges stored user layouts with built-ins', () => {
    const userLayout: WorkspaceLayout = {
      id: 'user-1',
      name: 'User',
      isDefault: false,
      isBuiltIn: false,
      createdAt: 1000,
      leftSidebar: { visible: true, width: 240, panels: [] },
      rightSidebar: { visible: false, width: 300, panels: [] },
      floatingPanels: [],
      dockedTabs: [],
      splitWindow: { enabled: false, splitRatio: 50 },
    };
    const settings = { workspaceLayouts: [userLayout] } as unknown as AppSettings;
    expect(getAllLayouts(settings)).toHaveLength(4);
  });
});

describe('snapshotCurrentLayout', () => {
  it('captures all state fields correctly', () => {
    const panels: LeftPanelConfig[] = [{ id: 'stories', collapsed: false }];
    const snapshot = snapshotCurrentLayout({
      id: 'snap-1',
      name: 'Test',
      isDefault: false,
      leftSidebarLayout: { panels, sidebarCollapsed: false },
      leftSidebarVisible: true,
      leftSidebarWidth: 240,
      rightSidebarVisible: true,
      rightSidebarWidth: 320,
      rightSidebarPanels: [{ id: 'writing-assistant', collapsed: false }],
      floatingPanels: [],
      dockedTabs: [],
      splitWindowEnabled: false,
      splitRatio: 50,
    });
    expect(snapshot.id).toBe('snap-1');
    expect(snapshot.name).toBe('Test');
    expect(snapshot.leftSidebar.visible).toBe(true);
    expect(snapshot.rightSidebar.visible).toBe(true);
    expect(snapshot.rightSidebar.panels).toHaveLength(1);
    expect(snapshot.splitWindow.enabled).toBe(false);
    expect(snapshot.isBuiltIn).toBe(false);
  });
});

describe('migrateV1Layout (AC-W-10)', () => {
  it('sets layoutMigrationDone=true', () => {
    const settings = {
      rightSidebarVisible: true,
      rightSidebarWidth: 280,
      rightSidebarPanels: [{ id: 'writing-assistant', collapsed: false }],
    } as unknown as AppSettings;
    const result = migrateV1Layout(settings);
    expect(result.layoutMigrationDone).toBe(true);
  });

  it('seeds 3 built-in layouts', () => {
    const settings = {} as AppSettings;
    const result = migrateV1Layout(settings);
    expect(result.workspaceLayouts).toHaveLength(3);
  });

  it('reads legacy rightSidebarVisible/Width/Panels into activeLayout.rightSidebar', () => {
    const settings = {
      rightSidebarVisible: false,
      rightSidebarWidth: 400,
      rightSidebarPanels: [{ id: 'scene-preview', collapsed: true }],
    } as unknown as AppSettings;
    const result = migrateV1Layout(settings);
    expect(result.activeLayout?.rightSidebar?.visible).toBe(false);
    expect(result.activeLayout?.rightSidebar?.width).toBe(400);
    expect(result.activeLayout?.rightSidebar?.panels).toHaveLength(1);
  });

  it('defaults rightSidebar when legacy fields absent', () => {
    const settings = {} as AppSettings;
    const result = migrateV1Layout(settings);
    expect(result.activeLayout?.rightSidebar?.visible).toBe(true);
    expect(result.activeLayout?.rightSidebar?.width).toBe(300);
  });

  it('sets activeLayoutId to null', () => {
    const settings = {} as AppSettings;
    const result = migrateV1Layout(settings);
    expect(result.activeLayoutId).toBeNull();
  });
});
