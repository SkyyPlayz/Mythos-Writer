import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_QUERY_BYTES,
  MAX_REPLACEMENT_BYTES,
  UNUSUAL_UNICODE_SKIP,
  EMPTY_MATCH_ERROR,
  EMPTY_QUERY_ERROR,
  QUERY_TOO_LONG_ERROR,
  REPLACEMENT_TOO_LONG_ERROR,
  MULTILINE_QUERY_ERROR,
  BROKEN_TEXT_ERROR,
  planMatches,
  planReplace,
  escapeRegExpLiteral,
  wrapWholeWord,
  compileMatcher,
  frontmatterRange,
  wikilinkRanges,
  applyReplacements,
  type FindOptions,
  type ReplaceOptions,
  type MatchPlan,
  type MatchRange,
  type Replacement,
  type ReplacePlan,
} from './findReplace';

// Independent contract tests for shared/findReplace.ts (FIND-REPLACE S1, plan R9).
// Offsets below are UTF-16 code-unit offsets into the whole file text, end exclusive.

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(here, 'findReplace.fixtures');
const FIXTURE_NAMES = ['crlf.md', 'frontmatter.md', 'unicode-nfc.md', 'wikilinks.md'] as const;
type FixtureName = (typeof FIXTURE_NAMES)[number];

function fixtureBytes(name: FixtureName): Buffer {
  return fs.readFileSync(path.join(fixtureDir, name));
}
function fixture(name: FixtureName): string {
  return fixtureBytes(name).toString('utf8');
}

type Span = { start: number; end: number; text: string };
type OkReplacePlan = Extract<ReplacePlan, { nextText: string }>;

/** Contract fields only, so extra implementation fields don't make offsets tests brittle. */
function spans(plan: MatchPlan): Span[] {
  return plan.matches.map(({ start, end, text }) => ({ start, end, text }));
}
function sp(start: number, text: string): Span {
  return { start, end: start + text.length, text };
}
function okReplace(result: ReplacePlan): OkReplacePlan {
  if ('error' in result) throw new Error(`unexpected planReplace error: ${result.error}`);
  return result;
}
function replaceError(result: ReplacePlan): string | undefined {
  return 'error' in result ? result.error : undefined;
}
function applyOk(text: string, reps: readonly Replacement[]): string {
  const result = applyReplacements(text, reps);
  if ('error' in result) throw new Error(`unexpected applyReplacements error: ${result.error}`);
  return result.nextText;
}
function applyError(text: string, reps: readonly Replacement[]): string | undefined {
  const result = applyReplacements(text, reps);
  return 'error' in result ? result.error : undefined;
}
function utf8Bytes(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}
function countCrlf(s: string): number {
  return s.split('\r\n').length - 1;
}

/** Plan-level invariants from the contract: ascending, non-overlapping, non-empty, text === slice, single line. */
function expectPlanInvariants(text: string, plan: MatchPlan): void {
  expect(plan.error).toBeUndefined();
  let prevEnd = 0;
  for (const m of plan.matches) {
    expect(Number.isInteger(m.start)).toBe(true);
    expect(Number.isInteger(m.end)).toBe(true);
    expect(m.start).toBeGreaterThanOrEqual(prevEnd);
    expect(m.end).toBeGreaterThan(m.start);
    expect(m.end).toBeLessThanOrEqual(text.length);
    expect(m.text).toBe(text.slice(m.start, m.end));
    expect(/[\r\n]/.test(m.text)).toBe(false);
    prevEnd = m.end;
  }
}

/** Preview == apply: deterministic plan, and three independent ways to apply it agree byte for byte. */
function expectPreviewEqualsApply(text: string, options: ReplaceOptions): OkReplacePlan {
  const first = planReplace(text, options);
  const second = planReplace(text, options);
  expect(second).toEqual(first);
  const plan = okReplace(first);

  const preview = planMatches(text, options);
  expectPlanInvariants(text, preview);
  expect(planMatches(text, options)).toEqual(preview);

  // Plan replacements are exactly the previewed matches, in descending start order.
  expect(plan.replacements.map((r) => [r.start, r.end, r.text])).toEqual(
    preview.matches.map((m) => [m.start, m.end, m.text]).reverse(),
  );
  for (let i = 1; i < plan.replacements.length; i++) {
    expect(plan.replacements[i - 1].start).toBeGreaterThan(plan.replacements[i].start);
  }

  // (a) planMatches' matches + the plan's expansions through applyReplacements (ascending order).
  const expansions = new Map(plan.replacements.map((r) => [`${r.start}:${r.end}`, r.replacement]));
  const fromPreview: Replacement[] = preview.matches.map((m) => {
    const replacement = expansions.get(`${m.start}:${m.end}`);
    expect(typeof replacement).toBe('string');
    return { start: m.start, end: m.end, text: m.text, replacement: replacement as string };
  });
  const viaApply = applyOk(text, fromPreview);

  // (b) the plan's own list through applyReplacements.
  const viaPlanList = applyOk(text, plan.replacements);

  // (c) naive slicing one at a time, in the plan's (descending) list order.
  let viaSlices = text;
  for (const r of plan.replacements) {
    viaSlices = viaSlices.slice(0, r.start) + r.replacement + viaSlices.slice(r.end);
  }

  const expectedBytes = Buffer.from(plan.nextText, 'utf8');
  for (const candidate of [viaApply, viaPlanList, viaSlices]) {
    expect(candidate).toBe(plan.nextText);
    expect(Buffer.from(candidate, 'utf8').equals(expectedBytes)).toBe(true);
  }
  return plan;
}

const NFD_TEXT = 'Café Mara and José'.normalize('NFD');

describe('fixtures (precondition)', () => {
  it('crlf.md uses CRLF for every line break', () => {
    const bytes = fixtureBytes('crlf.md');
    const lf = bytes.filter((b) => b === 0x0a).length;
    const cr = bytes.filter((b) => b === 0x0d).length;
    expect(lf).toBe(5);
    expect(cr).toBe(5);
    expect(countCrlf(bytes.toString('utf8'))).toBe(5);
  });

  it('every fixture is valid UTF-8 already in NFC (NFD input is built in-test, never stored)', () => {
    for (const name of FIXTURE_NAMES) {
      const bytes = fixtureBytes(name);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      expect(text.normalize('NFC')).toBe(text);
      expect(Buffer.from(text, 'utf8').equals(bytes)).toBe(true);
    }
    expect([...fixture('unicode-nfc.md')].some((ch) => ch.charCodeAt(0) > 0x7f)).toBe(true);
  });
});

