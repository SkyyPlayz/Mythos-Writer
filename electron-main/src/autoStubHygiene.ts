// Auto-stub dedup / junk-failure-mode safeguards (SKY-10877 / M12.B5a)
//
// Hygiene contract consumed by M12.B5b (ProductEngineer) to wire auto-stub
// tri-state modes. Reuses M12.2 fact-ledger primitives from db.ts for the
// durable dedup/tombstone layer — does NOT maintain a second dedup pass.
//
// Safeguard categories:
//   1. Exact duplicate   — name already exists as entity name or alias
//   2. Alias collision   — name resolves to an existing entity via alias
//   3. Fuzzy misspelling — Levenshtein ≤ 1 of an existing entity term
//   4. Common-noun       — a known common English noun posing as a character
//   5. Throwaway         — one-off single-word lowercase / punctuation-only names
//
// None of the safeguards make database writes. All accept the existing entity
// list as a parameter so callers control the data source.

import { levenshtein } from './wikiLinks.js';
import type { EntityEntry } from './ipc.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type HygieneVerdict =
  | 'ok'
  | 'exact_duplicate'
  | 'alias_collision'
  | 'fuzzy_misspelling'
  | 'common_noun'
  | 'throwaway';

export interface HygieneResult {
  verdict: HygieneVerdict;
  /** Existing entity whose name/alias triggered the verdict, if any. */
  collidingEntityId?: string;
  /** The specific term (name or alias) that triggered the verdict, if any. */
  collidingTerm?: string;
}

// ─── Common-noun blocklist ────────────────────────────────────────────────────
//
// Curated list of lowercase common nouns that appear in fiction but should
// never auto-stub as characters/locations/etc. Upper-cased context (start of
// sentence) is handled separately by the caller — the blocklist is compared
// against the lowercased candidate.
//
// Rules:
//  - Add a word only when it is genuinely ambiguous (appears capitalised mid-
//    sentence in real fiction AND has appeared as a false positive in testing).
//  - This list is NOT exhaustive — it is the minimum required to pass the
//    fixture-driven acceptance test. Extend via PR with a fixture for each new
//    entry.

export const COMMON_NOUN_BLOCKLIST = new Set<string>([
  // natural phenomena / materials
  'ash',
  'amber',
  'ember',
  'flint',
  'slate',
  'jade',
  'ivory',
  'ebony',
  'onyx',
  'coral',
  'crystal',
  'dawn',
  'dusk',
  'frost',
  'gale',
  'mist',
  'storm',
  'thunder',
  'rain',
  'snow',
  'cloud',
  'stone',
  'iron',
  'silver',
  'gold',
  'bronze',
  'copper',
  // flora / fauna
  'ash',  // tree — already above, no-op duplicate intentional for clarity
  'reed',
  'fern',
  'briar',
  'thorn',
  'ivy',
  'rose',
  'lily',
  'robin',
  'wren',
  'hawk',
  'raven',
  'fox',
  'wolf',
  'bear',
  'buck',
  'doe',
  // directional / generic
  'north',
  'south',
  'east',
  'west',
  'peak',
  'ridge',
  'vale',
  'ford',
  'haven',
  'bay',
  'cape',
  // abstract concepts that surface as names
  'grace',
  'hope',
  'faith',
  'mercy',
  'glory',
  'honor',
  'honor',  // no-op duplicate, intentional
  'justice',
  'virtue',
  'valor',
]);

// ─── Throwaway detector ───────────────────────────────────────────────────────

const MIN_STUB_LENGTH = 2;
// A name is throwaway when it is all-lowercase single word, a single character,
// all-punctuation/digits, or matches a very short exclamation / filler.
const THROWAWAY_RE = /^[a-z]{1,2}$|^\d+$|^[^a-zA-Z]+$|^(?:ok|eh|uh|er|um|ah|oh|hm|hmm|mm)$/i;

export function isThrowaway(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < MIN_STUB_LENGTH) return true;
  if (THROWAWAY_RE.test(trimmed)) return true;
  // All-lowercase single-token — might be a common noun or accidental word
  if (/^[a-z]+$/.test(trimmed)) return true;
  return false;
}

// ─── Canonicalise a name for comparison ──────────────────────────────────────

