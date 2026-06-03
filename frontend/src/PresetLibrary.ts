// Creative quality controls — preset library and supporting utilities (SKY-456)

export type GenreKey = 'fantasy' | 'sci-fi' | 'romance' | 'literary' | 'mystery' | 'historical';
export type ToneKey = 'dark' | 'wry' | 'hopeful' | 'tense' | 'whimsical' | 'elegant' | 'clinical';
export type PovKey =
  | '1st-person'
  | '3rd-person-limited'
  | '3rd-person-omniscient'
  | 'alternating-1st-person'
  | '2nd-person';
export type LengthKey = 'brief' | 'medium' | 'long';
export type AudienceKey = 'literary' | 'ya' | 'children' | 'academic' | 'general';

export interface Preset {
  id: string;
  name: string;
  genre: GenreKey;
  tone: ToneKey;
  pov: PovKey;
  tense: 'past' | 'present' | 'future';
  length: LengthKey;
  audience: AudienceKey;
  constraints: string[];
  description: string;
}

export type RefinementAction =
  | 'more_specific'
  | 'shift_tone'
  | 'add_constraint'
  | 'shorter'
  | 'longer'
  | 'reject'
  | 'darken_it'
  | 'heighten_tension'
  | 'more_dialogue'
  | 'make_lighter'
  | 'make_age_appropriate';

export const STANDARD_REFINEMENT_ACTIONS: Array<{ action: RefinementAction; label: string }> = [
  { action: 'more_specific', label: 'More specific' },
  { action: 'shift_tone', label: 'Shift tone' },
  { action: 'add_constraint', label: 'Add constraint' },
  { action: 'shorter', label: 'Shorter' },
  { action: 'longer', label: 'Longer' },
  { action: 'reject', label: 'Reject' },
];

export function getDynamicActions(preset: Preset): Array<{ action: RefinementAction; label: string }> {
  const dynamic: Array<{ action: RefinementAction; label: string }> = [];
  if (preset.tone === 'dark') dynamic.push({ action: 'darken_it', label: 'Darken it' });
  if (preset.tone === 'tense') dynamic.push({ action: 'heighten_tension', label: 'Heighten tension' });
  if (preset.tone === 'whimsical') dynamic.push({ action: 'make_lighter', label: 'Make it lighter' });
  if (preset.audience === 'ya') dynamic.push({ action: 'make_age_appropriate', label: 'Make age-appropriate' });
  if (preset.constraints.includes('dialogue-heavy')) dynamic.push({ action: 'more_dialogue', label: 'More dialogue' });
  return dynamic;
}

export function getRefinementInstruction(action: RefinementAction, additionalInstruction?: string): string {
  const base: Record<RefinementAction, string> = {
    more_specific:
      'Make this suggestion more specific. Remove generic phrasing and ground it in concrete, vivid detail.',
    shift_tone:
      'Shift the emotional tone of this suggestion. Change the emotional flavor while keeping the core idea.',
    add_constraint: additionalInstruction
      ? `Add this constraint to the suggestion: ${additionalInstruction}`
      : 'Add a specific creative constraint to make this suggestion more focused and distinctive.',
    shorter:
      'Condense this suggestion to 1–2 sentences. Tighten the prose while preserving the key idea.',
    longer:
      'Expand this suggestion to a full paragraph or more. Add detail, nuance, and texture.',
    reject:
      'This suggestion is not useful. Provide a completely different approach to the same goal.',
    darken_it:
      'Darken the tone. Make it more morally complex, intense, or emotionally weighty.',
    heighten_tension:
      'Heighten the tension. Raise the stakes and increase the sense of urgency.',
    more_dialogue:
      'Incorporate more dialogue so characters speak directly, revealing the situation through their voices.',
    make_lighter:
      'Make this suggestion lighter and more whimsical. Add warmth, humor, or a sense of wonder.',
    make_age_appropriate:
      'Adjust for a YA audience. Keep the emotional authenticity but avoid adult themes.',
  };
  return base[action];
}

