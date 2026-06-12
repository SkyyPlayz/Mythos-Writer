// Unit tests for SKY-791: timeline data model + persistence
// Covers IPC handler logic and storage round-trips without Electron mocks.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  readTimelineSettings,
  writeTimelineSettings,
  readArcManifest,
  writeArcManifest,
  writeSceneFile,
  readSceneFile,
  DEFAULT_TIMELINE_SETTINGS,
} from './vault.js';
import type { TimelineSettings, ArcEntry } from './ipc.js';

// ─── Helpers ───

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-timeline-'));
}

function cleanDir(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ─── TimelineSettings round-trips ───

describe('readTimelineSettings', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { cleanDir(tmpDir); });

  it('returns defaults when no settings file exists', () => {
    const s = readTimelineSettings(tmpDir);
    expect(s).toEqual(DEFAULT_TIMELINE_SETTINGS);
  });

  it('returns defaults when file is corrupt JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'timeline-settings.json'), '{bad json}', 'utf-8');
    const s = readTimelineSettings(tmpDir);
    expect(s).toEqual(DEFAULT_TIMELINE_SETTINGS);
  });

  it('merges partial settings with defaults', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'timeline-settings.json'),
      JSON.stringify({ primaryGrouping: 'chapter', showUndatedScenes: false }),
      'utf-8',
    );
    const s = readTimelineSettings(tmpDir);
    expect(s.primaryGrouping).toBe('chapter');
    expect(s.showUndatedScenes).toBe(false);
    expect(s.spacingMode).toBe(DEFAULT_TIMELINE_SETTINGS.spacingMode);
    expect(s.autoLayoutTracks).toBe(DEFAULT_TIMELINE_SETTINGS.autoLayoutTracks);
  });
});

describe('writeTimelineSettings / readTimelineSettings round-trip', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { cleanDir(tmpDir); });

  it('persists and restores all fields', () => {
    const settings: TimelineSettings = {
      primaryGrouping: 'character',
      spacingMode: 'proportional',
      showUndatedScenes: false,
      autoLayoutTracks: false,
      defaultColorScheme: 'monochrome',
      visibleTrackFilters: ['arc-1', 'arc-2'],
      viewportPreference: { zoom: 1.5, offsetX: 100, offsetY: -50 },
    };
    writeTimelineSettings(tmpDir, settings);
    const restored = readTimelineSettings(tmpDir);
    expect(restored).toEqual(settings);
  });

  it('writes valid JSON to disk', () => {
    writeTimelineSettings(tmpDir, DEFAULT_TIMELINE_SETTINGS);
    const raw = fs.readFileSync(path.join(tmpDir, 'timeline-settings.json'), 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});

// ─── Arc manifest round-trips ───

describe('readArcManifest', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { cleanDir(tmpDir); });

  it('returns empty array when no arcs file exists', () => {
    expect(readArcManifest(tmpDir)).toEqual([]);
  });

  it('returns empty array when file is corrupt JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'arcs.json'), '{bad}', 'utf-8');
    expect(readArcManifest(tmpDir)).toEqual([]);
  });
});

describe('writeArcManifest / readArcManifest round-trip', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { cleanDir(tmpDir); });

  it('persists and restores arc entries', () => {
    const now = new Date().toISOString();
    const arcs: ArcEntry[] = [
      { id: 'arc-1', title: 'Hero Journey', color: 'var(--neon-cyan)', colorIsCustom: false, scenes: ['s1', 's2'], createdAt: now, updatedAt: now },
      { id: 'arc-2', title: 'Villain Rise', color: '#ff4dff', colorIsCustom: true, scenes: ['s3'], createdAt: now, updatedAt: now },
    ];
    writeArcManifest(tmpDir, arcs);
    const restored = readArcManifest(tmpDir);
    expect(restored).toHaveLength(2);
    expect(restored[0].id).toBe('arc-1');
    expect(restored[1].colorIsCustom).toBe(true);
  });

  it('overwrites previous arc data on write', () => {
    const now = new Date().toISOString();
    const arcs: ArcEntry[] = [
      { id: 'arc-1', title: 'Old', color: '#fff', colorIsCustom: false, scenes: [], createdAt: now, updatedAt: now },
    ];
    writeArcManifest(tmpDir, arcs);
    arcs[0] = { ...arcs[0], color: 'var(--neon-magenta)', colorIsCustom: true };
    writeArcManifest(tmpDir, arcs);
    const restored = readArcManifest(tmpDir);
    expect(restored[0].color).toBe('var(--neon-magenta)');
    expect(restored[0].colorIsCustom).toBe(true);
  });
});

