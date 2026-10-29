// Prism (#1764) — the rule engine. Pure, deterministic English-prose checks
// over plain paragraph text: no AI, no network, no DOM. The editor extension
// extracts paragraphs, calls runPrismRules, and turns findings into
// decorations; the checklist lists them.
//
// Precision beats recall: a false positive annoys a writer far more than a
// missed adverb, so every rule leans toward staying quiet when unsure.
//
// All offsets are half-open string offsets into `paragraphs[i].text`. U+FFFC
// (an inline atom such as a wiki link) is never part of a word.

import type {
  PrismCheckId,
  PrismFinding,
  PrismParagraph,
  PrismResult,
  PrismStats,
  PrismThresholds,
} from './types';

type Span = readonly [number, number];

interface Token {
  text: string;
  lower: string;
  para: number;
  from: number;
  to: number;
  /** Global index in Analysis.tokens. */
  index: number;
  /** Contains at least one letter (not just digits). */
  alpha: boolean;
  /** First word of a sentence, or the first word after an opening quote/bracket. */
  start: boolean;
}

interface Sentence {
  para: number;
  /** Trimmed [from, to) offsets in the paragraph text. */
  from: number;
  to: number;
  /** Global token indices [first, end). Always at least one word. */
  first: number;
  end: number;
  /** Opens on an inline atom (a mention such as "[[Elena]] nodded."), not on its first word. */
  atomStart: boolean;
}

interface Analysis {
  paragraphs: readonly PrismParagraph[];
  /** Lowercase forms of every word used lowercase somewhere in the scene (built on first use). */
  lowercaseUses?: ReadonlySet<string>;
  tokens: Token[];
  /** paraStart[p] .. paraStart[p + 1] are the tokens of paragraph p. */
  paraStart: number[];
  sentences: Sentence[];
  /** Dialogue spans per paragraph, quotes included. */
  dialogue: Span[][];
}

// ---------------------------------------------------------------------------
// Word lists

function wordSet(words: string): ReadonlySet<string> {
  return new Set(words.split(' '));
}

const STOPWORDS = wordSet(
  'about above across after again against almost along already also although always among another anyone anything ' +
    'anyway anywhere around away back because been before behind being below beneath beside besides between beyond both ' +
    'cannot could does doing done down during each either else enough even ever every everyone everything everywhere ' +
    'from further gets getting going gone have having hence here hers herself himself however inside into itself ' +
    'just last least less like little made make many maybe might mine more most much must myself near neither never ' +
    'next none nobody nothing nowhere often once only onto other others ours ourselves over perhaps quite rather ' +
    'said same says shall should since some someone something sometimes somewhere soon still such than that their ' +
    'theirs them themselves then there these they thing things this those though through throughout thus together too ' +
    'toward towards under unless until upon very want wanted wants well went were what whatever when whenever where ' +
    'whether which while whom whose will with within without would your yours yourself yourselves asked came come ' +
    'comes else first get got know knew left right take took told yeah okay'
);

const CRUTCH_WORDS = wordSet(
  'just really very actually basically literally suddenly quite ' +
    'rather somehow simply totally definitely certainly practically seemingly'
);

/** Two-word crutch phrases, keyed by first word → second word. */
const CRUTCH_PHRASES: ReadonlyArray<readonly [string, string]> = [
  ['started', 'to'],
  ['starts', 'to'],
  ['began', 'to'],
  ['begins', 'to'],
  ['a', 'bit'],
  ['kind', 'of'],
  ['sort', 'of'],
];

/** "what kind of", "a sort of" are nouns, not hedges. */
const KIND_OF_DETERMINERS = wordSet(
  'a an the what which this that these those some any every no all ' +
    'one same different other another each his her my your our their its whatever'
);

/**
 * "a strange kind of calm": a determiner, then an adjective, then "kind of"
 * is a noun use too. Only determiners that cannot be a subject ("this is
 * kind of odd" still hedges).
 */
const KIND_OF_ADJ_DETERMINERS = wordSet(
  'a an the his her my your our their its every each no some any what which whatever another'
);

/**
 * Adjectives that make "[det] ___ kind of" a noun use. A closed list: a noun
 * in that slot ("The man kind of smiled") is still a hedge.
 */
const KIND_OF_ADJECTIVES = wordSet(
  'strange odd new different certain special weird peculiar particular similar curious funny familiar rare ' +
    'whole other same old usual unusual simple rough quiet gentle dark grim wild fierce bitter sad cold warm ' +
    'deep desperate terrible awful horrible wonderful beautiful dangerous reckless foolish childish selfish ' +
    'better worse best worst only real true right wrong distinct unique specific common ordinary ' +
    'perfect exact proper fine good bad'
);

/** Words ending in -ly that are not adverbs (adjectives, nouns, verbs, names). */
const NON_ADVERBS = wordSet(
  'family only early likely unlikely holy unholy ugly lonely friendly unfriendly lovely silly belly rally reply ' +
    'supply apply imply comply multiply fly july italy ally bully jelly curly daily weekly monthly yearly hourly ' +
    'nightly quarterly elderly costly deadly lively oily hilly chilly smelly bubbly wobbly assembly anomaly emily ' +
    'lily lilly molly sally kelly billy holly polly dolly shelly beverly kimberly homily melancholy monopoly ' +
    'butterfly dragonfly firefly gadfly housefly horsefly mayfly folly gully sully dally tally jolly golly lolly ' +
    'brolly wily surly burly portly stately comely homely lowly manly womanly worldly otherworldly earthly unearthly ' +
    'unruly orderly disorderly scholarly timely untimely cowardly fatherly motherly brotherly sisterly heavenly ' +
    'beastly ghostly ghastly sickly saintly princely queenly kingly courtly seemly unseemly shapely goodly godly ' +
    'ungodly sprightly unsightly dastardly miserly slovenly masterly neighborly neighbourly maidenly prickly ' +
    'crinkly wrinkly sparkly giggly tingly jiggly squiggly grisly grizzly drizzly measly gangly pebbly crumbly ' +
    'knobbly bristly gnarly pearly frilly woolly wooly steely leisurely bodily trolly gravelly spindly ' +
    'deathly cuddly scaly scraggly straggly wriggly underbelly potbelly panoply doily tilly milly nelly ' +
    'carly wally willy'
);

const BE_FORMS = wordSet(
  'am is are was were be been being get got gets gotten getting ' +
    "isn't isn’t aren't aren’t wasn't wasn’t weren't weren’t"
);

