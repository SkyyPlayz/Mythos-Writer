// SKY-3181 — Track layout engine unit tests.
// Covers: lane packing, stacking, gap detection, uniform/proportional spacing, undated scenes.

import { describe, it, expect } from 'vitest';
import {
  computeTrackLayout,
  primaryGroupKeysFor,
  type ArcMeta,
  type CharMeta,
  type ChapterMeta,
  type LocationMeta,
  type TrackLayoutContext,
  type TrackLayoutOptions,
} from './trackLayout';
import type { SpreadsheetScene } from './timelineFilters';

// ─── Factories ────────────────────────────────────────────────────────────────

function makeScene(overrides: Partial<SpreadsheetScene> = {}): SpreadsheetScene {
  return {
    id: `scene-${Math.random().toString(36).slice(2)}`,
    title: 'Untitled',
    chapterId: 'ch-1',
    date: '2024-01-01',
    pov: '',
    arcIds: [],
    characterIds: [],
    wordCount: null,
    mood: '',
    locationId: '',
    ...overrides,
  };
}

const EMPTY_CONTEXT: TrackLayoutContext = {
  arcs: [],
  chars: [],
  chapters: [],
  locations: [],
};

function makeArc(overrides: Partial<ArcMeta> = {}): ArcMeta {
  return { id: 'arc-1', title: 'Arc One', color: '#ff0000', ...overrides };
}

function makeChar(overrides: Partial<CharMeta> = {}): CharMeta {
  return { id: 'char-1', name: 'Alice', ...overrides };
}

function makeChapter(overrides: Partial<ChapterMeta> = {}): ChapterMeta {
  return { id: 'ch-1', title: 'Chapter One', ...overrides };
}

function makeLoc(overrides: Partial<LocationMeta> = {}): LocationMeta {
  return { id: 'loc-1', name: 'The Library', ...overrides };
}

function layoutOf(sceneId: string, result: ReturnType<typeof computeTrackLayout>) {
  const l = result.sceneLayouts.find(s => s.sceneId === sceneId);
  if (!l) throw new Error(`No layout for ${sceneId}`);
  return l;
}

// ─── primaryGroupKeysFor ──────────────────────────────────────────────────────

describe('primaryGroupKeysFor', () => {
  it('arc: returns all arcIds', () => {
    const s = makeScene({ arcIds: ['arc-a', 'arc-b'] });
    expect(primaryGroupKeysFor(s, 'arc')).toEqual(['arc-a', 'arc-b']);
  });

  it('arc: returns ["unassigned"] when arcIds is empty', () => {
    expect(primaryGroupKeysFor(makeScene({ arcIds: [] }), 'arc')).toEqual(['unassigned']);
  });

  it('character: returns first characterId only', () => {
    const s = makeScene({ characterIds: ['char-1', 'char-2'] });
    expect(primaryGroupKeysFor(s, 'character')).toEqual(['char-1']);
  });

  it('character: returns ["unassigned"] when characterIds is empty', () => {
    expect(primaryGroupKeysFor(makeScene({ characterIds: [] }), 'character')).toEqual(['unassigned']);
  });

  it('chapter: returns chapterId', () => {
    expect(primaryGroupKeysFor(makeScene({ chapterId: 'ch-x' }), 'chapter')).toEqual(['ch-x']);
  });

  it('chapter: returns ["unassigned"] when chapterId is empty', () => {
    expect(primaryGroupKeysFor(makeScene({ chapterId: '' }), 'chapter')).toEqual(['unassigned']);
  });

  it('location: returns locationId', () => {
    expect(primaryGroupKeysFor(makeScene({ locationId: 'loc-x' }), 'location')).toEqual(['loc-x']);
  });

  it('location: returns ["unassigned"] when locationId is empty', () => {
    expect(primaryGroupKeysFor(makeScene({ locationId: '' }), 'location')).toEqual(['unassigned']);
  });
});

// ─── Lane building ────────────────────────────────────────────────────────────

