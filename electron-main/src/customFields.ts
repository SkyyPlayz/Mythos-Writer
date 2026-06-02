// SKY-207: Per-scene custom frontmatter fields — field schema I/O
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CustomFieldDef } from './ipc.js';

const FIELDS_FILE = '.mythos/fields.json';

export function readFieldDefs(vaultRoot: string): CustomFieldDef[] {
  const filePath = path.join(vaultRoot, FIELDS_FILE);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as CustomFieldDef[];
    return [];
  } catch {
    return [];
  }
}

export function writeFieldDefs(vaultRoot: string, defs: CustomFieldDef[]): void {
  const filePath = path.join(vaultRoot, FIELDS_FILE);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  // Atomic write: temp file → rename
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(defs, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}
