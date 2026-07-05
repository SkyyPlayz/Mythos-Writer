// Beta 3 M20 — timelineAeon pure-helper tests.
//
// Coverage:
//   - resolveTimelineMode: valid / legacy ('aeon' → progress, 'track' → subway) / invalid
//   - hexA: exact port of the prototype's rgba conversion
//   - buildSubwayLines: exact prototype math (subLines 4703–4709) incl. dips,
//     station placement, and the single-event divide-by-zero guard
//   - minimapWindow / minimapScrollLeft: scrubber math + clamping
//   - sampleIndices / chapterFallbackSlot
//   - deriveAeonTimeline: here-index, chapter cells, event sampling, eras,
//     bands, arcs, journeys, lines, and graceful degradation on empty input

import { describe, it, expect } from 'vitest';
import {
  resolveTimelineMode,
  hexA,
  buildSubwayLines,
  subwayEventX,
  minimapWindow,
  minimapScrollLeft,
  sampleIndices,
  chapterFallbackSlot,
  deriveAeonTimeline,
  PROGRESS_GREY_FILTER,
  PROGRESS_GREY_OPACITY,
  SLOT_HEX,
  type AeonDeriveInput,
  type AeonSceneInput,
} from './timelineAeon';

// ─── Fixtures ───

function makeScene(overrides: Partial<AeonSceneInput> = {}): AeonSceneInput {
  return {
    id: 'sc-1',
    title: 'Scene',
    chapterId: 'ch-1',
    date: '',
    wordCount: null,
    pov: '',
    mood: '',
    arcIds: [],
    characterIds: [],
    ...overrides,
  };
}

function makeInput(overrides: Partial<AeonDeriveInput> = {}): AeonDeriveInput {
  return {
    storyTitle: 'The Neon Saga',
    scenes: [],
    chapters: [],
    arcs: [],
    characters: [],
    worldEvents: [],
    concepts: [],
    ...overrides,
  };
}

// ─── Mode resolution ───

describe('resolveTimelineMode', () => {
  it('accepts every prototype mode', () => {
    for (const m of ['progress', 'structure', 'spreadsheet', 'relations', 'subway']) {
      expect(resolveTimelineMode(m)).toBe(m);
    }
  });

  it('migrates the legacy Beta-2 modes', () => {
    expect(resolveTimelineMode('aeon')).toBe('progress');
    expect(resolveTimelineMode('track')).toBe('subway');
  });

  it('returns null for unknown or absent values', () => {
    expect(resolveTimelineMode('kanban-nonsense')).toBeNull();
    expect(resolveTimelineMode(null)).toBeNull();
    expect(resolveTimelineMode('')).toBeNull();
  });
});

// ─── hexA ───

describe('hexA', () => {
  it('converts hex + alpha to the prototype rgba format', () => {
    expect(hexA('#00f0ff', 0.5)).toBe('rgba(0,240,255,0.500)');
    expect(hexA('#9b5fff', 0.32)).toBe('rgba(155,95,255,0.320)');
  });

  it('clamps alpha to [0, 1]', () => {
    expect(hexA('#ffffff', 2)).toBe('rgba(255,255,255,1.000)');
    expect(hexA('#000000', -1)).toBe('rgba(0,0,0,0.000)');
  });
});

// ─── Grey filter constants (prototype 4259, exact values) ───

describe('PROGRESS_GREY_FILTER', () => {
  it('matches the prototype filter exactly', () => {
    expect(PROGRESS_GREY_FILTER).toBe('grayscale(.92) brightness(.82)');
    expect(PROGRESS_GREY_OPACITY).toBe(0.55);
  });
});

// ─── Subway math ───

describe('buildSubwayLines', () => {
  // The prototype fixture: 6 events, first line present at [0, 2, 3, 5].
  const LINE = { name: 'Mira Veynn', slot: 1, color: '#00f0ff', presentAt: [0, 2, 3, 5] };

  it('places event stations at the prototype x positions (70 + i·160 for 6 events)', () => {
    for (let i = 0; i < 6; i++) {
      expect(subwayEventX(i, 6)).toBe(70 + i * 160);
    }
  });

  it('builds the exact prototype path with absence dips (+14) on missed events', () => {
    const [line] = buildSubwayLines([LINE], 6);
    expect(line.y).toBe(60);
    expect(line.path).toBe('M70,60 L230,74 L390,60 L550,60 L710,74 L870,60');
  });

  it('renders stations only where the character is present', () => {
    const [line] = buildSubwayLines([LINE], 6);
    expect(line.stations).toEqual([
      { cx: 70, cy: 60 },
      { cx: 390, cy: 60 },
      { cx: 550, cy: 60 },
      { cx: 870, cy: 60 },
    ]);
  });

  it('spaces line rows 44px apart starting at y=60', () => {
    const lines = buildSubwayLines(
      [LINE, { ...LINE, name: 'Kael Thorne' }, { ...LINE, name: 'Liora Ashen' }],
      6,
    );
    expect(lines.map(l => l.y)).toEqual([60, 104, 148]);
  });

  it('guards the single-event case against division by zero', () => {
    const [line] = buildSubwayLines([{ ...LINE, presentAt: [0] }], 1);
    expect(line.path).toBe('M70,60');
    expect(line.stations).toEqual([{ cx: 70, cy: 60 }]);
  });

  it('returns no lines for no characters', () => {
    expect(buildSubwayLines([], 6)).toEqual([]);
  });
});

