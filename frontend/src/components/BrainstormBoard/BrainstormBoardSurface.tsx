/**
 * SKY-11192/SKY-11674 — the shared canvas in Brainstorm's two homes (design
 * spec §1/§2). Both the Board page and the Agent Chat inline strip render
 * THIS component against the active mapped folder: same `useNotesBoard`
 * hook, same `BoardCanvas` engine the Notes Board tab uses — not a fork, not
 * a second copy kept in sync. `activeTool` stays fixed at `'select'`: this
 * ticket does not add the Notes Board tab's canvas-creation tools or inline
 * rename to Brainstorm — Idea Collections' `File` action is the one way a
 * new card lands here (see IdeaCollectionsPanel.tsx).
 */
import BoardCanvas from '../../pages/Boards/BoardCanvas';
import { useNotesBoard } from '../../pages/Boards/useNotesBoard';
import './BrainstormBoardSurface.css';

export interface PillFolder {
  key: 'plot' | 'characters' | 'worldbuilding';
  label: string;
  folderPath: string;
}

/** Fixed, in this order left-to-right (design spec §1) — not user-editable, matches ideaCollectionsFiling.ts's IDEA_COLLECTION_FOLDER targets. */
export const PILL_FOLDERS: readonly PillFolder[] = [
  { key: 'plot', label: 'Plot & Story', folderPath: 'Plot & Story' },
  { key: 'characters', label: 'Characters', folderPath: 'Characters' },
  { key: 'worldbuilding', label: 'Worldbuilding', folderPath: 'Worldbuilding' },
];

export interface BrainstormBoardSurfaceProps {
  folderPath: string;
  notesVaultValid: boolean;
  minZoom?: number;
  /** 'strip' renders the collapsed-card band below ~190px (design spec §2). */
  variant: 'page' | 'strip';
  /** Live height in px — only meaningful for variant='strip', drives the collapsed-card band. */
  heightPx?: number;
  /** Error-state "Choose another board" secondary action — omitted when there is nowhere else to switch to (flag off / strip). */
  onChooseAnotherBoard?: () => void;
}

/** Design spec §2: cards collapse to head-only chips in the band below ~190px, while dragging the strip's resize handle. */
const COLLAPSED_CARD_BAND_PX = 190;

export default function BrainstormBoardSurface({
  folderPath,
  notesVaultValid,
  minZoom,
  variant,
  heightPx,
  onChooseAnotherBoard,
}: BrainstormBoardSurfaceProps) {
  const { items, savedLayout, savedView, loading, error, handleItemMove, handleItemResize, handleViewChange } =
    useNotesBoard(folderPath, notesVaultValid);

  const collapsed = variant === 'strip' && typeof heightPx === 'number' && heightPx < COLLAPSED_CARD_BAND_PX;

  if (error) {
    // notesBoard.ts's own degrade-to-safe-default philosophy already turns a
    // malformed sidecar into an empty board (never an error) — this branch
    // is reserved for the folder itself being genuinely gone (design spec §4).
    return (
      <div className="bbs-error" role="alert" data-testid="bbs-error">
        <p>Couldn&apos;t open {folderPath}. It may have been moved or deleted.</p>
        {onChooseAnotherBoard && (
          <button type="button" className="bbs-error-choose" onClick={onChooseAnotherBoard}>
            Choose another board
          </button>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bbs-loading" role="status" aria-live="polite" data-testid="bbs-loading">
        <div className="bbs-loading-pulse" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className={`bbs-canvas${collapsed ? ' bbs-canvas--collapsed' : ''}`} data-testid="bbs-canvas">
      {items.length === 0 && (
        <p className="bbs-empty-msg" data-testid="bbs-empty">
          {variant === 'strip'
            ? 'No ideas here yet. File one from Idea Collections, or open the Board page to add a card.'
            : 'Nothing on this board yet. File an idea from Idea Collections to add your first card.'}
        </p>
      )}
      <BoardCanvas
        items={items}
        savedLayout={savedLayout}
        savedView={savedView}
        minZoom={minZoom}
        onItemMove={handleItemMove}
        onItemResize={handleItemResize}
        onViewChange={handleViewChange}
        activeTool="select"
      />
    </div>
  );
}
