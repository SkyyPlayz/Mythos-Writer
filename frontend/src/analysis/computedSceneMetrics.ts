// Beta 4 M13 — COMPUTED · LOCAL · FREE scene metrics (§5.4).
//
// Pure text analysis over the open scene: words, read time, average sentence
// length, dialogue/description/action split, filter words with paragraph
// locations, adverb dialogue tags, plus POV/pacing heuristics for the
// right-panel Scene Analysis card. Everything here runs with AI completely
// disabled — that is half the M13 acceptance ("computed section renders with
// AI disabled"). No imports from any agent/IPC surface, no side effects.

import type { Block, BlockType } from '../types';

// ── Types ───────────────────────────────────────────────────────────────────

export interface FilterWordHit {
  /** The filter word as written (lowercased). */
  word: string;
  /** 1-based paragraph index within the scene. */
  paragraph: number;
}

export interface ComputedSceneMetrics {
  words: number;
  /** Estimated read time in whole minutes at READ_WPM (min 1 when words > 0). */
  readTimeMinutes: number;
  sentenceCount: number;
  /** Mean words per sentence (0 when there are no sentences). */
  avgSentenceWords: number;
  /** Integer percentages; sum to 100 whenever words > 0. */
  dialoguePct: number;
  descriptionPct: number;
  actionPct: number;
  filterWordTotal: number;
  filterWordHits: FilterWordHit[];
  adverbDialogueTags: number;
  /** Local POV heuristic — honest about what plain text can tell. */
  pov: 'First person' | 'Second person' | 'Third person' | 'Unclear';
  /** Local pacing heuristic banded on average sentence length. */
  pacing: 'Fast' | 'Medium' | 'Slow';
}

/** Minimal scene shape the analyser needs (full `Scene` satisfies it). */
export interface AnalyzableScene {
  title: string;
  blocks: Array<Pick<Block, 'type' | 'content' | 'order'>>;
}

// ── Tunables ────────────────────────────────────────────────────────────────

/** Adult fiction silent-reading speed; 1,842 words → ~7 min (prototype 4234). */
export const READ_WPM = 250;

/** Pacing bands over average sentence length (words). */
const FAST_MAX_AVG = 12;
const MEDIUM_MAX_AVG = 18;

/**
 * Perception-filter verbs (§5.4 "filter words w/ locations"). Counted in
 * narration only — dialogue characters may legitimately say "I heard…".
 */
export const FILTER_WORDS: readonly string[] = [
  'felt', 'feel', 'feels',
  'saw', 'see', 'sees',
  'heard', 'hear', 'hears',
  'noticed', 'notices', 'notice',
  'watched', 'watches',
  'seemed', 'seems',
  'realized', 'realizes',
  'wondered', 'wonders',
  'thought',
  'knew',
  'decided',
  'remembered',
];

/** Speech verbs an adverb can hang off ("she said softly"). */
const SPEECH_VERBS = [
  'said', 'asked', 'replied', 'whispered', 'shouted', 'muttered', 'answered',
  'called', 'snapped', 'cried', 'hissed', 'growled', 'murmured', 'yelled',
  'exclaimed', 'added', 'demanded', 'insisted', 'stammered', 'barked',
  'breathed', 'groaned', 'sighed',
];

/** Words ending in -ly that are not manner adverbs. */
const LY_EXCEPTIONS = new Set([
  'only', 'family', 'reply', 'early', 'belly', 'silly', 'ugly', 'ally',
  'bully', 'jelly', 'folly', 'apply', 'supply', 'assembly', 'likely',
  'holy', 'melancholy',
]);

/**
 * Motion/impact verbs for the action-vs-description sentence heuristic used
 * on untyped (`prose`) blocks. Typed blocks always win (see classify below).
 */
const ACTION_VERBS = [
  'ran', 'run', 'runs', 'running', 'sprinted', 'sprints', 'bolted', 'bolts',
  'dashed', 'darted', 'lunged', 'lunges', 'leapt', 'leaped', 'jumped', 'jumps',
  'grabbed', 'grabs', 'snatched', 'seized', 'yanked', 'shoved', 'pushed',
  'pulled', 'threw', 'throws', 'hurled', 'swung', 'swings', 'struck',
  'strikes', 'hit', 'hits', 'slammed', 'slams', 'smashed', 'crashed',
  'kicked', 'kicks', 'punched', 'punches', 'dodged', 'ducked', 'dove',
  'dived', 'scrambled', 'charged', 'chased', 'fled', 'burst', 'spun',
  'whirled', 'stumbled', 'staggered', 'fell', 'falls', 'caught', 'climbed',
  'sprang', 'raced', 'fired', 'stabbed', 'slashed', 'tackled', 'wrenched',
  'vaulted', 'swerved', 'crawled', 'crept',
];

