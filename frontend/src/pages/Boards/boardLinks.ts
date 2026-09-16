/**
 * SKY-11191 (Notes Board 8/9): the wiki-link overlay — the pure half.
 *
 * "Dashed connector between two note cards on the same board when one links
 * to the other. Reads the same link graph the Vault Graph uses — `[[wikilinks]]`
 * resolved by note name plus recorded backlinks — and must also include column
 * `ref` items from ticket 5, since those are real wikilinks too."
 *
 * ## Where the graph comes from
 *
 * `window.api.vaultGraphEdges('notes')` — vaultGraph.ts's in-memory index,
 * the exact one VaultGraphView renders. Its node ids ARE vault-relative note
 * paths, and its edges are already resolved (stem-matched, case-insensitive,
 * `[[folder/stem]]` reduced to its last segment), so this module never parses
 * a `[[wikilink]]` itself. Re-implementing the resolution here is how the two
 * surfaces would drift.
 *
 * ## Column `ref` items (SKY-11188, ticket 5)
 *
 * A `column` furniture item's `items[].ref` is a vault-relative note path and
 * is deliberately NOT a second link representation — it resolves by the same
 * stem rule (notesBoard.ts's `splitRefStem`, which mirrors
 * shared/wikiLinkRename.ts). The overlay therefore treats a column as just
 * another link SOURCE: its anchor is the furniture box, its target is the
 * referenced note's card.
 *
 * Furniture already rides on `notesBoardGet` (`BoardFurnitureItem`, §4), and
 * ticket 5's columns are anchored at the same x/y/w/h this module reads —
 * including the same `defaultFurnitureSize` fallback when the user has never
 * resized one — so a connector lands on exactly the box the canvas paints.
 *
 * ## Anchor keys
 *
 * A connector endpoint is an ANCHOR KEY, not a path, because the two ends can
 * be different kinds of thing. A note card's key is its board-relative item
 * path (what BoardCanvas already keys layout, selection and drag by); a
 * furniture box's key is `furniture:<id>`. BoardCanvas resolves both to rects.
 */

import { defaultFurnitureSize } from './boardLod';

/** A directed wikilink edge as vaultGraph.ts reports it (ids are vault-relative note paths). */
export interface VaultGraphEdge {
  source: string;
  target: string;
}

/** Prefix that distinguishes a furniture anchor key from an item path. */
export const FURNITURE_ANCHOR_PREFIX = 'furniture:';

export const furnitureAnchorKey = (id: string): string => `${FURNITURE_ANCHOR_PREFIX}${id}`;

export interface BoardWikiLink {
  /** Stable across renders: the two anchor keys. */
  id: string;
  /** Anchor key of the linking side. */
  from: string;
  /** Anchor key of the linked-to side. */
  to: string;
  /** Accessible/`<title>` text — "A links to B". */
  label: string;
}

/** The subset of a board item the overlay needs. */
export interface LinkableItem {
  path: string;
  kind: 'folder' | 'note';
  name: string;
}

/**
 * The subset of a furniture record the overlay needs
 * (`notesBoardGet().furniture`). A structural subset with `unknown` values
 * rather than an import of SKY-11188's `BoardFurnitureItemData`: that type
 * lives in a React component module and this half is pure. It assigns to this
 * one directly, so the panel hands over the same array it renders.
 */
export interface FurnitureRecord {
  id: string;
  k: string;
  x?: unknown;
  y?: unknown;
  w?: unknown;
  h?: unknown;
  title?: unknown;
  items?: unknown;
}

/** Vault-relative path of a board child. Home's `folderPath` is '' (SKY-11336). */
export function vaultPathOf(folderPath: string, itemPath: string): string {
  return folderPath ? `${folderPath}/${itemPath}` : itemPath;
}

/**
 * Last path segment with any `.md` stripped, lower-cased — the stem key every
 * link surface in the app resolves by (vaultGraph.ts, noteBacklinks.ts,
 * notesBoard.ts's `splitRefStem`). Kept here rather than imported because
 * those all live in the main process; the rule is three lines and the tests
 * below pin it to the same behaviour.
 */
export function refStem(ref: string): string {
  const last = ref.split(/[\\/]/).pop() ?? '';
  return last.replace(/\.md$/i, '').toLowerCase();
}

/**
 * Every connector this board should draw: a link whose BOTH ends are on this
 * board. A note linking off-board has no second box to reach, so it draws
 * nothing — the overlay describes the board, not the vault (the Vault Graph
 * is the vault-wide view).
 */
