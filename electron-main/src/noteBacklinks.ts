// SKY-203: Note-level backlinks — pure logic extracted for testability
import path from 'path';
import { listVaultFiles, readVaultFile } from './vault.js';
import type { NoteBacklinkEntry } from './ipc.js';

/**
 * Scan all markdown files in `notesVaultRoot` for [[wikilinks]] that reference
 * `notePath` by stem (filename without `.md`).  Returns entries sorted by path.
 *
 * Matching rules:
 *   - [[stem]]           — exact stem match (case-insensitive)
 *   - [[stem|alias]]     — piped alias; only the target side is compared
 *   - [[folder/stem]]    — last segment is compared against the stem
 *
 * Self-links (when a file's path equals `notePath`) are excluded.
 */
export function getNoteBacklinks(
  notesVaultRoot: string,
  notePath: string,
): { notePath: string; backlinks: NoteBacklinkEntry[] } {
  if (!notePath) return { notePath: '', backlinks: [] };

  const stem = path.basename(notePath, '.md');
  // Regex: [[stem]] or [[stem|...]] or [[.../stem]] or [[.../stem|...]]
  // Uses a non-greedy match for the part after the stem so we stop at the first | or ]
  const escapedStem = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `\\[\\[(?:[^[\\]]*\\/)?${escapedStem}(?:\\|[^\\]]*)?\\]\\]`,
    'i',
  );

  const { items } = listVaultFiles(notesVaultRoot);
  const backlinks: NoteBacklinkEntry[] = [];

  for (const item of items) {
    if (item.isDirectory) continue;
    if (!item.name.endsWith('.md')) continue;
    if (item.path === notePath) continue;

    let content: string;
    try {
      ({ content } = readVaultFile(notesVaultRoot, item.path));
    } catch {
      continue;
    }

    const match = pattern.exec(content);
    if (!match) continue;

    const idx = match.index;
    const start = Math.max(0, idx - 60);
    const end = Math.min(content.length, idx + match[0].length + 60);
    const snippet = content.slice(start, end).replace(/\n+/g, ' ').trim();

    backlinks.push({
      path: item.path,
      name: path.basename(item.path, '.md'),
      snippet,
    });
  }

  backlinks.sort((a, b) => a.path.localeCompare(b.path));
  return { notePath, backlinks };
}