const PASSIVE_FILLERS = wordSet('not never also just always already still often all');

/** -ed words that usually work as adjectives after "to be" (or as nouns). */
const ED_ADJECTIVES = wordSet(
  'tired interested excited worried bored scared married used supposed pleased surprised amazed annoyed ' +
    'ashamed confused convinced delighted depressed determined disappointed disgusted embarrassed exhausted ' +
    'frightened frustrated horrified impressed involved prepared relaxed relieved satisfied shocked stressed ' +
    'terrified thrilled concerned dressed related located based situated aged beloved naked wicked sacred ' +
    'rugged ragged jagged crooked wretched learned dogged blessed alarmed amused astonished armed bearded ' +
    'talented gifted skilled detailed complicated sophisticated dedicated devoted experienced qualified limited ' +
    'crowded unexpected unprepared unconcerned uninterested unimpressed hundred kindred unarmed ' +
    'disinterested overwhelmed puzzled startled stunned bewildered intrigued fascinated agitated ' +
    'distracted exasperated irritated offended hatred bloodshed watershed seabed flowerbed riverbed ' +
    'deathbed sickbed hotbed infrared homestead'
);

const IRREGULAR_PARTICIPLES = wordSet(
  'taken given written seen done made known told found kept left held brought bought caught thought sent built ' +
    'broken chosen driven eaten fallen forgotten frozen hidden ridden shaken spoken stolen sworn thrown torn woken ' +
    'worn beaten bitten born borne bound dug fed fought hung hit hurt laid led lost meant met paid put read said ' +
    'set shot shut sold struck taught understood won drawn grown shown blown flown sewn sown begun sung rung swung ' +
    'spun stung stuck slung wrung cast cut let spread split burst forgiven forbidden overtaken undertaken awoken ' +
    'beheld bent bled bred burnt dealt dreamt heard leant learnt lent lit mown proven rebuilt rewritten sought sped ' +
    'spelt spent spilt strewn swept thrust trodden upheld withdrawn withheld wrought overcome freed agreed decreed ' +
    'guaranteed'
);

const FILTER_WORDS = wordSet(
  'saw see sees seeing seen felt feel feels feeling heard hear hears hearing noticed notice notices watched watch ' +
    'watches looked seemed seem seems realized realised realize realise wondered wonder decided knew thought smelled ' +
    'smelt tasted touched'
);

/** A determiner right before a filter word makes it a noun ("a thought", "his watch"). */
const NOUN_DETERMINERS = wordSet('a an the his her my your their our its this that no each every');

/** Showy speech verbs a reader notices. Plain tags (said, asked, whispered…) stay invisible. */
const SHOWY_TAGS = wordSet(
  'exclaimed retorted hissed growled snapped barked quipped chortled ejaculated interjected declared proclaimed ' +
    'snarled bellowed shrieked chuckled laughed giggled smirked grinned sneered scoffed spat roared howled purred ' +
    'cooed sighed intoned opined expostulated averred asserted queried implored pronounced admonished chided boomed ' +
    'thundered simpered smiled beamed grimaced ' +
    'exclaims retorts hisses growls snaps barks quips chortles interjects declares proclaims snarls bellows ' +
    'shrieks chuckles laughs giggles smirks grins sneers scoffs spits roars howls purrs coos sighs smiles beams'
);

const PLAIN_TAGS = wordSet(
  'said says say asked asks ask replied replies answered answers whispered whispers muttered mutters murmured ' +
    'murmurs shouted shouts yelled yells called calls cried cries told tells continued continues added adds ' +
    'repeated repeats'
);

/** Subject pronouns: after `!”` / `?”` a capitalised one opens a new sentence, not a tag. */
const SUBJECT_PRONOUNS = wordSet('i he she it we you they');

/**
 * Elisions an apostrophe opens ("'em", "rock 'n' roll"), lowercase only: a
 * capital is speech ("'Em, come here,' she said" names Em).
 */
const ELISIONS = wordSet('em n round');
/**
 * Elisions in any case ("'Twas the night", "'Cause I said so"): these are
 * never a word a speech opens with, so the apostrophe never opens speech.
 */
const ANY_CASE_ELISIONS = wordSet(
  'tis twas twere twill cause cos coz cuz til bout nuff scuse fraid course ello ere'
);

/** Usual sentence openers: a single capital before one of these ends a sentence ("an A. Then"). */
const SENTENCE_OPENERS = wordSet(
  'the a an i he she it they we you then but and so or there this that these those his her my our ' +
    'your their its when after before now if as at in on what why how where who no yes still yet ' +
    'once later soon meanwhile again here not maybe perhaps nobody everyone everybody someone ' +
    'somebody something nothing everything even only just neither nor both all none'
);

/** Very common openers need three in a row before they read as repetitive. */
const COMMON_STARTS = wordSet('the i he she it they then we you a');

/** Abbreviations whose trailing dot never ends a sentence. */
const ABBREVIATIONS = wordSet(
  'mr mrs ms mx dr st vs e.g i.e jr sr prof mt capt col gen lt sgt rev fr messrs cf'
);

// ---------------------------------------------------------------------------
// Character helpers