describe('literal mode', () => {
  it('matches the query literally, escaping regex metacharacters (. ( ) $ etc.)', () => {
    expect(spans(planMatches('a.b axb a.b', { query: 'a.b' }))).toEqual([sp(0, 'a.b'), sp(8, 'a.b')]);
    expect(spans(planMatches('(x) x (x)', { query: '(x)' }))).toEqual([sp(0, '(x)'), sp(6, '(x)')]);
    expect(spans(planMatches('cost $5 or 5', { query: '$5' }))).toEqual([sp(5, '$5')]);
    expect(spans(planMatches('end$ end', { query: 'end$' }))).toEqual([sp(0, 'end$')]);
    expect(spans(planMatches('^a a', { query: '^a' }))).toEqual([sp(0, '^a')]);
    expect(spans(planMatches('a+b aab [a]* a|b \\d{2}?', { query: '[a]*' }))).toEqual([sp(8, '[a]*')]);
    expect(spans(planMatches('x a|b ab', { query: 'a|b' }))).toEqual([sp(2, 'a|b')]);
    expect(spans(planMatches('a+b aab', { query: 'a+b' }))).toEqual([sp(0, 'a+b')]);
    expect(spans(planMatches('\\d{2}? 12', { query: '\\d{2}?' }))).toEqual([sp(0, '\\d{2}?')]);
  });

  it('does not match a metacharacter query against non-literal text', () => {
    expect(spans(planMatches('axb', { query: 'a.b' }))).toEqual([]);
    expect(spans(planMatches('x', { query: '(x)' }))).toEqual([]);
  });

  it('escapeRegExpLiteral escapes exactly the ES SyntaxCharacters and is valid under the u flag', () => {
    const syntax = '^$\\.*+?()[]{}|';
    expect(escapeRegExpLiteral(syntax)).toBe('\\^\\$\\\\\\.\\*\\+\\?\\(\\)\\[\\]\\{\\}\\|');
    expect(escapeRegExpLiteral('a-b/c,d:e=f!<>#&é😀')).toBe('a-b/c,d:e=f!<>#&é😀');
    const source = escapeRegExpLiteral(`x${syntax}-/y`);
    const re = new RegExp(`^${source}$`, 'u');
    expect(re.test(`x${syntax}-/y`)).toBe(true);
  });
});

describe('match case', () => {
  it('is case-insensitive by default and exact when matchCase is on', () => {
    const text = 'Mara MARA mara mARa';
    expect(spans(planMatches(text, { query: 'mara' }))).toEqual([
      sp(0, 'Mara'),
      sp(5, 'MARA'),
      sp(10, 'mara'),
      sp(15, 'mARa'),
    ]);
    expect(spans(planMatches(text, { query: 'mara', matchCase: false }))).toHaveLength(4);
    expect(spans(planMatches(text, { query: 'Mara', matchCase: true }))).toEqual([sp(0, 'Mara')]);
    expect(spans(planMatches(text, { query: 'mara', matchCase: true }))).toEqual([sp(10, 'mara')]);
  });

  it('uses JS simple case folding for non-ASCII letters (élan ~ ÉLAN, ß ~ ẞ, ß !~ SS)', () => {
    expect(spans(planMatches('ÉLAN élan', { query: 'élan' }))).toEqual([sp(0, 'ÉLAN'), sp(5, 'élan')]);
    expect(spans(planMatches('ss SS ß ẞ', { query: 'ß' }))).toEqual([sp(6, 'ß'), sp(8, 'ẞ')]);
  });

  it('compileMatcher always uses flags g, m, u, adds i only when matchCase is off, and never s', () => {
    const insensitive = compileMatcher({ query: 'a' });
    const sensitive = compileMatcher({ query: 'a', matchCase: true });
    const regex = compileMatcher({ query: 'a.b', regex: true });
    if ('error' in insensitive || 'error' in sensitive || 'error' in regex) throw new Error('unexpected error');
    expect(insensitive.regex.flags.split('').sort().join('')).toBe('gimu');
    expect(sensitive.regex.flags.split('').sort().join('')).toBe('gmu');
    expect(regex.regex.flags.split('').sort().join('')).toBe('gimu');
    expect(regex.regex.dotAll).toBe(false);
  });
});

describe('whole word (Unicode boundary, not \\b)', () => {
  it('does not match Mara inside Maraé, éMara, _Mara, Mara_ or Mara2', () => {
    const text = 'Maraé éMara _Mara Mara_ Mara2 2Mara';
    expect(spans(planMatches(text, { query: 'Mara' }))).toHaveLength(6);
    expect(spans(planMatches(text, { query: 'Mara', wholeWord: true }))).toEqual([]);
  });

  it('matches Mara next to ASCII/Unicode punctuation, CJK punctuation, spaces and emoji', () => {
    const text = 'Mara, (Mara) «Mara» 「Mara」 Mara。 🙂Mara🙂 Mara’s';
    expect(spans(planMatches(text, { query: 'Mara', wholeWord: true }))).toEqual([
      sp(0, 'Mara'),
      sp(7, 'Mara'),
      sp(14, 'Mara'),
      sp(21, 'Mara'),
      sp(27, 'Mara'),
      sp(35, 'Mara'),
      sp(42, 'Mara'),
    ]);
  });

  it('treats CJK ideographs and kana as letters, so Mara glued to them is not a whole word', () => {
    expect(spans(planMatches('東京Mara中 マラMara', { query: 'Mara', wholeWord: true }))).toEqual([]);
    expect(spans(planMatches('東京 Mara 中', { query: 'Mara', wholeWord: true }))).toEqual([sp(3, 'Mara')]);
  });

  it('differs from \\b, which treats accented letters as non-word characters', () => {
    // The naive ASCII \b boundary wrongly accepts these as whole words.
    expect(/\bMara\b/u.test('Maraé')).toBe(true);
    expect(/\bMara\b/u.test('éMara')).toBe(true);
    expect(spans(planMatches('Maraé', { query: 'Mara', wholeWord: true }))).toEqual([]);
    expect(spans(planMatches('éMara', { query: 'Mara', wholeWord: true }))).toEqual([]);
    const wrapped = new RegExp(wrapWholeWord('Mara'), 'gu');
    expect('Maraé éMara Mara.'.match(wrapped)).toEqual(['Mara']);
  });

  it('wraps a regex alternation as one group (cat|dog does not leak past the boundary)', () => {
    expect(spans(planMatches('cats dog cat bobcat', { query: 'cat|dog', regex: true, wholeWord: true }))).toEqual([
      sp(5, 'dog'),
      sp(9, 'cat'),
    ]);
  });

  it('finds exactly the whole-word Mara occurrences in unicode-nfc.md', () => {
    const text = fixture('unicode-nfc.md');
    expect(spans(planMatches(text, { query: 'Mara' }))).toHaveLength(17);
    expect(spans(planMatches(text, { query: 'Mara', wholeWord: true }))).toEqual(
      [2, 39, 77, 83, 90, 97, 104, 110, 147, 173, 184].map((start) => sp(start, 'Mara')),
    );
  });
});

