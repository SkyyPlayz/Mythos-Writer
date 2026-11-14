import { describe, expect, it } from 'vitest';
import { QUOTE_CONTEXT_UNITS, locateQuote, splitFrontmatter } from './quoteCheck.js';
import { buildExtractorInput } from './extract/types.js';
import { parseFrontmatter } from '../vault.js';

const PROSE = 'Odile crossed the bridge. Her silver ring caught the light as she ran.';

function ctx(prose: string, start: number, end: number): [string, string] {
  return [prose.slice(Math.max(0, start - QUOTE_CONTEXT_UNITS), start), prose.slice(end, end + QUOTE_CONTEXT_UNITS)];
}

describe('locateQuote', () => {
  it('finds an exact hit and confirms the slice', () => {
    const quote = 'silver ring';
    const span = locateQuote(PROSE, quote, '', '');
    expect(span).toEqual({ start: PROSE.indexOf(quote), end: PROSE.indexOf(quote) + quote.length });
    expect(PROSE.slice(span!.start, span!.end)).toBe(quote);
  });

  it('drops a quote that differs only in case (mutant: lowercase matcher)', () => {
    expect(locateQuote(PROSE, 'Silver Ring', '', '')).toBeNull();
    expect(locateQuote(PROSE, 'odile crossed', '', '')).toBeNull();
  });

  it('drops a quote that differs only in whitespace (mutant: trim or whitespace folding)', () => {
    // ' silver ring ' (one space each side) really is in the prose, so pad with two.
    expect(PROSE).toContain(' silver ring ');
    expect(locateQuote(PROSE, '  silver ring  ', '', '')).toBeNull();
    expect(locateQuote(PROSE, '\tsilver ring', '', '')).toBeNull();
    expect(locateQuote(PROSE, 'silver  ring', '', '')).toBeNull();
    expect(locateQuote(PROSE, 'silver ring\n', '', '')).toBeNull();
    expect(locateQuote(PROSE, 'silver\tring', '', '')).toBeNull();
  });

  it('drops an empty or whitespace-only quote', () => {
    expect(locateQuote(PROSE, '', '', '')).toBeNull();
    expect(locateQuote(PROSE, ' ', '', '')).toBeNull();
    expect(locateQuote(PROSE, '\n\t ', '', '')).toBeNull();
    expect(locateQuote(PROSE, ' ', '', '')).toBeNull();
  });

  it('drops a quote with no hit', () => {
    expect(locateQuote(PROSE, 'golden ring', '', '')).toBeNull();
  });

  it('resolves a repeated quote by its 32-unit context', () => {
    const prose =
      'At dawn the lighthouse keeper wore a grey coat to the cliffs. ' +
      'At dusk the harbour master wore a grey coat to the tavern.';
    const quote = 'a grey coat';
    const second = prose.lastIndexOf(quote);
    const [before, after] = ctx(prose, second, second + quote.length);
    expect(locateQuote(prose, quote, before, after)).toEqual({ start: second, end: second + quote.length });
    const first = prose.indexOf(quote);
    const [b1, a1] = ctx(prose, first, first + quote.length);
    expect(locateQuote(prose, quote, b1, a1)).toEqual({ start: first, end: first + quote.length });
  });

  it('drops a repeated quote when the context matches neither or both hits', () => {
    const prose = 'a grey coat, a grey coat';
    expect(locateQuote(prose, 'a grey coat', 'nope', 'nope')).toBeNull();
    const twin = 'xx a grey coat yy xx a grey coat yy';
    // In a periodic text, several hits share the same 32 units on each side: still ambiguous.
    const periodic = 'ab'.repeat(40);
    const hits = [...periodic.matchAll(/ab/g)].length;
    expect(hits).toBeGreaterThan(2);
    const mid = 40;
    const [b, a] = ctx(periodic, mid, mid + 2);
    expect(locateQuote(periodic, 'ab', b, a)).toBeNull();
    expect(locateQuote(twin, 'a grey coat', '', '')).toBeNull();
  });

  it('does not trim or fold the context comparison', () => {
    const prose = 'Kit wore a red scarf. Jory wore a red scarf.';
    const quote = 'a red scarf';
    const second = prose.lastIndexOf(quote);
    const [before, after] = ctx(prose, second, second + quote.length);
    expect(locateQuote(prose, quote, before.toUpperCase(), after)).toBeNull();
    expect(locateQuote(prose, quote, ` ${before}`, after)).toBeNull();
    expect(locateQuote(prose, quote, before, `${after} `)).toBeNull();
  });

  it('works on CRLF prose without normalizing newlines', () => {
    const prose = 'Line one.\r\nPell had a crooked nose.\r\nLine three.';
    const quote = 'crooked nose.\r\nLine';
    const at = prose.indexOf(quote);
    expect(locateQuote(prose, quote, '', '')).toEqual({ start: at, end: at + quote.length });
    expect(locateQuote(prose, 'crooked nose.\nLine', '', '')).toBeNull();
  });

  it('uses UTF-16 code-unit offsets with astral characters', () => {
    const prose = '🌙🌙 Sable 🦊 had amber eyes.';
    const quote = 'amber eyes';
    const span = locateQuote(prose, quote, '', '');
    expect(span).toEqual({ start: prose.indexOf(quote), end: prose.indexOf(quote) + quote.length });
    // 2 moons + space + Sable + space + fox = 2*2 + 1 + 5 + 1 + 2 + ' had '.length
    expect(span!.start).toBe(4 + 1 + 5 + 1 + 2 + 5);
    expect(locateQuote(prose, '🦊', '', '')).toEqual({ start: 11, end: 13 });
  });

  it('never matches half of a surrogate pair', () => {
    const prose = 'The 🦊 ran.';
    const low = '🦊'.charAt(1);
    const high = '🦊'.charAt(0);
    expect(locateQuote(prose, low, '', '')).toBeNull();
    expect(locateQuote(prose, high, '', '')).toBeNull();
  });

  it('returns prose-relative offsets and never finds a frontmatter-only quote', () => {
    const scene = '---\ntitle: Ember Road\nscar: left cheek\n---\nNell touched the scar on her chin.\n';
    const input = buildExtractorInput(scene, []);
    expect(input.prose).toBe('Nell touched the scar on her chin.\n');
    expect(locateQuote(input.prose, 'left cheek', '', '')).toBeNull();
    const quote = 'scar on her chin';
    const span = locateQuote(input.prose, quote, '', '');
    expect(span).toEqual({ start: input.prose.indexOf(quote), end: input.prose.indexOf(quote) + quote.length });
    expect(span!.start).not.toBe(scene.indexOf(quote));
    expect(input.prose.slice(span!.start, span!.end)).toBe(quote);
  });

  it('rejects non-string arguments without throwing', () => {
    expect(locateQuote(PROSE, undefined as unknown as string, '', '')).toBeNull();
    expect(locateQuote(PROSE, 'silver ring', null as unknown as string, '')).toBeNull();
  });
});

