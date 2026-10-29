// Behaviour tests for the no-AI Brainstorm extract script (PLAN-AI-MODES M-1).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MAX_PROPOSALS,
  MAX_EXTRACTION_CONFIDENCE,
  MIN_EXTRACTION_CONFIDENCE,
  extractProposalsByScript,
} from './brainstormExtractScript.js';
import type { NoteProposal } from './brainstormAgent.js';

const TURN = 'turn-1';

function extract(
  text: string,
  { known = [], rejected = [], max }: { known?: string[]; rejected?: string[]; max?: number } = {},
): NoteProposal[] {
  let n = 0;
  return extractProposalsByScript(text, new Set(known), new Set(rejected), TURN, {
    generateId: () => `id-${++n}`,
    maxProposals: max,
  });
}

function titles(text: string, opts?: Parameters<typeof extract>[1]): string[] {
  return extract(text, opts).map((p) => p.title);
}

function kindOf(text: string, title: string): string | undefined {
  return extract(text).find((p) => p.title === title)?.kind;
}

describe('extractProposalsByScript — names found', () => {
  it('proposes a new name from plain prose in the shape the proposal card renders', () => {
    const [proposal] = extract('Your rival could be Captain Mira Sol, who smuggles relics through the harbour.');
    expect(proposal).toEqual({
      id: 'id-1',
      kind: 'character',
      title: 'Captain Mira Sol',
      destinationPath: 'characters/captain-mira-sol.md',
      body: 'Your rival could be Captain Mira Sol, who smuggles relics through the harbour.',
      frontmatter: {},
      sourceConversationTurnId: TURN,
      extractionConfidence: expect.any(Number),
      status: 'pending',
    });
    expect(proposal.extractionConfidence).toBeGreaterThanOrEqual(MIN_EXTRACTION_CONFIDENCE);
    expect(proposal.extractionConfidence).toBeLessThan(1);
  });

  it('returns several names in the order they first appear', () => {
    expect(titles('The smugglers met in Kesh at dawn. Later, Corwin said nothing about the Blade of Dawn.'))
      .toEqual(['Kesh', 'Corwin', 'Blade of Dawn']);
  });

  it('ignores a lone capital that only ever opens a sentence', () => {
    expect(titles('Shadows gathered. Nothing moved. Lanterns flickered in the rain.')).toEqual([]);
  });

  it('counts a single word once it also appears mid-sentence', () => {
    expect(titles('Corwin waits. The guard watches Corwin closely.')).toEqual(['Corwin']);
  });

  it('keeps a multi-word name that opens a sentence, a list item or follows "Dr."', () => {
    // The second capital is evidence wherever the run sits; brainstorm lists open lines with names.
    expect(titles('Mira Sol smuggles relics through the harbour.')).toEqual(['Mira Sol']);
    expect(titles('- Mira Sol, a pilot who smuggles relics.\n- Corwin Vale, her fence.'))
      .toEqual(['Mira Sol', 'Corwin Vale']);
    expect(titles('Åsa Ström travels to Zürich with Ýrr.')).toContain('Åsa Ström');
    const [doctor] = extract('Dr. Elena Vasquez studies the stars.');
    expect(doctor).toMatchObject({ title: 'Elena Vasquez', kind: 'character' });
  });

  it('ignores first-person contractions and outline labels in assistant replies', () => {
    expect(titles("Honestly I'm torn, but I'd keep the twist for Act Two.")).toEqual([]);
    expect(titles("I'm not sure, but I'll suggest that I've seen Kael do it.")).toEqual(['Kael']);
    expect(titles("Great question! I'd go with Option B. Act Two needs a midpoint twist.")).toEqual([]);
    expect(titles("You're right that Chapter Three drags. Part II follows, so Don't rush.")).toEqual([]);
  });

  it('scores more mentions higher, and never reaches certainty', () => {
    const once = extract('The guard watches Corwin.')[0];
    const often = extract('The guard watches Corwin. She trusts Corwin. They follow Corwin home. Ask Corwin.')[0];
    expect(often.extractionConfidence).toBeGreaterThan(once.extractionConfidence);
    expect(often.extractionConfidence).toBeLessThanOrEqual(MAX_EXTRACTION_CONFIDENCE);
  });
});

