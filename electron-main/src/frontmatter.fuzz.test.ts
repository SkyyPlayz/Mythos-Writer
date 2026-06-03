// frontmatter.fuzz.test.ts — fuzz-style regression suite (SKY-621)
// Locks in parse + serialize behaviour for arrays, empty values, indentation, and
// property order so future refactors of parseFrontmatter / serializeFrontmatter
// break loudly instead of silently.
//
// Background: SKY-398 and SKY-414 both stemmed from frontmatter parser surprises.
//
// Design contract of the current parser (document it, don't assume it):
//   • Array elements are split on literal commas — no YAML-structured parsing.
//   • Array element values are NOT individually type-coerced; they stay as strings.
//   • Nested brackets are NOT structurally parsed; the outer [] is split on all commas.
//     The string-level round-trip is preserved because the serializer joins them back.
//   • Scalar values ARE type-coerced: "true"/"false" → boolean, numeric strings → number.
//   • Null/undefined values are silently omitted during serialization.
//   • Leading/trailing whitespace is trimmed on both keys and values.
import { describe, it, expect } from 'vitest';
import { parseFrontmatter, serializeFrontmatter } from './vault';

// Build a raw frontmatter string from a key-value body (one or more "key: value" lines).
function raw(body: string, prose = ''): string {
  return `---\n${body}\n---\n${prose}`;
}

// Verify round-trip idempotency: parse → serialize → parse must equal parse.
function assertRoundTrip(input: string) {
  const { frontmatter: fm1, prose: p1 } = parseFrontmatter(input);
  const reserialized = serializeFrontmatter(fm1, p1);
  const { frontmatter: fm2, prose: p2 } = parseFrontmatter(reserialized);
  expect(fm2).toEqual(fm1);
  expect(p2).toBe(p1);
}

// ─── 1. Flat array parsing ──────────────────────────────────────────────────

describe('parseFrontmatter — flat arrays', () => {
  it('empty array', () => {
    const { frontmatter } = parseFrontmatter(raw('arr: []'));
    expect(frontmatter.arr).toEqual([]);
  });

  it('single-element array', () => {
    const { frontmatter } = parseFrontmatter(raw('arr: [alpha]'));
    expect(frontmatter.arr).toEqual(['alpha']);
  });

  it('two-element array', () => {
    const { frontmatter } = parseFrontmatter(raw('arr: [a, b]'));
    expect(frontmatter.arr).toEqual(['a', 'b']);
  });

  it('array with extra whitespace around elements', () => {
    const { frontmatter } = parseFrontmatter(raw('arr: [ a ,  b , c ]'));
    expect(frontmatter.arr).toEqual(['a', 'b', 'c']);
  });

  it('array with five elements', () => {
    const { frontmatter } = parseFrontmatter(raw('tags: [action, drama, sci-fi, comedy, thriller]'));
    expect(frontmatter.tags).toEqual(['action', 'drama', 'sci-fi', 'comedy', 'thriller']);
  });

  it('adjacent commas produce an empty element that is filtered out', () => {
    // Parser uses filter(Boolean), so empty strings from ",," are dropped.
    const { frontmatter } = parseFrontmatter(raw('arr: [a, , b]'));
    expect(frontmatter.arr).toEqual(['a', 'b']);
  });
});

// ─── 2. Nested / structural arrays (string-level round-trip contract) ───────

describe('parseFrontmatter — nested array string representation', () => {
  // The parser does NOT structurally parse nesting. Instead it splits on all commas
  // inside the outermost brackets. Each bracket-fragment becomes a string element.
  // The serializer re-joins them with ", " so the original string is reconstructed.

  it('double-nested integers: [[1, 2], [3, 4]] round-trips as strings', () => {
    const input = raw('arr: [[1, 2], [3, 4]]');
    const { frontmatter } = parseFrontmatter(input);
    // Elements are bracket-fragments, not nested arrays.
    expect(frontmatter.arr).toEqual(['[1', '2]', '[3', '4]']);
    // Serializing those fragments reproduces the original value.
    const serialized = serializeFrontmatter(frontmatter, '');
    expect(serialized).toContain('arr: [[1, 2], [3, 4]]');
  });

  it('triple-nested: [[[a]]] round-trips', () => {
    const input = raw('arr: [[[a]]]');
    const { frontmatter } = parseFrontmatter(input);
    // Outer brackets stripped, inner becomes the single element.
    expect(frontmatter.arr).toEqual(['[[a]]']);
    assertRoundTrip(input);
  });

  it('nested with mixed content: [[a, b], c, [d]] round-trips', () => {
    assertRoundTrip(raw('arr: [[a, b], c, [d]]'));
  });

  it('single-item nested: [[1]] round-trips', () => {
    assertRoundTrip(raw('arr: [[1]]'));
  });

  it('deeply unbalanced: [a, [b, [c]]] round-trips', () => {
    assertRoundTrip(raw('arr: [a, [b, [c]]]'));
  });
});