// ─── Minimap math ───

describe('minimapWindow', () => {
  it('maps scroll state to viewport fractions', () => {
    expect(minimapWindow(0, 500, 2000)).toEqual({ left: 0, width: 0.25 });
    expect(minimapWindow(1000, 500, 2000)).toEqual({ left: 0.5, width: 0.25 });
  });

  it('clamps the window inside the track', () => {
    expect(minimapWindow(99999, 500, 2000)).toEqual({ left: 0.75, width: 0.25 });
    expect(minimapWindow(-50, 500, 2000)).toEqual({ left: 0, width: 0.25 });
  });

  it('spans the full track when the content fits the viewport', () => {
    expect(minimapWindow(0, 500, 400)).toEqual({ left: 0, width: 1 });
    expect(minimapWindow(0, 500, 0)).toEqual({ left: 0, width: 1 });
    expect(minimapWindow(0, 0, 2000)).toEqual({ left: 0, width: 1 });
  });
});

describe('minimapScrollLeft', () => {
  it('centers the window under the pointer', () => {
    // width fraction = 0.25 → pointer at 0.5 puts the window's left at 0.375.
    expect(minimapScrollLeft(0.5, 500, 2000)).toBe(750);
  });

  it('clamps to the track ends', () => {
    expect(minimapScrollLeft(0, 500, 2000)).toBe(0);
    expect(minimapScrollLeft(1, 500, 2000)).toBe(1500); // (1 - 0.25) * 2000
    expect(minimapScrollLeft(-0.5, 500, 2000)).toBe(0);
  });

  it('returns 0 when the content fits the viewport', () => {
    expect(minimapScrollLeft(0.9, 500, 400)).toBe(0);
    expect(minimapScrollLeft(0.9, 500, 0)).toBe(0);
  });
});

// ─── Sampling helpers ───

describe('sampleIndices', () => {
  it('returns all indices when n <= max', () => {
    expect(sampleIndices(3, 6)).toEqual([0, 1, 2]);
    expect(sampleIndices(0, 6)).toEqual([]);
  });

  it('samples evenly including the first and last index', () => {
    expect(sampleIndices(45, 6)).toEqual([0, 9, 18, 26, 35, 44]);
  });
});

describe('chapterFallbackSlot', () => {
  it('splits 45 chapters into the prototype slot groups (12/23/34 → c2/c6/c5/c3)', () => {
    expect(chapterFallbackSlot(0, 45)).toBe(2);
    expect(chapterFallbackSlot(11, 45)).toBe(2);
    expect(chapterFallbackSlot(12, 45)).toBe(6);
    expect(chapterFallbackSlot(22, 45)).toBe(6);
    expect(chapterFallbackSlot(23, 45)).toBe(5);
    expect(chapterFallbackSlot(33, 45)).toBe(5);
    expect(chapterFallbackSlot(34, 45)).toBe(3);
    expect(chapterFallbackSlot(44, 45)).toBe(3);
  });
});

// ─── Derivation ───

