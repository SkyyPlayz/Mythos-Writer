// Layout v3 format for the widget shell: zod schema, hardened JSON parser and pure FrameState converters. Persists nothing (S1c owns that).
// Hardening (plan S12): 256 KB cap before parse, prototype-key reviver, fresh rebuild of every object, depth <= 16, nodes <= 256, unknown widgets -> inert placeholder.
import { z } from 'zod';
import {
  CENTER_PANEL_ID,
  FRAME_WIDGETS,
  isFrameWidgetKind,
  widgetDef,
  type DockEdge,
  type FrameState,
  type FrameWidgetKind,
  type WidgetInstance,
} from './widgetRegistry';

export const LAYOUT_VERSION = 3;
/** Largest accepted layout document, measured in UTF-8 bytes. */
export const MAX_LAYOUT_BYTES = 256 * 1024;
/** Deepest accepted node nesting. The root is depth 1. */
export const MAX_LAYOUT_DEPTH = 16;
/** Most accepted nodes (branches and leaves together). */
export const MAX_LAYOUT_NODES = 256;
export const MAX_SIZE_PX = 10000;
/** Raw JSON bracket nesting the pre-scan allows: two brackets per node level plus the envelope. A fuzz guard, not the real depth rule. */
const MAX_JSON_NESTING = MAX_LAYOUT_DEPTH * 2 + 8;

/** Widget names a leaf may carry. Anything else in a document becomes an inert placeholder and is never resolved to code. */
export const LAYOUT_WIDGETS = ['center', 'navRail', 'leftSidebar', 'rightSidebar', 'placeholder'] as const;
export type LayoutWidget = (typeof LAYOUT_WIDGETS)[number];
// Compile-time guard: adding a FrameWidgetKind without extending LAYOUT_WIDGETS fails typecheck here.
const kindsAreCovered: FrameWidgetKind extends LayoutWidget ? true : never = true;
void kindsAreCovered;

export interface LayoutLeaf {
  type: 'leaf';
  id: string;
  widget: LayoutWidget;
  /** Copy number (2, 3, ...) of a duplicated widget. Absent or 0 for originals, center and placeholders. */
  copy?: number;
  /** Size in px along the axis perpendicular to the widget's edge. */
  size?: number;
}
export interface LayoutBranch {
  type: 'branch';
  orientation: 'row' | 'column';
  children: LayoutNode[];
  /** Optional share of each child, ratios in [0, 1], same length as `children`. */
  sizes?: number[];
}
export type LayoutNode = LayoutBranch | LayoutLeaf;
export interface LayoutV3 {
  version: 3;
  locked: boolean;
  root: LayoutNode;
}

const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9:_-]+$/);
const sizePxSchema = z.number().min(0).max(MAX_SIZE_PX);
const ratioSchema = z.number().min(0).max(1);

/** Cross-field rules of a leaf: id and copy must agree with the widget, the way frameReducer names instances. */
function leafProblem(leaf: { id: string; widget: LayoutWidget; copy?: number | undefined }): string | null {
  const { id, widget, copy } = leaf;
  if (widget === 'center') {
    return id !== CENTER_PANEL_ID || copy !== undefined ? 'center leaf must have id "center" and no copy' : null;
  }
  if (id === CENTER_PANEL_ID) return '"center" id is reserved for the center leaf';
  if (widget === 'placeholder') return copy !== undefined ? 'placeholder leaf has no copy' : null;
  if (!isFrameWidgetKind(widget)) return 'unknown widget';
  if (copy === undefined || copy === 0) return id === widget ? null : 'original widget id must equal its kind';
  if (copy < 2) return 'copy numbers start at 2';
  if (!widgetDef(widget).duplicable) return 'widget cannot be duplicated';
  return id === `${widget}:copy:${copy}` ? null : 'copy widget id must be "<kind>:copy:<n>"';
}

