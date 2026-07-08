// Per-scene snapshot storage using vault `.snapshots/<sceneId>/` subfolder.
// Each snapshot is a JSON file; newest-first order; pruned by count and age.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { isUnderRoot } from './pathSecurity.js';

/** Emits 'snapshot-saved' (payload: SceneSnapshot) after each successful write. */
export const snapshotEvents = new EventEmitter();

export interface SceneSnapshot {
  id: string;
  sceneId: string;
  content: string;
  contentHash: string;
  wordCount: number;
  createdAt: string;
  /** Human-readable name; set on manual saves and special triggers like exports. */
  label?: string;
}

export interface SnapshotRetention {
  /** Maximum snapshots to keep per scene. 0 = unlimited. */
  maxPerScene: number;
  /** Delete snapshots older than this many days. 0 = disabled. */
  maxAgeDays: number;
}

const DEFAULT_RETENTION: SnapshotRetention = { maxPerScene: 100, maxAgeDays: 30 };

// Monotonically incrementing sequence counter ensures filenames sort in creation order
// even when multiple snapshots are taken within the same millisecond.
let _seq = 0;

// Allowlist: UUIDs (the actual format) and any safe alphanumeric/hyphen/underscore id.
const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/;

function safeSnapshotDir(vaultRoot: string, sceneId: string): string {
  if (!SAFE_ID_RE.test(sceneId)) throw new Error(`Invalid sceneId: ${sceneId}`);
  const snapshotsRoot = path.resolve(vaultRoot, '.snapshots');
  const resolved = path.resolve(snapshotsRoot, sceneId);
  const rootWithSep = snapshotsRoot.endsWith(path.sep) ? snapshotsRoot : `${snapshotsRoot}${path.sep}`;
  if (resolved !== snapshotsRoot && !resolved.startsWith(rootWithSep)) {
    throw new Error(`Invalid sceneId: ${sceneId}`);
  }
  return resolved;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function saveSnapshot(
  vaultRoot: string,
  sceneId: string,
  content: string,
  retention?: Partial<SnapshotRetention>,
  label?: string,
): SceneSnapshot {
  const dir = safeSnapshotDir(vaultRoot, sceneId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const contentHash = crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
  const snapshot: SceneSnapshot = {
    id: crypto.randomUUID(),
    sceneId,
    content,
    contentHash,
    wordCount: countWords(content),
    createdAt: new Date().toISOString(),
    ...(label ? { label } : {}),
  };

  // Filename sortable by creation time; seq suffix breaks ties within the same millisecond
  const safestamp = snapshot.createdAt.replace(/[:.]/g, '-');
  const seq = (++_seq).toString().padStart(8, '0');
  const filename = `${safestamp}_${seq}_${snapshot.id}.json`;
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(snapshot), 'utf-8');

  pruneOldSnapshots(dir, { ...DEFAULT_RETENTION, ...retention });
  snapshotEvents.emit('snapshot-saved', snapshot);
  return snapshot;
}

export function listSnapshots(vaultRoot: string, sceneId: string): SceneSnapshot[] {
  const dir = safeSnapshotDir(vaultRoot, sceneId);
  if (!fs.existsSync(dir)) return [];

  // Sort filenames descending (timestamp_seq guarantees creation order) then parse.
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort((a, b) => b.localeCompare(a))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as SceneSnapshot;
      } catch {
        return null;
      }
    })
    .filter((s): s is SceneSnapshot => s !== null);
}

export function getSnapshot(vaultRoot: string, sceneId: string, snapshotId: string): SceneSnapshot | null {
  return listSnapshots(vaultRoot, sceneId).find((s) => s.id === snapshotId) ?? null;
}

/**
 * Deletes a specific snapshot by ID. Uses the filename suffix `_<id>.json`
 * to locate the file without parsing every JSON entry.
 * Returns true if the file was deleted, false if it was not found.
 */