const SPEECH_VERB_RE = SPEECH_VERBS.join('|');
const ACTION_VERB_RE = new RegExp(`\\b(?:${ACTION_VERBS.join('|')})\\b`, 'i');

/** Quoted dialogue spans — straight and curly double quotes. */
const QUOTE_SPAN_RE = /"[^"]*"|“[^”]*”/g;

// ── Text primitives ─────────────────────────────────────────────────────────

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Split prose into sentences on terminal punctuation (. ! ? …), keeping
 * trailing closing quotes/parens attached. A final unterminated fragment
 * counts as a sentence.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  const re = /[^.!?…]*[.!?…]+["'”’)\]]*/g;
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const s = m[0].trim();
    if (s && countWords(s) > 0) out.push(s);
    lastEnd = re.lastIndex;
  }
  const tail = text.slice(lastEnd).trim();
  if (tail && countWords(tail) > 0) out.push(tail);
  return out;
}

/** Strip quoted dialogue spans, leaving narration only. */
export function stripDialogue(text: string): string {
  return text.replace(QUOTE_SPAN_RE, ' ');
}

interface Paragraph {
  text: string;
  blockType: BlockType;
  /** 1-based index across the scene. */
  index: number;
}

/**
 * Flatten a scene into paragraphs. Blocks are the editor's paragraphs; content
 * containing blank lines is split further. `note` blocks are authorial and
 * never counted as manuscript text.
 */
export function sceneParagraphs(scene: AnalyzableScene): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const blocks = [...scene.blocks].sort((a, b) => a.order - b.order);
  for (const block of blocks) {
    if (block.type === 'note') continue;
    for (const chunk of block.content.split(/\n\s*\n/)) {
      const text = chunk.trim();
      if (!text) continue;
      paragraphs.push({ text, blockType: block.type, index: paragraphs.length + 1 });
    }
  }
  return paragraphs;
}

// ── Dialogue / description / action split ───────────────────────────────────

interface CategoryWords {
  dialogue: number;
  description: number;
  action: number;
}

/**
 * Word split by category. Typed blocks (`dialogue`/`action`/`description`)
 * are authoritative (§5.4: "use the scene's block types where available").
 * Untyped prose falls back to text heuristics: quoted spans are dialogue;
 * remaining sentences are action when they carry a motion/impact verb,
 * description otherwise.
 */
function categorizeWords(paragraphs: Paragraph[]): CategoryWords {
  const acc: CategoryWords = { dialogue: 0, description: 0, action: 0 };
  for (const p of paragraphs) {
    const total = countWords(p.text);
    if (total === 0) continue;
    if (p.blockType === 'dialogue') { acc.dialogue += total; continue; }
    if (p.blockType === 'action') { acc.action += total; continue; }
    if (p.blockType === 'description') { acc.description += total; continue; }
    // prose / heading — heuristic split
    let quoted = 0;
    for (const span of p.text.match(QUOTE_SPAN_RE) ?? []) quoted += countWords(span);
    acc.dialogue += quoted;
    const narration = stripDialogue(p.text);
    for (const sentence of splitSentences(narration)) {
      const w = countWords(sentence);
      if (ACTION_VERB_RE.test(sentence)) acc.action += w;
      else acc.description += w;
    }
  }
  return acc;
}

/** Integer percentages that always sum to 100 (largest bucket absorbs drift). */
function toPercentages(acc: CategoryWords): { dialoguePct: number; descriptionPct: number; actionPct: number } {
  const total = acc.dialogue + acc.description + acc.action;
  if (total === 0) return { dialoguePct: 0, descriptionPct: 0, actionPct: 0 };
  const raw = {
    dialoguePct: Math.round((acc.dialogue / total) * 100),
    descriptionPct: Math.round((acc.description / total) * 100),
    actionPct: Math.round((acc.action / total) * 100),
  };
  const drift = 100 - (raw.dialoguePct + raw.descriptionPct + raw.actionPct);
  if (drift !== 0) {
    const largest = (['dialoguePct', 'descriptionPct', 'actionPct'] as const)
      .reduce((a, b) => (raw[a] >= raw[b] ? a : b));
    raw[largest] += drift;
  }
  return raw;
}

