/**
 * SKY-11192 (Notes Board 9/9) — Brainstorm's Board page and Agent Chat strip.
 *
 * Both are clients of `useVaultBoard`, the same hook the Notes Board tab uses,
 * over the same vault-relative `folderPath`. That is what makes the owner
 * ruling on SKY-10724 literally true: a card moved here is already moved in
 * the Notes Board tab, because there is one filesystem and one Store B sidecar
 * behind both — no copy, no sync step, nothing that could drift.
 *
 * What differs between the two homes is chrome around the canvas, never the
 * canvas (spec §1). The Notes Board tab keeps its breadcrumb over the whole
 * vault; Brainstorm gets a three-pill folder scope, because it has no folder
 * tree of its own and "which board am I looking at" still has to be answerable
 * at a glance. `Browse vault…` was cut from v1 (CEO ruling 1): any other
 * folder is reached from the Notes Board tab, which is already that navigator.
 */
import { useCallback, useMemo, useState } from 'react';
import BoardCanvas from './BoardCanvas';
import type { BoardTool } from './BoardCanvas';
import { useVaultBoard, vaultPathOf } from './useVaultBoard';
import { IDEA_FOLDERS } from './ideaFiling';
import './BrainstormBoardPage.css';

/**
 * Spec §2 — the collapsed-card band, pinned by CEO ruling 3.
 *
 * Below this height a full card cannot render its body without clipping, so
 * cards drop to head-only chips instead of showing a half-word. It is a CSS
 * state on the existing card markup, not a second component.
 */
export const STRIP_COLLAPSE_BELOW = 190;
/** Spec §2 resize band. The max is also capped at 60% of the chat panel. */
export const STRIP_DEFAULT_H = 240;
export const STRIP_MIN_H = 140;
export const STRIP_MAX_H = 480;

/** §2: the strip is a peek, so it never eats more than 60% of the chat panel. */
export function stripMaxHeight(chatPanelHeight: number): number {
  if (!Number.isFinite(chatPanelHeight) || chatPanelHeight <= 0) return STRIP_MAX_H;
  return Math.max(STRIP_MIN_H, Math.min(STRIP_MAX_H, Math.round(chatPanelHeight * 0.6)));
}

/** Clamp a dragged strip height into the band (§2 — below the floor snaps, never hides). */
export function clampStripHeight(height: number, chatPanelHeight: number): number {
  const max = stripMaxHeight(chatPanelHeight);
  if (!Number.isFinite(height)) return STRIP_DEFAULT_H;
  return Math.max(STRIP_MIN_H, Math.min(max, Math.round(height)));
}

/** SKY-11187 §5 tool palette — same three tools, same labels, as the Notes tab. */
const TOOLS: ReadonlyArray<{ id: BoardTool; label: string; title: string }> = [
  { id: 'select', label: 'Select', title: 'Select and move items' },
  { id: 'note', label: 'Note', title: 'Note tool — click the canvas to create a note' },
  { id: 'board', label: 'Board', title: 'Board tool — click the canvas to create a board' },
];

export interface BrainstormBoardPageProps {
  notesVaultValid: boolean;
  minZoom?: number;
  /**
   * The scope folder, one of IDEA_FOLDERS. Owned by BrainstormPage so the
   * Board page and the chat strip show the SAME board (§2 — the strip has no
   * selection of its own).
   */
  activeFolder: string;
  onActiveFolderChange: (folder: string) => void;
  /** 'page' = the full Board page; 'strip' = the short Agent Chat peek. */
  variant?: 'page' | 'strip';
  /** Rendered height of the strip, already clamped by the caller. */
  stripHeight?: number;
}

