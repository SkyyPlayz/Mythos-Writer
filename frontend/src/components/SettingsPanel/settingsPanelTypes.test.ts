// SKY-5903: regression coverage for the nav-rail merge/fallback logic in
// settingsPanelTypes.ts. This logic previously lived inline in DesktopShell's
// navItems useMemo with zero direct test coverage — see PR #829 audit.
// Beta 4 M3 extends the rail to the six §4 modules (Story Writer, Notes
// Editor, Scene Crafter, Brainstorm, Timeline, Vault Graph); the SKY-5903
// order guarantee — a user's custom order is never overridden on upgrade —
// must survive that migration.
import { describe, it, expect } from 'vitest';
import {
  mergeNavConfigItems,
  reorderNavConfigItems,
  resolveNavRailItems,
  NAV_RAIL_DEFAULTS,
} from './settingsPanelTypes';

describe('NAV_RAIL_DEFAULTS (Beta 4 M3)', () => {
  it('lists the six §4 modules in spec order', () => {
    expect(NAV_RAIL_DEFAULTS.items.map((i) => i.id)).toEqual([
      'story', 'notes', 'crafter', 'brainstorm', 'timeline', 'graph',
    ]);
  });

  it('uses the §4 module labels', () => {
    expect(NAV_RAIL_DEFAULTS.items.map((i) => i.label)).toEqual([
      'Story Writer', 'Notes Editor', 'Scene Crafter', 'Brainstorm', 'Timeline', 'Vault Graph',
    ]);
  });

  it('enables every module by default', () => {
    expect(NAV_RAIL_DEFAULTS.items.every((i) => i.enabled)).toBe(true);
  });
});

describe('mergeNavConfigItems', () => {
  it('appends a new default item after the user\'s highest saved order, not at the item\'s own default order', () => {
    // User re-ordered their legacy 2-item config: notes first, story last,
    // with a gap in the order values (as could arise from imported/legacy data).
    const saved: NavRailItemConfig[] = [
      { id: 'notes', enabled: true, label: 'Notes', icon: '📝', order: 0 },
      { id: 'story', enabled: true, label: 'Story', icon: '✍', order: 5 },
    ];

    const merged = mergeNavConfigItems(saved, NAV_RAIL_DEFAULTS.items);
    const brainstorm = merged.find((i) => i.id === 'brainstorm');

    expect(brainstorm).toBeDefined();
    // Must land after story (order 5), not at its own hardcoded default
    // which would otherwise sort it between notes and story.
    expect(brainstorm!.order).toBeGreaterThan(5);
  });

  it('keeps the user\'s saved order and enabled flags untouched (SKY-5903)', () => {
    const saved: NavRailItemConfig[] = [
      { id: 'notes', enabled: false, label: 'My Notes', icon: '🗒', order: 3 },
      { id: 'story', enabled: true, label: 'Story', icon: '✍', order: 1 },
    ];

    const merged = mergeNavConfigItems(saved, NAV_RAIL_DEFAULTS.items);
    const notes = merged.find((i) => i.id === 'notes');
    const story = merged.find((i) => i.id === 'story');

    expect(notes).toMatchObject({ enabled: false, order: 3 });
    expect(story).toMatchObject({ enabled: true, order: 1 });
  });

  it('refreshes label and icon from the current defaults (Beta 4 M3 module renames)', () => {
    const saved: NavRailItemConfig[] = [
      { id: 'notes', enabled: false, label: 'Notes', icon: '🗒', order: 3 },
      { id: 'story', enabled: true, label: 'Story', icon: '✍', order: 1 },
    ];

    const merged = mergeNavConfigItems(saved, NAV_RAIL_DEFAULTS.items);

    expect(merged.find((i) => i.id === 'story')!.label).toBe('Story Writer');
    expect(merged.find((i) => i.id === 'notes')!.label).toBe('Notes Editor');
  });

  it('does not duplicate or reorder items already present in the saved config', () => {
    const saved: NavRailItemConfig[] = NAV_RAIL_DEFAULTS.items.map((i) => ({ ...i }));
    const merged = mergeNavConfigItems(saved, NAV_RAIL_DEFAULTS.items);
    expect(merged).toHaveLength(NAV_RAIL_DEFAULTS.items.length);
    expect(merged.map((i) => i.id)).toEqual(saved.map((i) => i.id));
  });

  it('returns the full defaults, in default order, when there is no saved config', () => {
    const merged = mergeNavConfigItems(undefined, NAV_RAIL_DEFAULTS.items);
    expect(merged).toEqual(NAV_RAIL_DEFAULTS.items);
  });

  it('replaces an UNTOUCHED pre-Beta-4 default config with the new module order', () => {
    // The exact config an older version wrote when the user never customized
    // the rail — safe to upgrade wholesale to the §4 order.
    const legacyDefaults: NavRailItemConfig[] = [
      { id: 'story', enabled: true, label: 'Story', icon: '✍', order: 0 },
      { id: 'notes', enabled: true, label: 'Notes', icon: '📝', order: 1 },
      { id: 'brainstorm', enabled: true, label: 'Brainstorm', icon: '💡', order: 2 },
    ];

    const merged = mergeNavConfigItems(legacyDefaults, NAV_RAIL_DEFAULTS.items);

    expect(merged.map((i) => i.id)).toEqual([
      'story', 'notes', 'crafter', 'brainstorm', 'timeline', 'graph',
    ]);
  });

  it('does NOT rewrite a CUSTOMIZED pre-Beta-4 config — new modules append after it (SKY-5903)', () => {
    // brainstorm moved first: any customization disables the wholesale upgrade.
    const customized: NavRailItemConfig[] = [
      { id: 'brainstorm', enabled: true, label: 'Brainstorm', icon: '💡', order: 0 },
      { id: 'story', enabled: true, label: 'Story', icon: '✍', order: 1 },
      { id: 'notes', enabled: true, label: 'Notes', icon: '📝', order: 2 },
    ];

    const merged = mergeNavConfigItems(customized, NAV_RAIL_DEFAULTS.items);
    const sortedIds = [...merged].sort((a, b) => a.order - b.order).map((i) => i.id);

    expect(sortedIds).toEqual(['brainstorm', 'story', 'notes', 'crafter', 'timeline', 'graph']);
  });

  it('treats a disabled item in the pre-Beta-4 defaults as a customization', () => {
    const customized: NavRailItemConfig[] = [
      { id: 'story', enabled: true, label: 'Story', icon: '✍', order: 0 },
      { id: 'notes', enabled: true, label: 'Notes', icon: '📝', order: 1 },
      { id: 'brainstorm', enabled: false, label: 'Brainstorm', icon: '💡', order: 2 },
    ];

    const merged = mergeNavConfigItems(customized, NAV_RAIL_DEFAULTS.items);

    expect(merged.find((i) => i.id === 'brainstorm')!.enabled).toBe(false);
    const sortedIds = [...merged].sort((a, b) => a.order - b.order).map((i) => i.id);
    expect(sortedIds).toEqual(['story', 'notes', 'brainstorm', 'crafter', 'timeline', 'graph']);
  });
});

