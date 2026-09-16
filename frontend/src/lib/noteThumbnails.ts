/**
 * SKY-11186 — renderer-side note thumbnails (BOARDS-SPEC v2 §6/§9).
 *
 * Two module-level caches, shared by every surface that shows a note card
 * (board tiles, the editor cover, galleries) so each note is answered once:
 *
 *   1. `resolveNoteThumbs` — WHICH image a note shows. Every call made in the
 *      same macrotask is coalesced into one `notesThumbResolve` IPC (a board
 *      mounting 200 tiles asks once, not 200 times) and the answer is memoised
 *      per path so re-renders never re-ask. Vault change events (which carry
 *      the changed path — a note, or an image every note showing it) mark
 *      entries stale rather than dropping them: a save keeps the old thumb on
 *      screen until the fresh answer lands instead of blanking every tile, and
 *      a stale entry is never served as fresh.
 *   2. `loadThumbnail` — the ~256px derivative for that image, as a data URL.
 *      Main hands back a cached derivative when it has one; otherwise it hands
 *      back the source bytes and the renderer scales them here (§6: never scale
 *      a full-size image at render), then posts the result back so the next
 *      launch hits the disk cache. LRU of 400 data URLs, at most three decodes
 *      in flight.
 *
 * The `window.api.notesThumb*` typings land with the main-process half of this
 * ticket; until then the calls are typed locally via `ThumbApi` so this module
 * type-checks on its own.
 */
import { useEffect, useSyncExternalStore } from 'react';

export interface NoteThumbInfo {
  mode: 'explicit' | 'auto' | 'off' | 'none';
  /** Vault-relative POSIX path of the source image. */
  src: string | null;
  /** `${mtimeMs}-${size}` — the cache-key suffix for the derivative. */
  version: string | null;
  /** The note references an image that isn't on disk. */
  missing: boolean;
  /** Alt text or basename; '' when none. */
  caption: string;
}

export type ThumbLoadState =
  | { status: 'loading' }
  | { status: 'ready'; dataUrl: string }
  | { status: 'unavailable' };

type ThumbGetResult =
  | { status: 'ready'; dataUrl: string; version: string }
  | { status: 'source'; mime: string; bytes: Uint8Array; version: string }
  | { status: 'missing' }
  | { status: 'unsupported' };

/** Local view of the preload bridge (mirrors electron-main's notesThumb* handlers). */
interface ThumbApi {
  notesThumbResolve?: (paths: string[]) => Promise<{ thumbs: Record<string, NoteThumbInfo> }>;
  notesThumbGet?: (src: string) => Promise<ThumbGetResult>;
  notesThumbPut?: (src: string, version: string, bytes: Uint8Array) => Promise<{ ok: boolean }>;
  onVaultNotesUpdated?: (cb: (data: { count: number; path?: string }) => void) => () => void;
  onVaultNotesAssetChanged?: (cb: (data: { path: string }) => void) => () => void;
}

export const THUMB_MAX_SHORT_EDGE = 256;
export const THUMB_MAX_LONG_EDGE = 512;
export const THUMB_CACHE_MAX = 400;
const DERIVATIVE_CONCURRENCY = 3;
const WEBP_QUALITY = 0.84;
/** 32 KiB per `String.fromCharCode.apply` call — well under the argument limit. */
const BASE64_CHUNK = 0x8000;

/** The answer for a note with nothing to show (also what an IPC failure memoises). */
export const NONE_THUMB_INFO: NoteThumbInfo = Object.freeze({
  mode: 'none',
  src: null,
  version: null,
  missing: false,
  caption: '',
});

const LOADING: ThumbLoadState = { status: 'loading' };
const UNAVAILABLE: ThumbLoadState = { status: 'unavailable' };

function getApi(): ThumbApi | undefined {
  return window.api as unknown as ThumbApi | undefined;
}

// ── Which image: batched resolve + per-path memo ────────────────────────────

