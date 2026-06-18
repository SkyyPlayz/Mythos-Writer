// SKY-2463: Unit tests for timeline:list and timeline:upsert handler logic.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { emptyManifestV1 } from './vault/manifest/schema.js';
import { writeManifestV1 } from './vault/manifest/writer.js';
import type { ManifestSceneEntry, ManifestTimelineEntry } from './vault/manifest/types.js';
import { handleTimelineList, handleTimelineUpsert } from './timelineIpc.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-timeline-ipc-'));
}

function cleanDir(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function makeScene(id: string): ManifestSceneEntry {
  return {
    id,
    path: `scenes/${id}.md`,
    title: `Scene ${id}`,
    order: 0,
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
    writeManifestV1(manifestPath, emptyManifestV1(tmpDir));
    const result = handleTimelineList(manifestPath);
    expect(result.entries).toEqual([]);
    expect(result.sceneCount).toBe(0);
    expect(result.maxDay).toBe(0);
  });

  it('returns all timeline entries from the manifest', () => {
    const entry: ManifestTimelineEntry = {
      sceneId: 's1',
      inferredDay: 3,
      inferredTime: 'dawn',
      confidence: 0.8,
      rawCue: 'Day 3',
    };
    const manifest = { ...emptyManifestV1(tmpDir), timeline: [entry] };
    writeManifestV1(manifestPath, manifest);

    const result = handleTimelineList(manifestPath);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].sceneId).toBe('s1');
    expect(result.sceneCount).toBe(1);
  });

  it('computes maxDay from inferredDay when no userOverride', () => {
    const entries: ManifestTimelineEntry[] = [
      { sceneId: 's1', inferredDay: 2, inferredTime: 'morning', confidence: 0.7, rawCue: '' },
      { sceneId: 's2', inferredDay: 5, inferredTime: 'noon', confidence: 0.6, rawCue: '' },
      { sceneId: 's3', inferredDay: 1, inferredTime: 'dusk', confidence: 0.5, rawCue: '' },
    ];
    writeManifestV1(manifestPath, { ...emptyManifestV1(tmpDir), timeline: entries });

    const result = handleTimelineList(manifestPath);
    expect(result.maxDay).toBe(5);
  });

  it('prefers userOverride.day over inferredDay for maxDay', () => {
    const entries: ManifestTimelineEntry[] = [
      { sceneId: 's1', inferredDay: 2, inferredTime: 'morning', confidence: 0.7, rawCue: '', userOverride: { day: 10, time: 'night', setAt: '2026-01-01T00:00:00.000Z' } },
    ];
    writeManifestV1(manifestPath, { ...emptyManifestV1(tmpDir), timeline: entries });

    const result = handleTimelineList(manifestPath);
    expect(result.maxDay).toBe(10);
  });
});

// ─── handleTimelineUpsert ─────────────────────────────────────────────────────

describe('handleTimelineUpsert', () => {
  let tmpDir: string;
  let manifestPath: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    manifestPath = path.join(tmpDir, 'manifest.json');
    const manifest = { ...emptyManifestV1(tmpDir), scenes: [makeScene('scene-1'), makeScene('scene-2')] };
    writeManifestV1(manifestPath, manifest);
  });
  afterEach(() => { cleanDir(tmpDir); });

  it('saves a userOverride to the manifest for a valid scene', () => {
    const result = handleTimelineUpsert(manifestPath, { sceneId: 'scene-1', day: 3, time: 'morning' });
    expect(result.ok).toBe(true);
    expect(result.entry?.sceneId).toBe('scene-1');
    expect(result.entry?.userOverride?.day).toBe(3);
    expect(result.entry?.userOverride?.time).toBe('morning');

    // Verify persisted to disk
    const listed = handleTimelineList(manifestPath);
    expect(listed.entries).toHaveLength(1);
    expect(listed.entries[0].userOverride?.day).toBe(3);
  });

  it('preserves existing inferredDay/inferredTime when updating a scene that already has an entry', () => {
    const existing: ManifestTimelineEntry = {
      sceneId: 'scene-1',
      inferredDay: 7,
      inferredTime: 'dawn',
      confidence: 0.9,
      rawCue: 'Day 7',
    };
    const manifest = {
      ...emptyManifestV1(tmpDir),
      scenes: [makeScene('scene-1')],
      timeline: [existing],
    };
    writeManifestV1(manifestPath, manifest);

    const result = handleTimelineUpsert(manifestPath, { sceneId: 'scene-1', day: 2, time: 'dusk' });
    expect(result.ok).toBe(true);
    expect(result.entry?.inferredDay).toBe(7);
    expect(result.entry?.userOverride?.day).toBe(2);
    expect(result.entry?.userOverride?.time).toBe('dusk');
  });

  it('returns ok:false with error "scene not found" for unknown sceneId', () => {
    const result = handleTimelineUpsert(manifestPath, { sceneId: 'does-not-exist', day: 1, time: 'noon' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('scene not found');
    expect(result.entry).toBeUndefined();
  });

  it('rejects day < 1', () => {
    const result = handleTimelineUpsert(manifestPath, { sceneId: 'scene-1', day: 0, time: 'morning' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid day');
  });

  it('rejects day > 9999', () => {
    const result = handleTimelineUpsert(manifestPath, { sceneId: 'scene-1', day: 10000, time: 'morning' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid day');
  });

  it('rejects a non-integer day', () => {
    const result = handleTimelineUpsert(manifestPath, { sceneId: 'scene-1', day: 1.5, time: 'morning' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid day');
  });

  it('rejects an invalid time value', () => {
    const result = handleTimelineUpsert(manifestPath, { sceneId: 'scene-1', day: 1, time: 'invalid' as never });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid time');
  });

  it('multiple scenes can have independent overrides', () => {
    handleTimelineUpsert(manifestPath, { sceneId: 'scene-1', day: 1, time: 'dawn' });
    handleTimelineUpsert(manifestPath, { sceneId: 'scene-2', day: 4, time: 'dusk' });

    const listed = handleTimelineList(manifestPath);
    expect(listed.entries).toHaveLength(2);
    expect(listed.maxDay).toBe(4);
  });
});
