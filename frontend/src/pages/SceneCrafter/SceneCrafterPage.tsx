import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Story } from '../../types';
import './SceneCrafterPage.css';

export interface SceneCrafterCard {
  wikilink: string;
  title: string;
  done: boolean;
  tags: string[];
  raw?: string;
}

export interface SceneCrafterLane {
  name: string;
  cards: SceneCrafterCard[];
}

export interface SceneCrafterBoard {
  storyId: string;
  lastModified: string;
  lanes: SceneCrafterLane[];
  extraFrontmatter?: Record<string, unknown>;
  kanbanSettings?: string;
}

interface Props {
  story: Story;
  onOpenNote?: (notePath: string) => void;
  onOpenScene?: (sceneId: string) => void;
}

const NOTE_DRAG_MIME = 'application/x-mythos-note-path';

function storySlugFromStory(story: Story): string {
  const segments = story.path.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) || story.title;
}

function normalizeWikilink(path: string): string {
  return path.trim().replace(/\.md$/i, '');
}

function titleFromPath(path: string): string {
  const normalized = normalizeWikilink(path);
  return (normalized.split(/[\\/]/).pop() || normalized).replace(/[-_]+/g, ' ');
}

function visibleTags(tags: string[]): string[] {
  return tags.filter((tag) => !tag.toLowerCase().startsWith('manuscript/'));
}

function manuscriptSceneId(tags: string[]): string | null {
  const tag = tags.find((value) => value.toLowerCase().startsWith('manuscript/'));
  return tag ? tag.slice('manuscript/'.length) : null;
}

