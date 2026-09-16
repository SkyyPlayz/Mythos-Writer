import { describe, it, expect } from 'vitest';
import type { EntityIndexEntry } from './vault/entityIndex.js';
import {
  partitionByReveal,
  buildReaderEntityContext,
  buildAuthorEntityContext,
} from './readerPerspective.js';

// Fixture manuscript with a planted reveal (SKY-10741 verification path):
// the antagonist appears from the start only as "The Stranger"; his true
// identity — King Aldric, the murdered king's heir — is not revealed until
// Chapter 10. A reader-perspective role queried about a PRE-reveal chapter must
// never be told that identity.
const KING_ALDRIC = 'King Aldric';

function fixtureIndex(): EntityIndexEntry[] {
  return [
    // The pre-reveal handle the reader legitimately knows from page one.
    { name: 'The Stranger', aliases: [], type: 'Character', path: '/Universes/The Stranger.md', reveal_point: null },
    // A normal always-visible character (guards against over-filtering).
    { name: 'Mira', aliases: ['the innkeeper'], type: 'Character', path: '/Universes/Mira.md', reveal_point: null },
    // THE REVEAL: the true identity, gated to Chapter 10.
    {
      name: KING_ALDRIC,
      aliases: ['The Stranger', 'the true heir'],
      type: 'Character',
      path: '/Universes/King Aldric.md',
      reveal_point: 'Chapter 10',
    },
  ];
}

describe('partitionByReveal', () => {
  it('places every entry in exactly one bucket (visible ∪ hidden = all, disjoint)', () => {
    const index = fixtureIndex();
    const { visible, hidden } = partitionByReveal(index, 'Chapter 3');
    expect(visible.length + hidden.length).toBe(index.length);
    const visiblePaths = new Set(visible.map((e) => e.path));
    expect(hidden.every((e) => !visiblePaths.has(e.path))).toBe(true);
  });

  it('hides a not-yet-revealed entity before its reveal_point', () => {
    const { visible, hidden } = partitionByReveal(fixtureIndex(), 'Chapter 3');
    expect(visible.map((e) => e.name)).toEqual(['The Stranger', 'Mira']);
    expect(hidden.map((e) => e.name)).toEqual([KING_ALDRIC]);
  });

  it('reveals the entity at exactly its reveal_point (inclusive boundary)', () => {
    const { visible } = partitionByReveal(fixtureIndex(), 'Chapter 10');
    expect(visible.map((e) => e.name)).toContain(KING_ALDRIC);
  });

  it('treats a non-numeric position (e.g. Prologue) as before every numbered reveal', () => {
    const { hidden } = partitionByReveal(fixtureIndex(), 'Prologue');
    expect(hidden.map((e) => e.name)).toEqual([KING_ALDRIC]);
  });
});

describe('reveal-point leak — negative control (AC2)', () => {
  it('NEGATIVE CONTROL: unfiltered author context DOES leak the post-reveal identity', () => {
    // Establish the leak is real: without filtering, the dossier for a query
    // about Chapter 3 would hand the model "King Aldric". A reader-mode agent
    // built on this baseline would know the twist.
    const leaked = buildAuthorEntityContext(fixtureIndex());
    expect(leaked).toContain(KING_ALDRIC);
    expect(leaked).toContain('the true heir');
  });

  it('reader context for a pre-reveal chapter does NOT leak the post-reveal identity', () => {
    const readerCtx = buildReaderEntityContext(fixtureIndex(), 'Chapter 3');
    // The whole point: the true identity and its reveal-only aliases are absent.
    expect(readerCtx).not.toContain(KING_ALDRIC);
    expect(readerCtx).not.toContain('the true heir');
  });

  it('reader context still includes what the reader legitimately knows (no over-filtering)', () => {
    const readerCtx = buildReaderEntityContext(fixtureIndex(), 'Chapter 3');
    expect(readerCtx).toContain('The Stranger');
    expect(readerCtx).toContain('Mira');
  });

  it('reader context AFTER the reveal includes the true identity (the reveal lands)', () => {
    const readerCtx = buildReaderEntityContext(fixtureIndex(), 'Chapter 11');
    expect(readerCtx).toContain(KING_ALDRIC);
  });
});

describe('renderEntityDossier formatting', () => {
  it('returns an empty string for an empty set (adds no block)', () => {
    expect(buildReaderEntityContext([], 'Chapter 1')).toBe('');
  });

  it('wraps dossiers in <entity_context> delimiters and lists aliases', () => {
    const ctx = buildAuthorEntityContext([
      { name: 'Mira', aliases: ['the innkeeper'], type: 'Character', path: '/Mira.md', reveal_point: null },
    ]);
    expect(ctx.startsWith('<entity_context>')).toBe(true);
    expect(ctx.trimEnd().endsWith('</entity_context>')).toBe(true);
    expect(ctx).toContain('Entity: Mira [Character]');
    expect(ctx).toContain('Also known as: the innkeeper');
  });
});
