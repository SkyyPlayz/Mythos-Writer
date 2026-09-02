// Beta 3 / M18 — Scene Crafter setup state + draft-board composition tests.

import { describe, it, expect } from 'vitest';
import {
  CRAFTER_GENERATE_COPY,
  CRAFTER_LENGTHS,
  CRAFTER_TONES,
  addBeat,
  addRef,
  buildDraftPrompt,
  cardSeedFromSuggested,
  castCardsFromSuggested,
  composeDraftBoard,
  composeDraftPassCard,
  craftedSceneNote,
  defaultCrafterSetup,
  filterSuggested,
  groupSuggested,
  itemsFromSuggested,
  legacyBeatsFromLanes,
  moveBeat,
  placesFromSuggested,
  planNotesFromVault,
  refCardsForColumn,
  refPickerCards,
  removeBeat,
  removeRef,
  slotForSuggestedGroup,
  suggestedFromVault,
  toggleTone,
  wordCount,
  type CrafterSetup,
  type VaultListItem,
} from './crafterState';

function item(path: string, isDirectory = false, excerpt?: string, characterTag?: boolean): VaultListItem {
  return {
    path,
    name: path.split('/').pop() ?? path,
    isDirectory,
    modifiedAt: '2026-06-30T12:00:00.000Z',
    excerpt,
    characterTag,
  };
}

