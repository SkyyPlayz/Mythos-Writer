// No-AI Brainstorm extract: dictionary/regex NER over one agent turn (PLAN-AI-MODES M-1, rule 66).
//
// Replaces the Haiku side-call behind brainstorm:extractProposals. Same output
// contract as runExtractionSideCall (brainstormAgent.ts) so the renderer's
// ProposalCard and the suggestions table need no change, but no model, no
// network, no key: it runs in every AI mode, offline included.
//
// What counts as a name is wikiNameCandidates' job (capitalised runs, sentence-
// start rule, stopwords, hygiene). This module adds the two brainstorm-specific
// intent signals (FACT tags, **bold** names), a filter for reply chatter and
// outline labels ("I'd", "Option B"), a dictionary kind guess and an
// evidence-based confidence.
//
// FACT tags of the kinds the renderer files itself (BrainstormPage extractFacts:
// character / location / item / note) are already on their way into the vault as
// Detected Facts, so they are never proposed again; only the kinds the renderer
// ignores (faction / scene_card / inbox) become proposals, straight from the tag.

import crypto from 'crypto';
import { normaliseForCompare } from './autoStubHygiene.js';
import { parseFacts, type FactType, type NoteProposal } from './brainstormAgent.js';
import { sanitizeWikilinks, type KnownNoteNames } from './noteRelationships.js';
import {
  DEFAULT_MAX_NEW_NAME_CANDIDATES,
  detectNewNameCandidates,
  type WikiKnownEntity,
} from './wikiNameCandidates.js';

// ─── Shipped defaults ───

/** Same triage floor runExtractionSideCall applied to the LLM's scores. */
export const MIN_EXTRACTION_CONFIDENCE = 0.6;
/** A regex never earns certainty; scores stop here. */
export const MAX_EXTRACTION_CONFIDENCE = 0.95;
/** The agent stated kind and description explicitly. */
export const FACT_TAG_CONFIDENCE = 0.9;
/** Evidence base scores, strongest first. */
export const WIKILINK_CONFIDENCE = 0.8;
export const BOLD_CONFIDENCE = 0.75;
export const MULTI_WORD_CONFIDENCE = 0.7;
export const SINGLE_WORD_CONFIDENCE = 0.6;
/** Every extra mention adds this, up to {@link MAX_REPEAT_BONUS}. */
export const REPEAT_BONUS = 0.05;
export const MAX_REPEAT_BONUS = 0.1;
/** A dictionary or context cue agreed on the kind. */
export const KIND_CUE_BONUS = 0.05;
/** Default cap on proposals per turn (one card queue, not a chapter dump). */
export const DEFAULT_MAX_PROPOSALS = DEFAULT_MAX_NEW_NAME_CANDIDATES;
/** Candidates scored per turn before the confidence floor and the cap. */
export const SCAN_CANDIDATE_LIMIT = 50;
/** Longest turn scanned (~35k words); the rest is ignored, never an error. */
export const MAX_SCANNED_CHARS = 200_000;
/** Longest body snippet taken from the turn. */
export const MAX_BODY_CHARS = 240;

/** Vault-relative folder per kind, in the old prompt's "characters/aria.md" convention. */
const KIND_FOLDER: Record<FactType, string> = {
  character: 'characters',
  location: 'locations',
  item: 'items',
  faction: 'factions',
  scene_card: 'scenes',
  inbox: 'inbox',
};

// ─── Dictionaries ───

const HONORIFICS = new Set<string>([
  'mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'doctor', 'professor', 'prof', 'sir', 'dame', 'madam', 'madame',
  'lord', 'lady', 'king', 'queen', 'prince', 'princess', 'duke', 'duchess', 'baron', 'baroness',
  'count', 'countess', 'earl', 'emperor', 'empress', 'regent', 'chancellor', 'magistrate',
  'captain', 'commander', 'general', 'admiral', 'colonel', 'major', 'lieutenant', 'sergeant', 'corporal',
  'father', 'mother', 'brother', 'sister', 'uncle', 'aunt', 'grandmother', 'grandfather',
  'master', 'mistress', 'elder', 'saint', 'archmage', 'magus', 'priest', 'priestess', 'bishop', 'abbot',
  'detective', 'inspector', 'agent', 'officer', 'judge', 'senator', 'governor', 'mayor',
]);

