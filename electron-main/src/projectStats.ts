// Beta 4 M2 — per-vault stats for the title-bar Mythos-vault switcher popover
// (FULL-SPEC §4: "listing every vault with location/stats"). Pure functions —
// no Electron dependency; fully testable in Node.
import fs from 'fs';
import path from 'path';
import { mythosRootForStoryVault } from './mythosFormat/mythosJson.js';
import { ensureNotesVaultRegistry } from './mythosFormat/notesVaultRegistry.js';
import { ensureStoryVaultRegistry } from './mythosFormat/storyVaultRegistry.js';

/**
 * Hard cap on directory entries visited per root so a vault pointed at a huge
 * folder can't stall the title bar. CF-16 budgets 1,000 scenes / 5,000 notes
 * per vault; 20k entries leaves generous headroom while staying instant.
 */
const DEFAULT_VISIT_CAP = 20_000;

/**
 * Count `.md` files under `root`, applying the same skip rules as the vault
 * scanners: symlinks, dot-directories, and `versions/` snapshots are skipped.
 * Missing/unreadable directories count as 0 — the popover shows stale vaults
 * without crashing.
 */
export function countMarkdownFiles(root: string, visitCap = DEFAULT_VISIT_CAP): number {
  let count = 0;
  let visited = 0;

  function walk(dir: string): void {
    if (visited >= visitCap) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable subtree — skip, don't abort the whole count
    }
    for (const entry of entries) {
      if (visited >= visitCap) return;
      visited += 1;
      if (entry.isSymbolicLink()) continue; // may escape the vault
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue;
        if (entry.name === 'versions') continue;
        walk(path.join(dir, entry.name));
      } else if (entry.name.endsWith('.md')) {
        count += 1;
      }
    }
  }

  walk(root);
  return count;
}

export interface ProjectStatsEntry {
  vaultRoot: string;
  /** `.md` files under the Story Vault root (scenes + chapter/book metadata). */
  storyFileCount: number;
  /** `.md` files under the paired Notes Vault root; null when no pair exists. */
  noteCount: number | null;
  /** SKY-11154: inner notes-vault count for the Mythos vault owning this
   *  Story Vault. 1 for a legacy v0.4 vault (implicit single pair). */
  notesVaultCount: number;
  /** SKY-11154: inner story-vault count for the same Mythos vault. */
  storyVaultCount: number;
}

/**
 * SKY-11154 — inner notes/story vault counts for the Mythos vault root that
 * owns `storyVaultRoot`, or `{ notesVaultCount: 1, storyVaultCount: 1 }` for
 * a legacy v0.4 vault (implicit single Story Vault + Notes Vault pair) or a
 * root that cannot be resolved to a Mythos vault at all.
 */
function countInnerVaults(storyVaultRoot: string): { notesVaultCount: number; storyVaultCount: number } {
  const mythosRoot = mythosRootForStoryVault(storyVaultRoot);
  if (mythosRoot === null) return { notesVaultCount: 1, storyVaultCount: 1 };
  try {
    return {
      notesVaultCount: ensureNotesVaultRegistry(mythosRoot).vaults.length,
      storyVaultCount: ensureStoryVaultRegistry(mythosRoot).vaults.length,
    };
  } catch {
    return { notesVaultCount: 1, storyVaultCount: 1 };
  }
}

/**
 * Collect stats for each recent-project entry. Roots are deduplicated by
 * `vaultRoot` (first entry wins — callers pass the active vault first;
 * recents follow in stable registration order, SKY-11238).
 */
export function collectProjectStats(
  entries: Array<{ vaultRoot: string; notesVaultRoot?: string }>,
  visitCap = DEFAULT_VISIT_CAP,
): ProjectStatsEntry[] {
  const seen = new Set<string>();
  const out: ProjectStatsEntry[] = [];
  for (const entry of entries) {
    if (!entry.vaultRoot || seen.has(entry.vaultRoot)) continue;
    seen.add(entry.vaultRoot);
    out.push({
      vaultRoot: entry.vaultRoot,
      storyFileCount: countMarkdownFiles(entry.vaultRoot, visitCap),
      noteCount: entry.notesVaultRoot ? countMarkdownFiles(entry.notesVaultRoot, visitCap) : null,
      ...countInnerVaults(entry.vaultRoot),
    });
  }
  return out;
}