const WORD_RE = /[\p{L}\p{M}\p{N}]+(?:['’\u2010-][\p{L}\p{M}\p{N}]+)*/gu;
const HAS_LETTER_RE = /\p{L}/u;

function isSpace(c: string | undefined): boolean {
  if (c === undefined) return false;
  const code = c.charCodeAt(0);
  return (
    code === 0x20 ||
    (code >= 0x09 && code <= 0x0d) ||
    code === 0xa0 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

const isTerminator = (c: string | undefined) => c === '.' || c === '!' || c === '?' || c === '…';
const isCloser = (c: string | undefined) =>
  c === '”' || c === '"' || c === '’' || c === "'" || c === ')' || c === ']' || c === '»';
const isOpener = (c: string | undefined) =>
  c === '“' || c === '"' || c === '‘' || c === "'" || c === '(' || c === '[' || c === '«';
const isLowerLetter = (c: string | undefined) =>
  c !== undefined && c !== c.toUpperCase() && c === c.toLowerCase();
const isUpperLetter = (c: string | undefined) => c !== undefined && c !== c.toLowerCase();
const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
const WORD_CHAR_RE = /[\p{L}\p{M}\p{N}'’]/u;
const isWordChar = (c: string | undefined) => c !== undefined && WORD_CHAR_RE.test(c);
const LETTER_OR_DIGIT_RE = /[\p{L}\p{N}]/u;

function onlySpaceBetween(text: string, from: number, to: number): boolean {
  if (to <= from) return false;
  for (let i = from; i < to; i++) if (!isSpace(text[i])) return false;
  return true;
}

function hasTerminatorOrQuote(text: string, from: number, to: number): boolean {
  for (let i = from; i < to; i++) {
    const c = text[i];
    if (isTerminator(c) || c === '“' || c === '”' || c === '"') return true;
  }
  return false;
}

function isAdverbWord(lower: string): boolean {
  if (lower.length < 5 || !lower.endsWith('ly') || NON_ADVERBS.has(lower) || /[\d'’]/.test(lower))
    return false;
  // "pot-belly": a compound is judged by its last part.
  const dash = Math.max(lower.lastIndexOf('-'), lower.lastIndexOf('\u2010'));
  return dash < 0 || !NON_ADVERBS.has(lower.slice(dash + 1));
}

/** Capitalised and not plainly a sentence-initial adverb: a name ("Carly said"), not "-ly". */
function isNameLike(a: Analysis, tok: Token): boolean {
  if (!isUpperLetter(tok.text[0])) return false;
  if (!tok.start) return true;
  if (!a.lowercaseUses) {
    const uses = new Set<string>();
    for (const t of a.tokens) if (isLowerLetter(t.text[0])) uses.add(t.lower);
    a.lowercaseUses = uses;
  }
  return !a.lowercaseUses.has(tok.lower);
}

/** Lemma-ish key for repetition: lowercase with a possessive 's stripped. */
function lemma(lower: string): string {
  return lower.endsWith("'s") || lower.endsWith('’s') ? lower.slice(0, -2) : lower;
}

/** Whether [from, to) lies inside one of `spans` (sorted, non-overlapping): a binary search. */
function inSpans(spans: readonly Span[], from: number, to: number): boolean {
  let lo = 0;
  let hi = spans.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid][0] <= from) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && to <= spans[lo - 1][1];
}

function quoted(s: string): string {
  return `‘${s}’`;
}

// ---------------------------------------------------------------------------
// Analysis: tokens, sentences and dialogue spans, built once per run.

function splitSentences(text: string): Span[] {
  const out: Span[] = [];
  const len = text.length;
  let start = 0;
  let i = 0;
  while (i < len) {
    if (!isTerminator(text[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < len && isTerminator(text[j])) j++;
    let k = j;
    while (k < len && isCloser(text[k])) k++;
    // "3.14", "?!x" — punctuation glued to the next character is not an end.
    if (k < len && !isSpace(text[k])) {
      i = j;
      continue;
    }
    if (j - i === 1 && text[i] === '.' && isAbbreviationBefore(text, i)) {
      i = j;
      continue;
    }
    let n = k;
    while (n < len && isSpace(text[n])) n++;
    let m = n;
    while (m < len && isOpener(text[m])) m++;
    // `“Wait!” she said.` and `etc. and` continue the sentence.
    if (m < len && isLowerLetter(text[m])) {
      i = k;
      continue;
    }
    // A stammer: "I... I... I don't know." is one sentence.
    if (isEllipsis(text, i, j) && k === j && sameWordAround(text, i, m)) {
      i = k;
      continue;
    }
    out.push([start, k]);
    start = n;
    i = n;
  }
  if (start < len) out.push([start, len]);
  return out;
}

/** The terminator run [i, j) is an ellipsis ("..." or "…"). */
function isEllipsis(text: string, i: number, j: number): boolean {
  for (let x = i; x < j; x++) if (text[x] === '…') return true;
  return j - i >= 3 && text[j - 1] === '.' && text[j - 2] === '.' && text[j - 3] === '.';
}

/** The word ending at `end` equals (case-insensitively) the word starting at `start`. */
function sameWordAround(text: string, end: number, start: number): boolean {
  let b = end;
  while (b > 0 && isWordChar(text[b - 1])) b--;
  let e = start;
  while (e < text.length && isWordChar(text[e])) e++;
  return (
    b < end &&
    e - start === end - b &&
    text.slice(b, end).toLowerCase() === text.slice(start, e).toLowerCase()
  );
}

function isAbbreviationBefore(text: string, dot: number): boolean {
  let s = dot;
  while (s > 0 && !isSpace(text[s - 1]) && !isOpener(text[s - 1])) s--;
  const w = text.slice(s, dot);
  if (w.length === 1 && isUpperLetter(w)) return isInitial(text, s, dot);
  return ABBREVIATIONS.has(w.toLowerCase());
}

const INITIAL_RE = /^\p{Lu}\.$/u;
const LEADING_WORD_RE = /^[\p{L}\p{M}'’]+/u;

/** "a"/"an" before a single capital make it a letter or grade ("an A"), not an initial. */
const LETTER_ARTICLES = wordSet('a an');

/**
 * A single capital before a full stop is an initial ("J. R. Tolkien", "John F.
 * Kennedy") when the word before it is capitalised or an initial, or the next
 * word is an initial or a capitalised word that is not a usual sentence opener.
 * "He got an A. Then he left." is two sentences. The pronoun "I" ends a
 * sentence ("So did I. Marcus left.") unless an initial or a capitalised
 * non-opener comes before it, or an initial follows ("Isaac I. Newton").
 */
function isInitial(text: string, s: number, dot: number): boolean {
  const pronoun = text[s] === 'I';
  let pe = s;
  while (pe > 0 && (isSpace(text[pe - 1]) || isOpener(text[pe - 1]))) pe--;
  let ps = pe;
  while (ps > 0 && !isSpace(text[ps - 1])) ps--;
  let prevWord = '';
  if (ps < pe) {
    const prev = text.slice(ps, pe);
    if (INITIAL_RE.test(prev)) return true;
    const letter = prev.search(/\p{L}/u);
    const word = letter >= 0 ? LEADING_WORD_RE.exec(prev.slice(letter)) : null;
    prevWord = word ? word[0].toLowerCase() : '';
    if (
      word &&
      isUpperLetter(word[0][0]) &&
      // Only the last word before "I" counts, and a sentence opener ("Not I.") is no name.
      (!pronoun || (letter + word[0].length === prev.length && !SENTENCE_OPENERS.has(prevWord)))
    )
      return true;
  }
  let ns = dot + 1;
  while (ns < text.length && (isSpace(text[ns]) || isOpener(text[ns]))) ns++;
  let ne = ns;
  while (ne < text.length && !isSpace(text[ne])) ne++;
  const next = text.slice(ns, ne);
  if (INITIAL_RE.test(next)) return true;
  if (pronoun || LETTER_ARTICLES.has(prevWord)) return false;
  const word = LEADING_WORD_RE.exec(next);
  return word !== null && isUpperLetter(word[0][0]) && !SENTENCE_OPENERS.has(word[0].toLowerCase());
}

/** `"` after a digit is an inch or seconds mark ("12\"", "6'2\""), not an opening quote. */
function isInchMark(text: string, i: number): boolean {
  return isDigit(text[i - 1]);
}

/** `"` closing a prime pair (`6'2"`): a measurement, never a closing quote. */
function isPrimeInch(text: string, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && isDigit(text[j])) j--;
  return (
    j < i - 1 && (text[j] === "'" || text[j] === '’' || text[j] === '′') && isDigit(text[j - 1])
  );
}

const SINGLE_OPEN_AFTER = '([“"—–';
const SINGLE_CLOSE_AFTER = ',.!?;:…—–-”"';

/**
 * A single quote that opens speech: at the paragraph start or after a space
 * or an opener, directly followed by a word that is not an elision ("'em").
 */
function isSingleOpener(text: string, i: number): boolean {
  const c = text[i];
  if (c !== '‘' && c !== "'") return false;
  if (i > 0 && !isSpace(text[i - 1]) && !SINGLE_OPEN_AFTER.includes(text[i - 1])) return false;
  const next = text[i + 1];
  if (next === undefined || isSpace(next) || isDigit(next)) return false; // "the '90s"
  const word = LEADING_WORD_RE.exec(text.slice(i + 1, i + 8));
  return !(word && (ELISIONS.has(word[0]) || ANY_CASE_ELISIONS.has(word[0].toLowerCase())));
}

/**
 * A single quote that closes speech: right after the speech's own punctuation
 * (`,'` `.'` `!'`) and not followed by a letter. An apostrophe inside a word
 * ("don't") or after one ("the twins' dog") never closes.
 */
function isSingleCloser(text: string, i: number): boolean {
  const c = text[i];
  if (c !== '’' && c !== "'") return false;
  if (!SINGLE_CLOSE_AFTER.includes(text[i - 1] ?? ' ')) return false;
  const next = text[i + 1];
  return next === undefined || !LETTER_OR_DIGIT_RE.test(next);
}

const isDoubleOpener = (text: string, i: number): boolean =>
  text[i] === '“' || (text[i] === '"' && !isInchMark(text, i));

/** Index of the closer of the double quote opening at `i`, searched before `limit`; -1 if none. */
function doubleCloserOf(text: string, i: number, limit: number): number {
  let j = i + 1;
  while (j < limit && !(text[j] === '”' || (text[j] === '"' && !isPrimeInch(text, j)))) j++;
  return j < limit ? j : -1;
}

interface SingleQuoteIndex {
  /** [x]: the first single-quote closer at or after x, or -1. */
  closer: Int32Array;
  /** [x]: the first single-quote opener at or after x, or -1. */
  opener: Int32Array;
  /** [x]: the first double-quote opener at or after x, or -1. */
  double: Int32Array;
}

function buildSingleQuoteIndex(text: string): SingleQuoteIndex {
  const len = text.length;
  const closer = new Int32Array(len + 1);
  const opener = new Int32Array(len + 1);
  const double = new Int32Array(len + 1);
  closer[len] = opener[len] = double[len] = -1;
  for (let x = len - 1; x >= 0; x--) {
    closer[x] = isSingleCloser(text, x) ? x : closer[x + 1];
    opener[x] = isSingleOpener(text, x) ? x : opener[x + 1];
    double[x] = isDoubleOpener(text, x) ? x : double[x + 1];
  }
  return { closer, opener, double };
}

/**
 * Top-level speech spans, quotes included, sorted and non-overlapping. Double
 * quotes pair as they come; single quotes (UK style) pair only opener with
 * closer, so apostrophes never start or end speech. Quotes nested inside the
 * other kind belong to the outer span.
 */
function dialogueSpans(text: string): Span[] {
  const spans: Span[] = [];
  const len = text.length;
  // Built only when the paragraph has a single-quote opener at all.
  let index: SingleQuoteIndex | null = null;
  /**
   * The closer of the single quote opening at `i`, or -1 when it has none:
   * single quotes do not nest at the top level, so another opener before the
   * closer means this one never closed; and a closer inside a double-quoted
   * span that opens later belongs to that span ("the so-called ‘experts’
   * argued. “He said ‘no,’ ”"). A double span that closes first is nested
   * speech (UK style ‘He said “no,” then left,’).
   */
  const singleCloseOf = (i: number): { close: number; blocked: boolean } => {
    const idx = index ?? (index = buildSingleQuoteIndex(text));
    const close = idx.closer[i + 1];
    if (close < 0) return { close: -1, blocked: false };
    const opener = idx.opener[i + 1];
    if (opener >= 0 && opener < close) return { close: -1, blocked: true };
    // Only doubles inside (i, close) are scanned, and the next opener bounds
    // `close`, so the work per opener stays within its own stretch of text.
    let d = idx.double[i + 1];
    while (d >= 0 && d < close) {
      const end = doubleCloserOf(text, d, close);
      if (end < 0) return { close: -1, blocked: false };
      d = idx.double[end + 1];
    }
    return { close, blocked: false };
  };
  let i = 0;
  while (i < len) {
    if (isDoubleOpener(text, i)) {
      // Unclosed speech runs to the end of the paragraph (multi-paragraph speech).
      const j = doubleCloserOf(text, i, len);
      const end = j >= 0 ? j + 1 : len;
      spans.push([i, end]);
      i = end;
      continue;
    }
    if (isSingleOpener(text, i)) {
      const { close, blocked } = singleCloseOf(i);
      if (close >= 0) {
        spans.push([i, close + 1]);
        i = close + 1;
        continue;
      }
      // Unclosed: only multi-paragraph speech, which opens its paragraph. An
      // opener cut off by a later single quote is a stray quote, not speech.
      if (!blocked && (i === 0 || onlySpaceBetween(text, 0, i))) {
        spans.push([i, len]);
        break;
      }
    }
    i++;
  }
  return spans;
}

function opensBefore(text: string, q: number, spanStarts: ReadonlySet<number>): boolean {
  const c = text[q];
  if (c === '"' || c === "'") return spanStarts.has(q);
  return isOpener(c);
}

function analyze(paragraphs: readonly PrismParagraph[]): Analysis {
  const tokens: Token[] = [];
  const paraStart: number[] = [];
  const sentences: Sentence[] = [];
  const dialogue: Span[][] = [];
  for (let p = 0; p < paragraphs.length; p++) {
    const text = paragraphs[p].text;
    paraStart.push(tokens.length);
    const first = tokens.length;
    const spans = dialogueSpans(text);
    dialogue.push(spans);
    // A straight quote opens speech only where a speech span starts; one that
    // closes speech (`"Go," Marcus said`) or ends a word (`the twins' Hound`) does not.
    const spanStarts = new Set<number>();
    for (const [s] of spans) spanStarts.add(s);
    WORD_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WORD_RE.exec(text)) !== null) {
      const from = m.index;
      let b = from;
      while (b > 0 && isSpace(text[b - 1])) b--;
      tokens.push({
        text: m[0],
        lower: m[0].toLowerCase(),
        para: p,
        from,
        to: from + m[0].length,
        index: tokens.length,
        alpha: HAS_LETTER_RE.test(m[0]),
        start: b === 0 || opensBefore(text, b - 1, spanStarts),
      });
    }
    let t = first;
    for (const [rawFrom, rawTo] of splitSentences(text)) {
      let from = rawFrom;
      let to = rawTo;
      while (from < to && isSpace(text[from])) from++;
      while (to > from && isSpace(text[to - 1])) to--;
      while (t < tokens.length && tokens[t].from < from) t++;
      const s0 = t;
      while (t < tokens.length && tokens[t].from < to) t++;
      if (t > s0) {
        // Only quotes, brackets and atoms can sit before the first word.
        let atomStart = false;
        for (let x = from; x < tokens[s0].from; x++) if (text[x] === '\uFFFC') atomStart = true;
        if (!atomStart) tokens[s0].start = true;
        sentences.push({ para: p, from, to, first: s0, end: t, atomStart });
      }
    }
  }
  paraStart.push(tokens.length);
  return { paragraphs, tokens, paraStart, sentences, dialogue };
}

function finding(
  checkId: PrismCheckId,
  paragraph: number,
  from: number,
  to: number,
  message: string
): PrismFinding {
  return { checkId, paragraph, from, to, message };
}

/** Next token in the same paragraph, or null. */
function nextInPara(a: Analysis, tok: Token): Token | null {
  const n = a.tokens[tok.index + 1];
  return n && n.para === tok.para ? n : null;
}

function prevInPara(a: Analysis, tok: Token): Token | null {
  const n = tok.index > 0 ? a.tokens[tok.index - 1] : undefined;
  return n && n.para === tok.para ? n : null;
}

// ---------------------------------------------------------------------------
// Flag checks

function clampInt(v: number, min: number, fallback: number): number {
  return Number.isFinite(v) ? Math.max(min, Math.floor(v)) : fallback;
}

function checkOverusedWords(a: Analysis, th: PrismThresholds): PrismFinding[] {
  const repeats = clampInt(th.overusedMinRepeats, 2, 3);
  const window = clampInt(th.overusedWindowWords, 1, 100);
  // A capitalised word mid-sentence is most likely a name; names repeat by
  // necessity, so the whole lemma is left alone.
  const proper = new Set<string>();
  const byLemma = new Map<string, Token[]>();
  for (const tok of a.tokens) {
    if (!tok.alpha) continue;
    const key = lemma(tok.lower);
    if (!tok.start && isUpperLetter(tok.text[0])) proper.add(key);
    if (key.length < 4 || STOPWORDS.has(key) || key.includes("'") || key.includes('’')) continue;
    let list = byLemma.get(key);
    if (!list) byLemma.set(key, (list = []));
    list.push(tok);
  }
  const out: PrismFinding[] = [];
  for (const [key, list] of byLemma) {
    if (list.length < repeats || proper.has(key)) continue;
    const marked = new Array<boolean>(list.length).fill(false);
    let i = 0;
    let markedTo = -1;
    for (let j = 0; j < list.length; j++) {
      while (list[j].index - list[i].index >= window) i++;
      if (j - i + 1 < repeats) continue;
      for (let k = Math.max(i, markedTo + 1); k <= j; k++) marked[k] = true;
      markedTo = j;
    }
    // Report each cluster of consecutive marked occurrences with its size.
    let k = 0;
    while (k < list.length) {
      if (!marked[k]) {
        k++;
        continue;
      }
      let e = k;
      while (e + 1 < list.length && marked[e + 1] && list[e + 1].index - list[e].index < window)
        e++;
      const message = `${quoted(key)} used ${e - k + 1} times close together`;
      for (let x = k; x <= e; x++)
        out.push(finding('overused-words', list[x].para, list[x].from, list[x].to, message));
      k = e + 1;
    }
  }
  return out;
}

function checkCrutchWords(a: Analysis): PrismFinding[] {
  const out: PrismFinding[] = [];
  for (const tok of a.tokens) {
    const text = a.paragraphs[tok.para].text;
    if (CRUTCH_WORDS.has(tok.lower)) {
      const prev = prevInPara(a, tok);
      const next = nextInPara(a, tok);
      // "rather than" compares; "would rather" prefers. Neither hedges.
      if (tok.lower === 'rather') {
        if (next && next.lower === 'than') continue;
        if (prev && (prev.lower === 'would' || /['’]d$/.test(prev.lower))) continue;
      }
      out.push(
        finding('crutch-words', tok.para, tok.from, tok.to, `Crutch word: ${quoted(tok.text)}`)
      );
      continue;
    }
    for (const [w1, w2] of CRUTCH_PHRASES) {
      if (tok.lower !== w1) continue;
      const next = nextInPara(a, tok);
      if (!next || next.lower !== w2 || !onlySpaceBetween(text, tok.to, next.from)) continue;
      if (w2 === 'of') {
        const prev = prevInPara(a, tok);
        if (prev && KIND_OF_DETERMINERS.has(prev.lower)) continue;
        const prev2 = prev && prevInPara(a, prev);
        if (
          prev &&
          prev2 &&
          KIND_OF_ADJ_DETERMINERS.has(prev2.lower) &&
          isLowerLetter(prev.text[0]) &&
          KIND_OF_ADJECTIVES.has(prev.lower) &&
          onlySpaceBetween(text, prev2.to, prev.from) &&
          onlySpaceBetween(text, prev.to, tok.from)
        )
          continue;
      }
      out.push(
        finding(
          'crutch-words',
          tok.para,
          tok.from,
          next.to,
          `Crutch phrase: ${quoted(text.slice(tok.from, next.to))}`
        )
      );
    }
  }
  return out;
}

function checkAdverbs(a: Analysis): PrismFinding[] {
  const out: PrismFinding[] = [];
  for (const tok of a.tokens) {
    if (!isAdverbWord(tok.lower) || CRUTCH_WORDS.has(tok.lower)) continue;
    // Capitalised mid-sentence: a name ("Beverly"), not an adverb.
    if (!tok.start && isUpperLetter(tok.text[0])) continue;
    out.push(finding('adverbs', tok.para, tok.from, tok.to, `Adverb: ${quoted(tok.text)}`));
  }
  return out;
}

function isParticiple(tok: Token): boolean {
  const lower = tok.lower;
  // Capitalised after "to be": a name ("was Alfred"), unless the whole word is shouted.
  if (isUpperLetter(tok.text[0]) && tok.text !== tok.text.toUpperCase()) return false;
  if (IRREGULAR_PARTICIPLES.has(lower)) return true;
  if (ED_ADJECTIVES.has(lower)) return false;
  return (
    lower.length >= 5 && lower.endsWith('ed') && !lower.endsWith('eed') && /^\p{L}+$/u.test(lower)
  );
}

function checkPassiveVoice(a: Analysis): PrismFinding[] {
  const out: PrismFinding[] = [];
  const toks = a.tokens;
  for (let i = 0; i < toks.length; i++) {
    const head = toks[i];
    if (!BE_FORMS.has(head.lower)) continue;
    const text = a.paragraphs[head.para].text;
    if (head.lower === 'being') {
      // "The being smiled": a noun, not a form of "to be".
      const before = prevInPara(a, head);
      if (before && NOUN_DETERMINERS.has(before.lower)) continue;
    }
    let prev = head;
    let fillers = 0;
    for (let j = i + 1; j < toks.length; j++) {
      const tok = toks[j];
      if (tok.para !== head.para || !onlySpaceBetween(text, prev.to, tok.from)) break;
      if (isParticiple(tok)) {
        const phrase = text.slice(head.from, tok.to);
        out.push(
          finding('passive-voice', head.para, head.from, tok.to, `Passive voice: ${quoted(phrase)}`)
        );
        i = j; // "was being taken" is one phrase, not two
        break;
      }
      const filler =
        PASSIVE_FILLERS.has(tok.lower) ||
        isAdverbWord(tok.lower) ||
        tok.lower === 'been' ||
        tok.lower === 'being';
      if (!filler || ++fillers > 2) break;
      prev = tok;
    }
  }
  return out;
}

function checkLongSentences(a: Analysis, th: PrismThresholds): PrismFinding[] {
  const limit = clampInt(th.longSentenceWords, 1, 30);
  const out: PrismFinding[] = [];
  for (const s of a.sentences) {
    const words = s.end - s.first;
    if (words > limit)
      out.push(finding('long-sentences', s.para, s.from, s.to, `Long sentence (${words} words)`));
  }
  return out;
}

function checkFilterWords(a: Analysis): PrismFinding[] {
  const out: PrismFinding[] = [];
  for (const tok of a.tokens) {
    if (!FILTER_WORDS.has(tok.lower)) continue;
    // Characters may say "I saw it"; only narration is flagged.
    if (inSpans(a.dialogue[tok.para], tok.from, tok.to)) continue;
    const prev = prevInPara(a, tok);
    if (prev && NOUN_DETERMINERS.has(prev.lower)) continue;
    out.push(
      finding('filter-words', tok.para, tok.from, tok.to, `Filter word: ${quoted(tok.text)}`)
    );
  }
  return out;
}

const TAG_WINDOW_WORDS = 6;

/** Index of the first token in [lo, hi) whose `from` is >= offset (binary search). */
function firstTokenFrom(tokens: readonly Token[], lo: number, hi: number, offset: number): number {
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tokens[mid].from < offset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Classify a speech verb: a showy tag, a plain tag leaning on an adverb, or a plain tag (null finding). */
function tagFinding(
  a: Analysis,
  verb: Token,
  floor: number,
  ceil: number
): PrismFinding | null | 'plain' {
  if (SHOWY_TAGS.has(verb.lower)) {
    return finding(
      'dialogue-tags',
      verb.para,
      verb.from,
      verb.to,
      `Showy dialogue tag: ${quoted(verb.text)}`
    );
  }
  if (!PLAIN_TAGS.has(verb.lower)) return null;
  const text = a.paragraphs[verb.para].text;
  const next = nextInPara(a, verb);
  if (
    next &&
    next.to <= ceil &&
    isAdverbWord(next.lower) &&
    !isNameLike(a, next) &&
    onlySpaceBetween(text, verb.to, next.from)
  ) {
    const phrase = text.slice(verb.from, next.to);
    return finding(
      'dialogue-tags',
      verb.para,
      verb.from,
      next.to,
      `Dialogue tag propped up by an adverb: ${quoted(phrase)}`
    );
  }
  const prev = prevInPara(a, verb);
  if (
    prev &&
    prev.from >= floor &&
    isAdverbWord(prev.lower) &&
    !isNameLike(a, prev) &&
    onlySpaceBetween(text, prev.to, verb.from)
  ) {
    const phrase = text.slice(prev.from, verb.to);
    return finding(
      'dialogue-tags',
      verb.para,
      prev.from,
      verb.to,
      `Dialogue tag propped up by an adverb: ${quoted(phrase)}`
    );
  }
  return 'plain';
}

function checkDialogueTags(a: Analysis): PrismFinding[] {
  const out: PrismFinding[] = [];
  const seen = new Set<string>();
  const push = (f: PrismFinding) => {
    const key = `${f.paragraph}:${f.from}:${f.to}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(f);
    }
  };
  for (let p = 0; p < a.paragraphs.length; p++) {
    const text = a.paragraphs[p].text;
    const spans = a.dialogue[p];
    const lo = a.paraStart[p];
    const hi = a.paraStart[p + 1];
    for (let si = 0; si < spans.length; si++) {
      const [s, e] = spans[si];
      const prevEnd = si > 0 ? spans[si - 1][1] : 0;
      const nextStart = si + 1 < spans.length ? spans[si + 1][0] : text.length;

      // After the quote: `“Go!” she hissed.` — only when the speech ends on
      // a comma, dash, ellipsis, ! or ? (a full stop ends the sentence).
      const closed = e - s >= 2 && '”"’\''.includes(text[e - 1]);
      const last = closed ? text[e - 2] : undefined;
      if (closed && last !== undefined && ',—–-…!?'.includes(last)) {
        let cursor = e;
        let count = 0;
        for (let t = firstTokenFrom(a.tokens, lo, hi, e); t < hi && count < TAG_WINDOW_WORDS; t++) {
          const tok = a.tokens[t];
          if (tok.to > nextStart || hasTerminatorOrQuote(text, cursor, tok.from)) break;
          if (count === 0 && (last === '!' || last === '?') && isUpperLetter(tok.text[0])) {
            // `“Run!” She laughed.` and `“Go!” Then he laughed.` open a new
            // sentence (an action beat). Only a name directly followed by the
            // speech verb (`“Go!” Elena hissed.`) is a tag.
            if (SUBJECT_PRONOUNS.has(tok.lower)) break;
            const verb = nextInPara(a, tok);
            if (verb && verb.to <= nextStart && onlySpaceBetween(text, tok.to, verb.from)) {
              const f = tagFinding(a, verb, e, nextStart);
              if (f && f !== 'plain') push(f);
            }
            break;
          }
          const f = tagFinding(a, tok, e, nextStart);
          if (f === 'plain') break;
          if (f) {
            push(f);
            break;
          }
          cursor = tok.to;
          count++;
        }
      }

      // Before the quote: `She hissed, “Go!”` — the lead-in must end on a comma or colon.
      let b = s;
      while (b > prevEnd && isSpace(text[b - 1])) b--;
      if (b > prevEnd && (text[b - 1] === ',' || text[b - 1] === ':')) {
        let cursor = b - 1;
        let count = 0;
        for (
          let t = firstTokenFrom(a.tokens, lo, hi, cursor) - 1;
          t >= lo && count < TAG_WINDOW_WORDS;
          t--
        ) {
          const tok = a.tokens[t];
          if (tok.from < prevEnd || hasTerminatorOrQuote(text, tok.to, cursor)) break;
          const f = tagFinding(a, tok, prevEnd, s);
          if (f === 'plain') break;
          if (f) {
            push(f);
            break;
          }
          cursor = tok.from;
          count++;
        }
      }
    }
  }
  return out;
}

function checkRepeatedStarts(a: Analysis): PrismFinding[] {
  const out: PrismFinding[] = [];
  const flush = (run: Token[]) => {
    if (run.length < (COMMON_STARTS.has(run[0].lower) ? 3 : 2)) return;
    for (let r = 1; r < run.length; r++) {
      const tok = run[r];
      out.push(
        finding(
          'repeated-starts',
          tok.para,
          tok.from,
          tok.to,
          `${run.length} sentences in a row start with ${quoted(tok.text)}`
        )
      );
    }
  };
  let run: Token[] = [];
  for (const s of a.sentences) {
    const tok = a.tokens[s.first];
    // Speech has its own rhythm ("No. No. No!"); only narration counts. A
    // sentence opening on a mention ("[[Elena]] nodded.") starts with that
    // mention, which is never the same word as another sentence's start.
    if (s.atomStart || inSpans(a.dialogue[s.para], tok.from, tok.to)) {
      if (run.length) flush(run);
      run = [];
      continue;
    }
    if (run.length && run[0].lower !== tok.lower) {
      flush(run);
      run = [];
    }
    run.push(tok);
  }
  if (run.length) flush(run);
  return out;
}

type Mark = readonly [number, number, number]; // paragraph, from, to

function checkPunctuationConsistency(a: Analysis): PrismFinding[] {
  const straightDouble: Mark[] = [];
  const curlyDouble: Mark[] = [];
  const straightSingle: Mark[] = [];
  const curlySingle: Mark[] = [];
  const em: Mark[] = [];
  const en: Mark[] = [];
  const hyphens: Mark[] = [];
  for (let p = 0; p < a.paragraphs.length; p++) {
    const text = a.paragraphs[p].text;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') straightDouble.push([p, i, i + 1]);
      else if (c === '“' || c === '”') curlyDouble.push([p, i, i + 1]);
      else if (c === "'") straightSingle.push([p, i, i + 1]);
      else if (c === '‘' || c === '’') curlySingle.push([p, i, i + 1]);
      else if (c === '—') {
        let j = i;
        while (text[j + 1] === '—') j++;
        em.push([p, i, j + 1]);
        i = j;
      } else if (c === '–') {
        // A spaced en dash is a dash; "1–3" is a range and says nothing about style.
        if (isSpace(text[i - 1]) && isSpace(text[i + 1])) en.push([p, i, i + 1]);
      } else if (c === '-' && text[i + 1] === '-') {
        let j = i + 1;
        while (text[j + 1] === '-') j++;
        hyphens.push([p, i, j + 1]);
        i = j;
      }
    }
  }
  const out: PrismFinding[] = [];
  const flag = (marks: Mark[], message: string) => {
    for (const [p, from, to] of marks)
      out.push(finding('punctuation-consistency', p, from, to, message));
  };
  if (straightDouble.length && curlyDouble.length) {
    // Tie: curly wins, so the straight ones are flagged.
    if (curlyDouble.length >= straightDouble.length) {
      flag(straightDouble, 'Mixed quote styles: this scene mostly uses curly quotes');
    } else {
      flag(curlyDouble, 'Mixed quote styles: this scene mostly uses straight quotes');
    }
  }
  if (straightSingle.length && curlySingle.length) {
    if (curlySingle.length >= straightSingle.length) {
      flag(straightSingle, 'Mixed apostrophe styles: this scene mostly uses curly apostrophes');
    } else {
      flag(curlySingle, 'Mixed apostrophe styles: this scene mostly uses straight apostrophes');
    }
  }
  // Preference order breaks ties: em dash, then spaced en dash, then "--".
  const dashes: Array<[Mark[], string]> = [
    [em, 'em dashes (—)'],
    [en, 'spaced en dashes ( – )'],
    [hyphens, 'double hyphens (--)'],
  ];
  const used = dashes.filter(([marks]) => marks.length > 0);
  if (used.length > 1) {
    let major = used[0];
    for (const d of used) if (d[0].length > major[0].length) major = d;
    for (const d of used) {
      if (d !== major) flag(d[0], `Mixed dash styles: this scene mostly uses ${major[1]}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Voice tints

function mergeSpans(spans: Span[]): Span[] {
  const sorted = spans.filter(([s, e]) => e > s).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out: Array<[number, number]> = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** `spans` minus `holes`; both sorted and non-overlapping. */
function subtractSpans(spans: readonly Span[], holes: readonly Span[]): Span[] {
  const out: Span[] = [];
  let h = 0; // holes before h end before the current span: skip them for good
  for (const [s, e] of spans) {
    while (h < holes.length && holes[h][1] <= s) h++;
    let cur = s;
    for (let x = h; x < holes.length; x++) {
      const [hs, he] = holes[x];
      if (hs >= e) break;
      if (he <= cur) continue;
      if (hs > cur) out.push([cur, hs]);
      cur = Math.max(cur, he);
      if (cur >= e) break;
    }
    if (cur < e) out.push([cur, e]);
  }
  return out;
}

function trimSpan(text: string, [s, e]: Span): Span | null {
  let from = s;
  let to = e;
  while (from < to && isSpace(text[from])) from++;
  while (to > from && isSpace(text[to - 1])) to--;
  return to > from ? [from, to] : null;
}

function innerMonologueSpans(a: Analysis, p: number): Span[] {
  const text = a.paragraphs[p].text;
  const italics = mergeSpans(
    a.paragraphs[p].italic.map(([s, e]) => [Math.max(0, s), Math.min(text.length, e)] as Span)
  );
  return subtractSpans(italics, a.dialogue[p]);
}

function checkDialogue(a: Analysis): PrismFinding[] {
  const out: PrismFinding[] = [];
  a.dialogue.forEach((spans, p) => {
    for (const [s, e] of spans) out.push(finding('dialogue', p, s, e, 'Dialogue'));
  });
  return out;
}

function checkInnerMonologue(a: Analysis): PrismFinding[] {
  const out: PrismFinding[] = [];
  for (let p = 0; p < a.paragraphs.length; p++) {
    const text = a.paragraphs[p].text;
    for (const span of innerMonologueSpans(a, p)) {
      const t = trimSpan(text, span);
      if (t) out.push(finding('inner-monologue', p, t[0], t[1], 'Inner monologue'));
    }
  }
  return out;
}

const HAS_CONTENT_RE = /[\p{L}\p{N}\uFFFC]/u;

function checkNarrator(a: Analysis): PrismFinding[] {
  const out: PrismFinding[] = [];
  for (let p = 0; p < a.paragraphs.length; p++) {
    const text = a.paragraphs[p].text;
    const covered = mergeSpans([...a.dialogue[p], ...innerMonologueSpans(a, p)]);
    for (const span of subtractSpans([[0, text.length]], covered)) {
      const t = trimSpan(text, span);
      // Skip whitespace and stray punctuation between two quotes.
      if (t && HAS_CONTENT_RE.test(text.slice(t[0], t[1])))
        out.push(finding('narrator', p, t[0], t[1], 'Narration'));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stats

/** Heuristic English syllable count (good enough for Flesch). */
function syllables(word: string): number {
  let w = word
    .normalize('NFD')
    .replace(/[^A-Za-z]/g, '')
    .toLowerCase();
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = w.match(/[aeiouy]{1,2}/g);
  return groups ? groups.length : 1;
}

function statsFrom(a: Analysis): PrismStats {
  const words = a.tokens.length;
  const sentences = a.sentences.length;
  if (words === 0) return { words: 0, sentences, avgSentenceWords: 0, readingEase: null };
  // Prose repeats its words, so count each distinct word once.
  const cache = new Map<string, number>();
  let syl = 0;
  for (const tok of a.tokens) {
    let n = cache.get(tok.lower);
    if (n === undefined) cache.set(tok.lower, (n = syllables(tok.lower)));
    syl += n;
  }
  const perSentence = sentences > 0 ? words / sentences : words;
  const ease = 206.835 - 1.015 * perSentence - 84.6 * (syl / words);
  return {
    words,
    sentences,
    avgSentenceWords: sentences > 0 ? Math.round((words / sentences) * 10) / 10 : 0,
    readingEase: Math.round(Math.min(100, Math.max(0, ease))),
  };
}

// ---------------------------------------------------------------------------
// Public API

type AnalysisCheck = (a: Analysis, th: PrismThresholds) => PrismFinding[];

const CHECKS: Record<PrismCheckId, AnalysisCheck> = {
  'overused-words': checkOverusedWords,
  'crutch-words': checkCrutchWords,
  adverbs: checkAdverbs,
  'passive-voice': checkPassiveVoice,
  'long-sentences': checkLongSentences,
  'filter-words': checkFilterWords,
  'dialogue-tags': checkDialogueTags,
  'repeated-starts': checkRepeatedStarts,
  'punctuation-consistency': checkPunctuationConsistency,
  dialogue: checkDialogue,
  'inner-monologue': checkInnerMonologue,
  narrator: checkNarrator,
};

function compareFindings(x: PrismFinding, y: PrismFinding): number {
  return (
    x.paragraph - y.paragraph ||
    x.from - y.from ||
    x.to - y.to ||
    (x.checkId < y.checkId ? -1 : x.checkId > y.checkId ? 1 : 0)
  );
}

/** One function per check, each sorted like runPrismRules output. For unit tests and one-off use. */
export const PRISM_RULES: Record<
  PrismCheckId,
  (paragraphs: readonly PrismParagraph[], thresholds: PrismThresholds) => PrismFinding[]
> = Object.fromEntries(
  (Object.keys(CHECKS) as PrismCheckId[]).map((id) => [
    id,
    (paragraphs: readonly PrismParagraph[], thresholds: PrismThresholds) =>
      CHECKS[id](analyze(paragraphs), thresholds).sort(compareFindings),
  ])
) as Record<
  PrismCheckId,
  (paragraphs: readonly PrismParagraph[], thresholds: PrismThresholds) => PrismFinding[]
>;

/**
 * Run every check (display filtering by settings happens downstream) and
 * return findings sorted by (paragraph, from, to, checkId) plus scene stats.
 */
export function runPrismRules(
  paragraphs: readonly PrismParagraph[],
  thresholds: PrismThresholds
): PrismResult {
  const a = analyze(paragraphs);
  const findings: PrismFinding[] = [];
  for (const id of Object.keys(CHECKS) as PrismCheckId[]) {
    for (const f of CHECKS[id](a, thresholds)) findings.push(f);
  }
  findings.sort(compareFindings);
  return { findings, stats: statsFrom(a) };
}

/** Words, sentences, average sentence length and Flesch reading ease for a scene. */
export function computePrismStats(paragraphs: readonly PrismParagraph[]): PrismStats {
  return statsFrom(analyze(paragraphs));
}
