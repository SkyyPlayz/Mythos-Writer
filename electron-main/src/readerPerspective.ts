// readerPerspective.ts — Reader-perspective context filtering (SKY-10741 M12.B6).
//
// The production-team reader roles (alpha/beta reader) must judge a manuscript
// the way a first-time reader does: they can only know what has been revealed at
// or before the point they've read to. An agent that already knows a character's
// true identity (a future reveal) can't honestly judge whether that reveal lands
// — the same way an author re-reading their own draft can't un-know the twist.
//
// The leak vector is NOT the prose (a well-written manuscript simply doesn't name
// the twist before the reveal scene) — it's the ENTITY DOSSIERS we inject
// alongside the prose for continuity. Those dossiers carry every alias and
// canonical name up front, including post-reveal identities. Feeding them
// verbatim to a reader-mode agent hands it the twist.
//
// This module gates entity dossiers by reveal order using the reveal_point field
// added in SKY-11318 (aliasesVisibleBefore / positionReached in vault/entityIndex).
// A hidden entity is omitted ENTIRELY — its canonical name and every alias — so
// the not-yet-revealed identity can never reach the prompt.
//
// buildAuthorEntityContext (unfiltered) is the counterpart used by author-
// perspective roles (storyline consultant, line editor) that legitimately need
// the whole map — and doubles as the negative-control baseline in tests: it
// demonstrably leaks the post-reveal identity, which the reader path must not.

import { aliasesVisibleBefore, type EntityIndexEntry } from './vault/entityIndex.js';

/** An entity index split into what a reader knows at a position vs. what is still hidden. */
export interface RevealPartition {
  /** Entities whose reveal_point has been reached at `position` (or is null). */
  visible: EntityIndexEntry[];
  /** Entities whose reveal_point is still in the reader's future — must not enter reader context. */
  hidden: EntityIndexEntry[];
}

/**
 * Split an entity index by reveal order at a given reading position.
 *
 * `visible` reuses aliasesVisibleBefore (the canonical SKY-11318 filter, so the
 * two never disagree on boundary semantics); `hidden` is the exact complement,
 * keyed by the stable `path`. Every entry lands in exactly one bucket.
 */
export function partitionByReveal(
  entries: EntityIndexEntry[],
  position: string,
): RevealPartition {
  const visible = aliasesVisibleBefore(entries, position);
  const visiblePaths = new Set(visible.map((e) => e.path));
  const hidden = entries.filter((e) => !visiblePaths.has(e.path));
  return { visible, hidden };
}

/**
 * Render a set of entity dossiers into a delimited context block, or '' when the
 * set is empty (so an empty reader context adds no block at all). Attacker-
 * controlled vault content stays inside explicit <entity_context> delimiters —
 * same defense-in-depth as buildBetaReportUserContent's <manuscript> wrapper.
 */
export function renderEntityDossier(entries: EntityIndexEntry[]): string {
  if (entries.length === 0) return '';
  const lines = entries.map((e) => {
    const type = e.type ? ` [${e.type}]` : '';
    const aka = e.aliases.length > 0 ? `\n  Also known as: ${e.aliases.join(', ')}` : '';
    return `Entity: ${e.name}${type}${aka}`;
  });
  return ['<entity_context>', ...lines, '</entity_context>'].join('\n');
}

/**
 * Reader-perspective entity context (AC2): only entities revealed at or before
 * `position`. Hidden entities — canonical name AND aliases — are omitted wholesale,
 * so a not-yet-revealed identity can never leak into a reader-mode prompt.
 */
export function buildReaderEntityContext(
  entries: EntityIndexEntry[],
  position: string,
): string {
  return renderEntityDossier(partitionByReveal(entries, position).visible);
}

/**
 * Author-perspective entity context: the full dossier, unfiltered. Used by roles
 * that legitimately see the whole map (storyline consultant, line editor) and as
 * the negative-control baseline in tests — it will contain post-reveal identities
 * that buildReaderEntityContext must strip.
 */
export function buildAuthorEntityContext(entries: EntityIndexEntry[]): string {
  return renderEntityDossier(entries);
}
