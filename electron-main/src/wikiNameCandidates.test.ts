import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_NEW_NAME_CANDIDATES,
  detectNewNameCandidates,
  type WikiKnownEntity,
} from './wikiNameCandidates.js';

const SCENE = 'Stories/Argent/Chapter 1/Scene 1.md';

function names(text: string, entities: WikiKnownEntity[] = [], max?: number): string[] {
  return detectNewNameCandidates(text, entities, SCENE, { maxCandidates: max }).map((c) => c.name);
}

const KNOWN: WikiKnownEntity[] = [
  { name: 'Elara', aliases: ['Ellie'] },
  { name: 'Lyra Ash' },
];

describe('detectNewNameCandidates — what counts as a new name', () => {
  it('finds a proper noun the vault has never heard of', () => {
    expect(names('The lantern swung as Corwin crossed the yard.', KNOWN)).toEqual(['Corwin']);
  });

  it('carries the scene path so the question queue can dedupe per scene', () => {
    const [candidate] = detectNewNameCandidates('She trusted Corwin now.', KNOWN, SCENE);
    expect(candidate.scenePath).toBe(SCENE);
    // The detector never guesses a type — an unconfirmed name is not a character.
    expect(candidate.entityType).toBeNull();
    expect(candidate.entityId).toBeNull();
  });

  it('accepts a multi-word name even when it only ever opens a sentence', () => {
    expect(names('Iron Gate loomed over the valley.', KNOWN)).toEqual(['Iron Gate']);
  });

  it('keeps a name written inside connectors', () => {
    expect(names('They spoke of the Blade of Dawn in Corwin Vale.', KNOWN)).toEqual([
      'Blade of Dawn',
      'Corwin Vale',
    ]);
  });

  it('always accepts an explicit [[wiki link]], sentence position notwithstanding', () => {
    expect(names('[[Halvard]] never came back.', KNOWN)).toEqual(['Halvard']);
  });

  it('reads a piped wiki link by its target, not its label', () => {
    expect(names('She waited for [[Halvard|the old smith]].', KNOWN)).toEqual(['Halvard']);
  });
});

describe('detectNewNameCandidates — false-positive budget', () => {
  it('rejects a single capitalised word that only ever starts a sentence', () => {
    // "Suddenly" is capitalised by grammar, not because it is a name.
    expect(names('Suddenly the door gave way. Somewhere a bell rang.', KNOWN)).toEqual([]);
  });

  it('rejects pronouns, determiners and other stopwords', () => {
    expect(names('She told him that They would wait, and The gate held.', KNOWN)).toEqual([]);
  });

  it('strips a leading article from a multi-word name', () => {
    expect(names('He climbed to The Iron Gate before dusk.', KNOWN)).toEqual(['Iron Gate']);
  });

  it('rejects the hygiene contract’s common nouns posing as names', () => {
    expect(names('He raked the Ash and watched the Frost settle.', KNOWN)).toEqual([]);
  });

  it('ignores markdown headings, which are structure and not prose', () => {
    expect(names('# Chapter Two\n\nHe waited alone.', KNOWN)).toEqual([]);
  });

  it('rejects calendar words', () => {
    expect(names('They met again on Tuesday, then again in March.', KNOWN)).toEqual([]);
  });
});

describe('detectNewNameCandidates — "new" means absent from the vault', () => {
  it('skips a known entity name', () => {
    expect(names('The road bent where Elara had fallen.', KNOWN)).toEqual([]);
  });

  it('skips a known alias', () => {
    expect(names('He still called her Ellie in private.', KNOWN)).toEqual([]);
  });

  it('skips a name that merely extends a known one', () => {
    // "Lady Elara" is Elara with a title, not a second character to ask about.
    expect(names('The guards bowed to Lady Elara.', KNOWN)).toEqual([]);
  });

  it('skips a name contained by a known one', () => {
    expect(names('He had not seen Lyra since the siege.', KNOWN)).toEqual([]);
  });

  it('collapses possessives and repeats into one candidate', () => {
    const text = 'Corwin drew back. She took Corwin’s hand and led Corwin out.';
    expect(names(text, KNOWN)).toEqual(['Corwin']);
  });
});

describe('detectNewNameCandidates — limits', () => {
  it('caps a scan so one scene cannot flood the queue', () => {
    const text = Array.from(
      { length: 20 },
      (_, i) => `She met Corwin${'abcdefghijklmnopqrst'[i]} there.`,
    ).join(' ');
    expect(names(text, KNOWN)).toHaveLength(DEFAULT_MAX_NEW_NAME_CANDIDATES);
    expect(names(text, KNOWN, 3)).toHaveLength(3);
  });

  it('returns nothing for empty prose or a zero cap', () => {
    expect(names('', KNOWN)).toEqual([]);
    expect(names('She met Corwin there.', KNOWN, 0)).toEqual([]);
  });
});