describe('Turkish i (documented: JS default case folding, not special-cased)', () => {
  it("query 'i' (match case off) matches 'i' and 'I' but not 'İ' (U+0130) or 'ı' (U+0131)", () => {
    const text = 'i I İ ı';
    expect(spans(planMatches(text, { query: 'i' }))).toEqual([sp(0, 'i'), sp(2, 'I')]);
  });

  it("query 'I' likewise matches 'i' and 'I' only", () => {
    const text = 'i I İ ı';
    expect(spans(planMatches(text, { query: 'I' }))).toEqual([sp(0, 'i'), sp(2, 'I')]);
  });

  it("query 'İ' and query 'ı' each match only themselves", () => {
    const text = 'i I İ ı';
    expect(spans(planMatches(text, { query: 'İ' }))).toEqual([sp(4, 'İ')]);
    expect(spans(planMatches(text, { query: 'ı' }))).toEqual([sp(6, 'ı')]);
  });

  it('applies the same rule on the Turkish line of unicode-nfc.md', () => {
    const text = fixture('unicode-nfc.md');
    const lineStart = text.indexOf('Turkish:');
    expect(lineStart).toBe(245);
    const lineEnd = text.indexOf('\n', lineStart);
    const onLine = spans(planMatches(text, { query: 'i' })).filter((m) => m.start >= lineStart && m.end <= lineEnd);
    expect(onLine).toEqual([sp(249, 'i'), sp(268, 'i'), sp(270, 'i'), sp(272, 'I')]);
    expect(text.slice(lineStart, lineEnd)).toContain('İ');
    expect(text.slice(lineStart, lineEnd)).toContain('ı');
  });
});

describe('NFC normalization', () => {
  it("skips NFD text as 'unusual Unicode, skipped' with no matches", () => {
    expect(NFD_TEXT.normalize('NFC')).not.toBe(NFD_TEXT);
    const plan = planMatches(NFD_TEXT, { query: 'Mara' });
    expect(UNUSUAL_UNICODE_SKIP).toBe('unusual Unicode, skipped');
    expect(plan.skipped).toBe(UNUSUAL_UNICODE_SKIP);
    expect(plan.matches).toEqual([]);
    expect(plan.error).toBeUndefined();
  });

  it('planReplace on NFD text returns nextText === text and no replacements', () => {
    const plan = okReplace(planReplace(NFD_TEXT, { query: 'Mara', replacement: 'Vey' }));
    expect(plan.skipped).toBe(UNUSUAL_UNICODE_SKIP);
    expect(plan.nextText).toBe(NFD_TEXT);
    expect(plan.replacements).toEqual([]);
  });

  it('reports pattern/input errors before the NFC skip', () => {
    const invalid = planMatches(NFD_TEXT, { query: '(', regex: true });
    expect(invalid.error?.startsWith('Invalid pattern')).toBe(true);
    expect(invalid.skipped).toBeUndefined();
    const multiline = planMatches(NFD_TEXT, { query: 'a\nb' });
    expect(multiline.error).toBe(MULTILINE_QUERY_ERROR);
    expect(multiline.skipped).toBeUndefined();
    expect(replaceError(planReplace(NFD_TEXT, { query: 'Mara', replacement: 'x'.repeat(10241) }))).toBe(
      REPLACEMENT_TOO_LONG_ERROR,
    );
  });

  it('normalizes an NFD query to NFC so it matches NFC text', () => {
    const text = 'Café Mara café';
    const query = 'café'.normalize('NFD');
    expect(query).not.toBe('café');
    expect(spans(planMatches(text, { query }))).toEqual([sp(0, 'Café'), sp(10, 'café')]);
  });

  it('normalizes an NFD replacement to NFC before inserting it', () => {
    const plan = okReplace(planReplace('Mara met Mara', { query: 'Mara', replacement: 'José'.normalize('NFD') }));
    expect(plan.nextText).toBe('José met José');
    expect(plan.nextText.normalize('NFC')).toBe(plan.nextText);
    expect(plan.replacements.map((r) => r.replacement)).toEqual(['José', 'José']);
  });
});

describe('regex mode replacement tokens', () => {
  it('expands numbered capture groups $1 $2 (and $10 with ten groups)', () => {
    const plan = okReplace(planReplace('Mara Vey', { query: '(\\w+) (\\w+)', regex: true, replacement: '$2 $1' }));
    expect(plan.nextText).toBe('Vey Mara');
    expect(plan.replacements.map(({ start, end, text, replacement }) => ({ start, end, text, replacement }))).toEqual([
      { start: 0, end: 8, text: 'Mara Vey', replacement: 'Vey Mara' },
    ]);
    const ten = okReplace(
      planReplace('abcdefghij', { query: '(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)', regex: true, replacement: '$10$1' }),
    );
    expect(ten.nextText).toBe('ja');
  });

  it('expands named groups $<name>', () => {
    const plan = okReplace(
      planReplace('Mara Vey', {
        query: '(?<first>\\w+) (?<last>\\w+)',
        regex: true,
        replacement: '$<last>, $<first>',
      }),
    );
    expect(plan.nextText).toBe('Vey, Mara');
  });

  it('expands $& to the whole match', () => {
    const plan = okReplace(planReplace('Mara met Mara', { query: 'Mara', regex: true, replacement: '[$&]' }));
    expect(plan.nextText).toBe('[Mara] met [Mara]');
  });

  it('expands $$ to a single literal $', () => {
    const plan = okReplace(planReplace('price 5', { query: '\\d', regex: true, replacement: '$$$&' }));
    expect(plan.nextText).toBe('price $5');
    const plain = okReplace(planReplace('Mara', { query: 'Mara', regex: true, replacement: 'a$$b' }));
    expect(plain.nextText).toBe('a$b');
  });

  it('expands tokens with lookbehind context on the same line', () => {
    const plan = okReplace(planReplace('ab cb', { query: '(?<=a)b', regex: true, replacement: 'X' }));
    expect(plan.nextText).toBe('aX cb');
  });
});

describe('literal mode replacement', () => {
  it('inserts $1, $&, $$ and $<x> verbatim', () => {
    const plan = okReplace(planReplace('Mara met Mara', { query: 'Mara', replacement: '$1 $& $$ $<x>' }));
    expect(plan.nextText).toBe('$1 $& $$ $<x> met $1 $& $$ $<x>');
    expect(plan.replacements.map((r) => r.replacement)).toEqual(['$1 $& $$ $<x>', '$1 $& $$ $<x>']);
  });
});

describe('invalid regex', () => {
  it("returns an error starting with 'Invalid pattern' and no matches", () => {
    for (const query of ['(', '[a', '*', 'a{2,1}', '\\p{NotAProperty}']) {
      const plan = planMatches('a ( [a * a{2,1}', { query, regex: true });
      expect(plan.error?.startsWith('Invalid pattern')).toBe(true);
      expect(plan.matches).toEqual([]);
      expect(replaceError(planReplace('a (', { query, regex: true, replacement: 'x' }))?.startsWith('Invalid pattern')).toBe(
        true,
      );
    }
    const compiled = compileMatcher({ query: '(', regex: true });
    expect('error' in compiled && compiled.error.startsWith('Invalid pattern')).toBe(true);
  });

  it('treats the same characters as a valid literal query when regex is off', () => {
    expect(spans(planMatches('a ( b', { query: '(' }))).toEqual([sp(2, '(')]);
  });
});