describe('lane assignment — arc grouping', () => {
  it('assigns scene to its arc lane', () => {
    const arc = makeArc();
    const scene = makeScene({ id: 's1', arcIds: ['arc-1'] });
    const result = computeTrackLayout([scene], { ...EMPTY_CONTEXT, arcs: [arc] }, {
      primaryGrouping: 'arc',
      spacingMode: 'uniform',
    });
    expect(result.lanes).toHaveLength(1);
    expect(result.lanes[0]).toMatchObject({ id: 'arc-1', label: 'Arc One', color: '#ff0000', index: 0 });
    expect(layoutOf('s1', result).laneIndex).toBe(0);
  });

  it('creates an "Unassigned" lane for scene with no arcs', () => {
    const scene = makeScene({ id: 's1', arcIds: [] });
    const result = computeTrackLayout([scene], EMPTY_CONTEXT, {
      primaryGrouping: 'arc',
      spacingMode: 'uniform',
    });
    expect(result.lanes[0]).toMatchObject({ id: 'unassigned', label: 'Unassigned' });
    expect(layoutOf('s1', result).laneIndex).toBe(0);
  });

  it('falls back to arc id as label when arc is not in context', () => {
    const scene = makeScene({ arcIds: ['arc-missing'] });
    const result = computeTrackLayout([scene], EMPTY_CONTEXT, {
      primaryGrouping: 'arc',
      spacingMode: 'uniform',
    });
    expect(result.lanes[0].label).toBe('arc-missing');
  });

  it('assigns scenes in different arcs to different lanes', () => {
    const s1 = makeScene({ id: 's1', arcIds: ['arc-a'] });
    const s2 = makeScene({ id: 's2', arcIds: ['arc-b'] });
    const result = computeTrackLayout([s1, s2], EMPTY_CONTEXT, {
      primaryGrouping: 'arc',
      spacingMode: 'uniform',
    });
    expect(result.lanes).toHaveLength(2);
    expect(layoutOf('s1', result).laneIndex).not.toBe(layoutOf('s2', result).laneIndex);
  });

  it('multi-arc scene: primary lane is first arc (first-seen)', () => {
    const s = makeScene({ id: 's1', arcIds: ['arc-a', 'arc-b'] });
    const result = computeTrackLayout([s], EMPTY_CONTEXT, {
      primaryGrouping: 'arc',
      spacingMode: 'uniform',
    });
    // arc-a is first → laneIndex 0
    expect(result.lanes[0].id).toBe('arc-a');
    expect(layoutOf('s1', result).laneIndex).toBe(0);
  });

  it('preserves first-seen lane order across scenes', () => {
    const s1 = makeScene({ id: 's1', arcIds: ['arc-b'] });
    const s2 = makeScene({ id: 's2', arcIds: ['arc-a'] });
    const result = computeTrackLayout([s1, s2], EMPTY_CONTEXT, {
      primaryGrouping: 'arc',
      spacingMode: 'uniform',
    });
    // arc-b was seen first, so it gets index 0
    expect(result.lanes[0].id).toBe('arc-b');
    expect(result.lanes[1].id).toBe('arc-a');
  });
});

describe('lane assignment — chapter grouping', () => {
  it('assigns scene to its chapter lane', () => {
    const chap = makeChapter({ id: 'ch-1', title: 'Prologue' });
    const scene = makeScene({ id: 's1', chapterId: 'ch-1' });
    const result = computeTrackLayout([scene], { ...EMPTY_CONTEXT, chapters: [chap] }, {
      primaryGrouping: 'chapter',
      spacingMode: 'uniform',
    });
    expect(result.lanes[0]).toMatchObject({ id: 'ch-1', label: 'Prologue' });
    expect(layoutOf('s1', result).laneIndex).toBe(0);
  });

  it('creates "Unassigned" when chapterId is empty', () => {
    const scene = makeScene({ id: 's1', chapterId: '' });
    const result = computeTrackLayout([scene], EMPTY_CONTEXT, {
      primaryGrouping: 'chapter',
      spacingMode: 'uniform',
    });
    expect(result.lanes[0].id).toBe('unassigned');
  });
});