const infoMemo = new Map<string, NoteThumbInfo>();
/** Memoised paths that are still shown but no longer trusted (stale-while-revalidate). */
const staleInfo = new Set<string>();
const infoListeners = new Set<() => void>();

interface InfoBatch {
  promise: Promise<void>;
  /** Paths invalidated after this batch was sent — its answer for them is already stale. */
  invalidated: Set<string>;
}
const inFlightInfo = new Map<string, InfoBatch>();
let pendingPaths = new Set<string>();
let pendingFlush: Promise<void> | null = null;
let vaultUnsubscribes: Array<() => void> | null = null;

function notifyInfo(): void {
  for (const fn of [...infoListeners]) fn();
}

function subscribeInfo(fn: () => void): () => void {
  infoListeners.add(fn);
  return () => { infoListeners.delete(fn); };
}

/** Queue paths for the next flush; every caller in this macrotask shares one IPC. */
function enqueueInfo(paths: string[]): Promise<void> {
  for (const p of paths) pendingPaths.add(p);
  if (!pendingFlush) {
    pendingFlush = new Promise<void>((resolve) => {
      setTimeout(() => {
        const batch = [...pendingPaths];
        pendingPaths = new Set();
        pendingFlush = null;
        resolve(dispatchInfoBatch(batch));
      }, 0);
    });
  }
  return pendingFlush;
}

function dispatchInfoBatch(paths: string[]): Promise<void> {
  if (paths.length === 0) return Promise.resolve();
  const batch: InfoBatch = { promise: Promise.resolve(), invalidated: new Set() };
  // Registered before the run so a synchronous completion (no bridge) still
  // finds and clears its own entries.
  for (const p of paths) inFlightInfo.set(p, batch);
  batch.promise = runInfoBatch(paths, batch);
  return batch.promise;
}

async function runInfoBatch(paths: string[], batch: InfoBatch): Promise<void> {
  let thumbs: Record<string, NoteThumbInfo> = {};
  const api = getApi();
  if (typeof api?.notesThumbResolve === 'function') {
    try {
      ({ thumbs } = await api.notesThumbResolve(paths));
    } catch {
      // Memoise "none" below so a transient failure doesn't re-ask on every
      // render; the next vault change clears it.
      thumbs = {};
    }
  }
  const retry: string[] = [];
  for (const p of paths) {
    if (inFlightInfo.get(p) === batch) inFlightInfo.delete(p);
    infoMemo.set(p, thumbs[p] ?? NONE_THUMB_INFO);
    if (batch.invalidated.has(p)) retry.push(p);
    else staleInfo.delete(p);
  }
  notifyInfo();
  // Callers awaiting this batch must see a fresh answer, so the re-ask is part
  // of the same promise.
  if (retry.length > 0) await enqueueInfo(retry);
}

/**
 * Resolve which image each note shows. Memoised paths answer without an IPC;
 * the rest are coalesced with every other call made this macrotask into one
 * `notesThumbResolve`. Never rejects — a failed bridge answers "none".
 */
export async function resolveNoteThumbs(paths: string[]): Promise<Record<string, NoteThumbInfo>> {
  ensureVaultSubscription();
  const unique = [...new Set(paths)];
  const waits: Promise<void>[] = [];
  const ask: string[] = [];
  for (const p of unique) {
    if (infoMemo.has(p) && !staleInfo.has(p)) continue;
    const batch = inFlightInfo.get(p);
    if (batch) waits.push(batch.promise);
    else ask.push(p);
  }
  if (ask.length > 0) waits.push(enqueueInfo(ask));
  if (waits.length > 0) await Promise.all(waits);
  const out: Record<string, NoteThumbInfo> = {};
  for (const p of unique) out[p] = infoMemo.get(p) ?? NONE_THUMB_INFO;
  return out;
}

