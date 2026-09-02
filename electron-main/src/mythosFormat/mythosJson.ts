// Beta 4 M5 — MythosVault format: `mythos.json` codec.
//
// A MythosVault (format v2) is ONE folder the user can place anywhere
// (local disk, Dropbox, a network share):
//
//   MythosVault/
//     mythos.json          ← vault id, name, default theme, story list, seed marker
//     settings.json        ← per-vault user settings          (vaultSettingsFile.ts)
//     timelines.json       ← timelines / eras / arcs / events (timelinesFile.ts)
//     Story Vault/         ← manuscripts: <Story>/Part N/Chapter NN/Scene NN.md
//     Notes Vault/         ← Obsidian-style notes
//     Agent Vault/         ← machine state (agent chat sessions); visible but
//                            not rendered in the notes UI (SKY-10952/SKY-10949,
//                            supersedes the prototype's notes-tree Sessions/)
//     .mythos/             ← machine-local, REGENERABLE state only (SQLite,
//                            manifest cache, backups). Deleting it must never
//                            lose user work (the storage rule, overview §Data
//                            architecture, owner-ratified 2026-07-10).
//
// The seed-once marker that W0.1 kept in a `.mythos-seeded` sentinel +
// vault-settings registry lives HERE for v2 vaults (`seed` field), as the
// FULL-SPEC §2 requires ("marker in mythos.json").
//
// Pure Node — no Electron imports — so unit tests drive it with tmpdirs.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeFileAtomic } from '../vault.js';

export const MYTHOS_JSON_FILENAME = 'mythos.json';
export const MYTHOS_FORMAT_VERSION = 2 as const;

export const STORY_VAULT_DIRNAME = 'Story Vault';
export const NOTES_VAULT_DIRNAME = 'Notes Vault';
// SKY-10952 (owner ruling 2026-08-19, SKY-10949): third top-level sibling —
// machine state (agent chat sessions today) that is visible but not rendered
// in the notes UI. Not hidden — a curious user can open it — just kept out of
// the user-content tree so it doesn't clutter Notes Vault.
export const AGENT_VAULT_DIRNAME = 'Agent Vault';
export const MYTHOS_MACHINE_DIRNAME = '.mythos';
/** Regenerable legacy-Manifest cache for v2 vaults (never the source of truth). */
export const MANIFEST_CACHE_FILENAME = 'manifest-cache.json';

/** One story in the vault's story list. `folder` is the directory name under `Story Vault/`. */
export interface MythosStoryRef {
  id: string;
  title: string;
  folder: string;
  synopsis?: string;
  createdAt: string;
  updatedAt: string;
}

/** Seed-once record — the W0.1 marker, migrated into mythos.json (FULL-SPEC §2). */
export interface MythosSeedRecord {
  layout: string;
  mode: 'default' | 'blank';
  seededAt: string;
}

export interface MythosMigrationRecord {
  from: 'v0.4-twin-root';
  storyVaultRoot: string;
  notesVaultRoot: string;
  migratedAt: string;
  migratorVersion: number;
}

/**
 * SKY-11068: per-vault icon shown on the story switcher / rail header.
 * `glyph` is an emoji or a couple of letters; `image` names an icon file
 * stored directly at the mythos root, so it travels with the vault on
 * move/copy (vaults are self-contained, SKY-10949).
 */
export type MythosVaultIcon =
  | { kind: 'glyph'; value: string }
  | { kind: 'image'; file: string };

export interface MythosFile {
  formatVersion: number;
  id: string;
  name: string;
  createdAt: string;
  /** Theme preset key applied when this vault is opened (per-vault default theme). */
  defaultTheme?: string;
  /** Author-set vault icon; absent → callers render an initials default. */
  icon?: MythosVaultIcon;
  stories: MythosStoryRef[];
  /**
   * Seed-once marker. Non-null means "a seed decision was recorded for this
   * vault" — never seed again, even into an emptied vault (W0.1 rule).
   */
  seed: MythosSeedRecord | null;
  migratedFrom?: MythosMigrationRecord;
}

/** Thrown when mythos.json declares a formatVersion newer than this build supports. */
export class MythosFormatVersionError extends Error {
  constructor(public readonly foundVersion: number) {
    super(
      `mythos.json formatVersion ${foundVersion} is newer than this build supports ` +
        `(max ${MYTHOS_FORMAT_VERSION}). Upgrade the application.`
    );
    this.name = 'MythosFormatVersionError';
  }
}