describe('lane assignment — character grouping', () => {
  it('assigns scene to its first character lane', () => {
    const char = makeChar({ id: 'char-1', name: 'Alice' });
    const scene = makeScene({ id: 's1', characterIds: ['char-1', 'char-2'] });
    const result = computeTrackLayout([scene], { ...EMPTY_CONTEXT, chars: [char] }, {
      primaryGrouping: 'character',
      spacingMode: 'uniform',
    });
    expect(result.lanes[0]).toMatchObject({ id: 'char-1', label: 'Alice' });
    expect(layoutOf('s1', result).laneIndex).toBe(0);
  });

  it('creates "Unassigned" when characterIds is empty', () => {
    const scene = makeScene({ id: 's1', characterIds: [] });
    const result = computeTrackLayout([scene], EMPTY_CONTEXT, {
      primaryGrouping: 'character',
      spacingMode: 'uniform',
    });
    expect(result.lanes[0].id).toBe('unassigned');
  });
});

describe('lane assignment — location grouping', () => {
  it('assigns scene to its location lane', () => {
    const loc = makeLoc({ id: 'loc-1', name: 'The Library' });
    const scene = makeScene({ id: 's1', locationId: 'loc-1' });
    const result = computeTrackLayout([scene], { ...EMPTY_CONTEXT, locations: [loc] }, {
      primaryGrouping: 'location',
      spacingMode: 'uniform',
    });
    expect(result.lanes[0]).toMatchObject({ id: 'loc-1', label: 'The Library' });
    expect(layoutOf('s1', result).laneIndex).toBe(0);
  });
});

// ─── Stacking ─────────────────────────────────────────────────────────────────

