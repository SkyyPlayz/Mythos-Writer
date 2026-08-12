// M9a (SKY-9822) — References tab: wiki-link auto-collection with typed
// roles, unresolved flag state, and the open/create click path.

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ReferencesPanel, { collectStoryReferences } from './ReferencesPanel';
import type { EntityEntry, Scene, Story } from './types';

const NOW = '2026-01-01T00:00:00.000Z';

function makeScene(id: string, content: string, extra: Partial<Scene> = {}): Scene {
  return {
    id,
    title: `Scene ${id}`,
    path: `stories/s1/chapters/c1/scenes/${id}.md`,
    order: 0,
    blocks: [{ id: `${id}-b1`, type: 'prose', content, order: 0, updatedAt: NOW }],
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

function makeStory(scenes: Scene[], extra: Partial<Story> = {}): Story {
  return {
    id: 's1',
    title: 'The Last City of Veynn',
    path: 'stories/s1',
    chapters: [{ id: 'c1', title: 'Fractures', path: 'stories/s1/chapters/c1', order: 0, scenes, createdAt: NOW, updatedAt: NOW }],
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

function makeEntity(name: string, type: EntityEntry['type']): EntityEntry {
  return {
    id: `e-${name}`,
    name,
    type,
    path: `${type}s/${name}.md`,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe('collectStoryReferences', () => {
  it('collects manuscript wiki-links, deduped, with resolved rows typed and pinned', () => {
    const story = makeStory([
      makeScene('sc1', 'Mira thought of [[The Sunken Gate]].'),
      makeScene('sc2', 'Back at [[The Sunken Gate]], the tide had turned.'),
    ]);
    const refs = collectStoryReferences(story, {
      stories: [story],
      entities: [makeEntity('The Sunken Gate', 'location')],
      notePaths: [],
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      title: 'The Sunken Gate',
      subtitle: 'Location · pinned',
      role: 'pinned',
      sceneCount: 2,
    });
  });

  it('flags a link whose target exists nowhere in the vault as unresolved', () => {
    const story = makeStory([makeScene('sc1', 'She recited the [[Tide Mechanics]].')]);
    const refs = collectStoryReferences(story, { stories: [story], entities: [], notePaths: [] });
    expect(refs).toHaveLength(1);
    expect(refs[0].role).toBe('unresolved');
    expect(refs[0].subtitle).toBe('Note · unresolved link');
  });

  it('resolves live once the note exists in notePaths (no reload, same call)', () => {
    const story = makeStory([makeScene('sc1', 'A [[New Thing]] appeared.')]);
    const before = collectStoryReferences(story, { stories: [story], entities: [], notePaths: [] });
    expect(before[0].role).toBe('unresolved');
    const after = collectStoryReferences(story, { stories: [story], entities: [], notePaths: ['New Thing.md'] });
    expect(after[0].role).toBe('pinned');
    expect(after[0].subtitle).toBe('Note · pinned');
  });

  it("types the active scene's POV character as `Character · POV`", () => {
    const scene = makeScene('sc1', '[[Mira Veynn]] ran.', { timelineMetadata: { pov: 'Mira Veynn' } });
    const story = makeStory([scene]);
    const refs = collectStoryReferences(
      story,
      { stories: [story], entities: [makeEntity('Mira Veynn', 'character')], notePaths: [] },
      scene,
    );
    expect(refs[0].subtitle).toBe('Character · POV');
    expect(refs[0].role).toBe('pov');
  });

  it('falls back to the story-level POV when the scene has none', () => {
    const scene = makeScene('sc1', '[[Mira Veynn]] ran.');
    const story = makeStory([scene], { pov: 'Mira Veynn' });
    const refs = collectStoryReferences(
      story,
      { stories: [story], entities: [makeEntity('Mira Veynn', 'character')], notePaths: [] },
      scene,
    );
    expect(refs[0].role).toBe('pov');
  });

  it('types a reference linked from three distinct scenes as a hub', () => {
    const story = makeStory([
      makeScene('sc1', 'Under [[The Last City of Veynn]].'),
      makeScene('sc2', 'Above [[The Last City of Veynn]].'),
      makeScene('sc3', 'Inside [[The Last City of Veynn]].'),
    ]);
    const refs = collectStoryReferences(story, {
      stories: [story],
      entities: [makeEntity('The Last City of Veynn', 'location')],
      notePaths: [],
    });
    expect(refs[0].subtitle).toBe('Location · hub');
    expect(refs[0].sceneCount).toBe(3);
  });

  it('strips |alias and #heading suffixes and uses the canonical entity name', () => {
    const story = makeStory([makeScene('sc1', 'She saw [[the sunken gate|the gate]].')]);
    const refs = collectStoryReferences(story, {
      stories: [story],
      entities: [makeEntity('The Sunken Gate', 'location')],
      notePaths: [],
    });
    expect(refs[0].title).toBe('The Sunken Gate');
    expect(refs[0].role).toBe('pinned');
  });

  it('returns nothing without a story or without links', () => {
    expect(collectStoryReferences(null, { stories: [], entities: [], notePaths: [] })).toEqual([]);
    const story = makeStory([makeScene('sc1', 'No links here.')]);
    expect(collectStoryReferences(story, { stories: [story], entities: [], notePaths: [] })).toEqual([]);
  });
});

describe('ReferencesPanel', () => {
  const gateStory = makeStory([
    makeScene('sc1', 'Mira thought of [[The Sunken Gate]] and of [[Tide Mechanics]].'),
  ]);
  const gateEntities = [makeEntity('The Sunken Gate', 'location')];

  function renderPanel(overrides: Partial<Parameters<typeof ReferencesPanel>[0]> = {}) {
    const onPickReference = vi.fn();
    render(
      <ReferencesPanel
        story={gateStory}
        activeScene={null}
        stories={[gateStory]}
        entities={gateEntities}
        notePaths={[]}
        onPickReference={onPickReference}
        {...overrides}
      />,
    );
    return { onPickReference };
  }

  it('renders the PINNED REFERENCES list with typed subtitles and the hint line', () => {
    renderPanel();
    expect(screen.getByText('Pinned References')).toBeInTheDocument();
    expect(screen.getByText('The Sunken Gate')).toBeInTheDocument();
    expect(screen.getByText('Location · pinned')).toBeInTheDocument();
    expect(screen.getByText('Wiki-links in the manuscript land here automatically.')).toBeInTheDocument();
  });

  it('flags unresolved rows and offers creation', () => {
    renderPanel();
    const row = screen.getByRole('button', { name: /Tide Mechanics — unresolved link, create the note/ });
    expect(row.className).toContain('references-panel-row--unresolved');
    expect(screen.getByText('+ Create')).toBeInTheDocument();
  });

  it('clicking a resolved row opens it through the wiki-link path', () => {
    const { onPickReference } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Open The Sunken Gate' }));
    expect(onPickReference).toHaveBeenCalledWith('The Sunken Gate');
  });

  it('clicking an unresolved row hands the raw target to the create path', () => {
    const { onPickReference } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Tide Mechanics/ }));
    expect(onPickReference).toHaveBeenCalledWith('Tide Mechanics');
  });

  it('shows the prototype empty state when the manuscript has no links', () => {
    const bare = makeStory([makeScene('sc1', 'No links yet.')]);
    renderPanel({ story: bare, stories: [bare], entities: [] });
    expect(screen.getByTestId('references-empty')).toBeInTheDocument();
    expect(screen.getByText('No references yet.')).toBeInTheDocument();
  });

  it('prompts for a story when none is selected', () => {
    renderPanel({ story: null });
    expect(screen.getByText('Select a story to see its references.')).toBeInTheDocument();
  });
});
