// Beta 3 / M17 — Canvas board engine (shared by Scene Crafter M18 and
// Brainstorm M19). Interactive Obsidian-style board ported 1:1 from the
// Liquid Neon prototype (design-handoff/prototype):
//   template (grid, links, cards, zoom dock) . . lines 1003–1048
//   card drag / resize / pan / connect . . . . . lines 3425–3466
//   zoom, add card, style strings  . . . . . . . lines 4770–4799
//
// Fully controlled: the caller owns the board and persistence. Every mutation
// (drag, resize, connect, add, delete) calls `onChange` with the next board —
// no IPC in here. Pan/zoom are view-only state and stay internal.

import { useEffect, useRef, useState } from 'react';
import type { CanvasBoardData, CanvasCard } from './canvasTypes';
import { CANVAS_COLOR_SLOTS } from './canvasTypes';
import {
  NEW_CARD_H,
  NEW_CARD_W,
  clampCardSize,
  dragCardPosition,
  fitToContent,
  linkPath,
  newCardPosition,
  resizeCardSize,
  wheelZoom,
  zoomIn,
  zoomOut,
  type ViewTransform,
} from './canvasMath';
import { Toast } from '../components/Toast/Toast';
import { useToast } from '../hooks/useToast';
import './CanvasBoard.css';

// Keyboard move/resize/pan step (board px, unaffected by zoom — arrow keys
// don't have a pointer to scale a screen delta by). Shift multiplies the step
// so keyboard users can cross the board without hundreds of key presses.
// 8/40 (SKY-7330) mirrors the mouse-drag granularity per the canvas spec §4.5.
const KB_STEP = 8;
const KB_STEP_FAST = 40;

function arrowDelta(e: React.KeyboardEvent): { dx: number; dy: number } | null {
  const step = e.shiftKey ? KB_STEP_FAST : KB_STEP;
  switch (e.key) {
    case 'ArrowLeft':
      return { dx: -step, dy: 0 };
    case 'ArrowRight':
      return { dx: step, dy: 0 };
    case 'ArrowUp':
      return { dx: 0, dy: -step };
    case 'ArrowDown':
      return { dx: 0, dy: step };
    default:
      return null;
  }
}

export interface CanvasBoardProps {
  board: CanvasBoardData;
  /** Called with the updated board after any mutation. Persistence is the caller's job. */
  onChange: (board: CanvasBoardData) => void;
  /** Called when a card's note avatar is clicked and the card has an attached note. */
  onOpenNote?: (nid: string) => void;
  /**
   * Preview mode (Beta 4/M19, §7.1 — editor Scenes tab mini canvas): pan and
   * zoom stay live, but card drag/resize/connect/delete/add are disabled so
   * `onChange` is never called. `onOpenNote` still fires — reading a note
   * isn't a board mutation.
   */
  readOnly?: boolean;
}

let cardSeq = 0;

function slotClass(c: number): string {
  const slot = Number.isInteger(c) && c >= 0 && c < CANVAS_COLOR_SLOTS ? c : 0;
  return `cvb-card--s${slot + 1}`;
}

// Screen-reader equivalent of the visual avatar+title (SKY-7330): the card's
// body is the closest thing this shared engine has to a category/summary, so
// fold it in when present rather than leaving a sighted-only cue.
function cardAriaLabel(card: CanvasCard): string {
  return card.d ? `${card.t} — ${card.d}` : card.t;
}

