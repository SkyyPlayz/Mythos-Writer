// M16: Backlinks panel — notes-vault backlinks via IPC + client-side story
// backlinks with the gold STORY chip.
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Backlinks, { findStoryBacklinks } from './Backlinks';
import type { Story } from './types';

const now = '2026-07-01T00:00:00.000Z';

function makeStory(sceneContent: string): Story {
  return {
    id: 'story-1',
    title: 'Test Story',
    path: 'Test Story',
    createdAt: now,
    updatedAt: now,
    chapters: [
      {
        id: 'chapter-1',
        title: 'Chapter One',
        path: 'Test Story/Manuscript/Chapter One',
        order: 1,
        createdAt: now,
        updatedAt: now,
        scenes: [
          {
            id: 'scene-1',
            title: 'Opening Scene',
            path: 'Test Story/Manuscript/Chapter One/Opening Scene.md',
            order: 1,
            blocks: [
              { id: 'b1', type: 'prose' as never, content: sceneContent, order: 1, updatedAt: now },
            ],
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    ],
  };
}

const noteBacklinks = vi.fn(async () => ({
  notePath: 'Locations/The Sunken Gate.md',
  backlinks: [{ path: 'Characters/Mira.md', name: 'Mira', snippet: 'found a map near the [[The Sunken Gate]]' }],
}));
const onVaultFileChanged = vi.fn(() => () => {});

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { api: unknown }).api = { noteBacklinks, onVaultFileChanged };
});

describe('findStoryBacklinks (M16)', () => {
  it('finds scenes whose blocks link to the note stem', () => {
    const stories = [makeStory('She reached [[The Sunken Gate]] at dawn.')];
    const result = findStoryBacklinks(stories, 'Locations/The Sunken Gate.md');
    expect(result).toHaveLength(1);
    expect(result[0].scene.title).toBe('Opening Scene');
    expect(result[0].snippet).toContain('[[The Sunken Gate]]');
  });

  it('matches aliased and anchored links, case-insensitively', () => {
    const stories = [makeStory('See [[the sunken gate|the gate]] and [[The Sunken Gate#Architecture]].')];
    expect(findStoryBacklinks(stories, 'The Sunken Gate.md')).toHaveLength(1);
  });

  it('returns nothing when no scene links to the note', () => {
    const stories = [makeStory('No links here at all.')];
    expect(findStoryBacklinks(stories, 'The Sunken Gate.md')).toHaveLength(0);
  });
});

describe('Backlinks panel (M16)', () => {
  it('lists note backlinks and story backlinks with a STORY chip and live count', async () => {
    const stories = [makeStory('She reached [[The Sunken Gate]] at dawn.')];
    render(
      <Backlinks
        notePath="Locations/The Sunken Gate.md"
        stories={stories}
        onOpenNote={vi.fn()}
        onOpenScene={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('note-backlink-Characters/Mira.md')).toBeInTheDocument());
    expect(screen.getByTestId('story-backlink-scene-1')).toBeInTheDocument();
    expect(screen.getByText('STORY')).toBeInTheDocument();
    expect(screen.getByTestId('note-backlinks-count')).toHaveTextContent('2');
  });

  it('opens a note backlink via onOpenNote and a story backlink via onOpenScene', async () => {
    const onOpenNote = vi.fn();
    const onOpenScene = vi.fn();
    const stories = [makeStory('Back to [[The Sunken Gate]].')];
    render(
      <Backlinks
        notePath="Locations/The Sunken Gate.md"
        stories={stories}
        onOpenNote={onOpenNote}
        onOpenScene={onOpenScene}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('note-backlink-Characters/Mira.md')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('note-backlink-Characters/Mira.md'));
    expect(onOpenNote).toHaveBeenCalledWith('Characters/Mira.md');
    fireEvent.click(screen.getByTestId('story-backlink-scene-1'));
    expect(onOpenScene).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'scene-1' }),
      expect.objectContaining({ id: 'chapter-1' }),
      expect.objectContaining({ id: 'story-1' }),
    );
  });

  it('shows the empty state when nothing links here', async () => {
    noteBacklinks.mockResolvedValueOnce({ notePath: 'Lonely.md', backlinks: [] });
    render(
      <Backlinks notePath="Lonely.md" stories={[]} onOpenNote={vi.fn()} onOpenScene={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByTestId('note-backlinks-empty')).toBeInTheDocument());
    expect(screen.getByTestId('note-backlinks-count')).toHaveTextContent('0');
  });

  it('subscribes to vault file changes for live refresh', async () => {
    render(
      <Backlinks notePath="Lonely.md" stories={[]} onOpenNote={vi.fn()} onOpenScene={vi.fn()} />,
    );
    await waitFor(() => expect(onVaultFileChanged).toHaveBeenCalled());
  });
});