describe('empty-match refusal', () => {
  it("refuses '^', 'a*' and '(?<=a)' with EMPTY_MATCH_ERROR", () => {
    expect(EMPTY_MATCH_ERROR).toBe('pattern matches empty text');
    for (const query of ['^', 'a*', '(?<=a)']) {
      const plan = planMatches('ab', { query, regex: true });
      expect(plan.error).toBe(EMPTY_MATCH_ERROR);
      expect(plan.matches).toEqual([]);
      expect(replaceError(planReplace('ab', { query, regex: true, replacement: 'x' }))).toBe(EMPTY_MATCH_ERROR);
    }
  });

  it('refuses an empty query with EMPTY_QUERY_ERROR', () => {
    expect(planMatches('abc', { query: '' }).error).toBe(EMPTY_QUERY_ERROR);
    expect(planMatches('abc', { query: '', regex: true }).error).toBe(EMPTY_QUERY_ERROR);
    expect(planMatches('abc', { query: '' }).matches).toEqual([]);
    expect(replaceError(planReplace('abc', { query: '', replacement: 'x' }))).toBe(EMPTY_QUERY_ERROR);
  });
});

describe('frontmatter', () => {
  const text = fixture('frontmatter.md');

  it('frontmatterRange covers the opener through the closer line content', () => {
    expect(frontmatterRange(text)).toEqual({ start: 0, end: 54 });
    expect(text.slice(0, 54).endsWith('\n---')).toBe(true);
    expect(frontmatterRange('---\na: 1\n---\nbody')).toEqual({ start: 0, end: 12 });
    expect(frontmatterRange('---\na\n---  \nb')).toEqual({ start: 0, end: 11 });
  });

  it('frontmatterRange is null when unclosed or when line 0 is not exactly ---', () => {
    expect(frontmatterRange('---\ntitle: Mara\nMara')).toBeNull();
    expect(frontmatterRange('x\n---\na\n---\n')).toBeNull();
    expect(frontmatterRange('--- \na\n---\n')).toBeNull();
    expect(frontmatterRange('----\na\n---\n')).toBeNull();
    expect(frontmatterRange('no frontmatter')).toBeNull();
  });

  it('excludes the frontmatter block by default', () => {
    expect(spans(planMatches(text, { query: 'Mara' }))).toEqual([sp(55, 'Mara'), sp(88, 'Mara'), sp(101, 'Mara')]);
  });

  it('includes the frontmatter block when includeFrontmatter is true', () => {
    expect(spans(planMatches(text, { query: 'Mara', includeFrontmatter: true }))).toEqual([
      sp(11, 'Mara'),
      sp(29, 'Mara'),
      sp(45, 'mara'),
      sp(55, 'Mara'),
      sp(88, 'Mara'),
      sp(101, 'Mara'),
    ]);
  });

  it('leaves frontmatter bytes untouched by a default replace', () => {
    const plan = expectPreviewEqualsApply(text, { query: 'Mara', replacement: 'Vey' });
    expect(plan.nextText.slice(0, 54)).toBe(text.slice(0, 54));
    expect(plan.nextText).toBe(text.slice(0, 54) + text.slice(54).replace(/Mara/g, 'Vey'));
  });

  it('searches an unclosed --- block like ordinary text', () => {
    expect(spans(planMatches('---\ntitle: Mara\nMara', { query: 'Mara' }))).toEqual([sp(11, 'Mara'), sp(16, 'Mara')]);
  });

  it('never produces a match that crosses the frontmatter boundary', () => {
    // A pattern that could only match by spanning the closing --- into the body.
    for (const includeFrontmatter of [false, true]) {
      expect(spans(planMatches(text, { query: '---[\\s\\S]*Mara', regex: true, includeFrontmatter }))).toEqual([]);
      expect(spans(planMatches(text, { query: 'tags[\\s\\S]*door', regex: true, includeFrontmatter }))).toEqual([]);
    }
    expect(spans(planMatches(text, { query: '.+', regex: true }))).toEqual([
      sp(55, 'Mara opened the door.'),
      sp(78, 'She said "Mara" twice: Mara.'),
    ]);
    expect(spans(planMatches(text, { query: '.+', regex: true, includeFrontmatter: true }))).toEqual([
      sp(0, '---'),
      sp(4, 'title: Mara'),
      sp(16, 'aliases:'),
      sp(25, '  - Mara Vey'),
      sp(38, 'tags: [mara]'),
      sp(51, '---'),
      sp(55, 'Mara opened the door.'),
      sp(78, 'She said "Mara" twice: Mara.'),
    ]);
  });

  it('excludes CRLF frontmatter by default too', () => {
    const crlfFm = '---\r\ntitle: Mara\r\n---\r\nMara here\r\n';
    expect(spans(planMatches(crlfFm, { query: 'Mara' }))).toEqual([sp(23, 'Mara')]);
    expect(spans(planMatches(crlfFm, { query: 'Mara', includeFrontmatter: true }))).toEqual([
      sp(12, 'Mara'),
      sp(23, 'Mara'),
    ]);
  });
});

describe('wikilinks', () => {
  const text = fixture('wikilinks.md');

  it('wikilinkRanges returns [[...]] spans within a line', () => {
    const lines = text.split('\n');
    expect(wikilinkRanges(lines[0])).toEqual([{ start: 9, end: 17 }]);
    expect(wikilinkRanges(lines[1])).toEqual([
      { start: 4, end: 19 },
      { start: 24, end: 44 },
      { start: 48, end: 67 },
    ]);
    expect(wikilinkRanges(lines[2])).toEqual([{ start: 8, end: 16 }]);
    expect(wikilinkRanges('no links [[]] here [x]')).toEqual([]);
  });

  it('skips matches inside [[Name]], [[folder/Name]], [[Name|alias]], [[Name#h]] and ![[Name]] by default', () => {
    expect(spans(planMatches(text, { query: 'Mara' }))).toEqual([sp(0, 'Mara'), sp(118, 'Mara'), sp(139, 'Mara')]);
  });

  it("keeps the plain word after a link on the same line ('[[Mara]] Mara' -> one match)", () => {
    expect(spans(planMatches('[[Mara]] Mara', { query: 'Mara' }))).toEqual([sp(9, 'Mara')]);
  });

  it('drops a match that only partly overlaps a link span', () => {
    expect(spans(planMatches(text, { query: 'met [[Mara' }))).toEqual([]);
    expect(spans(planMatches(text, { query: 'met [[Mara', includeWikilinks: true }))).toEqual([sp(5, 'met [[Mara')]);
  });

  it('includes link spans when includeWikilinks is true', () => {
    expect(spans(planMatches(text, { query: 'Mara', includeWikilinks: true }))).toEqual(
      [0, 11, 40, 53, 77, 106, 118, 132, 139].map((start) => sp(start, 'Mara')),
    );
  });

  it('replaces only plain mentions by default', () => {
    const plan = expectPreviewEqualsApply(text, { query: 'Mara', replacement: 'Vey' });
    expect(plan.nextText).toBe(
      'Vey met [[Mara]] at dawn.\nSee [[people/Mara]] and [[Mara|the captain]] or [[Mara#Early life]].\n' +
        'Embed: ![[Mara]] then Vey again.\n[[Mara]] Vey\n',
    );
  });
});