function markInfoStale(path: string): void {
  const entry = infoMemo.get(path);
  if (entry) {
    // A fresh identity is what makes a mounted `useNoteThumbInfo` re-ask; the
    // content stays so the tile keeps its thumb until the answer lands.
    infoMemo.set(path, { ...entry });
    staleInfo.add(path);
  }
  const batch = inFlightInfo.get(path);
  if (batch) batch.invalidated.add(path);
}

/** Forget what we know about the given notes (or every note). */
export function invalidateNoteThumbs(paths?: string[]): void {
  const targets = paths ?? [...new Set([...infoMemo.keys(), ...inFlightInfo.keys()])];
  for (const p of targets) markInfoStale(p);
  notifyInfo();
}

/**
 * A changed Notes-vault path is either a note (its own entry) or an image
 * (every note showing it, plus its cached derivatives). Separators are
 * normalised defensively — main sends POSIX, chokidar speaks OS paths.
 */
function onVaultPathChanged(rawPath: string | undefined): void {
  if (!rawPath) return;
  const changed = rawPath.replace(/\\/g, '/');
  const targets = [changed];
  for (const [p, entry] of infoMemo) if (entry.src === changed) targets.push(p);
  invalidateNoteThumbs(targets);
  invalidateThumbnails(changed);
}

/**
 * Subscribed once, on first use. `vault:notes-updated` (a note or folder
 * changed) and `vault:notes-asset-changed` (an image was added or rewritten)
 * both carry the changed path, so invalidation is targeted; an update without
 * a path invalidates everything. Both are optional on the bridge (older
 * preloads, tests).
 */
function ensureVaultSubscription(): void {
  if (vaultUnsubscribes) return;
  vaultUnsubscribes = [];
  const api = getApi();
  if (typeof api?.onVaultNotesUpdated === 'function') {
    vaultUnsubscribes.push(
      api.onVaultNotesUpdated((data) => {
        if (data?.path) onVaultPathChanged(data.path);
        else invalidateNoteThumbs();
      }),
    );
  }
  if (typeof api?.onVaultNotesAssetChanged === 'function') {
    vaultUnsubscribes.push(api.onVaultNotesAssetChanged((data) => onVaultPathChanged(data?.path)));
  }
}

/**
 * Which image a note shows. Synchronous when memoised (stale or not); otherwise
 * `undefined` until the batched resolve lands, then re-renders. A vault change
 * keeps the last answer on screen while the fresh one is fetched.
 */
export function useNoteThumbInfo(notePath: string | null): NoteThumbInfo | undefined {
  const info = useSyncExternalStore(
    subscribeInfo,
    () => (notePath === null ? undefined : infoMemo.get(notePath)),
  );
  useEffect(() => {
    if (notePath !== null && (info === undefined || staleInfo.has(notePath))) {
      void resolveNoteThumbs([notePath]);
    }
  }, [notePath, info]);
  return info;
}

// ── The derivative: LRU cache + in-flight dedupe + decode queue ─────────────

const thumbCache = new Map<string, ThumbLoadState>();
const thumbInFlight = new Map<string, Promise<ThumbLoadState>>();
const thumbListeners = new Set<() => void>();

type DerivativeGenerator = (bytes: Uint8Array, mime: string) => Promise<Uint8Array>;
let derivativeGenerator: DerivativeGenerator = generateDerivative;
let derivativeActive = 0;
const derivativeWaiters: Array<() => void> = [];

export function thumbCacheKey(src: string, version: string): string {
  return `${src}@${version}`;
}

function notifyThumbs(): void {
  for (const fn of [...thumbListeners]) fn();
}

function subscribeThumbs(fn: () => void): () => void {
  thumbListeners.add(fn);
  return () => { thumbListeners.delete(fn); };
}

/** LRU read: a hit is re-inserted so it becomes the newest entry. */
function touchThumb(key: string): ThumbLoadState | undefined {
  const hit = thumbCache.get(key);
  if (hit !== undefined) {
    thumbCache.delete(key);
    thumbCache.set(key, hit);
  }
  return hit;
}

