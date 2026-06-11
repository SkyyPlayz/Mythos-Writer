// SKY-908 — suggestion categorizer tests.
//
// The matchers are deliberately coarse — false positives drop into the
// matched category's toggle, not into a misapplied edit. These tests anchor
// the behaviour we ship today and protect against accidental regressions if
// someone reorders the matcher list.

import { describe, it, expect } from 'vitest';
import {
  categorizeSuggestion,
  coerceSuggestionCategory,
  allCategoriesEnabled,
  SUGGESTION_CATEGORIES,
} from './suggestionCategory.js';

describe('categorizeSuggestion', () => {
  it('classifies common punctuation hints', () => {
    expect(categorizeSuggestion('Missing comma before "and"')).toBe('punctuation');
    expect(categorizeSuggestion('Use a semicolon between independent clauses')).toBe('punctuation');
    expect(categorizeSuggestion('Drop the Oxford comma here')).toBe('punctuation');
    expect(categorizeSuggestion('Em-dash would be clearer than parentheses')).toBe('punctuation');
  });

  it('classifies spelling / typo hints', () => {
    expect(categorizeSuggestion('Typo: "recieved" → "received"')).toBe('spelling');
    expect(categorizeSuggestion('Misspelled "necessary"')).toBe('spelling');
    expect(categorizeSuggestion('Spelling: "occured" should be "occurred"')).toBe('spelling');
  });

  it('classifies grammar hints', () => {
    expect(categorizeSuggestion('Subject-verb agreement issue')).toBe('grammar');
    expect(categorizeSuggestion('Verb tense shift between paragraphs')).toBe('grammar');
    expect(categorizeSuggestion("'its' vs 'it's' — possessive needs no apostrophe"))
      .toBe('grammar');
  });

  it('classifies sentence-structure hints', () => {
    expect(categorizeSuggestion('Run-on sentence — consider splitting')).toBe('sentence-structure');
    expect(categorizeSuggestion('Comma splice between two independent clauses')).toBe('sentence-structure');
    expect(categorizeSuggestion('Sentence fragment — needs a verb')).toBe('sentence-structure');
    expect(categorizeSuggestion('Sentence too long — break into two')).toBe('sentence-structure');
  });

  it('classifies style / tone hints', () => {
    expect(categorizeSuggestion('Passive voice — try active voice instead')).toBe('style-tone');
    expect(categorizeSuggestion('Word choice feels too formal for this scene')).toBe('style-tone');
    expect(categorizeSuggestion('Show, don\'t tell')).toBe('style-tone');
    expect(categorizeSuggestion('Repetitive phrasing in two consecutive paragraphs')).toBe('style-tone');
    expect(categorizeSuggestion('Wordy — tighten the sentence')).toBe('style-tone');
  });

  it('returns "other" when no matcher hits', () => {
    expect(categorizeSuggestion('Maybe move this paragraph earlier')).toBe('other');
    expect(categorizeSuggestion('')).toBe('other');
    expect(categorizeSuggestion(null)).toBe('other');
    expect(categorizeSuggestion(undefined)).toBe('other');
  });

  it('case-insensitive matching', () => {
    expect(categorizeSuggestion('COMMA SPLICE here')).toBe('sentence-structure');
    expect(categorizeSuggestion('Tone Is Off')).toBe('style-tone');
  });
});

describe('coerceSuggestionCategory', () => {
  it('passes known category strings through', () => {
    for (const c of SUGGESTION_CATEGORIES) {
      expect(coerceSuggestionCategory(c)).toBe(c);
    }
  });

  it('returns "other" for unknown / wrong-typed values', () => {
    expect(coerceSuggestionCategory('no-such-category')).toBe('other');
    expect(coerceSuggestionCategory(null)).toBe('other');
    expect(coerceSuggestionCategory(undefined)).toBe('other');
    expect(coerceSuggestionCategory(42)).toBe('other');
    expect(coerceSuggestionCategory({})).toBe('other');
  });
});

describe('allCategoriesEnabled', () => {
  it('returns true for every known category', () => {
    const map = allCategoriesEnabled();
    for (const c of SUGGESTION_CATEGORIES) {
      expect(map[c]).toBe(true);
    }
  });
});