// ─── 3. Arrays containing object-like strings ────────────────────────────────

describe('parseFrontmatter — arrays with object-like elements', () => {
  it('{a: 1}, {b: 2} are split on the comma between objects', () => {
    const { frontmatter } = parseFrontmatter(raw('arr: [{a: 1}, {b: 2}]'));
    // Object values with an inner colon are fine for the outer split (splits on comma).
    expect(frontmatter.arr).toEqual(['{a: 1}', '{b: 2}']);
  });

  it('single object element: [{x: true}] produces one string element', () => {
    const { frontmatter } = parseFrontmatter(raw('arr: [{x: true}]'));
    expect(frontmatter.arr).toEqual(['{x: true}']);
  });

  it('object elements round-trip: [{a: 1}, {b: 2}]', () => {
    assertRoundTrip(raw('arr: [{a: 1}, {b: 2}]'));
  });
});

// ─── 4. Mixed-type arrays (array elements stay as strings) ───────────────────

describe('parseFrontmatter — mixed-type array element coercion', () => {
  it('integer-like elements remain strings inside an array', () => {
    const { frontmatter } = parseFrontmatter(raw('arr: [1, 2, 3]'));
    // Array elements are NOT coerced — they stay as strings.
    expect(frontmatter.arr).toEqual(['1', '2', '3']);
  });

  it('boolean-like strings remain strings inside an array', () => {
    const { frontmatter } = parseFrontmatter(raw('arr: [true, false, maybe]'));
    expect(frontmatter.arr).toEqual(['true', 'false', 'maybe']);
  });

  it('null-like string remains a string inside an array', () => {
    const { frontmatter } = parseFrontmatter(raw('arr: [null, undefined, none]'));
    expect(frontmatter.arr).toEqual(['null', 'undefined', 'none']);
  });

  it('heterogeneous: [1, "two", true, null] — quoted string keeps its quotes', () => {
    const { frontmatter } = parseFrontmatter(raw('arr: [1, "two", true, null]'));
    // Quotes are part of the string element (not stripped by the parser).
    expect(frontmatter.arr).toEqual(['1', '"two"', 'true', 'null']);
  });

  it('heterogeneous round-trip', () => {
    assertRoundTrip(raw('arr: [1, "two", true, null]'));
  });
});

// ─── 5. Empty and null-ish scalar values ─────────────────────────────────────

describe('parseFrontmatter — empty and null-ish values', () => {
  it('bare key with no value parses as empty string', () => {
    const { frontmatter } = parseFrontmatter(raw('key:'));
    expect(frontmatter.key).toBe('');
  });

  it('key: null is kept as the string "null" (not JS null)', () => {
    const { frontmatter } = parseFrontmatter(raw('key: null'));
    expect(frontmatter.key).toBe('null');
  });

  it('key: "" is kept as the string with literal quote chars', () => {
    const { frontmatter } = parseFrontmatter(raw('key: ""'));
    expect(frontmatter.key).toBe('""');
  });

  it('key with only whitespace after colon parses as empty string', () => {
    const { frontmatter } = parseFrontmatter(raw('key:   '));
    expect(frontmatter.key).toBe('');
  });

  it('key: 0 parses as the number zero (not empty)', () => {
    const { frontmatter } = parseFrontmatter(raw('key: 0'));
    expect(frontmatter.key).toBe(0);
  });
});

// ─── 6. Scalar type coercion ─────────────────────────────────────────────────

