// SKY-6306 M21 — TimelinesStore persistence + legacy migration tests.
//
// FIXTURE DISCIPLINE (PR #914 review): every legacy-manifest fixture is built
// through the REAL manifest writer path — vault.ts defaultManifest() +
// writeManifest() (writeManifestAtomic) — so the tests exercise the exact
// shape real vaults have on disk (object `provenance`, `boardReferences`,
// no `boards`). A hand-rolled fixture with an array `provenance` previously
// let a reader that throws on every real vault pass CI.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultManifest, readManifest, writeManifest } from '../vault.js';
import type { ArcEntry, Manifest, SceneEntry } from '../ipc.js';
import type { ManifestTimelineEntry } from '../vault/manifest/types.js';
import {
  buildTimelinesStoreFromLegacy,
  createSeedTimelinesStore,
  migrateLegacyTimeline,
  readTimelinesStore,
  TIMELINES_BACKUP_SUFFIX,
  TIMELINES_FILENAME,
  TimelinesStoreCorruptError,
  validateTimelinesStore,
  writeTimelinesStore,
} from './store.js';

function makeScene(id: string, title: string): SceneEntry {
  return {
    id,
    path: `scenes/${id}.md`,
    title,
    order: 0,
    blocks: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const TIMELINE_ENTRIES: ManifestTimelineEntry[] = [
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
];

const ARCS: ArcEntry[] = [
  {
    id: 'arc-a', title: 'Hero Arc', color: '#ff0000', colorIsCustom: false,
    scenes: ['scene-01', 'scene-03'],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'arc-b', title: 'Villain Arc', color: '#0000ff', colorIsCustom: false,
    scenes: ['scene-02'],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

let tmpDir: string;
let manifestPath: string;
let arcsPath: string;

/** Write a manifest to disk through the REAL writer path (writeManifestAtomic). */
function writeRealManifest(overrides: Partial<Manifest> = {}): void {
  const manifest: Manifest = { ...defaultManifest(tmpDir), ...overrides };
  writeManifest(manifestPath, manifest);
}

/** A legacy vault exactly as a real M20-era vault sits on disk. */
function writeLegacyVault(): void {
  writeRealManifest({
    scenes: [
      makeScene('scene-01', 'The Beginning'),
      makeScene('scene-02', 'Rising Action'),
      makeScene('scene-03', 'The Climax'),
    ],
    timeline: TIMELINE_ENTRIES,
  });
  fs.writeFileSync(arcsPath, JSON.stringify(ARCS, null, 2), 'utf-8');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timelines-test-'));
  manifestPath = path.join(tmpDir, 'manifest.json');
  arcsPath = path.join(tmpDir, 'arcs.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ─── Real-manifest-shape regression (the defect that hid everything else) ────

describe('migrateLegacyTimeline — real on-disk manifest shape', () => {
  beforeEach(writeLegacyVault);

  it('fixture is the REAL vault shape: object provenance, boardReferences, no boards', () => {
    const onDisk = readManifest(manifestPath);
    expect(Array.isArray(onDisk.provenance)).toBe(false);
    expect(typeof onDisk.provenance).toBe('object');
    expect(Array.isArray(onDisk.boardReferences)).toBe(true);
    expect('boards' in onDisk).toBe(false);
    expect(onDisk.schemaVersion).toBe(1);
  });

  it('does not throw on a real vault manifest (SKY-6632 regression — openManifestV1 threw here)', () => {
    expect(() => migrateLegacyTimeline({ manifestPath, arcsPath, now: '2026-01-01T00:00:00Z' })).not.toThrow();
  });

  it('produces a valid TimelinesStore with exactly one story timeline', () => {
    const store = migrateLegacyTimeline({ manifestPath, arcsPath, now: '2026-01-01T00:00:00Z' });
    expect(() => validateTimelinesStore(store)).not.toThrow();
    expect(store.timelines).toHaveLength(1);
    expect(store.timelines[0].kind).toBe('story');
    expect(store.timelines[0].source).toBe('migration');
  });

  it('migrates all timeline entries to events losslessly (legacy entry preserved)', () => {
    const store = migrateLegacyTimeline({ manifestPath, arcsPath, now: '2026-01-01T00:00:00Z' });
    expect(store.events).toHaveLength(3);
    for (const original of TIMELINE_ENTRIES) {
      const event = store.events.find((e) => e.sceneId === original.sceneId);
      expect(event).toBeDefined();
      expect(event!.legacy).toEqual(original);
      expect(event!.source).toBe('migration');
    }
  });

  it('uses scene titles from the manifest for event names', () => {
    const store = migrateLegacyTimeline({ manifestPath, arcsPath, now: '2026-01-01T00:00:00Z' });
    expect(store.events.find((e) => e.sceneId === 'scene-01')?.name).toBe('The Beginning');
  });

  it('uses userOverride when present and every when is finite', () => {
    const store = migrateLegacyTimeline({ manifestPath, arcsPath, now: '2026-01-01T00:00:00Z' });
    for (const event of store.events) {
      expect(Number.isFinite(event.when)).toBe(true);
    }
    const overridden = store.events.find((e) => e.sceneId === 'scene-03')!;
    const inferredOnly = buildTimelinesStoreFromLegacy(
      {
        entries: [{ ...TIMELINE_ENTRIES[2], userOverride: undefined }],
        arcs: [],
        sceneTitleById: new Map(),
      },
      '2026-01-01T00:00:00Z',
    ).events[0];
    expect(overridden.when).not.toBe(inferredOnly.when);
  });

  it('converts arcs to rows AND assigns migrated events to their arc row (rows not dead on arrival)', () => {
    const store = migrateLegacyTimeline({ manifestPath, arcsPath, now: '2026-01-01T00:00:00Z' });
    expect(store.rows).toHaveLength(2);
    expect(store.rows.every((r) => r.kind === 'arc' && r.source === 'migration')).toBe(true);

    const bySceneId = (id: string) => store.events.find((e) => e.sceneId === id)!;
    expect(bySceneId('scene-01').rowId).toBe('arc:arc-a');
    expect(bySceneId('scene-03').rowId).toBe('arc:arc-a');
    expect(bySceneId('scene-02').rowId).toBe('arc:arc-b');
  });

  it('works without arcsPath (no rows, events row-less)', () => {
    const store = migrateLegacyTimeline({ manifestPath, now: '2026-01-01T00:00:00Z' });
    expect(store.rows).toHaveLength(0);
    expect(store.events).toHaveLength(3);
    expect(store.events.every((e) => e.rowId === undefined)).toBe(true);
    expect(() => validateTimelinesStore(store)).not.toThrow();
  });

  it('deduplicates repeated sceneIds (last entry wins) instead of failing validation', () => {
    writeRealManifest({
      scenes: [makeScene('scene-01', 'The Beginning')],
      timeline: [
        { sceneId: 'scene-01', inferredDay: 1, inferredTime: 'dawn', confidence: 0.5, rawCue: '' },
        { sceneId: 'scene-01', inferredDay: 9, inferredTime: 'noon', confidence: 0.9, rawCue: 'later' },
      ],
    });
    const store = migrateLegacyTimeline({ manifestPath, now: '2026-01-01T00:00:00Z' });
    expect(store.events).toHaveLength(1);
    expect(store.events[0].legacy).toMatchObject({ inferredDay: 9 });
  });
});

// ─── Migration wired into the real read path ─────────────────────────────────

describe('readTimelinesStore — first-access migration', () => {
  it('migrates legacy manifest.timeline data instead of returning the demo seed', () => {
    writeLegacyVault();
    const onMigrated = vi.fn();
    const store = readTimelinesStore(tmpDir, { onMigrated });

    expect(store.events.map((e) => e.sceneId).sort()).toEqual(['scene-01', 'scene-02', 'scene-03']);
    // Demo content must never mask real data.
    expect(store.timelines.some((t) => t.source === 'seed')).toBe(false);
    expect(store.events.some((e) => e.name === 'Inciting incident')).toBe(false);
    expect(onMigrated).toHaveBeenCalledTimes(1);
    expect(onMigrated.mock.calls[0][0]).toMatchObject({ migratedEvents: 3, migratedRows: 2 });
  });

  it('persists the migrated store to timelines.json (subsequent reads do not re-migrate)', () => {
    writeLegacyVault();
    const first = readTimelinesStore(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, TIMELINES_FILENAME))).toBe(true);

    const onMigrated = vi.fn();
    const second = readTimelinesStore(tmpDir, { onMigrated });
    expect(second).toEqual(first);
    expect(onMigrated).not.toHaveBeenCalled();
  });

  it('writes a backup-first snapshot of the source data before persisting', () => {
    writeLegacyVault();
    readTimelinesStore(tmpDir);
    const backupDir = path.join(tmpDir, '.mythos', 'backups');
    const snapshots = fs.readdirSync(backupDir).filter((f) => f.startsWith('timelines-migration-source-'));
    expect(snapshots).toHaveLength(1);
    const snapshot = JSON.parse(fs.readFileSync(path.join(backupDir, snapshots[0]), 'utf-8'));
    expect(snapshot.manifestTimeline).toEqual(TIMELINE_ENTRIES);
    expect(snapshot.arcs).toEqual(ARCS);
  });

  it('never modifies the source manifest (lossless)', () => {
    writeLegacyVault();
    const before = fs.readFileSync(manifestPath, 'utf-8');
    readTimelinesStore(tmpDir);
    expect(fs.readFileSync(manifestPath, 'utf-8')).toBe(before);
  });

  it('throws on an unparseable manifest instead of masking it with the demo seed', () => {
    fs.writeFileSync(manifestPath, '{ not json', 'utf-8');
    expect(() => readTimelinesStore(tmpDir)).toThrow();
    expect(fs.existsSync(path.join(tmpDir, TIMELINES_FILENAME))).toBe(false);
  });
});

// ─── Demo seed (sanctioned, labelled, in-memory) ─────────────────────────────

describe('readTimelinesStore — demo seed for genuinely new vaults', () => {
  it('returns the demo seed for a vault with no manifest at all', () => {
    const store = readTimelinesStore(tmpDir);
    expect(store.timelines.length).toBeGreaterThan(0);
    expect(() => validateTimelinesStore(store)).not.toThrow();
  });

  it('returns the demo seed when the manifest has no timeline data', () => {
    writeRealManifest();
    const store = readTimelinesStore(tmpDir);
    expect(store.timelines.every((t) => t.source === 'seed')).toBe(true);
  });

  it('does NOT persist the demo seed on read (nothing on disk without user action)', () => {
    writeRealManifest();
    readTimelinesStore(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, TIMELINES_FILENAME))).toBe(false);
  });

  it('labels every demo entity with source "seed" (data-level demo marker)', () => {
    const store = createSeedTimelinesStore('2026-01-01T00:00:00Z');
    const everything = [...store.timelines, ...store.eras, ...store.spans, ...store.rows, ...store.events];
    expect(everything.length).toBeGreaterThan(0);
    expect(everything.every((item) => item.source === 'seed')).toBe(true);
  });

  it('produces a valid store with 3 timelines and embedding spans', () => {
    const store = createSeedTimelinesStore('2026-01-01T00:00:00Z');
    expect(() => validateTimelinesStore(store)).not.toThrow();
    expect(store.timelines).toHaveLength(3);
    expect(store.spans.filter((s) => s.opensTimelineId).length).toBeGreaterThan(0);
  });
});

// ─── Atomic write + backup + corrupt-file recovery ───────────────────────────

describe('writeTimelinesStore / readTimelinesStore — durability', () => {
  const storePath = () => path.join(tmpDir, TIMELINES_FILENAME);
  const backupPath = () => `${storePath()}${TIMELINES_BACKUP_SUFFIX}`;

  it('round-trips a store through JSON without data loss (marker fields included)', () => {
    const original = createSeedTimelinesStore('2026-01-01T00:00:00Z');
    writeTimelinesStore(tmpDir, original);
    expect(readTimelinesStore(tmpDir)).toEqual(original);
  });

  it('leaves no temp files behind after a write', () => {
    writeTimelinesStore(tmpDir, createSeedTimelinesStore('2026-01-01T00:00:00Z'));
    expect(fs.readdirSync(tmpDir).filter((f) => f.includes('.tmp'))).toEqual([]);
  });

  it('backs up the previous file before replacing it', () => {
    const v1 = createSeedTimelinesStore('2026-01-01T00:00:00Z');
    writeTimelinesStore(tmpDir, v1);
    expect(fs.existsSync(backupPath())).toBe(false);

    const v2 = { ...v1, activeTimelineId: 'world' };
    writeTimelinesStore(tmpDir, v2);
    expect(JSON.parse(fs.readFileSync(backupPath(), 'utf-8'))).toEqual(v1);
    expect(readTimelinesStore(tmpDir)).toEqual(v2);
  });

  it('recovers from a corrupt timelines.json via the backup, preserving the corrupt bytes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const v1 = createSeedTimelinesStore('2026-01-01T00:00:00Z');
    writeTimelinesStore(tmpDir, v1);
    // After this second write, .bak holds v1 and the store holds v2.
    writeTimelinesStore(tmpDir, { ...v1, activeTimelineId: 'world' });
    // Now corrupt the store file:
    fs.writeFileSync(storePath(), '{ truncated', 'utf-8');

    const onRecovered = vi.fn();
    const recovered = readTimelinesStore(tmpDir, { onRecovered });
    expect(recovered).toEqual(v1);
    expect(onRecovered).toHaveBeenCalledTimes(1);

    const corruptCopies = fs.readdirSync(tmpDir).filter((f) => f.startsWith(`${TIMELINES_FILENAME}.corrupt-`));
    expect(corruptCopies).toHaveLength(1);
    expect(fs.readFileSync(path.join(tmpDir, corruptCopies[0]), 'utf-8')).toBe('{ truncated');
    // The store file was healed in place — the next read is clean.
    expect(readTimelinesStore(tmpDir)).toEqual(v1);
  });

  it('a corrupt file can never clobber the last good backup on the next write', () => {
    const v1 = createSeedTimelinesStore('2026-01-01T00:00:00Z');
    writeTimelinesStore(tmpDir, v1);
    writeTimelinesStore(tmpDir, { ...v1, activeTimelineId: 'world' });
    fs.writeFileSync(storePath(), '{ truncated', 'utf-8');

    // Writing over the corrupt file must keep the older-but-valid backup.
    writeTimelinesStore(tmpDir, { ...v1, activeTimelineId: 'universe' });
    expect(JSON.parse(fs.readFileSync(backupPath(), 'utf-8'))).toEqual(v1);
  });

  it('throws (never reseeds) when the store is corrupt and no valid backup exists', () => {
    fs.writeFileSync(storePath(), '{ truncated', 'utf-8');
    expect(() => readTimelinesStore(tmpDir)).toThrow(TimelinesStoreCorruptError);
    // The corrupt file is left in place for recovery — not overwritten by demo data.
    expect(fs.readFileSync(storePath(), 'utf-8')).toBe('{ truncated');
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe('validateTimelinesStore', () => {
  const base = () => createSeedTimelinesStore('2026-01-01T00:00:00Z');

  it('throws when activeTimelineId references a missing timeline', () => {
    expect(() => validateTimelinesStore({ ...base(), activeTimelineId: 'does-not-exist' })).toThrow(/active timeline/i);
  });

  it('throws on duplicate event id', () => {
    const store = base();
    expect(() =>
      validateTimelinesStore({ ...store, events: [...store.events, { ...store.events[0] }] }),
    ).toThrow(/duplicate/i);
  });

  it('throws on duplicate era, span, row and timeline ids (all entity kinds)', () => {
    const store = base();
    expect(() => validateTimelinesStore({ ...store, eras: [...store.eras, { ...store.eras[0] }] })).toThrow(/duplicate/i);
    expect(() => validateTimelinesStore({ ...store, spans: [...store.spans, { ...store.spans[0] }] })).toThrow(/duplicate/i);
    expect(() => validateTimelinesStore({ ...store, rows: [...store.rows, { ...store.rows[0] }] })).toThrow(/duplicate/i);
    expect(() =>
      validateTimelinesStore({ ...store, timelines: [...store.timelines, { ...store.timelines[1] }] }),
    ).toThrow(/duplicate/i);
  });

  it('throws when an event references a missing timelineId', () => {
    const store = base();
    expect(() =>
      validateTimelinesStore({
        ...store,
        events: [...store.events, { id: 'orphan', timelineId: 'ghost', name: 'orphan', when: 0 }],
      }),
    ).toThrow(/missing timeline/i);
  });

  it('throws when a ROW references a missing timelineId (previously unchecked)', () => {
    const store = base();
    expect(() =>
      validateTimelinesStore({
        ...store,
        rows: [...store.rows, { id: 'row:orphan', timelineId: 'ghost', name: 'Orphan', kind: 'custom' as const }],
      }),
    ).toThrow(/missing timeline/i);
  });

  it('rejects an unknown source marker (closed vocabulary)', () => {
    const store = base();
    expect(() =>
      validateTimelinesStore({
        ...store,
        events: [
          ...store.events,
          { id: 'e:x', timelineId: store.timelines[0].id, name: 'X', when: 0, source: 'demo' as never },
        ],
      }),
    ).toThrow(/source/i);
  });
});