describe('CRLF', () => {
  const bytes = fixtureBytes('crlf.md');
  const text = bytes.toString('utf8');

  it('preserves CRLF line endings byte for byte after replace', () => {
    const plan = expectPreviewEqualsApply(text, { query: 'Mara', replacement: 'Vey' });
    expect(plan.replacements.map((r) => r.start)).toEqual([49, 28, 0]);
    expect(countCrlf(plan.nextText)).toBe(countCrlf(text));
    expect(countCrlf(plan.nextText)).toBe(5);
    expect(plan.nextText.split('\n').length - 1).toBe(5);
    const expected = Buffer.from(text.replace(/mara/gi, 'Vey'), 'utf8');
    expect(Buffer.from(plan.nextText, 'utf8').equals(expected)).toBe(true);
  });

  it('anchors $ before the \\r (end$ matches at line ends)', () => {
    const plan = planMatches(text, { query: 'end$', regex: true });
    expect(spans(plan)).toEqual([sp(23, 'end'), sp(42, 'end'), sp(54, 'end')]);
    for (const m of plan.matches) expect(text.slice(m.end, m.end + 2)).toBe('\r\n');
    const replaced = expectPreviewEqualsApply(text, { query: 'end$', regex: true, replacement: 'END' });
    expect(replaced.nextText).toBe('Mara walked home.\r\nThe END\r\nmara said the END\r\n\r\nMara END\r\n');
  });

  it('never includes the trailing \\r in a match', () => {
    expect(spans(planMatches(text, { query: '.+', regex: true }))).toEqual([
      sp(0, 'Mara walked home.'),
      sp(19, 'The end'),
      sp(28, 'mara said the end'),
      sp(49, 'Mara end'),
    ]);
    expect(spans(planMatches(text, { query: '\\S+$', regex: true })).map((m) => m.text)).toEqual([
      'home.',
      'end',
      'end',
      'end',
    ]);
  });
});

describe('multiline', () => {
  it('refuses a literal query containing \\n or \\r with MULTILINE_QUERY_ERROR', () => {
    for (const query of ['a\nb', 'a\rb', 'a\r\nb', '\n']) {
      expect(planMatches('a\nb', { query }).error).toBe(MULTILINE_QUERY_ERROR);
      expect(planMatches('a\nb', { query }).matches).toEqual([]);
      expect(replaceError(planReplace('a\nb', { query, replacement: 'x' }))).toBe(MULTILINE_QUERY_ERROR);
    }
  });

  it('refuses a regex with an unescaped \\n or \\r escape, or a raw newline', () => {
    for (const query of ['a\\nb', 'a\\rb', 'a\\\\\\nb', 'a\nb']) {
      expect(planMatches('a\nb', { query, regex: true }).error).toBe(MULTILINE_QUERY_ERROR);
    }
  });

  it('does not refuse an escaped backslash followed by n (regex source a\\\\nb)', () => {
    const query = 'a\\\\nb'; // source chars: a \ \ n b
    expect(query.length).toBe(5);
    const text = 'x a\\nb'; // text chars: x space a \ n b
    const plan = planMatches(text, { query, regex: true });
    expect(plan.error).toBeUndefined();
    expect(spans(plan)).toEqual([sp(2, 'a\\nb')]);
  });

  it('does not let . (or \\s, [^x]) cross lines', () => {
    expect(spans(planMatches('a\nb', { query: 'a.b', regex: true }))).toEqual([]);
    expect(spans(planMatches('ab\nac', { query: 'a.*', regex: true }))).toEqual([sp(0, 'ab'), sp(3, 'ac')]);
    expect(spans(planMatches('a\nb', { query: 'a\\sb', regex: true }))).toEqual([]);
    expect(spans(planMatches('a b', { query: 'a\\sb', regex: true }))).toEqual([sp(0, 'a b')]);
    expect(spans(planMatches('ab\ncd', { query: '[^x]+', regex: true }))).toEqual([sp(0, 'ab'), sp(3, 'cd')]);
  });

  it('treats ^ as a line anchor and keeps lookbehind from seeing the previous line', () => {
    expect(spans(planMatches('ab\nba', { query: '^b', regex: true }))).toEqual([sp(3, 'b')]);
    expect(spans(planMatches('a\nb', { query: '(?<=a\\s)b', regex: true }))).toEqual([]);
    expect(spans(planMatches('a\nb', { query: '(?<![\\s\\S])b', regex: true }))).toEqual([sp(2, 'b')]);
  });
});

describe('scan order', () => {
  it("finds non-overlapping matches left to right ('aa' in 'aaaa' -> 0 and 2)", () => {
    expect(spans(planMatches('aaaa', { query: 'aa' }))).toEqual([sp(0, 'aa'), sp(2, 'aa')]);
    expect(spans(planMatches('ababa', { query: 'aba' }))).toEqual([sp(0, 'aba')]);
    expect(okReplace(planReplace('aaaa', { query: 'aa', replacement: 'b' })).nextText).toBe('bb');
  });

  it('truncates at maxMatches and flags truncated only when a real match was left out', () => {
    const text = 'a a a a a';
    const cut = planMatches(text, { query: 'a', maxMatches: 2 });
    expect(spans(cut)).toEqual([sp(0, 'a'), sp(2, 'a')]);
    expect(cut.truncated).toBe(true);

    const exact = planMatches(text, { query: 'a', maxMatches: 5 });
    expect(spans(exact)).toHaveLength(5);
    expect(exact.truncated ?? false).toBe(false);

    const roomy = planMatches(text, { query: 'a', maxMatches: 100 });
    expect(spans(roomy)).toHaveLength(5);
    expect(roomy.truncated ?? false).toBe(false);

    // Matches dropped for overlapping a wikilink are not real matches.
    const linked = planMatches('Mara [[Mara]] Mara', { query: 'Mara', maxMatches: 2 });
    expect(spans(linked)).toEqual([sp(0, 'Mara'), sp(14, 'Mara')]);
    expect(linked.truncated ?? false).toBe(false);

    const plan = okReplace(planReplace(text, { query: 'a', replacement: 'X', maxMatches: 2 }));
    expect(plan.nextText).toBe('X X a a a');
    expect(plan.truncated).toBe(true);
  });
});

