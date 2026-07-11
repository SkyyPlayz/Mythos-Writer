// Beta 4 M3 — New Story wizard flow contract: the wizard creates the story
// AND a Story Plan note (BETA-REFINE M3 acceptance). Pure-helper coverage;
// NewStoryWizard.test.tsx covers the dialog itself.
import { describe, it, expect } from 'vitest';
import {
  buildFolderOptions,
  buildNewStoryPlanNote,
  dedupePlanRelPath,
  makeStoryFromDraft,
  storyPlanFileName,
} from './newStoryFlow';
import type { NewStoryDraft } from './newStoryFlow';
import { parsePlanUnits } from './timelinePlanBuild';

const draft = (overrides: Partial<NewStoryDraft> = {}): NewStoryDraft => ({
  name: 'The Hollow Crown',
  genre: 'Dark Fantasy',
  voice: 'Dark & Gritty',
  pov: 'Third Limited',
  linkedFolders: [],
  ...overrides,
});

describe('makeStoryFromDraft', () => {
  it('creates a story carrying the voice preset that tunes the Writing Coach', () => {
    const story = makeStoryFromDraft(draft(), { id: 'id-1', createdAt: '2026-07-11T00:00:00.000Z' });
    expect(story).toMatchObject({
      id: 'id-1',
      title: 'The Hollow Crown',
      path: 'stories/id-1',
      chapters: [],
      genre: 'Dark Fantasy',
      voice: 'Dark & Gritty',
      pov: 'Third Limited',
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z',
    });
  });

  it('falls back to "Untitled Story" for a blank name (prototype nsCreate)', () => {
    const story = makeStoryFromDraft(draft({ name: '   ' }), { id: 'id-2', createdAt: 'now' });
    expect(story.title).toBe('Untitled Story');
  });

  it('records the linked note folders on the story', () => {
    const story = makeStoryFromDraft(
      draft({ linkedFolders: ['Plans/Act structure', 'Characters'] }),
      { id: 'id-3', createdAt: 'now' },
    );
    expect(story.linkedPlanFolders).toEqual(['Plans/Act structure', 'Characters']);
  });
});

describe('storyPlanFileName / dedupePlanRelPath', () => {
  it('mirrors the import-flow naming convention', () => {
    expect(storyPlanFileName('The Hollow Crown')).toBe('Plan — The Hollow Crown.md');
  });

  it('sanitizes filesystem-hostile characters like the import flow', () => {
    expect(storyPlanFileName('A/B: "C"?')).toBe('Plan — A B C.md');
  });

  it('places the note under Plans/ (where Scene Crafter + the timeline read plans)', () => {
    expect(dedupePlanRelPath('Veynn', [])).toBe('Plans/Plan — Veynn.md');
  });

  it('dedupes against existing plan notes with a numeric suffix', () => {
    const existing = ['Plans/Plan — Veynn.md', 'Plans/Plan — Veynn 2.md'];
    expect(dedupePlanRelPath('Veynn', existing)).toBe('Plans/Plan — Veynn 3.md');
  });

  it('dedupes case-insensitively and across Windows separators', () => {
    expect(dedupePlanRelPath('Veynn', ['Plans\\plan — veynn.md'])).toBe('Plans/Plan — Veynn 2.md');
  });
});

describe('buildNewStoryPlanNote', () => {
  const story = makeStoryFromDraft(draft({ linkedFolders: ['Characters'] }), {
    id: 'story-9',
    createdAt: '2026-07-11T00:00:00.000Z',
  });

  it('writes story-plan frontmatter with the voice preset', () => {
    const note = buildNewStoryPlanNote(story, draft({ linkedFolders: ['Characters'] }));
    expect(note.startsWith('---\n')).toBe(true);
    expect(note).toContain('type: story-plan');
    expect(note).toContain('title: "Plan — The Hollow Crown"');
    expect(note).toContain('genre: "Dark Fantasy"');
    expect(note).toContain('voice: "Dark & Gritty"');
    expect(note).toContain('pov: "Third Limited"');
    expect(note).toContain('- "Characters"');
    expect(note).toContain('# Plan — The Hollow Crown');
  });

  it('mentions the linked folders in the body', () => {
    const note = buildNewStoryPlanNote(story, draft({ linkedFolders: ['Characters'] }));
    expect(note).toContain('Linked plan folders: Characters.');
  });

  it('produces ZERO phantom planned timeline units for a fresh story', () => {
    // timelinePlanBuild parses ## headings and list items in plan notes into
    // planned chapters/scenes — a brand-new story must not plot any.
    const note = buildNewStoryPlanNote(story, draft({ linkedFolders: ['Characters'] }));
    expect(parsePlanUnits(note, 'Plans/Plan — The Hollow Crown')).toEqual([]);
  });

  it('produces zero planned units with no linked folders too', () => {
    const bare = makeStoryFromDraft(draft(), { id: 's', createdAt: 'now' });
    const note = buildNewStoryPlanNote(bare, draft());
    expect(parsePlanUnits(note, 'p')).toEqual([]);
    expect(note).toContain('Nothing linked yet');
  });
});

describe('buildFolderOptions', () => {
  it('lists directories with recursive .md note counts', () => {
    const options = buildFolderOptions([
      { path: 'Characters', name: 'Characters', isDirectory: true },
      { path: 'Characters/Kael.md', name: 'Kael.md', isDirectory: false },
      { path: 'Characters/Minor', name: 'Minor', isDirectory: true },
      { path: 'Characters/Minor/Guard.md', name: 'Guard.md', isDirectory: false },
      { path: 'Plans', name: 'Plans', isDirectory: true },
      { path: 'Plans/Plan — Veynn.md', name: 'Plan — Veynn.md', isDirectory: false },
      { path: 'loose-note.md', name: 'loose-note.md', isDirectory: false },
      { path: 'image.png', name: 'image.png', isDirectory: false },
    ]);

    expect(options).toEqual([
      { path: 'Characters', label: 'Characters', noteCount: 2 },
      { path: 'Characters/Minor', label: 'Characters / Minor', noteCount: 1 },
      { path: 'Plans', label: 'Plans', noteCount: 1 },
    ]);
  });

  it('normalizes Windows separators from the main-process listing', () => {
    const options = buildFolderOptions([
      { path: 'Plans\\Acts', name: 'Acts', isDirectory: true },
      { path: 'Plans\\Acts\\Act I.md', name: 'Act I.md', isDirectory: false },
      { path: 'Plans', name: 'Plans', isDirectory: true },
    ]);
    expect(options).toEqual([
      { path: 'Plans', label: 'Plans', noteCount: 1 },
      { path: 'Plans/Acts', label: 'Plans / Acts', noteCount: 1 },
    ]);
  });
});
