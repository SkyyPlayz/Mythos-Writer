// Beta 3 M23 — plain-text auto-[[link]]ing for the heading-zoom manuscript.
//
// Coverage:
//   §1  wikiLinkSpans — existing [[...]] token detection
//   §2  findAutoLinkHints — matches skip linked regions; word boundaries and
//       alias handling come from the REUSED AutoLinkerExtension helpers
//   §3  wikiLinkFor / applyAutoLinkHint — canonical vs alias link tokens
//   §4  applyAllAutoLinkHints — 'auto' commit transform, offset-safe
//   §5  splitRunByHints — composes with the M11 comment segmentation

import { describe, expect, it } from 'vitest';
import { buildEntityTerms } from '../AutoLinkerExtension';
import {
  applyAllAutoLinkHints,
  applyAutoLinkHint,
  findAutoLinkHints,
  splitRunByHints,
  wikiLinkFor,
  wikiLinkSpans,
} from './autoLinkText';

const NOW = '2026-07-07T00:00:00.000Z';

function entity(name: string, aliases: string[] = []): EntityEntry {
  return {
    id: `ent-${name.toLowerCase()}`,
    name,
    type: 'character',
    aliases,
    tags: [],
    createdAt: NOW,
    updatedAt: NOW,
  } as unknown as EntityEntry;
}

const TERMS = buildEntityTerms([entity('Elara', ['the Archivist']), entity('Duskwatch Keep')]);

// ─── §1 wiki-link spans ─────────────────────────────────────────────────────

describe('wikiLinkSpans', () => {
  it('finds every [[...]] token', () => {
    const text = 'See [[Elara]] and later [[Duskwatch Keep|the Keep]].';
    expect(wikiLinkSpans(text)).toEqual([
      { from: 4, to: 13 },
      { from: 24, to: 51 },
    ]);
  });

  it('returns nothing for plain prose', () => {
    expect(wikiLinkSpans('no links here')).toEqual([]);
  });
});

// ─── §2 hint discovery ──────────────────────────────────────────────────────

describe('findAutoLinkHints', () => {
  it('finds canonical names and aliases with word boundaries', () => {
    const hints = findAutoLinkHints('Elara met the Archivist near Duskwatch Keep.', TERMS);
    expect(hints.map((h) => h.anchorText)).toEqual(['Elara', 'the Archivist', 'Duskwatch Keep']);
    expect(hints.map((h) => h.canonicalName)).toEqual(['Elara', 'Elara', 'Duskwatch Keep']);
  });

  it('skips mentions already inside a [[wiki link]]', () => {
    const hints = findAutoLinkHints('[[Elara]] spoke to Elara.', TERMS);
    expect(hints).toHaveLength(1);
    expect(hints[0].from).toBe(19);
  });

  it('skips aliased-link contents too ([[Elara|the Archivist]])', () => {
    expect(findAutoLinkHints('[[Elara|the Archivist]] nodded.', TERMS)).toHaveLength(0);
  });

  it('respects word boundaries (no partial-word matches)', () => {
    expect(findAutoLinkHints('Elaras journey', TERMS)).toHaveLength(0);
  });

  it('returns hints sorted by position', () => {
    const hints = findAutoLinkHints('Duskwatch Keep loomed before Elara.', TERMS);
    expect(hints.map((h) => h.from)).toEqual([0, 29]);
  });
});

// ─── §3 link tokens ─────────────────────────────────────────────────────────

describe('wikiLinkFor / applyAutoLinkHint', () => {
  it('links an exact canonical match as [[Name]]', () => {
    const [hint] = findAutoLinkHints('Elara waited.', TERMS);
    expect(wikiLinkFor(hint)).toBe('[[Elara]]');
    expect(applyAutoLinkHint('Elara waited.', hint)).toBe('[[Elara]] waited.');
  });

  it('links an alias as [[Canonical|anchor]] (Obsidian convention)', () => {
    const [hint] = findAutoLinkHints('the Archivist waited.', TERMS);
    expect(applyAutoLinkHint('the Archivist waited.', hint)).toBe('[[Elara|the Archivist]] waited.');
  });

  it('preserves the surrounding text exactly', () => {
    const text = 'Before Elara, after.';
    const [hint] = findAutoLinkHints(text, TERMS);
    expect(applyAutoLinkHint(text, hint)).toBe('Before [[Elara]], after.');
  });
});

// ─── §4 auto mode ───────────────────────────────────────────────────────────

describe('applyAllAutoLinkHints', () => {
  it('links every mention in one pass, offsets intact', () => {
    const out = applyAllAutoLinkHints('Elara left Duskwatch Keep with the Archivist.', TERMS);
    expect(out).toBe('[[Elara]] left [[Duskwatch Keep]] with [[Elara|the Archivist]].');
  });

  it('is idempotent — already-linked text passes through unchanged', () => {
    const once = applyAllAutoLinkHints('Elara left Duskwatch Keep.', TERMS);
    expect(applyAllAutoLinkHints(once, TERMS)).toBe(once);
  });

  it('returns the input unchanged with no terms or no matches', () => {
    expect(applyAllAutoLinkHints('nothing to see', TERMS)).toBe('nothing to see');
    expect(applyAllAutoLinkHints('Elara', [])).toBe('Elara');
  });
});

// ─── §5 run splitting (comment-segment composition) ─────────────────────────

describe('splitRunByHints', () => {
  it('splits a run around its hints; concatenation equals the input', () => {
    const text = 'Elara crossed the yard.';
    const hints = findAutoLinkHints(text, TERMS);
    const runs = splitRunByHints(text, 0, hints);
    expect(runs).not.toBeNull();
    expect(runs!.map((r) => r.text).join('')).toBe(text);
    expect(runs![0].hint?.canonicalName).toBe('Elara');
  });

  it('only claims hints fully inside the run (comment anchors win overlap)', () => {
    const text = 'Elara crossed the yard near Duskwatch Keep now.';
    const hints = findAutoLinkHints(text, TERMS);
    // Simulate a comment anchor occupying the first 20 chars: the remaining
    // plain run starts at 20 and must only contain the Keep hint.
    const runs = splitRunByHints(text.slice(20), 20, hints);
    expect(runs).not.toBeNull();
    expect(runs!.filter((r) => r.hint)).toHaveLength(1);
    expect(runs!.find((r) => r.hint)?.hint?.canonicalName).toBe('Duskwatch Keep');
    expect(runs!.map((r) => r.text).join('')).toBe(text.slice(20));
  });

  it('returns null when no hint lands in the run', () => {
    expect(splitRunByHints('plain text', 0, [])).toBeNull();
  });
});
