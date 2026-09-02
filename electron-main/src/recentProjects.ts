// SKY-11238: stable ordering for the persisted recent-projects registry.
//
// `recentProjects` in vault-settings.json is the single source of order for
// every vault list in the app — the nav-rail tiles, the title-bar switcher,
// and Settings > Mythos vaults all render PROJECT_LIST's array verbatim. The
// registry used to be MRU (move-to-front on every open), which made the rail
// reorder under the user's pointer on every switch. Owner ruling: a vault's
// position never changes because it became active — order is registration
// order, and "active" is shown by styling alone.
//
// Rules encoded here:
//   - Re-opening a known vault updates its entry IN PLACE (fresh `openedAt`,
//     re-derived name, re-paired notes root) — its position never moves.
//   - A never-seen vault appends at the END (registration order).
//   - A vault moved on disk (`previousRoot`) keeps its old slot — the entry
//     is rewritten under the new root, not re-registered at the end. The
//     previous-root match outranks a leftover entry already at the new root:
//     that leftover predates the move and is stale (its pairing belongs to a
//     different vault), so it is healed away, not inherited from.
//   - Duplicate entries for the upserted root (a hand-edited or corrupt
//     settings file — loadVaultSettings does not sanitize) collapse to the
//     one updated entry, matching the old code's self-healing.
//   - Over `max`, the least-recently-OPENED entry is evicted (`openedAt` is
//     the eviction key, never list position) — but never the entry being
//     upserted, or a full registry would re-evict every new vault instantly.
//
// Pure data (no fs, no Electron) — unit-testable like vaultOrder.ts.

import type { ProjectEntry } from './ipc.js';

// SKY-320: bumped from 5 → 16 so the Obsidian-style switcher can list every
// Mythos Vault a user has opened without quietly trimming older ones.
export const MAX_RECENT_PROJECTS = 16;

/** Eviction key: unparsable/missing `openedAt` sorts oldest — an entry that
 *  can't prove recency loses to every one that can. */
function openedAtMs(entry: ProjectEntry): number {
  const t = Date.parse(entry.openedAt);
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

/**
 * Return a new registry with `entry` upserted position-stably. Never mutates
 * `existing`. `previousRoot` marks a vault relocated on disk: its old-root
 * entry (when present) is the one replaced in place, keeping its slot and,
 * if the caller didn't re-pair one, its notes-vault pairing.
 */
export function upsertRecentProject(
  existing: ProjectEntry[],
  entry: ProjectEntry,
  opts?: { max?: number; previousRoot?: string },
): ProjectEntry[] {
  const max = opts?.max ?? MAX_RECENT_PROJECTS;
  let idx = opts?.previousRoot
    ? existing.findIndex((p) => p.vaultRoot === opts.previousRoot)
    : -1;
  if (idx < 0) idx = existing.findIndex((p) => p.vaultRoot === entry.vaultRoot);

  const next: ProjectEntry[] = [];
  let updatedIdx = -1;
  for (let i = 0; i < existing.length; i++) {
    if (i === idx) {
      updatedIdx = next.length;
      next.push({
        ...entry,
        // A move carries no notes root of its own (the Notes Vault didn't
        // move) — keep the pairing rather than dropping it with `undefined`.
        notesVaultRoot: entry.notesVaultRoot ?? existing[i].notesVaultRoot,
      });
    } else if (existing[i].vaultRoot !== entry.vaultRoot) {
      next.push(existing[i]);
    }
    // else: stale duplicate of the upserted root — healed away.
  }
  if (idx < 0) {
    updatedIdx = next.length;
    next.push(entry);
  }

  while (next.length > max) {
    let evict = -1;
    let oldest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < next.length; i++) {
      if (i === updatedIdx) continue;
      const t = openedAtMs(next[i]);
      if (t < oldest) {
        oldest = t;
        evict = i;
      }
    }
    if (evict < 0) break;
    next.splice(evict, 1);
    if (evict < updatedIdx) updatedIdx--;
  }
  return next;
}
