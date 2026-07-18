// Manifest schema — migration framework and atomic I/O.
// No Electron dependency; fully testable in Node.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Manifest, SceneEntry, ChapterEntry, BlockEntry } from './ipc.js';
import { computeSceneBodyLayout } from './sceneBody.js';

export const SCHEMA_VERSION = 2 as const;

type Raw = Record<string, unknown>;

interface Migration {
  toVersion: number;
  migrate: (m: Raw) => Raw;
}

// Each entry upgrades from (toVersion - 1) to toVersion.
// The v0→v1 step covers any legacy file that lacks schemaVersion.
// The v1→v2 step (SKY-6596 / GH #893) is a bookkeeping bump only: it does not
// touch scene prose itself. Prose is dropped from disk generically by
// `writeManifestAtomic` (see `stripEmbeddedProseForPersist`) regardless of
// schema version — the migration step exists so that any vault still on v1
// gets a guaranteed pre-write backup (via `openManifest`'s existing
// backup-before-migrate path) before its manifest is ever rewritten under the
// new write behavior.
const migrations: Migration[] = [
  {
    toVersion: 1,
    migrate: (m) => ({
      ...m,
      schemaVersion: 1,
      provenance: (m.provenance as Record<string, string>) ?? {},
      boardReferences: (m.boardReferences as string[]) ?? [],
      migratedAt: new Date().toISOString(),
    }),
  },
  {
    toVersion: 2,
    migrate: (m) => ({
      ...m,
      schemaVersion: 2,
    }),
  },
];

/** Thrown when the manifest declares a schemaVersion newer than this build supports. */
export class ManifestVersionError extends Error {
  constructor(public readonly foundVersion: number) {
    super(
      `Manifest schemaVersion ${foundVersion} is newer than this build supports (max ${SCHEMA_VERSION}). ` +
        'Upgrade the application or restore from backup.'
    );
    this.name = 'ManifestVersionError';
  }
}

/**
 * Thrown when a migration fails (including corrupted/unparseable manifests).
 * Always includes the path of the pre-migration backup so the user can recover.
 */
export class ManifestMigrationError extends Error {
  constructor(
    public readonly fromVersion: number,
    public readonly backupPath: string,
    cause?: Error
  ) {
    super(
      `Manifest migration from v${fromVersion} failed. ` +
        `A backup was saved to: ${backupPath}` +
        (cause ? `\nCause: ${cause.message}` : '')
    );
    this.name = 'ManifestMigrationError';
  }
}

export interface OpenManifestOptions {
  /** Vault root used to derive the backup directory (.mythos/backups). Defaults to dirname(manifestPath). */
  vaultRoot?: string;
  /** Called after a successful migration with details for audit logging. */
  onMigrated?: (entry: {
    id: string;
    fromVersion: number;
    toVersion: number;
    backupPath: string;
    createdAt: string;
  }) => void;
  /**
   * SKY-6596: called with the migrated manifest right before the one-shot
   * migration write-back, so a caller with filesystem access to the vault's
   * scene files can guarantee every scene's embedded prose has a durable
   * `.md` home *before* `writeManifestAtomic` strips that prose from disk.
   * This module has no vault-file-I/O dependency itself (kept fully testable
   * in Node with no Electron/vault coupling), so the recovery write is
   * injected by the caller (see `ensureSceneFilesForManifestScenes` in
   * vault.ts) rather than performed here.
   */
  beforeMigrationWrite?: (manifest: Manifest, vaultRoot: string) => Manifest;
}

/** Write the raw manifest content to .mythos/backups/manifest-<timestamp>.json and return the backup path. */
function writeBackup(vaultRoot: string, rawContent: string): string {
  const backupDir = path.join(vaultRoot, '.mythos', 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `manifest-${timestamp}.json`);
  fs.writeFileSync(backupPath, rawContent, 'utf-8');
  return backupPath;
}

/** Pure migration: apply all pending steps in order. No I/O. */
export function migrateManifest(raw: Raw): Manifest {
  const currentVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  let current = { ...raw };
  for (const mig of migrations) {
    if (mig.toVersion > currentVersion) {
      current = mig.migrate(current);
    }
  }
  return current as unknown as Manifest;
}

/**
 * Single-pass, allocation-free word count (no `split`/`match` array). This
 * runs on every scene's content on every manifest write (see
 * `computeSceneWordCount`/`stripSceneProse`) — for a several-thousand-scene
 * vault, `split(/\s+/)` materializing a token array per scene measurably
 * regressed write latency (caught by manifestPerf.test.ts's O(vault) write
 * bound). A regex-free char scan avoids that allocation entirely.
 */
function countWords(text: string): number {
  let count = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    // ASCII whitespace: space, tab, LF, VT, FF, CR. Matches the practical
    // range of `\s` for authored prose without the array-allocating regex.
    const isSpace = c === 32 || c === 9 || c === 10 || c === 11 || c === 12 || c === 13;
    if (isSpace) {
      inWord = false;
    } else if (!inWord) {
      inWord = true;
      count++;
    }
  }
  return count;
}