function storeThumb(key: string, state: ThumbLoadState): void {
  thumbCache.delete(key);
  thumbCache.set(key, state);
  while (thumbCache.size > THUMB_CACHE_MAX) {
    const oldest = thumbCache.keys().next().value;
    if (oldest === undefined) break;
    thumbCache.delete(oldest);
  }
}

/** Bounded decode queue: a slot is handed straight to the next waiter on release. */
async function withDerivativeSlot<T>(task: () => Promise<T>): Promise<T> {
  if (derivativeActive < DERIVATIVE_CONCURRENCY) derivativeActive += 1;
  else await new Promise<void>((wake) => derivativeWaiters.push(wake));
  try {
    return await task();
  } finally {
    const next = derivativeWaiters.shift();
    if (next) next();
    else derivativeActive -= 1;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + BASE64_CHUNK) as unknown as number[]);
  }
  return btoa(binary);
}

/** The encoder falls back to PNG when WebP is unavailable; label the data URL honestly. */
function sniffImageMime(bytes: Uint8Array): 'image/png' | 'image/webp' {
  const isPng = bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  return isPng ? 'image/png' : 'image/webp';
}

async function fetchThumbnail(src: string): Promise<{ state: ThumbLoadState; version?: string }> {
  const api = getApi();
  if (typeof api?.notesThumbGet !== 'function') return { state: UNAVAILABLE };
  let result: ThumbGetResult;
  try {
    result = await api.notesThumbGet(src);
  } catch {
    return { state: UNAVAILABLE };
  }
  if (result.status === 'ready') {
    return { state: { status: 'ready', dataUrl: result.dataUrl }, version: result.version };
  }
  if (result.status !== 'source') return { state: UNAVAILABLE };

  let bytes: Uint8Array;
  try {
    bytes = await withDerivativeSlot(() => derivativeGenerator(result.bytes, result.mime));
  } catch {
    return { state: UNAVAILABLE };
  }
  const dataUrl = `data:${sniffImageMime(bytes)};base64,${bytesToBase64(bytes)}`;
  if (typeof api.notesThumbPut === 'function') {
    // Best-effort disk cache; the thumb is already on screen either way.
    void api.notesThumbPut(src, result.version, bytes).catch(() => undefined);
  }
  return { state: { status: 'ready', dataUrl }, version: result.version };
}

/**
 * The derivative for `src` at `version`, as a data URL. Cached per
 * `thumbCacheKey`, one in-flight request per key, and a negative answer is
 * cached too so a broken source isn't retried on every render. Never rejects.
 */
export function loadThumbnail(src: string, version: string): Promise<ThumbLoadState> {
  const key = thumbCacheKey(src, version);
  const hit = touchThumb(key);
  if (hit !== undefined) return Promise.resolve(hit);
  const pending = thumbInFlight.get(key);
  if (pending) return pending;

  const promise = fetchThumbnail(src).then(({ state, version: reported }) => {
    thumbInFlight.delete(key);
    storeThumb(key, state);
    // Main's answer is for the file as it is NOW; if that moved on from the
    // version we were told about, the next resolve will ask under the new one.
    if (reported !== undefined && reported !== version) storeThumb(thumbCacheKey(src, reported), state);
    notifyThumbs();
    return state;
  });
  thumbInFlight.set(key, promise);
  return promise;
}

/** Drop cached derivatives for one source (every version) or for everything. */
export function invalidateThumbnails(src?: string): void {
  if (src === undefined) {
    thumbCache.clear();
  } else {
    const prefix = `${src}@`;
    for (const key of [...thumbCache.keys()]) if (key.startsWith(prefix)) thumbCache.delete(key);
  }
  notifyThumbs();
}

/** A data URL the <img> couldn't decode: remember that so nobody retries it. */
export function markThumbnailUnavailable(src: string, version: string): void {
  storeThumb(thumbCacheKey(src, version), UNAVAILABLE);
  notifyThumbs();
}

