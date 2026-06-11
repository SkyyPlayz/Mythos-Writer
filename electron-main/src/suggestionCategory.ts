// SKY-908 — Lightweight keyword categorizer for writing-assistant suggestions.
// No ML, no dependencies. Reads the rationale text and classifies into one of
// five high-level categories; falls back to 'other' when no signal hits.
//
// The matchers are deliberately broad so that auto-apply gating can be coarse
// at the category level — false positives degrade to the matched category's
// toggle, never to a misapplied edit (the actual edit still goes through the
// suggestion pipeline regardless of category).

export type SuggestionCategory =
  | 'punctuation'
  | 'spelling'
  | 'grammar'
  | 'sentence-structure'
  | 'style-tone'
  | 'other';

export const SUGGESTION_CATEGORIES: readonly SuggestionCategory[] = Object.freeze([
  'punctuation',
  'spelling',
  'grammar',
  'sentence-structure',
  'style-tone',
  'other',
]);

export const SUGGESTION_CATEGORY_LABELS: Readonly<Record<SuggestionCategory, string>> = Object.freeze({
  'punctuation': 'Punctuation',
  'spelling': 'Spelling',
  'grammar': 'Grammar',
  'sentence-structure': 'Sentence structure',
  'style-tone': 'Style / tone',
  'other': 'Other',
});

interface CategoryMatcher {
  category: SuggestionCategory;
  patterns: RegExp[];
}

// Order matters: more specific / compound phrases fire first.
// sentence-structure and grammar come before punctuation so that
// "comma splice" beats bare "comma" and "possessive" beats "apostrophe".
const MATCHERS: CategoryMatcher[] = [
  {
    category: 'sentence-structure',
    patterns: [
      /\b(sentence\s+(structure|length|fragment|fragments|order|flow|variety|rhythm)|run[-\s]?on|comma\s+splice|fragment|clause|paragraph\s+break|split\s+(the|this)\s+sentence|combine\s+sentences|restructure|reword\s+for\s+clarity|sentence\s+(too\s+long|too\s+short))\b/i,
    ],
  },
  {
    category: 'grammar',
    patterns: [
      /\b(grammar|grammat\w*|verb\s+tense|tense\s+(shift|agreement|consistency)|subject[-\s]?verb|pronoun(\s+(agreement|reference|antecedent))?|article(\s+usage)?|preposit\w*|possessive|plural|conjunction|its\s+vs\s+it'?s)\b/i,
    ],
  },
  {
    category: 'spelling',
    patterns: [
      /\b(spell\w*|mis[-\s]?spell\w*|typo|typographical|orthograph\w*)\b/i,
    ],
  },
  {
    category: 'punctuation',
    patterns: [
      /\b(comma|semicolon|colon|period|apostrophe|hyphen|em[-\s]?dash|en[-\s]?dash|quotation|quote\s+mark|punctuat\w*|oxford\s+comma|ellipsis)\b/i,
    ],
  },
  {
    category: 'style-tone',
    patterns: [
      /\b(style|tone|voice|word\s+choice|diction|register|formal|informal|colloquial|passive\s+voice|active\s+voice|adverb|cliché|cliche|repetitive|repetition|redundan\w*|verbose|wordy|concise|tighten|show\s*,?\s*don'?t\s*tell|telling\s+not\s+showing)\b/i,
    ],
  },
];

/**
 * Classify a suggestion rationale into a coarse category.
 * Returns 'other' when no keyword matcher hits.
 */
export function categorizeSuggestion(rationale: string | null | undefined): SuggestionCategory {
  if (!rationale) return 'other';
  for (const matcher of MATCHERS) {
    for (const pattern of matcher.patterns) {
      if (pattern.test(rationale)) return matcher.category;
    }
  }
  return 'other';
}

/**
 * Type guard / coercion for category strings read from disk or IPC.
 * Unknown values collapse to 'other' so an out-of-date renderer or a
 * forward-compat schema never crashes the gate.
 */
export function coerceSuggestionCategory(value: unknown): SuggestionCategory {
  if (typeof value !== 'string') return 'other';
  return (SUGGESTION_CATEGORIES as readonly string[]).includes(value)
    ? (value as SuggestionCategory)
    : 'other';
}

/**
 * Build an "all enabled" per-category map. Used as the back-compat default
 * when settings carry no autoApplyCategories field (pre-SKY-908 vault) but
 * the master autoApply boolean is true.
 */
export function allCategoriesEnabled(): Record<SuggestionCategory, boolean> {
  return {
    'punctuation': true,
    'spelling': true,
    'grammar': true,
    'sentence-structure': true,
    'style-tone': true,
    'other': true,
  };
}
