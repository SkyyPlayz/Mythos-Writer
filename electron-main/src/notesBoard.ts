// SKY-11183 (Notes Board 1/9): board metadata store + identity model.
//
// Implements BOARDS-SPEC.md v2 §1-4, §13, §15 (data/IPC half — no UI in this
// ticket, see SKY-10724/M-Notes-Board for the full build).
//
// Store A (vault: folders + .md files, already exists — vault.ts/listVaultFiles)
// vs Store B (board metadata: positions, sizes, colours, furniture, thumbnails,
// icons — keyed by STABLE ID, not path) is the load-bearing split (§1). Store B
// is never authoritative about existence: if it references something Store A no
// longer has, the entry is dropped on read (GC, §1/§3); if Store A has
// something Store B doesn't, the item is simply absent from layout/colors
// (auto-layout MATH is out of scope for this ticket — ticket 2/3's job).
//
// Identity (§2): every note/folder is identified by a STABLE id, not a path.
// - A note's id lives in ITS OWN frontmatter (`id:`), so it travels with the
//   file on rename/move.
// - A folder's id lives in THAT FOLDER'S OWN `.mythos-board.json` sidecar's
//   top-level `id` field — the sidecar is a file *inside* the folder, so it
//   moves with the folder on rename/move too.
// - The id is assigned LAZILY: only when the note/folder first acquires board
//   metadata (a saved position, an icon, or a thumbnail override — resolved
//   via resolveOrAssignId, called from patchLayout/patchColors/furniture
//   ops, never from a bare read). A bare read (getBoard, resolveId) must
//   NEVER mutate anything — spec §15 test 7.
// - There is no separate persisted path→id table. Path is only ever a LOOKUP
//   INDEX (how a caller says "which item") — resolution is always "read the
//   id from wherever Store A currently reports that entity living". This is
//   what makes rename a no-op for Store B by construction (§2, §15 test 3) —
//   see itemRenameNotify below.
//
// Pure Node (fs/path/crypto only, no Electron imports) — unit-testable
// without Electron, matching vaultIcons.ts/vaultOrder.ts. Sidecar I/O reuses
// the same missing-file/malformed-JSON/wrong-shape → safe-default
// degradation as those two modules, and the same atomic-write primitive
// (writeFileAtomic, from vault.ts). Frontmatter id read/write reuses vault.ts's
// existing parseFrontmatter/serializeFrontmatter (the same pair
// notesTagWrangler.ts uses to rewrite one frontmatter field while preserving
// every other key and the note body byte-for-byte).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  parseFrontmatter,
  serializeFrontmatter,
  writeFileAtomic,
  listVaultFiles,
  markSelfWrite,
} from './vault.js';

// ─── Constants ───

export const BOARD_SIDECAR_FILE_NAME = '.mythos-board.json';
export const BOARD_SCHEMA_VERSION = 2;

/**
 * Drag/colour writes to a board file are coalesced within this window so a
 * drag doesn't round-trip a disk write per animation frame (BOARDS-SPEC.md
 * §13 "write behaviour that matters for feel"). Structural ops (id
 * assignment, furniture CRUD) are NOT subject to this — they write
 * immediately via writeFileAtomic.
 */
export const NOTES_BOARD_DEBOUNCE_MS = 250;

// ─── Types ───

export type NotesBoardItemKind = 'note' | 'folder';

export interface BoardLayoutEntry {
  x: number;
  y: number;
  /** Absent unless the user resized — absent means "use default size" (out of scope here). */
  w?: number;
  /** Absent unless the user resized. */
  h?: number;
}

/** Keyed by CHILD's stable id, prefixed `v:`/`n:` (§3). */
export type BoardLayoutMap = Record<string, BoardLayoutEntry>;
/** Keyed by CHILD's stable id, prefixed `v:`/`n:` (§3). */
export type BoardColorMap = Record<string, string>;

export type FurnitureKind = 'column' | 'check' | 'table' | 'image' | 'sketch' | 'swatch' | 'line';

const FURNITURE_KINDS = new Set<FurnitureKind>([
  'column',
  'check',
  'table',
  'image',
  'sketch',
  'swatch',
  'line',
]);

/**
 * Board-only furniture item (§4). All kinds share id/k/x/y/title?/color?;
 * kind-specific fields (items, rows, w, h, src, strokes, colors, from, to,
 * label) are stored as-is — rendering/resolving them is out of scope for
 * this ticket, this module only does CRUD + line cascade-delete.
 */
export interface BoardFurnitureItem {
  id: string;
  k: FurnitureKind;
  x: number;
  y: number;
  title?: string;
  color?: string;
  [key: string]: unknown;
}

/**
 * A `column` furniture item's `items[]` entry (§4). `ref`, when present, is a
 * vault-relative note path and is NOT a second link representation — it
 * resolves and rename-cascades exactly as a `[[wikilink]]` does elsewhere
 * (rewriteRefForRename below mirrors shared/wikiLinkRename.ts's stem-match
 * rule; findColumnRefBacklinks mirrors noteBacklinks.ts's). Do not add a
 * bespoke "board ref link" type.
 */
export interface ColumnItem {
  t: string;
  ref?: string;
}

export interface BoardView {
  zoom: number;
  panX: number;
  panY: number;
}

/** On-disk shape of `<folder>/.mythos-board.json` (§3), sanitized. */
export interface BoardFile {
  version: number;
  /** This folder's OWN stable id — '' means "never touched", never null on disk. */
  id: string;
  updated: string;
  layout: BoardLayoutMap;
  colors: BoardColorMap;
  furniture: BoardFurnitureItem[];
  view: BoardView;
}

