// Beta 4 M5 — "The Last City of Veynn" demo seed (FULL-SPEC §2, §14.10).
//
// A NEW MythosVault is seeded ONCE with the prototype's demo project — the
// `_book0` manuscript (3 parts), the `_vault0` sample notes (Mira Veynn,
// Kael Thorne, The Sunken Gate, Tide Mechanics, …), the starter idea library
// (`bsData`/`bsPool`), and the demo timeline events (`tlEvents`) — so every
// screen demos itself on first launch. The seed marker lives in mythos.json
// (the W0.1 rule, marker migrated off the `.mythos-seeded` sentinel).
//
// Content source: plans/design-handoff/v2/prototype/
// "Mythos Writer - Liquid Neon.dc.html" lines ~3990–4040 (manuscript),
// ~4085–4165 (notes tree + idea pool), ~4170–4180 (timeline), ~4330–4400
// (note documents).
//
// Pure Node.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeFileAtomic } from '../vault.js';
import {
  notesVaultRootFor,
  storyVaultRootFor,
  tryReadMythosFile,
  writeMythosFile,
  type MythosStoryRef,
} from './mythosJson.js';
import { BOOK_FILENAME, serializeBookFile, type BookSpinePart } from './bookFile.js';
import {
  chapterDirName,
  partDirName,
  sceneFileName,
  serializeV2SceneFile,
  type SceneStatus,
} from './sceneFiles.js';
import { readTimelinesFile, writeTimelinesFile, type TimelineEventEntry } from './timelinesFile.js';
import { createSession } from './agentSessions.js';

export const VEYNN_SEED_LAYOUT = 'veynn-demo@M5';
export const VEYNN_STORY_TITLE = 'The Last City of Veynn';
export const VEYNN_STORY_FOLDER = 'The Last City of Veynn';

export const IDEA_LIBRARY_DIRNAME = 'Brainstorm';
export const IDEA_LIBRARY_FILENAME = 'idea-library.json';

// ─── Manuscript (prototype `_book0`) ─────────────────────────────────────────

interface SeedScene {
  title: string;
  status: SceneStatus;
  pov?: string;
  when?: number;
  paras: string[];
}

interface SeedChapter {
  n: number;
  title: string;
  intro?: string[];
  scenes: SeedScene[];
}

interface SeedPart {
  title: string;
  intro?: string[];
  chapters: SeedChapter[];
}