// SKY-6195: per-block word-count memo, keyed by block object identity *and*
// a snapshot of the content it was computed from. Blocks are NOT uniformly
// immutable: `scene:save` (main.ts) mutates `proseBlock.content` on the
// existing block object in place rather than replacing it, so identity alone
// is not a safe cache key — it would silently keep serving a stale count for
// every actively-edited scene after its first save. Storing the content
// alongside the count and comparing on read fixes that: an in-place edit
// invalidates the entry (content !== cached.content), while an unchanged
// block hits V8's pointer-equality fast path for identical string references
// and stays effectively O(1). This is what makes a vault-wide write only
// re-scan the handful of blocks that actually changed since the last write,
// instead of every hydrated scene's full prose every time — the O(vault)
// cost this WeakMap avoids is CPU (word counting), not disk bytes, which
// stripEmbeddedProseForPersist already keeps flat.
const blockWordCountCache = new WeakMap<BlockEntry, { content: string; count: number }>();

function cachedBlockWordCount(b: BlockEntry): number {
  const cached = blockWordCountCache.get(b);
  if (cached !== undefined && cached.content === b.content) return cached.count;
  const count = countWords(b.content);
  blockWordCountCache.set(b, { content: b.content, count });
  return count;
}

/**
 * SKY-6195: total word count across a scene's blocks, summed per-block (not
 * on the concatenated body) so words never merge across a block boundary
 * that has no whitespace of its own.
 */
function computeSceneWordCount(blocks: BlockEntry[]): number {
  return blocks.reduce((total, b) => total + cachedBlockWordCount(b), 0);
}

function stripSceneProse(scene: SceneEntry): SceneEntry {
  if (!scene.blocks || scene.blocks.length === 0) {
    return scene.wordCount === 0 ? scene : { ...scene, wordCount: 0 };
  }
  // Block-aware persistence (PR #932 review): alongside blanking content,
  // record each block's serialized-segment length within the scene's `.md`
  // body (`bodySegLen`) so `readManifest` can hydrate all N blocks — content,
  // type, id, and order intact — instead of dumping the whole raw body into
  // the first prose block. The lengths are derived arithmetically (no body
  // string is built, no file I/O — see computeSceneBodyLayout), so the write
  // stays O(structure) and the metadata is still structure-only in spirit:
  // a few machine-derived bytes per block.
  const { segments } = computeSceneBodyLayout(scene.blocks);
  const lengthByIndex = new Map<number, number>();
  for (const seg of segments) lengthByIndex.set(seg.index, seg.length);
  // SKY-6195: computed from the still-populated `blocks[].content` — before
  // it's blanked below — and persisted as a structural field alongside
  // `bodySegLen`, so it stays in sync with the last-saved prose on every write.
  const wordCount = computeSceneWordCount(scene.blocks);
  let changed = scene.wordCount !== wordCount;
  const blocks = scene.blocks.map((b, i) => {
    const bodySegLen = lengthByIndex.get(i);
    if (b.content === '' && b.bodySegLen === bodySegLen) return b;
    changed = true;
    const next: BlockEntry = { ...b, content: '' };
    if (bodySegLen === undefined) delete next.bodySegLen;
    else next.bodySegLen = bodySegLen;
    return next;
  });
  return changed ? { ...scene, blocks, wordCount } : scene;
}

function stripChapterProse(chapter: ChapterEntry): ChapterEntry {
  return { ...chapter, scenes: (chapter.scenes ?? []).map(stripSceneProse) };
}

/**
 * Structure-only persistence (SKY-6596 / GH #893). Scene prose lives in each
 * scene's `.md` file — always written before, or as part of, any manifest
 * write that carries fresh prose (`scene:save`, boot-migration recovery via
 * `beforeMigrationWrite`). Stripping `blocks[].content` here — unconditionally,
 * on every write, regardless of caller — keeps `manifest.json` O(structure)
 * instead of O(vault): this is what makes `scene:save` stop re-serializing
 * every scene's prose on every keystroke-flush. Each stripped block also
 * records its serialized-segment boundary (`bodySegLen`, see stripSceneProse)
 * so readManifest can hydrate multi-block scenes losslessly. Returns a new
 * object; never mutates the caller's manifest (`scene:save` keeps its own
 * hydrated in-memory copy, with content intact, for its save-to-save cache).
 */
export function stripEmbeddedProseForPersist(manifest: Manifest): Manifest {
  return {
    ...manifest,
    stories: (manifest.stories ?? []).map((story) => ({
      ...story,
      chapters: (story.chapters ?? []).map(stripChapterProse),
    })),
    chapters: (manifest.chapters ?? []).map(stripChapterProse),
    scenes: (manifest.scenes ?? []).map(stripSceneProse),
  };
}

