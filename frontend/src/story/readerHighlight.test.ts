// Beta 4 M11 — sentence-highlight helper tests. jsdom provides Range +
// TreeWalker but NOT the CSS Custom Highlight API, so the registry and the
// Highlight constructor are stubbed onto globalThis per test.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  READING_HIGHLIGHT_NAME,
  clearReadingSentenceHighlight,
  sentenceDomRange,
  setReadingSentenceHighlight,
} from './readerHighlight';

class FakeHighlight {
  ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

function stubHighlightApi() {
  const store = new Map<string, FakeHighlight>();
  const g = globalThis as { CSS?: unknown; Highlight?: unknown };
  g.CSS = {
    highlights: {
      set: (name: string, hl: FakeHighlight) => store.set(name, hl),
      delete: (name: string) => store.delete(name),
    },
  };
  g.Highlight = FakeHighlight;
  return store;
}

function unstubHighlightApi() {
  const g = globalThis as { CSS?: unknown; Highlight?: unknown };
  delete g.CSS;
  delete g.Highlight;
}

function paraWithSpans(): HTMLElement {
  // Mirrors ParagraphRow output: text split across nested spans
  // (comment anchors / auto-link hints).
  const el = document.createElement('div');
  el.innerHTML = '<span>Mira counted </span><span><span>the bells</span></span><span>. Done.</span>';
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  unstubHighlightApi();
});

describe('sentenceDomRange', () => {
  it('builds a range across nested text nodes for exact offsets', () => {
    const el = paraWithSpans(); // "Mira counted the bells. Done."
    const range = sentenceDomRange(el, 0, 23);
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe('Mira counted the bells.');
  });

  it('handles a range fully inside one nested node', () => {
    const el = paraWithSpans();
    const range = sentenceDomRange(el, 24, 29);
    expect(range!.toString()).toBe('Done.');
  });

  it('returns null when offsets exceed the element text (mid-edit drift)', () => {
    const el = paraWithSpans();
    expect(sentenceDomRange(el, 0, 999)).toBeNull();
    expect(sentenceDomRange(el, 500, 510)).toBeNull();
  });

  it('returns null for empty/inverted ranges', () => {
    const el = paraWithSpans();
    expect(sentenceDomRange(el, 5, 5)).toBeNull();
    expect(sentenceDomRange(el, 9, 3)).toBeNull();
    expect(sentenceDomRange(el, -2, 4)).toBeNull();
  });
});

describe('setReadingSentenceHighlight / clearReadingSentenceHighlight', () => {
  it('registers the highlight under the shared name', () => {
    const store = stubHighlightApi();
    const el = paraWithSpans();
    expect(setReadingSentenceHighlight(el, 0, 23)).toBe(true);
    const hl = store.get(READING_HIGHLIGHT_NAME);
    expect(hl).toBeInstanceOf(FakeHighlight);
    expect(hl!.ranges[0].toString()).toBe('Mira counted the bells.');
  });

  it('clears a stale highlight when the element or range is unusable', () => {
    const store = stubHighlightApi();
    const el = paraWithSpans();
    setReadingSentenceHighlight(el, 0, 23);
    expect(setReadingSentenceHighlight(null, 0, 5)).toBe(false);
    expect(store.has(READING_HIGHLIGHT_NAME)).toBe(false);

    setReadingSentenceHighlight(el, 0, 23);
    expect(setReadingSentenceHighlight(el, 0, 999)).toBe(false);
    expect(store.has(READING_HIGHLIGHT_NAME)).toBe(false);
  });

  it('clearReadingSentenceHighlight removes the entry', () => {
    const store = stubHighlightApi();
    setReadingSentenceHighlight(paraWithSpans(), 0, 23);
    expect(store.has(READING_HIGHLIGHT_NAME)).toBe(true);
    clearReadingSentenceHighlight();
    expect(store.has(READING_HIGHLIGHT_NAME)).toBe(false);
  });

  it('degrades silently when the API is missing (jsdom default)', () => {
    expect(setReadingSentenceHighlight(paraWithSpans(), 0, 23)).toBe(false);
    expect(() => clearReadingSentenceHighlight()).not.toThrow();
  });
});
