/**
 * BoardCard — double-click / Enter opens note cards (owner punch).
 * Folders still enter the board; notes call onOpenNote with the item path.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import BoardCard from './BoardCard';
import type { BoardItem } from './BoardCard';

const note: BoardItem = { path: 'Mira.md', kind: 'note', name: 'Mira' };
const folder: BoardItem = { path: 'Locations', kind: 'folder', name: 'Locations' };

const noopMouse = vi.fn();
const base = {
  x: 0,
  y: 0,
  w: 200,
  h: 160,
  tier: 1 as const,
  selected: false,
  dragging: false,
  onItemMouseDown: noopMouse,
  onResizeMouseDown: noopMouse,
  onFocusItem: vi.fn(),
};

describe('BoardCard open gestures (owner punch)', () => {
  it('double-click on a note card calls onOpenNote with the item path', () => {
    const onOpenNote = vi.fn();
    render(<BoardCard {...base} item={note} onOpenNote={onOpenNote} />);
    fireEvent.doubleClick(screen.getByRole('article', { name: /Note card: Mira/ }));
    expect(onOpenNote).toHaveBeenCalledWith('Mira.md');
  });

  it('Enter on a focused note card calls onOpenNote', () => {
    const onOpenNote = vi.fn();
    render(<BoardCard {...base} item={note} onOpenNote={onOpenNote} />);
    const card = screen.getByRole('article', { name: /Note card: Mira/ });
    card.focus();
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onOpenNote).toHaveBeenCalledWith('Mira.md');
  });

  it('double-click on a board tile still enters the board, not onOpenNote', () => {
    const onEnterBoard = vi.fn();
    const onOpenNote = vi.fn();
    render(
      <BoardCard {...base} item={folder} onEnterBoard={onEnterBoard} onOpenNote={onOpenNote} />,
    );
    fireEvent.doubleClick(screen.getByRole('button', { name: /Board: Locations/ }));
    expect(onEnterBoard).toHaveBeenCalledWith('Locations');
    expect(onOpenNote).not.toHaveBeenCalled();
  });

  it('folder tiles use the Liquid Neon folder glyph fallback (not unicode ▤)', () => {
    const { container } = render(<BoardCard {...base} item={folder} />);
    const icon = container.querySelector('.board-canvas__item-icon svg');
    expect(icon).not.toBeNull();
    expect(container.querySelector('.board-canvas__item-icon')?.textContent).not.toContain('▤');
  });

  it('empty folder tiles say Empty board instead of 0 boards, 0 cards', () => {
    render(<BoardCard {...base} item={{ ...folder, childBoards: 0, childCards: 0 }} />);
    expect(screen.getByText(/Empty board/)).toBeInTheDocument();
  });

  it('notes without a thumbnail still paint empty-thumb chrome', () => {
    const { container } = render(<BoardCard {...base} item={note} />);
    expect(container.querySelector('.board-canvas__thumb--empty')).not.toBeNull();
    expect(container.querySelector('[data-thumb-state="empty"]')).not.toBeNull();
    expect(screen.getByText(/Empty note/)).toBeInTheDocument();
  });
});
