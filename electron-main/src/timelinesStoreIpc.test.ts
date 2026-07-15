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
import { readTimelinesStore } from './timelines/store.js';
import type { TimelineEra, TimelineEvent, TimelineRow, TimelineSpan } from './timelines/model.js';

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tl-ipc-test-'));
}

describe('handleTimelinesGetStore', () => {
  it('returns seed store for a fresh vault', () => {
    const dir = makeTmp();
    const res = handleTimelinesGetStore(dir, {});
    expect(res.store.schemaVersion).toBe(1);
    expect(res.store.timelines.length).toBeGreaterThan(0);
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
    const onDisk = readTimelinesStore(dir);
    expect(onDisk.timelines.some((t) => t.name === 'Persisted')).toBe(true);
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