export default function BrainstormBoardPage({
  notesVaultValid,
  minZoom,
  activeFolder,
  onActiveFolderChange,
  variant = 'page',
  stripHeight = STRIP_DEFAULT_H,
}: BrainstormBoardPageProps) {
  const strip = variant === 'strip';

  /**
   * Drill-down INSIDE the active pill's folder. Double-clicking a board tile
   * is the canvas's own gesture and already works; without somewhere to put
   * the result it would be a dead affordance. This is not the folder-tree
   * navigator ruling 1 cut — there is no picker, only the trail you walked.
   */
  const [subPath, setSubPath] = useState<string[]>([]);
  const folderPath = useMemo(
    () => subPath.reduce<string>((acc, seg) => vaultPathOf(acc, seg), activeFolder),
    [activeFolder, subPath],
  );

  const board = useVaultBoard(folderPath, notesVaultValid);
  const { items } = board;

  const handleSelectFolder = useCallback((folder: string) => {
    setSubPath([]);
    onActiveFolderChange(folder);
  }, [onActiveFolderChange]);

  const handleEnterBoard = useCallback((itemPath: string) => {
    setSubPath((prev) => [...prev, itemPath]);
  }, []);

  const handleTrailClick = useCallback((depth: number) => {
    setSubPath((prev) => prev.slice(0, depth));
  }, []);

  if (!notesVaultValid) {
    return (
      <div className={`bsb${strip ? ' bsb--strip' : ''}`} data-testid="brainstorm-board">
        <p className="bsb__empty">No Notes vault selected. Open Settings to link a vault.</p>
      </div>
    );
  }

  /**
   * §4: a folder that is genuinely gone is the ONLY error state. A malformed
   * Store B sidecar is not an error to the user — notesBoard.ts already
   * degrades it to an empty board with auto-layout, and surfacing that as a
   * failure would describe a system that isn't the real one.
   */
  const gone = board.error !== null;

  const canvas = (
    <BoardCanvas
      items={items}
      savedLayout={board.savedLayout}
      savedView={board.savedView}
      minZoom={minZoom}
      onItemMove={board.onItemMove}
      onItemResize={board.onItemResize}
      onEnterBoard={handleEnterBoard}
      activeTool={board.activeTool}
      onCreateItem={board.onCreateItem}
      renamingPath={board.renamingPath}
      onRequestRename={board.onRequestRename}
      onRenameCommit={board.onRenameCommit}
      onRenameCancel={board.onRenameCancel}
    />
  );

  if (strip) {
    // §2: cards collapse to head-only chips below the pinned band, rather than
    // clipping a card body mid-word.
    const collapsed = stripHeight < STRIP_COLLAPSE_BELOW;
    return (
      <div
        className={`bsb bsb--strip${collapsed ? ' bsb--collapsed' : ''}`}
        style={{ height: stripHeight }}
        data-testid="brainstorm-board-strip"
        data-collapsed={collapsed ? 'true' : 'false'}
        aria-label={`Idea board — ${activeFolder}`}
      >
        <div className="bsb__strip-scope" data-testid="bsb-strip-scope">{activeFolder}</div>
        {gone ? (
          <p className="bsb__empty" role="status">
            This board is no longer available. Open the Board page to choose another.
          </p>
        ) : board.loading ? (
          <div className="bsb__pulse" role="status" aria-label="Loading board" />
        ) : (
          <div className="bsb__canvas-wrap">
            {items.length === 0 && (
              <p className="bsb__empty bsb__empty--overlay">
                No ideas here yet. File one from Idea Collections, or open the Board page to add a card.
              </p>
            )}
            {canvas}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bsb" data-testid="brainstorm-board" role="region" aria-label="Idea board">
      <div className="bsb__scope">
        {/*
          §1: a radio group, not a tab list — these pick which folder the ONE
          canvas below is scoped to; they do not swap panels.
        */}
        <div className="bsb__pills" role="radiogroup" aria-label="Board folder">
          {IDEA_FOLDERS.map((folder) => (
            <button
              key={folder}
              type="button"
              role="radio"
              aria-checked={activeFolder === folder}
              className={`bsb__pill${activeFolder === folder ? ' bsb__pill--active' : ''}`}
              data-folder={folder}
              data-testid={`bsb-pill-${folder.toLowerCase().replace(/[^a-z]+/g, '-')}`}
              onClick={() => handleSelectFolder(folder)}
            >
              {folder}
            </button>
          ))}

          <div className="bsb__tools" role="radiogroup" aria-label="Board tools">
            {TOOLS.map((tool) => (
              <button
                key={tool.id}
                type="button"
                role="radio"
                aria-checked={board.activeTool === tool.id}
                className={`bsb__tool${board.activeTool === tool.id ? ' bsb__tool--active' : ''}`}
                data-tool={tool.id}
                title={tool.title}
                onClick={() => board.setActiveTool(tool.id)}
              >
                {tool.label}
              </button>
            ))}
          </div>
        </div>

        {/*
          §1: a standing plain-language label, not a one-time toast. Removing
          it costs a returning user nothing and it answers the only question a
          first-time user has about this page.
        */}
        <p className="bsb__caption">This is your Notes Vault, viewed here.</p>

        {subPath.length > 0 && (
          <nav className="bsb__trail" aria-label="Board trail">
            <button type="button" className="bsb__trail-btn" onClick={() => handleTrailClick(0)}>
              {activeFolder}
            </button>
            {subPath.map((seg, i) => (
              <span key={`${i}:${seg}`}>
                <span className="bsb__trail-sep" aria-hidden="true">/</span>
                {i < subPath.length - 1 ? (
                  <button type="button" className="bsb__trail-btn" onClick={() => handleTrailClick(i + 1)}>{seg}</button>
                ) : (
                  <span className="bsb__trail-current" aria-current="page">{seg}</span>
                )}
              </span>
            ))}
          </nav>
        )}
      </div>

      {gone ? (
        <div className="bsb__error" role="alert">
          <span>Couldn&apos;t open {folderPath || activeFolder}. It may have been moved or deleted.</span>
          <button
            type="button"
            className="bsb__error-action"
            onClick={() => handleSelectFolder(IDEA_FOLDERS[0])}
          >
            Choose another board
          </button>
        </div>
      ) : board.loading ? (
        // §4: a static pulse, not a spinner. A spinner over a canvas reads as
        // "your cards are loading", which is not what is happening.
        <div className="bsb__loading" role="status" aria-live="polite">
          <div className="bsb__pulse" aria-label="Loading board" />
        </div>
      ) : (
        <div className="bsb__canvas-wrap">
          {items.length === 0 && (
            <div className="bsb__empty-state">
              <p className="bsb__empty-head">Nothing on this board yet</p>
              <p className="bsb__empty-body">
                Add a card from the dock, or file an idea from Idea Collections on the left.
              </p>
            </div>
          )}
          {canvas}
        </div>
      )}

      {board.actionError && (
        <div className="bsb__action-error" role="alert">
          {board.actionError}
          <button
            type="button"
            className="bsb__action-error-dismiss"
            aria-label="Dismiss"
            onClick={board.dismissActionError}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
