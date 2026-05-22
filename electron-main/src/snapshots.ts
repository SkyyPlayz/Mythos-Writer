// Per-scene snapshot storage using vault `.snapshots/<sceneId>/` subfolder.
// Each snapshot is a JSON file; newest-first order; hard cap at MAX_PER_SCENE.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface SceneSnapshot {
  id: string;
  sceneId: string;
  content: string;
  wordCount: number;
  createdAt: string;
}

const MAX_PER_SCENE = 50;

function snapshotDir(vaultRoot: string, sceneId: string): string {
  return path.join(vaultRoot, '.snapshots', sceneId);
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function saveSnapshot(vaultRoot: string, sceneId: string, content: string): SceneSnapshot {
  const dir = snapshotDir(vaultRoot, sceneId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const snapshot: SceneSnapshot = {
    id: crypto.randomUUID(),
    sceneId,
    content,
    wordCount: countWords(content),
    createdAt: new Date().toISOString(),
  };

  // Filename sortable by creation time
  const safestamp = snapshot.createdAt.replace(/[:.]/g, '-');
  const filename = `${safestamp}_${snapshot.id}.json`;
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(snapshot), 'utf-8');

  pruneOldSnapshots(dir);
  return snapshot;
}

export function listSnapshots(vaultRoot: string, sceneId: string): SceneSnapshot[] {
  const dir = snapshotDir(vaultRoot, sceneId);
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as SceneSnapshot;
      } catch {
        return null;
      }
    })
    .filter((s): s is SceneSnapshot => s !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getSnapshot(vaultRoot: string, sceneId: string, snapshotId: string): SceneSnapshot | null {
  return listSnapshots(vaultRoot, sceneId).find((s) => s.id === snapshotId) ?? null;
}

function pruneOldSnapshots(dir: string): void {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (files.length > MAX_PER_SCENE) {
    for (const f of files.slice(0, files.length - MAX_PER_SCENE)) {
      try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
    }
  }
}
