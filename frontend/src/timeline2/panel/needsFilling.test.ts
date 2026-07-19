// Beta 4 M25 — NEEDS FILLING OUT gap detection (§8.6).
import { describe, it, expect } from 'vitest';
import type { TimelinesStore } from '../../timelinesTypes';
import { THEME_LANE, WORLD_LANE } from '../axis/storyLanes';
import { needsFillingOut } from './needsFilling';

const base: TimelinesStore = {
  schemaVersion: 1,
  activeTimelineId: 'tl-1',
  timelines: [
    {
      id: 'tl-1', name: 'Story', kind: 'story', axis: 'calendar',
      calendar: { preset: 'standard', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 },
      createdAt: '', updatedAt: '',
    },
  ],
  eras: [], spans: [],
  rows: [{ id: 'pl-1', timelineId: 'tl-1', name: 'Main', kind: 'plotline' }],
  events: [],
};

describe('needsFillingOut (§8.6)', () => {
  it('flags blank-summary key events, template beats and thin world events', () => {
    const store: TimelinesStore = {
      ...base,
      events: [
        { id: 'ev-blank', timelineId: 'tl-1', name: 'The Fall', when: 1 },
        { id: 'ev-beat', timelineId: 'tl-1', name: 'Midpoint', when: 2, rowId: 'pl-1', beat: true },
        { id: 'ev-world', timelineId: 'tl-1', name: 'Eclipse', when: 3, rowId: WORLD_LANE, summary: 'short' },
        { id: 'ev-good', timelineId: 'tl-1', name: 'The Rise', when: 4, summary: 'A complete two-line description of the event.' },
        { id: 'ev-theme', timelineId: 'tl-1', name: 'Loss', when: 5, rowId: THEME_LANE },
      ],
    };
    const items = needsFillingOut(store, 'tl-1');
    const ids = items.map((i) => i.id);
    expect(ids).toContain('ev-blank');
    expect(ids).toContain('ev-beat');
    expect(ids).toContain('ev-world');
    expect(ids).not.toContain('ev-good');
    expect(ids).not.toContain('ev-theme');
  });

  it('ignores other timelines and caps the list at 8', () => {
    const store: TimelinesStore = {
      ...base,
      events: [
        { id: 'other', timelineId: 'tl-2', name: 'Elsewhere', when: 1 },
        ...Array.from({ length: 12 }, (_, i) => ({
          id: `ev-${i}`, timelineId: 'tl-1', name: `E${i}`, when: i,
        })),
      ],
    };
    const items = needsFillingOut(store, 'tl-1');
    expect(items).toHaveLength(8);
    expect(items.every((i) => i.id.startsWith('ev-'))).toBe(true);
  });

  it('returns [] when everything has substance', () => {
    const store: TimelinesStore = {
      ...base,
      events: [
        { id: 'ev-good', timelineId: 'tl-1', name: 'The Rise', when: 4, summary: 'A complete two-line description of the event.' },
      ],
    };
    expect(needsFillingOut(store, 'tl-1')).toEqual([]);
  });
});
