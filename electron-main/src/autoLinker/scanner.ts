// Vault scanner — walks a Notes Vault directory and builds NoteEntry[].
// Pure Node, no IPC.

import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '../vault.js';
import type { NoteEntry } from './types.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function stemOf(filePath: string): string {
  return path.basename(filePath, '.md');
}

/** Convert absolute path to vault-relative forward-slash path. */
function vaultRelative(absPath: string, vaultRoot: string): string {
  return path.relative(vaultRoot, absPath).replace(/\\/g, '/');
}

function parseFrontmatterFlags(content: string): {
  aliases: string[];
  linkerOff: boolean;
  linkerExclude: string[];
  linkerScoped: boolean;
} {
  const { frontmatter } = parseFrontmatter(content);

  const rawAliases = frontmatter['aliases'];
  const aliases: string[] = Array.isArray(rawAliases)
    ? rawAliases.map(String).filter(Boolean)
    : typeof rawAliases === 'string' && rawAliases.trim()
      ? [rawAliases.trim()]
      : [];

  const linkerOff = frontmatter['automatic-linker-off'] === true;
  const linkerScoped = frontmatter['automatic-linker-scoped'] === true;

  const rawExclude = frontmatter['automatic-linker-exclude'];
  const linkerExclude: string[] = Array.isArray(rawExclude)
    ? rawExclude.map(String).filter(Boolean)
    : typeof rawExclude === 'string' && rawExclude.trim()
      ? rawExclude
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  return { aliases, linkerOff, linkerExclude, linkerScoped };
}

function listMdFiles(dir: string, excludedFolders: string[], vaultRoot: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const rel = vaultRelative(full, vaultRoot) + '/';
      const isExcluded = excludedFolders.some(
        (ex) => rel === ex || rel.startsWith(ex.endsWith('/') ? ex : ex + '/'),
      );
      if (!isExcluded) {
        results.push(...listMdFiles(full, excludedFolders, vaultRoot));
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

/** Scan the vault and return all Note entries. Date-named files are included but flagged by stem. */
export function scanVault(
  notesVaultRoot: string,
  excludedFolders: string[],
): NoteEntry[] {
  const files = listMdFiles(notesVaultRoot, excludedFolders, notesVaultRoot);
  const entries: NoteEntry[] = [];

  for (const absPath of files) {
    const name = stemOf(absPath);
    // Skip date-named files (used as daily notes etc.) from being link targets.
    if (DATE_PATTERN.test(name)) continue;

    let content = '';
    try {
      content = fs.readFileSync(absPath, 'utf-8');
    } catch {
      continue;
    }

    const { aliases, linkerOff, linkerExclude, linkerScoped } = parseFrontmatterFlags(content);

    entries.push({
      name,
      vaultRelPath: vaultRelative(absPath, notesVaultRoot),
      absPath,
      aliases,
      linkerOff,
      linkerExclude,
      linkerScoped,
    });
  }

  return entries;
}