describe('splitFrontmatter', () => {
  it('splits a closed block, with LF or CRLF fences', () => {
    expect(splitFrontmatter('---\na: 1\n---\nBody')).toEqual({ frontmatter: '---\na: 1\n---\n', prose: 'Body' });
    expect(splitFrontmatter('---\r\na: 1\r\n---\r\nBody')).toEqual({
      frontmatter: '---\r\na: 1\r\n---\r\n',
      prose: 'Body',
    });
    expect(splitFrontmatter('---\na: 1\n---  \nBody').prose).toBe('Body');
    expect(splitFrontmatter('﻿---\na: 1\n---\nBody').prose).toBe('Body');
  });

  it('closes only where the vault closes: not on "...", a lone CR, or U+2028', () => {
    const dots = '---\nid: s1\ngoal: Wait.\n...\nLeave.\nconflict: hidden-motive-41\n---\nProse here.';
    expect(splitFrontmatter(dots).prose).toBe('Prose here.');
    expect(splitFrontmatter(dots).frontmatter).toContain('hidden-motive-41');
    const loneCr = '---\nid: s1\nnote: a\r---\rsecret: kept-in-frontmatter\n---\nProse.';
    expect(splitFrontmatter(loneCr).prose).toBe('Prose.');
    const ls = '---\nid: s1\nnote: a --- secret: kept\n---\nProse.';
    expect(splitFrontmatter(ls).prose).toBe('Prose.');
  });

  it('removes NUL characters like the vault does', () => {
    expect(splitFrontmatter('---\na: 1\n---\nBo\u0000dy').prose).toBe('Body');
    expect(splitFrontmatter('---\na: \u00001\n-\u0000--\nBody').prose).toBe('Body');
  });

  it('leaves text without a leading, closed block as prose', () => {
    expect(splitFrontmatter('Body\n---\na: 1\n---\n').prose).toBe('Body\n---\na: 1\n---\n');
    expect(splitFrontmatter('---\nno closing fence').prose).toBe('---\nno closing fence');
    expect(splitFrontmatter('').prose).toBe('');
  });

  it('gives the same prose as vault.parseFrontmatter on every case', () => {
    const cases = [
      '---\na: 1\n---\nBody',
      '---\r\na: 1\r\n---\r\nBody\r\nMore',
      '---\na: 1\n---',
      '---\n---\nBody',
      '---\na: 1\n...\nb: 2\n---\nBody',
      '---\na: 1\r---\rb\n---\nBody',
      '---\nkey: ---value\n---\nBody',
      '---\na: 1\n--- \t\nBody\n---\nTail',
      '---\na: 1\n----\nb: 2\n---\nBody',
      'No frontmatter\n---\na: 1\n---\n',
      '---\nunclosed',
      ' ---\na: 1\n---\nBody',
      '---\na\u0000: 1\n---\nBo\u0000dy',
      '',
    ];
    for (const raw of cases) {
      expect(splitFrontmatter(raw).prose, JSON.stringify(raw)).toBe(parseFrontmatter(raw).prose);
    }
  });
});