const POV_LABEL: Record<PovKey, string> = {
  '1st-person': '1st-person',
  '3rd-person-limited': '3rd-person limited',
  '3rd-person-omniscient': '3rd-person omniscient',
  'alternating-1st-person': 'alternating 1st-person',
  '2nd-person': '2nd-person',
};

// Option B from spec §5.4 Q1: structured context block
export function buildPresetContextBlock(preset: Preset): string {
  const lines = [
    `[WRITING STYLE PRESET: ${preset.name}]`,
    `Genre: ${preset.genre}`,
    `Tone: ${preset.tone}`,
    `POV: ${POV_LABEL[preset.pov]}`,
    `Tense: ${preset.tense}`,
    `Length preference: ${preset.length}`,
    `Audience: ${preset.audience}`,
  ];
  if (preset.constraints.length > 0) {
    lines.push(`Constraints: ${preset.constraints.join(', ')}`);
  }
  return lines.join('\n');
}

export interface RubricCriterion {
  id: string;
  name: string;
  description: string;
  /** Descriptive anchor for each star level: index 0=1-star, 1=2-star, 2=3-star */
  anchors: [string, string, string];
}

export const QUALITY_RUBRIC: RubricCriterion[] = [
  {
    id: 'specificity',
    name: 'Specificity',
    description: 'The suggestion avoids clichés and grounds ideas in concrete, vivid detail.',
    anchors: [
      'Vague, clichéd, or generic phrasing.',
      'Grounded but could be more vivid.',
      'Concrete, precise, and evocative.',
    ],
  },
  {
    id: 'coherence',
    name: 'Coherence',
    description: 'The suggestion fits the scene context, character voice, and tone without contradiction.',
    anchors: [
      'Contradicts prior context or breaks established tone.',
      'Mostly coherent but has minor gaps or voice inconsistencies.',
      'Seamlessly fits scene, tone, and character voice.',
    ],
  },
  {
    id: 'genre-fit',
    name: 'Genre Fit',
    description: 'The suggestion respects and leverages the conventions of the stated genre.',
    anchors: [
      'Violates genre conventions or feels out-of-place.',
      "Respects genre conventions but doesn't leverage genre strengths.",
      'Embraces genre strengths; written with genre conventions in mind.',
    ],
  },
  {
    id: 'constraint-respect',
    name: 'Constraint Respect',
    description: 'The suggestion honors stated constraints and preset rules without feeling forced.',
    anchors: [
      'Violates stated constraints or preset rules.',
      "Respects constraints but doesn't integrate them naturally.",
      'Integrates constraints seamlessly into the suggestion.',
    ],
  },
  {
    id: 'usefulness',
    name: 'Usefulness as a Starter',
    description: 'The suggestion can be adopted or serve as a strong foundation with minimal editing.',
    anchors: [
      'User must rewrite most or all of the suggestion.',
      'User needs to edit parts; some phrasing can be adopted directly.',
      'User can adopt directly or use as a strong foundation.',
    ],
  },
  {
    id: 'actionability',
    name: 'Actionability',
    description: 'The advice is specific and immediately applicable, not vague or generic.',
    anchors: [
      'Advice is vague or hard to apply.',
      'Advice is clear but generic.',
      'Advice is specific and immediately applicable.',
    ],
  },
];

