// SKY-795 — Filter/opacity/keyboard-cycle helpers.

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FILTERS,
  isWithinDateRange,
  matchesEntityTab,
  sceneOpacity,
  isSceneHidden,
  chronologicalSceneIds,
  stepFocusedScene,
} from './timelineFilters';
import type { SpreadsheetScene } from './TimelineSpreadsheet';

function makeScene(overrides: Partial<SpreadsheetScene> = {}): SpreadsheetScene {
  return {
    id: crypto.randomUUID(),
    title: 'Scene',
    chapterId: 'ch-1',
    date: '',
    pov: '',
    arcIds: [],
    characterIds: [],
    wordCount: null,
    mood: '',
    locationId: '',
    ...overrides,
  };
}

describe('isWithinDateRange', () => {
  it('treats empty from/to as unbounded for dated scenes', () => {
    expect(isWithinDateRange('2024-05-01', '', '')).toBe(true);
  });

  it('hides scenes earlier than the from bound', () => {
    expect(isWithinDateRange('2024-01-01', '2024-06-01', '')).toBe(false);
  });

  it('hides scenes later than the to bound', () => {
    expect(isWithinDateRange('2024-12-31', '', '2024-06-01')).toBe(false);
  });

  it('keeps scenes inside [from, to] inclusive', () => {
    expect(isWithinDateRange('2024-06-15', '2024-06-01', '2024-12-31')).toBe(true);
    expect(isWithinDateRange('2024-06-01', '2024-06-01', '2024-12-31')).toBe(true);
    expect(isWithinDateRange('2024-12-31', '2024-06-01', '2024-12-31')).toBe(true);
  });

  it('only shows undated scenes when no date filter is active', () => {
    expect(isWithinDateRange('', '', '')).toBe(true);
    expect(isWithinDateRange('', '2024-06-01', '')).toBe(false);
    expect(isWithinDateRange('', '', '2024-12-31')).toBe(false);
  });
});

describe('matchesEntityTab', () => {
  const scene = makeScene({
    arcIds: ['arc-alpha'],
    characterIds: ['char-1', 'char-2'],
    locationId: 'loc-1',
  });

  it("'all' tab matches every scene", () => {
    expect(matchesEntityTab(scene, { ...DEFAULT_FILTERS, entityTab: 'all' })).toBe(true);
  });

  it('character filter matches when scene includes the character', () => {
    expect(matchesEntityTab(scene, { ...DEFAULT_FILTERS, entityTab: 'character', entityValue: 'char-1' })).toBe(true);
    expect(matchesEntityTab(scene, { ...DEFAULT_FILTERS, entityTab: 'character', entityValue: 'char-9' })).toBe(false);
  });

  it('arc filter matches when scene includes the arc', () => {
    expect(matchesEntityTab(scene, { ...DEFAULT_FILTERS, entityTab: 'arc', entityValue: 'arc-alpha' })).toBe(true);
    expect(matchesEntityTab(scene, { ...DEFAULT_FILTERS, entityTab: 'arc', entityValue: 'arc-beta' })).toBe(false);
  });

  it('location filter matches when locationId is identical', () => {
    expect(matchesEntityTab(scene, { ...DEFAULT_FILTERS, entityTab: 'location', entityValue: 'loc-1' })).toBe(true);
    expect(matchesEntityTab(scene, { ...DEFAULT_FILTERS, entityTab: 'location', entityValue: 'loc-2' })).toBe(false);
  });

  it('empty entityValue means "any" for non-all tabs', () => {
    expect(matchesEntityTab(scene, { ...DEFAULT_FILTERS, entityTab: 'character', entityValue: '' })).toBe(true);
  });
});

describe('sceneOpacity', () => {
  const scene = makeScene({
    date: '2024-06-15',
    arcIds: ['arc-alpha'],
    characterIds: ['char-1'],
    locationId: 'loc-1',
  });

  it('returns 1 with no filters active', () => {
    expect(sceneOpacity(scene, DEFAULT_FILTERS)).toBe(1);
  });

  it('returns 0 (hidden) when outside the date range', () => {
    expect(sceneOpacity(scene, { ...DEFAULT_FILTERS, dateFrom: '2024-12-01' })).toBe(0);
    expect(isSceneHidden(scene, { ...DEFAULT_FILTERS, dateFrom: '2024-12-01' })).toBe(true);
  });

  it('fades non-matching entity-tab rows to 0.3 per spec §2.4', () => {
    expect(
      sceneOpacity(scene, { ...DEFAULT_FILTERS, entityTab: 'character', entityValue: 'char-9' }),
    ).toBe(0.3);
  });

  it('ghosts non-focused-arc rows to 0.2 per spec §3.3', () => {
    expect(
      sceneOpacity(scene, { ...DEFAULT_FILTERS, focusedArcId: 'arc-beta' }),
    ).toBe(0.2);
  });

  it('keeps the focused arc fully vivid', () => {
    expect(
      sceneOpacity(scene, { ...DEFAULT_FILTERS, focusedArcId: 'arc-alpha' }),
    ).toBe(1);
  });

  it('arc-focus ghost (0.2) wins over entity-tab fade (0.3) when both apply', () => {
    const filters = {
      ...DEFAULT_FILTERS,
      entityTab: 'character' as const,
      entityValue: 'char-9',
      focusedArcId: 'arc-beta',
    };
    expect(sceneOpacity(scene, filters)).toBe(0.2);
  });

  it('date-range hide (0) takes precedence over any fade', () => {
    const filters = {
      ...DEFAULT_FILTERS,
      dateFrom: '2024-12-01',
      entityTab: 'arc' as const,
      entityValue: 'arc-alpha',
    };
    expect(sceneOpacity(scene, filters)).toBe(0);
  });
});

describe('chronologicalSceneIds + stepFocusedScene', () => {
  const s1 = makeScene({ id: 'a', date: '2024-01-01', title: 'A' });
  const s2 = makeScene({ id: 'b', date: '2024-06-01', title: 'B' });
  const s3 = makeScene({ id: 'c', date: '2024-12-01', title: 'C' });
  const s4 = makeScene({ id: 'd', date: '', title: 'Z-undated' });

  it('orders by date with undated scenes sorting to the tail', () => {
    expect(chronologicalSceneIds([s2, s4, s1, s3])).toEqual(['a', 'b', 'c', 'd']);
  });

  it('Tab from null lands on the first id', () => {
    expect(stepFocusedScene(null, ['a', 'b', 'c'], 1)).toBe('a');
  });

  it('Shift+Tab from null lands on the last id', () => {
    expect(stepFocusedScene(null, ['a', 'b', 'c'], -1)).toBe('c');
  });

  it('Tab advances by one and wraps at the tail', () => {
    expect(stepFocusedScene('a', ['a', 'b', 'c'], 1)).toBe('b');
    expect(stepFocusedScene('c', ['a', 'b', 'c'], 1)).toBe('a');
  });

  it('Shift+Tab retreats by one and wraps at the head', () => {
    expect(stepFocusedScene('b', ['a', 'b', 'c'], -1)).toBe('a');
    expect(stepFocusedScene('a', ['a', 'b', 'c'], -1)).toBe('c');
  });

  it('returns the first id when the current id is no longer in the chrono list', () => {
    expect(stepFocusedScene('stale', ['a', 'b', 'c'], 1)).toBe('a');
  });

  it('returns null for an empty chrono list', () => {
    expect(stepFocusedScene('a', [], 1)).toBe(null);
  });
});
