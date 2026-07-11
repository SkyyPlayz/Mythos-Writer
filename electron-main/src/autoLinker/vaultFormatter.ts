// High-level vault formatter: scan → build trie → format each note in place.
// Pure Node, no IPC.

import fs from 'node:fs';
import { writeFileAtomic } from '../vault.js';
import { scanVault } from './scanner.js';
import { buildTrie, formatContent } from './formatter.js';
import type { AutoLinkerToggles, FormatVaultResult } from './types.js';

export function formatVault(
  notesVaultRoot: string,
  toggles: AutoLinkerToggles,
): FormatVaultResult {
  const notes = scanVault(notesVaultRoot, toggles.excludedFolders);
  const trie = buildTrie(notes, toggles);

  let filesScanned = 0;
  let filesChanged = 0;
  let linksAdded = 0;

  for (const note of notes) {
    filesScanned++;
    if (note.linkerOff) continue;

    let original: string;
    try {
      original = fs.readFileSync(note.absPath, 'utf-8');
    } catch {
      continue;
    }

    const formatted = formatContent(original, note.name, trie, toggles);
    if (formatted === original) continue;

    const added = countNewLinks(original, formatted);
    writeFileAtomic(note.absPath, formatted);
    filesChanged++;
    linksAdded += added;
  }

  return { filesScanned, filesChanged, linksAdded };
}

/** Count how many [[...]] spans appear in `next` but not in `prev`. */
function countNewLinks(prev: string, next: string): number {
  const prevLinks = (prev.match(/\[\[.*?\]\]/g) ?? []).length;
  const nextLinks = (next.match(/\[\[.*?\]\]/g) ?? []).length;
  return Math.max(0, nextLinks - prevLinks);
}