/**
 * Atomic write: serialise to a temp file then rename into place.
 * A process crash after writeFileSync but before renameSync leaves the
 * original file intact (the .tmp is orphaned but harmless).
 *
 * Returns the byte length of the content actually written, so callers that
 * need a byte count (e.g. the VAULT_MANIFEST_WRITE IPC response) don't have
 * to re-serialize the manifest a second time just to measure it (SKY-6195).
 */
export function writeManifestAtomic(manifestPath: string, manifest: Manifest): number {
  const tmp = `${manifestPath}.tmp`;
  // Compact, structure-only serialization (SKY-6596): scene prose is stripped
  // (see stripEmbeddedProseForPersist) so this write is O(structure), not
  // O(vault) — safe to run on every save. Compact (non-pretty) formatting is
  // kept for the same reason pretty-printing was dropped originally: this is
  // a machine-managed file, and pretty printing still costs real time on a
  // large story count even without embedded prose.
  const persisted = stripEmbeddedProseForPersist(manifest);
  const json = JSON.stringify(persisted);
  fs.writeFileSync(tmp, json, 'utf-8');
  fs.renameSync(tmp, manifestPath);
  return Buffer.byteLength(json, 'utf-8');
}

/**
 * Read the manifest, run any pending migrations, and write back atomically
 * if the schema was upgraded. Returns the up-to-date manifest.
 *
 * Before migrating: snapshots the original file to `.mythos/backups/manifest-<timestamp>.json`.
 * After migrating: calls `options.onMigrated` so callers can persist an audit log entry.
 *
 * Throws ManifestVersionError if the on-disk version is newer than SCHEMA_VERSION (file untouched).
 * Throws ManifestMigrationError (with backupPath) if parsing or migration fails.
 */
export function openManifest(manifestPath: string, options?: OpenManifestOptions): Manifest {
  const vaultRoot = options?.vaultRoot ?? path.dirname(manifestPath);

  let rawContent: string;
  try {
    rawContent = fs.readFileSync(manifestPath, 'utf-8');
  } catch (err) {
    throw err;
  }

  let raw: Raw;
  try {
    raw = JSON.parse(rawContent) as Raw;
  } catch (parseErr) {
    const backupPath = writeBackup(vaultRoot, rawContent);
    throw new ManifestMigrationError(0, backupPath, parseErr as Error);
  }

  const currentVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  if (currentVersion > SCHEMA_VERSION) {
    throw new ManifestVersionError(currentVersion);
  }
  if (currentVersion < SCHEMA_VERSION) {
    const backupPath = writeBackup(vaultRoot, rawContent);
    try {
      let migrated = migrateManifest(raw);
      // SKY-6596: give the caller a chance to write a recovered `.md` for any
      // scene whose embedded prose has no durable file backing yet, before
      // the write below (via writeManifestAtomic) unconditionally strips
      // that prose from the manifest. The pre-migration backup just written
      // above still holds the original prose regardless, but this avoids
      // ever relying on manual backup recovery for the common case.
      if (options?.beforeMigrationWrite) {
        migrated = options.beforeMigrationWrite(migrated, vaultRoot);
      }
      writeManifestAtomic(manifestPath, migrated);
      if (options?.onMigrated) {
        options.onMigrated({
          id: crypto.randomUUID(),
          fromVersion: currentVersion,
          toVersion: SCHEMA_VERSION,
          backupPath,
          createdAt: new Date().toISOString(),
        });
      }
      return migrated;
    } catch (err) {
      if (err instanceof ManifestMigrationError) throw err;
      throw new ManifestMigrationError(currentVersion, backupPath, err as Error);
    }
  }
  return raw as unknown as Manifest;
}

export interface PruneResult {
  manifest: Manifest;
  pruned: string[];
}

/**
 * Remove scene entries (in manifest.scenes and within each chapter) whose
 * file no longer exists on disk. Returns the cleaned manifest and a list of
 * pruned scene paths for the caller to log as an audit entry.
 */
export function pruneOrphanScenes(manifest: Manifest, vaultRoot: string): PruneResult {
  const pruned: string[] = [];

  const filterScenes = (scenes: Manifest['scenes']) =>
    scenes.filter((s) => {
      const abs = path.isAbsolute(s.path) ? s.path : path.join(vaultRoot, s.path);
      if (fs.existsSync(abs)) return true;
      pruned.push(s.path);
      return false;
    });

  const cleanedScenes = filterScenes(manifest.scenes);

  const cleanedStories = (manifest.stories ?? []).map((story) => ({
    ...story,
    chapters: (story.chapters ?? []).map((ch) => ({
      ...ch,
      scenes: filterScenes(ch.scenes),
    })),
  }));

  const cleanedChapters = (manifest.chapters ?? []).map((ch) => ({
    ...ch,
    scenes: filterScenes(ch.scenes),
  }));

  return {
    manifest: {
      ...manifest,
      scenes: cleanedScenes,
      stories: cleanedStories,
      chapters: cleanedChapters,
    },
    pruned,
  };
}
