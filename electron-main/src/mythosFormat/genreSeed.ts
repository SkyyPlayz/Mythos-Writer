// Beta 4 M29 — genre starter notes for the Welcome wizard.
//
// When the wizard's genre step picks a preset, vault creation seeds three
// craft notes into the Notes Vault — a Story Templates note, a Beat Sheet
// note, and an Agent Personas note — each tuned to the chosen genre
// (FULL-SPEC §13 wizard: "Seeds note templates, beat sheet and agent
// personas"). Seeding happens at CREATION time only, alongside the Veynn
// demo seed; no boot or replay path re-runs it (W0.1 rule).
//
// Pure Node.

import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from '../vault.js';
import { notesVaultRootFor } from './mythosJson.js';

/** Canonical wizard genre presets (prototype `this.genres`, HTML 3118).
 *  The frontend mirrors this list in OnboardingWizard.tsx (WIZARD_GENRES);
 *  the IPC handler validates payloads against this allowlist. */
export const GENRE_SEED_GENRES = [
  'Epic Fantasy',
  'Dark Fantasy',
  'Sci-Fi',
  'Urban Fantasy',
  'Thriller',
  'Romance',
  'Literary',
  'Historical',
] as const;

export type GenreSeedGenre = (typeof GENRE_SEED_GENRES)[number];

export function isGenreSeedGenre(value: unknown): value is GenreSeedGenre {
  return typeof value === 'string' && (GENRE_SEED_GENRES as readonly string[]).includes(value);
}

/** Notes-Vault-relative paths of the three seeded notes (posix). */
export const GENRE_SEED_NOTE_PATHS = {
  templates: 'Plot & Story/Story Templates.md',
  beatSheet: 'Plot & Story/Beat Sheet.md',
  personas: 'Research/Agent Personas.md',
} as const;

interface GenreProfile {
  /** One-line promise the genre makes to its reader. */
  promise: string;
  /** Tone chips woven into templates + personas. */
  tones: [string, string, string];
  /** Example logline for the beat sheet's opening image. */
  logline: string;
  /** Midpoint flavor — how this genre likes to turn the story. */
  midpoint: string;
  /** Stakes wording for the all-is-lost beat. */
  allIsLost: string;
  /** Extra character-template field unique to the genre. */
  characterField: { label: string; hint: string };
  /** Extra location-template field unique to the genre. */
  locationField: { label: string; hint: string };
  /** Three Writing Coach voice presets tuned to the genre. */
  personas: Array<{ name: string; voice: string; leansOn: string }>;
}