const MANUSCRIPT: SeedPart[] = [
  {
    title: 'Ash and Oath',
    intro: [
      'They say the city drowned twice: once in water, once in the forgetting. Every ledger, every oath, every debt was rewritten by the survivors — which is to say, by the liars.',
      '— from the Harbor Annals, author unrecorded',
    ],
    chapters: [
      {
        n: 1,
        title: 'The Quiet Before',
        intro: [
          'I have kept the ninth bell silent for nineteen years. Tonight it rings, and I find I cannot remember whether I am its keeper or its prisoner. — journal of the Watcher of the Sunken Gate, final entry',
        ],
        scenes: [
          {
            title: "The Watcher's Call",
            status: 'done',
            pov: 'Mira Veynn',
            when: 8710,
            paras: [
              'Mira Veynn had counted the bells of the upper city for nineteen years, and never once had they rung at dusk. Tonight they rang nine times, slow and uneven, like a hand unsure of its own strength.',
              'From the watchtower window she saw the harbor lanterns gutter in a wind that did not touch the flags. Somewhere below, in the salt-dark of the lower quarter, a summons was waiting for her with her name misspelled and her fate spelled exactly right.',
            ],
          },
          {
            title: 'A City in Shadows',
            status: 'done',
            pov: 'Mira Veynn',
            paras: [
              'By morning the rumor had grown teeth. The Watcher of the Sunken Gate had gone silent, and the Council pretended not to notice, which is how Mira knew it mattered.',
              'She traded her cloak for a worse one, her name for no name at all, and went down into the streets where the city kept its honest business — the kind that never saw daylight and never lied about it.',
            ],
          },
        ],
      },
      {
        n: 2,
        title: 'Fractures',
        scenes: [
          {
            title: "The Smuggler's Bargain",
            status: 'done',
            pov: 'Kael Thorne',
            paras: [
              'Kael dealt cards the way other men made confessions — slowly, and only when cornered. "Passage through Ward Violet costs more than coin," he said. "It costs a favor. And favors compound."',
              'Mira slid the brass token across the table. His smile faltered for exactly one heartbeat, which from Kael was as good as a scream.',
            ],
          },
          {
            title: 'Into the Undercity',
            status: 'draft',
            pov: 'Mira Veynn',
            when: 8712,
            paras: [
              'The stairwell yawned like a throat carved into the belly of the city. Damp air rolled up from below, thick with the smell of rot, smoke, and something metallic — like old coins left too long in a gutter.',
              'Kael tightened his hood and signaled for Mira to move first.',
              '"Stay close," he whispered. "The Undercity doesn’t just swallow the unwary. It forgets them."',
              'Mira’s lantern cast a trembling circle of light across the slick stone steps. Water dripped from unseen pipes somewhere below, each drop echoing like a slow heartbeat. The deeper they descended, the more the sound of the surface faded — until the city above was nothing but a memory.',
              'At the bottom, the passage opened into a maze of narrow alleys and stacked walkways. Tattered awnings hung between leaning buildings. Strange sigils glowed faintly on walls. Vendors called out in languages Kael didn’t recognize.',
              'A boy darted past them, barefoot, clutching a stolen loaf. A guard laughed and let him go.',
              '"You were right," Mira murmured. "This place has its own rules."',
              'Kael nodded. Somewhere in this sprawl was the Smuggler’s Broker — and the map fragment they needed to reach the Sunken Gate.',
              'Finding it would be the easy part. Getting out would be another story.',
            ],
          },
          {
            title: 'The Broken Gate',
            status: 'todo',
            pov: 'Mira Veynn',
            paras: [
              'The Broker’s map ended at a door that was not on any map, which Mira decided was either very good or very fatal.',
              'Beyond it, stone gave way to older stone, and the air began to hum — low and patient, like a city dreaming with its eyes open.',
            ],
          },
        ],
      },
    ],
  },
  {
    title: 'Embers Rising',
    chapters: [
      {
        n: 3,
        title: 'Whispers of Rebellion',
        scenes: [
          {
            title: 'Ward Violet',
            status: 'draft',
            paras: [
              'Ward Violet did not exist. Everyone agreed on this, especially the people who lived there.',
              'Its lamps burned violet-blue against ordinance, its walls carried messages that rearranged themselves by morning, and its loyalty belonged to whoever remembered the old names.',
            ],
          },
          {
            title: 'The Deep Awakens',
            status: 'todo',
            paras: [
              'The first tremor came at low tide. The second came with a sound no one could describe without whispering.',
              'In the lower caverns, the drownlight — steady for eight hundred years — began, very slowly, to blink.',
            ],
          },
        ],
      },
    ],
  },
  {
    title: 'The Last Reckoning',
    chapters: [
      {
        n: 4,
        title: 'Blood and Bone',
        scenes: [
          {
            title: 'The Sunken Gate',
            status: 'todo',
            pov: 'Mira Veynn',
            when: 8730,
            paras: [
              'The Gate had waited under the sea for longer than the city had a name, and it recognized her.',
              'That was the part no one had warned Mira about — not that the seal could break, but that it would be glad.',
            ],
          },
          {
            title: 'The Last Stand',
            status: 'todo',
            when: 8740,
            paras: [
              'Veynn burned its lanterns one final time, all of them, every window and every wall — not as a signal of surrender, but so the deep would see exactly who it was dealing with.',
              'Fire or heart of Veynn. In the end, the choice was the same choice it had always been.',
            ],
          },
        ],
      },
    ],
  },
];

// ─── Sample notes (prototype `_vault0` + `notes` documents) ──────────────────

