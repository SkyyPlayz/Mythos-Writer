// New-name detection for the self-building wiki (SKY-11457 / SKY-10740).
//
// This is the *input* half of the wiki-autonomy contract: given the prose of a
// scene and the entities the vault already knows, produce the names the wiki
// has "spotted" and knows nothing about yet. `wikiAutonomyGate` then decides
// what happens to them (ask / auto-stub / nothing).
//
// Why detection lives here and not in the gate: 'ask' mode deliberately skips
// the hygiene contract (every candidate becomes a question), so detection has
// to be conservative on its own. A name that reaches this function's output is
// one we are willing to interrupt the author about.
//
// Deliberately NOT an LLM call. Scene scans run on a timer (useArchiveScheduler)
// and must stay free, offline and instant; a regex pass with a tight false-
// positive budget beats a per-keystroke model call.

import { COMMON_NOUN_BLOCKLIST, isThrowaway, normaliseForCompare } from './autoStubHygiene.js';
import type { WikiAutoStubCandidate } from './wikiAutonomyGate.js';

/** Minimal shape the detector needs from the vault's entity index. */
export interface WikiKnownEntity {
  name: string;
  aliases?: string[] | null;
}

/** Keeps one scan from flooding the question queue / stubbing a whole chapter. */
export const DEFAULT_MAX_NEW_NAME_CANDIDATES = 10;

// Capitalised words that open sentences or stand in for names but are never
// entities themselves. Anything here is stripped from the front of a candidate
// and rejected as a whole candidate.
const STOPWORDS = new Set<string>([
  // pronouns / determiners
  'i', 'he', 'she', 'it', 'we', 'they', 'you', 'me', 'him', 'her', 'them', 'us',
  'his', 'hers', 'its', 'their', 'theirs', 'our', 'ours', 'my', 'mine', 'your', 'yours',
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'there', 'here',
  'some', 'any', 'each', 'every', 'all', 'both', 'most', 'many', 'few', 'other', 'another',
  'no', 'none', 'nothing', 'something', 'anything', 'everything',
  'someone', 'anyone', 'everyone', 'nobody', 'somebody', 'anybody', 'everybody',
  // conjunctions / prepositions / adverbs that start sentences
  'and', 'but', 'or', 'nor', 'so', 'yet', 'for', 'if', 'then', 'than', 'when', 'while',
  'after', 'before', 'because', 'though', 'although', 'until', 'unless', 'since', 'as',
  'at', 'in', 'on', 'of', 'to', 'from', 'with', 'without', 'by', 'into', 'onto', 'upon',
  'over', 'under', 'above', 'below', 'through', 'across', 'against', 'between', 'behind',
  'up', 'down', 'out', 'off', 'again', 'still', 'just', 'only', 'even', 'now', 'once',
  'not', 'never', 'always', 'perhaps', 'maybe', 'instead', 'later', 'finally',
  // interrogatives
  'what', 'where', 'why', 'how', 'who', 'whom', 'whose', 'which',
  // common speech-tag subjects / narrative filler
  'yes', 'ok', 'okay', 'well', 'oh', 'ah', 'hey', 'please', 'thanks',
  // manuscript structure words — headings and beat labels, not story entities
  'chapter', 'scene', 'prologue', 'epilogue', 'part', 'book', 'act', 'interlude', 'draft',
  // calendar words are capitalised but are never story entities
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december',
]);

// Lowercase connectors allowed *inside* a multi-word name ("Blade of Dawn",
// "Ludwig van Holt") without ending the run.
const CONNECTORS = new Set<string>(['of', 'the', 'de', 'del', 'della', 'di', 'da', 'van', 'von', 'ibn', 'al']);

const NAME_TOKEN = String.raw`\p{Lu}[\p{L}'’-]*`;
const CONNECTOR_ALT = [...CONNECTORS].join('|');
const NAME_RUN = new RegExp(
  `${NAME_TOKEN}(?:\\s+(?:(?:${CONNECTOR_ALT})\\s+)?${NAME_TOKEN}){0,3}`,
  'gu',
);
const WIKI_LINK = /\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/gu;