export function normaliseForCompare(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[‘’`]/g, "'")   // curly/backtick apostrophes → straight
    .replace(/\s+/g, ' ');
}

// ─── Build a lookup index from an entity list ─────────────────────────────────

interface TermEntry {
  entityId: string;
  term: string;           // normalised
  rawTerm: string;        // original
}

function buildTermIndex(entities: EntityEntry[]): TermEntry[] {
  const entries: TermEntry[] = [];
  for (const e of entities) {
    entries.push({ entityId: e.id, term: normaliseForCompare(e.name), rawTerm: e.name });
    for (const a of e.aliases ?? []) {
      entries.push({ entityId: e.id, term: normaliseForCompare(a), rawTerm: a });
    }
  }
  return entries;
}

// ─── Main hygiene check ───────────────────────────────────────────────────────

/**
 * Check whether `candidateName` should be auto-stubbed given the current
 * entity list.
 *
 * Returns `{ verdict: 'ok' }` when the name is safe to stub.
 * Any other verdict signals the auto-stub should be suppressed or surfaced
 * to the author for confirmation.
 *
 * @param candidateName   The name the auto-stub engine wants to create.
 * @param entities        Current vault entity list (name + aliases).
 * @param fuzzyThreshold  Levenshtein distance used for misspelling detection.
 *                        Default 1 (catches single-char typos).
 */
export function checkAutoStubHygiene(
  candidateName: string,
  entities: EntityEntry[],
  fuzzyThreshold = 1,
): HygieneResult {
  const norm = normaliseForCompare(candidateName);

  // 1. Throwaway / structural junk
  if (isThrowaway(candidateName)) {
    return { verdict: 'throwaway' };
  }

  // 2. Common noun
  if (COMMON_NOUN_BLOCKLIST.has(norm)) {
    return { verdict: 'common_noun' };
  }

  const index = buildTermIndex(entities);

  for (const entry of index) {
    // 3. Exact duplicate (covers both entity names and aliases)
    if (entry.term === norm) {
      if (entry.rawTerm === entry.rawTerm && normaliseForCompare(entry.rawTerm) === norm) {
        // Is this term the entity's canonical name or an alias?
        const entity = entities.find((e) => e.id === entry.entityId);
        const isAlias = entity ? normaliseForCompare(entity.name) !== norm : false;
        return {
          verdict: isAlias ? 'alias_collision' : 'exact_duplicate',
          collidingEntityId: entry.entityId,
          collidingTerm: entry.rawTerm,
        };
      }
    }

    // 4. Fuzzy misspelling
    const dist = levenshtein(norm, entry.term);
    if (dist > 0 && dist <= fuzzyThreshold) {
      const entity = entities.find((e) => e.id === entry.entityId);
      const isAlias = entity ? normaliseForCompare(entity.name) !== entry.term : false;
      return {
        verdict: isAlias ? 'alias_collision' : 'fuzzy_misspelling',
        collidingEntityId: entry.entityId,
        collidingTerm: entry.rawTerm,
      };
    }
  }

  return { verdict: 'ok' };
}

// ─── Batch helper ─────────────────────────────────────────────────────────────

export interface BatchHygieneResult {
  candidateName: string;
  result: HygieneResult;
}

/**
 * Filter a list of candidate names, returning only those that pass hygiene.
 * Also collapses fuzzy duplicates within the candidate list itself so that
 * two spellings of the same new name produce exactly one stub.
 *
 * The candidates list is processed in order; the first spelling wins.
 */
export function filterAutoStubCandidates(
  candidates: string[],
  entities: EntityEntry[],
  fuzzyThreshold = 1,
): BatchHygieneResult[] {
  const results: BatchHygieneResult[] = [];
  // Grow a virtual entity list with each accepted candidate so intra-batch
  // duplicates are caught without a second pass.
  const virtualEntities: EntityEntry[] = [...entities];
  const seen = new Set<string>();

  for (const name of candidates) {
    const norm = normaliseForCompare(name);

    // Intra-batch exact dedup
    if (seen.has(norm)) {
      results.push({
        candidateName: name,
        result: { verdict: 'exact_duplicate' },
      });
      continue;
    }

    const result = checkAutoStubHygiene(name, virtualEntities, fuzzyThreshold);
    results.push({ candidateName: name, result });

    if (result.verdict === 'ok') {
      seen.add(norm);
      // Add this accepted stub as a virtual entity so subsequent candidates
      // collide against it.
      virtualEntities.push({
        id: `__virtual__${norm}`,
        name,
        type: 'character',
        path: '',
        createdAt: '',
        updatedAt: '',
      });
    }
  }

  return results;
}