describe('preview == apply', () => {
  const OPTION_SETS: ReplaceOptions[] = [
    { query: 'Mara', replacement: 'Vey' },
    { query: 'Mara', replacement: '$1 $& $$', wholeWord: true },
    { query: '(?<first>M)(ar)a', regex: true, replacement: '$<first>-$2-$&-$$' },
    { query: 'Mara', replacement: 'Vey', includeFrontmatter: true, includeWikilinks: true },
    { query: '\\p{L}+', regex: true, replacement: '[$&]' },
    { query: 'end$', regex: true, replacement: 'END', matchCase: true },
    { query: 'mara', replacement: 'Ελληνικά 🙂', matchCase: true },
  ];

  it('is byte-identical across preview, plan list and applyReplacements on every fixture', () => {
    for (const name of FIXTURE_NAMES) {
      const text = fixture(name);
      for (const options of OPTION_SETS) expectPreviewEqualsApply(text, options);
    }
  });

  it('replaces the expected number of plain Mara mentions in every fixture', () => {
    const expected: Record<FixtureName, number> = {
      'crlf.md': 3,
      'frontmatter.md': 3,
      'unicode-nfc.md': 17,
      'wikilinks.md': 3,
    };
    for (const name of FIXTURE_NAMES) {
      const plan = expectPreviewEqualsApply(fixture(name), { query: 'Mara', replacement: 'Vey' });
      expect(plan.replacements).toHaveLength(expected[name]);
      expect(plan.nextText.length).toBe(fixture(name).length - expected[name]);
    }
  });

  it('holds Match.text === text.slice(start, end) across fixtures and options', () => {
    const findSets: FindOptions[] = [
      { query: 'Mara' },
      { query: 'Mara', wholeWord: true },
      { query: 'Mara', includeFrontmatter: true, includeWikilinks: true },
      { query: '.+', regex: true, includeFrontmatter: true, includeWikilinks: true },
      { query: '\\p{L}+', regex: true },
      { query: '[^\\p{L}\\s]+', regex: true },
      { query: 'i' },
    ];
    for (const name of FIXTURE_NAMES) {
      const text = fixture(name);
      for (const options of findSets) {
        const plan = planMatches(text, options);
        expectPlanInvariants(text, plan);
        for (const m of plan.matches) expect(m.text).toBe(text.slice(m.start, m.end));
      }
    }
  });
});

describe('selection subset', () => {
  const text = 'Mara and Mara and Mara';

  it('replaces only the ticked (start, end) matches', () => {
    const plan = okReplace(planReplace(text, { query: 'Mara', replacement: 'X' }, [{ start: 9, end: 13 }]));
    expect(plan.nextText).toBe('Mara and X and Mara');
    expect(plan.replacements.map(({ start, end, text: t, replacement }) => ({ start, end, text: t, replacement }))).toEqual([
      { start: 9, end: 13, text: 'Mara', replacement: 'X' },
    ]);
    const two = okReplace(
      planReplace(text, { query: 'Mara', replacement: 'X' }, [
        { start: 0, end: 4 },
        { start: 18, end: 22 },
      ]),
    );
    expect(two.nextText).toBe('X and Mara and X');
    expect(two.replacements.map((r) => r.start)).toEqual([18, 0]);
  });

  it('accepts the ticked set in any order', () => {
    const plan = okReplace(
      planReplace(text, { query: 'Mara', replacement: 'X' }, [
        { start: 18, end: 22 },
        { start: 0, end: 4 },
      ]),
    );
    expect(plan.nextText).toBe('X and Mara and X');
  });

  it('ignores forged ranges that match no current match', () => {
    const forged: MatchRange[] = [
      { start: 1, end: 5 },
      { start: 0, end: 3 },
      { start: 9, end: 14 },
      { start: 4, end: 8 },
      { start: 100, end: 104 },
    ];
    const plan = okReplace(planReplace(text, { query: 'Mara', replacement: 'X' }, forged));
    expect(plan.nextText).toBe(text);
    expect(plan.replacements).toEqual([]);
    const mixed = okReplace(planReplace(text, { query: 'Mara', replacement: 'X' }, [...forged, { start: 9, end: 13 }]));
    expect(mixed.nextText).toBe('Mara and X and Mara');
    expect(mixed.replacements).toHaveLength(1);
  });

  it('replaces nothing for an empty selection and everything without one', () => {
    expect(okReplace(planReplace(text, { query: 'Mara', replacement: 'X' }, [])).nextText).toBe(text);
    expect(okReplace(planReplace(text, { query: 'Mara', replacement: 'X' })).nextText).toBe('X and X and X');
  });

  it('cannot select a range that sits inside a skipped wikilink', () => {
    const linked = 'Mara [[Mara]]';
    const plan = okReplace(planReplace(linked, { query: 'Mara', replacement: 'X' }, [{ start: 7, end: 11 }]));
    expect(plan.nextText).toBe(linked);
  });
});

describe('applyReplacements', () => {
  const text = 'Mara met Mara';
  const a: Replacement = { start: 0, end: 4, text: 'Mara', replacement: 'A' };
  const b: Replacement = { start: 9, end: 13, text: 'Mara', replacement: 'B' };

  it('applies valid entries in any order', () => {
    expect(applyOk(text, [a, b])).toBe('A met B');
    expect(applyOk(text, [b, a])).toBe('A met B');
    expect(applyOk(text, [])).toBe(text);
    expect(
      applyOk('aaaa', [
        { start: 0, end: 2, text: 'aa', replacement: 'x' },
        { start: 2, end: 4, text: 'aa', replacement: 'y' },
      ]),
    ).toBe('xy');
  });

  it('refuses overlapping entries (including duplicates)', () => {
    expect(typeof applyError(text, [a, { start: 2, end: 6, text: 'ra m', replacement: 'Z' }])).toBe('string');
    expect(typeof applyError(text, [a, a])).toBe('string');
    expect(typeof applyError(text, [b, { start: 0, end: 13, text, replacement: 'Z' }])).toBe('string');
  });

  it('refuses stale entries whose text no longer matches', () => {
    expect(typeof applyError(text, [{ start: 0, end: 4, text: 'Mira', replacement: 'A' }])).toBe('string');
    expect(typeof applyError('Mira met Mara', [a, b])).toBe('string');
  });

  it('refuses out-of-range and empty-length entries', () => {
    // slice() clamps, so 9..14 would look fresh ('Mara') if bounds were not checked.
    expect(typeof applyError(text, [{ start: 9, end: 14, text: 'Mara', replacement: 'B' }])).toBe('string');
    expect(typeof applyError(text, [{ start: -1, end: 4, text: 'Mara', replacement: 'A' }])).toBe('string');
    expect(typeof applyError(text, [{ start: 4, end: 0, text: '', replacement: 'A' }])).toBe('string');
    expect(typeof applyError(text, [{ start: 4, end: 4, text: '', replacement: 'A' }])).toBe('string');
    expect(typeof applyError(text, [{ start: 20, end: 24, text: '', replacement: 'A' }])).toBe('string');
  });

  it('refuses the whole batch when any entry is bad', () => {
    const result = applyReplacements(text, [a, { start: 9, end: 13, text: 'Mira', replacement: 'B' }]);
    expect('error' in result).toBe(true);
    expect('nextText' in result).toBe(false);
  });
});

