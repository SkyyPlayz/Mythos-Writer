/**
 * SKY-11186 (Notes Board 3/9): one board item — a note card or a board tile —
 * rendered at a given level of detail.
 *
 * Memoised on purpose. The canvas re-renders on every drag frame and every
 * scroll bucket; with 2,000+ children (spec §6 removes the item cap) the
 * mounted set is bounded by culling, but each survivor must still skip its
 * own render unless one of ITS numbers changed. Every prop here is either a
 * primitive, a stable callback, or the item object the panel built once.
 *
 * LOD tiers (BOARDS-SPEC v2 §6, owner ruling 5d "the image should outlive
 * the text"):
 *   1  preview + image   — title, thumbnail, text preview, tile counts
 *   2  image + title     — title and thumbnail only; the preview is dropped
 *   3  coloured block    — a flat accent rect: no thumbnail, no text
 *
 * The block tier is a deliberate map-like view of the board, not a degraded
 * state: at that size the text would not be legible anyway, and a field of
 * accent blocks reads as the board's shape.
 */
import { memo, useEffect, useRef, useState } from 'react';
import type { MouseEvent, KeyboardEvent } from 'react';
import { NoteThumbnail } from '../../components/NoteThumbnail';
import type { NoteThumbInfo } from '../../lib/noteThumbnails';
import { thumbBlockHeight, type LodTier } from './boardLod';

export interface BoardItem {
  /** Path relative to the CURRENT board's folder (vault-relative when at Home). */
  path: string;
  kind: 'folder' | 'note';
  name: string;
  /** count of direct children (boards/cards) — for board tile subtitle */
  childBoards?: number;
  childCards?: number;
  /** preview text excerpt (first ~140 chars of note content) */
  excerpt?: string;
  /** SKY-11186: resolved thumbnail (spec §9); absent/none/off → text-only card. */
  thumb?: NoteThumbInfo;
}

export interface ItemRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A card shows its image block when the note resolves to a thumbnail — even a missing one (icon fallback, owner ruling 5f). */
export function itemHasThumb(item: Pick<BoardItem, 'kind' | 'thumb'>): boolean {
  return item.kind === 'note' && (item.thumb?.mode === 'explicit' || item.thumb?.mode === 'auto');
}

/**
 * SKY-11187 §5: the inline rename field on a card.
 *
 * Own component so its draft text is local — a keystroke here re-renders one
 * input, not the canvas and not the other mounted cards. Enter and blur
 * commit; Escape reverts. Commit is idempotent (a `done` ref), because Enter
 * takes focus off the field and would otherwise fire blur's commit too.
 *
 * Escape on a just-created card leaves the file on disk under its placeholder
 * name rather than deleting it — a real vault delete is ticket 6's
 * deferred-delete model (§6), and this ticket must not grow an ad-hoc one.
 */
function RenameField({
  initialName,
  kind,
  onCommit,
  onCancel,
}: {
  initialName: string;
  kind: 'folder' | 'note';
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const commit = () => {
    if (done.current) return;
    done.current = true;
    onCommit(value);
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };

  return (
    <input
      ref={inputRef}
      className="board-canvas__item-rename"
      value={value}
      aria-label={kind === 'folder' ? 'Board name' : 'Note name'}
      onChange={(e) => setValue(e.target.value)}
      // The card's own mousedown starts a drag and its keydown opens the
      // board on Enter/Space — neither belongs to a text field.
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      }}
    />
  );
}

export interface BoardCardProps {
  item: BoardItem;
  x: number;
  y: number;
  w: number;
  h: number;
  tier: LodTier;
  selected: boolean;
  dragging: boolean;
  /** SKY-11187 §5: this card is in inline rename — its name is an editable field. */
  renaming?: boolean;
  onItemMouseDown: (e: MouseEvent<HTMLDivElement>, path: string, rect: ItemRect) => void;
  onResizeMouseDown: (e: MouseEvent<HTMLDivElement>, path: string, rect: ItemRect) => void;
  onFocusItem: (path: string) => void;
  onEnterBoard?: (folderPath: string) => void;
  /** SKY-11187: right-click opens the canvas item menu (Rename). */
  onContextMenu?: (e: MouseEvent<HTMLDivElement>, path: string) => void;
  /** SKY-11187: rename requested from the keyboard (F2) or the context menu. */
  onRequestRename?: (path: string) => void;
  /** Commit the typed name. An empty name is a no-op, resolved in main (§5). */
  onRenameCommit?: (path: string, newName: string) => void;
  onRenameCancel?: () => void;
}

