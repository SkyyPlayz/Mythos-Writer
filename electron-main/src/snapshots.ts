// Per-scene snapshot storage using vault `.snapshots/<sceneId>/` subfolder.
// Each snapshot is a JSON file; newest-first order; pruned by count and age.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { EventEmitter } from 'events';

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
    const sceneDir = path.join(snapshotsRoot, entry);
    try {
      if (!fs.statSync(sceneDir).isDirectory()) continue;
    } catch { continue; }
    for (const f of fs.readdirSync(sceneDir).filter((f) => f.endsWith('.json'))) {
      try { fs.unlinkSync(path.join(sceneDir, f)); total++; } catch { /* ignore */ }
    }
  }
  return total;
}

function pruneOldSnapshots(dir: string, retention: SnapshotRetention): void {
  const cutoff = retention.maxAgeDays > 0
    ? new Date(Date.now() - retention.maxAgeDays * 24 * 60 * 60 * 1000)
    : null;

  // Age-based pruning: remove files whose stored createdAt is before the cutoff
  if (cutoff) {
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const fullPath = path.join(dir, f);
      try {
        const snap = JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as SceneSnapshot;
        if (new Date(snap.createdAt) < cutoff) {
          fs.unlinkSync(fullPath);
        }
      } catch { /* ignore corrupt files */ }
    }
  }

  // Count-based pruning: keep newest maxPerScene files
  if (retention.maxPerScene > 0) {
    const remaining = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    if (remaining.length > retention.maxPerScene) {
      for (const f of remaining.slice(0, remaining.length - retention.maxPerScene)) {
        try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
      }
    }
  }
}
