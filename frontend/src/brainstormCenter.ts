// Beta 3 / M19 — Brainstorm center: pure grouping + mode-layout math.
// Every constant and formula is ported 1:1 from the Liquid Neon prototype
// (design-handoff/prototype, renderVals):
//   color slots (colHex = [c1, c2, c3, c4])  . . line 4228
//   map ring layout (bsMapNodes / bsMapHubs) . . lines 4246–4250
//   hub→node connecting lines (bsMapLines) . . . line 4251
//   cluster groups (bsClusterGroups) . . . . . . lines 4252–4255
// No DOM, no IPC — BrainstormPage renders these values.

/** Idea grouping key — the brainstorm fact categories the vault already uses. */
export type IdeaGroupKey = 'character' | 'location' | 'item' | 'note';

/** One vault idea as the Board/Map/Clusters modes consume it. */
export interface BrainstormIdea {
  id: string;
  title: string;
  body: string;
  type: IdeaGroupKey;
}

/** A column (Board), hub (Map), or gravity bubble (Clusters). */
export interface IdeaGroup {
  key: IdeaGroupKey;
  title: string;
  /** Liquid Neon color slot index 0–3 into colHex = [c1, c2, c3, c4] (line 4228). */
  color: number;
  ideas: BrainstormIdea[];
}

/**
 * The four canonical idea groups, in board-column order. The chat's detected
 * facts carry exactly these categories, so the Board always shows all four
 * columns (each with an add-idea row, mirroring the prototype's bsCols).
 */
export const IDEA_GROUP_DEFS: ReadonlyArray<Omit<IdeaGroup, 'ideas'>> = [
  { key: 'character', title: 'CHARACTERS', color: 0 },
  { key: 'location', title: 'LOCATIONS', color: 1 },
  { key: 'item', title: 'ITEMS', color: 2 },
  { key: 'note', title: 'LOOSE IDEAS', color: 3 },
];

/**
 * Group ideas by category for the Map and Clusters modes. Empty groups are
 * dropped so hubs/bubbles reflect the actual vault; a session with no ideas
 * degrades gracefully to a single empty group so every mode still renders.
 */
export function buildIdeaGroups(ideas: readonly BrainstormIdea[]): IdeaGroup[] {
  const groups = IDEA_GROUP_DEFS.map((def) => ({
    ...def,
    ideas: ideas.filter((idea) => idea.type === def.key),
  }));
  const nonEmpty = groups.filter((group) => group.ideas.length > 0);
  return nonEmpty.length > 0 ? nonEmpty : [{ ...IDEA_GROUP_DEFS[3], ideas: [] }];
}

// ─── Map ring layout (prototype lines 4246–4251) ─────────────────────────────
// All coordinates are percentages of the map surface. Hubs sit on a 13 % × 10 %
// ellipse around (50, 48); idea nodes fan out on rings of radius
// 26 + (i % 3) · 11 percent with the y component squashed to 72 %.

export interface MapPoint {
  x: number;
  y: number;
}

/** Hub position: `50 + cos(ang)·13, 48 + sin(ang)·10` with `ang = ci/N·2π` (line 4249). */
export function mapHubPosition(hubIndex: number, hubCount: number): MapPoint {
  const ang = (hubIndex / hubCount) * Math.PI * 2;
  return { x: 50 + Math.cos(ang) * 13, y: 48 + Math.sin(ang) * 10 };
}

/**
 * Node position: `ang = i/N·2π`, `rad = 26 + (i % 3)·11`, then
 * `50 + cos(ang)·rad, 48 + sin(ang)·(rad·0.72)` (lines 4247–4248).
 */
export function mapNodePosition(nodeIndex: number, nodeCount: number): MapPoint {
  const ang = (nodeIndex / nodeCount) * Math.PI * 2;
  const rad = 26 + (nodeIndex % 3) * 11;
  return { x: 50 + Math.cos(ang) * rad, y: 48 + Math.sin(ang) * (rad * 0.72) };
}

export interface MapHub extends MapPoint {
  key: IdeaGroupKey;
  title: string;
  color: number;
}

export interface MapNode extends MapPoint {
  id: string;
  title: string;
  color: number;
  /** Index into the hubs array (prototype `hub: c.col`, line 4248). */
  hub: number;
}

/** One hub→node connecting line in the 0–100 viewBox (line 4251). */
export interface MapLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: number;
}

export interface MapLayout {
  hubs: MapHub[];
  nodes: MapNode[];
  lines: MapLine[];
}

/**
 * Full mind-map layout: one hub per group on the inner ring, one node per idea
 * on the outer rings (flattened in group order, exactly like the prototype's
 * bsAllCards), and a line from every node back to its hub.
 */
export function buildMapLayout(groups: readonly IdeaGroup[]): MapLayout {
  const hubs: MapHub[] = groups.map((group, ci) => ({
    key: group.key,
    title: group.title,
    color: group.color,
    ...mapHubPosition(ci, groups.length),
  }));
  const flat = groups.flatMap((group, ci) =>
    group.ideas.map((idea) => ({ idea, hub: ci, color: group.color })),
  );
  const nodes: MapNode[] = flat.map((entry, i) => ({
    id: entry.idea.id,
    title: entry.idea.title,
    color: entry.color,
    hub: entry.hub,
    ...mapNodePosition(i, flat.length),
  }));
  const lines: MapLine[] = nodes.map((node) => {
    const hub = hubs[node.hub];
    return { x1: node.x, y1: node.y, x2: hub.x, y2: hub.y, color: hub.color };
  });
  return { hubs, nodes, lines };
}
