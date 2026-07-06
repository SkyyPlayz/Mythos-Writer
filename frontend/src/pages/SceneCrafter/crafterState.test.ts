// Beta 3 / M18 — Scene Crafter setup state + draft-board composition tests.

import { describe, it, expect } from 'vitest';
import {
  CRAFTER_LENGTHS,
  CRAFTER_TONES,
  addBeat,
  composeDraftBoard,
  defaultCrafterSetup,
  filterSuggested,
  groupSuggested,
  planNotesFromVault,
  removeBeat,
  suggestedFromVault,
  toggleTone,
  type CrafterSetup,
  type VaultListItem,
} from './crafterState';

function item(path: string, isDirectory = false): VaultListItem {
  return { path, name: path.split('/').pop() ?? path, isDirectory, modifiedAt: '2026-06-30T12:00:00.000Z' };
}

describe('crafter setup state', () => {
  it('defaults match the prototype crafter shape (line 3287)', () => {
    const setup = defaultCrafterSetup();
    expect(setup.len).toBe('Medium');
    expect(setup.status).toBe('idle');
    expect(setup.beats).toEqual([]);
    expect(setup.tones).toEqual({});
  });

  it('exposes the prototype tone and length lists', () => {
    expect(CRAFTER_TONES).toEqual(['Tense', 'Quiet', 'Action', 'Mystery', 'Dread', 'Wonder']);
    expect(CRAFTER_LENGTHS).toEqual(['Short', 'Medium', 'Long']);
  });

  it('addBeat trims and appends; blank input is a no-op', () => {
    const setup = defaultCrafterSetup();
    const one = addBeat(setup, '  Cold open on the sealed door  ');
    expect(one.beats).toEqual(['Cold open on the sealed door']);
    expect(addBeat(one, '   ')).toBe(one);
    expect(setup.beats).toEqual([]); // immutable
  });

  it('removeBeat drops exactly the indexed beat', () => {
    const setup = { ...defaultCrafterSetup(), beats: ['a', 'b', 'c'] };
    expect(removeBeat(setup, 1).beats).toEqual(['a', 'c']);
  });

  it('toggleTone flips a tone on and off', () => {
    const setup = defaultCrafterSetup();
    const on = toggleTone(setup, 'Tense');
    expect(on.tones.Tense).toBe(true);
    expect(toggleTone(on, 'Tense').tones.Tense).toBe(false);
  });
});

describe('suggested cards from the vault listing', () => {
  const items = [
    item('Characters', true),
    item('Characters/Liora-Ashen.md'),
    item('Characters/The Lamplighter.md'),
    item('Locations/Ward Violet.md'),
    item('Loose Note.md'),
    item('Boards/story-1/Gate — board 1.canvas.json'),
    item('scenes/story-1/board.md'),
    item('.obsidian/config.md'),
    item('Characters/portrait.png'),
  ];

  it('maps markdown notes to grouped cards and skips internals', () => {
    const cards = suggestedFromVault(items);
    expect(cards.map((c) => c.nid)).toEqual([
      'Characters/Liora-Ashen',
      'Characters/The Lamplighter',
      'Locations/Ward Violet',
      'Loose Note',
    ]);
    expect(cards[0].t).toBe('Liora Ashen');
    expect(cards[0].av).toBe('LA');
    expect(cards[0].group).toBe('CHARACTERS');
    expect(cards[3].group).toBe('NOTES');
  });

  it('filters with the prototype "title + description" substring rule (line 4527)', () => {
    const cards = suggestedFromVault(items);
    expect(filterSuggested(cards, 'lamp').map((c) => c.t)).toEqual(['The Lamplighter']);
    expect(filterSuggested(cards, 'locations').map((c) => c.t)).toEqual(['Ward Violet']);
    expect(filterSuggested(cards, '')).toEqual(cards);
  });

  it('groups cards under their headings and drops empty groups', () => {
    const groups = groupSuggested(filterSuggested(suggestedFromVault(items), 'ward'));
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe('LOCATIONS');
    expect(groups[0].cards.map((c) => c.t)).toEqual(['Ward Violet']);
  });
});

