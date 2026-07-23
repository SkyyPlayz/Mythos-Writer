// Beta 3 / M17 — CanvasBoard rendering + interaction tests
// (vitest + @testing-library/react).

import { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CanvasBoard from './CanvasBoard';
import type { CanvasBoardData } from './canvasTypes';

function makeBoard(): CanvasBoardData {
  return {
    id: 'b1',
    name: 'Test board',
    cards: [
      { id: 'a', t: 'Mira Veynn', d: 'POV. Dread first, wonder second.', av: 'MV', c: 0, x: 100, y: 80, w: 200, h: 86, nid: 'mira' },
      { id: 'b', t: 'The Broker', d: 'His price: a memory, not coin.', av: 'B', c: 2, x: 450, y: 280, w: 200, h: 86, nid: null },
    ],
    links: [['a', 'b']],
  };
}

interface HarnessProps {
  initial: CanvasBoardData;
  onChange?: (board: CanvasBoardData) => void;
  onOpenNote?: (nid: string) => void;
  readOnly?: boolean;
}

/** Controlled wrapper standing in for the persisting caller (M18/M19). */
function Harness({ initial, onChange, onOpenNote, readOnly }: HarnessProps) {
  const [board, setBoard] = useState(initial);
  return (
    <CanvasBoard
      board={board}
      onChange={(next) => {
        setBoard(next);
        onChange?.(next);
      }}
      onOpenNote={onOpenNote}
      readOnly={readOnly}
    />
  );
}

function lastBoard(onChange: ReturnType<typeof vi.fn>): CanvasBoardData {
  expect(onChange).toHaveBeenCalled();
  return onChange.mock.calls[onChange.mock.calls.length - 1][0] as CanvasBoardData;
}

describe('CanvasBoard rendering', () => {
  it('renders every card with title, body, and avatar', () => {
    render(<Harness initial={makeBoard()} />);
    expect(screen.getByText('Mira Veynn')).toBeInTheDocument();
    expect(screen.getByText('POV. Dread first, wonder second.')).toBeInTheDocument();
    expect(screen.getByText('MV')).toBeInTheDocument();
    expect(screen.getByText('The Broker')).toBeInTheDocument();
  });

  it('positions cards from their board coordinates and slot class', () => {
    render(<Harness initial={makeBoard()} />);
    const card = screen.getByTestId('canvas-card-a');
    expect(card.style.left).toBe('100px');
    expect(card.style.top).toBe('80px');
    expect(card.style.width).toBe('200px');
    expect(card.style.minHeight).toBe('86px');
    expect(card.className).toContain('cvb-card--s1');
    expect(screen.getByTestId('canvas-card-b').className).toContain('cvb-card--s3');
  });

  it('renders one bezier path per link, between card centers', () => {
    render(<Harness initial={makeBoard()} />);
    const paths = screen.getByTestId('canvas-links').querySelectorAll('path');
    expect(paths).toHaveLength(1);
    // Centers: a → (200, 123), b → (550, 323), midpoint x 375.
    expect(paths[0].getAttribute('d')).toBe('M200,123 C375,123 375,323 550,323');
  });
});

describe('add card', () => {
  it('appends a prototype-default card at viewport (240, 180) through onChange', () => {
    const onChange = vi.fn();
    render(<Harness initial={makeBoard()} onChange={onChange} />);
    fireEvent.click(screen.getByTitle('Add card'));
    const board = lastBoard(onChange);
    expect(board.cards).toHaveLength(3);
    const added = board.cards[2];
    expect(added).toMatchObject({ t: 'New card', av: '+', c: 4, x: 240, y: 180, w: 190, h: 80, nid: null });
    expect(screen.getByText('New card')).toBeInTheDocument();
  });

  it('gives each added card a unique id', () => {
    const onChange = vi.fn();
    render(<Harness initial={makeBoard()} onChange={onChange} />);
    fireEvent.click(screen.getByTitle('Add card'));
    fireEvent.click(screen.getByTitle('Add card'));
    const board = lastBoard(onChange);
    expect(new Set(board.cards.map((c) => c.id)).size).toBe(4);
  });
});

describe('card drag', () => {
  it('updates x/y through onChange while dragging the header', () => {
    const onChange = vi.fn();
    render(<Harness initial={makeBoard()} onChange={onChange} />);
    fireEvent.mouseDown(screen.getByTestId('canvas-card-head-a'), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(window, { clientX: 40, clientY: 30 });
    fireEvent.mouseUp(window);
    const card = lastBoard(onChange).cards[0];
    expect(card.x).toBe(130);
    expect(card.y).toBe(100);
    expect(screen.getByTestId('canvas-card-a').style.left).toBe('130px');
  });

  it('divides drag deltas by the zoom factor (prototype physics)', () => {
    const onChange = vi.fn();
    render(<Harness initial={makeBoard()} onChange={onChange} />);
    fireEvent.click(screen.getByTitle('Zoom in')); // ×1.15
    fireEvent.mouseDown(screen.getByTestId('canvas-card-head-a'), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: 46, clientY: 23 });
    fireEvent.mouseUp(window);
    const card = lastBoard(onChange).cards[0];
    expect(card.x).toBeCloseTo(140, 10); // 100 + 46 / 1.15
    expect(card.y).toBeCloseTo(100, 10); // 80 + 23 / 1.15
  });

  it('clamps drags to the positive quadrant', () => {
    const onChange = vi.fn();
    render(<Harness initial={makeBoard()} onChange={onChange} />);
    fireEvent.mouseDown(screen.getByTestId('canvas-card-head-a'), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: -500, clientY: -500 });
    fireEvent.mouseUp(window);
    const card = lastBoard(onChange).cards[0];
    expect(card.x).toBe(0);
    expect(card.y).toBe(0);
  });

  it('ignores right-button drags on the header (right-drag pans instead)', () => {
    const onChange = vi.fn();
    render(<Harness initial={makeBoard()} onChange={onChange} />);
    fireEvent.mouseDown(screen.getByTestId('canvas-card-head-a'), { button: 2, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: 50, clientY: 50 });
    fireEvent.mouseUp(window);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('stops moving after mouseup', () => {
    const onChange = vi.fn();
    render(<Harness initial={makeBoard()} onChange={onChange} />);
    fireEvent.mouseDown(screen.getByTestId('canvas-card-head-a'), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: 10, clientY: 0 });
    fireEvent.mouseUp(window);
    const calls = onChange.mock.calls.length;
    fireEvent.mouseMove(window, { clientX: 300, clientY: 300 });
    expect(onChange.mock.calls.length).toBe(calls);
  });
});

describe('corner resize', () => {
  it('grows the card with the pointer and clamps at 130×60', () => {
    const onChange = vi.fn();
    render(<Harness initial={makeBoard()} onChange={onChange} />);
    fireEvent.mouseDown(screen.getByTestId('canvas-card-resize-a'), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: 40, clientY: 20 });
    let card = lastBoard(onChange).cards[0];
    expect(card.w).toBe(240);
    expect(card.h).toBe(106);
    fireEvent.mouseMove(window, { clientX: -1000, clientY: -1000 });
    card = lastBoard(onChange).cards[0];
    expect(card.w).toBe(130);
    expect(card.h).toBe(60);
    fireEvent.mouseUp(window);
  });
});

