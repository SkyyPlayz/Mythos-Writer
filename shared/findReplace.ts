// FIND-REPLACE S1: pure match + replace planning; never does I/O.
//
// Implements plan R9 (briefs/PLAN-FIND-REPLACE.md, "Matcher semantics").
// This module has no imports, no side effects and no shared state, so the
// replace worker (S2) can run it off the main thread and the apply step can
// re-run it with the same frozen options: preview == apply by construction.
//
// Public API
//   planMatches(text, options)                 -> MatchPlan
//   planReplace(text, options, selection?)     -> ReplacePlan
//   applyReplacements(text, replacements)      -> { nextText } | { error }
//   compileMatcher, escapeRegExpLiteral, wrapWholeWord,
//   frontmatterRange, wikilinkRanges           (building blocks, also used by tests)
//
// Offsets are UTF-16 code-unit indexes into `text` (end exclusive), the same
// units String.prototype.slice uses. Callers strip a leading UTF-8 BOM before
// calling. Offsets are relative to that stripped text. This module neither
// strips nor restores a BOM; S2 must restore it on write (SECURITY §Encoding bar).
//
// Semantics
// - Engine: JS RegExp, flags `g` `m` `u` always, plus `i` when Match case is
//   off. Never `s`, so `.` does not cross a line break.
// - Literal mode escapes the query; regex mode compiles it as typed.
//   Invalid regex -> { error: 'Invalid pattern: …' } and no scan. The user's
//   pattern is validated on its own before any wrapping, so Whole word can't
//   turn an invalid pattern into a different valid one.
// - Whole word wraps the pattern in a Unicode boundary,
//   (?<![\p{L}\p{N}_])(?:…)(?![\p{L}\p{N}_]), not \b (\b is ASCII-only).
// - Matching is per line. Lines end at '\r\n', '\n' or a lone '\r' (the
//   CommonMark line endings); the ending is never part of a line, so every
//   line-ending byte is kept and `$` anchors before it. No match spans two
//   lines; lookbehind does not see the previous line. A query containing CR
//   or LF, or a regex naming \n or \r (unescaped `\n` / `\r`, even inside a
//   class such as [^\n]), is refused: per line it is either dead or redundant.
// - Query and replacement are NFC-normalized. A file whose text is not NFC is
//   skipped and reported 'unusual Unicode, skipped' (no offset remapping in
//   v1). Input errors are reported before that per-file skip. A replace whose
//   result would not be NFC (e.g. a combining mark meeting a new base letter)
//   is skipped with the same reason, so the matcher never writes a file it
//   would then refuse to search.
// - Case folding is the JS default (simple Unicode case folding under `iu`,
//   no locale). Turkish dotted/dotless i is NOT special-cased: 'i' matches
//   'i' and 'I' only, never 'İ' (U+0130) or 'ı' (U+0131).
// - Matches are non-overlapping, left to right. Any zero-length match is
//   refused with 'pattern matches empty text'. A pattern that matches '' is
//   refused for every file ('^', 'a*'); one that only matches empty text in
//   some context ('(?<=a)') is refused for the files where that context occurs.
// - Zones: the leading frontmatter block (line 0 is exactly '---', closed by
//   the next line matching /^---[ \t]*$/, as vaultGraph.ts reads it) is not
//   searched unless includeFrontmatter is set. [[wikilink]] spans (same
//   grammar as wikiLinkRename.ts) are skipped unless includeWikilinks is set,
//   in literal and regex mode alike ("plain mode" is plain replace as opposed
//   to S3's rename): a match that overlaps a span is dropped and the scan
//   retries one code point after its start (or after the span, when the
//   match starts inside it). An empty `---`/`---` block counts as
//   frontmatter, so nothing in it is ever edited by accident.
// - Replacement tokens (regex mode only): $1..$99, $<name>, $&, $$, expanded
//   by the engine's own GetSubstitution through RegExp.prototype[@@replace],
//   the same code String.prototype.replace runs (no custom token parser),
//   fed the captures the scan found. Native $` and $' also work and refer to
//   the match's line. Literal mode inserts the replacement verbatim.
// - Input caps: query <= 1 KB and replacement <= 10 KB, in UTF-8 bytes. The
//   S2 IPC schema re-checks them; this module refuses oversize input itself.
// - Replace plans list replacements in DESCENDING start order, so applying
//   them one at a time in list order keeps every remaining offset valid.