function BoardCardImpl({
  item,
  x,
  y,
  w,
  h,
  tier,
  selected,
  dragging,
  renaming = false,
  onItemMouseDown,
  onResizeMouseDown,
  onFocusItem,
  onEnterBoard,
  onContextMenu,
  onRequestRename,
  onRenameCommit,
  onRenameCancel,
}: BoardCardProps) {
  const isFolder = item.kind === 'folder';
  const hasThumb = itemHasThumb(item);
  // `role="button"`/`"article"` do not take aria-selected, so the state
  // rides the accessible name instead of an invalid attribute.
  const label = isFolder ? `Board: ${item.name}. Double-click to open.` : `Note card: ${item.name}`;

  const className =
    `board-canvas__item board-canvas__item--${item.kind} board-canvas__item--lod-${tier}` +
    (hasThumb ? ' board-canvas__item--has-thumb' : '') +
    (selected ? ' board-canvas__item--selected' : '') +
    (dragging ? ' board-canvas__item--dragging' : '');

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // SKY-11187: F2 is the platform-standard rename key and the only way to
    // reach inline rename without a pointer — the context menu is a
    // right-click, and Enter on a tile is already "open this board".
    if (e.key === 'F2') {
      e.preventDefault();
      onRequestRename?.(item.path);
      return;
    }
    if (isFolder && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onEnterBoard?.(item.path);
    }
  };

  return (
    <div
      className={className}
      style={{ left: x, top: y, width: w, height: h }}
      onMouseDown={(e) => onItemMouseDown(e, item.path, { x, y, w, h })}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, item.path) : undefined}
      onDoubleClick={isFolder && !renaming ? () => onEnterBoard?.(item.path) : undefined}
      role={isFolder ? 'button' : 'article'}
      aria-label={selected ? `${label} Selected.` : label}
      data-selected={selected ? 'true' : undefined}
      data-lod={tier}
      // Below tier 1 the name is small or gone; the native tooltip keeps it one hover away.
      title={tier === 1 ? undefined : item.name}
      tabIndex={0}
      // Selection follows focus, so the rim is reachable by Tab and not only by pointer.
      onFocus={() => onFocusItem(item.path)}
      onKeyDown={handleKeyDown}
    >
      {/*
        The rename field replaces the name at EVERY tier, including tier 3
        (the coloured block, which normally has no text): a card the user just
        created at a zoomed-out level still has to be nameable where it sits.
      */}
      {renaming ? (
        <div className="board-canvas__item-header">
          <RenameField
            initialName={item.name}
            kind={item.kind}
            onCommit={(value) => onRenameCommit?.(item.path, value)}
            onCancel={() => onRenameCancel?.()}
          />
        </div>
      ) : tier < 3 ? (
        <div className="board-canvas__item-header">
          <span className="board-canvas__item-name">{item.name}</span>
        </div>
      ) : null}
      {tier === 1 && isFolder && (
        <div className="board-canvas__item-meta">
          {item.childBoards ?? 0} boards, {item.childCards ?? 0} cards
        </div>
      )}
      {tier < 3 && hasThumb && (
        <div className="board-canvas__thumb" style={{ height: thumbBlockHeight(h) }}>
          <NoteThumbnail info={item.thumb} alt={item.name} caption />
        </div>
      )}
      {tier === 1 && !isFolder && item.excerpt && (
        <div className="board-canvas__item-excerpt">{item.excerpt}</div>
      )}
      <div
        className="board-canvas__resize-handle"
        onMouseDown={(e) => onResizeMouseDown(e, item.path, { x, y, w, h })}
        aria-hidden="true"
      />
    </div>
  );
}

const BoardCard = memo(BoardCardImpl);
export default BoardCard;
