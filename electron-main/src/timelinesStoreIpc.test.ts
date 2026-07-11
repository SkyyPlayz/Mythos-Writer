import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  handleTimelinesGetStore,
  handleTimelinesUpsert,
  handleTimelinesSetActive,
} from './timelinesStoreIpc.js';
import { readTimelinesStore } from './timelines/store.js';

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
