// Auto-stub hygiene safeguards — fixture-driven unit tests (SKY-10877 / M12.B5a)
//
// Acceptance criteria:
//  AC1: Exact dedup against entity names and aliases
//  AC2: Alias-collision detection
//  AC3: Common-noun rejection (incl. "Ash" trap case)
//  AC4: Fuzzy misspelling collapse
//  AC5: Throwaway / junk-name rejection
//  AC6: Negative control — naive implementation would create two stubs for
//       two spellings of the same name; assert we collapse to one
//  AC7: Intra-batch dedup in filterAutoStubCandidates

import { describe, it, expect } from 'vitest';
import type { EntityEntry } from './ipc.js';
import {
  checkAutoStubHygiene,
  filterAutoStubCandidates,
  isThrowaway,
  normaliseForCompare,
  COMMON_NOUN_BLOCKLIST,
} from './autoStubHygiene.js';

// ─── Shared fixture entities ──────────────────────────────────────────────────

function makeEntity(
  id: string,
  name: string,
  aliases: string[] = [],
): EntityEntry {
  return {
    id,
    name,
    type: 'character',
    path: `Universes/Characters/${name}.md`,
    aliases,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const LYRA = makeEntity('e-lyra', 'Lyra Ash', ['Lyra']);
const ASH_ENTITY = makeEntity('e-ashborn', 'Ashborn', ['Ash']);
const ELENA = makeEntity('e-elena', 'Elena', ['Ellie', 'Ell']);

const BASE_ENTITIES: EntityEntry[] = [LYRA, ASH_ENTITY, ELENA];

// ─── normaliseForCompare ──────────────────────────────────────────────────────

describe('normaliseForCompare', () => {
  it('lowercases and trims', () => {
    expect(normaliseForCompare('  Lyra  ')).toBe('lyra');
  });

  it('collapses internal whitespace', () => {
    expect(normaliseForCompare('Lyra  Ash')).toBe('lyra ash');
  });

  it('normalises curly apostrophes', () => {
    expect(normaliseForCompare("O’Brien")).toBe("o'brien");
  });
});

// ─── isThrowaway ─────────────────────────────────────────────────────────────

describe('isThrowaway', () => {
  it.each([
    ['a', true],
    ['X', true],
    ['ok', true],
    ['uh', true],
    ['123', true],
    ['...', true],
    ['ash', true],      // all-lowercase single token
    ['Ash', false],     // capitalised — not throwaway (may be common noun though)
    ['Elena', false],
    ['Lyra Ash', false],
  ])('isThrowaway(%s) === %s', (input, expected) => {
    expect(isThrowaway(input)).toBe(expected);
  });
});

// ─── COMMON_NOUN_BLOCKLIST ────────────────────────────────────────────────────

describe('COMMON_NOUN_BLOCKLIST', () => {
  it('contains "ash"', () => {
    expect(COMMON_NOUN_BLOCKLIST.has('ash')).toBe(true);
  });

  it('contains expected ecology words', () => {
    for (const w of ['ember', 'frost', 'dawn', 'raven', 'wolf']) {
      expect(COMMON_NOUN_BLOCKLIST.has(w)).toBe(true);
    }
  });
});

// ─── AC1: Exact duplicate detection ──────────────────────────────────────────

describe('checkAutoStubHygiene — exact duplicate', () => {
  it('rejects exact entity name match (case-insensitive)', () => {
    const r = checkAutoStubHygiene('ELENA', BASE_ENTITIES);
    expect(r.verdict).toBe('exact_duplicate');
    expect(r.collidingEntityId).toBe('e-elena');
  });

  it('rejects name that differs only in whitespace', () => {
    const r = checkAutoStubHygiene('Lyra  Ash', BASE_ENTITIES);
    expect(r.verdict).toBe('exact_duplicate');
    expect(r.collidingEntityId).toBe('e-lyra');
  });
});

// ─── AC2: Alias collision ─────────────────────────────────────────────────────

describe('checkAutoStubHygiene — alias collision', () => {
  it('rejects name that is an alias of an existing entity', () => {
    // "Ellie" is an alias of Elena
    const r = checkAutoStubHygiene('Ellie', BASE_ENTITIES);
    expect(r.verdict).toBe('alias_collision');
    expect(r.collidingEntityId).toBe('e-elena');
    expect(r.collidingTerm).toBe('Ellie');
  });

  it('treats "Lyra" alias as alias collision, not exact_duplicate', () => {
    const r = checkAutoStubHygiene('Lyra', BASE_ENTITIES);
    expect(r.verdict).toBe('alias_collision');
    expect(r.collidingEntityId).toBe('e-lyra');
  });
});

// ─── AC3: Common-noun / "Ash" trap case ──────────────────────────────────────

describe('checkAutoStubHygiene — common noun (the "Ash" trap case)', () => {
  // "Ash" exists as an alias of Ashborn, so it would normally be caught
  // by alias_collision. But the spec requires that even WITHOUT a character
  // named Ash in the vault, the common-noun gate must block it.
  it('rejects "Ash" as a common noun even when no entity uses the alias', () => {
    // Empty entity list — no existing character called Ash at all
    const r = checkAutoStubHygiene('Ash', []);
    expect(r.verdict).toBe('common_noun');
  });

  it('rejects other blocklisted words', () => {
    for (const word of ['Ember', 'Dawn', 'Frost', 'Raven', 'Wolf']) {
      const r = checkAutoStubHygiene(word, []);
      expect(r.verdict).toBe('common_noun');
    }
  });

  it('does NOT reject "Ashborn" (not in blocklist)', () => {
    const r = checkAutoStubHygiene('Ashborn', []);
    expect(r.verdict).toBe('ok');
  });
});

// ─── AC4: Fuzzy misspelling ───────────────────────────────────────────────────

describe('checkAutoStubHygiene — fuzzy misspelling', () => {
  it('catches single-char transposition (Elen→Elena)', () => {
    const r = checkAutoStubHygiene('Elen', BASE_ENTITIES);
    // Levenshtein("elen","elena") = 1 (missing 'a')
    expect(r.verdict).toBe('fuzzy_misspelling');
    expect(r.collidingEntityId).toBe('e-elena');
  });

  it('allows a name two edits away (outside default threshold)', () => {
    // "Elayna" vs "Elena": E-E, l-l, a-e(sub), y-n(sub), n-a(sub), a → distance ≥ 2
    const r = checkAutoStubHygiene('Elayna', BASE_ENTITIES);
    expect(r.verdict).toBe('ok');
  });

  it('accepts a wider threshold when explicitly requested', () => {
    // "Elen" is 1 edit from "Elena"; threshold=2 should still catch it
    const r = checkAutoStubHygiene('Elen', BASE_ENTITIES, 2);
    expect(r.verdict).not.toBe('ok');
  });
});

// ─── AC5: Throwaway names ─────────────────────────────────────────────────────

describe('checkAutoStubHygiene — throwaway names', () => {
  it('rejects empty-ish names', () => {
    expect(checkAutoStubHygiene('a', []).verdict).toBe('throwaway');
  });

  it('rejects all-lowercase single tokens (accidental words)', () => {
    expect(checkAutoStubHygiene('hero', []).verdict).toBe('throwaway');
  });

  it('does NOT reject capitalised multi-word names', () => {
    expect(checkAutoStubHygiene('Lady Voss', []).verdict).toBe('ok');
  });
});

// ─── AC6: Negative control — two spellings must collapse to one stub ──────────
//
// A naive implementation would accept "Elenna" and then also accept "Elena"
// again (if it doesn't track accepted candidates). The real implementation
// must collapse them because "Elena" is already in the vault.

describe('filterAutoStubCandidates — negative control (two spellings → one stub)', () => {
  it('collapses two spellings of the same name — naive implementation fails here', () => {
    // Naive: treats "Elena" and "Elenna" as unrelated strings, might accept both.
    // Real:  "Elena" hits exact_duplicate; "Elenna" hits fuzzy_misspelling.
    const candidates = ['Elena', 'Elenna'];
    const results = filterAutoStubCandidates(candidates, BASE_ENTITIES);

    // Neither should pass — both collide with the existing Elena entity.
    const accepted = results.filter((r) => r.result.verdict === 'ok');
    expect(accepted).toHaveLength(0);

    const elenaResult = results.find((r) => r.candidateName === 'Elena');
    expect(elenaResult?.result.verdict).toBe('exact_duplicate');

    // Elenna is 1 edit away from Elena: fuzzy_misspelling or alias_collision
    const elennaResult = results.find((r) => r.candidateName === 'Elenna');
    expect(['fuzzy_misspelling', 'alias_collision', 'exact_duplicate']).toContain(
      elennaResult?.result.verdict,
    );
  });

  it('collapses intra-batch duplicates (same new name submitted twice)', () => {
    // Neither name is in the vault, but the same candidate appears twice.
    const candidates = ['Seraphina', 'Seraphina'];
    const results = filterAutoStubCandidates(candidates, []);

    const accepted = results.filter((r) => r.result.verdict === 'ok');
    // First occurrence accepted; second is an exact_duplicate of the first.
    expect(accepted).toHaveLength(1);
    expect(accepted[0].candidateName).toBe('Seraphina');

    const second = results[1];
    expect(second.result.verdict).toBe('exact_duplicate');
  });
});

// ─── AC7: Intra-batch fuzzy dedup ────────────────────────────────────────────

describe('filterAutoStubCandidates — intra-batch fuzzy dedup', () => {
  it('collapses two spellings of a brand-new name to one', () => {
    // "Zareth" and "Zareth" with a typo "Zarethh" — not in vault at all.
    // After accepting "Zareth", "Zarethh" must collide with it.
    const candidates = ['Zareth', 'Zarethh'];
    const results = filterAutoStubCandidates(candidates, []);

    const accepted = results.filter((r) => r.result.verdict === 'ok');
    expect(accepted).toHaveLength(1);
    expect(accepted[0].candidateName).toBe('Zareth');

    const second = results.find((r) => r.candidateName === 'Zarethh');
    expect(second?.result.verdict).toBe('fuzzy_misspelling');
  });
});

// ─── Happy-path smoke test ────────────────────────────────────────────────────

describe('checkAutoStubHygiene — happy path', () => {
  it('passes a genuinely new proper-noun name', () => {
    const r = checkAutoStubHygiene('Caelindra', BASE_ENTITIES);
    expect(r.verdict).toBe('ok');
  });

  it('passes a multi-word location name', () => {
    const r = checkAutoStubHygiene('Thornhaven Keep', BASE_ENTITIES);
    expect(r.verdict).toBe('ok');
  });
});