describe('stacking — same-day collisions', () => {
  it('two scenes in same lane + same date get stackIndex 0 and 1', () => {
    const s1 = makeScene({ id: 's1', date: '2024-01-01', title: 'Alpha', arcIds: ['arc-1'] });
    const s2 = makeScene({ id: 's2', date: '2024-01-01', title: 'Beta', arcIds: ['arc-1'] });
    const result = computeTrackLayout([s1, s2], EMPTY_CONTEXT, {
      primaryGrouping: 'arc',
      spacingMode: 'uniform',
    });
    // Alpha sorts before Beta alphabetically → stackIndex 0
    expect(layoutOf('s1', result).stackIndex).toBe(0);
    expect(layoutOf('s2', result).stackIndex).toBe(1);
  });

  it('three scenes in same lane + same date get consecutive stackIndexes 0, 1, 2', () => {
    const s1 = makeScene({ id: 's1', date: '2024-01-01', title: 'A', arcIds: ['arc-1'] });
    const s2 = makeScene({ id: 's2', date: '2024-01-01', title: 'B', arcIds: ['arc-1'] });
    const s3 = makeScene({ id: 's3', date: '2024-01-01', title: 'C', arcIds: ['arc-1'] });
    const result = computeTrackLayout([s1, s2, s3], EMPTY_CONTEXT, {
      primaryGrouping: 'arc',
      spacingMode: 'uniform',
    });
    expect(layoutOf('s1', result).stackIndex).toBe(0);
    expect(layoutOf('s2', result).stackIndex).toBe(1);
    expect(layoutOf('s3', result).stackIndex).toBe(2);
  });

  it('scenes in different lanes at same date each get stackIndex 0', () => {
    const s1 = makeScene({ id: 's1', date: '2024-01-01', arcIds: ['arc-a'] });
    const s2 = makeScene({ id: 's2', date: '2024-01-01', arcIds: ['arc-b'] });
    const result = computeTrackLayout([s1, s2], EMPTY_CONTEXT, {
      primaryGrouping: 'arc',
      spacingMode: 'uniform',
    });
    expect(layoutOf('s1', result).stackIndex).toBe(0);
    expect(layoutOf('s2', result).stackIndex).toBe(0);
  });

  it('scenes in same lane at different dates each get stackIndex 0', () => {
    const s1 = makeScene({ id: 's1', date: '2024-01-01', arcIds: ['arc-1'] });
    const s2 = makeScene({ id: 's2', date: '2024-01-02', arcIds: ['arc-1'] });
    const result = computeTrackLayout([s1, s2], EMPTY_CONTEXT, {
      primaryGrouping: 'arc',
      spacingMode: 'uniform',
    });
    expect(layoutOf('s1', result).stackIndex).toBe(0);
    expect(layoutOf('s2', result).stackIndex).toBe(0);
  });

  it('stacking within a date+lane slot is alphabetical by title', () => {
    // Pass in reverse-alpha order to confirm sort kicks in
    const sZ = makeScene({ id: 'sZ', date: '2024-01-01', title: 'Zebra', arcIds: ['arc-1'] });
    const sA = makeScene({ id: 'sA', date: '2024-01-01', title: 'Apple', arcIds: ['arc-1'] });
    const result = computeTrackLayout([sZ, sA], EMPTY_CONTEXT, {
      primaryGrouping: 'arc',
      spacingMode: 'uniform',
    });
    expect(layoutOf('sA', result).stackIndex).toBe(0);
    expect(layoutOf('sZ', result).stackIndex).toBe(1);
  });

  it('stacking resets per date: scenes on day-1 and day-2 both start at stackIndex 0', () => {
    const s1 = makeScene({ id: 's1', date: '2024-01-01', title: 'A', arcIds: ['arc-1'] });
    const s2 = makeScene({ id: 's2', date: '2024-01-01', title: 'B', arcIds: ['arc-1'] });
    const s3 = makeScene({ id: 's3', date: '2024-01-05', title: 'C', arcIds: ['arc-1'] });
    const result = computeTrackLayout([s1, s2, s3], EMPTY_CONTEXT, {
      primaryGrouping: 'arc',
      spacingMode: 'uniform',
    });
    expect(layoutOf('s3', result).stackIndex).toBe(0);
  });
});

// ─── Uniform spacing ──────────────────────────────────────────────────────────

describe('uniform spacing', () => {
  const opts: TrackLayoutOptions = {
    primaryGrouping: 'arc',
    spacingMode: 'uniform',
    cardWidth: 200,
    columnSpacing: 300,
  };

  it('single date → xOffset 0', () => {
    const s = makeScene({ id: 's1', date: '2024-01-01' });
    const result = computeTrackLayout([s], EMPTY_CONTEXT, opts);
    expect(layoutOf('s1', result).xOffset).toBe(0);
  });

  it('two dates → x=0 and x=columnSpacing', () => {
    const s1 = makeScene({ id: 's1', date: '2024-01-01', arcIds: ['arc-1'] });
    const s2 = makeScene({ id: 's2', date: '2024-01-05', arcIds: ['arc-1'] });
    const result = computeTrackLayout([s1, s2], EMPTY_CONTEXT, opts);
    expect(layoutOf('s1', result).xOffset).toBe(0);
    expect(layoutOf('s2', result).xOffset).toBe(300);
  });

  it('three dates → x=0, columnSpacing, 2×columnSpacing', () => {
    const s1 = makeScene({ id: 's1', date: '2024-01-01', arcIds: ['arc-1'] });
    const s2 = makeScene({ id: 's2', date: '2024-01-10', arcIds: ['arc-1'] });
    const s3 = makeScene({ id: 's3', date: '2024-01-20', arcIds: ['arc-1'] });
    const result = computeTrackLayout([s1, s2, s3], EMPTY_CONTEXT, opts);
    expect(layoutOf('s1', result).xOffset).toBe(0);
    expect(layoutOf('s2', result).xOffset).toBe(300);
    expect(layoutOf('s3', result).xOffset).toBe(600);
  });

  it('card width comes from cardWidth option', () => {
    const s = makeScene({ id: 's1', date: '2024-01-01' });
    const result = computeTrackLayout([s], EMPTY_CONTEXT, opts);
    expect(layoutOf('s1', result).width).toBe(200);
  });

  it('two scenes on same date share the same xOffset', () => {
    const s1 = makeScene({ id: 's1', date: '2024-01-01', arcIds: ['arc-1'] });
    const s2 = makeScene({ id: 's2', date: '2024-01-01', arcIds: ['arc-1'] });
    const result = computeTrackLayout([s1, s2], EMPTY_CONTEXT, opts);
    expect(layoutOf('s1', result).xOffset).toBe(layoutOf('s2', result).xOffset);
  });

  it('timeAxis entries have x = idx × columnSpacing, width = cardWidth', () => {
    const s1 = makeScene({ id: 's1', date: '2024-01-01' });
    const s2 = makeScene({ id: 's2', date: '2024-01-05' });
    const result = computeTrackLayout([s1, s2], EMPTY_CONTEXT, opts);
    expect(result.timeAxis).toHaveLength(2);
    expect(result.timeAxis[0]).toMatchObject({ date: '2024-01-01', x: 0, width: 200 });
    expect(result.timeAxis[1]).toMatchObject({ date: '2024-01-05', x: 300, width: 200 });
  });
});