export const MAX_QUERY_BYTES = 1024;
export const MAX_REPLACEMENT_BYTES = 10 * 1024;

export const UNUSUAL_UNICODE_SKIP = 'unusual Unicode, skipped' as const;
export const EMPTY_MATCH_ERROR = 'pattern matches empty text';
export const EMPTY_QUERY_ERROR = 'Enter text to find';
export const QUERY_TOO_LONG_ERROR = 'Search text is too long (max 1 KB)';
export const REPLACEMENT_TOO_LONG_ERROR = 'Replacement text is too long (max 10 KB)';
export const MULTILINE_QUERY_ERROR = 'Search works one line at a time; remove the line break';
export const BROKEN_TEXT_ERROR = 'Text contains a broken character';
export const INVALID_PATTERN_PREFIX = 'Invalid pattern';

export interface FindOptions {
  /** Text or regex source to find. NFC-normalized before use. */
  query: string;
  /** Default false: case-insensitive (`i`). */
  matchCase?: boolean;
  /** Default false. Unicode letter/number/underscore boundary. */
  wholeWord?: boolean;
  /** Default false: the query is a literal string. */
  regex?: boolean;
  /** Default false: the leading `---` frontmatter block is not searched. */
  includeFrontmatter?: boolean;
  /** Default false: `[[...]]` spans are not searched. */
  includeWikilinks?: boolean;
  /** Stop after this many matches and set `truncated`. */
  maxMatches?: number;
}

export interface ReplaceOptions extends FindOptions {
  /** Inserted as typed (literal mode) or expanded with native `$` tokens (regex mode). NFC-normalized. */
  replacement: string;
}

export interface MatchRange {
  start: number;
  end: number;
}

export interface Match extends MatchRange {
  /** Always `text.slice(start, end)`. */
  text: string;
}

export interface Replacement extends Match {
  /** The text that replaces `text`, tokens already expanded. */
  replacement: string;
}

export type SkipReason = typeof UNUSUAL_UNICODE_SKIP;

export interface MatchPlan {
  /** Ascending, non-overlapping, never zero-length. Empty when `error` or `skipped` is set. */
  matches: Match[];
  error?: string;
  skipped?: SkipReason;
  truncated?: boolean;
}

export type ReplacePlan =
  | {
      nextText: string;
      /** Descending start order. */
      replacements: Replacement[];
      skipped?: SkipReason;
      truncated?: boolean;
    }
  | { error: string };

// --- building blocks -------------------------------------------------------

// ES SyntaxCharacter only: escaping anything else (e.g. '-') is a
// SyntaxError under the `u` flag.
const SYNTAX_CHARACTER_RE = /[\\^$.*+?()[\]{}|]/g;

export function escapeRegExpLiteral(s: string): string {
  return s.replace(SYNTAX_CHARACTER_RE, '\\$&');
}