// ── Filter words ────────────────────────────────────────────────────────────

const FILTER_WORD_RE = new RegExp(`\\b(${FILTER_WORDS.join('|')})\\b`, 'gi');

function findFilterWords(paragraphs: Paragraph[]): FilterWordHit[] {
  const hits: FilterWordHit[] = [];
  for (const p of paragraphs) {
    if (p.blockType === 'dialogue') continue; // narration only
    const narration = stripDialogue(p.text);
    for (const m of narration.matchAll(FILTER_WORD_RE)) {
      hits.push({ word: m[1].toLowerCase(), paragraph: p.index });
    }
  }
  return hits;
}

// ── Adverb dialogue tags ────────────────────────────────────────────────────

const TAG_AFTER_RE = new RegExp(`\\b(?:${SPEECH_VERB_RE})(?:\\s+\\S+){0,2}?\\s+([A-Za-z]+ly)\\b`, 'gi');
const TAG_BEFORE_RE = new RegExp(`\\b([A-Za-z]+ly)\\s+(?:${SPEECH_VERB_RE})\\b`, 'gi');

function isMannerAdverb(word: string): boolean {
  const w = word.toLowerCase();
  return w.length > 4 && w.endsWith('ly') && !LY_EXCEPTIONS.has(w);
}

/**
 * Count adverb-carrying dialogue tags ("…," she said nervously / he nervously
 * asked). Only sentences that actually contain a quote character qualify —
 * "he walked slowly" is not a dialogue tag.
 */
