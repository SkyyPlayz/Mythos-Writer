import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrateV1Layout } from '../WorkspaceLayoutManager';
import {
  APP_PANEL_SCOPES,
  DESIGN_PANELS,
  LEFT_PANEL_IDS,
  PANEL_REGISTRY,
  RIGHT_PANEL_IDS,
  defaultMigrateLeftPanels,
  defaultMigrateRightPanels,
  designIdForAppPanel,
  designPanel,
  isDesignPanelId,
  panelBelongsToPage,
  type WidgetId,
} from './panelRegistry';
import { parseScope } from './scopeModel';

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

describe('panelRegistry scopes (W1)', () => {
  it('gives every app panel id and every design panel id a valid scope', () => {
    for (const entry of PANEL_REGISTRY) {
      expect(parseScope(entry.scope), entry.id).toBe(entry.scope);
      expect(entry.scope).toBe(APP_PANEL_SCOPES[entry.id]);
    }
    expect(Object.keys(APP_PANEL_SCOPES).sort()).toEqual([...PRE_MOVE_PANEL_ORDER].sort());
    for (const panel of DESIGN_PANELS) expect(parseScope(panel.scope), panel.id).toBe(panel.scope);
    expect(new Set(DESIGN_PANELS.map((panel) => panel.id)).size).toBe(DESIGN_PANELS.length);
  });

  it('keeps the Beta list on the Beta page, not global', () => {
    expect(designPanel('navBeta').scope).toBe('page:beta');
    expect(designPanel('betaPanel').scope).toBe('page:beta');
  });

  it('makes Findings and Suggestions full global panels, not Editor tabs', () => {
    expect(designPanel('findings')).toMatchObject({ scope: 'global', slot: 'sidebar', hosted: true });
    expect(designPanel('suggestions')).toMatchObject({ scope: 'global', slot: 'sidebar', hosted: true });
    expect(designPanel('agent')).toMatchObject({ scope: 'global', slot: 'sidebar' });
  });

  it('bridges today’s app ids to design ids with the same scope', () => {
    expect(designIdForAppPanel('stories')).toBe('navEditor');
    expect(designIdForAppPanel('writing-assistant')).toBe('agent');
    expect(designIdForAppPanel('archive-continuity')).toBe('findings');
    expect(designIdForAppPanel('review')).toBe('suggestions');
    expect(designIdForAppPanel('progress')).toBeNull();
    for (const panel of DESIGN_PANELS) {
      if (panel.appAlias === null) continue;
      expect(APP_PANEL_SCOPES[panel.appAlias], `${panel.id} → ${panel.appAlias}`).toBe(panel.scope);
    }
  });

  it('shares the Story Navigator with Story Book and Story Structure only', () => {
    expect(panelBelongsToPage('navEditor', 'editor')).toBe(true);
    expect(panelBelongsToPage('navEditor', 'book')).toBe(true);
    expect(panelBelongsToPage('navEditor', 'structure')).toBe(true);
    expect(panelBelongsToPage('navEditor', 'notes')).toBe(false);
    expect(panelBelongsToPage('edPanel', 'book')).toBe(false);
    expect(panelBelongsToPage('findings', 'editor')).toBe(false);
  });

  it('rejects unknown design ids', () => {
    expect(isDesignPanelId('navEditor')).toBe(true);
    expect(isDesignPanelId('stories')).toBe(false);
    expect(isDesignPanelId(undefined)).toBe(false);
  });
});