// 12 bundled presets (spec §1.2)
export const PRESET_LIBRARY: Preset[] = [
  // Fantasy
  {
    id: 'fantasy-epic-dark',
    name: 'Fantasy — Epic & Dark',
    genre: 'fantasy',
    tone: 'dark',
    pov: '3rd-person-limited',
    tense: 'past',
    length: 'long',
    audience: 'literary',
    constraints: [],
    description: 'Vast worlds, high stakes, morally complex.',
  },
  {
    id: 'fantasy-cozy-whimsical',
    name: 'Fantasy — Cozy & Whimsical',
    genre: 'fantasy',
    tone: 'whimsical',
    pov: '1st-person',
    tense: 'past',
    length: 'medium',
    audience: 'general',
    constraints: [],
    description: 'Low-stakes magic and community focus.',
  },
  // Science Fiction
  {
    id: 'scifi-hard-technical',
    name: 'Sci-Fi — Hard & Technical',
    genre: 'sci-fi',
    tone: 'clinical',
    pov: '3rd-person-omniscient',
    tense: 'past',
    length: 'long',
    audience: 'literary',
    constraints: [],
    description: 'Prioritize plausible tech and world logic.',
  },
  {
    id: 'scifi-noir-dystopian',
    name: 'Sci-Fi — Noir & Dystopian',
    genre: 'sci-fi',
    tone: 'wry',
    pov: '1st-person',
    tense: 'past',
    length: 'medium',
    audience: 'literary',
    constraints: [],
    description: 'Corrupt institutions, cynical narration.',
  },
  // Romance
  {
    id: 'romance-slow-burn',
    name: 'Romance — Slow-Burn Tension',
    genre: 'romance',
    tone: 'tense',
    pov: 'alternating-1st-person',
    tense: 'past',
    length: 'long',
    audience: 'general',
    constraints: [],
    description: 'Emotional conflict before resolution.',
  },
  {
    id: 'romance-sweet-grounded',
    name: 'Romance — Sweet & Grounded',
    genre: 'romance',
    tone: 'hopeful',
    pov: '1st-person',
    tense: 'past',
    length: 'medium',
    audience: 'general',
    constraints: [],
    description: 'Real-world settings, focus on connection.',
  },
  // Literary
  {
    id: 'literary-introspective',
    name: 'Literary — Introspective',
    genre: 'literary',
    tone: 'elegant',
    pov: '1st-person',
    tense: 'past',
    length: 'long',
    audience: 'literary',
    constraints: [],
    description: 'Internal narrative, metaphorical language.',
  },
  {
    id: 'literary-minimalist',
    name: 'Literary — Minimalist',
    genre: 'literary',
    tone: 'clinical',
    pov: '3rd-person-limited',
    tense: 'past',
    length: 'medium',
    audience: 'literary',
    constraints: [],
    description: "Spare prose, show-don't-tell philosophy.",
  },
  // Mystery / Thriller
  {
    id: 'mystery-classic-whodunit',
    name: 'Mystery — Classic Whodunit',
    genre: 'mystery',
    tone: 'tense',
    pov: '3rd-person-limited',
    tense: 'past',
    length: 'long',
    audience: 'general',
    constraints: [],
    description: 'Fair-play clues, puzzle-focused.',
  },
  {
    id: 'mystery-breakneck-pace',
    name: 'Mystery — Breakneck Pace',
    genre: 'mystery',
    tone: 'dark',
    pov: '3rd-person-limited',
    tense: 'past',
    length: 'long',
    audience: 'general',
    constraints: [],
    description: 'Action-driven, escalating stakes.',
  },
  // Historical
  {
    id: 'historical-period-authentic',
    name: 'Historical — Period Authentic',
    genre: 'historical',
    tone: 'elegant',
    pov: '3rd-person-limited',
    tense: 'past',
    length: 'long',
    audience: 'literary',
    constraints: [],
    description: 'Period-accurate language and customs.',
  },
  {
    id: 'historical-modern-sensibility',
    name: 'Historical — Modern Sensibility',
    genre: 'historical',
    tone: 'wry',
    pov: '1st-person',
    tense: 'past',
    length: 'medium',
    audience: 'general',
    constraints: [],
    description: 'Contemporary voice in historical setting.',
  },
];

export function getPresetById(id: string): Preset | undefined {
  return PRESET_LIBRARY.find((p) => p.id === id);
}
