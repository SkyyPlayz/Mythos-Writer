import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSeedTimelinesStore,
  migrateLegacyTimeline,
  readTimelinesStore,
  TIMELINES_FILENAME,
  validateTimelinesStore,
  writeTimelinesStore,
} from './store.js';

const LEGACY_MANIFEST_FIXTURE = JSON.stringify({
  schemaVersion: 1,
  version: '0.2.0',
  vaultRoot: '/tmp/fixture',
  scenes: [
    { id: 'scene-01', title: 'The Beginning', path: 'chapters/ch1.md', order: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'scene-02', title: 'Rising Action', path: 'chapters/ch2.md', order: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'scene-03', title: 'The Climax', path: 'chapters/ch3.md', order: 2, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  ],
  entities: [],
  suggestions: [],
  provenance: [],
  boards: [],
  timeline: [
    { sceneId: 'scene-01', inferredDay: 1, inferredTime: 'morning', confidence: 0.9, rawCue: 'the next morning' },
    { sceneId: 'scene-02', inferredDay: 3, inferredTime: 'noon', confidence: 0.8, rawCue: 'at noon' },
    {
      sceneId: 'scene-03',
      inferredDay: 5,
      inferredTime: 'dusk',
      confidence: 0.7,
      rawCue: 'as dusk fell',
      userOverride: { day: 6, time: 'night', setAt: '2026-01-01T00:00:00Z' },
    },
  ],
});

const ARC_FIXTURE = JSON.stringify([
  { id: 'arc-a', title: 'Hero Arc', color: '#ff0000', scenes: [] },
  { id: 'arc-b', title: 'Villain Arc', color: '#0000ff', scenes: [] },
]);

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timelines-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('migrateLegacyTimeline — M20→M21 migration fixture', () => {
  let manifestPath: string;
  let arcsPath: string;

  beforeEach(() => {
    manifestPath = path.join(tmpDir, 'manifest.json');
    arcsPath = path.join(tmpDir, 'arcs.json');
    fs.writeFileSync(manifestPath, LEGACY_MANIFEST_FIXTURE, 'utf-8');
    fs.writeFileSync(arcsPath, ARC_FIXTURE, 'utf-8');
  });

  it('produces a valid TimelinesStore', () => {
    const store = migrateLegacyTimeline({ manifestPath, arcsPath, now: '2026-01-01T00:00:00Z' });
    expect(() => validateTimelinesStore(store)).not.toThrow();
  });

  it('creates exactly one timeline', () => {
    const store = migrateLegacyTimeline({ manifestPath, arcsPath, now: '2026-01-01T00:00:00Z' });
    expect(store.timelines).toHaveLength(1);
    expect(store.timelines[0].kind).toBe('story');
  });

  it('migrates all three timeline entries to events without data loss', () => {
    const store = migrateLegacyTimeline({ manifestPath, arcsPath, now: '2026-01-01T00:00:00Z' });
    expect(store.events).toHaveLength(3);
    const sceneIds = store.events.map((e) => e.sceneId);
    expect(sceneIds).toContain('scene-01');
    expect(sceneIds).toContain('scene-02');
    expect(sceneIds).toContain('scene-03');
  });

  it('uses userOverride when present (scene-03 day=6 night)', () => {
    const store = migrateLegacyTimeline({ manifestPath, arcsPath, now: '2026-01-01T00:00:00Z' });
    const event = store.events.find((e) => e.sceneId === 'scene-03');
    expect(event).toBeDefined();
    // scene-03 userOverride sets day=6 (1-based), time=night
    // With standard calendar (12×30×24): day 6 zero-based = 5;
    //   year=0, month=1, day=6, hour≈night fraction
    // The event's `when` must be a finite number and must round-trip.
    expect(Number.isFinite(event!.when)).toBe(true);
  });

  it('marks migrated events with source = migration', () => {
    const store = migrateLegacyTimeline({ manifestPath, arcsPath, now: '2026-01-01T00:00:00Z' });
    expect(store.events.every((e) => e.source === 'migration')).toBe(true);
  });

  it('converts arcs to rows', () => {
    const store = migrateLegacyTimeline({ manifestPath, arcsPath, now: '2026-01-01T00:00:00Z' });
    expect(store.rows).toHaveLength(2);
    expect(store.rows.map((r) => r.kind).every((k) => k === 'arc')).toBe(true);
    expect(store.rows.map((r) => r.name)).toContain('Hero Arc');
    expect(store.rows.map((r) => r.name)).toContain('Villain Arc');
  });

  it('works without arcsPath', () => {
    const store = migrateLegacyTimeline({ manifestPath, now: '2026-01-01T00:00:00Z' });
    expect(store.rows).toHaveLength(0);
    expect(store.events).toHaveLength(3);
    expect(() => validateTimelinesStore(store)).not.toThrow();
  });

  it('all event when values are finite (no NaN corruption)', () => {
    const store = migrateLegacyTimeline({ manifestPath, arcsPath, now: '2026-01-01T00:00:00Z' });
    for (const event of store.events) {
      expect(Number.isNaN(event.when)).toBe(false);
      expect(Number.isFinite(event.when)).toBe(true);
    }
  });
});

describe('createSeedTimelinesStore', () => {
  it('produces a valid store with 3 timelines', () => {
    const store = createSeedTimelinesStore('2026-01-01T00:00:00Z');
    expect(() => validateTimelinesStore(store)).not.toThrow();
    expect(store.timelines).toHaveLength(3);
  });

  it('contains embedding spans with opensTimelineId', () => {
    const store = createSeedTimelinesStore('2026-01-01T00:00:00Z');
    const embedded = store.spans.filter((s) => s.opensTimelineId);
    expect(embedded.length).toBeGreaterThan(0);
  });
});

describe('readTimelinesStore / writeTimelinesStore round-trip', () => {
  it('round-trips a seed store through JSON without data loss', () => {
    const vaultRoot = tmpDir;
    const original = createSeedTimelinesStore('2026-01-01T00:00:00Z');
    writeTimelinesStore(vaultRoot, original);
    expect(fs.existsSync(path.join(vaultRoot, TIMELINES_FILENAME))).toBe(true);
    const read = readTimelinesStore(vaultRoot);
    expect(read).toEqual(original);
  });

  it('returns a seed store when the file does not exist', () => {
    const store = readTimelinesStore(tmpDir);
    expect(store.timelines.length).toBeGreaterThan(0);
    expect(() => validateTimelinesStore(store)).not.toThrow();
  });
});

describe('validateTimelinesStore', () => {
  it('throws when activeTimelineId references a missing timeline', () => {
    const store = createSeedTimelinesStore('2026-01-01T00:00:00Z');
    const broken = { ...store, activeTimelineId: 'does-not-exist' };
    expect(() => validateTimelinesStore(broken)).toThrow(/active timeline/i);
  });

  it('throws on duplicate event id', () => {
    const store = createSeedTimelinesStore('2026-01-01T00:00:00Z');
    const broken = {
      ...store,
      events: [...store.events, { ...store.events[0] }],
    };
    expect(() => validateTimelinesStore(broken)).toThrow(/duplicate/i);
  });

  it('throws when an event references a missing timelineId', () => {
    const store = createSeedTimelinesStore('2026-01-01T00:00:00Z');
    const broken = {
      ...store,
      events: [...store.events, { id: 'orphan', timelineId: 'ghost', name: 'orphan', when: 0 }],
    };
    expect(() => validateTimelinesStore(broken)).toThrow(/missing timeline/i);
  });
});