describe('parseFrontmatter — scalar type coercion', () => {
  it('integer coercion: "42" → 42', () => {
    const { frontmatter } = parseFrontmatter(raw('count: 42'));
    expect(frontmatter.count).toBe(42);
    expect(typeof frontmatter.count).toBe('number');
  });

  it('negative integer: "-5" → -5', () => {
    const { frontmatter } = parseFrontmatter(raw('offset: -5'));
    expect(frontmatter.offset).toBe(-5);
  });

  it('float: "3.14" → 3.14', () => {
    const { frontmatter } = parseFrontmatter(raw('ratio: 3.14'));
    expect(frontmatter.ratio).toBe(3.14);
  });

  it('true coercion', () => {
    const { frontmatter } = parseFrontmatter(raw('active: true'));
    expect(frontmatter.active).toBe(true);
    expect(typeof frontmatter.active).toBe('boolean');
  });

  it('false coercion', () => {
    const { frontmatter } = parseFrontmatter(raw('disabled: false'));
    expect(frontmatter.disabled).toBe(false);
    expect(typeof frontmatter.disabled).toBe('boolean');
  });

  it('URL value with colon preserved (colon-in-value not confused with key separator)', () => {
    const { frontmatter } = parseFrontmatter(raw('url: https://example.com/path'));
    expect(frontmatter.url).toBe('https://example.com/path');
  });
});

// ─── 7. Indentation edge cases ────────────────────────────────────────────────

describe('parseFrontmatter — indentation', () => {
  it('two-space indented key is trimmed and parsed correctly', () => {
    const { frontmatter } = parseFrontmatter(raw('  key: value'));
    expect(frontmatter.key).toBe('value');
  });

  it('four-space indented key is trimmed', () => {
    const { frontmatter } = parseFrontmatter(raw('    key: value'));
    expect(frontmatter.key).toBe('value');
  });

  it('tab-indented key is trimmed', () => {
    const { frontmatter } = parseFrontmatter(raw('\tkey: value'));
    expect(frontmatter.key).toBe('value');
  });

  it('indented array key is trimmed and array is parsed', () => {
    const { frontmatter } = parseFrontmatter(raw('  tags: [a, b, c]'));
    expect(frontmatter.tags).toEqual(['a', 'b', 'c']);
  });

  it('mixed indentation: some indented keys, some not', () => {
    const { frontmatter } = parseFrontmatter(raw('id: abc\n  title: My Scene\n    order: 1'));
    expect(frontmatter.id).toBe('abc');
    expect(frontmatter.title).toBe('My Scene');
    expect(frontmatter.order).toBe(1);
  });
});

// ─── 8. CRLF line endings ────────────────────────────────────────────────────

describe('parseFrontmatter — CRLF line endings', () => {
  it('CRLF frontmatter delimiter is handled', () => {
    const crlf = '---\r\ntitle: Test\r\ntags: [a, b]\r\n---\r\nProse here.';
    const { frontmatter, prose } = parseFrontmatter(crlf);
    expect(frontmatter.title).toBe('Test');
    expect(frontmatter.tags).toEqual(['a', 'b']);
    expect(prose).toBe('Prose here.');
  });
});

// ─── 9. Prose extraction ──────────────────────────────────────────────────────

describe('parseFrontmatter — prose extraction', () => {
  it('prose is returned verbatim after the closing ---', () => {
    const { prose } = parseFrontmatter(raw('key: val', 'Hello world.'));
    expect(prose).toBe('Hello world.');
  });

  it('prose containing --- delimiters is returned intact', () => {
    const input = '---\nkey: val\n---\n---\ninner content\n---';
    const { prose } = parseFrontmatter(input);
    expect(prose).toBe('---\ninner content\n---');
  });

  it('no frontmatter: prose is the entire raw string, frontmatter is empty', () => {
    const { frontmatter, prose } = parseFrontmatter('Just plain text.');
    expect(frontmatter).toEqual({});
    expect(prose).toBe('Just plain text.');
  });

  it('multiline prose is preserved exactly', () => {
    const multiline = 'Line one.\n\nLine two.\n\nLine three.';
    const { prose } = parseFrontmatter(raw('key: val', multiline));
    expect(prose).toBe(multiline);
  });
});

// ─── 10. serializeFrontmatter edge cases ─────────────────────────────────────

describe('serializeFrontmatter', () => {
  it('null values are silently omitted from output', () => {
    const fm = { id: 'x', hidden: null as unknown as string };
    const out = serializeFrontmatter(fm, '');
    expect(out).not.toContain('hidden');
    expect(out).toContain('id: x');
  });

  it('undefined values are silently omitted', () => {
    const fm = { id: 'x', missing: undefined };
    const out = serializeFrontmatter(fm, '');
    expect(out).not.toContain('missing');
  });

  it('empty array serializes as []', () => {
    const out = serializeFrontmatter({ arr: [] }, '');
    expect(out).toContain('arr: []');
  });

  it('boolean false is serialized (not omitted)', () => {
    const out = serializeFrontmatter({ active: false }, '');
    expect(out).toContain('active: false');
  });

  it('zero is serialized (not omitted)', () => {
    const out = serializeFrontmatter({ count: 0 }, '');
    expect(out).toContain('count: 0');
  });
});

