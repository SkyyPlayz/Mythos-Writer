// Creative Quality Controls — preset definitions and helpers (SKY-507 / SKY-456)

export type ToneValue = 'grim' | 'serious' | 'balanced' | 'warm' | 'joyful';
export type PovValue = 'first' | 'second' | 'third-limited' | 'third-omniscient' | 'epistolary';
export type TenseValue = 'past' | 'present' | 'future';
export type LengthValue = 'snippet' | 'brief' | 'moderate' | 'thorough' | 'expansive';
export type AudienceValue = 'children' | 'young-adult' | 'adult' | 'academic';

export interface PresetAxes {
  genre: string;
  tone: ToneValue;
  pov: PovValue;
  tense: TenseValue;
  length: LengthValue;
  audience: AudienceValue;
  contentConstraints: string[];
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  axes: PresetAxes;
}

export interface RefinementChip {
  id: string;
  label: string;
  description: string;
  adjustAxes: (axes: PresetAxes) => Partial<PresetAxes>;
}

// ─── Axis value sets ────────────────────────────────────────────────────────

export const TONE_VALUES: ToneValue[] = ['grim', 'serious', 'balanced', 'warm', 'joyful'];
export const TONE_LABELS: Record<ToneValue, string> = {
  grim: 'Grim',
  serious: 'Serious',
  balanced: 'Balanced',
  warm: 'Warm',
  joyful: 'Joyful',
};

export const POV_VALUES: PovValue[] = ['first', 'second', 'third-limited', 'third-omniscient', 'epistolary'];
export const POV_LABELS: Record<PovValue, string> = {
  first: 'First Person',
  second: 'Second Person',
  'third-limited': 'Third Person Limited',
  'third-omniscient': 'Third Person Omniscient',
  epistolary: 'Epistolary',
};

export const TENSE_VALUES: TenseValue[] = ['past', 'present', 'future'];
export const TENSE_LABELS: Record<TenseValue, string> = {
  past: 'Past',
  present: 'Present',
  future: 'Future',
};

export const LENGTH_VALUES: LengthValue[] = ['snippet', 'brief', 'moderate', 'thorough', 'expansive'];
export const LENGTH_LABELS: Record<LengthValue, string> = {
  snippet: 'Snippet',
  brief: 'Brief',
  moderate: 'Moderate',
  thorough: 'Thorough',
  expansive: 'Expansive',
};

export const AUDIENCE_VALUES: AudienceValue[] = ['children', 'young-adult', 'adult', 'academic'];
export const AUDIENCE_LABELS: Record<AudienceValue, string> = {
  children: 'Children (8–12)',
  'young-adult': 'Young Adult (13–18)',
  adult: 'Adult',
  academic: 'Academic',
};

export const GENRES = [
  'Fantasy',
  'Romance',
  'Mystery',
  'Science Fiction',
  'Literary',
  'Historical',
  'Horror',
  'Thriller',
];

export const CONTENT_CONSTRAINTS = [
  { id: 'explicit-violence', label: 'Explicit violence' },
  { id: 'sexual-content', label: 'Sexual content' },
  { id: 'profanity', label: 'Profanity' },
  { id: 'real-world-politics', label: 'Real-world politics' },
  { id: 'graphic-descriptions', label: 'Graphic descriptions' },
  { id: 'sad-ending', label: 'Sad ending' },
  { id: 'cliffhanger', label: 'Cliffhanger' },
  { id: 'mundane-details', label: 'Mundane details' },
];

// ─── Bundled presets ─────────────────────────────────────────────────────────

export const BUNDLED_PRESETS: Preset[] = [
  {
    id: 'preset-epic-fantasy',
    name: 'Epic Fantasy',
    description: 'Grim & detailed',
    axes: {
      genre: 'Fantasy',
      tone: 'serious',
      pov: 'third-limited',
      tense: 'past',
      length: 'moderate',
      audience: 'adult',
      contentConstraints: [],
    },
  },
  {
    id: 'preset-modern-romance',
    name: 'Modern Romance',
    description: 'Warm & emotional',
    axes: {
      genre: 'Romance',
      tone: 'warm',
      pov: 'first',
      tense: 'present',
      length: 'moderate',
      audience: 'adult',
      contentConstraints: [],
    },
  },
  {
    id: 'preset-cozy-mystery',
    name: 'Cozy Mystery',
    description: 'Balanced & clever',
    axes: {
      genre: 'Mystery',
      tone: 'balanced',
      pov: 'third-limited',
      tense: 'past',
      length: 'moderate',
      audience: 'adult',
      contentConstraints: [],
    },
  },
  {
    id: 'preset-literary-fiction',
    name: 'Literary Fiction',
    description: 'Somber & introspective',
    axes: {
      genre: 'Literary',
      tone: 'grim',
      pov: 'first',
      tense: 'past',
      length: 'expansive',
      audience: 'adult',
      contentConstraints: [],
    },
  },
  {
    id: 'preset-ya-adventure',
    name: 'YA Adventure',
    description: 'Joyful & fast-paced',
    axes: {
      genre: 'Science Fiction',
      tone: 'joyful',
      pov: 'third-limited',
      tense: 'present',
      length: 'moderate',
      audience: 'young-adult',
      contentConstraints: ['explicit-violence', 'sexual-content', 'profanity'],
    },
  },
];

