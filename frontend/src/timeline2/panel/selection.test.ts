// Beta 4 M25 — selection → Inspector editor resolution (§8.6).
import { describe, it, expect } from 'vitest';
import type { TimelinesStore } from '../../timelinesTypes';
import { ARC_LANE, CHARACTER_LANE, THEME_LANE, WORLD_LANE } from '../axis/storyLanes';
import { resolveInspectorTarget } from './selection';

const store: TimelinesStore = {
  schemaVersion: 1,
  activeTimelineId: 'tl-1',
  timelines: [
    {
      id: 'tl-1', name: 'Story', kind: 'story', axis: 'calendar',
      calendar: { preset: 'standard', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 },
      createdAt: '', updatedAt: '',
    },
  ],
  eras: [{ id: 'era-1', timelineId: 'tl-1', name: 'DAWN', startWhen: 0, endWhen: 100 }],
  spans: [
    { id: 'span-main', timelineId: 'tl-1', name: 'Book One', startWhen: 0, endWhen: 50 },
    { id: 'span-arc', timelineId: 'tl-1', name: 'Arc I', startWhen: 0, endWhen: 30, rowId: ARC_LANE },
    { id: 'span-char', timelineId: 'tl-1', name: 'Kael', startWhen: 0, endWhen: 90, rowId: CHARACTER_LANE },
    { id: 'span-crow', timelineId: 'tl-1', name: 'Storm', startWhen: 5, endWhen: 15, rowId: 'row-custom' },
  ],
  rows: [
    { id: 'row-custom', timelineId: 'tl-1', name: 'WEATHER', kind: 'custom' },
    { id: 'row-plot', timelineId: 'tl-1', name: 'Main plot', kind: 'plotline' },
  ],
  events: [
    { id: 'ev-key', timelineId: 'tl-1', name: 'The Fall', when: 10 },
    { id: 'ev-world', timelineId: 'tl-1', name: 'Eclipse', when: 20, rowId: WORLD_LANE },
    { id: 'ev-theme', timelineId: 'tl-1', name: 'Loss', when: 30, rowId: THEME_LANE },
    { id: 'ev-card', timelineId: 'tl-1', name: 'Setup scene', when: 5, rowId: 'row-plot' },
  ],
};

describe('resolveInspectorTarget (§8.6)', () => {
  it('returns null for no selection and for deleted ids', () => {
    expect(resolveInspectorTarget(store, null)).toBeNull();
    expect(resolveInspectorTarget(store, { type: 'event', id: 'gone' })).toBeNull();
    expect(resolveInspectorTarget(store, { type: 'span', id: 'gone' })).toBeNull();
    expect(resolveInspectorTarget(store, { type: 'era', id: 'gone' })).toBeNull();
  });

  it('eras resolve to the lane editor with the Era kind label', () => {
    const t = resolveInspectorTarget(store, { type: 'era', id: 'era-1' });
    expect(t).toMatchObject({ editor: 'lane', variant: 'era', kindLabel: 'Era' });
  });

  it('spans resolve by their sentinel lane: main / arc / journey / custom', () => {
    expect(resolveInspectorTarget(store, { type: 'span', id: 'span-main' })).toMatchObject({
      editor: 'lane', variant: 'span', kindLabel: 'Timeline span',
    });
    expect(resolveInspectorTarget(store, { type: 'span', id: 'span-arc' })).toMatchObject({
      editor: 'lane', variant: 'arc', kindLabel: 'Story arc',
    });
    expect(resolveInspectorTarget(store, { type: 'span', id: 'span-char' })).toMatchObject({
      editor: 'lane', variant: 'journey', kindLabel: 'Character journey',
    });
    expect(resolveInspectorTarget(store, { type: 'span', id: 'span-crow' })).toMatchObject({
      editor: 'lane', variant: 'custom', kindLabel: 'Custom row item',
    });
  });

  it('events split into key-event editor, card editor, and world/theme lanes', () => {
    expect(resolveInspectorTarget(store, { type: 'event', id: 'ev-key' })).toMatchObject({
      editor: 'event',
    });
    expect(resolveInspectorTarget(store, { type: 'event', id: 'ev-card' })).toMatchObject({
      editor: 'card',
    });
    expect(resolveInspectorTarget(store, { type: 'event', id: 'ev-world' })).toMatchObject({
      editor: 'lane', variant: 'world', kindLabel: 'World event',
    });
    expect(resolveInspectorTarget(store, { type: 'event', id: 'ev-theme' })).toMatchObject({
      editor: 'lane', variant: 'theme', kindLabel: 'Theme',
    });
  });

  it('an event on a non-plotline row is still a plain event, not a card', () => {
    const withEntityRow: TimelinesStore = {
      ...store,
      rows: [...store.rows, { id: 'row-ent', timelineId: 'tl-1', name: 'NPCs', kind: 'entity' }],
      events: [...store.events, { id: 'ev-ent', timelineId: 'tl-1', name: 'Cameo', when: 1, rowId: 'row-ent' }],
    };
    expect(resolveInspectorTarget(withEntityRow, { type: 'event', id: 'ev-ent' })).toMatchObject({
      editor: 'event',
    });
  });
});