// ─── 11. Property order preservation (SKY-414 regression) ────────────────────

describe('property order preservation — SKY-414 regression', () => {
  it('serialized key order matches Object.entries insertion order', () => {
    const fm = { id: '1', title: 'Scene', chapterId: 'ch-1', order: 0, tags: ['a'] };
    const out = serializeFrontmatter(fm, '');
    const lines = out.split('\n').filter((l) => l !== '---' && l !== '');
    expect(lines[0]).toMatch(/^id:/);
    expect(lines[1]).toMatch(/^title:/);
    expect(lines[2]).toMatch(/^chapterId:/);
    expect(lines[3]).toMatch(/^order:/);
    expect(lines[4]).toMatch(/^tags:/);
  });

  it('round-trip preserves key order', () => {
    const input = raw('z: 3\ny: 2\nx: 1');
    const { frontmatter: fm1 } = parseFrontmatter(input);
    const reserialized = serializeFrontmatter(fm1, '');
    const { frontmatter: fm2 } = parseFrontmatter(reserialized);
    expect(Object.keys(fm2)).toEqual(['z', 'y', 'x']);
  });

  it('key set after round-trip is identical — no phantom or dropped keys', () => {
    const input = raw('a: 1\nb: foo\nc: true\nd: [x, y]');
    const { frontmatter: fm1 } = parseFrontmatter(input);
    const reserialized = serializeFrontmatter(fm1, '');
    const { frontmatter: fm2 } = parseFrontmatter(reserialized);
    expect(Object.keys(fm2)).toEqual(Object.keys(fm1));
  });

  it('values after round-trip match their originals', () => {
    const input = raw('id: abc\ncount: 7\nactive: true\ntags: [p, q, r]');
    const { frontmatter: fm1 } = parseFrontmatter(input);
    const reserialized = serializeFrontmatter(fm1, '');
    const { frontmatter: fm2 } = parseFrontmatter(reserialized);
    expect(fm2).toEqual(fm1);
  });
});

// ─── 12. Bulk round-trip table (generated cases) ─────────────────────────────

describe('round-trip idempotency — generated cases', () => {
  const cases: [string, string][] = [
    ['single scalar', raw('key: hello')],
    ['integer', raw('n: 42')],
    ['negative number', raw('n: -10')],
    ['float', raw('n: 1.5')],
    ['boolean true', raw('active: true')],
    ['boolean false', raw('active: false')],
    ['empty value', raw('key:')],
    ['null string', raw('key: null')],
    ['empty array', raw('arr: []')],
    ['single-element array', raw('arr: [only]')],
    ['flat array', raw('arr: [a, b, c]')],
    ['numeric-string array', raw('arr: [1, 2, 3]')],
    ['boolean-string array', raw('arr: [true, false]')],
    ['nested bracket array', raw('arr: [[1, 2], [3, 4]]')],
    ['object-string array', raw('arr: [{a: 1}, {b: 2}]')],
    ['url value', raw('url: https://example.com')],
    ['multiple keys', raw('a: 1\nb: two\nc: true')],
    ['key + array + prose', raw('title: T\ntags: [x, y]', 'some prose')],
    ['indented key', raw('  key: val')],
    ['tab-indented key', raw('\tkey: val')],
    ['quoted-string element', raw('arr: ["hello", "world"]')],
    ['mixed-type array', raw('arr: [1, two, true, null]')],
    ['array with spaces', raw('arr: [ a , b , c ]')],
    ['deeply nested', raw('arr: [[[deep]]]')],
    ['large array (10 elements)', raw('arr: [a, b, c, d, e, f, g, h, i, j]')],
    ['zero value', raw('count: 0')],
    ['prose with newlines', raw('key: val', 'line1\nline2\nline3')],
    ['multikey property order', raw('z: 1\ny: 2\nx: 3')],
    ['colon in value', raw('url: proto://host/path')],
    ['empty-string literal', raw('key: ""')],
  ];

  it.each(cases)('%s round-trips without mutation', (_label, input) => {
    assertRoundTrip(input);
  });
});