const FACTION_WORDS = new Set<string>([
  'order', 'guild', 'council', 'clan', 'brotherhood', 'sisterhood', 'legion', 'house', 'league', 'cult',
  'circle', 'covenant', 'syndicate', 'church', 'tribe', 'dynasty', 'alliance', 'coven', 'conclave',
  'senate', 'army', 'fleet', 'knights', 'society', 'company', 'cabal', 'consortium', 'federation',
  'empire', 'republic', 'union', 'party', 'faction', 'sect', 'band', 'crew', 'gang', 'watch',
]);

const ITEM_WORDS = new Set<string>([
  'sword', 'blade', 'crown', 'ring', 'amulet', 'staff', 'dagger', 'shield', 'helm', 'orb', 'tome',
  'codex', 'grimoire', 'scroll', 'chalice', 'goblet', 'spear', 'bow', 'axe', 'hammer', 'gauntlet',
  'cloak', 'mantle', 'stone', 'gem', 'jewel', 'key', 'mirror', 'lantern', 'relic', 'talisman',
  'sceptre', 'scepter', 'pendant', 'locket', 'compass', 'map', 'horn', 'lance', 'armor', 'armour',
]);

const LOCATION_WORDS = new Set<string>([
  'city', 'town', 'village', 'kingdom', 'realm', 'forest', 'wood', 'woods', 'mountain', 'mountains',
  'mount', 'peak', 'river', 'lake', 'sea', 'ocean', 'isle', 'island', 'islands', 'bay', 'harbor',
  'harbour', 'port', 'keep', 'castle', 'citadel', 'fortress', 'fort', 'tower', 'temple', 'abbey',
  'valley', 'vale', 'pass', 'gate', 'bridge', 'desert', 'wastes', 'marsh', 'swamp', 'plains', 'hills',
  'cave', 'caves', 'caverns', 'mines', 'district', 'quarter', 'street', 'road', 'market', 'tavern',
  'inn', 'palace', 'hall', 'sanctum', 'shrine', 'ruins', 'coast', 'cliffs', 'falls', 'canyon',
  'glade', 'grove', 'reach', 'hold', 'spire', 'academy', 'library', 'station', 'colony', 'province',
]);

/** Abbreviated titles ("Dr. Elena Vasquez"): the "." splits the run, so they are read from the text before it. */
const HONORIFIC_ABBREVIATION = /(?:^|[^\p{L}])(?:mr|mrs|ms|mx|dr|prof|capt|gen|col|lt|sgt|sr|jr)\.\s*$/iu;