const PROFILES: Record<GenreSeedGenre, GenreProfile> = {
  'Epic Fantasy': {
    promise: 'A vast world where small choices bend the fate of nations.',
    tones: ['mythic', 'sweeping', 'earned wonder'],
    logline: 'A map-maker discovers the blank space at the world’s edge is spreading inward.',
    midpoint: 'The quest’s true cost is revealed — the artifact, ally, or homeland must be given up, not won.',
    allIsLost: 'The banner falls: the alliance breaks, and the hero holds only what they carried in chapter one.',
    characterField: { label: 'Oath or duty', hint: 'What has this character sworn, and to whom?' },
    locationField: { label: 'Age & memory', hint: 'What older thing stood here first?' },
    personas: [
      { name: 'The Chronicler', voice: 'Measured, mythic cadence; favors history echoing into the present.', leansOn: 'foreshadowing · lineage · consequence' },
      { name: 'The Quartermaster', voice: 'Practical and concrete; asks what things cost, weigh, and break.', leansOn: 'logistics · travel · hard limits of magic' },
      { name: 'The Bard', voice: 'Warm and vivid; pushes sensory detail and the feeling under the spectacle.', leansOn: 'imagery · emotion · quiet moments between battles' },
    ],
  },
  'Dark Fantasy': {
    promise: 'Wonder with teeth — beauty and horror sharing the same breath.',
    tones: ['ominous', 'intimate', 'morally gray'],
    logline: 'The village saint still answers prayers. That is the problem.',
    midpoint: 'The protagonist wins exactly what they wanted — and it begins to change them.',
    allIsLost: 'The line they swore never to cross is behind them, and no one else noticed.',
    characterField: { label: 'The bargain', hint: 'What have they traded away — knowingly or not?' },
    locationField: { label: 'What it feeds on', hint: 'Every dark place has an appetite. Name it.' },
    personas: [
      { name: 'The Confessor', voice: 'Quiet, probing; interrogates motive and guilt without judging.', leansOn: 'interiority · dread · unreliable perception' },
      { name: 'The Butcher', voice: 'Blunt about violence and cost; keeps horror physical and specific.', leansOn: 'visceral detail · pacing · aftermath' },
      { name: 'The Candle-Keeper', voice: 'Finds the warmth that makes the dark legible; guards moments of grace.', leansOn: 'contrast · hope · character bonds' },
    ],
  },
  'Sci-Fi': {
    promise: 'One honest extrapolation, followed wherever it leads.',
    tones: ['precise', 'curious', 'consequential'],
    logline: 'The colony’s AI has started returning answers to questions no one asked yet.',
    midpoint: 'The technology works exactly as designed — and that design meets human nature.',
    allIsLost: 'The system cannot be switched off, because everyone now depends on it.',
    characterField: { label: 'Relationship to the novum', hint: 'How does the story’s big idea touch their daily life?' },
    locationField: { label: 'Infrastructure', hint: 'What keeps people alive here, and who maintains it?' },
    personas: [
      { name: 'The Engineer', voice: 'Rigorous, systems-minded; stress-tests the premise for contradictions.', leansOn: 'internal consistency · cause and effect · plausibility' },
      { name: 'The Anthropologist', voice: 'Asks how cultures, families, and economies reshape around the idea.', leansOn: 'societal ripple effects · worldbuilding · stakes' },
      { name: 'The Pilot', voice: 'Momentum-first; keeps chapters moving and jargon translated.', leansOn: 'clarity · tension · scene goals' },
    ],
  },
  'Urban Fantasy': {
    promise: 'The city you know, with the volume of its secrets turned up.',
    tones: ['streetwise', 'wry', 'hidden-world'],
    logline: 'Every lost-pet poster in the neighborhood is written in the same handwriting.',
    midpoint: 'The two worlds stop being separable — the mundane life becomes the leverage.',
    allIsLost: 'The masquerade breaks in the worst direction: the ordinary people they protected now fear them.',
    characterField: { label: 'Foot in each world', hint: 'What do they owe the mundane world? The hidden one?' },
    locationField: { label: 'The threshold', hint: 'How does this place look to someone who can’t see the truth?' },
    personas: [
      { name: 'The Fixer', voice: 'Fast, wry, deal-savvy; sharpens dialogue and urban texture.', leansOn: 'voice · banter · favors and debts' },
      { name: 'The Archivist', voice: 'Keeps the hidden world’s rules straight and its history accountable.', leansOn: 'magic rules · continuity · lore' },
      { name: 'The Beat Reporter', voice: 'Grounds the fantastic in real streets, jobs, and consequences.', leansOn: 'grounding detail · stakes · pacing' },
    ],
  },
  Thriller: {
    promise: 'Pressure that never stops rising, on a clock that never stops running.',
    tones: ['taut', 'propulsive', 'paranoid'],
    logline: 'She recognizes the voice on the wiretap. It’s her own, saying things she hasn’t said yet.',
    midpoint: 'The protagonist stops running and starts hunting — and learns the hunter expected it.',
    allIsLost: 'The proof is gone, the ally was theirs, and the deadline just moved up.',
    characterField: { label: 'Competence & blind spot', hint: 'What are they the best at — and what can’t they see?' },
    locationField: { label: 'Exits', hint: 'Ways in, ways out, and who is watching each.' },
    personas: [
      { name: 'The Handler', voice: 'Cold-eyed on plot logic; hunts plot holes like hostiles.', leansOn: 'causality · misdirection · fair-play clues' },
      { name: 'The Metronome', voice: 'Obsessed with rhythm; cuts slack scenes and times reveals.', leansOn: 'pacing · chapter hooks · escalation' },
      { name: 'The Profiler', voice: 'Keeps villains human and fear specific.', leansOn: 'antagonist logic · psychology · dread' },
    ],
  },
  Romance: {
    promise: 'Two people who change each other, and an ending that keeps its word.',
    tones: ['warm', 'yearning', 'emotionally honest'],
    logline: 'The wedding planner and the divorce lawyer keep getting booked by the same families.',
    midpoint: 'The false relationship becomes real — before either can afford to admit it.',
    allIsLost: 'The wound they’ve hidden all book is exactly the thing they inflict.',
    characterField: { label: 'Wound & want', hint: 'The old hurt they protect, and the desire it blocks.' },
    locationField: { label: 'Intimacy pressure', hint: 'How does this place force closeness or distance?' },
    personas: [
      { name: 'The Matchmaker', voice: 'Tracks the emotional beats; guards the chemistry math.', leansOn: 'beat structure · tension · payoff' },
      { name: 'The Confidante', voice: 'Digs into feelings under the banter; asks what a touch means.', leansOn: 'interiority · vulnerability · subtext' },
      { name: 'The Realist', voice: 'Keeps obstacles honest — no misunderstanding a phone call could fix.', leansOn: 'conflict integrity · motivation · stakes' },
    ],
  },
  Literary: {
    promise: 'Language and interior life given room to matter.',
    tones: ['observant', 'layered', 'unhurried'],
    logline: 'A translator returns home to bury her father and finds she can no longer read him.',
    midpoint: 'The outward story stills; the inward one turns — what the narrator wants is not what they said.',
    allIsLost: 'The self-story collapses: the narrator sees themselves the way others always have.',
    characterField: { label: 'Self-deception', hint: 'The story they tell about themselves that isn’t quite true.' },
    locationField: { label: 'Charged object', hint: 'One thing in this place that carries the theme.' },
    personas: [
      { name: 'The Close Reader', voice: 'Attends to the sentence; weighs rhythm, image, and word choice.', leansOn: 'prose style · imagery · precision' },
      { name: 'The Undertow', voice: 'Surfaces subtext and theme without flattening them into message.', leansOn: 'theme · symbolism · ambiguity' },
      { name: 'The Witness', voice: 'Holds character truth over plot convenience.', leansOn: 'psychology · memory · point of view' },
    ],
  },
  Historical: {
    promise: 'The past as a lived place, not a costume.',
    tones: ['textured', 'grounded', 'humane'],
    logline: 'The lighthouse keeper’s logbook has two sets of handwriting. She lives alone.',
    midpoint: 'History arrives — the great event stops being backdrop and starts breaking the plans.',
    allIsLost: 'The era wins: law, custom, or war takes the thing modern readers assume could be kept.',
    characterField: { label: 'Period constraint', hint: 'What can’t they do, say, or be in this era — and how do they push?' },
    locationField: { label: 'Daily texture', hint: 'Smells, labor, light, sound — what did a day here actually feel like?' },
    personas: [
      { name: 'The Historian', voice: 'Checks anachronisms and mines the record for gifts of detail.', leansOn: 'accuracy · period texture · research leads' },
      { name: 'The Letter-Writer', voice: 'Tunes dialogue and idiom to the era without losing readability.', leansOn: 'voice · diction · register' },
      { name: 'The Common Hand', voice: 'Keeps ordinary lives — servants, soldiers, children — in the frame.', leansOn: 'ground-level stakes · empathy · class detail' },
    ],
  },
};