// ─── Proportional spacing ─────────────────────────────────────────────────────

describe('proportional spacing', () => {
  const opts: TrackLayoutOptions = {
    primaryGrouping: 'arc',
    spacingMode: 'proportional',
    cardWidth: 200,
    totalWidth: 4200,
  };

  it('single date → xOffset 0', () => {
    const s = makeScene({ id: 's1', date: '2024-01-01' });
    const result = computeTrackLayout([s], EMPTY_CONTEXT, opts);
    expect(layoutOf('s1', result).xOffset).toBe(0);
  });

  it('first date → x=0, last date → x=(totalWidth - cardWidth)', () => {
    const s1 = makeScene({ id: 's1', date: '2024-01-01', arcIds: ['arc-1'] });
    const s2 = makeScene({ id: 's2', date: '2024-01-31', arcIds: ['arc-1'] });
    const result = computeTrackLayout([s1, s2], EMPTY_CONTEXT, opts);
    expect(layoutOf('s1', result).xOffset).toBe(0);
    expect(layoutOf('s2', result).xOffset).toBe(4200 - 200); // 4000
  });

  it('middle date gets proportional x position', () => {
    // 2024-01-01 to 2024-01-11 = 10 days; 2024-01-06 is exactly halfway
    const s1 = makeScene({ id: 's1', date: '2024-01-01', arcIds: ['arc-1'] });
    const s2 = makeScene({ id: 's2', date: '2024-01-06', arcIds: ['arc-1'] });
    const s3 = makeScene({ id: 's3', date: '2024-01-11', arcIds: ['arc-1'] });
    const result = computeTrackLayout([s1, s2, s3], EMPTY_CONTEXT, opts);
    // ratio = 0.5, x = Math.round(0.5 * (4200 - 200)) = Math.round(2000) = 2000
    expect(layoutOf('s2', result).xOffset).toBe(2000);
  });

  it('custom totalWidth is honored', () => {
    const s1 = makeScene({ id: 's1', date: '2024-01-01', arcIds: ['arc-1'] });
    const s2 = makeScene({ id: 's2', date: '2024-01-11', arcIds: ['arc-1'] });
    const result = computeTrackLayout([s1, s2], EMPTY_CONTEXT, {
      ...opts,
      totalWidth: 1000,
      cardWidth: 100,
    });
    expect(layoutOf('s2', result).xOffset).toBe(1000 - 100);
  });

  it('scenes on the same date get the same xOffset in proportional mode', () => {
    const s1 = makeScene({ id: 's1', date: '2024-01-06', arcIds: ['arc-1'] });
    const s2 = makeScene({ id: 's2', date: '2024-01-06', arcIds: ['arc-1'] });
    const result = computeTrackLayout([s1, s2], EMPTY_CONTEXT, opts);
    expect(layoutOf('s1', result).xOffset).toBe(layoutOf('s2', result).xOffset);
  });
});

