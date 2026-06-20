// SKY-3026: Outline planning surface — data model + persistence helpers.
// Pure filesystem logic; no Electron imports so this is unit-testable in Node.
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface OutlineNode {
  id: string;
  title: string;
  notes?: string;
  linkedSceneId?: string;
  children: OutlineNode[];
}

export interface OutlineData {
  storyId: string;
  schemaVersion: 1;
  nodes: OutlineNode[];
}

const OUTLINE_FILENAME = 'outline-nodes.json';

/**
 * Reads outline-nodes.json from the given story vault directory.
 * Returns null when the file is absent or unparseable.
 */
export function loadOutline(storyVaultPath: string): OutlineData | null {
  const p = path.join(storyVaultPath, OUTLINE_FILENAME);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as OutlineData;
  } catch {
    return null;
  }
}

/**
 * Atomically writes OutlineData as JSON to outline-nodes.json inside
 * storyVaultPath. Uses a .tmp side-file + rename for crash safety.
 */
export function saveOutline(storyVaultPath: string, data: OutlineData): void {
  const p = path.join(storyVaultPath, OUTLINE_FILENAME);
  const tmpPath = `${p}.tmp`;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, p);
}
