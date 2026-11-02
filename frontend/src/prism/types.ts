// Prism (#1764, decisions 77) — rule-only prose checks. Shared contract for the
// rule engine (rules.ts), the manuscript decoration layer (PrismExtension.ts),
// the per-book settings store (settings.ts / store.ts) and the sidebar
// Analytics checklist (components/Prism/PrismChecklist.tsx).
//
// Everything here is plain rules over the manuscript text: no AI, no network.
// Prism only marks prose; the writer does the editing (no auto-fix, no rewrite).

/** Issue checks — drawn as underlines when the "Flags" master switch is on. */
export type PrismFlagCheckId =
  | 'overused-words'
  | 'crutch-words'
  | 'adverbs'
  | 'passive-voice'
  | 'long-sentences'
  | 'filter-words'
  | 'dialogue-tags'
  | 'repeated-starts'
  | 'punctuation-consistency';

/** Voice-layer tints — drawn as soft text tints when "Prose colors" is on. */
export type PrismTintCheckId = 'dialogue' | 'inner-monologue' | 'narrator';

export type PrismCheckId = PrismFlagCheckId | PrismTintCheckId;

export type PrismCheckKind = 'flag' | 'tint';

export interface PrismCheckDef {
  id: PrismCheckId;
  kind: PrismCheckKind;
  /** Sentence-case label shown in the checklist. */
  label: string;
  /** One-line plain-language description (tooltip / helper text). */
  description: string;
}

/** Display order in the checklist. Flags first, then voice tints. */
export const PRISM_CHECKS: readonly PrismCheckDef[] = [
  { id: 'overused-words', kind: 'flag', label: 'Overused words', description: 'The same word used again and again close together.' },
  { id: 'crutch-words', kind: 'flag', label: 'Crutch words', description: 'Filler like “just”, “really”, “very” and “suddenly”.' },
  { id: 'adverbs', kind: 'flag', label: 'Adverbs', description: 'Words ending in “-ly” that often prop up a weak verb.' },
  { id: 'passive-voice', kind: 'flag', label: 'Passive voice', description: 'A form of “to be” plus a past participle (“was taken”).' },
  { id: 'long-sentences', kind: 'flag', label: 'Long sentences', description: 'Sentences long enough to be hard to read in one breath.' },
  { id: 'filter-words', kind: 'flag', label: 'Filter words', description: 'Words like “saw”, “felt” and “heard” that put distance between reader and scene.' },
  { id: 'dialogue-tags', kind: 'flag', label: 'Dialogue tags', description: 'Fancy speech tags (“exclaimed”, “retorted”) or tags propped up by an adverb.' },
  { id: 'repeated-starts', kind: 'flag', label: 'Repeated sentence starts', description: 'Back-to-back sentences that open with the same word.' },
  { id: 'punctuation-consistency', kind: 'flag', label: 'Quote and dash consistency', description: 'Straight and curly quotes, or different dash styles, mixed in one scene.' },
  { id: 'dialogue', kind: 'tint', label: 'Dialogue', description: 'Speech inside quotation marks.' },
  { id: 'inner-monologue', kind: 'tint', label: 'Inner monologue', description: 'Italic text outside dialogue, often a character’s thoughts.' },
  { id: 'narrator', kind: 'tint', label: 'Narrator', description: 'Narration: everything that is not dialogue or inner monologue.' },
] as const;

export const PRISM_CHECK_IDS: readonly PrismCheckId[] = PRISM_CHECKS.map((c) => c.id);

export function isPrismCheckId(v: unknown): v is PrismCheckId {
  return typeof v === 'string' && (PRISM_CHECK_IDS as readonly string[]).includes(v);
}

export function prismCheckDef(id: PrismCheckId): PrismCheckDef {
  // PRISM_CHECKS covers every id in the union, so the lookup never misses.
  return PRISM_CHECKS.find((c) => c.id === id) as PrismCheckDef;
}

/** Tunable thresholds. Shipped defaults live in DEFAULT_PRISM_SETTINGS. */
export interface PrismThresholds {
  /** A sentence with more words than this is flagged by `long-sentences`. */
  longSentenceWords: number;
  /** `overused-words`: a word repeated this many times inside the window is flagged. */
  overusedMinRepeats: number;
  /** `overused-words`: sliding window size, in words. */
  overusedWindowWords: number;
}

/**
 * Per-book Prism settings, persisted as `<story.path>/prism.json`.
 * `flags` and `proseColors` are DISPLAY master switches only: detection keeps
 * running and the checklist keeps listing findings while they are off.
 */
export interface PrismSettings {
  version: 1;
  /** Master display switch for issue underlines (flag checks). */
  flags: boolean;
  /** Master display switch for voice-layer tints (tint checks). */
  proseColors: boolean;
  /** Per-check on/off. A check that is off is neither drawn nor listed. */
  checks: Record<PrismCheckId, boolean>;
  thresholds: PrismThresholds;
  /** Whether the sidebar Analytics section is expanded. */
  analyticsOpen: boolean;
}

/** One paragraph (ProseMirror textblock) of manuscript prose, as the engine sees it. */
export interface PrismParagraph {
  /**
   * The block's text. Inline atoms (wiki links, entity mentions) are replaced
   * by a single U+FFFC so string offsets stay 1:1 with document positions.
   */
  text: string;
  /** Half-open [from, to) string offsets of italic runs inside `text`. */
  italic: ReadonlyArray<readonly [number, number]>;
}

/** One rule hit. Offsets are half-open string offsets into `paragraphs[paragraph].text`. */
export interface PrismFinding {
  checkId: PrismCheckId;
  paragraph: number;
  from: number;
  to: number;
  /** Short, plain-language reason shown in the checklist and the mark tooltip. */
  message: string;
}

/** Scene-level readability numbers shown in the checklist header. */
export interface PrismStats {
  words: number;
  sentences: number;
  /** Rounded to one decimal; 0 when there are no sentences. */
  avgSentenceWords: number;
  /** Flesch reading ease, clamped to 0..100 and rounded; null when there are no words. */
  readingEase: number | null;
}

export interface PrismResult {
  findings: PrismFinding[];
  stats: PrismStats;
}
