/**
 * SKY-11188 (Notes Board 5/9): board-only furniture — column, check, table,
 * image, sketch, swatch. BOARDS-SPEC.md v2 §4/§6/§14. `line` has no box of
 * its own — see BoardFurnitureLines — so it isn't rendered here.
 *
 * A column item's `ref` is not a second link representation (§4): it is a
 * vault-relative note path kept live by the rename cascade (SKY-11188 /
 * SKY-10712) and the Links tab (SKY-203/SKY-11188), so clicking it can
 * navigate straight to that path — no bespoke resolution needed here, only
 * at click time elsewhere in the app would a raw `[[wikilink]]` need it.
 *
 * `image`/`sketch` render a drop placeholder / canned SVG — the real
 * attachment and drawing pipelines are out of scope per spec §14, and are
 * labelled as such so review doesn't mistake them for the real thing.
 */
import { memo } from 'react';
import type { MouseEvent, KeyboardEvent } from 'react';
import type { FurnitureKind } from './boardLod';

/** Loose shape mirroring electron-main's BoardFurnitureItem — kind-specific fields are all optional. */
export interface BoardFurnitureItemData {
  id: string;
  k: FurnitureKind;
  x: number;
  y: number;
  title?: string;
  color?: string;
  items?: Array<{ t: string; ref?: string; done?: boolean }>;
  rows?: string[][];
  w?: number;
  h?: number;
  colors?: string[];
  /** `line` only — endpoints are item keys (v:/n:/x:), §4. */
  from?: string;
  to?: string;
  label?: string;
}

export interface BoardFurnitureProps {
  item: BoardFurnitureItemData;
  x: number;
  y: number;
  w: number;
  h: number;
  resizable: boolean;
  selected: boolean;
  dragging: boolean;
  onItemMouseDown: (e: MouseEvent<HTMLDivElement>, id: string, rect: { x: number; y: number; w: number; h: number }) => void;
  onResizeMouseDown: (e: MouseEvent<HTMLDivElement>, id: string, rect: { x: number; y: number; w: number; h: number }) => void;
  onFocusItem: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenRef?: (ref: string) => void;
  onCheckToggle?: (id: string, index: number) => void;
  onSwatchPick?: (hex: string) => void;
}

/** Prototype's default 4-colour palette when a swatch has no `colors` of its own (mockup `bdPal`). */
export const SWATCH_DEFAULT_COLORS = ['#00f0ff', '#9b5fff', '#ff4dff', '#2fe6c8'];

const KIND_LABEL: Record<FurnitureKind, string> = {
  column: 'Column',
  check: 'To-do list',
  table: 'Table',
  image: 'Image',
  sketch: 'Sketch',
  swatch: 'Colour swatch',
  line: 'Connector',
};

function BoardFurnitureImpl({
  item,
  x,
  y,
  w,
  h,
  resizable,
  selected,
  dragging,
  onItemMouseDown,
  onResizeMouseDown,
  onFocusItem,
  onDelete,
  onOpenRef,
  onCheckToggle,
  onSwatchPick,
}: BoardFurnitureProps) {
  const label = item.title || KIND_LABEL[item.k];

  const className =
    `board-canvas__furniture board-canvas__furniture--${item.k}` +
    (selected ? ' board-canvas__furniture--selected' : '') +
    (dragging ? ' board-canvas__furniture--dragging' : '');

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      e.preventDefault();
      onDelete(item.id);
    }
  };

  return (
    <div
      className={className}
      style={{ left: x, top: y, width: w, height: h, borderColor: item.color }}
      onMouseDown={(e) => onItemMouseDown(e, item.id, { x, y, w, h })}
      role="group"
      aria-label={`${label}. ${KIND_LABEL[item.k]}.`}
      data-testid={`board-furniture-${item.id}`}
      data-kind={item.k}
      data-selected={selected ? 'true' : undefined}
      tabIndex={0}
      onFocus={() => onFocusItem(item.id)}
      onKeyDown={handleKeyDown}
    >
      <div className="board-canvas__furniture-header">
        <span className="board-canvas__furniture-title">{label}</span>
        <button
          type="button"
          className="board-canvas__furniture-delete"
          aria-label={`Delete ${label}`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
        >
          ×
        </button>
      </div>

      {item.k === 'column' && (
        <ul className="board-canvas__furniture-list" role="list">
          {(item.items ?? []).map((it, i) => (
            <li key={i}>
              {it.ref ? (
                <button
                  type="button"
                  className="board-canvas__furniture-ref"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onOpenRef?.(it.ref!); }}
                  title={it.ref}
                >
                  {it.t}
                </button>
              ) : (
                <span className="board-canvas__furniture-card">{it.t}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {item.k === 'check' && (
        <ul className="board-canvas__furniture-list" role="list">
          {(item.items ?? []).map((it, i) => (
            <li key={i}>
              <button
                type="button"
                className={`board-canvas__furniture-check${it.done ? ' board-canvas__furniture-check--done' : ''}`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onCheckToggle?.(item.id, i); }}
                aria-pressed={!!it.done}
              >
                <span className="board-canvas__furniture-checkbox" aria-hidden="true">{it.done ? '✓' : ''}</span>
                {it.t}
              </button>
            </li>
          ))}
        </ul>
      )}

      {item.k === 'table' && (
        <div className="board-canvas__furniture-table" role="table">
          {(item.rows ?? []).map((row, ri) => (
            <div className="board-canvas__furniture-table-row" role="row" key={ri} data-header={ri === 0 ? 'true' : undefined}>
              {row.map((cell, ci) => (
                <div className="board-canvas__furniture-table-cell" role="cell" key={ci}>{cell || '—'}</div>
              ))}
            </div>
          ))}
        </div>
      )}

      {item.k === 'image' && (
        <div className="board-canvas__furniture-media board-canvas__furniture-media--placeholder">
          Image placeholder — no attachment yet
        </div>
      )}

      {item.k === 'sketch' && (
        <div className="board-canvas__furniture-media board-canvas__furniture-media--sketch">
          <svg width="100%" height="100%" viewBox="0 0 240 150" preserveAspectRatio="none" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" opacity={0.75}>
            <path d="M18 112c22-72 44 24 62-20s26 42 44 8 32 20 48-32" />
            <circle cx="120" cy="62" r="26" strokeDasharray="5 8" />
          </svg>
          <span className="board-canvas__furniture-media-label">Sketch placeholder — drawing not saved</span>
        </div>
      )}

      {item.k === 'swatch' && (
        <div className="board-canvas__furniture-swatches">
          {(item.colors ?? SWATCH_DEFAULT_COLORS).map((hex) => (
            <button
              key={hex}
              type="button"
              className="board-canvas__furniture-swatch-color"
              style={{ background: hex }}
              aria-label={`Apply colour ${hex}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onSwatchPick?.(hex); }}
            />
          ))}
        </div>
      )}

      {resizable && (
        <div
          className="board-canvas__resize-handle"
          onMouseDown={(e) => onResizeMouseDown(e, item.id, { x, y, w, h })}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

const BoardFurniture = memo(BoardFurnitureImpl);
export default BoardFurniture;