describe('crafter setup state', () => {
  it('defaults match the prototype crafter shape (line 3287)', () => {
    const setup = defaultCrafterSetup();
    expect(setup.len).toBe('Medium');
    expect(setup.beats).toEqual([]);
    expect(setup.tones).toEqual({});
  });

  it('exposes the prototype tone and length lists plus the Beta 4/M19 Custom length', () => {
    expect(CRAFTER_TONES).toEqual(['Tense', 'Quiet', 'Action', 'Mystery', 'Dread', 'Wonder']);
    expect(CRAFTER_LENGTHS).toEqual(['Short', 'Medium', 'Long', 'Custom']);
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

  it('moveBeat reorders by index and is a no-op past either edge', () => {
    const setup = { ...defaultCrafterSetup(), beats: ['a', 'b', 'c'] };
    expect(moveBeat(setup, 0, 1).beats).toEqual(['b', 'a', 'c']);
    expect(moveBeat(setup, 2, 1)).toBe(setup); // past the right edge
    expect(moveBeat(setup, 0, -1)).toBe(setup); // past the left edge
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

  // SKY-10511: the card body is the note's hook line (main-side excerpt),
  // with the folder path kept only as the empty-note fallback.
  it('uses the listing excerpt as the card description when present', () => {
    const cards = suggestedFromVault([
      item('Locations/Ward Violet.md', false, "The district that doesn't exist"),
    ]);
    expect(cards[0].d).toBe("The district that doesn't exist");
  });

  it('falls back to the folder path (or "Vault root") when the excerpt is empty or absent', () => {
    const cards = suggestedFromVault([
      item('Locations/Empty Note.md', false, ''),
      item('Characters/No Excerpt Field.md'),
      item('Rootling.md', false, ''),
    ]);
    expect(cards.map((c) => c.d)).toEqual(['Locations', 'Characters', 'Vault root']);
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

  it('title-cases lowercase filenames without touching already-cased ones (GAP P2 #13)', () => {
    const cards = suggestedFromVault([item('Chapters/chaper 1.md'), item('Characters/McMillan.md')]);
    expect(cards.map((c) => c.t)).toEqual(['Chaper 1', 'McMillan']);
  });

  it('castCardsFromSuggested and placesFromSuggested split the right kanban columns (§7.1)', () => {
    const cards = suggestedFromVault(items);
    expect(castCardsFromSuggested(cards).map((c) => c.t)).toEqual(['Liora Ashen', 'The Lamplighter']);
    expect(placesFromSuggested(cards).map((c) => c.t)).toEqual(['Ward Violet']);
  });

  // SKY-11049 item 7: the owner's real vault has no top-level `Characters`
  // folder — notes live under `Main Characters/` and carry a `#Character`
  // tag instead. castCardsFromSuggested must find them via the tag signal.
  it('falls back to the vault-wide character signal when there is no Characters folder', () => {
    const noFolderItems = [
      item('Main Characters/Mira Veynn.md', false, 'Runs the lamplighter guild.', true),
      item('Main Characters/Untagged Extra.md', false, 'Just a name in the same folder.', false),
      item('Locations/Ward Violet.md'),
    ];
    const cards = suggestedFromVault(noFolderItems);
    expect(castCardsFromSuggested(cards).map((c) => c.t)).toEqual(['Mira Veynn']);
  });

  it('prefers the Characters folder over the tag fallback when both exist', () => {
    const mixedItems = [
      item('Characters/Liora Ashen.md'),
      item('Notes/Side Character.md', false, undefined, true),
    ];
    const cards = suggestedFromVault(mixedItems);
    expect(castCardsFromSuggested(cards).map((c) => c.t)).toEqual(['Liora Ashen']);
  });

  it('resolves to no cast at all when neither a Characters folder nor any tag exists', () => {
    const cards = suggestedFromVault([item('Locations/Ward Violet.md')]);
    expect(castCardsFromSuggested(cards)).toEqual([]);
  });
});

describe('slotForSuggestedGroup / cardSeedFromSuggested (SKY-9878 — canvas spec §5)', () => {
  it('maps the three suggested-card groups to their spec slot colors', () => {
    expect(slotForSuggestedGroup('CHARACTERS')).toBe(0);
    expect(slotForSuggestedGroup('LOCATIONS')).toBe(1);
    expect(slotForSuggestedGroup('ITEMS & SYSTEMS')).toBe(3);
  });

  it('falls back to slot 4 (the onAddCard blank-card default) for any other vault folder', () => {
    expect(slotForSuggestedGroup('NOTES')).toBe(4);
    expect(slotForSuggestedGroup('WHATEVER')).toBe(4);
  });

  it('carries a suggested card\'s fields + slot straight into a canvas card seed', () => {
    const [card] = suggestedFromVault([item('Locations/Ward Violet.md')]);
    expect(cardSeedFromSuggested(card)).toEqual({
      t: 'Ward Violet',
      d: 'Locations',
      av: card.av,
      c: 1,
      nid: 'Locations/Ward Violet',
    });
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

  it('appends the AI first-pass draft card last and links it from the hub (AC6/AC7)', () => {
    const draftCard = composeDraftPassCard(setup, 'She reached the door.', 'b6-first-pass');
    const board = composeDraftBoard(setup, [], 1, 'b6', draftCard);
    expect(board.cards.at(-1)).toBe(draftCard);
    expect(board.links).toContainEqual(['b6-0', 'b6-first-pass']);
  });

  it('omits the draft card entirely when none is passed (existing callers unaffected)', () => {
    const board = composeDraftBoard(setup, [], 1, 'b7');
    expect(board.cards.some((c) => c.id.includes('first-pass'))).toBe(false);
  });
});

describe('composeDraftPassCard (Beta 4/M19 §7.1 — AI first-pass draft card)', () => {
  const setup: CrafterSetup = { ...defaultCrafterSetup(), title: 'The Broken Gate' };

  it('labels the card "— first pass" and reports the word count', () => {
    const card = composeDraftPassCard(setup, 'She reached the sealed door and stopped.', 'c1');
    expect(card.t).toBe('The Broken Gate — first pass');
    expect(card.d).toContain('— 7 words');
    expect(card.nid).toBeNull();
  });

  it('truncates long drafts to a preview with an ellipsis', () => {
    const long = 'word '.repeat(200).trim();
    const card = composeDraftPassCard(setup, long, 'c2');
    expect(card.d).toMatch(/…\n\n— 200 words$/);
    expect(card.d.length).toBeLessThan(long.length);
  });

  it('untitled setups fall back to "Untitled scene — first pass"', () => {
    const card = composeDraftPassCard(defaultCrafterSetup(), 'Text.', 'c3');
    expect(card.t).toBe('Untitled scene — first pass');
  });
});

describe('wordCount', () => {
  it('counts whitespace-delimited words and handles blank text', () => {
    expect(wordCount('  She reached   the door.  ')).toBe(4);
    expect(wordCount('')).toBe(0);
    expect(wordCount('   ')).toBe(0);
  });
});

describe('buildDraftPrompt (Beta 4/M19 §7.1 — Coach-framed generation)', () => {
  it('includes every populated setup field and the coach-framed copy is verbatim from spec', () => {
    const setup: CrafterSetup = {
      ...defaultCrafterSetup(),
      title: 'The Broken Gate',
      pov: 'Mira Veynn',
      goal: 'Reach the unmapped door.',
      conflict: 'The Broker wants a memory.',
      beats: ['Cold open on the sealed door', 'The hum answers her blood'],
      tones: { Tense: true },
    };
    const chosen = [{ title: 'Kael Thorne', desc: 'Favor-debt callback.', nid: 'Characters/Kael Thorne' }];
    const prompt = buildDraftPrompt(setup, chosen, 'She has one chance to open it.');
    expect(prompt).toContain('Title: The Broken Gate');
    expect(prompt).toContain('POV: Mira Veynn');
    expect(prompt).toContain('Goal: Reach the unmapped door.');
    expect(prompt).toContain('Conflict: The Broker wants a memory.');
    expect(prompt).toContain('1. Cold open on the sealed door');
    expect(prompt).toContain('2. The hum answers her blood');
    expect(prompt).toContain('Tone: Tense');
    expect(prompt).toContain('Length: Medium');
    expect(prompt).toContain('Quick summary: She has one chance to open it.');
    expect(prompt).toContain('- Kael Thorne: Favor-debt callback.');

    expect(CRAFTER_GENERATE_COPY).toBe(
      'Set the shape — the Writing Coach drafts a first-pass scaffold from YOUR ' +
      'beats, then annotates why it made each choice, so the rewrite teaches you.',
    );
  });

  it('uses the custom length text when len is Custom', () => {
    const setup = { ...defaultCrafterSetup(), len: 'Custom' as const, customLen: '900 words' };
    expect(buildDraftPrompt(setup, [], '')).toContain('Length: 900 words');
  });

  it('omits every empty field instead of emitting blank lines', () => {
    const prompt = buildDraftPrompt(defaultCrafterSetup(), [], '');
    expect(prompt).toBe('Title: Untitled scene\n\nLength: Medium');
  });
});

describe('craftedSceneNote (SKY-11279 — Create Scene must not drop setup fields)', () => {
  it('includes goal/conflict/beats/tone/length but not title or POV', () => {
    const setup: CrafterSetup = {
      ...defaultCrafterSetup(),
      title: 'The Broken Gate',
      pov: 'Mira Veynn',
      goal: 'Reach the unmapped door.',
      conflict: 'The Broker wants a memory.',
      beats: ['Cold open on the sealed door', 'The hum answers her blood'],
      tones: { Tense: true },
    };
    const note = craftedSceneNote(setup);
    expect(note).toContain('Goal: Reach the unmapped door.');
    expect(note).toContain('Conflict: The Broker wants a memory.');
    expect(note).toContain('1. Cold open on the sealed door');
    expect(note).toContain('2. The hum answers her blood');
    expect(note).toContain('Tone: Tense');
    expect(note).toContain('Length: Medium');
    expect(note).not.toContain('The Broken Gate');
    expect(note).not.toContain('Mira Veynn');
  });

  it('uses the custom length text when len is Custom', () => {
    const setup = { ...defaultCrafterSetup(), len: 'Custom' as const, customLen: '900 words' };
    expect(craftedSceneNote(setup)).toContain('Length: 900 words');
  });

  it('still reports the default length when every other field is empty', () => {
    expect(craftedSceneNote(defaultCrafterSetup())).toBe('Length: Medium');
  });
});

describe('vault-reference columns (SKY-11072 — owner ruling, prototype crafterVaultCols)', () => {
  const cards = suggestedFromVault([
    item('Characters/Mira Veynn.md'),
    item('Locations/The Undercity.md'),
    item('Items & Systems/Drownlight.md'),
    item('Loose Note.md', false, undefined, true), // #Character-tagged, outside any folder
    item('Plans/Plan Act One.md'),
  ]);

  it('itemsFromSuggested picks the ITEMS & SYSTEMS vault group', () => {
    expect(itemsFromSuggested(cards).map((c) => c.nid)).toEqual(['Items & Systems/Drownlight']);
  });

  it('each column starts from its vault group: characters / locations / items', () => {
    const setup = defaultCrafterSetup();
    expect(refCardsForColumn('characters', cards, setup).map((c) => c.nid)).toEqual(['Characters/Mira Veynn']);
    expect(refCardsForColumn('locations', cards, setup).map((c) => c.nid)).toEqual(['Locations/The Undercity']);
    expect(refCardsForColumn('items', cards, setup).map((c) => c.nid)).toEqual(['Items & Systems/Drownlight']);
  });

  it('removeRef hides the card from THIS column only and never mutates the input', () => {
    const setup = defaultCrafterSetup();
    const next = removeRef(setup, 'characters', 'Characters/Mira Veynn');
    expect(refCardsForColumn('characters', cards, next)).toEqual([]);
    // Other columns untouched; original setup untouched.
    expect(refCardsForColumn('locations', cards, next).map((c) => c.nid)).toEqual(['Locations/The Undercity']);
    expect(refCardsForColumn('characters', cards, setup).map((c) => c.nid)).toEqual(['Characters/Mira Veynn']);
    expect(removeRef(next, 'characters', 'Characters/Mira Veynn')).toBe(next); // idempotent
  });

  it('addRef layers any vault note onto a column, in pick order after the base', () => {
    const setup = addRef(defaultCrafterSetup(), 'characters', 'Loose Note');
    expect(refCardsForColumn('characters', cards, setup).map((c) => c.nid)).toEqual([
      'Characters/Mira Veynn',
      'Loose Note',
    ]);
  });

  it('addRef is the un-remove path: re-adding a removed base card restores it', () => {
    let setup = removeRef(defaultCrafterSetup(), 'characters', 'Characters/Mira Veynn');
    setup = addRef(setup, 'characters', 'Characters/Mira Veynn');
    expect(refCardsForColumn('characters', cards, setup).map((c) => c.nid)).toEqual(['Characters/Mira Veynn']);
  });

  it('a stale added nid (note gone from the vault) drops out instead of rendering dead', () => {
    const setup = addRef(defaultCrafterSetup(), 'items', 'Deleted/Note');
    expect(refCardsForColumn('items', cards, setup).map((c) => c.nid)).toEqual(['Items & Systems/Drownlight']);
  });

  it('refPickerCards offers notes not visible in the column, filtered like the rail', () => {
    const setup = defaultCrafterSetup();
    const offered = refPickerCards('characters', cards, setup, '');
    expect(offered.map((c) => c.nid)).not.toContain('Characters/Mira Veynn');
    expect(offered.map((c) => c.nid)).toContain('Loose Note');
    // Removed notes ARE offered — picking one is the un-remove path.
    const removed = removeRef(setup, 'characters', 'Characters/Mira Veynn');
    expect(refPickerCards('characters', cards, removed, 'mira').map((c) => c.nid)).toEqual(['Characters/Mira Veynn']);
  });

  it('a #Character-tagged loose note only reaches CHARACTERS when no Characters folder exists', () => {
    const tagOnly = suggestedFromVault([item('Kael Thorne.md', false, undefined, true)]);
    expect(refCardsForColumn('characters', tagOnly, defaultCrafterSetup()).map((c) => c.nid)).toEqual(['Kael Thorne']);
  });
});

describe('legacyBeatsFromLanes (SKY-11072 instruction 3 — no beat data lost)', () => {
  it('surfaces card titles from a lane named Beats, trimmed and deduped', () => {
    const beats = legacyBeatsFromLanes([
      { name: 'Idea', cards: [{ title: 'Not a beat' }] },
      { name: ' Beats ', cards: [{ title: '  Cold open  ' }, { title: 'Cold open' }, { title: '' }, { title: 'The door answers' }] },
    ]);
    expect(beats).toEqual(['Cold open', 'The door answers']);
  });

  it('returns empty when no beat-shaped lane exists (default lane set)', () => {
    expect(legacyBeatsFromLanes([
      { name: 'Idea', cards: [] },
      { name: 'Outline', cards: [] },
      { name: 'Draft', cards: [] },
    ])).toEqual([]);
  });
});
