import { describe, it, expect } from 'vitest';
import {
  ARC_LANE,
  CHARACTER_LANE,
  PLOT_TEMPLATES,
  THEME_LANE,
  WORLD_LANE,
  arcSpans,
  buildTemplateApplication,
  characterSpans,
  eventVisible,
  isEventWritten,
  isFlashback,
  keyEvents,
  plotlineCards,
  plotlineRows,
  themeEvents,
  worldEvents,
} from './storyLanes';
import type { TimelineEvent, TimelineRow, TimelineSpan } from '../../timelinesTypes';

const TL = 'tl-story';

function span(id: string, rowId?: string): TimelineSpan {
  return { id, timelineId: TL, name: id, startWhen: 0, endWhen: 100, rowId };
}

function event(id: string, when: number, extra: Partial<TimelineEvent> = {}): TimelineEvent {
  return { id, timelineId: TL, name: id, when, ...extra };
}

describe('story-lane partition', () => {
  const spans = [
    span('main'),                       // BOOKS row
    span('arc-1', ARC_LANE),
    span('char-1', CHARACTER_LANE),
    span('crow-item', 'row:custom-1'),  // custom-row item
  ];
  const rows: TimelineRow[] = [
    { id: 'row:custom-1', timelineId: TL, name: 'CUSTOM', kind: 'custom' },
    { id: 'pl-1', timelineId: TL, name: 'Main Plot', kind: 'plotline', color: '#00f0ff' },
  ];
  const events = [
    event('ev-plain', 10),
    event('ev-crow', 20, { rowId: 'row:custom-1' }),
    event('ev-world', 30, { rowId: WORLD_LANE }),
    event('ev-theme', 0, { rowId: THEME_LANE }),
    event('card-1', 40, { rowId: 'pl-1', chapter: 3 }),
    event('ev-other-tl', 50),
  ];
  events[5] = { ...events[5], timelineId: 'tl-other' };
  const store = { spans, rows, events };

  it('routes spans to the right lanes', () => {
    expect(arcSpans(store, TL).map((s) => s.id)).toEqual(['arc-1']);
    expect(characterSpans(store, TL).map((s) => s.id)).toEqual(['char-1']);
  });

  it('routes events to world / themes / plotline cards', () => {
    expect(worldEvents(store, TL).map((e) => e.id)).toEqual(['ev-world']);
    expect(themeEvents(store, TL).map((e) => e.id)).toEqual(['ev-theme']);
    expect(plotlineRows(store, TL).map((r) => r.id)).toEqual(['pl-1']);
    expect(plotlineCards(store, 'pl-1').map((e) => e.id)).toEqual(['card-1']);
  });

  it('KEY EVENTS keeps plain + custom-row events and excludes the story lanes', () => {
    expect(keyEvents(store, TL).map((e) => e.id)).toEqual(['ev-plain', 'ev-crow']);
  });
});

describe('isFlashback — chronology ≠ narrative', () => {
  // Prototype tlEvents: "The Crown of Ash" revealed in Ch. 31 but dated far
  // before the Ch. 1–23 events.
  const events = [
    event('e1', 8710, { chapter: 1 }),
    event('e2', 8730, { chapter: 18 }),
    event('flash', 8500, { chapter: 31 }),
    event('e4', 8740, { chapter: 45 }),
  ];

  it('flags the back-dated late-narrative event only', () => {
    expect(isFlashback(events[2], events)).toBe(true);
    expect(isFlashback(events[0], events)).toBe(false);
    expect(isFlashback(events[1], events)).toBe(false);
    expect(isFlashback(events[3], events)).toBe(false);
  });

  it('never flags events without a narrative chapter', () => {
    expect(isFlashback(event('x', 0), events)).toBe(false);
  });
});

describe('written/planned + Show filter (prototype evVis)', () => {
  const here = 500;

  it('explicit written flag wins; otherwise the current position decides', () => {
    expect(isEventWritten(event('a', 900, { written: true }), here)).toBe(true);
    expect(isEventWritten(event('b', 100, { written: false }), here)).toBe(false);
    expect(isEventWritten(event('c', 100), here)).toBe(true);
    expect(isEventWritten(event('d', 900), here)).toBe(false);
    // nothing written yet → everything is planned
    expect(isEventWritten(event('e', 100), null)).toBe(false);
  });

  it('Written Only / Planned Only split on the same rule', () => {
    const early = event('early', 100);
    const late = event('late', 900);
    const ctx = { events: [early, late], hereWhen: here };
    expect(eventVisible(early, { ...ctx, show: 'Written Only' })).toBe(true);
    expect(eventVisible(late, { ...ctx, show: 'Written Only' })).toBe(false);
    expect(eventVisible(early, { ...ctx, show: 'Planned Only' })).toBe(false);
    expect(eventVisible(late, { ...ctx, show: 'Planned Only' })).toBe(true);
    expect(eventVisible(late, { ...ctx, show: 'All Events' })).toBe(true);
  });

  it('Key Events keeps flashbacks and summarized events', () => {
    const flash = event('flash', 100, { chapter: 31 });
    const before = event('before', 900, { chapter: 1, rowId: 'row:x' });
    const summarized = event('summarized', 300, { summary: 'Big', rowId: 'row:x' });
    const bare = event('bare', 200, { rowId: 'row:x' });
    const ctx = { events: [flash, before, summarized, bare], hereWhen: null };
    expect(eventVisible(flash, { ...ctx, show: 'Key Events' })).toBe(true);
    expect(eventVisible(summarized, { ...ctx, show: 'Key Events' })).toBe(true);
    expect(eventVisible(bare, { ...ctx, show: 'Key Events' })).toBe(false);
  });
});

describe('plot-structure templates (prototype tlTpls — exact port)', () => {
  it('carries the prototype beat counts: Three-Act 7, Save the Cat 8, Hero’s Journey 8', () => {
    expect(PLOT_TEMPLATES.map((t) => [t.name, t.beats.length])).toEqual([
      ['Three-Act Structure', 7],
      ['Save the Cat', 8],
      ['Hero’s Journey', 8],
    ]);
  });

  it('buildTemplateApplication lays a plotline row + dashed beat cards', () => {
    let n = 0;
    const app = buildTemplateApplication(
      PLOT_TEMPLATES[1], // Save the Cat
      TL,
      2,
      (ch) => ch * 10,
      (prefix) => `${prefix}:${n++}`,
    );
    expect(app.row).toMatchObject({ timelineId: TL, name: 'Save the Cat', kind: 'plotline' });
    expect(app.row.color).toBeTruthy();
    expect(app.cards).toHaveLength(8);
    expect(app.cards[0]).toMatchObject({
      name: 'Opening Image',
      rowId: app.row.id,
      chapter: 1,
      when: 10,
      beat: true,
    });
    expect(app.cards[7]).toMatchObject({ name: 'Final Image', chapter: 12, when: 120 });
    for (const card of app.cards) {
      expect(card.timelineId).toBe(TL);
      expect(card.summary).toContain('Save the Cat beat');
    }
  });
});