export function boardWikiLinks(input: {
  /** Vault-relative path of the open board. '' is Home. */
  folderPath: string;
  /** The board's direct children, as BoardsTabPanel resolved them. */
  items: readonly LinkableItem[];
  /** `vaultGraphEdges('notes')` — vault-relative note path pairs. */
  edges: readonly VaultGraphEdge[];
  /** `notesBoardGet().furniture` — column `ref`s become extra link sources. */
  furniture?: readonly FurnitureRecord[];
}): BoardWikiLink[] {
  const { folderPath, items, edges, furniture = [] } = input;

  // Vault path → this board's item path, notes only. Folders are boards, not
  // link targets: a `[[Folder]]` link opens a board (SKY-11615) rather than
  // pointing at a card, and vaultGraph.ts only indexes `.md` files anyway.
  const noteByVaultPath = new Map<string, LinkableItem>();
  const noteByStem = new Map<string, LinkableItem>();
  for (const item of items) {
    if (item.kind !== 'note') continue;
    noteByVaultPath.set(vaultPathOf(folderPath, item.path), item);
    // Last writer wins on a stem collision — the same rule vaultGraph.ts uses.
    noteByStem.set(refStem(item.path), item);
  }

  const links: BoardWikiLink[] = [];
  const seen = new Set<string>();
  const push = (from: string, to: string, label: string) => {
    const id = `${from}→${to}`;
    if (seen.has(id)) return;
    seen.add(id);
    links.push({ id, from, to, label });
  };

  for (const edge of edges) {
    const source = noteByVaultPath.get(edge.source);
    const target = noteByVaultPath.get(edge.target);
    if (!source || !target || source === target) continue;
    push(source.path, target.path, `${source.name} links to ${target.name}`);
  }

  for (const f of furniture) {
    if (f.k !== 'column' || !Array.isArray(f.items)) continue;
    const columnLabel = typeof f.title === 'string' && f.title ? f.title : 'Column';
    for (const raw of f.items as unknown[]) {
      if (raw === null || typeof raw !== 'object') continue;
      const ref = (raw as Record<string, unknown>).ref;
      if (typeof ref !== 'string' || !ref) continue;
      // A `ref` is a vault-relative note path, so an exact match is the
      // truthful one; the stem fallback is what makes a bare `[[Name]]`-style
      // ref resolve, and is the same last-writer-wins rule vaultGraph.ts and
      // notesBoard.ts's findColumnRefBacklinks apply.
      const target = noteByVaultPath.get(ref.replace(/\\/g, '/')) ?? noteByStem.get(refStem(ref));
      if (!target) continue;
      push(furnitureAnchorKey(f.id), target.path, `${columnLabel} links to ${target.name}`);
    }
  }

  return links;
}

export interface AnchorRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ConnectorSegment {
  id: string;
  label: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Where the centre-to-centre line crosses `rect`'s border. Drawing the
 * connector between the two crossings — rather than centre to centre — is
 * what keeps the dashes and the arrowhead outside the cards instead of
 * disappearing underneath them.
 */
export function clipToRectBorder(rect: AnchorRect, towardX: number, towardY: number): { x: number; y: number } {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const dx = towardX - cx;
  const dy = towardY - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  // Scale the direction until it hits whichever pair of edges it reaches first.
  const scaleX = dx === 0 ? Infinity : rect.w / 2 / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : rect.h / 2 / Math.abs(dy);
  const t = Math.min(scaleX, scaleY);
  return { x: cx + dx * t, y: cy + dy * t };
}

/**
 * Resolve every link to a drawable segment. A link with an anchor that is not
 * on the board right now (a card culled from Store A, a column deleted) is
 * skipped rather than drawn to (0, 0).
 */
export function connectorSegments(
  links: readonly BoardWikiLink[],
  anchors: ReadonlyMap<string, AnchorRect>,
): ConnectorSegment[] {
  const segments: ConnectorSegment[] = [];
  for (const link of links) {
    const from = anchors.get(link.from);
    const to = anchors.get(link.to);
    if (!from || !to) continue;
    const fromCentre = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
    const toCentre = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
    const start = clipToRectBorder(from, toCentre.x, toCentre.y);
    const end = clipToRectBorder(to, fromCentre.x, fromCentre.y);
    segments.push({ id: link.id, label: link.label, x1: start.x, y1: start.y, x2: end.x, y2: end.y });
  }
  return segments;
}

/**
 * Anchor rects for every `column` furniture item, keyed `furniture:<id>`.
 *
 * A column's size is absent from the sidecar unless the user resized it — the
 * same "absent = default" contract a note's own `layout.w/h` follows (§3). The
 * fallback comes from SKY-11188's `defaultFurnitureSize`, the one function
 * BoardCanvas sizes the rendered column with, so a connector always lands on
 * exactly the box the column is painted in.
 */
export function furnitureAnchorRects(furniture: readonly FurnitureRecord[]): Map<string, AnchorRect> {
  const rects = new Map<string, AnchorRect>();
  for (const f of furniture) {
    if (f.k !== 'column') continue;
    const rowCount = Array.isArray(f.items) ? f.items.length : 0;
    const def = defaultFurnitureSize('column', rowCount);
    rects.set(furnitureAnchorKey(f.id), {
      x: typeof f.x === 'number' ? f.x : 0,
      y: typeof f.y === 'number' ? f.y : 0,
      w: typeof f.w === 'number' && f.w > 0 ? f.w : def.w,
      h: typeof f.h === 'number' && f.h > 0 ? f.h : def.h,
    });
  }
  return rects;
}