/**
 * The derivative for a note's image. `unavailable` when there is no image,
 * a synchronous hit when cached, otherwise `loading` until the load settles.
 * Each hook only re-renders when ITS key changes state.
 */
export function useThumbnail(src: string | null, version: string | null): ThumbLoadState {
  const key = src !== null && version !== null ? thumbCacheKey(src, version) : null;
  const state = useSyncExternalStore(
    subscribeThumbs,
    () => (key === null ? UNAVAILABLE : thumbCache.get(key) ?? LOADING),
  );
  useEffect(() => {
    if (src !== null && version !== null && state.status === 'loading') void loadThumbnail(src, version);
  }, [src, version, state]);
  return state;
}

// ── Generating a derivative ─────────────────────────────────────────────────

/**
 * Target size for a derivative: short edge ≤ 256 AND long edge ≤ 512, aspect
 * kept, never upscaled. An image with no intrinsic size (an SVG without
 * width/height) gets the short-edge square.
 */
export function derivativeSize(width: number, height: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: THUMB_MAX_SHORT_EDGE, height: THUMB_MAX_SHORT_EDGE };
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  const scale = Math.min(1, THUMB_MAX_SHORT_EDGE / short, THUMB_MAX_LONG_EDGE / long);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

/**
 * One decode at full size, then a scaled draw. `createImageBitmap` decodes
 * off-thread but rejects SVG in Chromium, so that goes through an <img>.
 */
async function decodeImage(bytes: Uint8Array, mime: string): Promise<DecodedImage> {
  // IPC bytes arrive on a plain ArrayBuffer; the cast only narrows the buffer
  // generic that TS 5.9's BlobPart insists on.
  const blob = new Blob([bytes as BlobPart], { type: mime });
  if (mime !== 'image/svg+xml' && typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

type DerivativeCanvas = OffscreenCanvas | HTMLCanvasElement;

function createCanvas(width: number, height: number): { canvas: DerivativeCanvas; ctx: CanvasDrawImage & CanvasImageSmoothing } {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
    return { canvas, ctx };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  return { canvas, ctx };
}

/** WebP at the spec quality; PNG when the encoder declines (returns null). */
async function encodeCanvas(canvas: DerivativeCanvas): Promise<Blob> {
  const attempt = (type: string, quality?: number): Promise<Blob | null> =>
    'convertToBlob' in canvas
      ? canvas.convertToBlob({ type, quality }).catch(() => null)
      : new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  const blob = (await attempt('image/webp', WEBP_QUALITY)) ?? (await attempt('image/png'));
  if (!blob) throw new Error('canvas encode failed');
  return blob;
}

/**
 * Scale source bytes down to a ~256px derivative (§6). Decodes once, draws
 * scaled with high-quality smoothing, encodes WebP (PNG fallback). Rejects on
 * undecodable input; `loadThumbnail` turns that into `unavailable`.
 */
export async function generateDerivative(bytes: Uint8Array, mime: string): Promise<Uint8Array> {
  const decoded = await decodeImage(bytes, mime);
  try {
    const { width, height } = derivativeSize(decoded.width, decoded.height);
    const { canvas, ctx } = createCanvas(width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(decoded.source, 0, 0, width, height);
    const blob = await encodeCanvas(canvas);
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    decoded.release();
  }
}

/** Swap the decoder out under jsdom, which has no canvas or `createImageBitmap`. */
export function setDerivativeGeneratorForTests(generator: DerivativeGenerator | null): void {
  derivativeGenerator = generator ?? generateDerivative;
}

export function __resetThumbnailCachesForTests(): void {
  infoMemo.clear();
  staleInfo.clear();
  inFlightInfo.clear();
  pendingPaths = new Set();
  pendingFlush = null;
  thumbCache.clear();
  thumbInFlight.clear();
  derivativeActive = 0;
  derivativeWaiters.length = 0;
  derivativeGenerator = generateDerivative;
  for (const off of vaultUnsubscribes ?? []) off();
  vaultUnsubscribes = null;
}