/** Thrown when mythos.json exists but cannot be parsed / fails validation. */
export class MythosFileError extends Error {
  constructor(message: string, public readonly filePath: string) {
    super(message);
    this.name = 'MythosFileError';
  }
}

export function mythosJsonPath(mythosRoot: string): string {
  return path.join(mythosRoot, MYTHOS_JSON_FILENAME);
}

export function storyVaultRootFor(mythosRoot: string): string {
  return path.join(mythosRoot, STORY_VAULT_DIRNAME);
}

export function notesVaultRootFor(mythosRoot: string): string {
  return path.join(mythosRoot, NOTES_VAULT_DIRNAME);
}

export function agentVaultRootFor(mythosRoot: string): string {
  return path.join(mythosRoot, AGENT_VAULT_DIRNAME);
}

export function manifestCachePathFor(storyVaultRoot: string): string {
  return path.join(storyVaultRoot, MYTHOS_MACHINE_DIRNAME, MANIFEST_CACHE_FILENAME);
}

export function createMythosFile(
  name: string,
  opts: {
    id?: string;
    defaultTheme?: string;
    stories?: MythosStoryRef[];
    seed?: MythosSeedRecord | null;
    migratedFrom?: MythosMigrationRecord;
    now?: () => Date;
  } = {},
): MythosFile {
  const now = (opts.now ?? (() => new Date()))();
  return {
    formatVersion: MYTHOS_FORMAT_VERSION,
    id: opts.id ?? crypto.randomUUID(),
    name,
    createdAt: now.toISOString(),
    ...(opts.defaultTheme ? { defaultTheme: opts.defaultTheme } : {}),
    stories: opts.stories ?? [],
    seed: opts.seed ?? null,
    ...(opts.migratedFrom ? { migratedFrom: opts.migratedFrom } : {}),
  };
}

function sanitizeStoryRef(raw: unknown): MythosStoryRef | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  if (typeof r.folder !== 'string' || !r.folder) return null;
  // Refuse folder values that could escape Story Vault when joined.
  if (r.folder.includes('/') || r.folder.includes('\\') || r.folder.includes('\0')) return null;
  if (r.folder === '.' || r.folder === '..') return null;
  return {
    id: r.id,
    title: typeof r.title === 'string' && r.title ? r.title : r.folder,
    folder: r.folder,
    ...(typeof r.synopsis === 'string' && r.synopsis ? { synopsis: r.synopsis } : {}),
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date(0).toISOString(),
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date(0).toISOString(),
  };
}

/**
 * SKY-11068: validate a raw vault-icon value. Mirrors sanitizeStoryRef's
 * refusal of path-capable strings — `file` is joined onto the mythos root by
 * the icon loader, so it must be a bare file name. Returns null when invalid
 * (callers drop the field rather than failing the whole parse).
 */
export function sanitizeVaultIcon(raw: unknown): MythosVaultIcon | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === 'glyph') {
    if (typeof r.value !== 'string') return null;
    const value = r.value.trim();
    // Emoji ZWJ sequences can span several UTF-16 units; 16 is plenty for
    // any glyph while refusing pasted prose.
    if (!value || value.length > 16 || /[\n\r\0]/.test(value)) return null;
    return { kind: 'glyph', value };
  }
  if (r.kind === 'image') {
    if (typeof r.file !== 'string' || !r.file) return null;
    if (r.file.includes('/') || r.file.includes('\\') || r.file.includes('\0')) return null;
    if (r.file === '.' || r.file === '..') return null;
    return { kind: 'image', file: r.file };
  }
  return null;
}

/**
 * Parse + validate a mythos.json payload.
 * Throws MythosFormatVersionError for a too-new file (never touch it),
 * MythosFileError for corrupt/invalid content.
 */