export function deleteSnapshot(vaultRoot: string, sceneId: string, snapshotId: string): boolean {
  if (!SAFE_ID_RE.test(snapshotId)) throw new Error(`Invalid snapshotId: ${snapshotId}`);
  const dir = safeSnapshotDir(vaultRoot, sceneId);
  if (!fs.existsSync(dir)) return false;
  const suffix = `_${snapshotId}.json`;
  const matched = fs.readdirSync(dir).filter((f) => f.endsWith(suffix));
  if (matched.length === 0) return false;
  try {
    fs.unlinkSync(path.join(dir, matched[0]));
    return true;
  } catch {
    return false;
  }
}

/** Deletes all snapshots for a single scene. Returns count deleted. */
export function deleteAllSnapshotsForScene(vaultRoot: string, sceneId: string): number {
  const dir = safeSnapshotDir(vaultRoot, sceneId);
  if (!fs.existsSync(dir)) return 0;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  let count = 0;
  for (const f of files) {
    try { fs.unlinkSync(path.join(dir, f)); count++; } catch { /* ignore */ }
  }
  return count;
}

/** Deletes all snapshots across every scene in the vault. Returns total count deleted. */
export function deleteAllSnapshotsVault(vaultRoot: string): number {
  const snapshotsRoot = path.resolve(vaultRoot, '.snapshots');
  if (!fs.existsSync(snapshotsRoot)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(snapshotsRoot)) {
    // Use lstatSync (not statSync) so symlinks are not followed.
    const sceneDir = path.join(snapshotsRoot, entry);
    try {
      const lstat = fs.lstatSync(sceneDir);
      if (lstat.isSymbolicLink() || !lstat.isDirectory()) continue;
    } catch { continue; }
    // Defense in depth: skip any entry that somehow resolves outside snapshotsRoot.
    if (!isUnderRoot(snapshotsRoot, entry)) continue;
    for (const f of fs.readdirSync(sceneDir).filter((f) => f.endsWith('.json'))) {
      try { fs.unlinkSync(path.join(sceneDir, f)); total++; } catch { /* ignore */ }
    }
  }
  return total;
}

/**
 * Parse the snapshot creation time from its filename. saveSnapshot encodes
 * createdAt as the first `_`-delimited segment with ':' and '.' replaced by
 * '-' (e.g. `2026-07-08T12-34-56-789Z_00000001_<uuid>.json`).
 * Returns null when the filename does not match, so callers can fall back to
 * reading the JSON payload.
 */
function parseCreatedAtFromFilename(filename: string): Date | null {
  const stamp = filename.split('_')[0];
  const m = stamp.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{1,3})Z$/);
  if (!m) return null;
  const date = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Perf audit P2: this runs on EVERY scene save. It previously readFileSync +
// JSON.parse'd every snapshot file just to read createdAt — O(total snapshot
// bytes) of synchronous main-process I/O per save. The filename already
// encodes the timestamp, so derive age from it and only fall back to reading
// the file when the filename doesn't parse. A single readdirSync feeds both
// the age and count branches. Behavior is otherwise identical.
function pruneOldSnapshots(dir: string, retention: SnapshotRetention): void {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

  const cutoff = retention.maxAgeDays > 0
    ? new Date(Date.now() - retention.maxAgeDays * 24 * 60 * 60 * 1000)
    : null;

  // Age-based pruning: remove files created before the cutoff.
  let remaining = files;
  if (cutoff) {
    remaining = [];
    for (const f of files) {
      const fullPath = path.join(dir, f);
      let createdAt = parseCreatedAtFromFilename(f);
      if (!createdAt) {
        // Fallback (legacy/renamed files): read the stored createdAt.
        try {
          const snap = JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as SceneSnapshot;
          const parsed = new Date(snap.createdAt);
          if (!Number.isNaN(parsed.getTime())) createdAt = parsed;
        } catch { /* ignore corrupt files — kept, as before */ }
      }
      if (createdAt && createdAt < cutoff) {
        try {
          fs.unlinkSync(fullPath);
          continue;
        } catch { /* ignore — treat as still present */ }
      }
      remaining.push(f);
    }
  }

  // Count-based pruning: keep newest maxPerScene files (filenames sort in creation order).
  if (retention.maxPerScene > 0 && remaining.length > retention.maxPerScene) {
    for (const f of remaining.slice(0, remaining.length - retention.maxPerScene)) {
      try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
    }
  }
}
