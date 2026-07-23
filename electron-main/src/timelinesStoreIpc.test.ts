import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  handleTimelinesGetStore,
  handleTimelinesUpsert,
  handleTimelinesSetActive,
  handleTimelinesUpsertItem,
  handleTimelinesDeleteItem,
} from './timelinesStoreIpc.js';
import { readTimelinesStore, TIMELINES_FILENAME } from './timelines/store.js';
import type { TimelineEra, TimelineEvent, TimelineRow, TimelineSpan, TimelineTensionPoint } from './timelines/model.js';

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tl-ipc-test-'));
}

describe('handleTimelinesGetStore', () => {
  it('returns the labelled demo seed store for a fresh vault', () => {
    const dir = makeTmp();
    const res = handleTimelinesGetStore(dir, {});
    expect(res.store.schemaVersion).toBe(1);
    expect(res.store.timelines.length).toBeGreaterThan(0);
    // Demo marker (owner ruling PR #914): every seeded timeline is labelled.
    expect(res.store.timelines.every((t) => t.source === 'seed')).toBe(true);
  });

  it('does not persist anything to disk on a pure read', () => {
    const dir = makeTmp();
    handleTimelinesGetStore(dir, {});
    expect(fs.existsSync(path.join(dir, TIMELINES_FILENAME))).toBe(false);
  });
});

describe('handleTimelinesUpsert', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmp(); });

  it('creates a new timeline and returns the updated store', () => {
    const res = handleTimelinesUpsert(dir, { name: 'New Arc', kind: 'custom' });
    expect(res.ok).toBe(true);
    expect(res.id).toBeTruthy();
    expect(res.store.timelines.some((t) => t.name === 'New Arc')).toBe(true);
  });

  it('updates an existing timeline by id', () => {
    const storeInitial = readTimelinesStore(dir);
    const id = storeInitial.timelines[0].id;
    const res = handleTimelinesUpsert(dir, { id, name: 'Renamed', kind: 'world' });
    expect(res.ok).toBe(true);
    expect(res.store.timelines.find((t) => t.id === id)?.name).toBe('Renamed');
  });

  it('returns ok=false when updating a non-existent id', () => {
    const res = handleTimelinesUpsert(dir, { id: 'does-not-exist', name: 'X', kind: 'story' });
    expect(res.ok).toBe(false);
  });

  it('persists the new timeline to disk', () => {
    handleTimelinesUpsert(dir, { name: 'Persisted', kind: 'universe' });
    expect(fs.existsSync(path.join(dir, TIMELINES_FILENAME))).toBe(true);
    const onDisk = readTimelinesStore(dir);
    expect(onDisk.timelines.some((t) => t.name === 'Persisted')).toBe(true);
  });

  it('labels user-created timelines source "manual" (distinct from the demo seed)', () => {
    const res = handleTimelinesUpsert(dir, { name: 'Mine', kind: 'custom' });
    expect(res.store.timelines.find((t) => t.id === res.id)?.source).toBe('manual');
  });
});

describe('handleTimelinesSetActive', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmp(); });

  it('sets the active timeline id', () => {
    const store = readTimelinesStore(dir);
    const target = store.timelines.find((t) => t.id !== store.activeTimelineId);
    if (!target) return; // seed has >1 timeline
    const res = handleTimelinesSetActive(dir, { timelineId: target.id });
    expect(res.ok).toBe(true);
    expect(res.store.activeTimelineId).toBe(target.id);
  });

  it('returns ok=false for an unknown timeline id', () => {
    const res = handleTimelinesSetActive(dir, { timelineId: 'ghost' });
    expect(res.ok).toBe(false);
  });
});

// ─── Beta 4 M22: Axis engine item persistence ───

