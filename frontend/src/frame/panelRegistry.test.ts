import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrateV1Layout } from '../WorkspaceLayoutManager';
import {
  LEFT_PANEL_IDS,
  PANEL_REGISTRY,
  RIGHT_PANEL_IDS,
  defaultMigrateLeftPanels,
  defaultMigrateRightPanels,
  type WidgetId,
} from './panelRegistry';

/** Unions as they were declared in global.d.ts before this move (right, then left). */
const PRE_MOVE_PANEL_ORDER = [
  'writing-assistant',
  'archive-continuity',
  'scene-preview',
  'scene-notes',
  'scene-properties',
  'scenes',
  'references',
  'brainstorm',
  'stories',
  'entities',
  'vault',
  'vault-graph',
  'review',
  'progress',
  'timeline',
] as const satisfies readonly WidgetId[];

const PRE_MOVE_RIGHT_DEFAULTS = [
  'writing-assistant',
  'archive-continuity',
  'scene-preview',
] as const satisfies readonly WidgetId[];

describe('panelRegistry', () => {
  it('lists the same panel ids in the same order as the pre-move unions', () => {
    expect(PANEL_REGISTRY.map((entry) => entry.id)).toEqual([...PRE_MOVE_PANEL_ORDER]);
    expect(RIGHT_PANEL_IDS).toEqual(PRE_MOVE_PANEL_ORDER.slice(0, 8));
    expect(LEFT_PANEL_IDS).toEqual(PRE_MOVE_PANEL_ORDER.slice(8));
    expect(PANEL_REGISTRY.map((entry) => entry.side)).toEqual([
      ...RIGHT_PANEL_IDS.map(() => 'right'),
      ...LEFT_PANEL_IDS.map(() => 'left'),
    ]);
  });

  it('keeps the v1 migrate default rows and returns a fresh copy each call', () => {
    expect(defaultMigrateRightPanels().map((panel) => panel.id)).toEqual([...PRE_MOVE_RIGHT_DEFAULTS]);
    expect(defaultMigrateRightPanels().every((panel) => panel.collapsed === false)).toBe(true);
    expect(defaultMigrateLeftPanels()).toEqual([{ id: 'stories', collapsed: false }]);

    const first = defaultMigrateRightPanels();
    const second = defaultMigrateRightPanels();
    expect(first).not.toBe(second);
    first.pop();
    first[0]!.collapsed = true;
    expect(defaultMigrateRightPanels().map((panel) => panel.id)).toEqual([...PRE_MOVE_RIGHT_DEFAULTS]);
    expect(defaultMigrateRightPanels()[0]?.collapsed).toBe(false);
  });

  it('is what migrateV1Layout writes when legacy panel fields are absent', () => {
    const migrated = migrateV1Layout({} as AppSettings);
    expect(migrated.activeLayout?.rightSidebar?.panels).toEqual(defaultMigrateRightPanels());
    expect(migrated.activeLayout?.leftSidebar?.panels).toEqual(defaultMigrateLeftPanels());
    expect(migrated.activeLayout?.rightSidebar?.visible).toBe(true);
    expect(migrated.activeLayout?.rightSidebar?.width).toBe(300);
    expect(migrated.workspaceLayouts).toBeDefined();
    expect(migrated).not.toHaveProperty('layoutV3');
  });

  it('keeps the id literals out of global.d.ts', () => {
    const globalDts = readFileSync(resolve(__dirname, '../global.d.ts'), 'utf8');
    expect(globalDts).not.toContain("type RightPanelId = 'writing-assistant'");
    expect(globalDts).not.toContain("type LeftPanelId = 'stories'");
    expect(globalDts).toContain("type SidebarPanelId = import('./frame/panelRegistry').WidgetId");
    expect(globalDts).not.toContain('layoutV3');
  });
});