// Characters that may sit between the start of a sentence and its first word
// (opening quotes, brackets, em-dash). A name behind only these is still
// "sentence-initial" and so its capitalisation proves nothing.
const SENTENCE_LEAD = /["'“‘’(\[\-–—*_>#\s]/u;
const SENTENCE_END = /[.!?…:;\n\r]/u;

interface Occurrence {
  raw: string;
  sentenceInitial: boolean;
  index: number;
}

/** Strips a trailing possessive so "Marcus’s" and "Marcus" are one candidate. */
function stripPossessive(name: string): string {
  return name.replace(/['’]s$/u, '').replace(/['’]$/u, '');
}

function tokens(name: string): string[] {
  return name.split(/\s+/u).filter(Boolean);
}

/** Drops leading stopwords ("The Iron Gate" → "Iron Gate"). */
function trimStopwords(name: string): string {
  const parts = tokens(name);
  let start = 0;
  while (start < parts.length && STOPWORDS.has(parts[start].toLowerCase())) start += 1;
  let end = parts.length;
  while (end > start && (STOPWORDS.has(parts[end - 1].toLowerCase()) || CONNECTORS.has(parts[end - 1].toLowerCase()))) {
    end -= 1;
  }
  return parts.slice(start, end).join(' ');
}

/**
 * True when only whitespace / opening punctuation separates `index` from the
 * previous sentence boundary — i.e. the word's capital letter is grammar, not
 * evidence of a proper noun.
 */
function isSentenceInitial(text: string, index: number): boolean {
  for (let i = index - 1; i >= 0; i -= 1) {
    const ch = text[i];
    if (SENTENCE_END.test(ch)) return true;
    if (!SENTENCE_LEAD.test(ch)) return false;
  }
  return true;
}

/** Word-boundary containment, either direction: "Lady Elara" ⊃ "Elara". */
function overlaps(a: string, b: string): boolean {
  if (a === b) return true;
  const [long, short] = a.length >= b.length ? [a, b] : [b, a];
  const at = long.indexOf(short);
  if (at < 0) return false;
  const beforeOk = at === 0 || long[at - 1] === ' ';
  const afterEnd = at + short.length;
  const afterOk = afterEnd === long.length || long[afterEnd] === ' ';
  return beforeOk && afterOk;
}

function knownTerms(entities: WikiKnownEntity[]): string[] {
  const terms: string[] = [];
  for (const entity of entities) {
    if (entity.name) terms.push(normaliseForCompare(entity.name));
    for (const alias of entity.aliases ?? []) {
      if (alias) terms.push(normaliseForCompare(alias));
    }
  }
  return terms;
}

/** Removes headings, which are structure ("Chapter Two"), not prose. */
function stripHeadings(text: string): string {
  return text.replace(/^[ \t]*#{1,6}[^\n]*$/gmu, '');
}

export interface DetectNewNameOptions {
  /** Cap on returned candidates. Default {@link DEFAULT_MAX_NEW_NAME_CANDIDATES}. */
  maxCandidates?: number;
}

/**
 * Finds proper nouns in `sceneText` that the vault has no entity for.
 *
 * Acceptance rules, tuned so a false positive costs the author one dismissed
 * question rather than a junk note:
 *  - `[[Bracketed]]` names are always candidates — the author typed the link.
 *  - A multi-word capitalised run is a candidate anywhere it appears.
 *  - A single capitalised word must appear at least once *away* from a
 *    sentence start, otherwise its capital is just grammar.
 *  - Stopwords, structural words, the common-noun blocklist and the hygiene
 *    contract's throwaway rule all reject outright.
 *  - Anything overlapping a known entity name or alias (either direction) is
 *    already in the wiki and is not "new".
 */
export function detectNewNameCandidates(
  sceneText: string,
  entities: WikiKnownEntity[],
  scenePath: string,
  options: DetectNewNameOptions = {},
): WikiAutoStubCandidate[] {
  const max = options.maxCandidates ?? DEFAULT_MAX_NEW_NAME_CANDIDATES;
  if (!sceneText || max <= 0) return [];

  const text = stripHeadings(sceneText);
  const occurrences = new Map<string, Occurrence[]>();

  function record(raw: string, sentenceInitial: boolean, index: number): void {
    const name = trimStopwords(stripPossessive(raw.trim()));
    if (!name) return;
    const key = normaliseForCompare(name);
    if (!key) return;
    const list = occurrences.get(key);
    if (list) list.push({ raw: name, sentenceInitial, index });
    else occurrences.set(key, [{ raw: name, sentenceInitial, index }]);
  }

  // Explicit author intent: a wiki link is never "just capitalisation".
  for (const match of text.matchAll(WIKI_LINK)) {
    record(match[1], false, match.index ?? 0);
  }
  // Wiki-link syntax blanked (length-preserving, so both passes report
  // offsets in the same coordinate space) rather than deleted, so the run
  // scanner doesn't re-read the target with its brackets attached.
  const prose = text.replace(WIKI_LINK, (m) => ' '.repeat(m.length));
  for (const match of prose.matchAll(NAME_RUN)) {
    const index = match.index ?? 0;
    record(match[0], isSentenceInitial(prose, index), index);
  }

  const known = knownTerms(entities);
  const accepted: WikiAutoStubCandidate[] = [];

  const ordered = [...occurrences.entries()].sort(
    (a, b) => Math.min(...a[1].map((o) => o.index)) - Math.min(...b[1].map((o) => o.index)),
  );

  for (const [key, hits] of ordered) {
    if (accepted.length >= max) break;

    const name = hits[0].raw;
    const parts = tokens(key);
    if (parts.length === 1) {
      if (STOPWORDS.has(key)) continue;
      // A lone capital at a sentence start proves nothing.
      if (hits.every((hit) => hit.sentenceInitial)) continue;
    }
    if (parts.every((part) => STOPWORDS.has(part))) continue;
    if (isThrowaway(name)) continue;
    if (parts.length === 1 && COMMON_NOUN_BLOCKLIST.has(key)) continue;
    if (known.some((term) => overlaps(term, key))) continue;

    accepted.push({
      name,
      // The detector deliberately does not guess a type — an unknown type
      // routes auto-stubs to the Inbox instead of asserting "character".
      entityType: null,
      scenePath,
      entityId: null,
    });
  }

  return accepted;
}