const fm = (lines: string[]): string => `---\n${lines.join('\n')}\n---\n\n`;

function templatesNote(genre: GenreSeedGenre, p: GenreProfile): string {
  return (
    fm(['type: reference', `genre: ${genre}`, 'tags: [templates, starter]']) +
    `# Story Templates — ${genre}

Copy a skeleton below into a new note and fill it in. Fields marked *(${genre})* are
tuned to this genre — keep, adapt, or delete them freely.

## Character

- **Name:**
- **Role in story:**
- **Want (external):**
- **Need (internal):**
- **${p.characterField.label}** *(${genre})*: ${p.characterField.hint}
- **First impression:**
- **How they change:**

## Location

- **Name:**
- **First seen in:**
- **Sensory anchor:** one smell, one sound, one texture
- **${p.locationField.label}** *(${genre})*: ${p.locationField.hint}
- **Who holds power here:**

## Scene

- **POV:**
- **Goal → Conflict → Outcome:**
- **Value shift:** what changes between the first and last line (e.g. safe → hunted)
- **Tone check** *(${genre})*: ${p.tones.join(' · ')}

## Linked Notes

[[Beat Sheet]] · [[Agent Personas]]
`
  );
}

function beatSheetNote(genre: GenreSeedGenre, p: GenreProfile): string {
  return (
    fm(['type: reference', `genre: ${genre}`, 'tags: [beat-sheet, structure, starter]']) +
    `# Beat Sheet — ${genre}

${p.promise}

A fifteen-beat spine you can drag scenes onto. Example lines are ${genre}-flavored —
replace them with your own. Beats are a diagnostic, not a contract.

| # | Beat | Your story |
|---|------|------------|
| 1 | Opening image — e.g. *${p.logline}* | |
| 2 | Ordinary world & its cracks | |
| 3 | Inciting incident | |
| 4 | Refusal / debate | |
| 5 | Crossing the threshold | |
| 6 | New world, new rules | |
| 7 | First victory (it's a setup) | |
| 8 | **Midpoint** — ${p.midpoint} | |
| 9 | Enemies close in | |
| 10 | The plan unravels | |
| 11 | **All is lost** — ${p.allIsLost} | |
| 12 | The long dark night | |
| 13 | The realization (need over want) | |
| 14 | Final confrontation | |
| 15 | Closing image — the opening, transformed | |

## Linked Notes

[[Story Templates]] · [[Agent Personas]]
`
  );
}