function countAdverbDialogueTags(paragraphs: Paragraph[]): number {
  let count = 0;
  for (const p of paragraphs) {
    for (const sentence of splitSentences(p.text)) {
      if (!/["“”]/.test(sentence)) continue;
      const narration = stripDialogue(sentence);
      const seen = new Set<number>();
      for (const m of narration.matchAll(TAG_AFTER_RE)) {
        if (isMannerAdverb(m[1])) seen.add(narration.indexOf(m[1], m.index));
      }
      for (const m of narration.matchAll(TAG_BEFORE_RE)) {
        if (isMannerAdverb(m[1])) seen.add(m.index ?? 0);
      }
      count += seen.size;
    }
  }
  return count;
}

// ── POV & pacing heuristics ─────────────────────────────────────────────────

function detectPov(paragraphs: Paragraph[]): ComputedSceneMetrics['pov'] {
  let first = 0;
  let second = 0;
  let third = 0;
  for (const p of paragraphs) {
    if (p.blockType === 'dialogue') continue;
    const narration = stripDialogue(p.text);
    first += (narration.match(/\b(I|I'm|I'd|I'll|I've)\b/g) ?? []).length;
    first += (narration.match(/\b(me|my|mine|myself|we|us|our|ours)\b/gi) ?? []).length;
    second += (narration.match(/\b(you|your|yours|yourself)\b/gi) ?? []).length;
    third += (narration.match(/\b(he|she|his|her|hers|him|himself|herself|they|them|their|theirs)\b/gi) ?? []).length;
  }
  if (first === 0 && second === 0 && third === 0) return 'Unclear';
  // First-person markers in narration are near-definitive: third-person
  // narration contains no bare "I"/"my" once dialogue is stripped.
  if (first >= 2 && first >= second) return 'First person';
  if (second > third && second >= 2) return 'Second person';
  if (third > 0) return 'Third person';
  return 'Unclear';
}

function detectPacing(avgSentenceWords: number): ComputedSceneMetrics['pacing'] {
  if (avgSentenceWords === 0) return 'Medium';
  if (avgSentenceWords < FAST_MAX_AVG) return 'Fast';
  if (avgSentenceWords <= MEDIUM_MAX_AVG) return 'Medium';
  return 'Slow';
}

// ── Main entry ──────────────────────────────────────────────────────────────

export function computeSceneMetrics(scene: AnalyzableScene): ComputedSceneMetrics {
  const paragraphs = sceneParagraphs(scene);

  let words = 0;
  let sentenceCount = 0;
  for (const p of paragraphs) {
    words += countWords(p.text);
    sentenceCount += splitSentences(p.text).length;
  }
  const avgSentenceWords = sentenceCount === 0 ? 0 : words / sentenceCount;

  const { dialoguePct, descriptionPct, actionPct } = toPercentages(categorizeWords(paragraphs));
  const filterWordHits = findFilterWords(paragraphs);

  return {
    words,
    readTimeMinutes: words === 0 ? 0 : Math.max(1, Math.round(words / READ_WPM)),
    sentenceCount,
    avgSentenceWords,
    dialoguePct,
    descriptionPct,
    actionPct,
    filterWordTotal: filterWordHits.length,
    filterWordHits,
    adverbDialogueTags: countAdverbDialogueTags(paragraphs),
    pov: detectPov(paragraphs),
    pacing: detectPacing(avgSentenceWords),
  };
}

// ── Formatters (prototype value shapes — HTML 4234 / 5848) ──────────────────

/** '1842' → '1,842' */
export function formatWordCount(words: number): string {
  return words.toLocaleString('en-US');
}

/** '~7 min' (prototype); '0 min' for an empty scene. */
export function formatReadTime(metrics: Pick<ComputedSceneMetrics, 'words' | 'readTimeMinutes'>): string {
  if (metrics.words === 0) return '0 min';
  return `~${metrics.readTimeMinutes} min`;
}

/** '16.4 words' */
export function formatAvgSentenceLength(avgSentenceWords: number): string {
  return `${avgSentenceWords.toFixed(1)} words`;
}

/** '38% · 47% · 15%' */
export function formatSplit(m: Pick<ComputedSceneMetrics, 'dialoguePct' | 'descriptionPct' | 'actionPct'>): string {
  return `${m.dialoguePct}% · ${m.descriptionPct}% · ${m.actionPct}%`;
}

/**
 * '9 — clustered in ¶2' when ≥half the hits share one paragraph (and ≥3 hits),
 * else '4 — ¶1, ¶3, ¶7' (up to 3 paragraphs, then 'across N paragraphs').
 */
export function formatFilterWordSummary(
  m: Pick<ComputedSceneMetrics, 'filterWordTotal' | 'filterWordHits'>,
): string {
  const total = m.filterWordTotal;
  if (total === 0) return '0';
  const byParagraph = new Map<number, number>();
  for (const hit of m.filterWordHits) {
    byParagraph.set(hit.paragraph, (byParagraph.get(hit.paragraph) ?? 0) + 1);
  }
  const sorted = [...byParagraph.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const [topParagraph, topCount] = sorted[0];
  if (total >= 3 && topCount * 2 >= total) return `${total} — clustered in ¶${topParagraph}`;
  const paragraphs = [...byParagraph.keys()].sort((a, b) => a - b);
  if (paragraphs.length > 3) return `${total} — across ${paragraphs.length} paragraphs`;
  return `${total} — ${paragraphs.map((p) => `¶${p}`).join(', ')}`;
}

/**
 * The COMPUTED · LOCAL · FREE grid rows, in prototype order with prototype
 * labels (HTML 4234). Feeds `CoachAnalysisCard.computed` directly.
 */
export function computedAnalysisRows(m: ComputedSceneMetrics): Array<[string, string]> {
  return [
    ['Words', formatWordCount(m.words)],
    ['Read time', formatReadTime(m)],
    ['Avg sentence length', formatAvgSentenceLength(m.avgSentenceWords)],
    ['Dialogue · Description · Action', formatSplit(m)],
    ['Filter words (felt, saw, heard)', formatFilterWordSummary(m)],
    ['Adverb dialogue tags', String(m.adverbDialogueTags)],
  ];
}

/**
 * One-line note under the right-panel card (prototype 3023: "Nice balance of
 * description and action.") — computed from the D/D/A split.
 */
export function sceneBalanceNote(m: ComputedSceneMetrics): string {
  if (m.words === 0) return 'Nothing to measure yet — the numbers fill in as you write.';
  if (m.dialoguePct >= 55) return 'Dialogue-heavy — grounding description runs thin here.';
  if (m.actionPct >= 55) return 'Action-forward — a breath of description could ground it.';
  if (m.descriptionPct >= 65) return 'Description-rich — a beat of motion would break it up.';
  if (Math.abs(m.descriptionPct - m.actionPct) <= 25) return 'Nice balance of description and action.';
  return 'Description leads — vary the rhythm with motion or a line of talk.';
}