describe('deriveAeonTimeline', () => {
  const CHAPTERS = [
    { id: 'ch-1', title: 'Chapter One' },
    { id: 'ch-2', title: 'Chapter Two' },
    { id: 'ch-3', title: 'Chapter Three' },
  ];

  it('degrades gracefully to empty lanes on empty input', () => {
    const data = deriveAeonTimeline(makeInput());
    expect(data.events).toEqual([]);
    expect(data.chapters).toEqual([]);
    expect(data.eras).toEqual([]);
    expect(data.bands).toEqual([]);
    expect(data.lines).toEqual([]);
    expect(data.hereIndex).toBe(-1);
    expect(data.hereLabel).toBe('');
  });

  it('marks the last chapter with a written scene as "you are here"', () => {
    const data = deriveAeonTimeline(makeInput({
      chapters: CHAPTERS,
      scenes: [
        makeScene({ id: 's1', chapterId: 'ch-1', wordCount: 500 }),
        makeScene({ id: 's2', chapterId: 'ch-2', wordCount: 120 }),
        makeScene({ id: 's3', chapterId: 'ch-3', wordCount: null }),
      ],
    }));
    expect(data.hereIndex).toBe(1);
    expect(data.hereLabel).toBe('Ch 2');
    expect(data.chapters.map(c => c.isHere)).toEqual([false, true, false]);
    expect(data.chapters.map(c => c.written)).toEqual([true, true, false]);
  });

  it('keeps hereIndex at -1 when nothing is written', () => {
    const data = deriveAeonTimeline(makeInput({
      chapters: CHAPTERS,
      scenes: [makeScene({ chapterId: 'ch-1' })],
    }));
    expect(data.hereIndex).toBe(-1);
    expect(data.bands[0].unwritten).toBe(true);
  });

  it('samples at most six key events, in story order, from the same scene data', () => {
    const scenes = Array.from({ length: 12 }, (_, i) =>
      makeScene({ id: `s${i}`, title: `Scene ${i}`, chapterId: 'ch-1', date: `2340-06-${String(i + 1).padStart(2, '0')}` }));
    const data = deriveAeonTimeline(makeInput({ chapters: CHAPTERS, scenes }));
    expect(data.events).toHaveLength(6);
    expect(data.events[0].sceneId).toBe('s0');
    expect(data.events[5].sceneId).toBe('s11');
    expect(data.events[0].ch).toBe('Ch. 1');
  });

  it('buckets eras by scene-date year with flex proportional to counts', () => {
    const data = deriveAeonTimeline(makeInput({
      chapters: CHAPTERS,
      scenes: [
        makeScene({ id: 's1', date: '2340-01-01' }),
        makeScene({ id: 's2', date: '2340-06-01' }),
        makeScene({ id: 's3', date: '2341-02-01' }),
      ],
    }));
    expect(data.eras).toEqual([
      { label: '2340', flex: 2 },
      { label: '2341', flex: 1 },
    ]);
  });

  it('derives one uppercase book band per story with the chapter range', () => {
    const data = deriveAeonTimeline(makeInput({
      chapters: CHAPTERS,
      scenes: [makeScene({ wordCount: 10 })],
    }));
    expect(data.bands).toHaveLength(1);
    expect(data.bands[0].title).toBe('THE NEON SAGA');
    expect(data.bands[0].sub).toBe('Ch. 1–3 · 1 scene');
    expect(data.bands[0].unwritten).toBe(false);
  });

  it('sizes arc segments by scene count and flags written arcs', () => {
    const data = deriveAeonTimeline(makeInput({
      chapters: CHAPTERS,
      arcs: [
        { id: 'arc-a', title: 'Hero Journey', color: '#00f0ff' },
        { id: 'arc-b', title: 'Villain Rise', color: '#ff4dff' },
      ],
      scenes: [
        makeScene({ id: 's1', arcIds: ['arc-a'], wordCount: 900 }),
        makeScene({ id: 's2', arcIds: ['arc-a'] }),
        makeScene({ id: 's3', arcIds: ['arc-b'] }),
      ],
    }));
    expect(data.arcs).toEqual([
      { id: 'arc-a', title: 'Hero Journey', color: '#00f0ff', flex: 2, written: true },
      { id: 'arc-b', title: 'Villain Rise', color: '#ff4dff', flex: 1, written: false },
    ]);
  });

  it('colors chapter cells by their dominant arc, falling back to slot hexes', () => {
    const data = deriveAeonTimeline(makeInput({
      chapters: CHAPTERS,
      arcs: [{ id: 'arc-a', title: 'Hero Journey', color: '#123456' }],
      scenes: [makeScene({ id: 's1', chapterId: 'ch-1', arcIds: ['arc-a'] })],
    }));
    expect(data.chapters[0].color).toBe('#123456');
    // ch-2 has no arc scenes → prototype quartile fallback (index 1 of 3
    // falls in the second prototype band → slot 6 hex).
    expect(data.chapters[1].color).toBe(SLOT_HEX[5]);
  });

  it('builds presence lines only for characters that appear in events', () => {
    const characters = [
      { id: 'c-mira', name: 'Mira' },
      { id: 'c-kael', name: 'Kael' },
      { id: 'c-ghost', name: 'Ghost' }, // in no scene
    ];
    const data = deriveAeonTimeline(makeInput({
      chapters: CHAPTERS,
      characters,
      scenes: [
        makeScene({ id: 's1', chapterId: 'ch-1', characterIds: ['c-mira', 'c-kael'] }),
        makeScene({ id: 's2', chapterId: 'ch-2', characterIds: ['c-mira'] }),
      ],
    }));
    expect(data.lines.map(l => l.name)).toEqual(['Mira', 'Kael']);
    expect(data.lines[0].presentAt).toEqual([0, 1]);
    expect(data.lines[1].presentAt).toEqual([0]);
    // Journeys mirror the ranking and report scene counts.
    expect(data.journeys[0].name).toBe('Mira');
    expect(data.journeys[0].sub).toBe('2 scenes');
  });

  it('maps world events and themes from vault entities, capped', () => {
    const data = deriveAeonTimeline(makeInput({
      chapters: CHAPTERS,
      scenes: [makeScene()],
      worldEvents: Array.from({ length: 7 }, (_, i) => ({ id: `w${i}`, name: `World ${i}` })),
      concepts: Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, name: `Theme ${i}` })),
    }));
    expect(data.world).toHaveLength(5);
    expect(data.themes).toHaveLength(4);
    expect(data.world[0].name).toBe('World 0');
    expect(data.themes[0].name).toBe('Theme 0');
  });
});