interface SeedNote {
  /** Notes-Vault-relative path (posix). */
  relPath: string;
  content: string;
}

const note = (relPath: string, frontmatter: string[], body: string): SeedNote => ({
  relPath,
  content: `---\n${frontmatter.join('\n')}\n---\n\n${body.trim()}\n`,
});

const NOTES: SeedNote[] = [
  note(
    'Worldbuilding/Locations/The Last City of Veynn.md',
    ['type: location', 'kind: city', 'aliases: [Veynn, City of Veynn]', 'tags: [location, city, hub]'],
    `The last standing city of the Drowned Coast — a vertical sprawl of terraces, bell towers, and salt-stained marble stacked above its own sunken districts. Above: council law. Below: older law.

> [!note] Rule of the city
> Nothing in Veynn is ever truly lost. It is only owed to someone else.

## Districts

- The Upper Terraces — council seats, watchtowers, the nine bells
- [[Ward Violet]] — the district that officially does not exist
- The Undercity — drowned streets, stacked walkways, market of tongues

## Linked Notes

[[Ward Violet]] · [[The Sunken Gate]]`,
  ),
  note(
    'Worldbuilding/Locations/The Sunken Gate.md',
    ['type: location', 'region: the-drowned-coast', 'danger: high', 'tags: [location, underworld, ruins, ancient]'],
    `An ancient floodgate built by a lost civilization to control the tides of the Great Deep. Now half-buried in silt and coral, it is said to lead to passages beneath the sea and into forgotten halls where the [[Drownlight]] still burns.

> [!quote] Legend
> Sailors speak of a hum that rises from the depths on still nights — a sound like voices, or a city dreaming.

## Architecture

- Massive stone arches encrusted with coral and black algae
- Gate mechanisms of unknown metal, engraved with wave-like glyphs
- Faint blue glow emanates from cracks in the stone at low tide

## Current State

The upper courtyard is accessible at low tide. The inner passage is blocked by a collapsed portcullis. Strange marine growth reacts to light.

## Linked Notes

[[Drownlight]] · [[Tide Mechanics]] · [[The Last City of Veynn]]`,
  ),
  note(
    'Worldbuilding/Locations/Emberfall Ruins.md',
    ['type: location', 'tags: [location, ruins]'],
    `What remains of the coast's second city, burned in the same decade Veynn drowned. Scavengers say the ash never fully cooled; historians say scavengers exaggerate. Both keep going back.

## Linked Notes

[[The Drowning of the Coast]]`,
  ),
  note(
    'Worldbuilding/Locations/The Mirewood.md',
    ['type: location', 'tags: [location, wilds]'],
    `A brackish forest between Veynn and the interior, where the tide reaches miles inland through the roots. Paths move. Guides who claim otherwise are lying or lost.`,
  ),
  note(
    'Worldbuilding/Factions/Ward Violet.md',
    ['type: faction', 'tags: [faction, district]'],
    `The district that officially does not exist. Its lamps burn violet-blue against ordinance, and favors outrank coin. Loyalty belongs to whoever remembers the old names.

## Linked Notes

[[The Last City of Veynn]] · [[Kael Thorne]]`,
  ),
  note(
    'Worldbuilding/Factions/The Council.md',
    ['type: faction', 'tags: [faction, politics]'],
    `Veynn's governing body — nine seats, one for each bell. The Council's real power is deciding what the city officially notices. What it pretends not to notice matters more.

## Linked Notes

[[The Last City of Veynn]] · [[Mira Veynn]]`,
  ),
  note(
    'Worldbuilding/History/The Drowning of the Coast.md',
    ['type: history', 'tags: [history, catastrophe]'],
    `Eight hundred years ago the sea rose in a single winter and took every harbor city but one. The survivors rewrote their ledgers, their oaths, and their debts — which is to say, the survivors lied.

## Linked Notes

[[The Last City of Veynn]] · [[Emberfall Ruins]] · [[Drownlight]]`,
  ),
  note(
    'Worldbuilding/Lore & Myth/Drownlight.md',
    ['type: lore', 'tags: [lore, mystery]'],
    `A cold blue flame that burns underwater in the deepest caverns beneath Veynn. Steady for eight hundred years. It has recently begun, very slowly, to blink.

## Linked Notes

[[The Sunken Gate]] · [[The Drowning of the Coast]]`,
  ),
  note(
    'Worldbuilding/Lore & Myth/Tide Mechanics.md',
    ['type: lore', 'tags: [lore, rules, systems]'],
    `The rules by which the deep breathes.

- The inner passage of the [[The Sunken Gate|Sunken Gate]] opens only at low tide.
- Extreme low tides allow brief access to the drowned halls beyond.
- The dusk ebb is the safest window; the night flood is not a window at all.

Continuity rule for scenes: nobody enters the Gate at high tide.`,
  ),
  note(
    'Characters/Mira Veynn.md',
    ['type: character', 'role: protagonist', 'aliases: [Mira]', 'tags: [character, protagonist, pov]'],
    `Reluctant heir of a drowned bloodline. Nineteen years counting bells in the upper city; one night answering them. Resourceful, haunted, determined — she reads rooms the way sailors read weather, and trusts neither.

> [!note] Voice
> Dry, watchful, allergic to ceremony. She jokes exactly once per crisis.

## Arc

- Reluctant Heir → Leader
- Learns the seal recognizes her blood
- Chooses the city over the crown

## Relationships

[[Kael Thorne]] · [[The Broker]]`,
  ),
  note(
    'Characters/Kael Thorne.md',
    ['type: character', 'role: ally', 'aliases: [Kael]', 'tags: [character, smuggler]'],
    `Smuggler — witty, guarded, survivor. Deals cards the way other men make confessions: slowly, and only when cornered. Knows every route through [[Ward Violet]] and the price of each.

## Relationships

[[Mira Veynn]] · [[The Broker]] (rivalry)`,
  ),
  note(
    'Characters/The Broker.md',
    ['type: character', 'role: antagonist', 'tags: [character, antagonist]'],
    `Antagonist — elusive, powerful, always watching. Sells maps to places that do not exist yet and collects debts that never expire.

## Relationships

Manipulates → [[Mira Veynn]] · Rival of [[Kael Thorne]]`,
  ),
  note(
    'Plot & Story/Project Bible.md',
    ['type: plot', 'tags: [plot, reference]'],
    `The single source of truth for the world of Veynn.

## Premise

The last city of a drowned coast. A silent watcher, a ringing bell, and a gate under the sea that remembers a bloodline.

## Rules that never break

1. Nothing in Veynn is ever truly lost — only owed.
2. The Gate opens at low tide, and to one blood ([[Tide Mechanics]]).
3. Every favor costs a remembering.

## Cast

[[Mira Veynn]] · [[Kael Thorne]] · [[The Broker]]`,
  ),
];

