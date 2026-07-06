// Beta 3 / M17 — Canvas board engine: data model + Obsidian-canvas (de)serialization.
//
// The in-memory board shape mirrors the Liquid Neon prototype exactly
// (design-handoff/prototype, `draftBoard` lines 3403–3423):
//   { id, name, cards: [{ id, t, d, av, c, x, y, w, h, nid }], links: [[id, id]] }
//
// Persistence is Obsidian-canvas-compatible JSON (`.canvas` files):
//   { nodes: [{ id, type: 'text'|'file', x, y, width, height, text?, file?, color? }],
//     edges: [{ id, fromNode, toNode }] }
// so boards written by Mythos-Writer open in Obsidian and vice versa.
// Pure functions only — no DOM, no IPC; the caller owns persistence.

/** One card on a canvas board (prototype `mk(...)`, line 3409). */
export interface CanvasCard {
  id: string;
  /** Title shown in the card header. */
  t: string;
  /** Body / description text. */
  d: string;
  /** Avatar glyph shown in the header chip (initials or a symbol like ✦ / +). */
  av: string;
  /**
   * Theme color slot index, 0-based. Maps to the Liquid Neon slot tokens
   * `--n1..--n6` / `--b1..--b6` / `--g1..--g6` (out-of-range falls back to slot 0,
   * mirroring the prototype's `[c1..c5][c.c] || c1`).
   */
  c: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Attached vault note id/path, or null when the card is free-standing text. */
  nid: string | null;
}

/** A directed connection between two cards: `[fromCardId, toCardId]`. */
export type CanvasLink = [string, string];

/** A canvas board (prototype board shape, line 3420). */
export interface CanvasBoardData {
  id: string;
  name: string;
  cards: CanvasCard[];
  links: CanvasLink[];
}

// ─── Obsidian-canvas JSON (`.canvas`) ────────────────────────────────────────

export interface ObsidianCanvasNode {
  id: string;
  type: 'text' | 'file';
  x: number;
  y: number;
  width: number;
  height: number;
  /** Markdown body for `text` nodes: title, then a blank line, then the body. */
  text?: string;
  /** Vault note path/id for `file` nodes. */
  file?: string;
  /** Obsidian preset color '1'..'6' (slot index + 1). */
  color?: string;
}

export interface ObsidianCanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
}

export interface ObsidianCanvasJson {
  nodes: ObsidianCanvasNode[];
  edges: ObsidianCanvasEdge[];
}

/** The number of Liquid Neon color slots (and Obsidian preset colors). */
export const CANVAS_COLOR_SLOTS = 6;

function isValidSlot(c: number): boolean {
  return Number.isInteger(c) && c >= 0 && c < CANVAS_COLOR_SLOTS;
}

/**
 * Serialize a board to Obsidian-canvas-compatible JSON.
 *
 * - Cards with an attached note become `file` nodes (title/body/avatar are
 *   derived from the file again on load — Obsidian renders the file itself).
 * - Free-standing cards become `text` nodes: `"<title>\n\n<body>"`.
 * - The slot index `c` maps to Obsidian preset colors `'1'..'6'`.
 */
export function boardToCanvasJson(board: CanvasBoardData): ObsidianCanvasJson {
  const nodes: ObsidianCanvasNode[] = board.cards.map((card) => {
    const node: ObsidianCanvasNode = {
      id: card.id,
      type: card.nid ? 'file' : 'text',
      x: card.x,
      y: card.y,
      width: card.w,
      height: card.h,
    };
    if (card.nid) {
      node.file = card.nid;
    } else {
      node.text = card.d ? `${card.t}\n\n${card.d}` : card.t;
    }
    if (isValidSlot(card.c)) node.color = String(card.c + 1);
    return node;
  });
  const edges: ObsidianCanvasEdge[] = board.links.map(([fromNode, toNode], i) => ({
    id: `edge-${i}`,
    fromNode,
    toNode,
  }));
  return { nodes, edges };
}

/** `'1'..'6'` → slot 0..5; anything else (hex colors, absent) → slot 0. */
function parseSlot(color: string | undefined): number {
  if (!color) return 0;
  const n = Number(color);
  return isValidSlot(n - 1) ? n - 1 : 0;
}

/** Derive an avatar glyph from a title: initials of the first two words. */
export function avatarForTitle(title: string): string {
  const initials = title
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word))
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
  return initials || '+';
}

/** File node title: basename without the markdown extension. */
function titleForFile(file: string): string {
  const base = file.split('/').pop() ?? file;
  return base.replace(/\.md$/i, '');
}

/**
 * Deserialize Obsidian-canvas JSON into a board. The `.canvas` format carries
 * no board id/name (Obsidian uses the filename), so the caller supplies them.
 */
export function canvasJsonToBoard(
  json: ObsidianCanvasJson,
  meta: { id: string; name: string },
): CanvasBoardData {
  const cards: CanvasCard[] = json.nodes.map((node) => {
    let t: string;
    let d: string;
    let nid: string | null;
    if (node.type === 'file') {
      nid = node.file ?? '';
      t = titleForFile(nid);
      d = '';
    } else {
      nid = null;
      const text = node.text ?? '';
      const split = text.indexOf('\n\n');
      t = (split === -1 ? text : text.slice(0, split)).replace(/^#+\s+/, '');
      d = split === -1 ? '' : text.slice(split + 2);
    }
    return {
      id: node.id,
      t,
      d,
      av: avatarForTitle(t),
      c: parseSlot(node.color),
      x: node.x,
      y: node.y,
      w: node.width,
      h: node.height,
      nid,
    };
  });
  const links: CanvasLink[] = json.edges.map((edge) => [edge.fromNode, edge.toNode]);
  return { id: meta.id, name: meta.name, cards, links };
}
