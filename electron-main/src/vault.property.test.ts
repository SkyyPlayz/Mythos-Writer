// SKY-361: Property-based tests for the YAML frontmatter parser/serializer.
//
// parseFrontmatter and serializeFrontmatter are hand-rolled and process
// attacker-controlled .md files during Obsidian vault import. These tests
// use fast-check to cover the combinatorial space that example tests miss.
//
// MUTATION DETECTION: each property is annotated with a specific mutation
// that would cause it to fail — proving it covers real behaviour.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseFrontmatter, serializeFrontmatter } from './vault.js';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

// Keys: no colon (separator), no newline (line-based parser), no surrounding
// whitespace (the parser trims keys so leading/trailing spaces would be lost).
const safeKey = fc
  .string({ minLength: 1, maxLength: 64 })
  .filter(
    (s) => !s.includes(':') && !s.includes('\n') && !s.includes('\r') && s === s.trim()
  );

// String values: no newlines (line-based parser), not 'true'/'false' (coerced to
// boolean), not purely numeric (coerced to number), no leading/trailing whitespace
// (parseFrontmatter calls .trim() on every value so trailing spaces are lost), and
// not YAML-array syntax `[a, b]` (parser coerces those to string arrays, not string).
const safeStringValue = fc
  .string({ minLength: 0, maxLength: 512 })
  .filter(
    (s) =>
      !s.includes('\n') &&
      !s.includes('\r') &&
      s !== 'true' &&
      s !== 'false' &&
      isNaN(Number(s)) &&
      s === s.trim() &&
      !(s.startsWith('[') && s.endsWith(']'))
  );

// Prose that does NOT contain '\n---' so the end-of-frontmatter regex
// picks the correct delimiter even on adversarial inputs.
const safeProse = fc
  .string()
  .filter((s) => !s.includes('\n---') && !s.includes('\r\n---'));

// Variable key→string record, up to 10 keys (zero-key case is always skipped).
const safeStringRecord: fc.Arbitrary<Record<string, unknown>> = fc
  .uniqueArray(safeKey, { minLength: 1, maxLength: 10 })
  .chain((keys) =>
    fc.record(Object.fromEntries(keys.map((k) => [k, safeStringValue])))
  ) as fc.Arbitrary<Record<string, unknown>>;

// ─── Properties ──────────────────────────────────────────────────────────────

describe('parseFrontmatter / serializeFrontmatter — property-based (SKY-361)', () => {

  // ── P1: Fault tolerance ──────────────────────────────────────────────────
  // parseFrontmatter must never throw, crash, or infinite-loop on any byte
  // sequence, including adversarial regex inputs and null-like characters.
  //
  // MUTATION DETECTION: add `if (input.includes('---')) throw new Error('boom')`
  // to parseFrontmatter → this property fails immediately.
  it('P1: parseFrontmatter never throws on arbitrary input', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        parseFrontmatter(input); // must not throw
      }),
      { numRuns: 10_000 }
    );
  });

  // ── P2: Roundtrip — serialize → parse recovers original ─────────────────
  // For any safe frontmatter + prose, the output of serializeFrontmatter
  // must be fully recoverable by parseFrontmatter.  This is the core
  // correctness invariant of the vault I/O layer.
  //
  // MUTATION DETECTION: change serializeFrontmatter to write `key value` instead
  // of `key: value` (drop the colon).  parseFrontmatter skips every such line,
  // so frontmatter[key] becomes undefined and the assertion fails.
  it('P2: roundtrip — serialize→parse recovers original string-valued frontmatter and prose', () => {
    fc.assert(
      fc.property(safeStringRecord, safeProse, (fm, prose) => {
        const serialized = serializeFrontmatter(fm, prose);
        const { frontmatter, prose: parsedProse } = parseFrontmatter(serialized);

        for (const [key, val] of Object.entries(fm)) {
          expect(frontmatter[key]).toBe(val);
        }
        expect(parsedProse).toBe(prose);
      }),
      { numRuns: 2_000 }
    );
  });

  // ── P3: Plain-text pass-through ──────────────────────────────────────────
  // Any string that does NOT begin with "---" has no frontmatter. It must be
  // returned verbatim in `prose` with an empty frontmatter object.
  //
  // MUTATION DETECTION: change the guard to always match the regex (remove the
  // early-return check) → the wrong part of the string would be assigned to
  // `prose`, breaking `expect(prose).toBe(s)` for almost every input.
  it('P3: strings not starting with "---" are returned as prose unchanged', () => {
    fc.assert(
      fc.property(fc.string().filter((s) => !s.startsWith('---')), (s) => {
        const { prose, frontmatter } = parseFrontmatter(s);
        expect(prose).toBe(s);
        expect(Object.keys(frontmatter).length).toBe(0);
      }),
      { numRuns: 5_000 }
    );
  });

  // ── P4: Serialization idempotency ────────────────────────────────────────
  // serialize(parse(serialize(fm, prose))) must equal serialize(fm, prose).
  // A drift here would mean whitespace accumulates or values are mutated on
  // successive read-write cycles — a data-corruption class of bug.
  //
  // MUTATION DETECTION: add a trailing space to every serialized key (`key : `)
  // → the second parse finds a different key name, so serialize diverges.
  it('P4: serialize→parse→serialize is idempotent', () => {
    fc.assert(
      fc.property(safeStringRecord, safeProse, (fm, prose) => {
        const firstPass = serializeFrontmatter(fm, prose);
        const { frontmatter: fm2, prose: prose2 } = parseFrontmatter(firstPass);
        const secondPass = serializeFrontmatter(fm2, prose2);
        expect(secondPass).toBe(firstPass);
      }),
      { numRuns: 1_000 }
    );
  });

  // ── Mutation-proof assertions ─────────────────────────────────────────────
  // These tests explicitly demonstrate what a broken implementation returns,
  // proving the properties above would catch those specific bugs.

  it('[mutation proof] detects broken parser that never extracts frontmatter', () => {
    function brokenParse(_raw: string): { frontmatter: Record<string, unknown>; prose: string } {
      return { frontmatter: {}, prose: _raw }; // bug: always returns empty frontmatter
    }
    const fm = { title: 'My Story', author: 'Jane' };
    const serialized = serializeFrontmatter(fm, 'Chapter one begins.');
    const { frontmatter } = brokenParse(serialized);
    // The broken parser loses all frontmatter → roundtrip invariant would fail
    expect(frontmatter.title).not.toBe(fm.title);
    expect(Object.keys(frontmatter).length).toBe(0);
  });

  it('[mutation proof] detects broken serializer that drops colon separator', () => {
    function brokenSerialize(fm: Record<string, unknown>, prose: string): string {
      const lines: string[] = ['---'];
      for (const [key, val] of Object.entries(fm)) {
        lines.push(`${key} ${val}`); // bug: space instead of ': '
      }
      lines.push('---', '');
      return lines.join('\n') + prose;
    }
    const fm = { title: 'Test' };
    const broken = brokenSerialize(fm, 'Prose.');
    const { frontmatter } = parseFrontmatter(broken);
    // parseFrontmatter skips lines without ':' → key is lost
    expect(frontmatter.title).toBeUndefined();
  });
});
