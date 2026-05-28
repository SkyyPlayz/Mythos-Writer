// Per-scene draft history: .versions/<sceneId>/<ts>.md inside vault.
// Each file stores raw prose markdown; filenames embed a monotonic sequence counter so files
// sort in creation order even when multiple saves land in the same millisecond.
import fs from 'fs';
import path from 'path';

// Monotonically incrementing counter ensures lexicographic filename order == creation order.
let _seq = 0;

export interface SceneVersion {
  sceneId: string;
  /** Filename stem — sanitized ISO timestamp + sequence, e.g. "2026-05-23T12-00-00-000Z_00000001". */
  ts: string;
  content: string;
}

// Allowlist: UUIDs (the actual format) and any safe alphanumeric/hyphen/underscore id.
// Also covers ts strings (ISO stamp + seq, separators replaced with hyphens).
const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/;

function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID_RE.test(value)) throw new Error(`Invalid ${label}: ${value}`);
}

function safeVersionsDir(vaultRoot: string, sceneId: string): string {
  assertSafeId(sceneId, 'sceneId');
  const versionsRoot = path.resolve(vaultRoot, '.versions');
  const resolved = path.resolve(versionsRoot, sceneId);
  const rootWithSep = versionsRoot.endsWith(path.sep) ? versionsRoot : `${versionsRoot}${path.sep}`;
  if (resolved !== versionsRoot && !resolved.startsWith(rootWithSep)) {
    throw new Error(`Invalid sceneId: ${sceneId}`);
  }
  return resolved;
}

/** Write a new version snapshot. Returns the stored version with its ts. */
export function saveVersion(vaultRoot: string, sceneId: string, content: string): SceneVersion {
  const dir = safeVersionsDir(vaultRoot, sceneId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const seq = (++_seq).toString().padStart(8, '0');
  const ts = `${stamp}_${seq}`;
  fs.writeFileSync(path.join(dir, `${ts}.md`), content, 'utf-8');
  return { sceneId, ts, content };
}

/** List all versions for a scene, newest first. */
export function listVersions(vaultRoot: string, sceneId: string): SceneVersion[] {
  const dir = safeVersionsDir(vaultRoot, sceneId);
  if (!fs.existsSync(dir)) return [];

  // Filenames embed timestamp + padded seq, so reverse lexicographic == newest-first.
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .map((f) => {
      const ts = f.slice(0, -3);
      try {
        return { sceneId, ts, content: fs.readFileSync(path.join(dir, f), 'utf-8') };
      } catch {
        return null;
      }
    })
    .filter((v): v is SceneVersion => v !== null);
}

/** Get a specific version by its ts string. Returns null if not found. */
export function getVersion(vaultRoot: string, sceneId: string, ts: string): SceneVersion | null {
  assertSafeId(ts, 'ts');
  const dir = safeVersionsDir(vaultRoot, sceneId);
  const fullPath = path.join(dir, `${ts}.md`);
  if (!fs.existsSync(fullPath)) return null;
  try {
    return { sceneId, ts, content: fs.readFileSync(fullPath, 'utf-8') };
  } catch {
    return null;
  }
}

/**
 * Rollback to a specific version.
 * Saves `currentContent` as a pre-rollback snapshot first, then returns both versions.
 * The caller writes restoredVersion.content to the scene file on disk.
 */
export function rollbackVersion(
  vaultRoot: string,
  sceneId: string,
  ts: string,
  currentContent: string,
): { restoredVersion: SceneVersion; preRollbackVersion: SceneVersion } {
  const target = getVersion(vaultRoot, sceneId, ts);
  if (!target) throw new Error(`Version not found for scene ${sceneId}: ${ts}`);
  const preRollbackVersion = saveVersion(vaultRoot, sceneId, currentContent);
  return { restoredVersion: target, preRollbackVersion };
}