export function wrapWholeWord(source: string): string {
  return `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
}

// Same span grammar as shared/wikiLinkRename.ts WIKI_LINK_RE: the inner part
// has no brackets and no newline. An embed's leading '!' sits outside.
const WIKI_LINK_RE = /\[\[[^\][\n]+\]\]/g;

/** `[[...]]` spans in one line (or any text), ascending and non-overlapping. */
export function wikilinkRanges(line: string): MatchRange[] {
  const out: MatchRange[] = [];
  WIKI_LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKI_LINK_RE.exec(line)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

const FRONTMATTER_CLOSE_RE = /^---[ \t]*$/;

/**
 * The leading frontmatter block: from offset 0 to the end of the closing
 * `---` line's content (its line break is not included). Null when the text
 * does not start with a `---` line or the block is never closed.
 */
export function frontmatterRange(text: string): MatchRange | null {
  const lines = lineSpans(text);
  const first = lines.next();
  if (first.done || text.slice(first.value.start, first.value.end) !== '---') return null;
  for (const span of lines) {
    if (FRONTMATTER_CLOSE_RE.test(text.slice(span.start, span.end))) {
      return { start: 0, end: span.end };
    }
  }
  return null;
}

// An unescaped \n or \r escape: an odd run of backslashes before n / r.
const NEWLINE_ESCAPE_RE = /(?<!\\)(?:\\\\)*\\[nr]/;
// Under `u`, a paired surrogate is one code point; this only hits lone halves.
const LONE_SURROGATE_RE = /[\uD800-\uDFFF]/u;

function utf8Bytes(s: string): number {
  // Counted without allocating: 1 byte < U+0080, 2 < U+0800, 4 for a
  // surrogate pair, else 3. Lone surrogates are refused before this matters.
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4;
        i++;
      } else n += 3;
    } else n += 3;
  }
  return n;
}

function checkQuery(raw: string, regex: boolean): { query: string } | { error: string } {
  if (raw.length === 0) return { error: EMPTY_QUERY_ERROR };
  if (LONE_SURROGATE_RE.test(raw)) return { error: BROKEN_TEXT_ERROR };
  if (utf8Bytes(raw) > MAX_QUERY_BYTES) return { error: QUERY_TOO_LONG_ERROR };
  const query = raw.normalize('NFC');
  if (utf8Bytes(query) > MAX_QUERY_BYTES) return { error: QUERY_TOO_LONG_ERROR };
  if (/[\r\n]/.test(query)) return { error: MULTILINE_QUERY_ERROR };
  if (regex && NEWLINE_ESCAPE_RE.test(query)) return { error: MULTILINE_QUERY_ERROR };
  return { query };
}

function checkReplacement(raw: string): { replacement: string } | { error: string } {
  if (LONE_SURROGATE_RE.test(raw)) return { error: BROKEN_TEXT_ERROR };
  if (utf8Bytes(raw) > MAX_REPLACEMENT_BYTES) return { error: REPLACEMENT_TOO_LONG_ERROR };
  const replacement = raw.normalize('NFC');
  if (utf8Bytes(replacement) > MAX_REPLACEMENT_BYTES) return { error: REPLACEMENT_TOO_LONG_ERROR };
  return { replacement };
}

function invalidPattern(err: unknown): string {
  const msg = err instanceof Error ? err.message : '';
  // V8: "Invalid regular expression: /src/flags: Reason". Keep only the
  // reason so the inline error doesn't echo the whole pattern back.
  const reason = msg.slice(msg.lastIndexOf(': ') + 2).trim();
  return reason && reason !== msg ? `${INVALID_PATTERN_PREFIX}: ${reason}` : INVALID_PATTERN_PREFIX;
}

/**
 * Validate the query and build the RegExp. Flags are `gmu`, plus `i` when
 * matchCase is off. A pattern that can match the empty string is refused.
 */
export function compileMatcher(options: FindOptions): { regex: RegExp } | { error: string } {
  const regexMode = options.regex === true;
  const checked = checkQuery(options.query, regexMode);
  if ('error' in checked) return checked;
  let source = regexMode ? checked.query : escapeRegExpLiteral(checked.query);
  const flags = options.matchCase === true ? 'gmu' : 'gimu';
  let regex: RegExp;
  try {
    // Compile the pattern alone first: wrapped, an unbalanced '[' or ')'
    // could swallow or close the wrapper and still compile.
    regex = new RegExp(source, flags);
    if (options.wholeWord === true) {
      source = wrapWholeWord(source);
      regex = new RegExp(source, flags);
    }
  } catch (err) {
    return { error: invalidPattern(err) };
  }
  regex.lastIndex = 0;
  if (regex.test('')) return { error: EMPTY_MATCH_ERROR };
  regex.lastIndex = 0;
  return { regex };
}

// --- scanning --------------------------------------------------------------

interface LineSpan {
  /** Offset of the line's first code unit. */
  start: number;
  /** Offset just past the line's content (before its '\r\n', '\n' or '\r'). */
  end: number;
}

function* lineSpans(text: string): Generator<LineSpan> {
  const eol = /\r\n?|\n/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = eol.exec(text)) !== null) {
    yield { start, end: m.index };
    start = m.index + m[0].length;
  }
  yield { start, end: text.length };
}

function nextCodePointIndex(s: string, i: number): number {
  const c = s.charCodeAt(i);
  if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
    const d = s.charCodeAt(i + 1);
    if (d >= 0xdc00 && d <= 0xdfff) return i + 2;
  }
  return i + 1;
}

interface LineMatch {
  /** Line content the match was found in (line ending stripped). */
  line: string;
  /** Offset of `line` in the full text. */
  lineStart: number;
  /** Match bounds inside `line`. */
  start: number;
  end: number;
  /** The engine's match result (captures, groups), for token expansion. */
  exec: RegExpExecArray;
}

type ScanResult =
  | { found: LineMatch[]; truncated: boolean; skipped?: undefined }
  | { error: string }
  | { skipped: SkipReason };

function scan(text: string, options: FindOptions): ScanResult {
  const compiled = compileMatcher(options);
  if ('error' in compiled) return compiled;
  if (text.normalize('NFC') !== text) return { skipped: UNUSUAL_UNICODE_SKIP };

  const re = compiled.regex;
  // A non-negative number caps the result (fractions round down); anything
  // else, including NaN and negatives, means no cap.
  const limit =
    typeof options.maxMatches === 'number' && options.maxMatches >= 0
      ? Math.floor(options.maxMatches)
      : Infinity;
  const fm = options.includeFrontmatter === true ? null : frontmatterRange(text);
  const found: LineMatch[] = [];

  for (const span of lineSpans(text)) {
    if (fm !== null && span.start < fm.end) continue;
    const line = text.slice(span.start, span.end);
    const blocked = options.includeWikilinks === true ? [] : wikilinkRanges(line);
    let b = 0;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (end === start) return { error: EMPTY_MATCH_ERROR };
      while (b < blocked.length && blocked[b].end <= start) b++;
      if (b < blocked.length && blocked[b].start < end) {
        // Touches a wikilink span. A match starting inside the span can't
        // be kept, so jump past it; one starting before it may still have a
        // valid match a little further on, so retry one code point later.
        re.lastIndex =
          start >= blocked[b].start ? blocked[b].end : nextCodePointIndex(line, start);
        continue;
      }
      // Truncated means a real match was left out, not "hit the number".
      if (found.length >= limit) return { found, truncated: true };
      found.push({ line, lineStart: span.start, start, end, exec: m });
    }
  }
  return { found, truncated: false };
}

/** Every match of `options.query` in `text`, ascending. */
export function planMatches(text: string, options: FindOptions): MatchPlan {
  const result = scan(text, options);
  if ('error' in result) return { matches: [], error: result.error };
  if (result.skipped !== undefined) return { matches: [], skipped: result.skipped };
  const matches = result.found.map(({ lineStart, start, end, exec }) => ({
    start: lineStart + start,
    end: lineStart + end,
    text: exec[0],
  }));
  return result.truncated ? { matches, truncated: true } : { matches };
}

// The engine's own replace algorithm (GetSubstitution included). Called on a
// stand-in "regex" whose exec hands back the match the scan already found,
// so expansion never re-runs the user's pattern.
const nativeRegExpReplace = RegExp.prototype[Symbol.replace] as unknown as (
  this: object,
  subject: string,
  replacement: string,
) => string;

// $` and $' copy the text around the match, so only they need the whole
// line as the subject; every other token needs just the match itself.
// Over-matching here (e.g. "$$`") only costs speed, never correctness.
const CONTEXT_TOKEN_RE = /\$[`']/;

/**
 * Expand `replacement` for one regex match with native token handling.
 * Cost is O(match + replacement) unless it uses $` or $', which cost
 * O(line) per match as they must copy the line.
 */
function expandRegexReplacement(found: LineMatch, replacement: string): string {
  const { exec, line, start, end } = found;
  const withContext = CONTEXT_TOKEN_RE.test(replacement);
  const subject = withContext ? line : exec[0];
  const result = Object.assign(Array.from(exec), {
    index: withContext ? start : 0,
    input: subject,
    groups: exec.groups,
  });
  const standIn = {
    flags: '',
    global: false,
    unicode: true,
    lastIndex: 0,
    exec: () => result,
  };
  const out = nativeRegExpReplace.call(standIn, subject, replacement);
  return withContext ? out.slice(start, out.length - (line.length - end)) : out;
}

/**
 * Plan the replacement of every match (or of the `selection` subset, by
 * exact start/end; entries that match nothing are ignored). Does not write
 * anything: `nextText` is the file text with the plan applied.
 */
export function planReplace(
  text: string,
  options: ReplaceOptions,
  selection?: readonly MatchRange[],
): ReplacePlan {
  const checkedReplacement = checkReplacement(options.replacement);
  const result = scan(text, options);
  if ('error' in result) return { error: result.error };
  if ('error' in checkedReplacement) return { error: checkedReplacement.error };
  if (result.skipped !== undefined) return { nextText: text, replacements: [], skipped: result.skipped };

  const replacement = checkedReplacement.replacement;
  const ticked =
    selection === undefined ? null : new Set(selection.map((r) => `${r.start}:${r.end}`));
  // Without a '$' the native expansion is the replacement itself.
  const expand = options.regex === true && replacement.includes('$');

  const replacements: Replacement[] = [];
  for (const found of result.found) {
    const absStart = found.lineStart + found.start;
    const absEnd = found.lineStart + found.end;
    if (ticked !== null && !ticked.has(`${absStart}:${absEnd}`)) continue;
    replacements.push({
      start: absStart,
      end: absEnd,
      text: found.exec[0],
      replacement: expand ? expandRegexReplacement(found, replacement) : replacement,
    });
  }
  replacements.reverse();

  const applied = applyReplacements(text, replacements);
  if ('error' in applied) return applied;
  if (replacements.length > 0 && applied.nextText.normalize('NFC') !== applied.nextText) {
    return { nextText: text, replacements: [], skipped: UNUSUAL_UNICODE_SKIP };
  }
  return result.truncated
    ? { nextText: applied.nextText, replacements, truncated: true }
    : { nextText: applied.nextText, replacements };
}

/**
 * Apply planned replacements to `text`. Accepts any order; refuses entries
 * that are out of range, zero-length, overlapping, or stale (the text at
 * their range is no longer `r.text`). Linear in text + output size.
 */
export function applyReplacements(
  text: string,
  replacements: readonly Replacement[],
): { nextText: string } | { error: string } {
  const sorted = [...replacements].sort((a, b) => a.start - b.start);
  const parts: string[] = [];
  let cursor = 0;
  for (const r of sorted) {
    if (
      !Number.isInteger(r.start) ||
      !Number.isInteger(r.end) ||
      r.start < 0 ||
      r.end > text.length ||
      r.end <= r.start
    ) {
      return { error: 'replacement range is out of bounds' };
    }
    if (r.start < cursor) return { error: 'replacement ranges overlap' };
    if (text.slice(r.start, r.end) !== r.text) return { error: 'text changed since preview' };
    parts.push(text.slice(cursor, r.start), r.replacement);
    cursor = r.end;
  }
  parts.push(text.slice(cursor));
  return { nextText: parts.join('') };
}