export const DEFAULT_PRESET_ID = 'preset-epic-fantasy';

// ─── Refinement chips ────────────────────────────────────────────────────────

function shiftTone(current: ToneValue, delta: number): ToneValue {
  const idx = TONE_VALUES.indexOf(current);
  return TONE_VALUES[Math.max(0, Math.min(TONE_VALUES.length - 1, idx + delta))];
}

function shiftLength(current: LengthValue, delta: number): LengthValue {
  const idx = LENGTH_VALUES.indexOf(current);
  return LENGTH_VALUES[Math.max(0, Math.min(LENGTH_VALUES.length - 1, idx + delta))];
}

export const REFINEMENT_CHIPS: RefinementChip[] = [
  {
    id: 'warmer',
    label: '+warmer',
    description: 'warmer, more emotional tone',
    adjustAxes: (a) => ({ tone: shiftTone(a.tone, 1) }),
  },
  {
    id: 'darker',
    label: '+darker',
    description: 'darker, more somber tone',
    adjustAxes: (a) => ({ tone: shiftTone(a.tone, -1) }),
  },
  {
    id: 'more-specific',
    label: '+specific',
    description: 'more concrete, vivid details',
    adjustAxes: (a) => ({ length: shiftLength(a.length, 1) }),
  },
  {
    id: 'shorter',
    label: '+shorter',
    description: 'shorter, more concise',
    adjustAxes: (a) => ({ length: shiftLength(a.length, -1) }),
  },
  {
    id: 'longer',
    label: '+longer',
    description: 'longer, more elaborate',
    adjustAxes: (a) => ({ length: shiftLength(a.length, 1) }),
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getPresetById(id: string): Preset {
  return BUNDLED_PRESETS.find((p) => p.id === id) ?? BUNDLED_PRESETS[0];
}

export function getEffectiveAxes(presetId: string, overrides: Partial<PresetAxes>): PresetAxes {
  return { ...getPresetById(presetId).axes, ...overrides };
}

export function buildPresetContext(axes: PresetAxes): string {
  const lines = [
    `Genre: ${axes.genre}`,
    `Tone: ${TONE_LABELS[axes.tone]}`,
    `POV: ${POV_LABELS[axes.pov]}`,
    `Tense: ${TENSE_LABELS[axes.tense]}`,
    `Length: ${LENGTH_LABELS[axes.length]}`,
    `Audience: ${AUDIENCE_LABELS[axes.audience]}`,
  ];
  if (axes.contentConstraints.length > 0) {
    const labels = axes.contentConstraints
      .map((id) => CONTENT_CONSTRAINTS.find((c) => c.id === id)?.label ?? id)
      .join(', ');
    lines.push(`Avoid: ${labels}`);
  }
  return `[Writing style: ${lines.join(' | ')}]`;
}

// sessionStorage keys
export const SESSION_PRESET_ID_KEY = 'mythos:session-preset-id';
export const SESSION_PRESET_OVERRIDES_KEY = 'mythos:session-preset-overrides';

export function loadSessionPreset(): { presetId: string; overrides: Partial<PresetAxes> } {
  let presetId = DEFAULT_PRESET_ID;
  let overrides: Partial<PresetAxes> = {};
  try {
    const storedId = sessionStorage.getItem(SESSION_PRESET_ID_KEY);
    if (storedId && BUNDLED_PRESETS.some((p) => p.id === storedId)) {
      presetId = storedId;
    }
    const storedOverrides = sessionStorage.getItem(SESSION_PRESET_OVERRIDES_KEY);
    if (storedOverrides) overrides = JSON.parse(storedOverrides);
  } catch { /* ignore malformed storage */ }
  return { presetId, overrides };
}

export function saveSessionPreset(presetId: string, overrides: Partial<PresetAxes>): void {
  try {
    sessionStorage.setItem(SESSION_PRESET_ID_KEY, presetId);
    sessionStorage.setItem(SESSION_PRESET_OVERRIDES_KEY, JSON.stringify(overrides));
  } catch { /* ignore quota errors */ }
}