function personasNote(genre: GenreSeedGenre, p: GenreProfile): string {
  const rows = p.personas
    .map((persona) => `### ${persona.name}\n\n- **Voice:** ${persona.voice}\n- **Leans on:** ${persona.leansOn}\n`)
    .join('\n');
  return (
    fm(['type: reference', `genre: ${genre}`, 'tags: [personas, agents, starter]']) +
    `# Agent Personas — ${genre}

Three Writing Coach voices tuned for ${genre.toLowerCase()} (tone: ${p.tones.join(', ')}).
Paste one into a coach conversation to set its lens, or use them as a menu of
editorial perspectives when a scene stalls.

${rows}
## Linked Notes

[[Story Templates]] · [[Beat Sheet]]
`
  );
}

export interface GenreSeedResult {
  /** Notes-Vault-relative paths written (posix). */
  written: string[];
}

/**
 * Write the three genre starter notes into the vault's Notes Vault.
 * Creation-time only; existing files are never overwritten (a replayed wizard
 * pointed at an adopted vault must not clobber user edits).
 */
export function writeGenreStarterNotes(mythosRoot: string, genre: GenreSeedGenre): GenreSeedResult {
  const notesVaultRoot = notesVaultRootFor(mythosRoot);
  const p = PROFILES[genre];
  const notes: Array<[string, string]> = [
    [GENRE_SEED_NOTE_PATHS.templates, templatesNote(genre, p)],
    [GENRE_SEED_NOTE_PATHS.beatSheet, beatSheetNote(genre, p)],
    [GENRE_SEED_NOTE_PATHS.personas, personasNote(genre, p)],
  ];
  const written: string[] = [];
  for (const [relPath, content] of notes) {
    const abs = path.join(notesVaultRoot, ...relPath.split('/'));
    if (fs.existsSync(abs)) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    writeFileAtomic(abs, content);
    written.push(relPath);
  }
  return { written };
}
