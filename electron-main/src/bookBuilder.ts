// Book profile model and print geometry for book.md.
//
// This module is pure: it does not read or write the vault, does not take the
// book.md lock, and does not speak IPC. The fence lives in mythosFormat/bookFile.ts.
// The compare-and-swap write lives in vault.ts (writeBookFileCas).
//
// Print numbers locked 2026-11-02:
//   KDP "Set Trim Size, Bleed, and Margins"
//   https://kdp.amazon.com/help/topic/GVBQ3CMEQW3W2VL6
//   Inside gutter: 24–150 → 0.375in, 151–300 → 0.5in, 301–500 → 0.625in,
//   501–700 → 0.75in, 701–828 → 0.875in. Outside minimum without bleed is 0.25in.
//   6 × 9 in is the common US paperback trim named on that page.
//   IngramSpark file creation guide (document titled 8.24.26), fetched the same day:
//   https://www.ingramspark.com/hubfs/downloads/file-creation-guide.pdf
//   6 × 9 in is a listed trim. Recommended minimum margin is 0.5in on all sides.
//   Ingram does not publish KDP's page-count gutter table.
//
// S0 margins are symmetric: left = right = max(gutter band, 0.5in), top = bottom = 0.5in.
// Mirrored inside/outside gutters are a later slice.

export const BOOK_PRESET_IDS = ['kdp-ebook', 'kdp-paperback', 'ingram-print', 'generic-epub'] as const;
export type BookPresetId = (typeof BOOK_PRESET_IDS)[number];

export const BOOK_STYLE_IDS = ['classic', 'modern', 'fantasy'] as const;
export type BookStyleId = (typeof BOOK_STYLE_IDS)[number];

export const MAX_BOOK_PROFILES = 50;
export const MAX_BOOK_PROFILES_FENCE_BYTES = 64 * 1024;

export const GUTTER_PAGE_MIN = 24;
export const GUTTER_PAGE_MAX = 828;

/** KDP inside-gutter bands, in inches. Page counts outside 24–828 clamp to the nearest edge. */
export const GUTTER_BANDS = [
  { min: 24, max: 150, inches: 0.375 },
  { min: 151, max: 300, inches: 0.5 },
  { min: 301, max: 500, inches: 0.625 },
  { min: 501, max: 700, inches: 0.75 },
  { min: 701, max: 828, inches: 0.875 },
] as const;

const SIDE_MARGIN_FLOOR_INCHES = 0.5;
const TOP_BOTTOM_MARGIN_INCHES = 0.5;

/** BCP 47 language tag: 2–3 letter language, optional script, region, and extensions. */
const BCP47_RE =
  /^[a-zA-Z]{2,3}(?:-[a-zA-Z]{4})?(?:-(?:[a-zA-Z]{2}|\d{3}))?(?:-(?:[a-zA-Z0-9]{5,8}|\d[a-zA-Z0-9]{3}))*$/;

const EBOOK_PRESET_IDS = new Set<BookPresetId>(['kdp-ebook', 'generic-epub']);

export interface PageSizeInches {
  width: number;
  height: number;
}

export interface PageMarginsInches {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface BookProfile {
  id: string;
  name: string;
  presetId: BookPresetId;
  styleId: BookStyleId;
  language: string;
  matter: Record<string, unknown>;
  isbn?: string;
  author?: string;
  publisher?: string;
  copyrightYear?: number;
}

export type BookProfileField =
  | 'id'
  | 'name'
  | 'presetId'
  | 'styleId'
  | 'language'
  | 'matter'
  | 'isbn'
  | 'author'
  | 'publisher'
  | 'copyrightYear'
  | 'cap';

export type BookProfileValidation =
  | { ok: true; profile: BookProfile }
  | { ok: false; field: BookProfileField };

export type BookProfilesValidation =
  | { ok: true; profiles: BookProfile[] }
  | { ok: false; field: BookProfileField };

export class BookProfilesCapError extends Error {
  readonly event = 'book-profiles-cap' as const;
  constructor() {
    super('book-profiles-cap');
    this.name = 'BookProfilesCapError';
  }
}

function isPresetId(value: string): value is BookPresetId {
  return (BOOK_PRESET_IDS as readonly string[]).includes(value);
}

function isStyleId(value: string): value is BookStyleId {
  return (BOOK_STYLE_IDS as readonly string[]).includes(value);
}

function reject(field: BookProfileField): { ok: false; field: BookProfileField } {
  return { ok: false, field };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || /[\r\n]/.test(value)) return null;
  return trimmed;
}