const NOTE_DIRS = [
  'Worldbuilding/Locations',
  'Worldbuilding/Factions',
  'Worldbuilding/History',
  'Worldbuilding/Lore & Myth',
  'Characters',
  'Plot & Story',
  'Research',
  'Sessions',
];

// ─── Starter idea library (prototype `bsData` + `bsPool`) ────────────────────

interface IdeaCard {
  title: string;
  description: string;
  chips: string[];
}

interface IdeaCategory {
  key: string;
  title: string;
  cards: IdeaCard[];
}

const card = (title: string, description: string, ...chips: string[]): IdeaCard => ({
  title,
  description,
  chips,
});

const IDEA_BOARD: IdeaCategory[] = [
  {
    key: 'beats',
    title: 'STORY BEATS',
    cards: [
      card('The Descent', 'Mira follows the stolen map into the forgotten entrance.', 'Chapter 2', 'Plot'),
      card("Smuggler's Deal", 'Mira bargains with Kael for safe passage through Ward Violet.', 'Chapter 2', 'Character'),
      card('Echo of the Past', 'An ancient mechanism reveals a memory she thought buried.', 'Chapter 3', 'Mystery'),
    ],
  },
  {
    key: 'rel',
    title: 'CHARACTER RELATIONSHIPS',
    cards: [
      card('Mira Veynn', 'Protagonist — resourceful, haunted, determined.', 'Reluctant Alliance → Kael'),
      card('Kael Thorne', 'Smuggler — witty, guarded, survivor.', 'Rivalry → The Broker'),
      card('The Broker', 'Antagonist — elusive, powerful, always watching.', 'Manipulates → Mira'),
    ],
  },
  {
    key: 'world',
    title: 'WORLDBUILDING CLUSTERS',
    cards: [
      card('Sunken Secrets', 'The city below holds truths that could reshape the world.', '8 ideas'),
      card('Power and Price', 'Every power is forged from a cost.', '6 ideas'),
      card('Forgotten Bloodlines', 'Legacy runs in secret — it’s everywhere.', '5 ideas'),
    ],
  },
  {
    key: 'theme',
    title: 'THEMATIC IDEAS',
    cards: [
      card('Memory as Currency', 'Memories can be traded. Who owns your past?', 'Theme'),
      card('Sacrifice & Survival', 'What will Mira lose to save what she loves?', 'Theme'),
      card('Light in the Deep', 'Hope persists, even in the deepest dark.', 'Theme'),
    ],
  },
  {
    key: 'loose',
    title: 'LOOSE IDEAS',
    cards: [
      card('A map that changes', 'Based on the reader’s fear.', 'Loose'),
      card('Whispers in the water', 'That remember names.', 'Loose'),
      card('A market where dreams are sold', 'And what they cost.', 'Loose'),
    ],
  },
  { key: 'trope', title: 'TROPES', cards: [] },
];