describe('plan cards from the vault listing', () => {
  it('finds "Plan …" notes and anything under Plans/', () => {
    const plans = planNotesFromVault([
      item('Plans/Undercity arc.md'),
      item('Plan — The Broken Gate.md'),
      item('Planetary Motion.md'), // "Plan" prefix requires a word boundary
      item('Characters/Mira.md'),
    ]);
    expect(plans.map((p) => p.id)).toEqual(['Plans/Undercity arc', 'Plan — The Broken Gate']);
    expect(plans[1].t).toBe('Plan — The Broken Gate');
  });
});

describe('composeDraftBoard (prototype draftBoard, lines 3403–3423)', () => {
  const setup: CrafterSetup = {
    ...defaultCrafterSetup(),
    title: 'The Broken Gate',
    pov: 'Mira Veynn',
    goal: 'Reach the unmapped door.',
    conflict: 'The Broker wants a memory.',
    beats: ['Cold open on the sealed door', 'The hum answers her blood'],
    tones: { Tense: true, Mystery: true },
  };

  it('places the setup hub card exactly where the prototype does (mk(0, …))', () => {
    const board = composeDraftBoard(setup, [], 1, 'b1');
    const hub = board.cards[0];
    expect(hub).toMatchObject({ id: 'b1-0', t: 'The Broken Gate — beats', av: '✦', c: 1, x: 440, y: 40, w: 280, h: 120, nid: null });
    expect(hub.d).toContain('Cold open on the sealed door · The hum answers her blood');
    expect(hub.d).toContain('Goal: Reach the unmapped door.');
    expect(hub.d).toContain('Conflict: The Broker wants a memory.');
    expect(hub.d).toContain('Tone: Tense, Mystery · Medium');
    expect(board.name).toBe('The Broken Gate — board 1');
  });

  it('adds a POV card on the first satellite position (mk(1, …): 130, 80)', () => {
    const board = composeDraftBoard(setup, [], 2, 'b2');
    const pov = board.cards[1];
    expect(pov).toMatchObject({ t: 'Mira Veynn', d: 'POV.', av: 'MV', c: 0, x: 130, y: 80, w: 200, h: 86 });
    expect(board.links).toEqual([['b2-0', 'b2-pov']]);
  });

  it('contains the setup card plus every chosen card, all linked from the hub', () => {
    const chosen = [
      { title: 'Kael Thorne', desc: 'Favor-debt callback.', nid: 'Characters/Kael Thorne' },
      { title: 'The Sunken Gate', desc: 'Opens at low tide.', nid: 'Locations/The Sunken Gate' },
      { title: 'Free idea', desc: 'No note yet.', nid: null },
    ];
    const board = composeDraftBoard(setup, chosen, 3, 'b3');
    // hub + pov + 3 chosen
    expect(board.cards).toHaveLength(5);
    expect(board.cards.map((c) => c.t)).toEqual([
      'The Broken Gate — beats', 'Mira Veynn', 'Kael Thorne', 'The Sunken Gate', 'Free idea',
    ]);
    expect(board.cards[2].nid).toBe('Characters/Kael Thorne');
    expect(board.cards[4].nid).toBeNull();
    // chosen cards occupy the prototype satellite slots after the POV card
    expect([board.cards[2].x, board.cards[2].y]).toEqual([100, 260]);
    expect([board.cards[3].x, board.cards[3].y]).toEqual([450, 280]);
    expect(board.links).toEqual([
      ['b3-0', 'b3-pov'],
      ['b3-0', 'b3-c0'],
      ['b3-0', 'b3-c1'],
      ['b3-0', 'b3-c2'],
    ]);
  });

  it('falls back to an overflow grid once the six prototype slots are used', () => {
    const chosen = Array.from({ length: 8 }, (_, i) => ({ title: `Card ${i}`, desc: '', nid: null }));
    const board = composeDraftBoard({ ...setup, pov: '' }, chosen, 1, 'b4');
    // slots 0–5 use prototype positions; 6 and 7 flow into the grid
    expect([board.cards[7].x, board.cards[7].y]).toEqual([130, 440]);
    expect([board.cards[8].x, board.cards[8].y]).toEqual([460, 440]);
  });

  it('untitled setups still produce a named board', () => {
    const board = composeDraftBoard(defaultCrafterSetup(), [], 1, 'b5');
    expect(board.name).toBe('Untitled scene — board 1');
    expect(board.cards[0].t).toBe('Untitled scene — beats');
  });
});