describe('handleTimelinesUpsertItem', () => {
  let dir: string;
  let timelineId: string;
  beforeEach(() => {
    dir = makeTmp();
    timelineId = readTimelinesStore(dir).activeTimelineId;
  });

  it('inserts a new era and persists it', () => {
    const era: TimelineEra = { id: 'era:m22', timelineId, name: 'NEW ERA', startWhen: 10, endWhen: 20 };
    const res = handleTimelinesUpsertItem(dir, { type: 'era', item: era });
    expect(res.ok).toBe(true);
    expect(readTimelinesStore(dir).eras.some((e) => e.id === 'era:m22')).toBe(true);
  });

  it('replaces an existing item by id (drag-to-move persistence)', () => {
    const event: TimelineEvent = { id: 'ev:m22', timelineId, name: 'Battle', when: 2.4, source: 'manual' };
    handleTimelinesUpsertItem(dir, { type: 'event', item: event });
    const res = handleTimelinesUpsertItem(dir, { type: 'event', item: { ...event, when: 96.5 } });
    expect(res.ok).toBe(true);
    const onDisk = readTimelinesStore(dir).events.filter((e) => e.id === 'ev:m22');
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0].when).toBe(96.5);
  });

  it('upserts a span with an embed reference', () => {
    const store = readTimelinesStore(dir);
    const other = store.timelines.find((t) => t.id !== timelineId)!;
    const span: TimelineSpan = {
      id: 'span:m22', timelineId, name: 'World context', startWhen: 0, endWhen: 50, opensTimelineId: other.id,
    };
    expect(handleTimelinesUpsertItem(dir, { type: 'span', item: span }).ok).toBe(true);
  });

  it('upserts a custom row', () => {
    const row: TimelineRow = { id: 'row:m22', timelineId, name: 'MAGIC SATURATION', kind: 'custom' };
    const res = handleTimelinesUpsertItem(dir, { type: 'row', item: row });
    expect(res.ok).toBe(true);
    expect(res.store.rows.some((r) => r.id === 'row:m22')).toBe(true);
  });

  it('rejects NaN whens instead of corrupting the store (§8.2)', () => {
    const era = { id: 'era:nan', timelineId, name: 'X', startWhen: NaN, endWhen: 20 } as TimelineEra;
    const res = handleTimelinesUpsertItem(dir, { type: 'era', item: era });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    expect(readTimelinesStore(dir).eras.some((e) => e.id === 'era:nan')).toBe(false);
  });

  it('rejects spans that end before they start', () => {
    const span = { id: 'span:bad', timelineId, name: 'X', startWhen: 50, endWhen: 10 } as TimelineSpan;
    expect(handleTimelinesUpsertItem(dir, { type: 'span', item: span }).ok).toBe(false);
  });

  it('rejects items pointing at a missing timeline', () => {
    const era = { id: 'era:ghost', timelineId: 'ghost', name: 'X', startWhen: 0, endWhen: 1 } as TimelineEra;
    expect(handleTimelinesUpsertItem(dir, { type: 'era', item: era }).ok).toBe(false);
  });

  it('rejects unknown item types and off-grid whens', () => {
    const era: TimelineEra = { id: 'e', timelineId, name: 'X', startWhen: 0, endWhen: 1 };
    expect(handleTimelinesUpsertItem(dir, { type: 'nope' as never, item: era }).ok).toBe(false);
    const ev = { id: 'ev:offgrid', timelineId, name: 'X', when: 0.123 } as TimelineEvent;
    expect(handleTimelinesUpsertItem(dir, { type: 'event', item: ev }).ok).toBe(false);
  });
});

describe('handleTimelinesDeleteItem', () => {
  let dir: string;
  let timelineId: string;
  beforeEach(() => {
    dir = makeTmp();
    timelineId = readTimelinesStore(dir).activeTimelineId;
  });

  it('deletes an item by id', () => {
    const era: TimelineEra = { id: 'era:del', timelineId, name: 'GONE', startWhen: 0, endWhen: 5 };
    handleTimelinesUpsertItem(dir, { type: 'era', item: era });
    const res = handleTimelinesDeleteItem(dir, { type: 'era', id: 'era:del' });
    expect(res.ok).toBe(true);
    expect(readTimelinesStore(dir).eras.some((e) => e.id === 'era:del')).toBe(false);
  });

  it('returns ok=false for a missing item', () => {
    expect(handleTimelinesDeleteItem(dir, { type: 'event', id: 'ghost' }).ok).toBe(false);
  });

  it('deleting a custom row removes its plotted spans and detaches events', () => {
    const row: TimelineRow = { id: 'row:del', timelineId, name: 'SEASONS', kind: 'custom' };
    handleTimelinesUpsertItem(dir, { type: 'row', item: row });
    const span: TimelineSpan = { id: 'span:onrow', timelineId, name: 'Winter', startWhen: 0, endWhen: 10, rowId: 'row:del' };
    handleTimelinesUpsertItem(dir, { type: 'span', item: span });
    const event: TimelineEvent = { id: 'ev:onrow', timelineId, name: 'Solstice', when: 5, rowId: 'row:del' };
    handleTimelinesUpsertItem(dir, { type: 'event', item: event });

    const res = handleTimelinesDeleteItem(dir, { type: 'row', id: 'row:del' });
    expect(res.ok).toBe(true);
    const onDisk = readTimelinesStore(dir);
    expect(onDisk.spans.some((s) => s.id === 'span:onrow')).toBe(false);
    const detached = onDisk.events.find((e) => e.id === 'ev:onrow');
    expect(detached).toBeTruthy();
    expect(detached?.rowId).toBeUndefined();
  });
});

// ─── Beta 4 M23: plotline rows + story-lane event fields ───