const IDEA_POOL: Record<string, IdeaCard[]> = {
  beats: [
    card('The Broken Gate', 'The gate refuses Mira — it remembers her bloodline.', 'Chapter 3', 'Plot'),
    card('The Patrol Cycles Back', 'A timed escape through Ward Violet.', 'Plot'),
    card('A Debt Comes Due', 'Kael’s old creditor surfaces at the worst moment.', 'Plot'),
    card('Midpoint Reversal', 'The goal changes — what they were chasing was the wrong prize.', 'Starter', 'Structure'),
    card('The Ticking Clock', 'Introduce a deadline that makes every scene cost something.', 'Starter', 'Structure'),
    card('The Point of No Return', 'Burn the bridge home. Literally or otherwise.', 'Starter', 'Structure'),
  ],
  trope: [
    card('The Chosen One', 'Marked by fate — works best when being chosen is a burden.', 'Starter', 'Trope'),
    card('Enemies to Allies', 'Forced cooperation curdles into real trust.', 'Starter', 'Trope'),
    card('The Reluctant Hero', 'Wants no part of it. The story makes it personal.', 'Starter', 'Trope'),
    card('The Betrayal', 'A trusted ally turns — seeded in plain sight.', 'Starter', 'Trope'),
    card('The False Victory', 'They get exactly what they wanted — and it’s a trap.', 'Starter', 'Trope'),
    card('The Mentor Falls', 'The one person with answers is taken off the board.', 'Starter', 'Trope'),
    card('Enemy at the Table', 'The antagonist and hero must cooperate — briefly.', 'Starter', 'Trope'),
    card('Hidden Parentage', 'A bloodline secret that reframes everything before it.', 'Starter', 'Trope'),
    card('The Prophecy Misread', 'It came true — just not the way anyone assumed.', 'Starter', 'Trope'),
    card('Redemption Arc', 'The fall is easy. Earn the climb back.', 'Starter', 'Trope'),
    card('Fish Out of Water', 'Drop them where every instinct is wrong.', 'Starter', 'Trope'),
    card('The Heist Gone Wrong', 'The plan was perfect. The intel wasn’t.', 'Starter', 'Trope'),
  ],
  rel: [
    card('Liora Ashen', 'Archivist — knows more than she records.', 'Ally?'),
    card('The Lamplighter', 'Kael’s rival on the smuggling routes.', 'Rival'),
  ],
  world: [
    card('Tide Mechanics', 'The inner passage opens only at low tide.', 'Rules'),
    card('Ward Violet', 'District where favors outrank coin.', 'Place'),
    card('The Second Bell', 'A bell that rings for no hour on any clock.', 'Mystery'),
  ],
  theme: [
    card('What the City Forgets', 'Erasure as mercy — and as weapon.', 'Theme'),
    card('Debts of Memory', 'Every favor costs a remembering.', 'Theme'),
    card('Power Corrupts Quietly', 'Not a fall — a slow lean. When did they cross the line?', 'Starter', 'Theme'),
    card('Found Family', 'The family you choose vs. the one that chose you.', 'Starter', 'Theme'),
    card('The Cost of Truth', 'Would they be happier not knowing? Would you?', 'Starter', 'Theme'),
    card('Becoming the Monster', 'Every step to defeat the enemy makes them more alike.', 'Starter', 'Theme'),
    card('Home You Can’t Return To', 'The place is the same — the person isn’t.', 'Starter', 'Theme'),
    card('Legacy vs. Choice', 'What you inherit against what you decide.', 'Starter', 'Theme'),
  ],
  loose: [
    card('A door with no map', 'It exists only while unobserved.', 'Loose'),
    card('Rain that falls upward', 'Only in the deepest wards.', 'Loose'),
    card('The cartographer’s confession', 'Maps drawn from stolen dreams.', 'Loose'),
    card('A letter delivered 20 years late', 'Who sent it — and why now?', 'Starter', 'Spark'),
    card('The town that votes on the weather', 'And this year’s election is rigged.', 'Starter', 'Spark'),
    card('Two characters swap secrets', 'Each now carries the other’s worst truth.', 'Starter', 'Spark'),
    card('The last speaker of a language', 'And the one word they refuse to translate.', 'Starter', 'Spark'),
  ],
};