/**
 * A child of a board, as returned by getBoard(). `path` is relative to the
 * board's OWN folder (children are always immediate — Notes Board has no
 * nested-item addressing), matching the `itemRelPath` argument every
 * per-item notesBoard.ts function expects.
 */
export interface BoardChild {
  path: string;
  kind: NotesBoardItemKind;
  id: string | null;
}

/** Renderer-facing shape returned by getBoard() (§13 illustrative `GET board`). */
export interface Board {
  /** This folder's OWN id, null if this folder has never itself been touched. */
  id: string | null;
  children: BoardChild[];
  layout: BoardLayoutMap;
  colors: BoardColorMap;
  furniture: BoardFurnitureItem[];
  view: BoardView;
}

// ─── Sidecar path + low-level I/O (mirrors vaultIcons.ts's degrade-to-safe-default) ───

function sidecarPath(folderAbsPath: string): string {
  return path.join(folderAbsPath, BOARD_SIDECAR_FILE_NAME);
}

function defaultBoardFile(): BoardFile {
  return {
    version: BOARD_SCHEMA_VERSION,
    id: '',
    updated: new Date(0).toISOString(),
    layout: {},
    colors: {},
    furniture: [],
    view: { zoom: 100, panX: 0, panY: 0 },
  };
}

/** `v:<id>` / `n:<id>` — the only key shapes layout/colors maps ever contain. */
function isItemKey(key: string): boolean {
  return /^[vn]:.+/.test(key);
}

function sanitizeLayoutMap(value: unknown): BoardLayoutMap {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: BoardLayoutMap = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (!isItemKey(key)) continue;
    if (v === null || typeof v !== 'object' || Array.isArray(v)) continue;
    const entry = v as Record<string, unknown>;
    if (typeof entry.x !== 'number' || typeof entry.y !== 'number') continue;
    const clean: BoardLayoutEntry = { x: entry.x, y: entry.y };
    if (typeof entry.w === 'number') clean.w = entry.w;
    if (typeof entry.h === 'number') clean.h = entry.h;
    out[key] = clean;
  }
  return out;
}

function sanitizeColorMap(value: unknown): BoardColorMap {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: BoardColorMap = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (!isItemKey(key)) continue;
    if (typeof v === 'string' && v.length > 0) out[key] = v;
  }
  return out;
}

function sanitizeFurniture(value: unknown): BoardFurnitureItem[] {
  if (!Array.isArray(value)) return [];
  const out: BoardFurnitureItem[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue;
    const it = item as Record<string, unknown>;
    if (typeof it.id !== 'string' || !it.id) continue;
    if (typeof it.k !== 'string' || !FURNITURE_KINDS.has(it.k as FurnitureKind)) continue;
    if (typeof it.x !== 'number' || typeof it.y !== 'number') continue;
    out.push({ ...it, id: it.id, k: it.k as FurnitureKind, x: it.x, y: it.y });
  }
  return out;
}

function sanitizeView(value: unknown): BoardView {
  const v =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    zoom: typeof v.zoom === 'number' ? v.zoom : 100,
    panX: typeof v.panX === 'number' ? v.panX : 0,
    panY: typeof v.panY === 'number' ? v.panY : 0,
  };
}

function sanitizeBoardFile(parsed: Record<string, unknown>): BoardFile {
  return {
    version: BOARD_SCHEMA_VERSION,
    id: typeof parsed.id === 'string' ? parsed.id : '',
    updated: typeof parsed.updated === 'string' ? parsed.updated : new Date(0).toISOString(),
    layout: sanitizeLayoutMap(parsed.layout),
    colors: sanitizeColorMap(parsed.colors),
    furniture: sanitizeFurniture(parsed.furniture),
    view: sanitizeView(parsed.view),
  };
}

/**
 * Read a folder's own sidecar, tolerating a missing file, malformed JSON, or
 * a wrong-shaped payload — same safe-default philosophy as
 * vaultIcons.readIconMap/vaultOrder.readOrderMap. Returns null for "no
 * sidecar exists" (a folder that has never been touched AND has never been
 * used as a board), which callers distinguish from "sidecar exists but is
 * empty" only in that the latter still round-trips a `version`/`updated`.
 */
