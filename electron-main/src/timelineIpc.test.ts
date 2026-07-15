// SKY-2463: Unit tests for timeline:list and timeline:upsert handler logic.
// SKY-6632: fixtures use the real legacy Manifest shape (vault.ts's
// defaultManifest/readManifest/writeManifest) — the shape every actual vault's
// manifest.json is written in — not the incompatible ManifestV1 structural schema.
//
// SKY-6306 / PR #914 unification: these channels are now compatibility views
// over the M21 TimelinesStore (timelines.json). Lists migrate legacy
// manifest.timeline data on first access; upserts persist into the store and
// leave manifest.timeline untouched (single source of truth).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { defaultManifest, readManifest, writeManifest } from './vault.js';
import type { Manifest, SceneEntry } from './ipc.js';
import type { ManifestTimelineEntry } from './vault/manifest/types.js';
import { handleTimelineList, handleTimelineUpsert } from './timelineIpc.js';
import { readTimelinesStore, TIMELINES_FILENAME } from './timelines/store.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-timeline-ipc-'));
}

function cleanDir(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function makeScene(id: string): SceneEntry {
  return {
    id,
    path: `scenes/${id}.md`,
    title: `Scene ${id}`,
    order: 0,
    blocks: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

// ─── handleTimelineList ───────────────────────────────────────────────────────

describe('handleTimelineList', () => {
  let tmpDir: string;
  let manifestPath: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    manifestPath = path.join(tmpDir, 'manifest.json');
  });
  afterEach(() => { cleanDir(tmpDir); });

  it('returns empty entries and zero aggregates for a fresh vault', () => {
    writeManifest(manifestPath, defaultManifest(tmpDir));
    const result = handleTimelineList(tmpDir);
    expect(result.entries).toEqual([]);
    expect(result.sceneCount).toBe(0);
    expect(result.maxDay).toBe(0);
  });

  // SKY-6632 regression: a real vault's manifest.json has `provenance` as an
  // OBJECT (Record<string,string>) and `boardReferences` (not `boards`), while
  // still self-declaring schemaVersion 1. Routing this through the ManifestV1
  // structural validator (which requires an array `provenance` + `boards`)
  // threw ManifestValidationError on every real vault. Assert it no longer does.
  it('does not throw on a real vault manifest shape (object provenance, boardReferences, no boards field)', () => {
    const manifest: Manifest = {
      ...defaultManifest(tmpDir),
      provenance: { 'sug-1': 'scenes/scene-1.md' },
      boardReferences: ['boards/board-1.json'],
    };
    expect('boards' in manifest).toBe(false);
    writeManifest(manifestPath, manifest);

    expect(() => handleTimelineList(tmpDir)).not.toThrow();
    const result = handleTimelineList(tmpDir);
    expect(result.entries).toEqual([]);
  });

  it('returns all timeline entries from a legacy manifest (first-access migration)', () => {
    const entry: ManifestTimelineEntry = {
      sceneId: 's1',
      inferredDay: 3,
      inferredTime: 'dawn',
      confidence: 0.8,
      rawCue: 'Day 3',
    };
    writeManifest(manifestPath, { ...defaultManifest(tmpDir), scenes: [makeScene('s1')], timeline: [entry] });

    const result = handleTimelineList(tmpDir);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toEqual(entry);
    expect(result.sceneCount).toBe(1);
    // The migration persisted the unified store.
    expect(fs.existsSync(path.join(tmpDir, TIMELINES_FILENAME))).toBe(true);
  });

  it('computes maxDay from inferredDay when no userOverride', () => {
    const entries: ManifestTimelineEntry[] = [
      { sceneId: 's1', inferredDay: 2, inferredTime: 'morning', confidence: 0.7, rawCue: '' },
      { sceneId: 's2', inferredDay: 5, inferredTime: 'noon', confidence: 0.6, rawCue: '' },
      { sceneId: 's3', inferredDay: 1, inferredTime: 'dusk', confidence: 0.5, rawCue: '' },
    ];
    writeManifest(manifestPath, { ...defaultManifest(tmpDir), timeline: entries });

    const result = handleTimelineList(tmpDir);
    expect(result.maxDay).toBe(5);
  });

  it('prefers userOverride.day over inferredDay for maxDay', () => {
    const entries: ManifestTimelineEntry[] = [
      { sceneId: 's1', inferredDay: 2, inferredTime: 'morning', confidence: 0.7, rawCue: '', userOverride: { day: 10, time: 'night', setAt: '2026-01-01T00:00:00.000Z' } },
    ];
    writeManifest(manifestPath, { ...defaultManifest(tmpDir), timeline: entries });

    const result = handleTimelineList(tmpDir);
    expect(result.maxDay).toBe(10);
  });

  it('never surfaces demo-seeded events through the legacy API', () => {
    // Fresh vault, no legacy data → the in-memory demo seed backs the store,
    // but its events carry no legacy entries and must not leak here.
    writeManifest(manifestPath, defaultManifest(tmpDir));
    const store = readTimelinesStore(tmpDir);
    expect(store.events.length).toBeGreaterThan(0); // demo events exist…
    expect(handleTimelineList(tmpDir).entries).toEqual([]); // …but not in the legacy view
  });
});

// ─── handleTimelineUpsert ─────────────────────────────────────────────────────

describe('handleTimelineUpsert', () => {
  let tmpDir: string;
  let manifestPath: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    manifestPath = path.join(tmpDir, 'manifest.json');
    const manifest = { ...defaultManifest(tmpDir), scenes: [makeScene('scene-1'), makeScene('scene-2')] };
    writeManifest(manifestPath, manifest);
  });
  afterEach(() => { cleanDir(tmpDir); });

  it('saves a userOverride for a valid scene and persists it to the unified store', () => {
    const result = handleTimelineUpsert(tmpDir, { sceneId: 'scene-1', day: 3, time: 'morning' });
    expect(result.ok).toBe(true);
    expect(result.entry?.sceneId).toBe('scene-1');
    expect(result.entry?.userOverride?.day).toBe(3);
    expect(result.entry?.userOverride?.time).toBe('morning');

    // Verify persisted to disk (round-trips through timelines.json)
    const listed = handleTimelineList(tmpDir);
    expect(listed.entries).toHaveLength(1);
    expect(listed.entries[0].userOverride?.day).toBe(3);

    // Single source of truth: the store carries the event with its legacy entry…
    const store = readTimelinesStore(tmpDir);
    const event = store.events.find((e) => e.sceneId === 'scene-1');
    expect(event).toBeDefined();
    expect(event!.legacy).toEqual(result.entry);
    expect(Number.isFinite(event!.when)).toBe(true);
  });

  it('does NOT write manifest.timeline (no dual-write) and preserves the manifest byte-for-byte', () => {
    const before = fs.readFileSync(manifestPath, 'utf-8');
    const result = handleTimelineUpsert(tmpDir, { sceneId: 'scene-1', day: 1, time: 'dawn' });
    expect(result.ok).toBe(true);

    expect(fs.readFileSync(manifestPath, 'utf-8')).toBe(before);
    expect(readManifest(manifestPath).timeline).toBeUndefined();
  });

  it('preserves existing inferredDay/inferredTime when updating a scene that already has an entry', () => {
    const existing: ManifestTimelineEntry = {
      sceneId: 'scene-1',
      inferredDay: 7,
      inferredTime: 'dawn',
      confidence: 0.9,
      rawCue: 'Day 7',
    };
    writeManifest(manifestPath, {
      ...defaultManifest(tmpDir),
      scenes: [makeScene('scene-1')],
      timeline: [existing],
    });

    const result = handleTimelineUpsert(tmpDir, { sceneId: 'scene-1', day: 2, time: 'dusk' });
    expect(result.ok).toBe(true);
    expect(result.entry?.inferredDay).toBe(7);
    expect(result.entry?.userOverride?.day).toBe(2);
    expect(result.entry?.userOverride?.time).toBe('dusk');
  });

  it('returns ok:false with error "scene not found" for unknown sceneId', () => {
    const result = handleTimelineUpsert(tmpDir, { sceneId: 'does-not-exist', day: 1, time: 'noon' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('scene not found');
    expect(result.entry).toBeUndefined();
  });

  it('rejects day < 1', () => {
    const result = handleTimelineUpsert(tmpDir, { sceneId: 'scene-1', day: 0, time: 'morning' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid day');
  });

  it('rejects day > 9999', () => {
    const result = handleTimelineUpsert(tmpDir, { sceneId: 'scene-1', day: 10000, time: 'morning' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid day');
  });

  it('rejects a non-integer day', () => {
    const result = handleTimelineUpsert(tmpDir, { sceneId: 'scene-1', day: 1.5, time: 'morning' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid day');
  });

  it('rejects an invalid time value', () => {
    const result = handleTimelineUpsert(tmpDir, { sceneId: 'scene-1', day: 1, time: 'invalid' as never });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid time');
  });

  it('multiple scenes can have independent overrides', () => {
    handleTimelineUpsert(tmpDir, { sceneId: 'scene-1', day: 1, time: 'dawn' });
    handleTimelineUpsert(tmpDir, { sceneId: 'scene-2', day: 4, time: 'dusk' });

    const listed = handleTimelineList(tmpDir);
    expect(listed.entries).toHaveLength(2);
    expect(listed.maxDay).toBe(4);
  });

  it('attaches the override to the migrated scene event instead of duplicating it', () => {
    const existing: ManifestTimelineEntry = {
      sceneId: 'scene-1', inferredDay: 7, inferredTime: 'dawn', confidence: 0.9, rawCue: 'Day 7',
    };
    writeManifest(manifestPath, {
      ...defaultManifest(tmpDir),
      scenes: [makeScene('scene-1')],
      timeline: [existing],
    });
    handleTimelineList(tmpDir); // triggers migration
    const migrated = readTimelinesStore(tmpDir).events.find((e) => e.sceneId === 'scene-1')!;

    handleTimelineUpsert(tmpDir, { sceneId: 'scene-1', day: 2, time: 'dusk' });
    const events = readTimelinesStore(tmpDir).events.filter((e) => e.sceneId === 'scene-1');
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(migrated.id);
    expect(events[0].when).not.toBe(migrated.when);
  });
});
