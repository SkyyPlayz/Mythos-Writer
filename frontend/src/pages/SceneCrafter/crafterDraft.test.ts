// Beta 4 / M19 — Scene Crafter AI draft generation tests.

import { describe, it, expect } from 'vitest';
import { defaultCrafterSetup, type ChosenCard, type CrafterSetup } from './crafterState';
import {
  buildDraftPrompt,
  countWords,
  draftFromResponseText,
  landDraftOnBoard,
  previewText,
} from './crafterDraft';

function setupWith(patch: Partial<CrafterSetup>): CrafterSetup {
  return { ...defaultCrafterSetup(), ...patch };
}

describe('buildDraftPrompt', () => {
  it('includes the scene facts and asks for a Coach-framed "why" annotation', () => {
    const setup = setupWith({
      title: 'The Sealed Door',
      pov: 'Mira',
      goal: 'Get past the door before the watch returns',
      conflict: 'The lock needs a key she just dropped',
      beats: ['Cold open on the door', 'Mira fumbles the key'],
      tones: { Tense: true, Wonder: false },
      len: 'Short',
    });
    const prompt = buildDraftPrompt(setup, []);
    expect(prompt).toContain('"The Sealed Door"');
    expect(prompt).toContain('POV: Mira');
    expect(prompt).toContain('Goal: Get past the door before the watch returns');
    expect(prompt).toContain('Conflict: The lock needs a key she just dropped');
    expect(prompt).toContain('Cold open on the door → Mira fumbles the key');
    expect(prompt).toContain('Tone: Tense');
    expect(prompt).toContain('Length: Short');
    expect(prompt).toContain('Why these choices');
    expect(prompt.toLowerCase()).not.toMatch(/write.*directly.*manuscript|insert.*manuscript/);
  });

  it('omits blank optional fields and lists reference cards', () => {
    const setup = setupWith({ title: '' });
    const chosen: ChosenCard[] = [{ title: 'Mira', desc: 'Runs the black-market stall', nid: 'Characters/Mira' }];
    const prompt = buildDraftPrompt(setup, chosen);
    expect(prompt).toContain('"Untitled scene"');
    expect(prompt).not.toContain('POV:');
    expect(prompt).not.toContain('Goal:');
    expect(prompt).toContain('- Mira: Runs the black-market stall');
    expect(prompt).toContain('(no beats set)');
    expect(prompt).toContain('(no tone set)');
  });
});

describe('countWords', () => {
  it('counts whitespace-delimited words', () => {
    expect(countWords('The door held.  Barely.')).toBe(4);
  });

  it('treats blank text as zero words', () => {
    expect(countWords('   ')).toBe(0);
    expect(countWords('')).toBe(0);
  });
});

describe('previewText', () => {
  it('returns short text unchanged', () => {
    expect(previewText('Short draft.')).toBe('Short draft.');
  });

  it('truncates long text with an ellipsis at the limit', () => {
    const long = 'word '.repeat(100).trim();
    const preview = previewText(long, 20);
    expect(preview.length).toBeLessThanOrEqual(21);
    expect(preview.endsWith('…')).toBe(true);
  });
});

describe('draftFromResponseText', () => {
  it('shapes the agent response into text + word count + preview', () => {
    const draft = draftFromResponseText('A short first pass.');
    expect(draft.text).toBe('A short first pass.');
    expect(draft.wordCount).toBe(4);
    expect(draft.preview).toBe('A short first pass.');
  });
});

describe('landDraftOnBoard', () => {
  it('labels the hub card "— first pass" and carries the draft text as its body', () => {
    const setup = setupWith({ title: 'The Sealed Door', pov: 'Mira' });
    const draft = draftFromResponseText('Mira knelt at the sealed door...');
    const board = landDraftOnBoard(setup, [], draft, 1, 'b1');
    expect(board.name).toBe('The Sealed Door — first pass 1');
    const hub = board.cards[0];
    expect(hub.t).toBe('The Sealed Door — first pass');
    expect(hub.d).toBe('Mira knelt at the sealed door...');
  });

  it('keeps the POV and reference satellite cards from the structural layout', () => {
    const setup = setupWith({ title: 'The Sealed Door', pov: 'Mira' });
    const chosen: ChosenCard[] = [{ title: 'The Vault', desc: 'Locked chamber', nid: 'Places/Vault' }];
    const draft = draftFromResponseText('Draft text.');
    const board = landDraftOnBoard(setup, chosen, draft, 2, 'b2');
    const satelliteTitles = board.cards.slice(1).map((c) => c.t);
    expect(satelliteTitles).toEqual(['Mira', 'The Vault']);
  });

  it('does not touch any manuscript/scene write surface', () => {
    // Guards against a future edit re-introducing a manuscript write here —
    // AC#6 requires generated prose never auto-routes into the manuscript.
    const setup = setupWith({ title: 'Untitled' });
    const draft = draftFromResponseText('Text.');
    expect(() => landDraftOnBoard(setup, [], draft, 1, 'b3')).not.toThrow();
  });
});
