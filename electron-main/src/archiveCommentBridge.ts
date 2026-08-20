// Beta 3 M23 — Archive plumbing: pure helpers for the flags→comments bridge.
//
// Two jobs, both side-effect free (main.ts wires them to SQLite/IPC):
//
//  1. Action mapping — the M11 comment cards dispatch the MYT-376
//     `archive:confirm` verbs ('match_archive' | 'suggest_story_change' |
//     'ignore'); continuity items (SKY-1684) resolve with the
//     `archive:resolve-continuity` verbs ('match_archive_to_story' | …).
//     `confirmActionToResolution` translates between the two so a comment's
//     three buttons can resolve a continuity flag directly.
//
//  2. Scan dedupe — `parseScanResponse` mints a random UUID per finding, so
//     re-scanning an unchanged scene would insert a semantically identical
//     row (and therefore a duplicate margin comment) on every pass.
//     `dedupeScanItems` drops fresh findings that duplicate an existing
//     open/ignored row (or an earlier finding in the same batch), keyed on
//     scene + category + normalized excerpt. Resolved rows do NOT block a
//     re-flag: if the issue reappears after resolution it is a new flag.

import type { DbContinuityIssue } from './db.js';
import type { ArchiveConfirmAction, InconsistencyItem, ResolutionAction } from './ipc.js';

/** Map an archive:confirm verb onto the continuity ResolutionAction verb. */
export function confirmActionToResolution(action: ArchiveConfirmAction): ResolutionAction {
  return action === 'match_archive' ? 'match_archive_to_story' : action;
}

/** Normalize an excerpt for identity comparison: trim, collapse whitespace,
 *  case-fold. LLM re-runs reproduce excerpts modulo whitespace jitter. */
export function normalizeExcerpt(excerpt: string): string {
  return excerpt.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Identity key of a continuity finding for dedupe purposes.
 *  `scope` is optional for backward compatibility with pre-M12.B1 callers —
 *  omitting it groups everything under one bucket, same as before. */
export function continuityDedupeKey(
  sceneId: string,
  category: string,
  excerpt: string,
  scope?: string,
): string {
  return `${sceneId}\0${category}\0${normalizeExcerpt(excerpt)}\0${scope ?? ''}`;
}

/** Statuses that block re-inserting the same finding. `resolved` is absent on
 *  purpose — a re-detected issue after resolution is a genuinely new flag. */
const BLOCKING_STATUSES: ReadonlySet<string> = new Set(['open', 'ignored']);

/**
 * Filter freshly parsed scan items down to the ones that are NOT duplicates
 * of an existing open/ignored row (nor of an earlier item in the same batch).
 */
export function dedupeScanItems(
  items: InconsistencyItem[],
  existing: readonly DbContinuityIssue[],
): InconsistencyItem[] {
  const seen = new Set<string>();
  for (const row of existing) {
    if (!BLOCKING_STATUSES.has(row.status)) continue;
    // M12.B1: pre-v29 / scope-less rows default to 'story_vault' (dbRowToItem
    // does the same), so legacy rows still dedupe against story_vault items.
    seen.add(
      continuityDedupeKey(row.manuscript_scene_id, row.category, row.manuscript_excerpt, row.scope ?? 'story_vault'),
    );
  }

  const fresh: InconsistencyItem[] = [];
  for (const item of items) {
    // M12.B1: scope is part of the identity — Check 1 and Check 2 findings
    // for the same scene/category/excerpt text are NOT the same finding.
    const key = continuityDedupeKey(
      item.manuscriptAnchor.sceneId,
      item.category,
      item.manuscriptAnchor.excerpt,
      item.scope,
    );
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(item);
  }
  return fresh;
}