// ─── Timeline events (prototype `tlEvents`) ──────────────────────────────────

const TIMELINE_EVENTS: Omit<TimelineEventEntry, 'id'>[] = [
  { title: "The Watcher's Call", chapter: 'Ch. 1', when: 8710, description: 'Mira receives a mysterious summons that changes everything.' },
  { title: 'First Descent', chapter: 'Ch. 2', when: 8712, description: 'Mira and Kael enter the Undercity for the first time.' },
  { title: 'The Sunken Gate', chapter: 'Ch. 4', when: 8730, description: 'Ancient seal broken. Something stirs in the deep.' },
  { title: 'Betrayal at Dusk', chapter: 'Ch. 4', when: 8731, description: 'A trusted ally revealed as enemy.' },
  { title: 'The Crown of Ash', chapter: 'Ch. 4', when: 8500, flashback: true, description: 'The truth of the royal line — and its buried curse. Revealed late, but the events date to Year 850.' },
  { title: 'The Last Stand', chapter: 'Ch. 4', when: 8740, description: 'Fire or heart of Veynn decided in the end.' },
];

// ─── Seed writer ──────────────────────────────────────────────────────────────

export interface VeynnSeedResult {
  storyRef: MythosStoryRef;
  sceneCount: number;
  noteCount: number;
  eventCount: number;
}

/**
 * Write the full demo into an existing MythosVault folder and register the
 * story in mythos.json. Caller is responsible for the seed-once marker
 * (createMythosVault records it right after this returns).
 */