/** Reply chatter, not names: "I'd", "You're", "Let's", "Don't". */
const PRONOUN_CONTRACTION = /^(?:i|you|we|they|he|she|it|that|there|here|what|who|let)['’](?:d|ll|ve|m|re|s)$/u;
const NEGATION_CONTRACTION = /n['’]t$/u;

/** Outline labels ("Option B", "Plan A"); wikiNameCandidates already drops a leading Act/Chapter/Part. */
const OUTLINE_WORDS = new Set<string>([
  'option', 'plan', 'step', 'phase', 'stage', 'beat', 'version', 'idea', 'choice', 'route', 'path',
  'arc', 'season', 'episode', 'volume', 'section', 'appendix', 'level', 'round', 'page', 'line',
  'act', 'chapter', 'part', 'scene', 'book', 'draft',
]);
const NUMBER_WORDS = new Set<string>([
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'final', 'last',
]);

/** Words that name a group or a place when they lead ("House Varn", "Mount Kesh"). */
const FACTION_PREFIXES = new Set<string>(['house', 'clan', 'tribe', 'order', 'guild', 'circle', 'cult', 'church']);
const LOCATION_PREFIXES = new Set<string>(['mount', 'lake', 'fort', 'port', 'castle', 'isle', 'cape', 'camp']);

/** Single-word place endings ("Ravenspire", "Oakshire"). Surname-ish ones (-ton) left out. */
const LOCATION_SUFFIXES = [
  'shire', 'burg', 'borough', 'haven', 'spire', 'ford', 'port', 'fell', 'dale', 'mere', 'gard',
  'heim', 'holm', 'wick', 'stead', 'vale', 'keep', 'hold', 'moor', 'reach',
];

/** "in Kesh", "beyond the Ashen Wastes". */
const PLACE_PREPOSITIONS = new Set<string>([
  'in', 'at', 'into', 'inside', 'near', 'beyond', 'across', 'through', 'toward', 'towards', 'outside',
]);
/** "to"/"from" only point at a place after a motion verb ("a letter from Mira" is a person). */
const MOTION_PREPOSITIONS = new Set<string>(['to', 'from']);
const MOTION_VERBS = new Set<string>([
  'travel', 'travels', 'traveled', 'travelled', 'journey', 'journeys', 'journeyed', 'sail', 'sails',
  'sailed', 'ride', 'rides', 'rode', 'march', 'marches', 'marched', 'flee', 'flees', 'fled', 'return',
  'returns', 'returned', 'go', 'goes', 'went', 'come', 'comes', 'came', 'head', 'heads', 'headed',
  'move', 'moves', 'moved', 'walk', 'walks', 'walked', 'escape', 'escapes', 'escaped', 'exiled', 'hails',
]);
/** "Kael said", "Kael smiles". */
const CHARACTER_VERBS_AFTER = new Set<string>([
  'said', 'says', 'asked', 'asks', 'replied', 'replies', 'whispered', 'whispers', 'shouted', 'shouts',
  'smiled', 'smiles', 'nodded', 'nods', 'laughed', 'laughs', 'sighed', 'sighs', 'thinks', 'thought',
  'wants', 'wanted', 'believes', 'believed', 'fears', 'feared', 'loves', 'loved', 'hates', 'hated',
  'knows', 'knew', 'remembers', 'remembered', 'decides', 'decided', 'himself', 'herself', 'themself',
]);
/** "said Kael", "met Kael". */
const CHARACTER_VERBS_BEFORE = new Set<string>([
  'said', 'asked', 'replied', 'met', 'meets', 'befriends', 'befriended', 'marries', 'married',
  'kills', 'killed', 'loves', 'hates', 'trusts', 'trusted', 'betrays', 'betrayed', 'mentor', 'rival',
]);

// ─── Text helpers ───

// Kinds BrainstormPage's own extractFacts files (keep in step with its regex).
const RENDERER_FILED_FACT = /\[FACT:(character|location|item|note)\|([^\]|]+)\|([^\]]+)\]/giu;
const ANY_FACT_TAG = /\[FACT:[^\]]*\]/giu;
const WIKI_LINK = /\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/gu;
const BOLD_SPAN = /\*\*([^*\n]{1,80})\*\*/gu;
const BOLD_NAME_SHAPE =
  /^\p{Lu}[\p{L}'’-]*(?:\s+(?:(?:of|the|de|del|della|di|da|van|von|ibn|al)\s+)?\p{Lu}[\p{L}'’-]*){0,3}$/u;
const SENTENCE_END = /[.!?…:;\n\r]/u;

