// Beat-sheet templates — Beta 4 M14 (FULL-SPEC §5.3: "beat-sheet templates
// in right panel"). Three frameworks, matching the prototype template list
// (tlTpls 4178–4184: Three-Act Structure / Save the Cat / Hero's Journey)
// with the beat pct labels from the prototype beat panel (beatActs 6373–6377).
//
// Save the Cat keeps its Beta 3 beat ids so persisted scene→beat assignments
// (`mythos-beats-v1:<vault>`) survive the M14 refresh; the other templates'
// ids are prefixed (`ta-` / `hj-`) so all beat ids stay globally unique.

export type BeatActId = 'setup' | 'confrontation' | 'resolution';

export interface Beat {
  id: string;
  act: BeatActId;
  name: string;
  /** Position label rendered in the beat row (prototype "1%", "50%"…). */
  pct: string;
}

export interface ActSection {
  id: BeatActId;
  title: string;
  beats: Beat[];
}

export type BeatTemplateId = 'save-the-cat' | 'three-act' | 'heros-journey';

export interface BeatTemplate {
  id: BeatTemplateId;
  /** Picker label. */
  name: string;
  acts: ActSection[];
}

// Prototype act eyebrows (3119: "ACT I — SETUP" …)
const ACT_TITLES: Record<BeatActId, string> = {
  setup: 'ACT I — SETUP',
  confrontation: 'ACT II — CONFRONTATION',
  resolution: 'ACT III — RESOLUTION',
};

function act(id: BeatActId, beats: Array<[string, string, string]>): ActSection {
  return {
    id,
    title: ACT_TITLES[id],
    beats: beats.map(([beatId, name, pct]) => ({ id: beatId, act: id, name, pct })),
  };
}

// ─── Save the Cat — 15 beats (Beta 3 ids preserved) ───

const SAVE_THE_CAT: BeatTemplate = {
  id: 'save-the-cat',
  name: 'Save the Cat (3-Act)',
  acts: [
    act('setup', [
      ['opening-image', 'Opening Image', '1%'],
      ['theme-stated', 'Theme Stated', '5%'],
      ['setup', 'Setup', '4%'],
      ['catalyst', 'Catalyst', '10%'],
      ['debate', 'Debate', '12%'],
    ]),
    act('confrontation', [
      ['break-into-2', 'Break Into 2', '20%'],
      ['b-story', 'B Story', '22%'],
      ['fun-and-games', 'Fun & Games', '30%'],
      ['midpoint', 'Midpoint', '50%'],
      ['bad-guys-close-in', 'Bad Guys Close In', '60%'],
      ['all-is-lost', 'All Is Lost', '75%'],
      ['dark-night', 'Dark Night of the Soul', '78%'],
    ]),
    act('resolution', [
      ['break-into-3', 'Break Into 3', '80%'],
      ['finale', 'Finale', '85%'],
      ['final-image', 'Final Image', '99%'],
    ]),
  ],
};

// ─── Three-Act Structure — 7 beats (prototype tlTpls[0]) ───

const THREE_ACT: BeatTemplate = {
  id: 'three-act',
  name: 'Three-Act Structure',
  acts: [
    act('setup', [
      ['ta-setup', 'Setup', '1%'],
      ['ta-inciting-incident', 'Inciting Incident', '12%'],
      ['ta-plot-point-one', 'Plot Point One', '25%'],
    ]),
    act('confrontation', [
      ['ta-midpoint', 'Midpoint', '50%'],
      ['ta-plot-point-two', 'Plot Point Two', '75%'],
    ]),
    act('resolution', [
      ['ta-climax', 'Climax', '90%'],
      ['ta-resolution', 'Resolution', '99%'],
    ]),
  ],
};

// ─── Hero's Journey — 8 beats (prototype tlTpls[2]) ───

const HEROS_JOURNEY: BeatTemplate = {
  id: 'heros-journey',
  name: 'Hero’s Journey',
  acts: [
    act('setup', [
      ['hj-ordinary-world', 'Ordinary World', '1%'],
      ['hj-call-to-adventure', 'Call to Adventure', '10%'],
      ['hj-refusal', 'Refusal of the Call', '15%'],
    ]),
    act('confrontation', [
      ['hj-crossing-threshold', 'Crossing the Threshold', '25%'],
      ['hj-tests-allies', 'Tests & Allies', '40%'],
      ['hj-ordeal', 'The Ordeal', '60%'],
    ]),
    act('resolution', [
      ['hj-road-back', 'The Road Back', '75%'],
      ['hj-return-elixir', 'Return with the Elixir', '99%'],
    ]),
  ],
};

export const BEAT_TEMPLATES: BeatTemplate[] = [SAVE_THE_CAT, THREE_ACT, HEROS_JOURNEY];

export const DEFAULT_TEMPLATE_ID: BeatTemplateId = 'save-the-cat';

export function getBeatTemplate(id: string | null | undefined): BeatTemplate {
  return BEAT_TEMPLATES.find((t) => t.id === id) ?? SAVE_THE_CAT;
}

/** Flat beats of one template, in order. */
export function beatsOf(template: BeatTemplate): Beat[] {
  return template.acts.flatMap((a) => a.beats);
}

// ─── Backward-compatible exports (Beta 3 consumers/tests) ───

/** Save the Cat act sections — the default template's acts. */
export const BEAT_ACTS: ActSection[] = SAVE_THE_CAT.acts;

/** Flat list of every beat across ALL templates (ids are globally unique). */
export const ALL_BEATS: Beat[] = BEAT_TEMPLATES.flatMap(beatsOf);
