import { describe, it, expect } from 'vitest';
import { countWords, readingTimeMinutes } from './wordStats';

describe('countWords', () => {
  it('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0);
  });

  it('returns 0 for whitespace-only string', () => {
    expect(countWords('   \n  ')).toBe(0);
  });

  it('counts a single word', () => {
    expect(countWords('hello')).toBe(1);
  });

  it('counts words in a simple sentence', () => {
    expect(countWords('The quick brown fox')).toBe(4);
  });

  it('counts words across multiple paragraphs', () => {
    expect(countWords('Hello world.\n\nThis is a test.')).toBe(6);
  });

  it('handles punctuation without inflating count', () => {
    expect(countWords('Hello, world! How are you?')).toBe(5);
  });

  it('strips ATX heading markers', () => {
    // "Title" + "Some" + "text" + "here." = 4 words; only the `#` marker is stripped
    expect(countWords('# Title\n\nSome text here.')).toBe(4);
  });

  it('strips deeply-nested heading markers', () => {
    expect(countWords('### Three words')).toBe(2);
  });

  it('strips unordered list bullets', () => {
    expect(countWords('- Item one\n- Item two')).toBe(4);
  });

  it('strips ordered list numbers', () => {
    expect(countWords('1. Step one\n2. Step two')).toBe(4);
  });

  it('strips bold markers, keeps word', () => {
    expect(countWords('**bold** and regular')).toBe(3);
  });

  it('strips italic markers, keeps word', () => {
    expect(countWords('*italic* word')).toBe(2);
  });

  it('strips inline code', () => {
    expect(countWords('Use `code` here')).toBe(3);
  });

  it('strips fenced code block fences, keeps content words', () => {
    // fences stripped but "code block" text still counts as prose
    expect(countWords('Text\n```\ncode block\n```\nMore text')).toBe(5);
  });

  it('strips links but keeps display text', () => {
    // "visit" + "here" + "for" + "more" = 4; URL is removed
    expect(countWords('[visit here](http://example.com) for more')).toBe(4);
  });

  it('strips blockquote markers', () => {
    expect(countWords('> quoted text here')).toBe(3);
  });
});

describe('readingTimeMinutes', () => {
  it('returns 0 for 0 words', () => {
    expect(readingTimeMinutes(0)).toBe(0);
  });

  it('returns 1 for a single word', () => {
    expect(readingTimeMinutes(1)).toBe(1);
  });

  it('returns 1 for exactly 238 words', () => {
    expect(readingTimeMinutes(238)).toBe(1);
  });

  it('rounds up to 2 for 239 words', () => {
    expect(readingTimeMinutes(239)).toBe(2);
  });

  it('returns 2 for exactly 476 words', () => {
    expect(readingTimeMinutes(476)).toBe(2);
  });

  it('returns 3 for 477 words', () => {
    expect(readingTimeMinutes(477)).toBe(3);
  });
});
