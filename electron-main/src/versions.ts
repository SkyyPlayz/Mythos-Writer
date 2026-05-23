// Per-scene prose version storage in `.versions/<sceneId>/` inside the vault.
// Each version is a plain markdown file. Filenames use a sanitized ISO timestamp
// plus a monotonic collision suffix so lexicographic order equals creation order.
import fs from 'fs';
import path from 'path';

export interface SceneVersion {
  ts: string;
  prose: string;
}

function versionDir(vaultRoot: string, sceneId: string): string {
  return path.join(vaultRoot, '.versions', sceneId);
}

export function saveVersion(vaultRoot: string, sceneId: string, prose: string): SceneVersion {
  const dir = versionDir(vaultRoot, sceneId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const safestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const existing = new Set(fs.readdirSync(dir).filter((f) => f.endsWith('.md')));

  let filename = `${safestamp}.md`;
  if (existing.has(filename)) {
    let n = 2;
    while (existing.has(`${safestamp}_${n}.md`)) n++;
    filename = `${safestamp}_${n}.md`;
  }

  const ts = filename.slice(0, -3); // strip .md
  fs.writeFileSync(path.join(dir, filename), prose, 'utf-8');
  return { ts, prose };
}

export function listVersions(vaultRoot: string, sceneId: string): SceneVersion[] {
  const dir = versionDir(vaultRoot, sceneId);
  if (!fs.existsSync(dir)) return [];

  // Plain ASCII order: '_' (95) > '.' (46), so collision-suffixed names sort before
  // the base name — i.e. newer saves come first when sorted descending.
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort((a, b) => (b > a ? 1 : b < a ? -1 : 0))
    .map((f) => ({
      ts: f.slice(0, -3),
      prose: fs.readFileSync(path.join(dir, f), 'utf-8'),
    }));
}

export function getVersion(vaultRoot: string, sceneId: string, ts: string): SceneVersion | null {
  const filePath = path.join(versionDir(vaultRoot, sceneId), `${ts}.md`);
  if (!fs.existsSync(filePath)) return null;
  return { ts, prose: fs.readFileSync(filePath, 'utf-8') };
}

export function rollbackVersion(
  vaultRoot: string,
  sceneId: string,
  ts: string,
  currentProse: string,
): { restored: SceneVersion; preRollback: SceneVersion } {
  const target = getVersion(vaultRoot, sceneId, ts);
  if (!target) throw new Error(`Version not found: ${ts}`);
  const preRollback = saveVersion(vaultRoot, sceneId, currentProse);
  return { restored: target, preRollback };
}
