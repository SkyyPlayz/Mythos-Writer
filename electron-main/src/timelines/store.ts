// SKY-6306 M21 — TimelinesStore persistence (`<Story Vault>/timelines.json`).
//
// SINGLE SOURCE OF TRUTH (PR #914 unification): once `timelines.json` exists it
// is the only store the timeline feature reads or writes. Legacy per-scene
// entries in `manifest.timeline` are migrated into it on first access
// (backup-first, lossless — the manifest itself is never modified) and the
// legacy `timeline:list` / `timeline:upsert` channels become compatibility
// views over the migrated events (see timelineIpc.ts). There is no dual-read
// and no dual-write.
//
// Reads/writes of the legacy manifest go through vault.ts's readManifest /
// real on-disk shape — NOT the structure-only `vault/manifest` ManifestV1
// module, whose validator throws on every real vault (object `provenance`,
// `boardReferences`; see SKY-6632 / PR #931).
//
// DEMO SEED (owner ruling on PR #914): a genuinely new vault — no
// timelines.json and no legacy `manifest.timeline` data — gets the demo seed
// store IN MEMORY only. Every demo entity carries `source: 'seed'` (the
// canonical demo marker, rendered as a "Demo" badge in the picker). Nothing is
// persisted to disk until a user action writes the store. A vault WITH legacy
// timeline data is migrated instead — the demo must never mask real data.
import fs from 'fs';
import path from 'path';
import type { ArcEntry, Manifest } from '../ipc.js';
import type { ManifestTimelineEntry, StoryTimeOfDay } from '../vault/manifest/types.js';
import { readManifest, writeFileAtomic } from '../vault.js';
import { mythosRootForStoryVault, resolveManifestPath } from '../mythosFormat/mythosJson.js';
import { readTimelinesFile } from '../mythosFormat/timelinesFile.js';
import { encodeWhen } from './codec.js';
import {
  DEFAULT_TIMELINE_CALENDAR,
  TIMELINE_ITEM_SOURCES,
  type TimelineCalendar,
  type TimelineDefinition,
  type TimelineEvent,
  type TimelineRow,
  type TimelinesStore,
} from './model.js';

export const TIMELINES_FILENAME = 'timelines.json';
/** Rolling backup of the previous good timelines.json (same directory). */
export const TIMELINES_BACKUP_SUFFIX = '.bak';

export interface LegacyMigrationInput {
  manifestPath: string;
  arcsPath?: string;
  now?: string;
}

/** Legacy timeline data gathered from a vault that predates timelines.json. */
export interface LegacyTimelineData {
  entries: ManifestTimelineEntry[];
  arcs: ArcEntry[];
  sceneTitleById: Map<string, string>;
}

export interface TimelinesMigrationInfo {
  backupPath: string;
  migratedEvents: number;
  migratedRows: number;
}

export interface TimelinesRecoveryInfo {
  /** Where the unreadable timelines.json bytes were preserved. */
  corruptPath: string;
  /** The backup file the store was restored from. */
  backupPath: string;
  error: Error;
}

export interface ReadTimelinesStoreOptions {
  /** Called after legacy manifest.timeline data was migrated into timelines.json. */
  onMigrated?: (info: TimelinesMigrationInfo) => void;
  /** Called after a corrupt timelines.json was recovered from its backup. */
  onRecovered?: (info: TimelinesRecoveryInfo) => void;
}

/** Thrown when timelines.json is unreadable and no valid backup exists. */
export class TimelinesStoreCorruptError extends Error {
  constructor(
    public readonly storePath: string,
    cause: Error,
  ) {
    super(
      `timelines.json is corrupt and no valid backup exists (${storePath}). ` +
        `The file has been left in place for recovery. Cause: ${cause.message}`,
    );
    this.name = 'TimelinesStoreCorruptError';
  }
}

/**
 * Read the vault's TimelinesStore.
 *
 * - `timelines.json` present → parse + validate. A corrupt file is preserved
 *   as `timelines.json.corrupt-<timestamp>`, the store is restored from
 *   `timelines.json.bak`, and the error is surfaced (console + onRecovered).
 *   With no valid backup this throws — it NEVER silently reseeds over what
 *   might be user data.
 * - absent + legacy `manifest.timeline` data → migrate it (backup-first,
 *   persisted atomically) and return the migrated store.
 * - absent + no legacy data → return the labelled demo seed store in memory
 *   WITHOUT writing anything to disk.
 */
