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
 * operation for API symmetry; ticket 4 owns actually calling
 * moveVaultFile/renameNoteWithCascade. Nothing is persisted here by design —
 * do not add a write path.
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