describe('reorderNavConfigItems (Beta 4 M3 edit popover)', () => {
  const items = (): NavRailItemConfig[] => NAV_RAIL_DEFAULTS.items.map((i) => ({ ...i }));

  it('moves an item and re-normalizes order to array positions', () => {
    const result = reorderNavConfigItems(items(), 0, 2);
    expect(result.map((i) => i.id)).toEqual(['notes', 'crafter', 'story', 'brainstorm', 'timeline', 'graph']);
    expect(result.map((i) => i.order)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('moves an item up', () => {
    const result = reorderNavConfigItems(items(), 3, 1);
    expect(result.map((i) => i.id)).toEqual(['story', 'brainstorm', 'notes', 'crafter', 'timeline', 'graph']);
  });

  it('ignores out-of-range targets but still normalizes order', () => {
    const shuffled = items().map((it, i) => ({ ...it, order: i * 10 }));
    const result = reorderNavConfigItems(shuffled, 0, 99);
    expect(result.map((i) => i.id)).toEqual(shuffled.map((i) => i.id));
    expect(result.map((i) => i.order)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('resolveNavRailItems', () => {
  it('sorts an old customized 2-item saved config with the new default modules appended', () => {
    const savedNavConfig: NavRailConfig = {
      items: [
        { id: 'notes', enabled: true, label: 'Notes', icon: '📝', order: 0 },
        { id: 'story', enabled: true, label: 'Story', icon: '✍', order: 1 },
      ],
      collapsedDefault: false,
      showLabels: true,
      showIcons: true,
    };

    const items = resolveNavRailItems(savedNavConfig, NAV_RAIL_DEFAULTS);

    expect(items.map((i) => i.id)).toEqual([
      'notes', 'story', 'crafter', 'brainstorm', 'timeline', 'graph',
    ]);
  });

  it('preserves a fully re-ordered custom order and appends new modules at the end', () => {
    const savedNavConfig: NavRailConfig = {
      items: [
        { id: 'notes', enabled: true, label: 'Notes', icon: '📝', order: 0 },
        { id: 'story', enabled: true, label: 'Story', icon: '✍', order: 5 },
      ],
      collapsedDefault: false,
      showLabels: true,
      showIcons: true,
    };

    const items = resolveNavRailItems(savedNavConfig, NAV_RAIL_DEFAULTS);

    expect(items.map((i) => i.id)).toEqual([
      'notes', 'story', 'crafter', 'brainstorm', 'timeline', 'graph',
    ]);
  });

  it('excludes hidden modules from the rendered rail', () => {
    const savedNavConfig: NavRailConfig = {
      items: NAV_RAIL_DEFAULTS.items.map((i) =>
        i.id === 'timeline' || i.id === 'graph' ? { ...i, enabled: false } : { ...i },
      ),
      collapsedDefault: false,
      showLabels: true,
      showIcons: true,
    };

    const items = resolveNavRailItems(savedNavConfig, NAV_RAIL_DEFAULTS);

    expect(items.map((i) => i.id)).toEqual(['story', 'notes', 'crafter', 'brainstorm']);
  });

  it('falls back to full defaults when every saved item is disabled', () => {
    const savedNavConfig: NavRailConfig = {
      items: NAV_RAIL_DEFAULTS.items.map((i) => ({ ...i, enabled: false })),
      collapsedDefault: false,
      showLabels: true,
      showIcons: true,
    };

    const items = resolveNavRailItems(savedNavConfig, NAV_RAIL_DEFAULTS);

    expect(items.map((i) => i.id)).toEqual(NAV_RAIL_DEFAULTS.items.map((i) => i.id));
  });

  it('falls back to defaults when there is no saved nav config at all', () => {
    const items = resolveNavRailItems(undefined, NAV_RAIL_DEFAULTS);
    expect(items.map((i) => i.id)).toEqual(NAV_RAIL_DEFAULTS.items.map((i) => i.id));
  });

  it('renders the §4 module labels from a fresh config', () => {
    const items = resolveNavRailItems(undefined, NAV_RAIL_DEFAULTS);
    expect(items.map((i) => i.label)).toEqual([
      'Story Writer', 'Notes Editor', 'Scene Crafter', 'Brainstorm', 'Timeline', 'Vault Graph',
    ]);
  });
});