function blank(match: string): string {
  return ' '.repeat(match.length);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function words(text: string): string[] {
  return text.split(/[^\p{L}'’]+/u).filter(Boolean).map((w) => w.toLowerCase());
}

/** The clause on one side of `index`, cut at the nearest sentence boundary. */
function clauseBefore(text: string, index: number): string {
  const slice = text.slice(Math.max(0, index - 48), index);
  let cut = -1;
  for (let i = slice.length - 1; i >= 0; i -= 1) {
    if (SENTENCE_END.test(slice[i])) { cut = i; break; }
  }
  return slice.slice(cut + 1);
}

function clauseAfter(text: string, index: number): string {
  const slice = text.slice(index, index + 32);
  for (let i = 0; i < slice.length; i += 1) {
    if (SENTENCE_END.test(slice[i])) return slice.slice(0, i);
  }
  return slice;
}

/** The sentence around `index`, tidied for a proposal body. */
function sentenceAround(text: string, index: number): string {
  let start = index;
  while (start > 0 && !/[.!?…\n\r]/u.test(text[start - 1])) start -= 1;
  let end = index;
  while (end < text.length && !/[.!?…\n\r]/u.test(text[end])) end += 1;
  if (end < text.length && /[.!?…]/u.test(text[end])) end += 1;
  const sentence = text
    .slice(start, end)
    .replace(/\*\*|__/g, '')
    .replace(/^[\s\-*+>#\d.)]+/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  return sentence.length > MAX_BODY_CHARS ? `${sentence.slice(0, MAX_BODY_CHARS - 1).trimEnd()}…` : sentence;
}

function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return slug || 'untitled';
}

function destinationFor(kind: FactType, title: string): string {
  return `${KIND_FOLDER[kind]}/${slugify(title)}.md`;
}

// ─── Kind guess ───

interface KindGuess {
  kind: FactType;
  /** True when a dictionary or context cue (not the inbox fallback) chose the kind. */
  cued: boolean;
}

interface Mention {
  index: number;
  before: string[];
  after: string[];
  /** "Dr. " sits right before the name. */
  honorific: boolean;
  /** "Mira's house": the name owns something, so it is not the place. */
  possessive: boolean;
}

/**
 * True for a candidate that is reply chatter or an outline label, not an
 * entity: a pronoun or negation contraction anywhere ("I'd"), or only number
 * words / letters / roman numerals, optionally after an outline word ("Two",
 * "Option B", "Part II").
 */
function isChatterOrLabel(name: string): boolean {
  const tokens = name.split(/\s+/u).filter(Boolean);
  const lower = tokens.map((t) => t.toLowerCase());
  if (lower.some((t) => PRONOUN_CONTRACTION.test(t) || NEGATION_CONTRACTION.test(t))) return true;
  const rest = lower.length > 1 && OUTLINE_WORDS.has(lower[0]) ? tokens.slice(1) : tokens;
  return rest.every((t) => NUMBER_WORDS.has(t.toLowerCase()) || /^\p{Lu}$/u.test(t) || /^[IVXLC]+$/u.test(t));
}

function dictionaryKind(name: string, articled: boolean): FactType | null {
  const tokens = name.split(/\s+/u).filter(Boolean).map((t) => t.toLowerCase().replace(/['’]s$/u, ''));
  if (tokens.length === 0) return null;
  if (HONORIFICS.has(tokens[0].replace(/\.$/u, ''))) return 'character';
  if (tokens.length > 1 && FACTION_PREFIXES.has(tokens[0])) return 'faction';
  if (tokens.length > 1 && LOCATION_PREFIXES.has(tokens[0])) return 'location';
  // Head noun: the word before "of" ("Blade of Dawn"), else the last word ("the
  // Sword Coast"). A bare two-part name with no "of" and no "the" is read as a
  // person ("Corwin Vale", "Emma Stone"), so the head noun does not decide it.
  const ofAt = tokens.indexOf('of');
  const head = ofAt > 0 ? tokens[ofAt - 1] : tokens[tokens.length - 1];
  if (ofAt > 0 || articled || tokens.length === 1) {
    if (FACTION_WORDS.has(head)) return 'faction';
    if (ITEM_WORDS.has(head)) return 'item';
    if (LOCATION_WORDS.has(head)) return 'location';
  }
  if (tokens.some((t) => HONORIFICS.has(t))) return 'character';
  const last = tokens[tokens.length - 1];
  if (LOCATION_SUFFIXES.some((s) => last.length >= s.length + 2 && last.endsWith(s))) return 'location';
  return null;
}

function classify(name: string, mentions: Mention[]): KindGuess {
  if (mentions.some((m) => m.honorific)) return { kind: 'character', cued: true };
  const articled = mentions.some((m) => m.before[m.before.length - 1] === 'the');
  const fromDictionary = dictionaryKind(name, articled);
  if (fromDictionary) return { kind: fromDictionary, cued: true };
  let place = 0;
  let person = 0;
  for (const m of mentions) {
    const prev = m.before[m.before.length - 1];
    const prev2 = m.before[m.before.length - 2];
    const next = m.after[0];
    if (m.possessive) {
      // "to Mira's house": the place is the house, not Mira.
    } else if (prev && PLACE_PREPOSITIONS.has(prev)) place += 1;
    else if (prev && prev2 && MOTION_PREPOSITIONS.has(prev) && MOTION_VERBS.has(prev2)) place += 1;
    if ((next && CHARACTER_VERBS_AFTER.has(next)) || (prev && CHARACTER_VERBS_BEFORE.has(prev))) person += 1;
  }
  if (place > person) return { kind: 'location', cued: true };
  if (person > place) return { kind: 'character', cued: true };
  // wikiNameCandidates' rule: with no evidence, don't assert a type; the Inbox is honest.
  return { kind: 'inbox', cued: false };
}

function findMentions(prose: string, name: string): Mention[] {
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, 'gu');
  const mentions: Mention[] = [];
  for (const match of prose.matchAll(pattern)) {
    const index = match.index ?? 0;
    const end = index + name.length;
    mentions.push({
      index,
      before: words(clauseBefore(prose, index)),
      after: words(clauseAfter(prose, end)),
      honorific: HONORIFIC_ABBREVIATION.test(prose.slice(Math.max(0, index - 8), index)),
      possessive: /^['’]s(?![\p{L}\p{N}])/u.test(prose.slice(end, end + 3)),
    });
  }
  return mentions;
}

function clamp(score: number): number {
  return Math.round(Math.min(MAX_EXTRACTION_CONFIDENCE, Math.max(0, score)) * 100) / 100;
}

// ─── Public API ───

export interface ExtractByScriptOptions {
  /** Override UUID generation for deterministic tests. */
  generateId?: () => string;
  /** Cap on returned proposals. Default {@link DEFAULT_MAX_PROPOSALS}. */
  maxProposals?: number;
}

/**
 * Finds the named story entities in one brainstorm agent turn and returns them
 * as pending NoteProposals, with no model call.
 *
 * Same filters as runExtractionSideCall (any match suppresses):
 *   - extractionConfidence < {@link MIN_EXTRACTION_CONFIDENCE}
 *   - title already in existingEntityNames (case-insensitive; NER names also
 *     drop when they overlap a known name, as in wikiNameCandidates)
 *   - title in sessionRejectionLog (case-insensitive)
 * Bodies pass through sanitizeWikilinks against existingEntityNames.
 *
 * Pure and synchronous: no IO, no network, no timers. Never throws; bad input
 * returns [].
 */
export function extractProposalsByScript(
  turnText: string,
  existingEntityNames: Set<string>,
  sessionRejectionLog: Set<string>,
  turnId: string,
  opts: ExtractByScriptOptions = {},
): NoteProposal[] {
  try {
    return extract(turnText, existingEntityNames, sessionRejectionLog, turnId, opts);
  } catch {
    return [];
  }
}

function toNames(source: Iterable<unknown> | null | undefined): string[] {
  if (!source || typeof (source as Iterable<unknown>)[Symbol.iterator] !== 'function') return [];
  return [...source].filter((n): n is string => typeof n === 'string' && n.trim() !== '');
}

function extract(
  turnText: string,
  existingEntityNames: Set<string>,
  sessionRejectionLog: Set<string>,
  turnId: string,
  opts: ExtractByScriptOptions,
): NoteProposal[] {
  if (typeof turnText !== 'string' || !turnText.trim()) return [];
  const max = Math.floor(opts.maxProposals ?? DEFAULT_MAX_PROPOSALS);
  if (!(max > 0)) return [];
  const generateId = opts.generateId ?? (() => crypto.randomUUID());
  const sourceTurnId = typeof turnId === 'string' ? turnId : '';
  const text = turnText.length > MAX_SCANNED_CHARS ? turnText.slice(0, MAX_SCANNED_CHARS) : turnText;

  const existing = toNames(existingEntityNames);
  const existingKeys = new Set(existing.map(normaliseForCompare));
  const rejectedKeys = new Set(toNames(sessionRejectionLog).map(normaliseForCompare));
  // Same link whitelist runExtractionSideCall built: only already-known names stay linked.
  const knownForLinks: KnownNoteNames = new Map(existing.map((n) => [n.toLowerCase(), n]));

  const proposals: NoteProposal[] = [];
  const taken = new Set<string>();
  const push = (kind: FactType, title: string, body: string, confidence: number): void => {
    const key = normaliseForCompare(title);
    if (!key || taken.has(key) || existingKeys.has(key) || rejectedKeys.has(key)) return;
    if (confidence < MIN_EXTRACTION_CONFIDENCE) return;
    taken.add(key);
    proposals.push({
      id: generateId(),
      kind,
      title,
      destinationPath: destinationFor(kind, title),
      body: sanitizeWikilinks(body, knownForLinks),
      frontmatter: {},
      sourceConversationTurnId: sourceTurnId,
      extractionConfidence: confidence,
      status: 'pending',
    });
  };

  // 1. FACT tags. Renderer-filed kinds are claimed (already becoming notes);
  //    the rest are proposed exactly as the agent tagged them.
  const tagNames: WikiKnownEntity[] = [];
  for (const match of text.matchAll(RENDERER_FILED_FACT)) {
    const name = match[2].trim();
    tagNames.push({ name });
    taken.add(normaliseForCompare(name));
  }
  for (const fact of parseFacts(text)) {
    tagNames.push({ name: fact.name });
    if (fact.type === 'character' || fact.type === 'location' || fact.type === 'item') continue;
    if (proposals.length < max) push(fact.type, fact.name, fact.description, FACT_TAG_CONFIDENCE);
  }

  // 2. Prose NER. Tags are structure, not prose: blank them (length-preserving)
  //    so their descriptions don't re-surface the tagged names.
  const prose = text.replace(ANY_FACT_TAG, blank);
  const wikiKeys = new Set<string>();
  for (const match of prose.matchAll(WIKI_LINK)) wikiKeys.add(normaliseForCompare(match[1]));

  // A bold name is author/agent intent, like a wiki link: hand it to the
  // detector as one so a bold name opening a line still counts. Bold labels
  // ("**Setting:**", a bold line on its own) are headings, not names.
  const boldKeys = new Set<string>();
  const detectText = prose.replace(BOLD_SPAN, (whole: string, inner: string, offset: number) => {
    const name = inner.trim();
    if (!BOLD_NAME_SHAPE.test(name)) return whole;
    const rest = prose.slice(offset + whole.length);
    if (/^\s*:/u.test(rest)) return whole;
    const lineStart = prose.lastIndexOf('\n', offset) + 1;
    const lineEnd = rest.indexOf('\n');
    const line = prose.slice(lineStart, offset + whole.length + (lineEnd < 0 ? rest.length : lineEnd));
    if (/^\s*(?:[-*+]\s+|\d+[.)]\s+)?\*\*[^*\n]+\*\*\s*$/u.test(line)) return whole;
    boldKeys.add(normaliseForCompare(name));
    return `[[${name}]]`;
  });

  const known: WikiKnownEntity[] = [...existing.map((name) => ({ name })), ...tagNames];
  const candidates = detectNewNameCandidates(detectText, known, sourceTurnId, {
    maxCandidates: SCAN_CANDIDATE_LIMIT,
  });

  for (const candidate of candidates) {
    if (proposals.length >= max) break;
    const title = candidate.name;
    const key = normaliseForCompare(title);
    if (taken.has(key) || existingKeys.has(key) || rejectedKeys.has(key)) continue;
    if (isChatterOrLabel(title)) continue;

    const mentions = findMentions(prose, title);
    const multiWord = /\s/u.test(title);
    let score = wikiKeys.has(key)
      ? WIKILINK_CONFIDENCE
      : boldKeys.has(key)
        ? BOLD_CONFIDENCE
        : multiWord ? MULTI_WORD_CONFIDENCE : SINGLE_WORD_CONFIDENCE;
    score += Math.min(MAX_REPEAT_BONUS, Math.max(0, mentions.length - 1) * REPEAT_BONUS);
    // No sentence-start penalty: wikiNameCandidates already drops a lone word
    // that only opens sentences, and a multi-word run's later capitals are
    // evidence wherever it sits ("- Mira Sol, a pilot").
    const guess = classify(title, mentions);
    if (guess.cued) score += KIND_CUE_BONUS;

    const body = mentions.length > 0 ? sentenceAround(prose, mentions[0].index) : '';
    push(guess.kind, title, body, clamp(score));
  }

  return proposals;
}
