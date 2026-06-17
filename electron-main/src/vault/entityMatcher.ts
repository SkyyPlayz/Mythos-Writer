// Entity matching — case-insensitive substring matching for Continuity Peek.
// No IPC, no filesystem calls; pure functions.
import type { EntityIndexEntry } from './entityIndex.js';

export type { EntityIndexEntry };

function matchScore(query: string, name: string): number {
  const q = query.toLowerCase();
  const n = name.toLowerCase();
  if (n === q) return 3;
  if (n.startsWith(q)) return 2;
  if (n.includes(q)) return 1;
  return 0;
}

function entryMatchScore(selectedText: string, entry: EntityIndexEntry): number {
  const candidates = [entry.name, ...entry.aliases];
  let best = 0;
  for (const candidate of candidates) {
    const score = matchScore(selectedText, candidate);
    if (score > best) best = score;
  }
  return best;
}

export function findBestMatch(
  selectedText: string,
  index: EntityIndexEntry[],
): EntityIndexEntry | null {
  const text = selectedText.trim();
  if (!text) return null;

  let bestEntry: EntityIndexEntry | null = null;
  let bestScore = 0;
  let bestNameLen = 0;

  for (const entry of index) {
    const score = entryMatchScore(text, entry);
    if (score === 0) continue;

    const nameLen = Math.max(entry.name.length, ...entry.aliases.map((a) => a.length));
    // Prefer higher score; break ties by longer (more specific) name.
    if (score > bestScore || (score === bestScore && nameLen > bestNameLen)) {
      bestEntry = entry;
      bestScore = score;
      bestNameLen = nameLen;
    }
  }

  return bestEntry;
}

export function searchEntities(
  query: string,
  index: EntityIndexEntry[],
): EntityIndexEntry[] {
  const q = query.trim();
  if (!q) return [];

  const scored: Array<{ entry: EntityIndexEntry; score: number }> = [];

  for (const entry of index) {
    const score = entryMatchScore(q, entry);
    if (score > 0) scored.push({ entry, score });
  }

  scored.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));

  return scored.slice(0, 10).map((s) => s.entry);
}
