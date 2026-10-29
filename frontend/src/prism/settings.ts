// Prism (#1764) — per-book settings and their persistence through the vault IPC.
//
// Settings persist per story as `<Story.path>/prism.json`, written through the
// same `window.api.readVault` / `writeVault` channels comments.json uses
// (electron-main enforces the .md/.json + no-dotfile allow-list at the IPC
// boundary). Reading is tolerant by design: every field is validated on its
// own and falls back to its shipped default, so a hand-edited or half-written
// file degrades to "some defaults", never a throw.

import { PRISM_CHECK_IDS, type PrismCheckId, type PrismSettings, type PrismThresholds } from './types';

export const PRISM_FILE_VERSION = 1;
export const PRISM_FILE_BASENAME = 'prism.json';

/** Edits a surface can make. Nested maps merge key-by-key over the current value. */
export type PrismSettingsPatch = Partial<
  Pick<PrismSettings, 'flags' | 'proseColors' | 'analyticsOpen'>
> & {
  checks?: Partial<Record<PrismCheckId, boolean>>;
  thresholds?: Partial<PrismThresholds>;
};

/** Inclusive integer bounds per threshold; anything outside falls back. */
const THRESHOLD_BOUNDS: Readonly<Record<keyof PrismThresholds, readonly [number, number]>> = {
  longSentenceWords: [8, 200],
  overusedMinRepeats: [2, 20],
  overusedWindowWords: [20, 2000],
};

const THRESHOLD_KEYS = Object.keys(THRESHOLD_BOUNDS) as (keyof PrismThresholds)[];

/**
 * Shipped defaults: both display switches off (Prism is opt-in per book),
 * every check on except the narrator tint (tinting all narration is noisy).
 * Deep-frozen — normalize/apply always hand back fresh copies.
 */
export const DEFAULT_PRISM_SETTINGS: PrismSettings = Object.freeze({
  version: PRISM_FILE_VERSION,
  flags: false,
  proseColors: false,
  checks: Object.freeze(
    Object.fromEntries(PRISM_CHECK_IDS.map((id) => [id, id !== 'narrator'])) as Record<
      PrismCheckId,
      boolean
    >
  ),
  thresholds: Object.freeze({
    longSentenceWords: 30,
    overusedMinRepeats: 3,
    overusedWindowWords: 100,
  }),
  analyticsOpen: true,
});

/** Vault-relative path of a story's Prism file (`stories/<id>/prism.json`). */
export function prismFilePath(storyPath: string): string {
  const trimmed = storyPath.replace(/\/+$/, '');
  return trimmed ? `${trimmed}/${PRISM_FILE_BASENAME}` : PRISM_FILE_BASENAME;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function threshold(key: keyof PrismThresholds, v: unknown, fallback: number): number {
  const [min, max] = THRESHOLD_BOUNDS[key];
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

/** Validate `raw` field by field, falling back to `base` for anything invalid. */
function normalizeOver(raw: unknown, base: PrismSettings): PrismSettings {
  const r = asRecord(raw) ?? {};
  const rawChecks = asRecord(r.checks) ?? {};
  const rawThresholds = asRecord(r.thresholds) ?? {};
  const checks = {} as Record<PrismCheckId, boolean>;
  for (const id of PRISM_CHECK_IDS) checks[id] = bool(rawChecks[id], base.checks[id]);
  const thresholds = {} as PrismThresholds;
  for (const key of THRESHOLD_KEYS) {
    thresholds[key] = threshold(key, rawThresholds[key], base.thresholds[key]);
  }
  return {
    version: PRISM_FILE_VERSION,
    flags: bool(r.flags, base.flags),
    proseColors: bool(r.proseColors, base.proseColors),
    checks,
    thresholds,
    analyticsOpen: bool(r.analyticsOpen, base.analyticsOpen),
  };
}

/**
 * Coerce anything (parsed JSON, a stale in-memory shape) into valid settings.
 * Unknown keys are dropped; each field falls back to its default on its own.
 * Never throws and always returns fresh objects.
 */
export function normalizePrismSettings(raw: unknown): PrismSettings {
  try {
    return normalizeOver(raw, DEFAULT_PRISM_SETTINGS);
  } catch {
    // Hostile input (throwing getters, proxies) — treat as absent.
    return normalizeOver(null, DEFAULT_PRISM_SETTINGS);
  }
}

/** Parse a prism.json payload. Malformed JSON degrades to the defaults. */
export function parsePrismSettings(rawText: string): PrismSettings {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return normalizePrismSettings(null);
  }
  return normalizePrismSettings(parsed);
}

export function serializePrismSettings(s: PrismSettings): string {
  return `${JSON.stringify(normalizePrismSettings(s), null, 2)}\n`;
}

/**
 * Pure patch: merge `patch` over `s` and return a normalized copy. Invalid
 * patch values (wrong type, out-of-range threshold, unknown check id) are
 * ignored, so the current value survives rather than snapping to a default.
 */
export function applyPrismPatch(s: PrismSettings, patch: PrismSettingsPatch): PrismSettings {
  const base = normalizePrismSettings(s);
  const p = asRecord(patch) ?? {};
  try {
    return normalizeOver(
      {
        ...base,
        ...(p.flags !== undefined ? { flags: p.flags } : {}),
        ...(p.proseColors !== undefined ? { proseColors: p.proseColors } : {}),
        ...(p.analyticsOpen !== undefined ? { analyticsOpen: p.analyticsOpen } : {}),
        checks: { ...base.checks, ...(asRecord(p.checks) ?? {}) },
        thresholds: { ...base.thresholds, ...(asRecord(p.thresholds) ?? {}) },
      },
      base
    );
  } catch {
    return base;
  }
}

/**
 * Load a story's Prism settings from the vault. A missing file (first run),
 * a corrupt file, a read error or an unavailable IPC bridge (unit tests,
 * storybook) all yield the defaults.
 */
export async function loadPrismSettings(storyPath: string): Promise<PrismSettings> {
  const api = typeof window === 'undefined' ? undefined : window.api;
  if (typeof api?.readVault !== 'function') return normalizePrismSettings(null);
  try {
    const res = await api.readVault(prismFilePath(storyPath));
    return typeof res?.content === 'string'
      ? parsePrismSettings(res.content)
      : normalizePrismSettings(null);
  } catch {
    // ENOENT before the first change is saved — treat as defaults.
    return normalizePrismSettings(null);
  }
}

/** Persist a story's Prism settings. No-ops (resolved) when the bridge is absent. */
export async function savePrismSettings(storyPath: string, s: PrismSettings): Promise<void> {
  const api = typeof window === 'undefined' ? undefined : window.api;
  if (typeof api?.writeVault !== 'function') return;
  const res = await api.writeVault(prismFilePath(storyPath), serializePrismSettings(s));
  if (res && typeof res.error === 'string' && res.error) {
    throw new Error(res.error);
  }
}