export function readTimelinesStore(
  vaultRoot: string,
  options?: ReadTimelinesStoreOptions,
): TimelinesStore {
  const storePath = path.join(vaultRoot, TIMELINES_FILENAME);
  if (fs.existsSync(storePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(storePath, 'utf-8')) as TimelinesStore;
      validateTimelinesStore(parsed);
      return parsed;
    } catch (err) {
      return recoverFromBackup(storePath, err as Error, options);
    }
  }

  const legacy = collectLegacyTimelineData(vaultRoot);
  if (legacy !== null && legacy.entries.length > 0) {
    const now = new Date().toISOString();
    const store = buildTimelinesStoreFromLegacy(legacy, now);
    const backupPath = writeMigrationSnapshot(vaultRoot, legacy, now);
    writeTimelinesStore(vaultRoot, store);
    const info: TimelinesMigrationInfo = {
      backupPath,
      migratedEvents: store.events.length,
      migratedRows: store.rows.length,
    };
    console.info(
      `[timelines] migrated ${info.migratedEvents} legacy manifest.timeline entr` +
        `${info.migratedEvents === 1 ? 'y' : 'ies'} into ${storePath} (source snapshot: ${backupPath})`,
    );
    options?.onMigrated?.(info);
    return store;
  }

  // Genuinely new vault: demo seed, in memory only (labelled source: 'seed').
  return createSeedTimelinesStore(new Date().toISOString());
}

/**
 * Atomic write (temp file + fsync + rename, via writeFileAtomic) with a
 * rolling backup: before the previous timelines.json is replaced, its content
 * is copied to timelines.json.bak — but only when that content still parses,
 * so a corrupt file can never clobber the last good backup.
 */
export function writeTimelinesStore(vaultRoot: string, store: TimelinesStore): void {
  validateTimelinesStore(store);
  const storePath = path.join(vaultRoot, TIMELINES_FILENAME);
  if (fs.existsSync(storePath)) {
    try {
      const previous = fs.readFileSync(storePath, 'utf-8');
      JSON.parse(previous);
      writeFileAtomic(`${storePath}${TIMELINES_BACKUP_SUFFIX}`, previous);
    } catch {
      // Previous file unparseable — keep the existing (older but valid) backup.
    }
  }
  writeFileAtomic(storePath, JSON.stringify(store, null, 2));
}

/**
 * Build a TimelinesStore from a legacy v0.4-era vault. Reads the REAL on-disk
 * manifest shape via vault.ts's readManifest (plain JSON — no structural
 * ManifestV1 validation) plus the optional arcs.json.
 *
 * Lossless: each migrated event keeps its full ManifestTimelineEntry under
 * `event.legacy`, and the source files are never modified.
 */
export function migrateLegacyTimeline(input: LegacyMigrationInput): TimelinesStore {
  const now = input.now ?? new Date().toISOString();
  const manifest = readManifest(input.manifestPath);
  const arcs =
    input.arcsPath && fs.existsSync(input.arcsPath)
      ? parseArcs(fs.readFileSync(input.arcsPath, 'utf-8'))
      : [];

  return buildTimelinesStoreFromLegacy(
    {
      entries: manifest.timeline ?? [],
      arcs,
      sceneTitleById: sceneTitlesFromManifest(manifest),
    },
    now,
  );
}