describe('input caps and broken text', () => {
  it('exports the 1 KB query and 10 KB replacement caps', () => {
    expect(MAX_QUERY_BYTES).toBe(1024);
    expect(MAX_REPLACEMENT_BYTES).toBe(10240);
  });

  it('refuses a 1025-byte query and accepts exactly 1024 bytes', () => {
    const over = 'a'.repeat(1025);
    expect(utf8Bytes(over)).toBe(1025);
    expect(planMatches(over, { query: over }).error).toBe(QUERY_TOO_LONG_ERROR);
    expect(planMatches(over, { query: over }).matches).toEqual([]);
    expect(replaceError(planReplace(over, { query: over, replacement: 'x' }))).toBe(QUERY_TOO_LONG_ERROR);

    const atCap = 'a'.repeat(1024);
    expect(spans(planMatches(`${atCap}b`, { query: atCap }))).toEqual([sp(0, atCap)]);
  });

  it('counts UTF-8 bytes, not UTF-16 units (342 x € = 1026 bytes refused; 341 x € + a = 1024 accepted)', () => {
    const over = '€'.repeat(342);
    expect(over.length).toBe(342);
    expect(utf8Bytes(over)).toBe(1026);
    expect(planMatches(over, { query: over }).error).toBe(QUERY_TOO_LONG_ERROR);

    const atCap = `${'€'.repeat(341)}a`;
    expect(utf8Bytes(atCap)).toBe(1024);
    expect(spans(planMatches(atCap, { query: atCap }))).toEqual([sp(0, atCap)]);
  });

  it('checks the query cap on both the raw and the NFC form', () => {
    // Raw NFD é is 3 bytes, NFC é is 2: raw form over the cap.
    const rawOver = 'é'.repeat(342);
    expect(utf8Bytes(rawOver)).toBe(1026);
    expect(utf8Bytes(rawOver.normalize('NFC'))).toBe(684);
    expect(planMatches('é', { query: rawOver }).error).toBe(QUERY_TOO_LONG_ERROR);
    // U+0958 is 3 bytes but NFC expands it to U+0915 U+093C (6 bytes): NFC form over the cap.
    const nfcOver = 'क़'.repeat(200);
    expect(utf8Bytes(nfcOver)).toBe(600);
    expect(utf8Bytes(nfcOver.normalize('NFC'))).toBe(1200);
    expect(planMatches('x', { query: nfcOver }).error).toBe(QUERY_TOO_LONG_ERROR);
  });

  it('refuses a 10241-byte replacement and accepts exactly 10240 bytes', () => {
    const over = 'b'.repeat(10241);
    expect(replaceError(planReplace('Mara', { query: 'Mara', replacement: over }))).toBe(REPLACEMENT_TOO_LONG_ERROR);
    const atCap = 'b'.repeat(10240);
    const plan = okReplace(planReplace('Mara!', { query: 'Mara', replacement: atCap }));
    expect(plan.nextText).toBe(`${atCap}!`);
    // NFC expansion pushes a raw-under-cap replacement over the cap.
    const nfcOver = 'क़'.repeat(2000);
    expect(utf8Bytes(nfcOver)).toBe(6000);
    expect(replaceError(planReplace('Mara', { query: 'Mara', replacement: nfcOver }))).toBe(REPLACEMENT_TOO_LONG_ERROR);
  });

  it('refuses a lone UTF-16 surrogate in the query or replacement with BROKEN_TEXT_ERROR', () => {
    expect(planMatches('a\uD800b', { query: '\uD800' }).error).toBe(BROKEN_TEXT_ERROR);
    expect(planMatches('ab', { query: 'a\uDC00b' }).error).toBe(BROKEN_TEXT_ERROR);
    expect(planMatches('ab', { query: '\uDC00\uD800', regex: true }).error).toBe(BROKEN_TEXT_ERROR);
    expect(replaceError(planReplace('Mara', { query: 'Mara', replacement: 'x\uD83D' }))).toBe(BROKEN_TEXT_ERROR);
    expect(replaceError(planReplace('Mara', { query: 'Mara', replacement: '\uDE00' }))).toBe(BROKEN_TEXT_ERROR);
  });

  it('accepts a well-formed surrogate pair', () => {
    expect(spans(planMatches('x😀y', { query: '😀' }))).toEqual([sp(1, '😀')]);
    expect(okReplace(planReplace('Mara', { query: 'Mara', replacement: '😀' })).nextText).toBe('😀');
  });
});

describe('purity and determinism', () => {
  it('returns identical output for identical input and does not mutate options or selection', () => {
    const text = fixture('wikilinks.md');
    const options: ReplaceOptions = Object.freeze({ query: '(M)ara', regex: true, replacement: '$1x' });
    const selection: readonly MatchRange[] = Object.freeze([Object.freeze({ start: 118, end: 122 })]);
    const firstMatches = planMatches(text, options);
    const firstPlan = planReplace(text, options, selection);
    // Interleave unrelated calls to catch shared regex state (lastIndex) or caches keyed loosely.
    planMatches('Mara Mara Mara', { query: 'Mara', maxMatches: 1 });
    planMatches(text, { query: 'a', regex: true, matchCase: true, includeWikilinks: true });
    planReplace(text, { query: 'Mara', replacement: 'Q' });
    compileMatcher(options);
    expect(planMatches(text, options)).toEqual(firstMatches);
    expect(planReplace(text, options, selection)).toEqual(firstPlan);
    expect(options).toEqual({ query: '(M)ara', regex: true, replacement: '$1x' });
    expect(selection).toEqual([{ start: 118, end: 122 }]);
    expect(okReplace(firstPlan).nextText).toBe(`${text.slice(0, 118)}Mx${text.slice(122)}`);
  });

  it('compileMatcher returns a fresh regex each call', () => {
    const one = compileMatcher({ query: 'a' });
    const two = compileMatcher({ query: 'a' });
    if ('error' in one || 'error' in two) throw new Error('unexpected error');
    expect(one.regex).not.toBe(two.regex);
  });
});

