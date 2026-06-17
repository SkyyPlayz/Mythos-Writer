// Entity index builder — scans Notes Vault directories to build a flat lookup array.
// Rebuilt on each panel open (no persistent cache per AC-CC-07).
import fs from 'fs';
import path from 'path';
import { parseEntityFrontmatter } from './entityFrontmatterParser.js';

export interface EntityIndexEntry {
  name: string;
  aliases: string[];
  type: string | null;
  path: string;
}

function stemOf(filePath: string): string {
  return path.basename(filePath, '.md');
}

function listMdFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listMdFilesRecursive(full));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

export function buildEntityIndex(notesVaultRoot: string): EntityIndexEntry[] {
  const searchDirs = [
    path.join(notesVaultRoot, 'Universes'),
    path.join(notesVaultRoot, 'Stories'),
  ];

  const entries: EntityIndexEntry[] = [];

  for (const dir of searchDirs) {
    const files = listMdFilesRecursive(dir);
    for (const filePath of files) {
      let content = '';
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }
      const { aliases, type } = parseEntityFrontmatter(content);
      entries.push({
        name: stemOf(filePath),
        aliases,
        type,
        path: filePath,
      });
    }
  }

  return entries;
}