// ─── Scene timeline metadata frontmatter round-trips ───

describe('scene chronologicalTime frontmatter round-trip', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    fs.mkdirSync(path.join(tmpDir, 'Manuscript'), { recursive: true });
  });
  afterEach(() => { cleanDir(tmpDir); });

  it('writes and reads chronologicalDate fields', () => {
    writeSceneFile(tmpDir, 'Manuscript/scene1.md', {
      id: 'sc-1',
      title: 'Scene One',
      prose: 'Content here.',
      chronologicalDate: '2340-06-15',
      chronologicalIsEstimated: true,
      chronologicalConfidence: 0.7,
      chronologicalSource: 'explicit_marker',
    });
    const data = readSceneFile(tmpDir, 'Manuscript/scene1.md');
    expect(data.chronologicalDate).toBe('2340-06-15');
    expect(data.chronologicalIsEstimated).toBe(true);
    expect(data.chronologicalConfidence).toBeCloseTo(0.7);
    expect(data.chronologicalSource).toBe('explicit_marker');
  });

  it('returns undefined for missing chronological fields', () => {
    writeSceneFile(tmpDir, 'Manuscript/scene2.md', {
      id: 'sc-2',
      title: 'Scene Two',
      prose: 'Plain scene.',
    });
    const data = readSceneFile(tmpDir, 'Manuscript/scene2.md');
    expect(data.chronologicalDate).toBeUndefined();
    expect(data.chronologicalIsEstimated).toBeUndefined();
  });
});

describe('scene entityLinks frontmatter round-trip', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    fs.mkdirSync(path.join(tmpDir, 'Manuscript'), { recursive: true });
  });
  afterEach(() => { cleanDir(tmpDir); });

  it('writes and reads entityCharacterIds, entityArcs', () => {
    writeSceneFile(tmpDir, 'Manuscript/scene3.md', {
      id: 'sc-3',
      title: 'Scene Three',
      prose: 'Character meeting.',
      entityCharacterIds: ['char-a', 'char-b'],
      entityLocationId: 'loc-z',
      entityArcs: ['arc-1'],
    });
    const data = readSceneFile(tmpDir, 'Manuscript/scene3.md');
    expect(data.entityCharacterIds).toEqual(['char-a', 'char-b']);
    expect(data.entityLocationId).toBe('loc-z');
    expect(data.entityArcs).toEqual(['arc-1']);
  });

  it('returns undefined entityCharacterIds when not set', () => {
    writeSceneFile(tmpDir, 'Manuscript/scene4.md', {
      id: 'sc-4',
      title: 'Scene Four',
      prose: 'No entity links.',
    });
    const data = readSceneFile(tmpDir, 'Manuscript/scene4.md');
    expect(data.entityCharacterIds).toBeUndefined();
    expect(data.entityArcs).toBeUndefined();
  });
});

describe('scene timelineMetadata frontmatter round-trip', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    fs.mkdirSync(path.join(tmpDir, 'Manuscript'), { recursive: true });
  });
  afterEach(() => { cleanDir(tmpDir); });

  it('writes and reads metaWordCount, metaMood, metaPov', () => {
    writeSceneFile(tmpDir, 'Manuscript/scene5.md', {
      id: 'sc-5',
      title: 'Scene Five',
      prose: 'A mood piece.',
      metaWordCount: 1234,
      metaMood: 'tense',
      metaPov: 'third-limited',
    });
    const data = readSceneFile(tmpDir, 'Manuscript/scene5.md');
    expect(data.metaWordCount).toBe(1234);
    expect(data.metaMood).toBe('tense');
    expect(data.metaPov).toBe('third-limited');
  });
});