describe('extractProposalsByScript — kinds by dictionary cue', () => {
  it('honorific or title prefix → character', () => {
    expect(kindOf('Then Lady Elspeth arrives with news.', 'Lady Elspeth')).toBe('character');
  });

  it('speech or relation verbs → character', () => {
    expect(kindOf('Nobody listens until Corwin said the word.', 'Corwin')).toBe('character');
  });

  it('place words, place suffixes and in/at context → location', () => {
    expect(kindOf('A storm rolls over the Sword Coast tonight.', 'Sword Coast')).toBe('location');
    expect(kindOf('The caravan reaches Oakshire by noon.', 'Oakshire')).toBe('location');
    expect(kindOf('The smugglers met in Kesh at dawn.', 'Kesh')).toBe('location');
    expect(kindOf('They travelled to Kesh before winter.', 'Kesh')).toBe('location');
  });

  it('"to"/"from" without a motion verb is not a place', () => {
    expect(kindOf('She wrote a letter to Corwin and waited.', 'Corwin')).not.toBe('location');
  });

  it('a place or object word ending a bare two-part name does not make it a place or item', () => {
    // "the Sword Coast" or "Blade of Dawn" mark a place/object; "Corwin Vale" alone reads as a person.
    expect(kindOf('- Corwin Vale, her fence.', 'Corwin Vale')).toBe('inbox');
    expect(kindOf('The guard watches Emma Stone closely.', 'Emma Stone')).not.toBe('item');
    expect(kindOf('The guard watches Sam Hall closely.', 'Sam Hall')).not.toBe('location');
  });

  it('a possessive after a motion verb names the owner, not the place', () => {
    expect(kindOf("Kael travels to Mira's house.", 'Mira')).not.toBe('location');
  });

  it('group words → faction', () => {
    expect(kindOf('The rumours say the Order of Ash is hunting her.', 'Order of Ash')).toBe('faction');
    expect(kindOf('Long ago House Varn ruled the valley.', 'House Varn')).toBe('faction');
  });

  it('object words → item', () => {
    expect(kindOf('She hid the Crown of Kesh beneath the floor.', 'Crown of Kesh')).toBe('item');
    expect(kindOf('He drew the Blade of Dawn and waited.', 'Blade of Dawn')).toBe('item');
  });

  it('no cue at all → inbox, not a guessed character', () => {
    const [proposal] = extract('Everything changes after the Veilfall arrives.');
    expect(proposal.kind).toBe('inbox');
    expect(proposal.destinationPath).toBe('inbox/veilfall.md');
  });
});

describe('extractProposalsByScript — explicit intent', () => {
  it('FACT tags the renderer ignores are proposed with the tag kind and description', () => {
    const [faction, inbox] = extract(
      'A threat forms.\n[FACT:faction|Ashen Hand|A cult that worships fire][FACT:inbox|Veil Law|Magic fails at the border]',
    );
    expect(faction).toMatchObject({
      kind: 'faction', title: 'Ashen Hand', body: 'A cult that worships fire', destinationPath: 'factions/ashen-hand.md',
    });
    expect(inbox).toMatchObject({ kind: 'inbox', title: 'Veil Law', body: 'Magic fails at the border' });
  });

  it('FACT tags the renderer files itself are not proposed again, nor are names from their text', () => {
    expect(titles(
      'Great idea! Here is a character suggestion.\n\n[FACT:character|Aria Voss|A sorceress of Ravenspire who hears Corwin]'
      + '[FACT:location|Dark Cave|A cavern][FACT:item|Magic Staff|A staff][FACT:note|Old Pact|An oath]',
    )).toEqual([]);
    // A prose mention of a tagged name is the same entity, not a new one.
    expect(titles('Later, Aria walks alone.\n[FACT:character|Aria Voss|A sorceress]')).toEqual([]);
    // The same name tagged twice, once as a renderer-filed note, stays filed once.
    expect(titles('[FACT:note|Veil Law|An oath][FACT:inbox|Veil Law|Magic fails at the border]')).toEqual([]);
  });

  it('a **bold** name counts even where it opens a line', () => {
    const [proposal] = extract('**Kael** is a smuggler with debts.');
    expect(proposal.title).toBe('Kael');
    expect(proposal.body).toBe('Kael is a smuggler with debts.');
  });

  it('bold section labels are not names', () => {
    expect(titles('**Setting:** a port at night.\n\n**Themes**\n\nloss and debt.')).toEqual([]);
  });
});