function readBoardFileRaw(folderAbsPath: string): BoardFile | null {
  let raw: string;
  try {
    raw = fs.readFileSync(sidecarPath(folderAbsPath), 'utf-8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return sanitizeBoardFile(parsed as Record<string, unknown>);
}

function writeBoardFileRaw(folderAbsPath: string, board: BoardFile): void {
  writeFileAtomic(sidecarPath(folderAbsPath), JSON.stringify(board, null, 2));
}

function resolveFolderAbs(vaultRoot: string, folderRelPath: string): string {
  return folderRelPath ? path.join(vaultRoot, folderRelPath) : vaultRoot;
}

// ─── GC of dangling Store B entries (§1, §3) ───

/**
 * Drop every layout/colors entry whose id no longer resolves to a live
 * note/folder. Pure function (no I/O) so it's independently unit-testable —
 * mirrors vaultIcons.ts's removeIconsUnderPath returning null/unchanged when
 * nothing was pruned, here via the `changed` flag so callers can skip a
 * needless disk write.
 */
export function gcBoardEntries(
  board: BoardFile,
  liveChildIds: Set<string>,
): { board: BoardFile; changed: boolean } {
  let changed = false;
  const gc = <T,>(map: Record<string, T>): Record<string, T> => {
    const next: Record<string, T> = {};
    for (const [key, value] of Object.entries(map)) {
      const id = isItemKey(key) ? key.slice(2) : null;
      if (id !== null && liveChildIds.has(id)) {
        next[key] = value;
      } else {
        changed = true;
      }
    }
    return next;
  };
  const layout = gc(board.layout);
  const colors = gc(board.colors);
  if (!changed) return { board, changed: false };
  return { board: { ...board, layout, colors }, changed: true };
}

// ─── Identity: lazy id assignment (§2) ───

/**
 * Read-only id lookup — returns the id if one already exists (note
 * frontmatter `id:` / folder sidecar `id`), or null. NEVER assigns or writes
 * anything — this is what makes a bare read (getBoard) safe to call without
 * ever speculatively minting ids (spec §15 test 7).
 */
export function resolveId(kind: NotesBoardItemKind, absPath: string): string | null {
  if (kind === 'folder') {
    const board = readBoardFileRaw(absPath);
    return board && board.id ? board.id : null;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(absPath, 'utf-8');
  } catch {
    return null;
  }
  const { frontmatter } = parseFrontmatter(raw);
  return typeof frontmatter.id === 'string' && frontmatter.id ? frontmatter.id : null;
}

/**
 * Read the existing id, or mint one (crypto.randomUUID()) and persist it —
 * to the note's own frontmatter, or the folder's own sidecar `id` field —
 * then return it. This is the ONLY place a note/folder id gets minted, and
 * it is only ever called from a mutating op (patchLayout/patchColors —
 * "touching" an item), never from getBoard.
 *
 * Concurrency: every step here (the read + the write) is synchronous
 * (fs.readFileSync/writeFileSync-family calls, no `await` in between), and
 * Node's single-threaded event loop cannot interleave two JS callbacks
 * mid-synchronous-function. So even if two IPC invocations for the SAME path
 * arrive "at the same time" (two renderer calls queued back-to-back), each
 * resolveOrAssignId call runs to completion — including its write — before
 * the other's handler body starts, so there is no read-then-write race that
 * could mint two different ids for the same entity.
 */
export function resolveOrAssignId(kind: NotesBoardItemKind, absPath: string): string {
  const existing = resolveId(kind, absPath);
  if (existing) return existing;

  const id = crypto.randomUUID();
  if (kind === 'folder') {
    const board = readBoardFileRaw(absPath) ?? defaultBoardFile();
    writeBoardFileRaw(absPath, { ...board, id, updated: new Date().toISOString() });
  } else {
    let raw: string;
    try {
      raw = fs.readFileSync(absPath, 'utf-8');
    } catch {
      raw = '';
    }
    const { frontmatter, prose } = parseFrontmatter(raw);
    // Spread existing keys first, `id` added last — preserves every other
    // frontmatter key's presence/value and leaves `prose` (the note body)
    // byte-for-byte untouched. Same idiom notesTagWrangler.ts uses to
    // rewrite one frontmatter field without disturbing the rest.
    writeFileAtomic(absPath, serializeFrontmatter({ ...frontmatter, id }, prose));
    // SKY-11186: this is the app's own write, not an external edit — without
    // the mark, the first drag of every never-arranged card would bounce back
    // through the Notes watcher as a vault change (board reload, tree
    // refresh, reindex) for a frontmatter key nothing on screen shows.
    markSelfWrite(absPath);
  }
  return id;
}

function itemPrefix(kind: NotesBoardItemKind): 'v' | 'n' {
  return kind === 'folder' ? 'v' : 'n';
}

/**
 * Determine kind (and layout-key prefix) of an on-disk item. Throws if it
 * doesn't exist. `itemRelPath` (caller-relative, not the resolved absolute
 * path) is interpolated into the thrown message — matching vault.ts's
 * convention (e.g. moveVaultFile's "Source does not exist: <relPath>") — so
 * a vault living outside sanitizeIpcError's hardcoded absolute-path pattern
 * list (e.g. under /mnt/, /srv/, /data/) never leaks its host filesystem
 * layout to the renderer.
 */
function statItemKind(
  absPath: string,
  itemRelPath: string,
): { kind: NotesBoardItemKind; prefix: 'v' | 'n' } {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absPath);
  } catch {
    throw new Error(`notesBoard: item not found: ${itemRelPath}`);
  }
  const kind: NotesBoardItemKind = stat.isDirectory() ? 'folder' : 'note';
  return { kind, prefix: itemPrefix(kind) };
}

// ─── Store A listing (reuses vault.ts's listVaultFiles, not a second walker) ───

function listImmediateChildren(
  vaultRoot: string,
  folderRelPath: string,
): Array<{ name: string; relPath: string; isDirectory: boolean }> {
  const { items } = listVaultFiles(vaultRoot, folderRelPath || undefined);
  return items
    // listVaultFiles walks recursively; keep only this folder's immediate children.
    .filter((it) => !it.path.includes('/'))
    // dot-segments are bookkeeping (this module's own sidecar included).
    .filter((it) => !it.name.startsWith('.'))
    .filter((it) => it.isDirectory || /\.md$/i.test(it.name))
    .map((it) => ({ name: it.name, relPath: it.path, isDirectory: it.isDirectory }));
}

