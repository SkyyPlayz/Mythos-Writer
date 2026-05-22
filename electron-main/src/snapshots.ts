// Per-scene snapshot storage using vault `.snapshots/<sceneId>/` subfolder.
// Each snapshot is a JSON file; newest-first order; pruned by count and age.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface SceneSnapshot {
  id: string;
  sceneId: string;
  content: string;
  contentHash: string;
  wordCount: number;
  createdAt: string;
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

function snapshotDir(vaultRoot: string, sceneId: string): string {
  return path.join(vaultRoot, '.snapshots', sceneId);
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function saveSnapshot(
  vaultRoot: string,
  sceneId: string,
  content: string,
  retention?: Partial<SnapshotRetention>,
): SceneSnapshot {
  const dir = snapshotDir(vaultRoot, sceneId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const contentHash = crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
  const snapshot: SceneSnapshot = {
    id: crypto.randomUUID(),
    sceneId,
    content,
    contentHash,
    wordCount: countWords(content),
    createdAt: new Date().toISOString(),
  };

  // Filename sortable by creation time; seq suffix breaks ties within the same millisecond
  const safestamp = snapshot.createdAt.replace(/[:.]/g, '-');
  const seq = (++_seq).toString().padStart(8, '0');
  const filename = `${safestamp}_${seq}_${snapshot.id}.json`;
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(snapshot), 'utf-8');

  pruneOldSnapshots(dir, { ...DEFAULT_RETENTION, ...retention });
  return snapshot;
}

export function listSnapshots(vaultRoot: string, sceneId: string): SceneSnapshot[] {
  const dir = snapshotDir(vaultRoot, sceneId);
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