describe('M23 — plotline rows and story-lane event fields', () => {
  let dir: string;
  let timelineId: string;
  beforeEach(() => {
    dir = makeTmp();
    timelineId = readTimelinesStore(dir).activeTimelineId;
  });

  it('upserts a plotline row with a color', () => {
    const row: TimelineRow = { id: 'row:pl', timelineId, name: 'Main Plot', kind: 'plotline', color: '#00f0ff' };
    const res = handleTimelinesUpsertItem(dir, { type: 'row', item: row });
    expect(res.ok).toBe(true);
    const onDisk = readTimelinesStore(dir).rows.find((r) => r.id === 'row:pl');
    expect(onDisk?.kind).toBe('plotline');
    expect(onDisk?.color).toBe('#00f0ff');
  });

  it('persists plotline cards (chapter/beat/summary/icon) round-trip', () => {
    const row: TimelineRow = { id: 'row:pl2', timelineId, name: 'Save the Cat', kind: 'plotline' };
    handleTimelinesUpsertItem(dir, { type: 'row', item: row });
    const card: TimelineEvent = {
      id: 'ev:beat', timelineId, name: 'Opening Image', when: 2.4,
      rowId: 'row:pl2', chapter: 1, beat: true, written: false,
      summary: 'Save the Cat beat — replace with your scene.', icon: '✦',
      source: 'manual',
    };
    const res = handleTimelinesUpsertItem(dir, { type: 'event', item: card });
    expect(res.ok).toBe(true);
    const onDisk = readTimelinesStore(dir).events.find((e) => e.id === 'ev:beat');
    expect(onDisk).toMatchObject({
      chapter: 1, beat: true, written: false, icon: '✦',
      summary: 'Save the Cat beat — replace with your scene.',
    });
  });

  it('rejects malformed story-lane fields (NaN chapter, non-bool beat)', () => {
    const bad1 = { id: 'ev:badch', timelineId, name: 'X', when: 1, chapter: NaN } as TimelineEvent;
    expect(handleTimelinesUpsertItem(dir, { type: 'event', item: bad1 }).ok).toBe(false);
    const bad2 = { id: 'ev:badch2', timelineId, name: 'X', when: 1, chapter: 0 } as TimelineEvent;
    expect(handleTimelinesUpsertItem(dir, { type: 'event', item: bad2 }).ok).toBe(false);
    const bad3 = { id: 'ev:badbeat', timelineId, name: 'X', when: 1, beat: 'yes' } as unknown as TimelineEvent;
    expect(handleTimelinesUpsertItem(dir, { type: 'event', item: bad3 }).ok).toBe(false);
    expect(readTimelinesStore(dir).events.some((e) => e.id.startsWith('ev:bad'))).toBe(false);
  });

  it('deleting a plotline row deletes its cards outright', () => {
    const row: TimelineRow = { id: 'row:pl3', timelineId, name: 'Main Plot', kind: 'plotline' };
    handleTimelinesUpsertItem(dir, { type: 'row', item: row });
    const card: TimelineEvent = { id: 'ev:card', timelineId, name: 'Beat', when: 5, rowId: 'row:pl3', beat: true };
    handleTimelinesUpsertItem(dir, { type: 'event', item: card });

    const res = handleTimelinesDeleteItem(dir, { type: 'row', id: 'row:pl3' });
    expect(res.ok).toBe(true);
    const onDisk = readTimelinesStore(dir);
    expect(onDisk.rows.some((r) => r.id === 'row:pl3')).toBe(false);
    // Cards are deleted, not orphaned into the KEY EVENTS row.
    expect(onDisk.events.some((e) => e.id === 'ev:card')).toBe(false);
  });

  it('still rejects unknown row kinds', () => {
    const row = { id: 'row:bad', timelineId, name: 'X', kind: 'nonsense' } as unknown as TimelineRow;
    expect(handleTimelinesUpsertItem(dir, { type: 'row', item: row }).ok).toBe(false);
  });

  // ── M25 (§8.6) — Inspector event-editor fields ──

  it('persists pov/location/impact and the agent source round-trip (M25)', () => {
    const event: TimelineEvent = {
      id: 'ev:m25', timelineId, name: 'The Festival', when: 12.5,
      pov: 'Kael', location: 'Veynn', impact: 'War begins, The city falls',
      source: 'agent',
    };
    const res = handleTimelinesUpsertItem(dir, { type: 'event', item: event });
    expect(res.ok).toBe(true);
    const onDisk = readTimelinesStore(dir).events.find((e) => e.id === 'ev:m25');
    expect(onDisk).toMatchObject({
      pov: 'Kael', location: 'Veynn', impact: 'War begins, The city falls', source: 'agent',
    });
  });

  it('rejects non-string pov/location/impact (M25)', () => {
    const bad1 = { id: 'ev:badpov', timelineId, name: 'X', when: 1, pov: 7 } as unknown as TimelineEvent;
    expect(handleTimelinesUpsertItem(dir, { type: 'event', item: bad1 }).ok).toBe(false);
    const bad2 = { id: 'ev:badloc', timelineId, name: 'X', when: 1, location: [] } as unknown as TimelineEvent;
    expect(handleTimelinesUpsertItem(dir, { type: 'event', item: bad2 }).ok).toBe(false);
    const bad3 = { id: 'ev:badimp', timelineId, name: 'X', when: 1, impact: { t: 'x' } } as unknown as TimelineEvent;
    expect(handleTimelinesUpsertItem(dir, { type: 'event', item: bad3 }).ok).toBe(false);
    expect(readTimelinesStore(dir).events.some((e) => e.id.startsWith('ev:bad'))).toBe(false);
  });
});