// ─── GET board (§13, §15 test 2 + test 7 half) ───

/**
 * List Store A children of `folderRelPath`, resolve each child's id
 * read-only (never assigns — test 7), load this folder's own sidecar
 * (GC'ing dangling layout/colors entries, writing back ONLY if something was
 * actually pruned — test 2), and return a renderer-shaped board.
 */
export function getBoard(vaultRoot: string, folderRelPath: string): Board {
  const folderAbs = resolveFolderAbs(vaultRoot, folderRelPath);

  const children: BoardChild[] = listImmediateChildren(vaultRoot, folderRelPath).map((c) => {
    const kind: NotesBoardItemKind = c.isDirectory ? 'folder' : 'note';
    const abs = path.join(folderAbs, c.name);
    return { path: c.relPath, kind, id: resolveId(kind, abs) };
  });

  const rawBoard = readBoardFileRaw(folderAbs);
  const folderOwnId = rawBoard && rawBoard.id ? rawBoard.id : null;

  const liveIds = new Set(
    children.map((c) => c.id).filter((id): id is string => id !== null),
  );
  const boardForGc = rawBoard ?? defaultBoardFile();
  const { board: gcBoard, changed } = gcBoardEntries(boardForGc, liveIds);

  // Only write back if a sidecar actually existed AND something was pruned —
  // never create a sidecar (or touch mtime) for an untouched folder just
  // because it was read (test 2: deleting the sidecar and reloading must not
  // resurrect one), matching vaultIcons.ts's rewriteIconsOnMove returning
  // null for a no-op.
  if (rawBoard && changed) {
    writeBoardFileRaw(folderAbs, { ...gcBoard, updated: new Date().toISOString() });
  }

  return {
    id: folderOwnId,
    children,
    layout: gcBoard.layout,
    colors: gcBoard.colors,
    furniture: gcBoard.furniture,
    view: gcBoard.view,
  };
}

// ─── Debounced, key-level-merged layout/colors writes (§13 write behaviour) ───

interface PendingBoardWrite {
  timer: ReturnType<typeof setTimeout>;
  /** Per-key ACCUMULATED patch (field-level merge across calls in the window). */
  pendingLayout: Record<string, Partial<BoardLayoutEntry>>;
  /** Per-key pending colour; null means "clear". Last call in the window wins. */
  pendingColors: Record<string, string | null>;
}

// Keyed by board folder's absolute path — one buffer per board file, so a
// layout patch and a colour patch to the SAME board within one window
// coalesce into a single flush (one file write), and patches to two
// DIFFERENT boards never interfere with each other.
const pendingWrites = new Map<string, PendingBoardWrite>();

