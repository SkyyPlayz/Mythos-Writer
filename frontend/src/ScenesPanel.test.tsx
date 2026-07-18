// Beta 4/M19 (§7.1) — editor right-panel Scenes tab: mini canvas + "Open full".

import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ScenesPanel from './ScenesPanel';
import type { Story } from './types';

const STORY: Story = {
  id: 'story-1',
  title: 'Skyfall Chronicles',
  path: 'Stories/Skyfall Chronicles',
  chapters: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function installApi(overrides: Record<string, unknown> = {}) {
  const api = {
    listNotesVault: vi.fn().mockResolvedValue({ items: [] }),
    readNotesVault: vi.fn().mockResolvedValue({ error: 'not found' }),
    ...overrides,
  };
  (window as unknown as { api: unknown }).api = api;
  return api;
}

function boardListing() {
  return {
    items: [
      { path: 'Boards/Skyfall Chronicles/Gate.canvas.json', name: 'Gate.canvas.json', isDirectory: false, modifiedAt: '2026-01-01T00:00:00.000Z' },
    ],
  };
}

function boardContent() {
  return {
    content: JSON.stringify({
      nodes: [
        { id: 'a', type: 'file', x: 100, y: 80, width: 200, height: 86, file: 'Characters/Mira' },
      ],
      edges: [],
    }),
    path: 'Boards/Skyfall Chronicles/Gate.canvas.json',
  };
}

beforeEach(() => {
  installApi();
});

describe('ScenesPanel', () => {
  it('shows a placeholder when no story is selected', () => {
    render(<ScenesPanel story={null} onOpenFull={vi.fn()} />);
    expect(screen.getByText(/select a story/i)).toBeInTheDocument();
  });

  it('shows an empty state when the story has no scene boards yet', async () => {
    render(<ScenesPanel story={STORY} onOpenFull={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/no scene boards yet/i)).toBeInTheDocument());
  });

  it('renders the latest board read-only and wires "Open full" + note clicks through', async () => {
    installApi({
      listNotesVault: vi.fn().mockResolvedValue(boardListing()),
      readNotesVault: vi.fn().mockResolvedValue(boardContent()),
    });
    const onOpenFull = vi.fn();
    const onOpenNote = vi.fn();
    render(<ScenesPanel story={STORY} onOpenFull={onOpenFull} onOpenNote={onOpenNote} />);

    const mini = await screen.findByTestId('scenes-panel-mini');
    expect(within(mini).getByTestId('canvas-board')).toBeInTheDocument();
    // Read-only: no add-card control in the mini preview.
    expect(within(mini).queryByTitle('Add card')).not.toBeInTheDocument();

    fireEvent.click(within(mini).getByTitle('Open the attached note'));
    expect(onOpenNote).toHaveBeenCalledWith('Characters/Mira');

    fireEvent.click(screen.getByRole('button', { name: /open full/i }));
    expect(onOpenFull).toHaveBeenCalledTimes(1);
  });
});