export default function CanvasBoard({ board, onChange, onOpenNote, readOnly = false }: CanvasBoardProps) {
  const [view, setView] = useState<ViewTransform>({ zoom: 1, panX: 0, panY: 0 });
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panLayerRef = useRef<HTMLDivElement>(null);
  // Card-head DOM nodes, so keyboard delete can hand focus to a neighbor
  // instead of losing it to <body> when the focused card unmounts (SKY-7330).
  const cardHeadRefs = useRef(new Map<string, HTMLDivElement>());

  // Latest board for window-level drag listeners (the prop may lag mid-drag).
  const boardRef = useRef(board);
  boardRef.current = board;

  // Undo affordance for keyboard/mouse delete (SKY-7330, §4.4/§4.5) — a longer
  // window than the default toast so there's real time to react to "Undo".
  const { toast, showToast, clearToast } = useToast(5000);
  const lastDeleteRef = useRef<CanvasBoardData | null>(null);

  // Active drag teardown, so an unmount mid-drag never leaks window listeners.
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => {
    const cleanup = dragCleanup;
    return () => cleanup.current?.();
  }, []);

  const beginDrag = (onMove: (ev: MouseEvent) => void) => {
    dragCleanup.current?.();
    const up = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', up);
      dragCleanup.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', up);
    dragCleanup.current = up;
  };

  const patchCard = (cardId: string, patch: Partial<CanvasCard>) => {
    const b = boardRef.current;
    onChange({
      ...b,
      cards: b.cards.map((c) => (c.id === cardId ? { ...c, ...patch } : c)),
    });
  };

  // Delete + "Card deleted" toast/undo (SKY-7330, §4.4) — shared by the mouse
  // × button and the keyboard Delete/Backspace path so both get the same
  // forgiveness affordance. Moves focus to a neighboring card (or the pan
  // layer, if none remain) so a keyboard user never loses focus to <body>.
  const deleteCard = (cardId: string) => {
    const b = boardRef.current;
    const idx = b.cards.findIndex((c) => c.id === cardId);
    if (idx === -1) return;
    const card = b.cards[idx];
    const neighbor = b.cards[idx + 1] ?? b.cards[idx - 1] ?? null;
    lastDeleteRef.current = b;
    onChange({
      ...b,
      cards: b.cards.filter((c) => c.id !== cardId),
      links: b.links.filter((l) => l[0] !== cardId && l[1] !== cardId),
    });
    if (linkFrom === cardId) setLinkFrom(null);
    showToast(`“${card.t}” deleted`, 'info');
    (neighbor ? cardHeadRefs.current.get(neighbor.id) : panLayerRef.current)?.focus();
  };

  const undoDelete = () => {
    const prev = lastDeleteRef.current;
    if (!prev) return;
    onChange(prev);
    lastDeleteRef.current = null;
    clearToast();
  };

  // Card drag — prototype `cvCardDown` (lines 3425–3435): zoom-scaled deltas.
  const onCardHeadDown = (cardId: string) => (e: React.MouseEvent) => {
    if (readOnly || e.button === 2) return;
    e.stopPropagation();
    e.preventDefault();
    const card = boardRef.current.cards.find((c) => c.id === cardId);
    if (!card) return;
    const { zoom } = view;
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = card.x;
    const oy = card.y;
    beginDrag((ev) => {
      patchCard(cardId, dragCardPosition(ox, oy, ev.clientX - sx, ev.clientY - sy, zoom));
    });
  };

  // Keyboard equivalent of card drag/connect/delete (SKY-7929/SKY-7330, WCAG
  // 2.1.1): arrow keys nudge the focused card head by KB_STEP board px (Shift
  // for KB_STEP_FAST); Enter/Space start or complete a link from this card
  // (same as clicking its ⚯ button); Delete/Backspace removes it.
  const onCardHeadKeyDown = (cardId: string) => (e: React.KeyboardEvent) => {
    if (readOnly) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      startOrCompleteLink(cardId);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteCard(cardId);
      return;
    }
    const delta = arrowDelta(e);
    if (!delta) return;
    e.preventDefault();
    const card = boardRef.current.cards.find((c) => c.id === cardId);
    if (!card) return;
    patchCard(cardId, { x: Math.max(0, card.x + delta.dx), y: Math.max(0, card.y + delta.dy) });
  };

  // Corner resize — prototype `cvResizeDown` (lines 3436–3446): min 130×60.
  const onResizeDown = (cardId: string) => (e: React.MouseEvent) => {
    if (readOnly || e.button === 2) return;
    e.stopPropagation();
    e.preventDefault();
    const card = boardRef.current.cards.find((c) => c.id === cardId);
    if (!card) return;
    const { zoom } = view;
    const sx = e.clientX;
    const sy = e.clientY;
    const ow = card.w;
    const oh = card.h;
    beginDrag((ev) => {
      patchCard(cardId, resizeCardSize(ow, oh, ev.clientX - sx, ev.clientY - sy, zoom));
    });
  };

  // Keyboard equivalent of the corner resize (WCAG 2.1.1): arrow keys grow
  // (right/down) or shrink (left/up) the focused card, clamped to 130×60.
  const onResizeKeyDown = (cardId: string) => (e: React.KeyboardEvent) => {
    if (readOnly) return;
    const delta = arrowDelta(e);
    if (!delta) return;
    e.preventDefault();
    const card = boardRef.current.cards.find((c) => c.id === cardId);
    if (!card) return;
    patchCard(cardId, clampCardSize(card.w + delta.dx, card.h + delta.dy));
  };

  // Pan — prototype `cvPanDown` (lines 3447–3453). Left-drag on empty space
  // pans; card roots stop propagation for every button except right (line
  // 4774), so right-drag pans from anywhere.
  const onPanDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const px = view.panX;
    const py = view.panY;
    beginDrag((ev) => {
      setView((v) => ({ ...v, panX: px + (ev.clientX - sx), panY: py + (ev.clientY - sy) }));
    });
  };

  const onCardRootDown = (e: React.MouseEvent) => {
    if (e.button !== 2) e.stopPropagation();
  };

  // Keyboard equivalent of the mouse-drag pan (WCAG 2.1.1): arrow keys pan
  // the view by KB_STEP screen px when the pan layer has focus.
  const onPanKeyDown = (e: React.KeyboardEvent) => {
    const delta = arrowDelta(e);
    if (!delta) return;
    e.preventDefault();
    setView((v) => ({ ...v, panX: v.panX + delta.dx, panY: v.panY + delta.dy }));
  };

  // Wheel zoom — prototype `cvWheelH` (line 4775): ×1.1 / ×0.92, clamped .4–2.4.
  const onWheel = (e: React.WheelEvent) => {
    const { deltaY } = e;
    setView((v) => ({ ...v, zoom: wheelZoom(v.zoom, deltaY) }));
  };

  // Connect mode — prototype `cvLinkClick` (lines 3461–3466). Shared by the
  // mouse ⚯ button and Enter/Space on a focused card head (SKY-7330).
  const startOrCompleteLink = (cardId: string) => {
    if (!linkFrom) {
      setLinkFrom(cardId);
    } else if (linkFrom === cardId) {
      setLinkFrom(null);
    } else {
      const b = boardRef.current;
      onChange({ ...b, links: [...b.links, [linkFrom, cardId]] });
      setLinkFrom(null);
    }
  };

  const onConnectClick = (cardId: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    startOrCompleteLink(cardId);
  };

  const onDeleteClick = (cardId: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteCard(cardId);
  };

  // Escape cancels linking mode from anywhere on the board (SKY-7330, §4.3) —
  // previously the only way out was completing the link or reloading.
  const onRootKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && linkFrom !== null) {
      e.preventDefault();
      setLinkFrom(null);
    }
  };

  const onAvatarClick = (card: CanvasCard) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (card.nid && onOpenNote) onOpenNote(card.nid);
  };

  // Add card — prototype `cvAddCard` (line 4781): spawns at viewport (240, 180).
  const onAddCard = () => {
    const b = boardRef.current;
    const pos = newCardPosition(view);
    const card: CanvasCard = {
      id: `c${Date.now().toString(36)}-${cardSeq++}`,
      t: 'New card',
      d: '',
      av: '+',
      c: 4,
      x: pos.x,
      y: pos.y,
      w: NEW_CARD_W,
      h: NEW_CARD_H,
      nid: null,
    };
    onChange({ ...b, cards: [...b.cards, card] });
  };

  const onFit = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    setView(fitToContent(board.cards, rect?.width ?? 0, rect?.height ?? 0));
  };

  const cardById = new Map(board.cards.map((c) => [c.id, c]));
  const paths = board.links
    .map(([fromId, toId], i) => {
      const from = cardById.get(fromId);
      const to = cardById.get(toId);
      return from && to ? { key: `${fromId}→${toId}#${i}`, d: linkPath(from, to) } : null;
    })
    .filter((p): p is { key: string; d: string } => p !== null);

  return (
    <div
      ref={rootRef}
      className="cvb-root"
      data-testid="canvas-board"
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={onRootKeyDown}
    >
      <div
        ref={panLayerRef}
        className="cvb-pan-layer"
        data-testid="canvas-pan-layer"
        role="group"
        aria-label="Canvas view. Use arrow keys to pan."
        tabIndex={0}
        onMouseDown={onPanDown}
        onWheel={onWheel}
        onKeyDown={onPanKeyDown}
      />
      <div
        className="cvb-stage"
        data-testid="canvas-stage"
        style={{ transform: `translate(${view.panX}px,${view.panY}px) scale(${view.zoom})` }}
        onMouseDown={onPanDown}
        onWheel={onWheel}
      >
        <svg className="cvb-links" data-testid="canvas-links">
          {paths.map((p) => (
            <path key={p.key} className="cvb-link" d={p.d} />
          ))}
        </svg>
        {board.cards.map((card) => (
          <div
            key={card.id}
            className={`cvb-card ${slotClass(card.c)}${linkFrom === card.id ? ' cvb-card--linking' : ''}`}
            data-testid={`canvas-card-${card.id}`}
            style={{ left: card.x, top: card.y, width: card.w, minHeight: card.h }}
            role="group"
            aria-label={cardAriaLabel(card)}
            onMouseDown={onCardRootDown}
          >
            <div
              ref={(el) => {
                if (el) cardHeadRefs.current.set(card.id, el);
                else cardHeadRefs.current.delete(card.id);
              }}
              className="cvb-card-head"
              data-testid={`canvas-card-head-${card.id}`}
              role={readOnly ? undefined : 'button'}
              tabIndex={readOnly ? undefined : 0}
              aria-label={
                readOnly ? undefined : `Move card: ${card.t}. Arrow keys move, Enter or Space to connect, Delete to remove.`
              }
              onMouseDown={onCardHeadDown(card.id)}
              onKeyDown={onCardHeadKeyDown(card.id)}
            >
              <button
                type="button"
                className="cvb-card-av"
                title={card.nid ? 'Open the attached note' : 'No note attached yet'}
                onClick={onAvatarClick(card)}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {card.av}
              </button>
              <span className="cvb-card-title">{card.t}</span>
              {!readOnly && (
                <button
                  type="button"
                  className="cvb-card-connect"
                  title="Connect to another card"
                  onClick={onConnectClick(card.id)}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <path d="M9.5 14.5l5-5" />
                    <path d="M11 7l1.5-1.5a3.5 3.5 0 0 1 5 5L16 12M8 12l-1.5 1.5a3.5 3.5 0 0 0 5 5L13 17" />
                  </svg>
                </button>
              )}
              {!readOnly && (
                <button
                  type="button"
                  className="cvb-card-del"
                  title="Delete card"
                  onClick={onDeleteClick(card.id)}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 12 12"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  >
                    <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
                  </svg>
                </button>
              )}
            </div>
            <div className="cvb-card-body">{card.d}</div>
            {!readOnly && (
              <button
                type="button"
                className="cvb-card-resize"
                title="Resize"
                aria-label={`Resize card: ${card.t}. Use arrow keys to resize.`}
                data-testid={`canvas-card-resize-${card.id}`}
                onMouseDown={onResizeDown(card.id)}
                onKeyDown={onResizeKeyDown(card.id)}
              />
            )}
          </div>
        ))}
      </div>
      {linkFrom !== null && (
        <div className="cvb-linking-hint" data-testid="canvas-linking-hint">
          Connecting — click a target card…
        </div>
      )}
      <div className="cvb-dock" data-testid="canvas-dock">
        {!readOnly && (
          <>
            <button type="button" className="cvb-dock-add" title="Add card" onClick={onAddCard}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="4" y="5" width="16" height="14" rx="2.5" />
                <path d="M12 9v6M9 12h6" />
              </svg>
            </button>
            <div className="cvb-dock-divider" />
          </>
        )}
        <button
          type="button"
          className="cvb-dock-zoom"
          title="Zoom out"
          onClick={() => setView((v) => ({ ...v, zoom: zoomOut(v.zoom) }))}
        >
          −
        </button>
        <span className="cvb-dock-pct" data-testid="canvas-zoom-pct">
          {Math.round(view.zoom * 100)}%
        </span>
        <button
          type="button"
          className="cvb-dock-zoom"
          title="Zoom in"
          onClick={() => setView((v) => ({ ...v, zoom: zoomIn(v.zoom) }))}
        >
          +
        </button>
        <button type="button" className="cvb-dock-fit" title="Fit board to content" onClick={onFit}>
          Fit
        </button>
      </div>
      <Toast
        message={toast?.message ?? null}
        level={toast?.level}
        action={toast ? { label: 'Undo', onClick: undoDelete } : undefined}
      />
    </div>
  );
}