function isUnder(childAbs: string, rootAbs: string): boolean {
  const rel = path.relative(rootAbs, childAbs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function schedulePendingWrite(folderAbs: string): PendingBoardWrite {
  const existing = pendingWrites.get(folderAbs);
  if (existing) clearTimeout(existing.timer);

  const timer = setTimeout(() => flushBoardWrite(folderAbs), NOTES_BOARD_DEBOUNCE_MS);
  // Don't let a pending debounce timer keep the process alive (tests / quit).
  timer.unref?.();

  const entry: PendingBoardWrite = {
    timer,
    pendingLayout: existing?.pendingLayout ?? {},
    pendingColors: existing?.pendingColors ?? {},
  };
  pendingWrites.set(folderAbs, entry);
  return entry;
}

/**
 * Drain one board's pending buffer: re-read the CURRENT on-disk state (not a
 * stale snapshot taken when the timer was scheduled — anything else, e.g. a
 * GC write from a getBoard() call that happened mid-window, must not be
 * clobbered), shallow-merge each pending layout patch into its key
 * (preserving fields the patch didn't touch, e.g. a drag-only {x,y} must not
 * erase a previously-set {w,h}), apply pending colour sets/clears, and write
 * once if anything changed. This is what makes two near-simultaneous patches
 * to DIFFERENT keys both persist (spec §15 test 11): they accumulate in the
 * SAME in-memory buffer across the window and are merged at the key level
 * here, never as a single whole-object overwrite of the latest patch only.
 */
function flushBoardWrite(folderAbs: string): void {
  const entry = pendingWrites.get(folderAbs);
  if (!entry) return;
  pendingWrites.delete(folderAbs);
  clearTimeout(entry.timer);

  const board = readBoardFileRaw(folderAbs) ?? defaultBoardFile();
  let changed = false;

  for (const [key, patch] of Object.entries(entry.pendingLayout)) {
    board.layout[key] = { ...board.layout[key], ...patch } as BoardLayoutEntry;
    changed = true;
  }
  for (const [key, color] of Object.entries(entry.pendingColors)) {
    if (color === null) {
      if (key in board.colors) changed = true;
      delete board.colors[key];
    } else {
      board.colors[key] = color;
      changed = true;
    }
  }

  if (changed) {
    board.updated = new Date().toISOString();
    writeBoardFileRaw(folderAbs, board);
  }
}

/**
 * Synchronously drain every pending debounced notesBoard write (or only
 * those under `vaultRoot`, when given). Needed by tests (so they don't have
 * to sleep past NOTES_BOARD_DEBOUNCE_MS) and by a future app-quit hook — see
 * the one-line call from mainWindow's 'close' handler in main.ts, matching
 * the SKY-9973 flush-before-quit precedent for the other debounced writer in
 * this codebase (renderer manifest saves). No app-quit ORCHESTRATION is
 * added here — that lives in main.ts, outside this ticket's data-layer scope
 * beyond that one call.
 */
export function flushPendingNotesBoardWrites(vaultRoot?: string): void {
  const rootAbs = vaultRoot ? path.resolve(vaultRoot) : null;
  for (const folderAbs of [...pendingWrites.keys()]) {
    if (rootAbs && !isUnder(folderAbs, rootAbs)) continue;
    flushBoardWrite(folderAbs);
  }
}

/**
 * Lazily assign the item's id (if it doesn't have one yet — this is the ONLY
 * place a position write causes id assignment, spec §15 test 7), then
 * schedule a debounced, key-level-merged layout write. Returns the item's
 * (possibly newly-assigned) key/id synchronously — the id assignment itself
 * is immediate/undebounced (it's a structural op on the item's OWN file);
 * only the layout entry's appearance in the BOARD file is debounced.
 */
export function patchLayout(
  vaultRoot: string,
  folderRelPath: string,
  itemRelPath: string,
  patch: { x?: number; y?: number; w?: number; h?: number },
): { key: string; id: string } {
  const folderAbs = resolveFolderAbs(vaultRoot, folderRelPath);
  const itemAbs = path.join(folderAbs, itemRelPath);
  const { kind, prefix } = statItemKind(itemAbs, itemRelPath);
  const id = resolveOrAssignId(kind, itemAbs);
  const key = `${prefix}:${id}`;

  const entry = schedulePendingWrite(folderAbs);
  entry.pendingLayout[key] = { ...entry.pendingLayout[key], ...patch };

  return { key, id };
}

/** Same lazy-id + debounced-merge treatment as patchLayout, same per-board buffer. */
export function patchColors(
  vaultRoot: string,
  folderRelPath: string,
  itemRelPath: string,
  color: string | null,
): { key: string; id: string } {
  const folderAbs = resolveFolderAbs(vaultRoot, folderRelPath);
  const itemAbs = path.join(folderAbs, itemRelPath);
  const { kind, prefix } = statItemKind(itemAbs, itemRelPath);
  const id = resolveOrAssignId(kind, itemAbs);
  const key = `${prefix}:${id}`;

  const entry = schedulePendingWrite(folderAbs);
  entry.pendingColors[key] = color;

  return { key, id };
}

// ─── Furniture CRUD (§4) — structural ops, immediate/undebounced writes ───

function furnitureKey(furnitureId: string): string {
  return `x:${furnitureId}`;
}

/** Cascade-delete rule shared by furnitureDelete and itemDeleteStub (§4). */
function dropLinesReferencing(furniture: BoardFurnitureItem[], deletedKey: string): BoardFurnitureItem[] {
  return furniture.filter((f) => !(f.k === 'line' && (f.from === deletedKey || f.to === deletedKey)));
}

// NOTE: deliberately NOT `Omit<BoardFurnitureItem, 'id'>` — BoardFurnitureItem
// carries a `[key: string]: unknown` index signature, and TS's Omit/Pick
// mapped-type machinery collapses a type's named-required-property guarantee
// once an index signature is involved (a known TS gotcha), which then makes
// `{ ...item, id }` fail to satisfy BoardFurnitureItem's required k/x/y even
// though the runtime shape is correct. Spelling the required fields out
// directly avoids it.
export interface NewFurnitureItem {
  k: FurnitureKind;
  x: number;
  y: number;
  title?: string;
  color?: string;
  [key: string]: unknown;
}

export interface FurniturePatch {
  x?: number;
  y?: number;
  title?: string;
  color?: string;
  [key: string]: unknown;
}

export function furnitureCreate(
  vaultRoot: string,
  folderRelPath: string,
  item: NewFurnitureItem,
): BoardFurnitureItem {
  const folderAbs = resolveFolderAbs(vaultRoot, folderRelPath);
  // Store B is never authoritative about existence (§1) — a board's own
  // folder must already exist in Store A. Without this check,
  // writeFileAtomic's mkdirSync(recursive) would silently materialize a
  // brand-new (empty) folder in the vault just because a furniture item was
  // created against a path that doesn't exist yet.
  if (!fs.existsSync(folderAbs) || !fs.statSync(folderAbs).isDirectory()) {
    throw new Error(`notesBoard: board folder not found: ${folderRelPath || '.'}`);
  }
  const board = readBoardFileRaw(folderAbs) ?? defaultBoardFile();
  const created: BoardFurnitureItem = { ...item, id: crypto.randomUUID() };
  board.furniture = [...board.furniture, created];
  board.updated = new Date().toISOString();
  writeBoardFileRaw(folderAbs, board);
  return created;
}

export function furnitureUpdate(
  vaultRoot: string,
  folderRelPath: string,
  furnitureId: string,
  patch: FurniturePatch,
): BoardFurnitureItem | null {
  const folderAbs = resolveFolderAbs(vaultRoot, folderRelPath);
  const board = readBoardFileRaw(folderAbs) ?? defaultBoardFile();
  let updated: BoardFurnitureItem | null = null;
  board.furniture = board.furniture.map((f) => {
    if (f.id !== furnitureId) return f;
    updated = { ...f, ...patch, id: f.id, k: f.k };
    return updated;
  });
  if (!updated) return null;
  board.updated = new Date().toISOString();
  writeBoardFileRaw(folderAbs, board);
  return updated;
}

/** Removes the furniture entry AND cascade-deletes every 'line' entry referencing it (§4). */
export function furnitureDelete(
  vaultRoot: string,
  folderRelPath: string,
  furnitureId: string,
): { deleted: boolean } {
  const folderAbs = resolveFolderAbs(vaultRoot, folderRelPath);
  const board = readBoardFileRaw(folderAbs) ?? defaultBoardFile();
  if (!board.furniture.some((f) => f.id === furnitureId)) return { deleted: false };

  const key = furnitureKey(furnitureId);
  const withoutItem = board.furniture.filter((f) => f.id !== furnitureId);
  board.furniture = dropLinesReferencing(withoutItem, key);
  board.updated = new Date().toISOString();
  writeBoardFileRaw(folderAbs, board);
  return { deleted: true };
}

// ─── Vault-mutating canvas operations (§5) — SKY-11187 ───
//
// The canvas's Note/Board tools create REAL files and folders, and its rename
// renames the REAL entry on disk (§5, §1 "two renderings of one filesystem").
// Everything below is Store A only: none of it writes a board sidecar, and
// none of it mints an id — the first drag of the new card does that, through
// patchLayout, exactly as it does for a note created in the Notes tab (§2).
//
// Home (`folderRelPath === ''`, the vault root) is deliberately NOT special
// cased anywhere in this section: resolveFolderAbs already maps '' to the
// vault root, so the root board creates, names and renames like any other.

/** Placeholder names the canvas tools create with (§5). */
export const NEW_NOTE_BASE_NAME = 'New note';
export const NEW_BOARD_BASE_NAME = 'New board';

/**
 * First free `<base><ext>` / `<base> 2<ext>` / `<base> 3<ext>` … inside
 * `folderAbs`. Existence is checked against the FILESYSTEM rather than a
 * caller-supplied sibling list, so the answer is correct on a
 * case-insensitive volume (macOS/Windows: "new note.md" already occupies
 * "New note.md") and cannot be raced stale by anything the renderer last
 * listed.
 */
export function uniqueChildName(folderAbs: string, base: string, ext = ''): string {
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${base}${ext}` : `${base} ${n}${ext}`;
    if (!fs.existsSync(path.join(folderAbs, name))) return name;
  }
}

export interface CreatedBoardItem {
  /** Path relative to the board's own folder — the shape every per-item function here takes. */
  itemPath: string;
  kind: NotesBoardItemKind;
}

/**
 * Create a new note (`New note.md`, empty) or sub-board (`New board/`) inside
 * `folderRelPath`, optionally pinned at the click point. Returns the created
 * item's board-relative path so the caller can drop it straight into inline
 * rename.
 *
 * The note body is deliberately EMPTY — no frontmatter, no heading. A
 * heading would be stale the moment the user finishes the inline rename that
 * follows every create, and an `id:` here would break §2's lazy-assignment
 * rule (a note acquires an id when it first acquires board metadata, not when
 * it is born) — giving it a POSITION is exactly that first acquisition, so
 * the id minted below comes from patchLayout, the one place §2 allows.
 *
 * The position is written and FLUSHED here rather than left in the drag
 * debounce: a card's birth position is a structural fact about the create,
 * not an animation frame. Leaving it buffered would let the board reload this
 * create triggers (the renderer refresh the IPC handler pushes) read the
 * sidecar before the entry landed and lay the brand-new card out in an
 * auto-layout slot instead of under the pointer.
 */
export function createBoardItem(
  vaultRoot: string,
  folderRelPath: string,
  kind: NotesBoardItemKind,
  position?: { x: number; y: number },
): CreatedBoardItem {
  const folderAbs = resolveFolderAbs(vaultRoot, folderRelPath);
  // Same guard as furnitureCreate: Store B is never authoritative about
  // existence, and neither is a stale breadcrumb — refuse to materialize a
  // board folder that Store A doesn't have.
  if (!fs.existsSync(folderAbs) || !fs.statSync(folderAbs).isDirectory()) {
    throw new Error(`notesBoard: board folder not found: ${folderRelPath || '.'}`);
  }

  let itemPath: string;
  if (kind === 'folder') {
    itemPath = uniqueChildName(folderAbs, NEW_BOARD_BASE_NAME);
    fs.mkdirSync(path.join(folderAbs, itemPath));
  } else {
    itemPath = uniqueChildName(folderAbs, NEW_NOTE_BASE_NAME, '.md');
    const abs = path.join(folderAbs, itemPath);
    writeFileAtomic(abs, '');
    // The app's own write — without the mark, chokidar's `add` would bounce
    // straight back as an external vault change (reindex, graph work, a board
    // reload) for a file the canvas is already rendering. The IPC handler
    // pushes the renderer notification itself, so nothing is lost by
    // suppressing the watcher here (same trade resolveOrAssignId makes).
    markSelfWrite(abs);
  }

  if (position) {
    patchLayout(vaultRoot, folderRelPath, itemPath, position);
    flushBoardWrite(folderAbs);
  }
  return { itemPath, kind };
}

/**
 * Board-relative path this item would move to under `newBaseName`, or null
 * when the rename is a no-op the caller must NOT send to the filesystem:
 * an empty/whitespace-only name (§5 — "renaming to empty string is a no-op",
 * never a delete and never an unnamed file), or a name that resolves to the
 * path the item already has.
 *
 * A note keeps its extension (`.md`), because the inline rename edits the
 * DISPLAYED name, which is the stem. A folder has no extension to preserve —
 * "Book v1.2" is the whole name, not a stem plus ".2" — matching the same
 * split VaultBrowser's rename already makes.
 */
export function boardItemRenameTarget(
  itemRelPath: string,
  newBaseName: string,
  kind: NotesBoardItemKind,
): string | null {
  const trimmed = newBaseName.trim();
  if (!trimmed) return null;
  const lastDot = itemRelPath.lastIndexOf('.');
  const ext = kind === 'note' && lastDot > 0 ? itemRelPath.slice(lastDot) : '';
  const target = `${trimmed}${ext}`;
  return target === itemRelPath ? null : target;
}

// ─── Rename (§2, §5 scope note) — Store B no-op by construction ───

/**
 * A note/folder rename requires ZERO Store B mutation. A note's id lives in
 * ITS OWN frontmatter (moves with the file — fs.renameSync doesn't touch
 * file contents) and a folder's id lives in ITS OWN `.mythos-board.json`
 * sidecar (a file *inside* the folder, so it moves with the folder). Path is
 * only ever a caller-facing lookup index (§2) — never the Store B storage
 * key — so id-keyed lookups resolve correctly at whatever NEW path Store A
 * reports, with no rewrite anywhere. This function is a validation/no-op
 * pass-through so the rest of the IPC surface has one entry point per
 * operation for API symmetry.
 *
 * SKY-11187: the real rename now happens in the NOTES_BOARD_RENAME_ITEM
 * handler, which routes through the SAME renameNoteWithCascade the Notes tab
 * uses (one rename implementation, one wikilink cascade). This function stays
 * a no-op on purpose — it is the assertion that a rename costs Store B
 * nothing. Nothing is persisted here by design; do not add a write path.
 */
export function itemRenameNotify(
  _vaultRoot: string,
  _folderRelPath: string,
  _fromRelPath: string,
  _toRelPath: string,
): { ok: true } {
  return { ok: true };
}

// ─── Item delete (§6 stub) ───

/**
 * STUB for ticket 6's full deferred-delete/trash semantics. This ticket only
 * does a best-effort drop of the item's OWN layout/colors entry from its
 * PARENT folder's board file, plus cascade-deleting any 'line' furniture
 * entries referencing it — mirroring furnitureDelete's cascade rule (§4: "On
 * delete of ANY item ... cascade-delete every line furniture entry whose
 * from/to matches the deleted item's key").
 *
 * Does NOT touch the filesystem note/folder itself (no shell.trashItem, no
 * real delete) — that is ticket 6's job. Must be called while the item still
 * exists on disk (its id has to be read from frontmatter/sidecar to know
 * which layout/colors key to drop) — callers that perform a real delete
 * should call this FIRST, then delete. If the item was a folder, its own
 * sidecar file becoming orphaned (still sitting inside the now-deleted
 * folder, or inside a folder nobody can navigate to anymore) is harmless:
 * nothing will ever resolve to that folder's id again, and this cleanup is
 * best-effort in the first place — GC-on-load (gcBoardEntries) will catch
 * any entry this function misses (e.g. because the item was already gone
 * from disk before this ran) the next time anything reads the parent board.
 */
export function itemDeleteStub(
  vaultRoot: string,
  folderRelPath: string,
  itemRelPath: string,
): { key: string | null } {
  const folderAbs = resolveFolderAbs(vaultRoot, folderRelPath);
  const itemAbs = path.join(folderAbs, itemRelPath);

  let kind: NotesBoardItemKind | null = null;
  try {
    kind = fs.statSync(itemAbs).isDirectory() ? 'folder' : 'note';
  } catch {
    // Already gone from disk — nothing we can read an id from. GC-on-load
    // will still prune any dangling entry once this item no longer appears
    // among its parent's live children.
  }
  const id = kind ? resolveId(kind, itemAbs) : null;
  if (!id) return { key: null };

  const key = `${itemPrefix(kind as NotesBoardItemKind)}:${id}`;

  // Drop any still-buffered (not yet flushed) debounced layout/colors patch
  // for this key too — otherwise a patchLayout/patchColors call that landed
  // just before this delete (within NOTES_BOARD_DEBOUNCE_MS) would survive
  // in `pendingWrites` and flushBoardWrite would resurrect a dangling entry
  // for an item that no longer exists once its timer fires (including a
  // quit-time flush, which happens before the next GC-on-read pass could
  // ever prune it back out).
  const pending = pendingWrites.get(folderAbs);
  if (pending) {
    delete pending.pendingLayout[key];
    delete pending.pendingColors[key];
  }

  const board = readBoardFileRaw(folderAbs);
  if (!board) return { key };

  let changed = false;
  if (key in board.layout) {
    delete board.layout[key];
    changed = true;
  }
  if (key in board.colors) {
    delete board.colors[key];
    changed = true;
  }
  const beforeCount = board.furniture.length;
  board.furniture = dropLinesReferencing(board.furniture, key);
  if (board.furniture.length !== beforeCount) changed = true;

  if (changed) {
    board.updated = new Date().toISOString();
    writeBoardFileRaw(folderAbs, board);
  }
  return { key };
}

// ─── Column `ref` = real wikilink (§4, §2, §11) ───
//
// A column item's `ref` is a vault-relative note path, resolved by STEM
// (last path segment, `.md` stripped, case-insensitive) — the exact rule
// shared/wikiLinkRename.ts and vaultGraph.ts/noteBacklinks.ts already use for
// `[[wikilinks]]`. Reusing that rule (not a bespoke path comparison) is what
// makes `ref` "not a second link representation" true in practice, not just
// in the doc comment.

/** Split a vault-relative path into its folder prefix, stem, and whether it carried a `.md` extension. */
function splitRefStem(ref: string): { prefix: string; stem: string; hadMdExt: boolean } {
  const segments = ref.split(/[\\/]/);
  const lastSeg = segments[segments.length - 1];
  const hadMdExt = /\.md$/i.test(lastSeg);
  const stem = hadMdExt ? lastSeg.slice(0, -3) : lastSeg;
  return { prefix: segments.slice(0, -1).join('/'), stem, hadMdExt };
}

/**
 * Retarget one `ref` if its stem matches `oldStem` (case-insensitive) —
 * mirrors rewriteWikiLinksForRename's target-matching rule, minus the
 * `[[...]]`/alias/heading grammar a bare path doesn't have. Returns null
 * when the ref doesn't match (no rewrite needed).
 */
export function rewriteRefForRename(ref: string, oldStem: string, newStem: string): string | null {
  const { prefix, stem, hadMdExt } = splitRefStem(ref);
  if (stem.toLowerCase() !== oldStem.trim().toLowerCase()) return null;
  return (prefix ? `${prefix}/` : '') + newStem + (hadMdExt ? '.md' : '');
}

/**
 * Rewrite every `column` item's matching `ref` in one board file. Returns
 * the SAME object (count: 0) when nothing changed, so callers can skip a
 * write — same no-op contract as gcBoardEntries.
 */
export function rewriteBoardFurnitureRefs(
  board: BoardFile,
  oldStem: string,
  newStem: string,
): { board: BoardFile; count: number } {
  let count = 0;
  const furniture = board.furniture.map((f) => {
    if (f.k !== 'column' || !Array.isArray(f.items)) return f;
    const items = (f.items as unknown[]).map((raw) => {
      if (raw === null || typeof raw !== 'object') return raw;
      const it = raw as Record<string, unknown>;
      if (typeof it.ref !== 'string' || !it.ref) return raw;
      const rewritten = rewriteRefForRename(it.ref, oldStem, newStem);
      if (rewritten === null) return raw;
      count++;
      return { ...it, ref: rewritten };
    });
    return { ...f, items };
  });
  if (count === 0) return { board, count: 0 };
  return { board: { ...board, furniture }, count };
}

/**
 * Same rewrite, over the raw on-disk sidecar TEXT — the shape
 * renameCascade.ts's transaction plan needs (it tracks every touched file as
 * before/after text so a failure partway can roll back with a plain write,
 * exactly like it already does for markdown files). Malformed/unparsable
 * JSON is left untouched rather than thrown: a rename must never fail
 * because an unrelated sidecar is corrupt.
 */
export function rewriteBoardSidecarTextForRename(
  raw: string,
  oldStem: string,
  newStem: string,
): { content: string; count: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { content: raw, count: 0 };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { content: raw, count: 0 };
  }
  const board = sanitizeBoardFile(parsed as Record<string, unknown>);
  const { board: rewritten, count } = rewriteBoardFurnitureRefs(board, oldStem, newStem);
  if (count === 0) return { content: raw, count: 0 };
  return {
    content: JSON.stringify({ ...rewritten, updated: new Date().toISOString() }, null, 2),
    count,
  };
}

// ─── Column `ref` backlinks (§4/§11 "shows up in the Links tab") ───

export interface ColumnRefBacklinkEntry {
  /** Vault-relative path of the board (folder) holding the referencing column item. '' is Home. */
  boardPath: string;
  /** The furniture item's own title, if set. */
  boardItemTitle?: string;
  /** The column entry's own label text. */
  itemText: string;
}

/**
 * Scan every `.mythos-board.json` sidecar in the vault for `column` items
 * whose `ref` resolves (by stem, same rule as above) to `notePath`. This is
 * the board-metadata half of "shows up in the Links tab" (§4 acceptance
 * criteria) — noteBacklinks.ts covers the prose-`[[wikilink]]` half; a note
 * linked from both surfaces shows up in both lists, not merged into one.
 */
export function findColumnRefBacklinks(vaultRoot: string, notePath: string): ColumnRefBacklinkEntry[] {
  const stem = path.basename(notePath, '.md').toLowerCase();
  if (!stem) return [];

  const { items } = listVaultFiles(vaultRoot);
  const out: ColumnRefBacklinkEntry[] = [];
  for (const file of items) {
    if (file.isDirectory || path.basename(file.path) !== BOARD_SIDECAR_FILE_NAME) continue;
    const boardRelPath = path.dirname(file.path);
    const boardPath = boardRelPath === '.' ? '' : boardRelPath;
    const board = readBoardFileRaw(resolveFolderAbs(vaultRoot, boardPath));
    if (!board) continue;

    for (const f of board.furniture) {
      if (f.k !== 'column' || !Array.isArray(f.items)) continue;
      for (const raw of f.items as unknown[]) {
        if (raw === null || typeof raw !== 'object') continue;
        const it = raw as Record<string, unknown>;
        if (typeof it.ref !== 'string' || !it.ref) continue;
        if (splitRefStem(it.ref).stem.toLowerCase() !== stem) continue;
        out.push({
          boardPath,
          boardItemTitle: typeof f.title === 'string' ? f.title : undefined,
          itemText: typeof it.t === 'string' ? it.t : '',
        });
      }
    }
  }
  return out;
}