// Regressions from the adversarial review of the first tip. Each test below
// failed (or hung) against that tip or against a mutant the suite let live.
describe('review regressions', () => {
  it('validates a regex before the Whole word wrap, so an invalid pattern is never accepted', () => {
    for (const query of ['[', 'a)|(b', '(?<x>a']) {
      const plan = planMatches('x)y a b', { query, regex: true, wholeWord: true });
      expect(plan.matches).toEqual([]);
      expect(plan.error?.startsWith('Invalid pattern')).toBe(true);
    }
  });

  it('reports only the engine reason for an invalid pattern, never the pattern itself', () => {
    const plan = planMatches('a', { query: 'secret(b', regex: true });
    expect(plan.error).toBe('Invalid pattern: Unterminated group');
  });

  it('expands $ tokens in linear time: 5 MB line, 5,000 matches, $1 replacement', () => {
    const line = 'Mara '.padEnd(1000, 'z').repeat(5000);
    expect(line.length).toBe(5_000_000);
    const t0 = performance.now();
    const plan = planReplace(line, { query: '(Mara)', regex: true, replacement: '<$1>' });
    const ms = performance.now() - t0;
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.replacements).toHaveLength(5000);
    expect(plan.nextText.slice(0, 8)).toBe('<Mara> z');
    // The first tip took ~12 s here; the plan's no-progress watchdog is 2 s.
    expect(ms).toBeLessThan(2000);
  });

  it('expands every token exactly as native String.prototype.replace does on that line', () => {
    const line = 'say Mara Vey now';
    const query = '(?<first>M\\w+) (V\\w+)';
    for (const replacement of ['$2, $1', '$<first>!', '[$&]', '$$1', "$`|$'", '$3$0$<nope>', '$', '$$$']) {
      const plan = planReplace(line, { query, regex: true, matchCase: true, replacement });
      if ('error' in plan) throw new Error(plan.error);
      expect(plan.nextText).toBe(line.replace(new RegExp(query, 'mu'), replacement));
    }
  });

  it('treats a lone CR as a line ending, so no match spans a CR-only line break', () => {
    expect(planMatches('a\rb', { query: 'a\\sb', regex: true }).matches).toEqual([]);
    expect(planMatches('a\rb', { query: 'a[^x]b', regex: true }).matches).toEqual([]);
    expect(planMatches('foo\rbar', { query: '^bar', regex: true }).matches).toEqual([
      { start: 4, end: 7, text: 'bar' },
    ]);
    const plan = planReplace('Mara\rMara\r\nMara\n', { query: 'Mara', replacement: 'Mira' });
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.nextText).toBe('Mira\rMira\r\nMira\n');
  });

  it('skips a replace whose result would not be NFC, with the same unusual-Unicode reason', () => {
    const text = 'x\u0301 test'; // NFC already: there is no precomposed x-acute
    expect(text.normalize('NFC')).toBe(text);
    expect(planMatches(text, { query: 'x' }).matches).toHaveLength(1);
    expect(planReplace(text, { query: 'x', replacement: 'e' })).toEqual({
      nextText: text,
      replacements: [],
      skipped: UNUSUAL_UNICODE_SKIP,
    });
  });

  it('steps over a surrogate pair when retrying after a dropped wikilink match (no endless loop)', () => {
    expect(planMatches('\u{1F600}[[x]] y', { query: '.\\[\\[x', regex: true }).matches).toEqual([]);
    expect(planMatches('\u{1F600}a[[x]] \u{1F600}a', { query: '\\p{Extended_Pictographic}a\\[?', regex: true }).matches).toEqual([
      { start: 9, end: 12, text: '\u{1F600}a' },
    ]);
  });

  it('retries one code point later when a dropped match started before the link', () => {
    expect(planMatches('ab[[c]]', { query: 'ab\\[\\[c|b', regex: true }).matches).toEqual([
      { start: 1, end: 2, text: 'b' },
    ]);
  });

  it('keeps a match that only touches a link edge without overlapping it', () => {
    expect(planMatches('a[[b]]', { query: 'a' }).matches).toEqual([{ start: 0, end: 1, text: 'a' }]);
    expect(planMatches('[[b]]a', { query: 'a' }).matches).toEqual([{ start: 5, end: 6, text: 'a' }]);
  });

  it('documents that a greedy match running into a link is dropped whole, not shortened', () => {
    expect(planMatches('abc [[x]] def', { query: '.+', regex: true }).matches).toEqual([
      { start: 9, end: 13, text: ' def' },
    ]);
  });

  it('skips wikilinks in regex mode too unless includeWikilinks is set', () => {
    const text = 'See [[Mara]] here';
    expect(planMatches(text, { query: '\\[\\[Mara\\]\\]', regex: true }).matches).toEqual([]);
    expect(
      planMatches(text, { query: '\\[\\[Mara\\]\\]', regex: true, includeWikilinks: true }).matches,
    ).toEqual([{ start: 4, end: 12, text: '[[Mara]]' }]);
  });

  it('refuses a pattern that matches empty text for every file, even text where it never fires', () => {
    expect(planMatches('abc', { query: '^$', regex: true })).toEqual({ matches: [], error: EMPTY_MATCH_ERROR });
    expect(compileMatcher({ query: '^$', regex: true })).toEqual({ error: EMPTY_MATCH_ERROR });
  });

  it('lets a literal query contain a backslash followed by n or r', () => {
    expect(planMatches('C:\\new\\raw', { query: '\\new' }).matches).toEqual([{ start: 2, end: 6, text: '\\new' }]);
    expect(planMatches('C:\\new\\raw', { query: '\\raw' }).matches).toHaveLength(1);
  });

  it('counts UTF-8 bytes exactly at every encoding-width boundary', () => {
    const accepts = (q: string) => planMatches('x', { query: q, matchCase: true }).error !== QUERY_TOO_LONG_ERROR;
    expect(accepts('\u007f'.repeat(1024))).toBe(true);
    expect(accepts('\u007f'.repeat(1025))).toBe(false);
    expect(accepts('\u0080'.repeat(512))).toBe(true);
    expect(accepts('\u0080'.repeat(513))).toBe(false);
    expect(accepts('\u07ff'.repeat(512))).toBe(true);
    expect(accepts('\u07ff'.repeat(513))).toBe(false);
    expect(accepts('\u0800'.repeat(341) + 'a')).toBe(true);
    expect(accepts('\u0800'.repeat(342))).toBe(false);
    expect(accepts('\u{10000}'.repeat(256))).toBe(true);
    expect(accepts('\u{10000}'.repeat(257))).toBe(false);
    expect(accepts('\u{1F600}'.repeat(256))).toBe(true);
    expect(accepts('\u{1F600}'.repeat(256) + 'a')).toBe(false);
  });

  it('refuses a replacement that is over the cap raw even though its NFC form fits', () => {
    const nfd = 'e\u0301'.repeat(4000); // 12,000 bytes raw, 8,000 bytes as NFC
    expect(planReplace('a', { query: 'a', replacement: nfd })).toEqual({ error: REPLACEMENT_TOO_LONG_ERROR });
  });

  it('caps with maxMatches 0 and fractions, and treats negative or NaN as no cap', () => {
    const text = 'a a a';
    expect(planMatches(text, { query: 'a', maxMatches: 0 })).toEqual({ matches: [], truncated: true });
    expect(planMatches(text, { query: 'a', maxMatches: 1.5 }).matches).toHaveLength(1);
    expect(planMatches(text, { query: 'a', maxMatches: 1.5 }).truncated).toBe(true);
    expect(planMatches(text, { query: 'a', maxMatches: -1 })).toEqual(planMatches(text, { query: 'a' }));
    expect(planMatches(text, { query: 'a', maxMatches: Number.NaN })).toEqual(planMatches(text, { query: 'a' }));
    expect(planMatches('b', { query: 'a', maxMatches: 0 })).toEqual({ matches: [] });
  });

  it('refuses negative, fractional and NaN replacement offsets', () => {
    const r = (start: number, end: number): Replacement => ({ start, end, text: 'a', replacement: 'X' });
    for (const bad of [r(-3, 1), r(0.5, 1), r(0, 1.5), r(Number.NaN, 1), r(0, Number.NaN)]) {
      expect(applyReplacements('abc', [bad])).toEqual({ error: 'replacement range is out of bounds' });
    }
  });

  it('closes frontmatter only on a line that is exactly --- (plus trailing spaces or tabs)', () => {
    const text = '---\ntitle: x\n----\n---foo\n--- \t\nbody';
    expect(frontmatterRange(text)).toEqual({ start: 0, end: text.indexOf('\nbody') });
    expect(frontmatterRange('---\na\n----\nb')).toBeNull();
    expect(frontmatterRange('---\na\n---foo\nb')).toBeNull();
    // Same closer grammar as vaultGraph.ts ([ \t]*): other whitespace does not close.
    expect(frontmatterRange('---\na\n---\u00a0\nb')).toBeNull();
    expect(frontmatterRange('---\na\n---\f\nb')).toBeNull();
  });

  it('never lets a wikilink span cross a line break', () => {
    expect(wikilinkRanges('[[a\nb]]')).toEqual([]);
  });
});