// ─── Gap detection ────────────────────────────────────────────────────────────

describe('gap detection', () => {
  const base: TrackLayoutOptions = {
    primaryGrouping: 'arc',
    spacingMode: 'uniform',
    columnSpacing: 240,
    cardWidth: 180,
  };

  it('adjacent dates 1 day apart produce no gap (default threshold = 1)', () => {
    const s1 = makeScene({ id: 's1', date: '2024-01-01' });
    const s2 = makeScene({ id: 's2', date: '2024-01-02' });
    const result = computeTrackLayout([s1, s2], EMPTY_CONTEXT, base);
    expect(result.gaps).toHaveLength(0);
  });

  it('adjacent dates 2 days apart produce one gap', () => {
    const s1 = makeScene({ id: 's1', date: '2024-01-01' });
    const s2 = makeScene({ id: 's2', date: '2024-01-03' });
    const result = computeTrackLayout([s1, s2], EMPTY_CONTEXT, base);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]).toMatchObject({
      afterDate: '2024-01-01',
      beforeDate: '2024-01-03',
      dayDelta: 2,
    });
  });

  it('gap afterX = column.x + cardWidth; beforeX = next column.x', () => {
    const s1 = makeScene({ id: 's1', date: '2024-01-01' });
    const s2 = makeScene({ id: 's2', date: '2024-01-10' });
    const result = computeTrackLayout([s1, s2], EMPTY_CONTEXT, {
      ...base,
      columnSpacing: 300,
      cardWidth: 180,
    });
    // date1 at x=0, date2 at x=300
    expect(result.gaps[0].afterX).toBe(0 + 180); // 180
    expect(result.gaps[0].beforeX).toBe(300);
    expect(result.gaps[0].dayDelta).toBe(9);
  });

  it('detects multiple gaps in a sequence', () => {
    const s1 = makeScene({ date: '2024-01-01' });
    const s2 = makeScene({ date: '2024-01-05' }); // 4 days gap
    const s3 = makeScene({ date: '2024-01-06' }); // 1 day — no gap
    const s4 = makeScene({ date: '2024-01-20' }); // 14 days gap
    const result = computeTrackLayout([s1, s2, s3, s4], EMPTY_CONTEXT, base);
    expect(result.gaps).toHaveLength(2);
    expect(result.gaps[0].afterDate).toBe('2024-01-01');
    expect(result.gaps[0].beforeDate).toBe('2024-01-05');
    expect(result.gaps[1].afterDate).toBe('2024-01-06');
    expect(result.gaps[1].beforeDate).toBe('2024-01-20');
  });

  it('custom gapThresholdDays=0 marks a 1-day gap', () => {
    const s1 = makeScene({ date: '2024-01-01' });
    const s2 = makeScene({ date: '2024-01-02' });
    const result = computeTrackLayout([s1, s2], EMPTY_CONTEXT, {
      ...base,
      gapThresholdDays: 0,
    });
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].dayDelta).toBe(1);
  });

  it('custom gapThresholdDays=7 suppresses gaps of less than 8 days', () => {
    const s1 = makeScene({ date: '2024-01-01' });
    const s2 = makeScene({ date: '2024-01-07' }); // 6 days — below threshold 7
    const s3 = makeScene({ date: '2024-01-16' }); // 9 days — above threshold 7
    const result = computeTrackLayout([s1, s2, s3], EMPTY_CONTEXT, {
      ...base,
      gapThresholdDays: 7,
    });
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].afterDate).toBe('2024-01-07');
  });

  it('no gaps when there is only one unique date', () => {
    const s1 = makeScene({ date: '2024-01-01' });
    const s2 = makeScene({ date: '2024-01-01' });
    const result = computeTrackLayout([s1, s2], EMPTY_CONTEXT, base);
    expect(result.gaps).toHaveLength(0);
  });
});