/** Pure builder: legacy entries + arcs → a valid migrated TimelinesStore. */
export function buildTimelinesStoreFromLegacy(
  legacy: LegacyTimelineData,
  now: string,
): TimelinesStore {
  const timeline = createTimeline(
    'story',
    'Story Timeline',
    'story',
    DEFAULT_TIMELINE_CALENDAR,
    now,
    'migration',
  );

  const rows = legacy.arcs.map<TimelineRow>((arc) => ({
    id: `arc:${arc.id}`,
    timelineId: timeline.id,
    name: arc.title,
    kind: 'arc',
    source: 'migration',
  }));

  // Scene → arc row assignment: the first arc listing the scene wins, so
  // migrated events land on their arc's row instead of arriving row-less.
  const rowIdBySceneId = new Map<string, string>();
  for (const arc of legacy.arcs) {
    for (const sceneId of arc.scenes ?? []) {
      if (!rowIdBySceneId.has(sceneId)) rowIdBySceneId.set(sceneId, `arc:${arc.id}`);
    }
  }

  // Last entry per sceneId wins (mirrors the legacy upsert's replace-by-scene).
  const entryBySceneId = new Map<string, ManifestTimelineEntry>();
  for (const entry of legacy.entries) {
    if (entry && typeof entry.sceneId === 'string' && entry.sceneId) {
      entryBySceneId.set(entry.sceneId, entry);
    }
  }

  const events = [...entryBySceneId.values()].map<TimelineEvent>((entry) => {
    const day = entry.userOverride?.day ?? entry.inferredDay;
    const time = entry.userOverride?.time ?? entry.inferredTime;
    const rowId = rowIdBySceneId.get(entry.sceneId);
    return {
      id: `scene:${entry.sceneId}`,
      timelineId: timeline.id,
      name: legacy.sceneTitleById.get(entry.sceneId) ?? entry.sceneId,
      when: encodeLegacyDay(day, time, timeline.calendar),
      ...(rowId ? { rowId } : {}),
      sceneId: entry.sceneId,
      source: 'migration',
      legacy: entry,
    };
  });

  return {
    schemaVersion: 1,
    activeTimelineId: timeline.id,
    timelines: [timeline],
    eras: [],
    spans: [],
    rows,
    events,
  };
}

/**
 * Demo seed store. Every entity is labelled `source: 'seed'` — the canonical
 * demo marker (owner ruling on PR #914) that the picker renders as a "Demo"
 * badge. Returned in memory for brand-new vaults; only persisted once a user
 * action writes the store.
 */
export function createSeedTimelinesStore(now: string): TimelinesStore {
  const story = createTimeline('story', 'Story Timeline', 'story', DEFAULT_TIMELINE_CALENDAR, now, 'seed');
  const world = createTimeline('world', 'World History', 'world', DEFAULT_TIMELINE_CALENDAR, now, 'seed');
  const universe = createTimeline('universe', 'Universe Timeline', 'universe', DEFAULT_TIMELINE_CALENDAR, now, 'seed');

  return {
    schemaVersion: 1,
    activeTimelineId: story.id,
    timelines: [story, world, universe],
    eras: [
      { id: 'era:story-opening', timelineId: story.id, name: 'Opening', startWhen: 2.4, endWhen: 12, source: 'seed' },
      { id: 'era:world-founding', timelineId: world.id, name: 'Founding Age', startWhen: 0, endWhen: 720, source: 'seed' },
    ],
    spans: [
      {
        id: 'span:story-world-history',
        timelineId: story.id,
        name: 'World context',
        startWhen: 24,
        endWhen: 96,
        opensTimelineId: world.id,
        source: 'seed',
      },
      {
        id: 'span:world-universe-myth',
        timelineId: world.id,
        name: 'Cosmic myth',
        startWhen: 120,
        endWhen: 240,
        opensTimelineId: universe.id,
        source: 'seed',
      },
    ],
    rows: [
      { id: 'row:story-main', timelineId: story.id, name: 'Main plot', kind: 'custom', source: 'seed' },
      { id: 'row:world-history', timelineId: world.id, name: 'History', kind: 'custom', source: 'seed' },
    ],
    events: [
      { id: 'event:inciting', timelineId: story.id, name: 'Inciting incident', when: 2.4, rowId: 'row:story-main', source: 'seed' },
      { id: 'event:founding', timelineId: world.id, name: 'City founded', when: 48, rowId: 'row:world-history', source: 'seed' },
      { id: 'event:first-star', timelineId: universe.id, name: 'First star kindles', when: 0, source: 'seed' },
    ],
  };
}