describe('extractProposalsByScript — dedup and filters', () => {
  it('suppresses names the vault already has, case-insensitively', () => {
    expect(titles('The guard watches Corwin.', { known: ['corwin'] })).toEqual([]);
    expect(titles('[FACT:faction|Ashen Hand|A cult]', { known: ['ASHEN HAND'] })).toEqual([]);
  });

  it('suppresses a longer name that contains a known one', () => {
    expect(titles('Then Lady Elspeth arrives.', { known: ['Elspeth'] })).toEqual([]);
  });

  it('suppresses names rejected this session, case-insensitively', () => {
    expect(titles('The guard watches Corwin.', { rejected: ['CORWIN'] })).toEqual([]);
    expect(titles('[FACT:faction|Ashen Hand|A cult]', { rejected: ['ashen hand'] })).toEqual([]);
  });

  it('proposes one card per name even when the agent repeats it', () => {
    expect(titles('[FACT:faction|Ashen Hand|A cult][FACT:faction|Ashen Hand|Fire cult] The Ashen Hand rises.'))
      .toEqual(['Ashen Hand']);
  });

  it('unwraps wikilinks to unknown names in the body and keeps known ones', () => {
    const [proposal] = extract('Soon [[Mira]] met [[Kael]] at the docks.', { known: ['Mira'] });
    expect(proposal.title).toBe('Kael');
    expect(proposal.body).toBe('Soon [[Mira]] met Kael at the docks.');
  });

  it('honours the proposal cap, default included', () => {
    const syllables = ['ka', 'ri', 'mo', 'zen', 'tal', 'vor'];
    const names = Array.from({ length: 30 }, (_, i) => {
      const stem = `${syllables[i % 6]}${syllables[Math.floor(i / 6)]}n`;
      return stem[0].toUpperCase() + stem.slice(1);
    });
    expect(new Set(names).size).toBe(30);
    const many = names.map((name) => `the guard saw ${name}`).join(', ');
    expect(extract(many).length).toBe(DEFAULT_MAX_PROPOSALS);
    expect(extract(many, { max: 3 }).length).toBe(3);
    expect(extract(many, { max: 0 })).toEqual([]);
  });
});

describe('extractProposalsByScript — confidence floor', () => {
  // One plain, uncued, single mention: the lowest score the script ships.
  const AT_FLOOR = 'Later the crew argued about Zorvath and the broken compass.';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps a candidate scored exactly at the floor', () => {
    const proposals = extract(AT_FLOOR);
    expect(proposals.map((p) => [p.title, p.kind, p.extractionConfidence])).toEqual([
      ['Zorvath', 'inbox', MIN_EXTRACTION_CONFIDENCE],
    ]);
  });

  it('drops a candidate scored just below the floor', () => {
    // Shipped scores never start below the floor, so lower this candidate's
    // final rounding (clamp's Math.round, the script's only one) by one step.
    const round = Math.round;
    const floorStep = round(MIN_EXTRACTION_CONFIDENCE * 100);
    const spy = vi.spyOn(Math, 'round').mockImplementation((x: number) => {
      const r = round(x);
      return r === floorStep ? r - 1 : r;
    });
    expect(extract(AT_FLOOR)).toEqual([]);
    expect(spy).toHaveBeenCalled();
  });
});

