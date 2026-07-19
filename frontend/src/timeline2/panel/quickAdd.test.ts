// Beta 4 M25 — Archive quick-add parsing (§8.6, AC5).
import { describe, it, expect } from 'vitest';
import type { TimelineCalendar } from '../../timelinesTypes';
import {
  heuristicQuickAdd,
  parseAgentQuickAdd,
  quickAddEvent,
  titleFromText,
  type QuickAddContext,
} from './quickAdd';

const calendar: TimelineCalendar = {
  preset: 'standard', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24,
};

// `when` = hours/10 in the active calendar: 12×30×24 → 864 when-units/year,
// so the domain below spans roughly years 810–926.
const ctx: QuickAddContext = {
  timelineId: 'tl-1',
  calendar,
  domain: [700000, 800000],
  chapterCount: 10,
  whenForChapter: (i) => 700000 + (i + 1) * 50,
  newItemId: (prefix) => `${prefix}:test`,
};

describe('titleFromText', () => {
  it('strips the add-verb lead-in and the chapter tail', () => {
    expect(titleFromText('Add the festival from Ch. 4')).toBe('Festival');
    expect(titleFromText('add harvest riots in chapter 12')).toBe('Harvest riots');
    expect(titleFromText('The Sundering')).toBe('The Sundering');
  });
});

describe('parseAgentQuickAdd', () => {
  it('accepts a strict JSON reply and encodes the date in the calendar', () => {
    const reply = 'Here you go: {"title":"The Festival of Lights","year":871,"month":3,"day":14,"chapter":4}';
    const parse = parseAgentQuickAdd(reply, ctx, 'Add the festival from Ch. 4');
    expect(parse).not.toBeNull();
    expect(parse!.name).toBe('The Festival of Lights');
    expect(parse!.chapter).toBe(4);
    expect(parse!.datedBy).toBe('agent');
    // Y871 M3 D14: 871×864 + (2×720 + 13×24)/10 = 752719.2
    expect(parse!.when).toBe(752719.2);
  });

  it('rejects replies without a numeric year or without JSON', () => {
    expect(parseAgentQuickAdd('I could not date this.', ctx, 'x')).toBeNull();
    expect(parseAgentQuickAdd('{"title":"No date"}', ctx, 'x')).toBeNull();
    expect(parseAgentQuickAdd('{"year":"soon"}', ctx, 'x')).toBeNull();
  });

  it('clamps out-of-calendar month/day/hour instead of failing', () => {
    const parse = parseAgentQuickAdd('{"title":"Odd","year":850,"month":99,"day":0,"hour":30}', ctx, 'x');
    expect(parse).not.toBeNull();
    // clamps into year 850 (864 when-units per year)
    expect(parse!.when).toBeGreaterThanOrEqual(850 * 864);
    expect(parse!.when).toBeLessThan(851 * 864);
  });
});

describe('heuristicQuickAdd', () => {
  it('a chapter reference plots at that chapter position', () => {
    const parse = heuristicQuickAdd('Add the festival from Ch. 4', ctx);
    expect(parse).toMatchObject({ datedBy: 'chapter', chapter: 4, when: 700200 });
  });

  it('an explicit in-domain year plots there', () => {
    const parse = heuristicQuickAdd('The Sundering of 850', ctx);
    expect(parse.datedBy).toBe('year');
    expect(parse.when).toBe(850 * 864);
  });

  it('anything else lands mid-axis', () => {
    const parse = heuristicQuickAdd('The quiet before', ctx);
    expect(parse.datedBy).toBe('fallback');
    expect(parse.when).toBe(750000);
  });
});

describe('quickAddEvent', () => {
  it('assembles an agent-sourced, unwritten store event', () => {
    const parse = heuristicQuickAdd('Add the festival from Ch. 4', ctx);
    expect(quickAddEvent(parse, ctx)).toMatchObject({
      id: 'event:test',
      timelineId: 'tl-1',
      name: 'Festival',
      when: 700200,
      chapter: 4,
      written: false,
      source: 'agent',
    });
  });
});