export function validateTimelinesStore(store: TimelinesStore): void {
  if (store.schemaVersion !== 1) throw new Error('Unsupported timelines schema version');
  if (!store.timelines.some((timeline) => timeline.id === store.activeTimelineId)) {
    throw new Error('Active timeline does not exist');
  }
  const timelineIds = new Set(store.timelines.map((timeline) => timeline.id));
  for (const timeline of store.timelines) {
    if (!timeline.id.trim() || !timeline.name.trim()) throw new Error('Timeline id and name are required');
  }
  // Every plotted item — eras, spans, ROWS, events — must reference an
  // existing timeline (rows were previously unchecked, letting orphans pass).
  for (const item of [...store.eras, ...store.spans, ...store.rows, ...store.events]) {
    if (!timelineIds.has(item.timelineId)) throw new Error(`Timeline item references missing timeline: ${item.timelineId}`);
  }
  // Duplicate-ID checks for every entity kind (previously events only).
  assertUniqueIds('timeline', store.timelines);
  assertUniqueIds('era', store.eras);
  assertUniqueIds('span', store.spans);
  assertUniqueIds('row', store.rows);
  assertUniqueIds('event', store.events);
  // The provenance marker vocabulary is closed — see TimelineItemSource.
  for (const item of [...store.timelines, ...store.eras, ...store.spans, ...store.rows, ...store.events]) {
    if (item.source !== undefined && !TIMELINE_ITEM_SOURCES.includes(item.source)) {
      throw new Error(`Unknown timeline item source: ${String(item.source)}`);
    }
  }
}

function assertUniqueIds(kind: string, items: ReadonlyArray<{ id: string }>): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) throw new Error(`Duplicate timeline ${kind}: ${item.id}`);
    seen.add(item.id);
  }
}

// ─── Legacy data collection (migration inputs) ───────────────────────────────

/**
 * Gather the legacy timeline data for a vault that has no timelines.json yet.
 *
 * v0.4 twin-root: `<vaultRoot>/manifest.json` timeline entries + arcs.json.
 * MythosVault v2: the legacy manifest cache (resolveManifestPath) first; when
 * the cache carries no timeline entries (it is regenerable and a rebuild drops
 * them), fall back to the durable M5 envelope `<MythosVault>/timelines.json`
 * (`sceneEntries` + `arcs`).
 *
 * Returns null when the vault has no manifest at all (brand-new directory).
 * A manifest that EXISTS but cannot be parsed throws — silently treating it
 * as "no legacy data" would let the demo seed mask real user data.
 */
export function collectLegacyTimelineData(vaultRoot: string): LegacyTimelineData | null {
  const manifestPath = resolveManifestPath(vaultRoot);
  let manifest: Manifest | null = null;
  if (fs.existsSync(manifestPath)) {
    manifest = readManifest(manifestPath);
  }

  let entries: ManifestTimelineEntry[] = manifest?.timeline ?? [];
  let arcs: ArcEntry[] = readArcsJson(vaultRoot);

  const mythosRoot = mythosRootForStoryVault(vaultRoot);
  if (mythosRoot !== null) {
    // v2 envelope (tolerant reader: missing/corrupt file → empty envelope).
    const envelope = readTimelinesFile(mythosRoot);
    if (entries.length === 0) {
      entries = (envelope.sceneEntries as unknown[]).filter(isManifestTimelineEntry);
    }
    if (arcs.length === 0 && Array.isArray(envelope.arcs)) {
      arcs = envelope.arcs;
    }
  }

  if (manifest === null && entries.length === 0) return null;

  return {
    entries,
    arcs,
    sceneTitleById: manifest ? sceneTitlesFromManifest(manifest) : new Map(),
  };
}

function sceneTitlesFromManifest(manifest: Manifest): Map<string, string> {
  const titles = new Map<string, string>();
  for (const scene of manifest.scenes ?? []) {
    if (scene?.id && scene.title) titles.set(scene.id, scene.title);
  }
  return titles;
}

function isManifestTimelineEntry(value: unknown): value is ManifestTimelineEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.sceneId === 'string' && v.sceneId.length > 0 && typeof v.inferredDay === 'number';
}

function parseArcs(raw: string): ArcEntry[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as ArcEntry[];
    const wrapped = (parsed as { arcs?: unknown[] })?.arcs;
    if (Array.isArray(wrapped)) return wrapped as ArcEntry[];
  } catch {
    /* unreadable arcs — migrate without rows */
  }
  return [];
}