describe('extractProposalsByScript — robustness', () => {
  it('empty or garbage input returns [] without throwing', () => {
    const garbage: unknown[] = ['', '   ', '!!!', '[FACT:', '[[', '**', '\u0000\u0001', 'a'.repeat(10_000), null, undefined, 42, {}];
    for (const input of garbage) {
      expect(() => extractProposalsByScript(input as string, new Set(), new Set(), TURN)).not.toThrow();
      expect(extractProposalsByScript(input as string, new Set(), new Set(), TURN)).toEqual([]);
    }
    // Bad name sets degrade to empty rather than throwing.
    expect(() => extractProposalsByScript('The guard watches Corwin.', null as never, undefined as never, TURN)).not.toThrow();
    expect(extractProposalsByScript('The guard watches Corwin.', null as never, undefined as never, TURN)
      .map((p) => p.title)).toEqual(['Corwin']);
    // Even a name set that throws while being read yields [] instead of an IPC error.
    const hostile = { [Symbol.iterator]: () => { throw new Error('boom'); } } as unknown as Set<string>;
    expect(extractProposalsByScript('The guard watches Corwin.', hostile, new Set(), TURN)).toEqual([]);
  });

  it('is deterministic given generateId', () => {
    const text = 'The smugglers met in Kesh. Later, Corwin said nothing. [FACT:faction|Ashen Hand|A cult]';
    expect(extract(text)).toEqual(extract(text));
    expect(extract(text).map((p) => p.id)).toEqual(['id-1', 'id-2', 'id-3']);
  });

  it('scans a 5k-word turn within budget (best of 5)', () => {
    const sentences = [
      'Captain Mira Sol sailed from Port Varn toward the Sword Coast while the guard watched.',
      'Later in Kesh, the Order of Ash met beside the old well, and Corwin said little.',
      'She carried the Blade of Dawn wrapped in oilcloth through the narrow streets.',
      'Nobody trusted Lady Elspeth after the fire, yet everyone listened when she spoke.',
      'The rain kept falling and the lanterns of the market burned low until morning.',
    ];
    const parts: string[] = [];
    let wordCount = 0;
    for (let i = 0; wordCount < 5_000; i += 1) {
      const s = sentences[i % sentences.length];
      parts.push(s);
      wordCount += s.split(/\s+/).length;
    }
    const fixture = parts.join(' ');
    expect(fixture.split(/\s+/).length).toBeGreaterThanOrEqual(5_000);

    let best = Infinity;
    let result: NoteProposal[] = [];
    for (let run = 0; run < 5; run += 1) {
      const t0 = performance.now();
      result = extractProposalsByScript(fixture, new Set(['Ravenspire']), new Set(), TURN);
      best = Math.min(best, performance.now() - t0);
    }
    // The measured run did real work.
    expect(result.map((p) => p.title)).toEqual(expect.arrayContaining(['Captain Mira Sol', 'Kesh', 'Blade of Dawn']));
    // Shared CI runners are noisy: assert a generous bound by default, the plan's strict 50 ms only with MYTHOS_PERF=1.
    expect(best).toBeLessThan(process.env.MYTHOS_PERF === '1' ? 50 : 250);
  });
});

describe('brainstormExtractScript module — no AI, no network', () => {
  it('imports nothing that can reach a model or the network', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, 'brainstormExtractScript.ts'), 'utf-8');
    const imports = [...source.matchAll(/^import[^;]*?from\s+'([^']+)'/gms)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      expect(spec).not.toMatch(/anthropic|openai|provider|streaming|^https?$|^net$|^node:(?:https?|net)$|electron|undici|axios/);
    }
    expect(source).not.toMatch(/@anthropic-ai\/sdk/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bnew\s+Anthropic\s*\(/);
    expect(source).not.toMatch(/claude-[a-z0-9-]+/i);
    expect(source).not.toMatch(/\bset(?:Timeout|Interval)\s*\(/);
  });
});
