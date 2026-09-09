// Beta 4 SKY-11615 (§ SKY-11594) — how a resolved [[wiki link]] presents in
// the Timeline's PLAIN-TEXT prose: key-event card descriptions (AxisView) and
// the Inspector's event summary. Those two surfaces render a raw string, not a
// ProseMirror document, so the editors' decoration plugin
// (WikiLinkResolutionExtension) has nothing to attach to and this module
// supplies the equivalent styling contract instead.
//
// Ported from the design authority — owner-reports/2026-09-09-design-liquid-
// neon.dc.html, `wikiSeg` (7513) and `tlRefBadges` / `tlRefRing` (7498).
// Pure and React-free so the counting rules stay unit-testable.

import type { CrossTabLinkMatch, WikiSegment } from '../crossTabLinkResolver';

/** The four visual treatments a link segment can take (mockup `wikiSeg`). */
export type WikiLinkTone = 'story' | 'note' | 'folder' | 'unresolved';

/**
 * Which treatment a resolved target earns. Chapters ride with scenes: both
 * are story targets, and the mockup's story badge is literally labelled
 * "chapter", so they share the gold.
 */
export function wikiLinkTone(match: CrossTabLinkMatch | null): WikiLinkTone {
  if (!match) return 'unresolved';
  switch (match.kind) {
    case 'scene':
    case 'chapter':
      return 'story';
    case 'folder':
      return 'folder';
    case 'entity':
      return 'note';
  }
}

/** One reference badge on an event card (mockup `tlRefBadges`). */
export interface WikiRefBadge {
  kind: 'note' | 'story';
  /** ◇ for notes, ▭ for story targets — the mockup's glyphs. */
  glyph: string;
  count: number;
  /** Tooltip text; also the accessible name, since the glyph alone says nothing. */
  title: string;
}

/**
 * Count the links in one description into the mockup's two badges.
 *
 * Two rules are inherited verbatim from the design authority and are easy to
 * misread as bugs:
 *   · a FOLDER link counts toward the "note" badge — there is no third badge;
 *   · an UNRESOLVED link also counts toward the "note" badge (the mockup's
 *     `else note++` catch-all), so a card with one broken link still shows
 *     that something was referenced there.
 */
export function wikiRefBadges(
  segments: readonly WikiSegment[],
  resolve: (target: string) => CrossTabLinkMatch | null,
): WikiRefBadge[] {
  let note = 0;
  let story = 0;
  for (const segment of segments) {
    if (!segment.isLink) continue;
    if (wikiLinkTone(resolve(segment.target)) === 'story') story += 1;
    else note += 1;
  }
  const make = (kind: 'note' | 'story', glyph: string, label: string, count: number): WikiRefBadge => ({
    kind,
    glyph,
    count,
    title: `${count} ${label}${count > 1 ? 's' : ''} linked in this description`,
  });
  const badges: WikiRefBadge[] = [];
  if (note > 0) badges.push(make('note', '◇', 'note', note));
  if (story > 0) badges.push(make('story', '▭', 'chapter', story));
  return badges;
}

/**
 * Accent for the event card's reference ring, or null for a card with no
 * links. Gold ('story') when the only badge is the story one; the c5 teal
 * ('mixed') as soon as any note/folder/unresolved reference is present — note
 * that the count does not matter, three scene links still ring gold (mockup
 * `tlRefRing`).
 */
export function wikiRefRingTone(badges: readonly WikiRefBadge[]): 'story' | 'mixed' | null {
  if (badges.length === 0) return null;
  return badges.some((badge) => badge.kind === 'note') ? 'mixed' : 'story';
}