export function parseMythosFile(rawText: string, filePath = MYTHOS_JSON_FILENAME): MythosFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    throw new MythosFileError(`Could not parse ${filePath}: ${(e as Error).message}`, filePath);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new MythosFileError(`${filePath} must be a JSON object`, filePath);
  }
  const r = parsed as Record<string, unknown>;
  const version = typeof r.formatVersion === 'number' ? r.formatVersion : 0;
  if (version > MYTHOS_FORMAT_VERSION) throw new MythosFormatVersionError(version);
  if (version < MYTHOS_FORMAT_VERSION) {
    throw new MythosFileError(
      `${filePath} formatVersion ${version} is not a MythosVault v${MYTHOS_FORMAT_VERSION} file`,
      filePath,
    );
  }
  const stories: MythosStoryRef[] = [];
  if (Array.isArray(r.stories)) {
    for (const entry of r.stories) {
      const ref = sanitizeStoryRef(entry);
      if (ref) stories.push(ref);
    }
  }
  let seed: MythosSeedRecord | null = null;
  if (typeof r.seed === 'object' && r.seed !== null) {
    const s = r.seed as Record<string, unknown>;
    seed = {
      layout: typeof s.layout === 'string' ? s.layout : 'unknown',
      mode: s.mode === 'blank' ? 'blank' : 'default',
      seededAt: typeof s.seededAt === 'string' ? s.seededAt : new Date(0).toISOString(),
    };
  }
  let migratedFrom: MythosMigrationRecord | undefined;
  if (typeof r.migratedFrom === 'object' && r.migratedFrom !== null) {
    const m = r.migratedFrom as Record<string, unknown>;
    migratedFrom = {
      from: 'v0.4-twin-root',
      storyVaultRoot: typeof m.storyVaultRoot === 'string' ? m.storyVaultRoot : '',
      notesVaultRoot: typeof m.notesVaultRoot === 'string' ? m.notesVaultRoot : '',
      migratedAt: typeof m.migratedAt === 'string' ? m.migratedAt : new Date(0).toISOString(),
      migratorVersion: typeof m.migratorVersion === 'number' ? m.migratorVersion : 1,
    };
  }
  const icon = sanitizeVaultIcon(r.icon);
  return {
    formatVersion: MYTHOS_FORMAT_VERSION,
    id: typeof r.id === 'string' && r.id ? r.id : crypto.randomUUID(),
    name: typeof r.name === 'string' && r.name ? r.name : 'MythosVault',
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date(0).toISOString(),
    ...(typeof r.defaultTheme === 'string' && r.defaultTheme
      ? { defaultTheme: r.defaultTheme }
      : {}),
    ...(icon ? { icon } : {}),
    stories,
    seed,
    ...(migratedFrom ? { migratedFrom } : {}),
  };
}

export function serializeMythosFile(file: MythosFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** Read + validate `<mythosRoot>/mythos.json`. Throws on missing/corrupt/too-new. */
export function readMythosFile(mythosRoot: string): MythosFile {
  const p = mythosJsonPath(mythosRoot);
  const raw = fs.readFileSync(p, 'utf-8');
  return parseMythosFile(raw, p);
}

/** Tolerant read: returns null when the file is absent or unreadable/corrupt.
 *  A too-new formatVersion still throws — silently treating a newer vault as
 *  v0.4 would route writes through the legacy path and corrupt it. */
export function tryReadMythosFile(mythosRoot: string): MythosFile | null {
  try {
    return readMythosFile(mythosRoot);
  } catch (err) {
    if (err instanceof MythosFormatVersionError) throw err;
    return null;
  }
}

/** Atomic write (temp + rename via writeFileAtomic). */
export function writeMythosFile(mythosRoot: string, file: MythosFile): void {
  writeFileAtomic(mythosJsonPath(mythosRoot), serializeMythosFile(file));
  invalidateDetectionCache(mythosRoot);
}

// ─── Format detection (the version gate) ────────────────────────────────────
//
// The app's twin-root plumbing keeps working for v2 vaults: vault-settings
// points vaultRoot at `<MythosVault>/Story Vault` and notesVaultRoot at
// `<MythosVault>/Notes Vault`. What flips is WHERE durable structure lives:
// v0.4 keeps `manifest.json` at the Story Vault root as user-facing truth;
// v2 keeps canonical structure in mythos.json + book.md + scene frontmatter,
// and the legacy Manifest becomes a regenerable cache under `.mythos/`.

interface DetectionCacheEntry {
  mtimeMs: number;
  isV2: boolean;
}
const detectionCache = new Map<string, DetectionCacheEntry>();

function invalidateDetectionCache(mythosRoot: string): void {
  detectionCache.delete(path.resolve(mythosRoot));
}

/** Test hook — clears the memoized detection results. */
export function _clearDetectionCache(): void {
  detectionCache.clear();
}

/**
 * True when `mythosRoot/mythos.json` exists and parses as a v2 vault.
 * Memoized on the file's mtime so per-IPC-call checks stay cheap.
 * A too-new formatVersion PROPAGATES (callers must not fall back to v0.4).
 */
export function isMythosV2Root(mythosRoot: string): boolean {
  const key = path.resolve(mythosRoot);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(mythosJsonPath(key));
  } catch {
    detectionCache.delete(key);
    return false;
  }
  const cached = detectionCache.get(key);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.isV2;
  let isV2 = false;
  try {
    isV2 = tryReadMythosFile(key) !== null;
  } catch (err) {
    if (err instanceof MythosFormatVersionError) throw err;
  }
  detectionCache.set(key, { mtimeMs: stat.mtimeMs, isV2 });
  return isV2;
}