describe('keyboard operability (SKY-7929, WCAG 2.1.1)', () => {
  it('moves the focused card header with arrow keys, and further with Shift', () => {
    const onChange = vi.fn();
    render(<Harness initial={makeBoard()} onChange={onChange} />);
    const head = screen.getByTestId('canvas-card-head-a');
    head.focus();
    fireEvent.keyDown(head, { key: 'ArrowRight' });
    let card = lastBoard(onChange).cards[0];
    expect(card.x).toBe(108); // 100 + 8
    expect(card.y).toBe(80);
    fireEvent.keyDown(head, { key: 'ArrowDown', shiftKey: true });
    card = lastBoard(onChange).cards[0];
    expect(card.y).toBe(120); // 80 + 40
  });

  it('clamps keyboard card moves to the positive quadrant', () => {
    const onChange = vi.fn();
    render(<Harness initial={makeBoard()} onChange={onChange} />);
    const head = screen.getByTestId('canvas-card-head-a');
    head.focus();
    fireEvent.keyDown(head, { key: 'ArrowLeft', shiftKey: true });
    fireEvent.keyDown(head, { key: 'ArrowLeft', shiftKey: true });
    fireEvent.keyDown(head, { key: 'ArrowLeft', shiftKey: true });
    const card = lastBoard(onChange).cards[0];
    expect(card.x).toBe(0); // 100 - 40*3 clamped
  });

  it('resizes the focused card with arrow keys on the resize handle, clamped at 130×60', () => {
    const onChange = vi.fn();
    render(<Harness initial={makeBoard()} onChange={onChange} />);
    const handle = screen.getByTestId('canvas-card-resize-a');
    handle.focus();
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    let card = lastBoard(onChange).cards[0];
    expect(card.w).toBe(208); // 200 + 8
    expect(card.h).toBe(94); // 86 + 8
    for (let i = 0; i < 20; i++) fireEvent.keyDown(handle, { key: 'ArrowUp', shiftKey: true });
    card = lastBoard(onChange).cards[0];
    expect(card.h).toBe(60);
  });

  it('pans the view with arrow keys when the pan layer has focus', () => {
    render(<Harness initial={makeBoard()} />);
    const panLayer = screen.getByTestId('canvas-pan-layer');
    panLayer.focus();
    fireEvent.keyDown(panLayer, { key: 'ArrowRight' });
    expect(screen.getByTestId('canvas-stage').style.transform).toContain('translate(8px,0px)');
  });

  it('does not move or resize cards from arrow keys in readOnly mode', () => {
    const onChange = vi.fn();
    render(<Harness initial={makeBoard()} onChange={onChange} readOnly />);
    const head = screen.getByTestId('canvas-card-head-a');
    expect(head).not.toHaveAttribute('tabIndex');
    fireEvent.keyDown(head, { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('every mutating control (add, connect, delete, zoom, fit, pan) is a real focusable button/element', () => {
    render(<Harness initial={makeBoard()} />);
    expect(screen.getByTitle('Add card').tagName).toBe('BUTTON');
    expect(screen.getAllByTitle('Connect to another card')[0].tagName).toBe('BUTTON');
    expect(screen.getAllByTitle('Delete card')[0].tagName).toBe('BUTTON');
    expect(screen.getByTitle('Zoom in').tagName).toBe('BUTTON');
    expect(screen.getByTitle('Zoom out').tagName).toBe('BUTTON');
    expect(screen.getByTitle('Fit board to content').tagName).toBe('BUTTON');
    expect(screen.getByTestId('canvas-card-resize-a').tagName).toBe('BUTTON');
    expect(screen.getByTestId('canvas-card-head-a')).toHaveAttribute('tabIndex', '0');
    expect(screen.getByTestId('canvas-pan-layer')).toHaveAttribute('tabIndex', '0');
  });

  it('gives every card a role=group with an aria-label combining title and body (SKY-7330)', () => {
    render(<Harness initial={makeBoard()} />);
    const cardA = screen.getByTestId('canvas-card-a');
    const cardB = screen.getByTestId('canvas-card-b');
    expect(cardA).toHaveAttribute('role', 'group');
    expect(cardA).toHaveAttribute('aria-label', 'Mira Veynn — POV. Dread first, wonder second.');
    expect(cardB).toHaveAttribute('aria-label', 'The Broker — His price: a memory, not coin.');
  });
});

describe('connect mode', () => {
  it('links two cards via their ⚯ buttons and shows the hint while connecting', () => {
    const onChange = vi.fn();
    render(<Harness initial={makeBoard()} onChange={onChange} />);
    const cardB = screen.getByTestId('canvas-card-b');
    const cardA = screen.getByTestId('canvas-card-a');
    fireEvent.click(within(cardB).getByTitle('Connect to another card'));
    expect(screen.getByTestId('canvas-linking-hint')).toHaveTextContent('Connecting — click a target card…');
    expect(cardB.className).toContain('cvb-card--linking');
    fireEvent.click(within(cardA).getByTitle('Connect to another card'));
    const board = lastBoard(onChange);
    expect(board.links).toEqual([
      ['a', 'b'],
      ['b', 'a'],
    ]);
    expect(screen.queryByTestId('canvas-linking-hint')).toBeNull();
    expect(screen.getByTestId('canvas-links').querySelectorAll('path')).toHaveLength(2);
  });

  it('clicking the source card again cancels connect mode without a link', () => {
    const onChange = vi.fn();
    render(<Harness initial={makeBoard()} onChange={onChange} />);
    const connect = within(screen.getByTestId('canvas-card-a')).getByTitle('Connect to another card');
    fireEvent.click(connect);
    fireEvent.click(connect);
    expect(screen.queryByTestId('canvas-linking-hint')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('keyboard connect (SKY-7330, WCAG 2.1.1)', () => {
  it('Enter on a focused card head starts linking mode; Space on another completes it', () => {
    const onChange = vi.fn();
    render(<Harness initial={makeBoard()} onChange={onChange} />);
    const headB = screen.getByTestId('canvas-card-head-b');
    const headA = screen.getByTestId('canvas-card-head-a');
    headB.focus();
    fireEvent.keyDown(headB, { key: 'Enter' });
    expect(screen.getByTestId('canvas-linking-hint')).toHaveTextContent('Connecting — click a target card…');
    expect(screen.getByTestId('canvas-card-b').className).toContain('cvb-card--linking');
    headA.focus();
    fireEvent.keyDown(headA, { key: ' ' });
    const board = lastBoard(onChange);
    expect(board.links).toEqual([
      ['a', 'b'],
      ['b', 'a'],
    ]);
    expect(screen.queryByTestId('canvas-linking-hint')).toBeNull();
  });

  it('Enter on the same focused card again cancels linking mode without a link', () => {
    const onChange = vi.fn();
    render(<Harness initial={makeBoard()} onChange={onChange} />);
    const headA = screen.getByTestId('canvas-card-head-a');
    headA.focus();
    fireEvent.keyDown(headA, { key: 'Enter' });
    fireEvent.keyDown(headA, { key: 'Enter' });
    expect(screen.queryByTestId('canvas-linking-hint')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Escape cancels linking mode from anywhere on the board (also fixes the missing mouse-path cancel)', () => {
    const onChange = vi.fn();
    render(<Harness initial={makeBoard()} onChange={onChange} />);
    const headA = screen.getByTestId('canvas-card-head-a');
    headA.focus();
    fireEvent.keyDown(headA, { key: 'Enter' });
    expect(screen.getByTestId('canvas-linking-hint')).toBeInTheDocument();
    fireEvent.keyDown(headA, { key: 'Escape' });
    expect(screen.queryByTestId('canvas-linking-hint')).toBeNull();
    expect(screen.getByTestId('canvas-card-a').className).not.toContain('cvb-card--linking');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not start linking mode from Enter/Space in readOnly mode', () => {
    render(<Harness initial={makeBoard()} readOnly />);
    const headA = screen.getByTestId('canvas-card-head-a');
    expect(headA).not.toHaveAttribute('tabIndex');
    fireEvent.keyDown(headA, { key: 'Enter' });
    expect(screen.queryByTestId('canvas-linking-hint')).toBeNull();
  });
});

describe('delete card', () => {
  it('removes the card and every link touching it', () => {
    const onChange = vi.fn();
    render(<Harness initial={makeBoard()} onChange={onChange} />);
    fireEvent.click(within(screen.getByTestId('canvas-card-a')).getByTitle('Delete card'));
    const board = lastBoard(onChange);
    expect(board.cards.map((c) => c.id)).toEqual(['b']);
    expect(board.links).toEqual([]);
    expect(screen.queryByTestId('canvas-card-a')).toBeNull();
  });

  it('shows a "Card deleted" toast with an Undo action (SKY-7330, §4.4)', () => {
    render(<Harness initial={makeBoard()} />);
    fireEvent.click(within(screen.getByTestId('canvas-card-b')).getByTitle('Delete card'));
    expect(screen.getByTestId('app-toast')).toHaveTextContent('“The Broker” deleted');
    expect(screen.getByText('Undo')).toBeInTheDocument();
  });

  it('Undo restores the deleted card and its links', () => {
    const onChange = vi.fn();
    render(<Harness initial={makeBoard()} onChange={onChange} />);
    fireEvent.click(within(screen.getByTestId('canvas-card-a')).getByTitle('Delete card'));
    expect(lastBoard(onChange).cards.map((c) => c.id)).toEqual(['b']);
    fireEvent.click(screen.getByText('Undo'));
    const board = lastBoard(onChange);
    expect(board.cards.map((c) => c.id)).toEqual(['a', 'b']);
    expect(board.links).toEqual([['a', 'b']]);
    expect(screen.queryByTestId('app-toast')).toBeNull();
  });
});

describe('keyboard delete (SKY-7330, WCAG 2.1.1)', () => {
  it('Delete on a focused card head removes it, with the same toast/undo affordance as the mouse path', () => {
    const onChange = vi.fn();
    render(<Harness initial={makeBoard()} onChange={onChange} />);
    const headA = screen.getByTestId('canvas-card-head-a');
    headA.focus();
    fireEvent.keyDown(headA, { key: 'Delete' });
    const board = lastBoard(onChange);
    expect(board.cards.map((c) => c.id)).toEqual(['b']);
    expect(board.links).toEqual([]);
    expect(screen.getByTestId('app-toast')).toHaveTextContent('“Mira Veynn” deleted');
    expect(screen.getByText('Undo')).toBeInTheDocument();
  });

  it('Backspace also removes the focused card', () => {
    const onChange = vi.fn();
    render(<Harness initial={makeBoard()} onChange={onChange} />);
    const headB = screen.getByTestId('canvas-card-head-b');
    headB.focus();
    fireEvent.keyDown(headB, { key: 'Backspace' });
    expect(lastBoard(onChange).cards.map((c) => c.id)).toEqual(['a']);
  });

  it('moves focus to the next remaining card after keyboard delete', () => {
    render(<Harness initial={makeBoard()} />);
    const headA = screen.getByTestId('canvas-card-head-a');
    headA.focus();
    fireEvent.keyDown(headA, { key: 'Delete' });
    expect(screen.getByTestId('canvas-card-head-b')).toHaveFocus();
  });

  it('moves focus to the pan layer when the last remaining card is deleted', () => {
    const solo: CanvasBoardData = { id: 'b1', name: 'Solo', cards: [makeBoard().cards[0]], links: [] };
    render(<Harness initial={solo} />);
    const headA = screen.getByTestId('canvas-card-head-a');
    headA.focus();
    fireEvent.keyDown(headA, { key: 'Delete' });
    expect(screen.getByTestId('canvas-pan-layer')).toHaveFocus();
  });

  it('does not delete cards from Delete/Backspace in readOnly mode', () => {
    const onChange = vi.fn();
    render(<Harness initial={makeBoard()} onChange={onChange} readOnly />);
    const headA = screen.getByTestId('canvas-card-head-a');
    fireEvent.keyDown(headA, { key: 'Delete' });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('zoom controls', () => {
  it('starts at 100% and steps ×1.15 / ×0.87 via the dock buttons', () => {
    render(<Harness initial={makeBoard()} />);
    const pct = screen.getByTestId('canvas-zoom-pct');
    expect(pct).toHaveTextContent('100%');
    fireEvent.click(screen.getByTitle('Zoom in'));
    expect(pct).toHaveTextContent('115%');
    fireEvent.click(screen.getByTitle('Zoom out'));
    expect(pct).toHaveTextContent('100%'); // 1.15 × 0.87 ≈ 1.0005
    fireEvent.click(screen.getByTitle('Zoom out'));
    expect(pct).toHaveTextContent('87%');
  });

  it('wheel-zooms ×1.1 in on scroll up and applies it to the stage transform', () => {
    render(<Harness initial={makeBoard()} />);
    fireEvent.wheel(screen.getByTestId('canvas-stage'), { deltaY: -1 });
    expect(screen.getByTestId('canvas-zoom-pct')).toHaveTextContent('110%');
    expect(screen.getByTestId('canvas-stage').style.transform).toBe('translate(0px,0px) scale(1.1)');
  });

  it('wheel-zoom clamps at the 240% ceiling', () => {
    render(<Harness initial={makeBoard()} />);
    const stage = screen.getByTestId('canvas-stage');
    for (let i = 0; i < 20; i++) fireEvent.wheel(stage, { deltaY: -1 });
    expect(screen.getByTestId('canvas-zoom-pct')).toHaveTextContent('240%');
  });

  it('Fit resets a degenerate (jsdom zero-size) viewport to 100% at origin', () => {
    render(<Harness initial={makeBoard()} />);
    fireEvent.click(screen.getByTitle('Zoom in'));
    fireEvent.click(screen.getByTitle('Fit board to content'));
    expect(screen.getByTestId('canvas-zoom-pct')).toHaveTextContent('100%');
    expect(screen.getByTestId('canvas-stage').style.transform).toBe('translate(0px,0px) scale(1)');
  });
});

describe('pan', () => {
  it('drags empty space to translate the stage', () => {
    render(<Harness initial={makeBoard()} />);
    fireEvent.mouseDown(screen.getByTestId('canvas-pan-layer'), { button: 0, clientX: 5, clientY: 5 });
    fireEvent.mouseMove(window, { clientX: 25, clientY: 15 });
    fireEvent.mouseUp(window);
    expect(screen.getByTestId('canvas-stage').style.transform).toBe('translate(20px,10px) scale(1)');
  });
});

describe('note avatar', () => {
  it('calls onOpenNote with the nid for note-attached cards', () => {
    const onOpenNote = vi.fn();
    render(<Harness initial={makeBoard()} onOpenNote={onOpenNote} />);
    fireEvent.click(within(screen.getByTestId('canvas-card-a')).getByTitle('Open the attached note'));
    expect(onOpenNote).toHaveBeenCalledTimes(1);
    expect(onOpenNote).toHaveBeenCalledWith('mira');
  });

  it('does nothing for cards without a note', () => {
    const onOpenNote = vi.fn();
    render(<Harness initial={makeBoard()} onOpenNote={onOpenNote} />);
    fireEvent.click(within(screen.getByTestId('canvas-card-b')).getByTitle('No note attached yet'));
    expect(onOpenNote).not.toHaveBeenCalled();
  });
});

describe('readOnly mode (Beta 4/M19, §7.1 — editor Scenes tab mini canvas)', () => {
  it('still pans and zooms', () => {
    render(<Harness initial={makeBoard()} readOnly />);
    fireEvent.mouseDown(screen.getByTestId('canvas-pan-layer'), { button: 0, clientX: 5, clientY: 5 });
    fireEvent.mouseMove(window, { clientX: 25, clientY: 15 });
    fireEvent.mouseUp(window);
    expect(screen.getByTestId('canvas-stage').style.transform).toBe('translate(20px,10px) scale(1)');

    fireEvent.click(screen.getByTitle('Zoom in'));
    expect(screen.getByTestId('canvas-zoom-pct')).toHaveTextContent('115%');
  });

  it('still opens the attached note on avatar click', () => {
    const onOpenNote = vi.fn();
    render(<Harness initial={makeBoard()} onOpenNote={onOpenNote} readOnly />);
    fireEvent.click(within(screen.getByTestId('canvas-card-a')).getByTitle('Open the attached note'));
    expect(onOpenNote).toHaveBeenCalledWith('mira');
  });

  it('hides connect, delete, resize, and add-card controls', () => {
    render(<Harness initial={makeBoard()} readOnly />);
    expect(screen.queryByTitle('Connect to another card')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Delete card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('canvas-card-resize-a')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Add card')).not.toBeInTheDocument();
  });

  it('does not call onChange when a card head is dragged', () => {
    const onChange = vi.fn();
    render(<Harness initial={makeBoard()} onChange={onChange} readOnly />);
    fireEvent.mouseDown(screen.getByTestId('canvas-card-head-a'), { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(window, { clientX: 60, clientY: 60 });
    fireEvent.mouseUp(window);
    expect(onChange).not.toHaveBeenCalled();
  });
});
