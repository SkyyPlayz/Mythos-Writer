// Manifest v1 schema — migration framework and atomic I/O.
// No Electron dependency; fully testable in Node.
import fs from 'fs';
import type { Manifest } from './ipc.js';

export const SCHEMA_VERSION = 1 as const;

type Raw = Record<string, unknown>;

interface Migration {
  toVersion: number;
  migrate: (m: Raw) => Raw;
}

// Each entry upgrades from (toVersion - 1) to toVersion.
// The v0→v1 step covers any legacy file that lacks schemaVersion.
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
 * Atomic write: serialise to a temp file then rename into place.
 * A process crash after writeFileSync but before renameSync leaves the
 * original file intact (the .tmp is orphaned but harmless).
 */
export function writeManifestAtomic(manifestPath: string, manifest: Manifest): void {
  const tmp = `${manifestPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf-8');
  fs.renameSync(tmp, manifestPath);
}

/**
 * Read the manifest, run any pending migrations, and write back atomically
 * if the schema was upgraded. Returns the up-to-date manifest.
 *
 * Throws ManifestVersionError (recoverable) if the on-disk version is newer
 * than SCHEMA_VERSION — the file is never modified in that case.
 */
export function openManifest(manifestPath: string): Manifest {
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Raw;
  const currentVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  if (currentVersion > SCHEMA_VERSION) {
    throw new ManifestVersionError(currentVersion);
  }
  if (currentVersion < SCHEMA_VERSION) {
    const migrated = migrateManifest(raw);
    writeManifestAtomic(manifestPath, migrated);
    return migrated;
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
      const abs = s.path.startsWith('/') ? s.path : `${vaultRoot}/${s.path}`;
      if (fs.existsSync(abs)) return true;
      pruned.push(s.path);
      return false;
    });

  const cleanedScenes = filterScenes(manifest.scenes);

  const cleanedStories = manifest.stories.map((story) => ({
    ...story,
    chapters: story.chapters.map((ch) => ({
      ...ch,
      scenes: filterScenes(ch.scenes),
    })),
  }));

  const cleanedChapters = manifest.chapters.map((ch) => ({
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