export function writeVeynnSeed(mythosRoot: string, now: () => Date = () => new Date()): VeynnSeedResult {
  const storyVaultRoot = storyVaultRootFor(mythosRoot);
  const notesVaultRoot = notesVaultRootFor(mythosRoot);
  const nowStr = now().toISOString();
  const storyId = crypto.randomUUID();

  // Manuscript: Part N/Chapter NN/Scene NN.md
  const storyAbs = path.join(storyVaultRoot, VEYNN_STORY_FOLDER);
  const spine: BookSpinePart[] = [];
  let sceneCount = 0;
  MANUSCRIPT.forEach((part, pi) => {
    const partDir = partDirName(pi + 1);
    const spinePart: BookSpinePart = {
      dir: partDir,
      label: part.title,
      ...(part.intro ? { intro: part.intro } : {}),
      chapters: [],
    };
    for (const chapter of part.chapters) {
      const chapterDir = chapterDirName(chapter.n);
      spinePart.chapters.push({
        dir: chapterDir,
        id: crypto.randomUUID(),
        title: chapter.title,
        ...(chapter.intro ? { intro: chapter.intro } : {}),
      });
      chapter.scenes.forEach((scene, si) => {
        const sceneAbs = path.join(storyAbs, partDir, chapterDir, sceneFileName(si + 1));
        writeFileAtomic(
          sceneAbs,
          serializeV2SceneFile({
            id: crypto.randomUUID(),
            title: scene.title,
            status: scene.status,
            ...(scene.pov ? { pov: scene.pov } : {}),
            ...(scene.when !== undefined ? { when: scene.when } : {}),
            updatedAt: nowStr,
            prose: scene.paras.join('\n\n'),
          }),
        );
        sceneCount += 1;
      });
    }
    spine.push(spinePart);
  });

  // book.md — compiled order + metadata.
  writeFileAtomic(
    path.join(storyAbs, BOOK_FILENAME),
    serializeBookFile({
      id: storyId,
      title: VEYNN_STORY_TITLE,
      synopsis:
        'The last city of a drowned coast. A silent watcher, a ringing bell, and a gate under the sea that remembers a bloodline.',
      createdAt: nowStr,
      updatedAt: nowStr,
      spine,
    }),
  );

  // Notes Vault.
  for (const dir of NOTE_DIRS) {
    fs.mkdirSync(path.join(notesVaultRoot, ...dir.split('/')), { recursive: true });
  }
  for (const n of NOTES) {
    writeFileAtomic(path.join(notesVaultRoot, ...n.relPath.split('/')), n.content);
  }

  // Starter idea library.
  writeFileAtomic(
    path.join(mythosRoot, IDEA_LIBRARY_DIRNAME, IDEA_LIBRARY_FILENAME),
    `${JSON.stringify({ version: 1, board: IDEA_BOARD, pool: IDEA_POOL }, null, 2)}\n`,
  );

  // Timeline events.
  const timelines = readTimelinesFile(mythosRoot);
  timelines.events = TIMELINE_EVENTS.map((e) => ({ ...e, id: crypto.randomUUID() }));
  writeTimelinesFile(mythosRoot, timelines);

  // One demo agent session so the Sessions store demos itself (M15 grows this).
  createSession(notesVaultRoot, {
    agent: 'brainstorm',
    title: 'Worldbuilding kickoff',
    startedAt: nowStr,
    turns: [
      {
        role: 'agent',
        at: nowStr,
        text: 'Tell me about your story — characters, places, rules of the world. I’ll turn what you say into structured notes and connections as we talk.',
      },
      {
        role: 'user',
        at: nowStr,
        text: 'The city of Veynn drowned twice: once in water, once in the forgetting.',
      },
    ],
  });

  // Register the story in mythos.json.
  const storyRef: MythosStoryRef = {
    id: storyId,
    title: VEYNN_STORY_TITLE,
    folder: VEYNN_STORY_FOLDER,
    synopsis:
      'The last city of a drowned coast. A silent watcher, a ringing bell, and a gate under the sea that remembers a bloodline.',
    createdAt: nowStr,
    updatedAt: nowStr,
  };
  const mythos = tryReadMythosFile(mythosRoot);
  if (mythos && !mythos.stories.some((s) => s.folder === storyRef.folder)) {
    writeMythosFile(mythosRoot, { ...mythos, stories: [...mythos.stories, storyRef] });
  }

  return {
    storyRef,
    sceneCount,
    noteCount: NOTES.length,
    eventCount: TIMELINE_EVENTS.length,
  };
}
