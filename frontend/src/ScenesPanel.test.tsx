// Beta 4/M19 (§7.1) + M9c — editor right-panel Scenes tab: canvas-board list,
// mini canvas preview, "Open full", and the prototype empty state.

import { render, screen, fireEvent, within } from '@testing-library/react';
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

  it('shows the prototype empty state with a Scene Crafter action when there are no boards', async () => {
    const onOpenFull = vi.fn();
    render(<ScenesPanel story={STORY} onOpenFull={onOpenFull} />);
    const empty = await screen.findByTestId('scenes-panel-empty-boards');
    expect(within(empty).getByText(/no canvas boards yet/i)).toBeInTheDocument();
    expect(within(empty).getByText(/and it appears here/i)).toBeInTheDocument();
    fireEvent.click(within(empty).getByRole('button', { name: 'Scene Crafter' }));
    expect(onOpenFull).toHaveBeenCalledTimes(1);
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

  it('lists every drafted board with its card count and previews the picked board', async () => {
    const gate = {
      content: JSON.stringify({
        nodes: [
          { id: 'gate-1', type: 'text', x: 0, y: 0, width: 200, height: 80, text: 'Gate beat' },
        ],
        edges: [],
      }),
      path: 'Boards/Skyfall Chronicles/Gate.canvas.json',
    };
    const storm = {
      content: JSON.stringify({
        nodes: [
          { id: 'storm-1', type: 'text', x: 0, y: 0, width: 200, height: 80, text: 'Storm beat' },
          { id: 'storm-2', type: 'text', x: 0, y: 120, width: 200, height: 80, text: 'Storm aftermath' },
        ],
        edges: [],
      }),
      path: 'Boards/Skyfall Chronicles/Storm.canvas.json',
    };
    installApi({
      listNotesVault: vi.fn().mockResolvedValue({
        items: [
          { path: gate.path, name: 'Gate.canvas.json', isDirectory: false, modifiedAt: '2026-01-01T00:00:00.000Z' },
          { path: storm.path, name: 'Storm.canvas.json', isDirectory: false, modifiedAt: '2026-01-02T00:00:00.000Z' },
        ],
      }),
      readNotesVault: vi.fn().mockImplementation((path: string) =>
        Promise.resolve(path === gate.path ? gate : storm),
      ),
    });
    render(<ScenesPanel story={STORY} onOpenFull={vi.fn()} />);

    const list = await screen.findByTestId('scenes-panel-boards');
    const gateRow = within(list).getByRole('button', { name: /Gate 1 cards/ });
    expect(within(list).getByRole('button', { name: /Storm 2 cards/ })).toBeInTheDocument();

    // No board picked → the latest board (last in path order) is previewed.
    const mini = screen.getByTestId('scenes-panel-mini');
    expect(within(mini).getByTestId('canvas-card-storm-1')).toBeInTheDocument();

    // Picking a row previews that board and marks the row pressed.
    fireEvent.click(gateRow);
    expect(gateRow).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByTestId('scenes-panel-mini')).getByTestId('canvas-card-gate-1')).toBeInTheDocument();

    // Picking it again unpicks and falls back to the latest board.
    fireEvent.click(gateRow);
    expect(gateRow).toHaveAttribute('aria-pressed', 'false');
    expect(within(screen.getByTestId('scenes-panel-mini')).getByTestId('canvas-card-storm-1')).toBeInTheDocument();
  });
});
