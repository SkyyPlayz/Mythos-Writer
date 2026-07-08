// SKY-5903: regression coverage for the nav-rail merge/fallback logic in
// settingsPanelTypes.ts. This logic previously lived inline in DesktopShell's
// navItems useMemo with zero direct test coverage — see PR #829 audit.
import { describe, it, expect } from 'vitest';
import { mergeNavConfigItems, resolveNavRailItems, NAV_RAIL_DEFAULTS } from './settingsPanelTypes';

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
    // Must land after story (order 5), not at its own hardcoded default (order 2)
    // which would otherwise sort it between notes and story.
    expect(brainstorm!.order).toBeGreaterThan(5);
  });

  it('keeps the user\'s saved items (order, enabled, label, icon) untouched', () => {
    const saved: NavRailItemConfig[] = [
      { id: 'notes', enabled: false, label: 'My Notes', icon: '🗒', order: 3 },
      { id: 'story', enabled: true, label: 'Story', icon: '✍', order: 1 },
    ];

    const merged = mergeNavConfigItems(saved, NAV_RAIL_DEFAULTS.items);

    expect(merged.find((i) => i.id === 'notes')).toEqual(saved[0]);
    expect(merged.find((i) => i.id === 'story')).toEqual(saved[1]);
  });

  it('does not duplicate or alter items already present in the saved config', () => {
    const saved: NavRailItemConfig[] = NAV_RAIL_DEFAULTS.items.map((i) => ({ ...i }));
    const merged = mergeNavConfigItems(saved, NAV_RAIL_DEFAULTS.items);
    expect(merged).toHaveLength(NAV_RAIL_DEFAULTS.items.length);
  });

  it('returns the full defaults, in default order, when there is no saved config', () => {
    const merged = mergeNavConfigItems(undefined, NAV_RAIL_DEFAULTS.items);
    expect(merged).toEqual(NAV_RAIL_DEFAULTS.items);
  });
});

describe('resolveNavRailItems', () => {
  it('sorts an old 2-item saved config with a new default item appended correctly', () => {
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

    expect(items.map((i) => i.id)).toEqual(['notes', 'story', 'brainstorm']);
  });

  it('preserves a fully re-ordered custom order and appends the new item at the end', () => {
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

    expect(items.map((i) => i.id)).toEqual(['notes', 'story', 'brainstorm']);
  });

  it('falls back to full defaults when every saved item is disabled', () => {
    const savedNavConfig: NavRailConfig = {
      items: [
        { id: 'story', enabled: false, label: 'Story', icon: '✍', order: 0 },
        { id: 'notes', enabled: false, label: 'Notes', icon: '📝', order: 1 },
        { id: 'brainstorm', enabled: false, label: 'Brainstorm', icon: '💡', order: 2 },
      ],
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
});