// ─── Beta 4 M24: Tension mode's per-chapter tension points ───

describe('handleTimelinesUpsertItem — tensionPoint (M24)', () => {
  let dir: string;
  let timelineId: string;
  beforeEach(() => {
    dir = makeTmp();
    timelineId = readTimelinesStore(dir).activeTimelineId;
  });

  it('creates a new tension point and persists it', () => {
    const item: TimelineTensionPoint = { id: 'tension:1', timelineId, chapter: 1, value: 42 };
    const res = handleTimelinesUpsertItem(dir, { type: 'tensionPoint', item });
    expect(res.ok).toBe(true);
    expect(res.store.tensionPoints?.some((p) => p.id === 'tension:1' && p.value === 42)).toBe(true);
    expect(readTimelinesStore(dir).tensionPoints?.some((p) => p.id === 'tension:1')).toBe(true);
  });

  it('updates an existing tension point by id in place', () => {
    const item: TimelineTensionPoint = { id: 'tension:1', timelineId, chapter: 1, value: 42 };
    handleTimelinesUpsertItem(dir, { type: 'tensionPoint', item });
    const res = handleTimelinesUpsertItem(dir, { type: 'tensionPoint', item: { ...item, value: 90 } });
    expect(res.ok).toBe(true);
    expect(res.store.tensionPoints?.length).toBe(1);
    expect(res.store.tensionPoints?.[0].value).toBe(90);
  });

  it('rejects chapter < 1 and non-finite values', () => {
    const bad1 = { id: 'tension:bad1', timelineId, chapter: 0, value: 50 } as TimelineTensionPoint;
    expect(handleTimelinesUpsertItem(dir, { type: 'tensionPoint', item: bad1 }).ok).toBe(false);
    const bad2 = { id: 'tension:bad2', timelineId, chapter: 1, value: Number.NaN } as TimelineTensionPoint;
    expect(handleTimelinesUpsertItem(dir, { type: 'tensionPoint', item: bad2 }).ok).toBe(false);
  });

  it('rejects a value outside 0-100', () => {
    const bad = { id: 'tension:bad3', timelineId, chapter: 1, value: 101 } as TimelineTensionPoint;
    expect(handleTimelinesUpsertItem(dir, { type: 'tensionPoint', item: bad }).ok).toBe(false);
    const bad2 = { id: 'tension:bad4', timelineId, chapter: 1, value: -1 } as TimelineTensionPoint;
    expect(handleTimelinesUpsertItem(dir, { type: 'tensionPoint', item: bad2 }).ok).toBe(false);
  });

  it('rejects an item with no `name` field cleanly (tensionPoint has none by design)', () => {
    // Guards against a future regression re-adding the blanket name check.
    const item: TimelineTensionPoint = { id: 'tension:1', timelineId, chapter: 1, value: 50 };
    expect('name' in item).toBe(false);
    expect(handleTimelinesUpsertItem(dir, { type: 'tensionPoint', item }).ok).toBe(true);
  });

  it('deletes a tension point', () => {
    const item: TimelineTensionPoint = { id: 'tension:1', timelineId, chapter: 1, value: 50 };
    handleTimelinesUpsertItem(dir, { type: 'tensionPoint', item });
    const res = handleTimelinesDeleteItem(dir, { type: 'tensionPoint', id: 'tension:1' });
    expect(res.ok).toBe(true);
    expect(res.store.tensionPoints?.some((p) => p.id === 'tension:1')).toBe(false);
  });

  it('is additive on a pre-M24 store missing `tensionPoints` entirely', () => {
    const store = readTimelinesStore(dir);
    delete (store as { tensionPoints?: unknown }).tensionPoints;
    fs.writeFileSync(path.join(dir, TIMELINES_FILENAME), JSON.stringify(store, null, 2));
    const item: TimelineTensionPoint = { id: 'tension:1', timelineId, chapter: 1, value: 50 };
    const res = handleTimelinesUpsertItem(dir, { type: 'tensionPoint', item });
    expect(res.ok).toBe(true);
    expect(res.store.tensionPoints).toEqual([item]);
  });
});