export default function SceneCrafterPage({ story, onOpenNote, onOpenScene }: Props) {
  const storySlug = useMemo(() => storySlugFromStory(story), [story]);
  const [board, setBoard] = useState<SceneCrafterBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragCard, setDragCard] = useState<{ laneIndex: number; cardIndex: number } | null>(null);
  const [dragLane, setDragLane] = useState<number | null>(null);
  const [editingLane, setEditingLane] = useState<{ laneIndex: number; name: string } | null>(null);
  const [pendingDeleteLane, setPendingDeleteLane] = useState<{ laneIndex: number; cardCount: number } | null>(null);
  const [conflicted, setConflicted] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [retryAction, setRetryAction] = useState<(() => Promise<void>) | null>(null);
  const [moveMenuCard, setMoveMenuCard] = useState<{ laneIndex: number; cardIndex: number } | null>(null);
  const [moveAnnouncement, setMoveAnnouncement] = useState('');

  const prevFocusRef = useRef<HTMLElement | null>(null);
  const moveMenuTriggerRef = useRef<HTMLButtonElement | null>(null);

  const loadBoard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const existing = await window.api.sceneCrafterGetBoard(story.id, storySlug);
      const nextBoard = existing ?? await window.api.sceneCrafterCreateBoard(story.id, storySlug);
      setBoard(nextBoard);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Scene Crafter board.');
    } finally {
      setLoading(false);
    }
  }, [story.id, storySlug]);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  useEffect(() => {
    const unsubscribe = window.api.onSceneCrafterExternalEdit?.((changedSlug) => {
      if (changedSlug === storySlug) setConflicted(true);
    });
    return () => unsubscribe?.();
  }, [storySlug]);

  useEffect(() => {
    return () => { window.api.sceneCrafterClose?.(storySlug); };
  }, [storySlug]);

  async function runMutation(action: () => Promise<void>) {
    if (conflicted) return;
    try {
      setRetryAction(null);
      await action();
      await loadBoard();
    } catch {
      setRetryAction(() => action);
    }
  }

  function dropNotePath(event: React.DragEvent): string | null {
    const explicit = event.dataTransfer.getData(NOTE_DRAG_MIME);
    const text = event.dataTransfer.getData('text/plain');
    const path = explicit || text;
    return path ? normalizeWikilink(path) : null;
  }

  function handleLaneDrop(event: React.DragEvent, toLane: number) {
    event.preventDefault();
    if (dragCard) {
      const toIndex = board?.lanes[toLane]?.cards.length ?? 0;
      void runMutation(() => window.api.sceneCrafterMoveCard({
        storySlug,
        fromLane: dragCard.laneIndex,
        fromIndex: dragCard.cardIndex,
        toLane,
        toIndex,
      }).then(() => undefined));
      setDragCard(null);
      return;
    }

    if (dragLane !== null && dragLane !== toLane) {
      void runMutation(() => window.api.sceneCrafterReorderLanes({
        storySlug,
        fromIndex: dragLane,
        toIndex: toLane,
      }).then(() => undefined));
      setDragLane(null);
      return;
    }

    const notePath = dropNotePath(event);
    if (!notePath) return;
    void runMutation(() => window.api.sceneCrafterAddCard({
      storySlug,
      laneIndex: toLane,
      card: { wikilink: notePath, title: titleFromPath(notePath), done: false, tags: [] },
    }).then(() => undefined));
  }

  function toggleCard(laneIndex: number, cardIndex: number) {
    void runMutation(() => window.api.sceneCrafterToggleCardDone({ storySlug, laneIndex, cardIndex }).then(() => undefined));
  }

  function deleteCard(laneIndex: number, cardIndex: number) {
    void runMutation(() => window.api.sceneCrafterDeleteCard({ storySlug, laneIndex, cardIndex }).then(() => undefined));
  }

  function addLane() {
    void runMutation(() => window.api.sceneCrafterAddLane(storySlug, 'New Lane').then(() => undefined));
  }

  function saveLaneName() {
    if (!editingLane) return;
    const name = editingLane.name.trim();
    if (!name) {
      setEditingLane(null);
      return;
    }
    void runMutation(() => window.api.sceneCrafterRenameLane({
      storySlug,
      laneIndex: editingLane.laneIndex,
      name,
    }).then(() => undefined));
    setEditingLane(null);
  }

  async function requestDeleteLane(laneIndex: number, force = false) {
    if (conflicted) return;
    try {
      const result = await window.api.sceneCrafterDeleteLane({ storySlug, laneIndex, force });
      if (!result.ok) {
        setPendingDeleteLane({ laneIndex, cardCount: result.cardCount });
        return;
      }
      setPendingDeleteLane(null);
      await loadBoard();
    } catch {
      setRetryAction(() => () => requestDeleteLane(laneIndex, force));
    }
  }

  function openDiff() {
    prevFocusRef.current = document.activeElement as HTMLElement;
    setDiffOpen(true);
  }

  function closeDiff() {
    setDiffOpen(false);
    prevFocusRef.current?.focus();
  }

  function handleDiffKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') { closeDiff(); return; }
    if (e.key === 'Tab') {
      const focusable = Array.from(
        (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    }
  }

  function moveCardToLane(fromLane: number, fromIndex: number, toLane: number) {
    const laneName = board?.lanes[toLane]?.name ?? '';
    setMoveMenuCard(null);
    moveMenuTriggerRef.current?.focus();
    setMoveAnnouncement(`Card moved to ${laneName}`);
    const toIndex = board?.lanes[toLane]?.cards.length ?? 0;
    void runMutation(() => window.api.sceneCrafterMoveCard({
      storySlug,
      fromLane,
      fromIndex,
      toLane,
      toIndex,
    }).then(() => undefined));
  }

  function moveLane(laneIndex: number, direction: -1 | 1) {
    const toIndex = laneIndex + direction;
    if (!board || toIndex < 0 || toIndex >= board.lanes.length) return;
    const laneName = board.lanes[laneIndex].name;
    const position = direction === -1 ? 'left' : 'right';
    setMoveAnnouncement(`Moved lane ${laneName} to the ${position}`);
    void runMutation(() => window.api.sceneCrafterReorderLanes({
      storySlug,
      fromIndex: laneIndex,
      toIndex,
    }).then(() => undefined));
  }

  function handleMoveMenuKeyDown(
    e: React.KeyboardEvent<HTMLDivElement>,
  ) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setMoveMenuCard(null);
      moveMenuTriggerRef.current?.focus();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = Array.from(
        (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="menuitem"]'),
      );
      const idx = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'ArrowDown'
        ? items[(idx + 1) % items.length]
        : items[(idx - 1 + items.length) % items.length];
      next?.focus();
    }
  }

  if (loading) {
    return <div className="scene-crafter-page" role="status">Loading Scene Crafter…</div>;
  }

  if (error) {
    return (
      <div className="scene-crafter-page scene-crafter-state">
        <h2>Scene Crafter</h2>
        <p>{error}</p>
        <button onClick={() => void loadBoard()}>Retry</button>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="scene-crafter-page scene-crafter-state">
        <h2>Scene Crafter</h2>
        <p>No board found.</p>
        <button onClick={() => void loadBoard()}>Create board</button>
      </div>
    );
  }

  const cardCount = board.lanes.reduce((sum, lane) => sum + lane.cards.length, 0);

  return (
    <section className="scene-crafter-page" aria-label="Scene Crafter Kanban board">
      <header className="scene-crafter-header">
        <div>
          <p className="scene-crafter-eyebrow">Scene Crafter</p>
          <h2>{story.title} — Board</h2>
        </div>
        <div className="scene-crafter-actions">
          <span>{board.lanes.length} lanes · {cardCount} cards</span>
          <button onClick={addLane} disabled={conflicted}>Add lane</button>
        </div>
      </header>

      {conflicted && (
        <div className="scene-crafter-conflict" role="alert">
          <strong>Board changed on disk.</strong>
          <span>Choose which version to keep before making more edits.</span>
          <button onClick={() => setConflicted(false)}>Keep my version</button>
          <button onClick={() => { setConflicted(false); void loadBoard(); }}>Use disk version</button>
          <button onClick={openDiff}>See diff</button>
        </div>
      )}

      {retryAction && (
        <div className="scene-crafter-write-error" role="alert">
          Could not save Scene Crafter board.
          <button onClick={() => void runMutation(retryAction)}>Retry save</button>
        </div>
      )}

      {pendingDeleteLane && (
        <div className="scene-crafter-confirm" role="alert">
          Lane has {pendingDeleteLane.cardCount} card{pendingDeleteLane.cardCount === 1 ? '' : 's'}.
          <button onClick={() => void requestDeleteLane(pendingDeleteLane.laneIndex, true)}>Delete anyway</button>
          <button onClick={() => setPendingDeleteLane(null)}>Cancel</button>
        </div>
      )}

      {diffOpen && (
        <div
          className="scene-crafter-modal"
          onClick={(e) => { if (e.target === e.currentTarget) closeDiff(); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="sc-diff-title"
            onKeyDown={handleDiffKeyDown}
          >
            <h3 id="sc-diff-title">Board diff</h3>
            <p>Disk comparison will be expanded in v1; reload the disk version or keep your current board.</p>
            {/* autoFocus moves keyboard focus into the dialog on open */}
            <button autoFocus onClick={closeDiff}>Close</button>
          </div>
        </div>
      )}

      {cardCount === 0 && (
        <div className="scene-crafter-empty">
          <strong>Plan your next scene.</strong>
          <span>Drag a vault note here to start the board.</span>
        </div>
      )}

      {/* aria-live region announces keyboard moves to screen readers */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">{moveAnnouncement}</div>

      <div className="scene-crafter-lanes">
        {board.lanes.map((lane, laneIndex) => (
          <section
            key={`${lane.name}-${laneIndex}`}
            className="scene-crafter-lane"
            data-testid={`scene-crafter-lane-${lane.name}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => handleLaneDrop(event, laneIndex)}
          >
            <header
              className="scene-crafter-lane-header"
              draggable
              onDragStart={() => setDragLane(laneIndex)}
            >
              {editingLane?.laneIndex === laneIndex ? (
                <input
                  aria-label={`Rename lane ${lane.name}`}
                  value={editingLane.name}
                  onChange={(event) => setEditingLane({ laneIndex, name: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') saveLaneName();
                    if (event.key === 'Escape') setEditingLane(null);
                  }}
                  onBlur={saveLaneName}
                  autoFocus
                />
              ) : (
                <h3 onDoubleClick={() => setEditingLane({ laneIndex, name: lane.name })}>{lane.name}</h3>
              )}
              <span>{lane.cards.length}</span>
              <div className="scene-crafter-lane-reorder">
                <button
                  aria-label={`Move lane ${lane.name} left`}
                  disabled={laneIndex === 0}
                  onClick={() => moveLane(laneIndex, -1)}
                >←</button>
                <button
                  aria-label={`Move lane ${lane.name} right`}
                  disabled={laneIndex === board.lanes.length - 1}
                  onClick={() => moveLane(laneIndex, 1)}
                >→</button>
              </div>
              <button aria-label={`Delete lane ${lane.name}`} onClick={() => void requestDeleteLane(laneIndex)} disabled={conflicted}>×</button>
            </header>

            <div className="scene-crafter-card-list">
              {lane.cards.map((card, cardIndex) => {
                const sceneId = manuscriptSceneId(card.tags);
                const isMoveMenuOpen =
                  moveMenuCard?.laneIndex === laneIndex && moveMenuCard?.cardIndex === cardIndex;
                const firstNonCurrentLane = board.lanes.findIndex((_, i) => i !== laneIndex);
                return (
                  <article
                    key={`${card.wikilink}-${cardIndex}`}
                    className="scene-crafter-card"
                    data-testid={`scene-crafter-card-${card.wikilink}`}
                    draggable
                    onDragStart={() => setDragCard({ laneIndex, cardIndex })}
                  >
                    <label>
                      <input
                        type="checkbox"
                        checked={card.done}
                        aria-label={`Mark ${card.title} done`}
                        onChange={() => toggleCard(laneIndex, cardIndex)}
                        disabled={conflicted}
                      />
                      <span>{card.title}</span>
                    </label>
                    <div className="scene-crafter-card-tags">
                      {visibleTags(card.tags).map((tag) => <span key={tag}>#{tag}</span>)}
                    </div>
                    <div className="scene-crafter-card-actions">
                      <button onClick={() => onOpenNote?.(card.wikilink)}>Go to note</button>
                      {sceneId && <button onClick={() => onOpenScene?.(sceneId)}>Go to scene</button>}
                      <div className="scene-crafter-move-menu">
                        <button
                          aria-haspopup="menu"
                          aria-expanded={isMoveMenuOpen}
                          aria-label={`Move ${card.title} to lane`}
                          onClick={(e) => {
                            moveMenuTriggerRef.current = e.currentTarget;
                            setMoveMenuCard(isMoveMenuOpen ? null : { laneIndex, cardIndex });
                          }}
                        >Move to…</button>
                        {isMoveMenuOpen && (
                          <div
                            role="menu"
                            aria-label={`Choose lane for ${card.title}`}
                            className="scene-crafter-move-menu-popover"
                            onKeyDown={handleMoveMenuKeyDown}
                          >
                            {board.lanes.map((targetLane, targetLaneIndex) =>
                              targetLaneIndex !== laneIndex ? (
                                <button
                                  key={targetLaneIndex}
                                  role="menuitem"
                                  autoFocus={targetLaneIndex === firstNonCurrentLane}
                                  onClick={() => moveCardToLane(laneIndex, cardIndex, targetLaneIndex)}
                                >
                                  {targetLane.name}
                                </button>
                              ) : null,
                            )}
                          </div>
                        )}
                      </div>
                      <button aria-label={`Delete card ${card.title}`} onClick={() => deleteCard(laneIndex, cardIndex)} disabled={conflicted}>Delete</button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