function readArcsJson(vaultRoot: string): ArcEntry[] {
  const arcsPath = path.join(vaultRoot, 'arcs.json');
  if (!fs.existsSync(arcsPath)) return [];
  return parseArcs(fs.readFileSync(arcsPath, 'utf-8'));
}

/**
 * Backup-first: snapshot the migration SOURCE data (raw legacy entries + arcs)
 * to `.mythos/backups/` before timelines.json is first written, mirroring the
 * manifest migration's backup discipline (manifest.ts writeBackup).
 */
function writeMigrationSnapshot(vaultRoot: string, legacy: LegacyTimelineData, now: string): string {
  const backupDir = path.join(vaultRoot, '.mythos', 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const timestamp = now.replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `timelines-migration-source-${timestamp}.json`);
  writeFileAtomic(
    backupPath,
    JSON.stringify(
      {
        migratedAt: now,
        manifestTimeline: legacy.entries,
        arcs: legacy.arcs,
      },
      null,
      2,
    ),
  );
  return backupPath;
}

// ─── Corrupt-file recovery ────────────────────────────────────────────────────

function recoverFromBackup(
  storePath: string,
  error: Error,
  options?: ReadTimelinesStoreOptions,
): TimelinesStore {
  const backupPath = `${storePath}${TIMELINES_BACKUP_SUFFIX}`;
  let backupStore: TimelinesStore | null = null;
  let backupRaw: string | null = null;
  try {
    backupRaw = fs.readFileSync(backupPath, 'utf-8');
    const parsed = JSON.parse(backupRaw) as TimelinesStore;
    validateTimelinesStore(parsed);
    backupStore = parsed;
  } catch {
    backupStore = null;
  }

  if (backupStore === null || backupRaw === null) {
    throw new TimelinesStoreCorruptError(storePath, error);
  }

  // Preserve the corrupt bytes for forensics, then restore the backup into
  // place so subsequent reads are clean. No user data is ever discarded.
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const corruptPath = `${storePath}.corrupt-${timestamp}`;
  fs.copyFileSync(storePath, corruptPath);
  writeFileAtomic(storePath, backupRaw);

  console.error(
    `[timelines] ${storePath} was unreadable (${error.message}); ` +
      `restored from ${backupPath} — corrupt file preserved at ${corruptPath}`,
  );
  options?.onRecovered?.({ corruptPath, backupPath, error });
  return backupStore;
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function createTimeline(
  id: string,
  name: string,
  kind: TimelineDefinition['kind'],
  calendar: TimelineCalendar,
  now: string,
  source: TimelineDefinition['source'],
): TimelineDefinition {
  return {
    id,
    name,
    kind,
    axis: 'calendar',
    calendar,
    createdAt: now,
    updatedAt: now,
    source,
  };
}

/**
 * Encode a legacy 1-based story day + StoryTimeOfDay into the `when` codec.
 * Exported so the legacy `timeline:upsert` compatibility path (timelineIpc.ts)
 * computes the exact same positions as the migration.
 */
export function encodeLegacyDay(day: number, time: StoryTimeOfDay, calendar: TimelineCalendar): number {
  const normalizedDay = Number.isInteger(day) && day > 0 ? day : 1;
  const zeroBasedDay = normalizedDay - 1;
  const year = Math.floor(zeroBasedDay / (calendar.monthsPerYear * calendar.daysPerMonth));
  const dayOfYear = zeroBasedDay - year * calendar.monthsPerYear * calendar.daysPerMonth;
  const month = Math.floor(dayOfYear / calendar.daysPerMonth) + 1;
  const dayOfMonth = (dayOfYear % calendar.daysPerMonth) + 1;
  return encodeWhen({ year, month, day: dayOfMonth, hour: legacyHour(time, calendar.hoursPerDay) }, calendar);
}

function legacyHour(time: StoryTimeOfDay, hoursPerDay: number): number {
  const fractionByTime: Record<StoryTimeOfDay, number> = {
    midnight: 0,
    dawn: 0.25,
    morning: 0.35,
    noon: 0.5,
    afternoon: 0.65,
    dusk: 0.8,
    night: 0.9,
    unspecified: 0,
  };
  return Math.min(hoursPerDay - 1, Math.round(fractionByTime[time] * hoursPerDay));
}