// ─── Undated scenes ───────────────────────────────────────────────────────────

describe('undated scenes', () => {
  const opts: TrackLayoutOptions = {
    primaryGrouping: 'arc',
    spacingMode: 'uniform',
    columnSpacing: 240,
    cardWidth: 180,
  };

  it('undated scene is placed after the last dated column', () => {
    const dated = makeScene({ id: 'dated', date: '2024-01-01', arcIds: ['arc-1'] });
    const undated = makeScene({ id: 'undated', date: '', arcIds: ['arc-1'] });
    const result = computeTrackLayout([dated, undated], EMPTY_CONTEXT, opts);
    // Last dated column x=0, so undated x = 0 + columnSpacing = 240
    expect(layoutOf('undated', result).xOffset).toBe(240);
    expect(layoutOf('dated', result).xOffset).toBe(0);
  });

  it('undated scenes in same lane stack like dated scenes', () => {
    const u1 = makeScene({ id: 'u1', date: '', title: 'A', arcIds: ['arc-1'] });
    const u2 = makeScene({ id: 'u2', date: '', title: 'B', arcIds: ['arc-1'] });
    const result = computeTrackLayout([u1, u2], EMPTY_CONTEXT, opts);
    expect(layoutOf('u1', result).stackIndex).toBe(0);
    expect(layoutOf('u2', result).stackIndex).toBe(1);
  });

  it('all-undated input: scenes placed at x=0', () => {
    const u = makeScene({ id: 'u1', date: '' });
    const result = computeTrackLayout([u], EMPTY_CONTEXT, opts);
    expect(layoutOf('u1', result).xOffset).toBe(0);
  });

  it('undated scenes do not contribute to the timeAxis', () => {
    const u = makeScene({ id: 'u1', date: '' });
    const result = computeTrackLayout([u], EMPTY_CONTEXT, opts);
    expect(result.timeAxis).toHaveLength(0);
  });

  it('undated scenes do not contribute to gap detection', () => {
    const dated = makeScene({ date: '2024-01-01' });
    const undated = makeScene({ date: '' });
    const result = computeTrackLayout([dated, undated], EMPTY_CONTEXT, opts);
    expect(result.gaps).toHaveLength(0);
  });

  it('multiple undated scenes across different lanes have independent stacks', () => {
    const u1 = makeScene({ id: 'u1', date: '', arcIds: ['arc-a'] });
    const u2 = makeScene({ id: 'u2', date: '', arcIds: ['arc-b'] });
    const result = computeTrackLayout([u1, u2], EMPTY_CONTEXT, opts);
    expect(layoutOf('u1', result).stackIndex).toBe(0);
    expect(layoutOf('u2', result).stackIndex).toBe(0);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('empty input returns empty result', () => {
    const result = computeTrackLayout([], EMPTY_CONTEXT, {
      primaryGrouping: 'arc',
      spacingMode: 'uniform',
    });
    expect(result.lanes).toHaveLength(0);
    expect(result.sceneLayouts).toHaveLength(0);
    expect(result.timeAxis).toHaveLength(0);
    expect(result.gaps).toHaveLength(0);
  });

  it('single dated scene produces one lane, one layout, one timeAxis column, no gaps', () => {
    const s = makeScene({ id: 's1', date: '2024-06-15', arcIds: ['arc-1'] });
    const result = computeTrackLayout([s], EMPTY_CONTEXT, {
      primaryGrouping: 'arc',
      spacingMode: 'uniform',
    });
    expect(result.lanes).toHaveLength(1);
    expect(result.sceneLayouts).toHaveLength(1);
    expect(result.timeAxis).toHaveLength(1);
    expect(result.gaps).toHaveLength(0);
    expect(layoutOf('s1', result)).toMatchObject({
      laneIndex: 0,
      stackIndex: 0,
      xOffset: 0,
    });
  });

  it('all scenes on same date → single timeAxis entry, no gaps', () => {
    const s1 = makeScene({ id: 's1', date: '2024-01-01', arcIds: ['arc-a'] });
    const s2 = makeScene({ id: 's2', date: '2024-01-01', arcIds: ['arc-b'] });
    const result = computeTrackLayout([s1, s2], EMPTY_CONTEXT, {
      primaryGrouping: 'arc',
      spacingMode: 'uniform',
    });
    expect(result.timeAxis).toHaveLength(1);
    expect(result.gaps).toHaveLength(0);
  });

  it('duplicate scene ids produce two layout entries', () => {
    // Caller is responsible for dedup; engine processes what it receives
    const s = makeScene({ id: 's1', date: '2024-01-01' });
    const result = computeTrackLayout([s, s], EMPTY_CONTEXT, {
      primaryGrouping: 'arc',
      spacingMode: 'uniform',
    });
    expect(result.sceneLayouts).toHaveLength(2);
    expect(result.sceneLayouts[0].sceneId).toBe('s1');
    expect(result.sceneLayouts[1].sceneId).toBe('s1');
  });

  it('default options produce valid layout', () => {
    const s = makeScene({ id: 's1', date: '2024-01-01' });
    expect(() =>
      computeTrackLayout([s], EMPTY_CONTEXT, { primaryGrouping: 'arc', spacingMode: 'uniform' }),
    ).not.toThrow();
  });

  it('timeAxis is ordered ascending by date regardless of scene insertion order', () => {
    const s1 = makeScene({ id: 's1', date: '2024-03-01' });
    const s2 = makeScene({ id: 's2', date: '2024-01-01' });
    const s3 = makeScene({ id: 's3', date: '2024-02-01' });
    const result = computeTrackLayout([s1, s2, s3], EMPTY_CONTEXT, {
      primaryGrouping: 'arc',
      spacingMode: 'uniform',
    });
    const dates = result.timeAxis.map(c => c.date);
    expect(dates).toEqual(['2024-01-01', '2024-02-01', '2024-03-01']);
  });

  it('scenes on the same date in same lane share xOffset in both spacing modes', () => {
    const s1 = makeScene({ id: 's1', date: '2024-01-01', arcIds: ['arc-1'] });
    const s2 = makeScene({ id: 's2', date: '2024-01-01', arcIds: ['arc-1'] });

    for (const spacingMode of ['uniform', 'proportional'] as const) {
      const result = computeTrackLayout([s1, s2], EMPTY_CONTEXT, {
        primaryGrouping: 'arc',
        spacingMode,
      });
      expect(layoutOf('s1', result).xOffset).toBe(layoutOf('s2', result).xOffset);
    }
  });
});

// ─── Large input (packing sanity check) ───────────────────────────────────────

describe('large input packing', () => {
  it('500 scenes across 10 arcs produce 10 lanes and 500 layout entries', () => {
    const arcs = Array.from({ length: 10 }, (_, i) => makeArc({ id: `arc-${i}`, title: `Arc ${i}` }));
    const scenes = Array.from({ length: 500 }, (_, i) =>
      makeScene({
        id: `s${i}`,
        date: `2024-${String(Math.floor(i / 30) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
        arcIds: [`arc-${i % 10}`],
      }),
    );
    const result = computeTrackLayout(scenes, { ...EMPTY_CONTEXT, arcs }, {
      primaryGrouping: 'arc',
      spacingMode: 'uniform',
    });
    expect(result.lanes).toHaveLength(10);
    expect(result.sceneLayouts).toHaveLength(500);
    // Every scene has a valid laneIndex
    for (const layout of result.sceneLayouts) {
      expect(layout.laneIndex).toBeGreaterThanOrEqual(0);
      expect(layout.laneIndex).toBeLessThan(10);
    }
  });
});