// SKY-11169: mirrors storyVaultRegistry.ts's STORY_VAULT_REGISTRY_FILENAME.
// Duplicated (not imported) to keep this module's "pure format, no registry
// knowledge" layering — mythosFormat/* registry modules import FROM here,
// never the reverse. Only the filename is load-bearing here.
const STORY_VAULT_REGISTRY_FILENAME = 'story-vaults.json';

/** Dir names of every registered story vault for a mythos root, or empty on any read failure. */
function registeredStoryVaultDirNames(mythosRoot: string): Set<string> {
  try {
    const raw = fs.readFileSync(path.join(mythosRoot, STORY_VAULT_REGISTRY_FILENAME), 'utf-8');
    const parsed = JSON.parse(raw) as { vaults?: Array<{ dirName?: unknown }> };
    const names = (parsed.vaults ?? [])
      .map((v) => v.dirName)
      .filter((d): d is string => typeof d === 'string');
    return new Set(names);
  } catch {
    return new Set();
  }
}

/**
 * Given a configured Story Vault root, return the enclosing MythosVault root
 * when (and only when) the root is a recognized story vault of a v2 vault.
 * Returns null for every v0.4 layout.
 *
 * SKY-11169: the registry (story-vaults.json) lets one mythos vault hold
 * MULTIPLE story vaults with non-default dir names (e.g. "Second World").
 * The default `Story Vault` dirname always gates (works before the registry
 * file exists, i.e. pre-migration); any other dirname gates only when it is
 * REGISTERED for this mythos root — an unrelated sibling folder that merely
 * sits beside mythos.json still never gates (preserves the SKY-11132 guard
 * that "Open Vault Folder" can't silently adopt an unrecognized folder).
 */
export function mythosRootForStoryVault(storyVaultRoot: string): string | null {
  const parent = path.dirname(storyVaultRoot);
  if (parent === storyVaultRoot) return null;
  if (!isMythosV2Root(parent)) return null;
  const basename = path.basename(storyVaultRoot);
  if (basename === STORY_VAULT_DIRNAME) return parent;
  return registeredStoryVaultDirNames(parent).has(basename) ? parent : null;
}

/**
 * THE VERSION GATE for the legacy Manifest path.
 *
 * v0.4 vault  → `<storyVaultRoot>/manifest.json` (unchanged behavior).
 * v2 vault    → `<storyVaultRoot>/.mythos/manifest-cache.json` — a regenerable
 *               cache; canonical structure lives in mythos.json/book.md/scene
 *               frontmatter and is re-synced on every manifest write.
 */
export function resolveManifestPath(storyVaultRoot: string): string {
  if (mythosRootForStoryVault(storyVaultRoot) !== null) {
    return manifestCachePathFor(storyVaultRoot);
  }
  return path.join(storyVaultRoot, 'manifest.json');
}

// ─── Seed-once marker helpers (mythos.json half of the W0.1 guarantee) ──────

/** Record the seed decision in mythos.json (no-op if already recorded). */
export function recordSeedInMythosFile(
  mythosRoot: string,
  info: { layout: string; mode: 'default' | 'blank' },
): void {
  const file = tryReadMythosFile(mythosRoot);
  if (!file || file.seed) return;
  file.seed = { layout: info.layout, mode: info.mode, seededAt: new Date().toISOString() };
  writeMythosFile(mythosRoot, file);
}

export function hasSeedRecord(mythosRoot: string): boolean {
  return tryReadMythosFile(mythosRoot)?.seed != null;
}