export const LayoutLeafSchema = z
  .object({
    type: z.literal('leaf'),
    id: idSchema,
    widget: z.enum(LAYOUT_WIDGETS),
    copy: z.number().int().min(0).max(99).optional(),
    size: sizePxSchema.optional(),
  })
  .strict()
  .superRefine((leaf, ctx) => {
    const problem = leafProblem(leaf);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

function branchSchema<T>(children: z.ZodType<T[]>) {
  return z
    .object({
      type: z.literal('branch'),
      orientation: z.enum(['row', 'column']),
      children,
      sizes: z.array(ratioSchema).optional(),
    })
    .strict()
    .superRefine((branch, ctx) => {
      const count = branch.children.length;
      if (count < 1) ctx.addIssue({ code: 'custom', message: 'branch needs at least one child' });
      if (branch.sizes && branch.sizes.length !== count) {
        ctx.addIssue({ code: 'custom', message: 'sizes must have one ratio per child' });
      }
    });
}

export const LayoutNodeSchema: z.ZodType<LayoutNode> = z.lazy(() =>
  z.discriminatedUnion('type', [branchSchema(z.array(LayoutNodeSchema)), LayoutLeafSchema]),
);

interface LayoutStats {
  nodes: number;
  depth: number;
  centers: number;
  duplicateIds: boolean;
}

function measure(node: LayoutNode, depth: number, ids: Set<string>, stats: LayoutStats): void {
  stats.nodes += 1;
  if (depth > stats.depth) stats.depth = depth;
  if (stats.nodes > MAX_LAYOUT_NODES || depth > MAX_LAYOUT_DEPTH) return;
  if (node.type === 'leaf') {
    if (ids.has(node.id)) stats.duplicateIds = true;
    ids.add(node.id);
    if (node.widget === 'center') stats.centers += 1;
    return;
  }
  for (const child of node.children) measure(child, depth + 1, ids, stats);
}

/** Whole-tree strict schema. Validated layouts have exactly one center, unique ids, depth <= 16 and <= 256 nodes. */
export const LayoutV3Schema = z
  .object({
    version: z.literal(LAYOUT_VERSION),
    locked: z.boolean(),
    root: LayoutNodeSchema,
  })
  .strict()
  .superRefine((layout, ctx) => {
    const stats: LayoutStats = { nodes: 0, depth: 0, centers: 0, duplicateIds: false };
    measure(layout.root, 1, new Set<string>(), stats);
    if (stats.depth > MAX_LAYOUT_DEPTH) ctx.addIssue({ code: 'custom', message: `layout deeper than ${MAX_LAYOUT_DEPTH}` });
    if (stats.nodes > MAX_LAYOUT_NODES) ctx.addIssue({ code: 'custom', message: `layout has more than ${MAX_LAYOUT_NODES} nodes` });
    if (stats.centers !== 1) ctx.addIssue({ code: 'custom', message: 'layout needs exactly one center leaf' });
    if (stats.duplicateIds) ctx.addIssue({ code: 'custom', message: 'leaf ids must be unique' });
  });

// ---------------------------------------------------------------------------------------------
// Hardened parser
// ---------------------------------------------------------------------------------------------

export type LayoutRejectReason =
  | 'not-a-string'
  | 'too-large'
  | 'nesting-too-deep'
  | 'invalid-json'
  | 'bad-envelope'
  | 'too-deep'
  | 'too-many-nodes'
  | 'missing-center'
  | 'multiple-centers'
  | 'invalid-layout';

export type ParseLayoutResult =
  | {
      ok: true;
      layout: LayoutV3;
      /** Nodes replaced by an inert placeholder (unknown widget, bad size, bad shape, duplicate id). */
      replaced: number;
    }
  | { ok: false; reason: LayoutRejectReason };

/** Keys the reviver drops everywhere in the document. */
const DANGEROUS_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

/** JSON.parse reviver: removes prototype-related keys so no later code can ever see or copy them. */
export function layoutReviver(this: unknown, key: string, value: unknown): unknown {
  return DANGEROUS_KEYS.includes(key) ? undefined : value;
}

/** True when the UTF-8 size of `text` is over `limit` bytes; stops counting as soon as that is known. */
function utf8LengthExceeds(text: string, limit: number): boolean {
  if (text.length > limit) return true; // every UTF-16 unit takes at least one byte
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
    if (bytes > limit) return true;
  }
  return false;
}

/** Bracket depth of the raw text, ignoring strings. Guards the recursive reviver and walker against stack-depth bombs. */
function nestingExceeds(text: string, limit: number): boolean {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    if (inString) {
      if (ch === 0x5c) i += 1;
      else if (ch === 0x22) inString = false;
    } else if (ch === 0x22) inString = true;
    else if (ch === 0x5b || ch === 0x7b) {
      depth += 1;
      if (depth > limit) return true;
    } else if (ch === 0x5d || ch === 0x7d) depth -= 1;
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

const BranchShellSchema = branchSchema(z.array(z.unknown()));
const EnvelopeSchema = z.object({ version: z.literal(LAYOUT_VERSION), locked: z.boolean(), root: z.unknown() }).strict();

interface WalkContext {
  nodes: number;
  overflow: 'too-deep' | 'too-many-nodes' | null;
  ids: Set<string>;
  centers: number;
  replaced: number;
  placeholders: number;
}

function placeholderLeaf(ctx: WalkContext): LayoutLeaf {
  let id: string;
  do {
    ctx.placeholders += 1;
    id = `placeholder:${ctx.placeholders}`;
  } while (ctx.ids.has(id));
  ctx.ids.add(id);
  return { type: 'leaf', id, widget: 'placeholder' };
}

/** Rejecting a node replaces it (and its subtree) with an inert placeholder; the rest of the layout stays valid. */
function rejectNode(ctx: WalkContext): LayoutLeaf {
  ctx.replaced += 1;
  return placeholderLeaf(ctx);
}

function walkLeaf(raw: unknown, ctx: WalkContext): LayoutLeaf {
  const parsed = LayoutLeafSchema.safeParse(raw);
  if (!parsed.success) return rejectNode(ctx);
  const { id, widget, copy, size } = parsed.data;
  if (widget === 'center') ctx.centers += 1; // a second center fails the whole layout, it is never papered over
  if (ctx.ids.has(id)) return rejectNode(ctx);
  ctx.ids.add(id);
  const leaf: LayoutLeaf = { type: 'leaf', id, widget };
  if (copy !== undefined) leaf.copy = copy;
  if (size !== undefined) leaf.size = size;
  return leaf;
}

function walkNode(raw: unknown, depth: number, ctx: WalkContext): LayoutNode {
  ctx.nodes += 1;
  if (depth > MAX_LAYOUT_DEPTH) {
    ctx.overflow ??= 'too-deep';
    return { type: 'leaf', id: 'overflow', widget: 'placeholder' };
  }
  if (ctx.nodes > MAX_LAYOUT_NODES) {
    ctx.overflow ??= 'too-many-nodes';
    return { type: 'leaf', id: 'overflow', widget: 'placeholder' };
  }
  if (!isRecord(raw) || !hasOwn(raw, 'type') || raw.type !== 'branch') return walkLeaf(raw, ctx);

  const shell = BranchShellSchema.safeParse(raw);
  if (!shell.success) return rejectNode(ctx);
  const children: LayoutNode[] = [];
  for (const child of shell.data.children as unknown[]) {
    children.push(walkNode(child, depth + 1, ctx));
    if (ctx.overflow) break;
  }
  const branch: LayoutBranch = { type: 'branch', orientation: shell.data.orientation, children };
  if (shell.data.sizes) branch.sizes = shell.data.sizes.slice();
  return branch;
}

/**
 * Parses and validates a stored layout document. Never throws.
 * Whole-document failures: not a string, > 256 KB UTF-8 (checked before JSON.parse), bad JSON, wrong envelope
 * (version, locked, extra keys), depth > 16, > 256 nodes, center missing or present more than once.
 * Per-node failures (unknown widget, non-finite or out-of-range size/ratio, bad ids, duplicate ids, extra keys,
 * empty branches) replace only that node with an inert `placeholder` leaf; `replaced` counts them.
 */
export function parseLayoutV3(json: string): ParseLayoutResult {
  if (typeof json !== 'string') return { ok: false, reason: 'not-a-string' };
  if (utf8LengthExceeds(json, MAX_LAYOUT_BYTES)) return { ok: false, reason: 'too-large' };
  if (nestingExceeds(json, MAX_JSON_NESTING)) return { ok: false, reason: 'nesting-too-deep' };
  try {
    let raw: unknown;
    try {
      raw = JSON.parse(json, layoutReviver);
    } catch {
      return { ok: false, reason: 'invalid-json' };
    }
    const envelope = EnvelopeSchema.safeParse(raw);
    if (!envelope.success) return { ok: false, reason: 'bad-envelope' };

    const ctx: WalkContext = { nodes: 0, overflow: null, ids: new Set<string>(), centers: 0, replaced: 0, placeholders: 0 };
    const root = walkNode(envelope.data.root, 1, ctx);
    if (ctx.overflow) return { ok: false, reason: ctx.overflow };
    if (ctx.centers === 0) return { ok: false, reason: 'missing-center' };
    if (ctx.centers > 1) return { ok: false, reason: 'multiple-centers' };

    const layout: LayoutV3 = { version: LAYOUT_VERSION, locked: envelope.data.locked, root };
    // Defense in depth: what we hand out must satisfy the strict schema.
    if (!LayoutV3Schema.safeParse(layout).success) return { ok: false, reason: 'invalid-layout' };
    return { ok: true, layout, replaced: ctx.replaced };
  } catch {
    return { ok: false, reason: 'invalid-layout' };
  }
}

export function serializeLayoutV3(layout: LayoutV3): string {
  return JSON.stringify(layout);
}

// ---------------------------------------------------------------------------------------------
// FrameState <-> LayoutV3
// ---------------------------------------------------------------------------------------------

function clampSize(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.min(MAX_SIZE_PX, Math.max(0, value));
}

function instanceLeaf(inst: WidgetInstance, sizes: Partial<Record<string, number>> | undefined): LayoutLeaf {
  const leaf: LayoutLeaf = { type: 'leaf', id: inst.id, widget: inst.kind };
  if (inst.copy > 0) leaf.copy = inst.copy;
  const size = sizes && hasOwn(sizes, inst.id) ? clampSize(sizes[inst.id]) : undefined;
  if (size !== undefined) leaf.size = size;
  return leaf;
}

/**
 * Deterministic tree for a frame state: the center leaf wrapped by one branch per instance, in instance order,
 * so the last instance is outermost (the way a dock adds each new widget at the outer edge of the grid).
 * left/top put the widget before the inner node, right/bottom after it. Pixel `sizes` (by instance id) become
 * leaf sizes; non-finite values are dropped and the rest clamped to [0, 10000].
 * Depth is instances + 1, so more than 15 instances exceeds the parser's depth cap; callers that persist
 * must expect `parseLayoutV3` to reject such a document.
 */
export function layoutFromFrameState(state: FrameState, sizes?: Partial<Record<string, number>>): LayoutV3 {
  let root: LayoutNode = { type: 'leaf', id: CENTER_PANEL_ID, widget: 'center' };
  for (const inst of state.instances) {
    const leaf = instanceLeaf(inst, sizes);
    const horizontal = inst.edge === 'left' || inst.edge === 'right';
    const leading = inst.edge === 'left' || inst.edge === 'top';
    root = {
      type: 'branch',
      orientation: horizontal ? 'row' : 'column',
      children: leading ? [leaf, root] : [root, leaf],
    };
  }
  return { version: LAYOUT_VERSION, locked: state.locked, root };
}

function containsCenter(node: LayoutNode): boolean {
  return node.type === 'leaf' ? node.widget === 'center' : node.children.some(containsCenter);
}

function leavesOf(node: LayoutNode, out: LayoutLeaf[]): LayoutLeaf[] {
  if (node.type === 'leaf') out.push(node);
  else for (const child of node.children) leavesOf(child, out);
  return out;
}

/** Outermost-first list of leaves with the edge they sit on, judged by which side of the center path they hang off. */
function placeLeaves(node: LayoutNode, out: Array<{ leaf: LayoutLeaf; edge: DockEdge }>): void {
  if (node.type === 'leaf') return;
  const at = node.children.findIndex(containsCenter);
  if (at < 0) return;
  const [leading, trailing]: [DockEdge, DockEdge] = node.orientation === 'row' ? ['left', 'right'] : ['top', 'bottom'];
  for (let i = 0; i < at; i += 1) for (const leaf of leavesOf(node.children[i], [])) out.push({ leaf, edge: leading });
  for (let i = node.children.length - 1; i > at; i -= 1) for (const leaf of leavesOf(node.children[i], [])) out.push({ leaf, edge: trailing });
  placeLeaves(node.children[at], out);
}

/**
 * Frame state described by a layout. Placeholders and the center are dropped; each widget's edge is the side of
 * the center it hangs on; originals missing from the layout come back at their home edge. Order is the three
 * originals in registry order, then copies from innermost to outermost, which matches `frameReducer` for every
 * reachable state.
 */
export function frameStateFromLayout(layout: LayoutV3): FrameState {
  const placed: Array<{ leaf: LayoutLeaf; edge: DockEdge }> = [];
  if (containsCenter(layout.root)) placeLeaves(layout.root, placed);
  else {
    for (const leaf of leavesOf(layout.root, [])) {
      placed.push({ leaf, edge: isFrameWidgetKind(leaf.widget) ? widgetDef(leaf.widget).homeEdge : 'left' });
    }
  }

  const found: WidgetInstance[] = [];
  for (const { leaf, edge } of placed.reverse()) {
    if (isFrameWidgetKind(leaf.widget)) found.push({ id: leaf.id, kind: leaf.widget, edge, copy: leaf.copy ?? 0 });
  }
  const originals: WidgetInstance[] = FRAME_WIDGETS.map(
    (def) => found.find((inst) => inst.id === def.kind) ?? { id: def.kind, kind: def.kind, edge: def.homeEdge, copy: 0 },
  );
  const copies = found.filter((inst) => inst.copy > 0);
  return { locked: layout.locked, instances: [...originals, ...copies] };
}