function optionalText(value: unknown): { ok: true; value?: string } | { ok: false } {
  if (value === undefined) return { ok: true };
  if (typeof value !== 'string' || value.trim() === '' || /[\r\n]/.test(value)) return { ok: false };
  return { ok: true, value: value.trim() };
}

/**
 * Print presets are 6×9 inches. Reflowable ebook presets have no trim size.
 */
export function pageSizeInchesForPreset(presetId: BookPresetId): PageSizeInches | null {
  switch (presetId) {
    case 'kdp-paperback':
    case 'ingram-print':
      return { width: 6, height: 9 };
    case 'kdp-ebook':
    case 'generic-epub':
      return null;
    default: {
      const _exhaustive: never = presetId;
      return _exhaustive;
    }
  }
}

/** Clamp to the nearest published band edge (24 or 828). Non-finite counts clamp low. */
export function clampPageCountToGutterBands(pageCount: number): number {
  if (!Number.isFinite(pageCount)) return GUTTER_PAGE_MIN;
  const pages = Math.trunc(pageCount);
  if (pages < GUTTER_PAGE_MIN) return GUTTER_PAGE_MIN;
  if (pages > GUTTER_PAGE_MAX) return GUTTER_PAGE_MAX;
  return pages;
}

export function gutterBandInches(pageCount: number): number {
  const pages = clampPageCountToGutterBands(pageCount);
  for (const band of GUTTER_BANDS) {
    if (pages >= band.min && pages <= band.max) return band.inches;
  }
  return GUTTER_BANDS[GUTTER_BANDS.length - 1].inches;
}

/**
 * Symmetric page margins in inches. The side margin is the KDP gutter band,
 * and never under IngramSpark's 0.5in floor. Top and bottom are 0.5in.
 */
export function pageMarginsInches(pageCount: number): PageMarginsInches {
  const side = Math.max(gutterBandInches(pageCount), SIDE_MARGIN_FLOOR_INCHES);
  return {
    top: TOP_BOTTOM_MARGIN_INCHES,
    bottom: TOP_BOTTOM_MARGIN_INCHES,
    left: side,
    right: side,
  };
}

export function validateBookProfile(raw: unknown): BookProfileValidation {
  if (!isPlainRecord(raw)) return reject('id');
  const id = requiredText(raw.id);
  if (!id) return reject('id');
  const name = requiredText(raw.name);
  if (!name) return reject('name');
  if (typeof raw.presetId !== 'string' || !isPresetId(raw.presetId)) return reject('presetId');
  if (typeof raw.styleId !== 'string' || !isStyleId(raw.styleId)) return reject('styleId');
  if (typeof raw.language !== 'string' || !BCP47_RE.test(raw.language)) return reject('language');
  if (!isPlainRecord(raw.matter)) return reject('matter');

  const presetId = raw.presetId;
  let isbn: string | undefined;
  if (raw.isbn !== undefined) {
    if (typeof raw.isbn !== 'string' || /[\r\n]/.test(raw.isbn)) return reject('isbn');
    if (raw.isbn.trim() === '') {
      if (!EBOOK_PRESET_IDS.has(presetId)) return reject('isbn');
      isbn = '';
    } else {
      isbn = raw.isbn.trim();
    }
  }

  const author = optionalText(raw.author);
  if (!author.ok) return reject('author');
  const publisher = optionalText(raw.publisher);
  if (!publisher.ok) return reject('publisher');

  let copyrightYear: number | undefined;
  if (raw.copyrightYear !== undefined) {
    if (typeof raw.copyrightYear !== 'number' || !Number.isInteger(raw.copyrightYear)) {
      return reject('copyrightYear');
    }
    if (raw.copyrightYear < 1 || raw.copyrightYear > 9999) return reject('copyrightYear');
    copyrightYear = raw.copyrightYear;
  }

  const matter: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw.matter)) matter[key] = value;

  const profile: BookProfile = {
    id,
    name,
    presetId,
    styleId: raw.styleId,
    language: raw.language,
    matter,
    ...(isbn !== undefined ? { isbn } : {}),
    ...(author.value !== undefined ? { author: author.value } : {}),
    ...(publisher.value !== undefined ? { publisher: publisher.value } : {}),
    ...(copyrightYear !== undefined ? { copyrightYear } : {}),
  };
  return { ok: true, profile };
}

export function validateBookProfiles(raw: unknown): BookProfilesValidation {
  if (!Array.isArray(raw)) return reject('cap');
  if (raw.length > MAX_BOOK_PROFILES) return reject('cap');
  const profiles: BookProfile[] = [];
  for (const entry of raw) {
    const one = validateBookProfile(entry);
    if (!one.ok) return one;
    profiles.push(one.profile);
  }
  return { ok: true, profiles };
}
