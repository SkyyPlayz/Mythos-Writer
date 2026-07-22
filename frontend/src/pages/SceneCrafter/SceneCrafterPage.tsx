import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Story } from '../../types';
import CanvasBoard from '../../canvas/CanvasBoard';
import type { CanvasBoardData } from '../../canvas/canvasTypes';
import {
  CRAFTER_COACH_SYSTEM_PROMPT,
  CRAFTER_GENERATE_COPY,
  CRAFTER_LENGTHS,
  CRAFTER_TONES,
  addBeat,
  buildDraftPrompt,
  castCardsFromSuggested,
  castFromSuggested,
  composeDraftBoard,
  composeDraftPassCard,
  defaultCrafterSetup,
  filterSuggested,
  groupSuggested,
  moveBeat,
  placesFromSuggested,
  planNotesFromVault,
  removeBeat,
  suggestedFromVault,
  toggleTone,
  wordCount,
  type ChosenCard,
  type CrafterSetup,
  type SuggestedCard,
  type VaultListItem,
} from './crafterState';
import { loadCrafterBoards, saveCrafterBoard } from './crafterBoardStore';
import { useIpcStream } from '../../hooks/useIpcStream';
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

/** Debounce for persisting canvas edits (drag/resize emit change storms). */
const BOARD_SAVE_DEBOUNCE_MS = 600;

function storySlugFromStory(story: Story): string {
  const segments = story.path.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) || story.title;
}

function manuscriptSceneId(tags: string[]): string | null {
  const tag = tags.find((value) => value.toLowerCase().startsWith('manuscript/'));
  return tag ? tag.slice('manuscript/'.length) : null;
}

/** A planning card carrying a `manuscript/<sceneId>` tag — see SKY-7601 point 2. */
interface LinkedSceneCard {
  key: string;
  title: string;
  sceneId: string;
}

/**
 * The one signal worth keeping from the retired lanes board (SKY-7601): a
 * manuscript-wide "this planning card points at a real scene" cross-reference.
 * `board.lanes` stays on disk per B4-3 (no destructive migration) — this just
 * reads it for a read-only jump-to-scene list instead of the old Kanban UI.
 */
function linkedSceneCards(board: SceneCrafterBoard | null): LinkedSceneCard[] {
  if (!board) return [];
  const cards: LinkedSceneCard[] = [];
  for (const lane of board.lanes) {
    for (const card of lane.cards) {
      const sceneId = manuscriptSceneId(card.tags);
      if (sceneId) cards.push({ key: card.wikilink, title: card.title, sceneId });
    }
  }
  return cards;
}

export default function SceneCrafterPage({
  story,
  onOpenNote,
  onOpenScene,
}: Props) {
  const storySlug = useMemo(() => storySlugFromStory(story), [story]);
  const [board, setBoard] = useState<SceneCrafterBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conflicted, setConflicted] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [retryAction, setRetryAction] = useState<(() => Promise<void>) | null>(null);

  // ── M18 crafter state: scene setup, suggested cards, canvas boards ────────
  const [setup, setSetup] = useState<CrafterSetup>(defaultCrafterSetup);
  const [beatInput, setBeatInput] = useState('');
  const [sugQ, setSugQ] = useState('');
  const [vaultItems, setVaultItems] = useState<VaultListItem[]>([]);
  const [boards, setBoards] = useState<CanvasBoardData[]>([]);
  const [openBoardId, setOpenBoardId] = useState<string | null>(null);
  const [planSel, setPlanSel] = useState<Record<string, boolean>>({});
  const [summary, setSummary] = useState('');
  const [boardsNote, setBoardsNote] = useState<string | null>(null);
  // Explicit "Custom…" selection in the POV dropdown — tracked separately from
  // setup.pov because an empty custom value is indistinguishable from "no POV
  // chosen yet" if derived from the text alone (§7.1, AC1).
  const [povCustomMode, setPovCustomMode] = useState(false);
  // AI first-pass draft generation (§7.1): streamId drives useIpcStream; a
  // failure to even start the stream (e.g. no API key) lands in draftStartError
  // since useIpcStream only observes post-start stream:error events.
  const [draftStreamId, setDraftStreamId] = useState<string | null>(null);
  const [draftStartError, setDraftStartError] = useState<string | null>(null);
  const draftStream = useIpcStream(draftStreamId);

  const prevFocusRef = useRef<HTMLElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<CanvasBoardData | null>(null);
  const draftStreamIdRef = useRef<string | null>(null);
  draftStreamIdRef.current = draftStreamId;

  const loadBoard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Suggested cards + saved canvas boards ride the same load gate so the
      // page is fully hydrated when the loading state clears. Both are
      // best-effort: a notes-vault hiccup must not block the kanban board.
      const fetchVaultItems = async (): Promise<VaultListItem[]> => {
        try {
          const listing = await window.api.listNotesVault();
          return 'error' in listing ? [] : listing.items;
        } catch {
          return [];
        }
      };
      const [existing, items] = await Promise.all([
        window.api.sceneCrafterGetBoard(story.id, storySlug),
        fetchVaultItems(),
      ]);
      const nextBoard = existing ?? await window.api.sceneCrafterCreateBoard(story.id, storySlug);
      const savedBoards = await loadCrafterBoards(storySlug, items).catch(() => [] as CanvasBoardData[]);
      setBoard(nextBoard);
      setVaultItems(items);
      setBoards(savedBoards);
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

  // Cancel any in-flight draft generation and flush a pending canvas save on unmount.
  useEffect(() => {
    return () => {
      if (draftStreamIdRef.current) void window.api.streamCancel(draftStreamIdRef.current);
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      const toSave = pendingSaveRef.current;
      pendingSaveRef.current = null;
      if (toSave) void saveCrafterBoard(storySlug, toSave).catch(() => undefined);
    };
  }, [storySlug]);

  async function keepLocalVersion() {
    if (!board) return;
    try {
      await window.api.sceneCrafterSaveBoard({ storySlug, board });
      setConflicted(false);
      setRetryAction(null);
    } catch {
      setRetryAction(() => keepLocalVersion);
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

  // ── M18: suggested cards, plan cards, draft boards ─────────────────────────
  const allSuggested = suggestedFromVault(vaultItems);
  const suggestedGroups = groupSuggested(filterSuggested(allSuggested, sugQ));
  const planNotes = planNotesFromVault(vaultItems);
  const openBoard = openBoardId !== null ? boards.find((b) => b.id === openBoardId) ?? null : null;
  // ── M19: POV select sourced from the vault's Characters group (§7.1, AC1) ──
  const cast = castFromSuggested(allSuggested);
  const povIsCustom = povCustomMode || (setup.pov.trim() !== '' && !cast.includes(setup.pov));
  // ── M19: right kanban — beats/cast/places (§7.1, AC8) ───────────────────────
  const castCards = castCardsFromSuggested(allSuggested);
  const placeCards = placesFromSuggested(allSuggested);

  function patchSetup(patch: Partial<CrafterSetup>) {
    setSetup((prev) => ({ ...prev, ...patch }));
  }

  function commitBeat() {
    setSetup((prev) => addBeat(prev, beatInput));
    setBeatInput('');
  }

  /**
   * Suggested-card click: toggles the note into the same selection set as
   * Plan Cards (`planSel`, keyed by vault path) so it counts as chosen draft
   * context and the card visibly marks itself selected right where it was
   * clicked (SKY-7601 — previously this silently wrote into the retired
   * lanes board's first lane, invisible unless you scrolled to it).
   */
  function addSuggestedCard(card: SuggestedCard) {
    setPlanSel((prev) => ({ ...prev, [card.nid]: !prev[card.nid] }));
  }

  async function persistBoard(next: CanvasBoardData) {
    try {
      await saveCrafterBoard(storySlug, next);
      setBoardsNote(null);
    } catch (err) {
      setBoardsNote(err instanceof Error ? err.message : 'Could not save the canvas board.');
    }
  }

  /**
   * Everything the draft board pulls in: selected Plan Cards plus any
   * selected suggested card (§7.1's real mechanism — see `addSuggestedCard`
   * above). A note can be both a Plan Card and a suggested card at once
   * (e.g. a "Plan …" note also shows up grouped under NOTES); `seen` keeps
   * it from being counted twice.
   */
  function chosenCards(): ChosenCard[] {
    const chosen: ChosenCard[] = [];
    const seen = new Set<string>();
    for (const plan of planNotes) {
      if (!planSel[plan.id]) continue;
      chosen.push({ title: plan.t, desc: plan.d, nid: plan.id });
      seen.add(plan.id);
    }
    for (const card of allSuggested) {
      if (!planSel[card.nid] || seen.has(card.nid)) continue;
      chosen.push({ title: card.t, desc: card.d, nid: card.nid });
      seen.add(card.nid);
    }
    return chosen;
  }

  // ── M19: AI first-pass generation (§7.1) ────────────────────────────────────
  // The Writing Coach drafts a scaffold from the setup + chosen cards. The
  // result only ever reaches the canvas board via addDraftToBoard() below —
  // no path here writes to manuscript/scene storage (decisions log B4-9, AC6).
  function startDraftStream() {
    setDraftStartError(null);
    const prompt = buildDraftPrompt(setup, chosenCards(), summary);
    window.api
      .streamStart({ messages: [{ role: 'user', content: prompt }], system: CRAFTER_COACH_SYSTEM_PROMPT, maxTokens: 900 })
      .then(({ streamId }) => setDraftStreamId(streamId))
      .catch((err) => {
        setDraftStartError(err instanceof Error ? err.message : 'AI unavailable — check your API key in settings.');
      });
  }

  function generateDraft() {
    if (draftStreamId) return;
    startDraftStream();
  }

  function discardDraft() {
    if (draftStreamId && !draftStream.done) draftStream.cancel();
    setDraftStreamId(null);
    setDraftStartError(null);
  }

  /** Retry bypasses generateDraft()'s guard — draftStreamId hasn't cleared yet in this tick. */
  function retryDraft() {
    discardDraft();
    startDraftStream();
  }

  /** Add to scene board (B4-9): the draft card lands on a new canvas board — never in the manuscript. */
  async function addDraftToBoard() {
    if (!draftStreamId || !draftStream.done || draftStream.error) return;
    const boardId = 'b' + Date.now();
    const draftCard = composeDraftPassCard(setup, draftStream.text, `${boardId}-first-pass`);
    const next = composeDraftBoard(setup, chosenCards(), boards.length + 1, boardId, draftCard);
    setBoards((prev) => [...prev, next]);
    discardDraft();
    await persistBoard(next);
    setOpenBoardId(next.id);
  }

  /** Canvas mutations update state immediately and persist on a debounce. */
  function handleCanvasChange(next: CanvasBoardData) {
    setBoards((prev) => prev.map((b) => (b.id === next.id ? next : b)));
    pendingSaveRef.current = next;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      const toSave = pendingSaveRef.current;
      pendingSaveRef.current = null;
      if (toSave) void persistBoard(toSave);
    }, BOARD_SAVE_DEBOUNCE_MS);
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

  // ── M18 canvas board view (prototype lines 1005–1048) ─────────────────────
  if (openBoard) {
    return (
      <section className="scene-crafter-page sc-canvas-view" aria-label={`Canvas board ${openBoard.name}`}>
        <header className="sc-canvas-head">
          <button type="button" className="sc-canvas-back" onClick={() => setOpenBoardId(null)}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 6l-6 6 6 6" />
            </svg>
            Boards
          </button>
          <span className="sc-canvas-name">{openBoard.name}</span>
          <span className="sc-canvas-chip">CANVAS</span>
          <span className="sc-canvas-hint">Drag cards · corner to resize · ⚯ to connect · drag space to pan · scroll to zoom</span>
        </header>
        <div className="sc-canvas-body">
          <CanvasBoard board={openBoard} onChange={handleCanvasChange} onOpenNote={onOpenNote} />
        </div>
      </section>
    );
  }

  const linkedScenes = linkedSceneCards(board);

  return (
    <section className="scene-crafter-page" aria-label="Scene Crafter">
      <header className="scene-crafter-header">
        <div>
          <p className="scene-crafter-eyebrow">Scene Crafter</p>
          <h2>{story.title} — Board</h2>
          <p className="scene-crafter-tagline">
            Set the shape, pull in context from your vault, then let the Writing Coach draft a first pass.
          </p>
        </div>
      </header>

      {conflicted && (
        <div className="scene-crafter-conflict" role="alert">
          <strong>Board changed on disk.</strong>
          <span>Choose which version to keep before making more edits.</span>
          <button onClick={() => void keepLocalVersion()}>Keep my version</button>
          <button onClick={() => { setConflicted(false); void loadBoard(); }}>Use disk version</button>
          <button onClick={openDiff}>See diff</button>
        </div>
      )}

      {retryAction && (
        <div className="scene-crafter-write-error" role="alert">
          Could not save Scene Crafter board.
          <button onClick={() => void retryAction()}>Retry save</button>
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

      <div className="scene-crafter-body">
        {/* ── Suggested cards panel (prototype lines 355–371) ── */}
        <aside className="sc-suggest" aria-label="Suggested cards">
          <div className="sc-suggest-title">SUGGESTED CARDS</div>
          <div className="sc-suggest-search">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="6.5" />
              <path d="M20.5 20.5L16 16" />
            </svg>
            <input
              placeholder="Search your vault…"
              aria-label="Search your vault"
              value={sugQ}
              onChange={(event) => setSugQ(event.target.value)}
            />
          </div>
          {suggestedGroups.map((group) => (
            <Fragment key={group.title}>
              <div className="sc-suggest-group">{group.title}</div>
              {group.cards.map((card) => (
                <button
                  type="button"
                  key={card.nid}
                  className={`sc-sugg-card${planSel[card.nid] ? ' sc-sugg-card--on' : ''}`}
                  aria-pressed={!!planSel[card.nid]}
                  title="Click to use as context for your draft"
                  onClick={() => addSuggestedCard(card)}
                >
                  <span className="sc-sugg-av">{card.av}</span>
                  <span className="sc-sugg-text">
                    <span className="sc-sugg-t">{card.t}</span>
                    <span className="sc-sugg-d">{card.d}</span>
                  </span>
                </button>
              ))}
            </Fragment>
          ))}
          <div className="sc-suggest-hint">
            Click a card to use it as context for your draft — the Brainstorm Agent keeps this list stocked from your vault.
          </div>
        </aside>

        <div className="sc-columns">
          {/* ── Scene Setup column (prototype lines 1059–1094 + 487–520) ── */}
          <section className="sc-col sc-col-setup" aria-label="Scene setup">
            <div className="sc-col-head">SCENE SETUP</div>
            <div className="sc-panel">
              <label className="sc-field">
                <span className="sc-field-label">SCENE TITLE</span>
                <input
                  value={setup.title}
                  placeholder="The next scene…"
                  onChange={(event) => patchSetup({ title: event.target.value })}
                />
              </label>
              <label className="sc-field">
                <span className="sc-field-label">POV</span>
                <select
                  aria-label="POV"
                  value={povIsCustom ? '__custom__' : setup.pov}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (next === '__custom__') {
                      setPovCustomMode(true);
                    } else {
                      setPovCustomMode(false);
                      patchSetup({ pov: next });
                    }
                  }}
                >
                  <option value="">Who carries the camera?</option>
                  {cast.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                  <option value="__custom__">Custom…</option>
                </select>
                {povIsCustom && (
                  <input
                    className="sc-pov-custom"
                    aria-label="Custom POV name"
                    value={setup.pov}
                    placeholder="Name this scene's POV"
                    onChange={(event) => patchSetup({ pov: event.target.value })}
                  />
                )}
              </label>
              <label className="sc-field">
                <span className="sc-field-label">GOAL</span>
                <textarea
                  value={setup.goal}
                  placeholder="What must this scene reach?"
                  onChange={(event) => patchSetup({ goal: event.target.value })}
                />
              </label>
              <label className="sc-field">
                <span className="sc-field-label">CONFLICT</span>
                <textarea
                  value={setup.conflict}
                  placeholder="What stands in the way?"
                  onChange={(event) => patchSetup({ conflict: event.target.value })}
                />
              </label>

              <div className="sc-field-label sc-section-label">BEATS</div>
              <ul className="sc-beats">
                {setup.beats.map((beat, index) => (
                  <li
                    key={`${beat}-${index}`}
                    className="sc-beat"
                    draggable
                    data-testid={`sc-beat-${index}`}
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', String(index));
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const from = Number(event.dataTransfer.getData('text/plain'));
                      if (!Number.isInteger(from) || from === index) return;
                      setSetup((prev) => {
                        const beats = prev.beats.slice();
                        const [moved] = beats.splice(from, 1);
                        beats.splice(index, 0, moved);
                        return { ...prev, beats };
                      });
                    }}
                  >
                    <button
                      type="button"
                      className="sc-beat-move"
                      aria-label={`Move beat "${beat}" up`}
                      disabled={index === 0}
                      onClick={() => setSetup((prev) => moveBeat(prev, index, -1))}
                    >↑</button>
                    <button
                      type="button"
                      className="sc-beat-move"
                      aria-label={`Move beat "${beat}" down`}
                      disabled={index === setup.beats.length - 1}
                      onClick={() => setSetup((prev) => moveBeat(prev, index, 1))}
                    >↓</button>
                    <span>{beat}</span>
                    <button
                      type="button"
                      className="sc-beat-remove"
                      aria-label={`Remove beat ${beat}`}
                      onClick={() => setSetup((prev) => removeBeat(prev, index))}
                    >
                      <svg width="8" height="8" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                        <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="sc-beat-add">
                <input
                  placeholder="Add a beat…"
                  aria-label="Add a beat"
                  value={beatInput}
                  onChange={(event) => setBeatInput(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') commitBeat(); }}
                />
                <button type="button" className="sc-beat-add-btn" onClick={commitBeat}>Add</button>
              </div>

              <div className="sc-field-label sc-section-label">TONE</div>
              <div className="sc-tones">
                {CRAFTER_TONES.map((tone) => (
                  <button
                    type="button"
                    key={tone}
                    className={`sc-tone${setup.tones[tone] ? ' sc-tone--on' : ''}`}
                    aria-pressed={!!setup.tones[tone]}
                    onClick={() => setSetup((prev) => toggleTone(prev, tone))}
                  >
                    {tone}
                  </button>
                ))}
              </div>

              <div className="sc-field-label sc-section-label">LENGTH</div>
              <div className="sc-len-seg">
                {CRAFTER_LENGTHS.map((len) => (
                  <button
                    type="button"
                    key={len}
                    className={`sc-len${setup.len === len ? ' sc-len--on' : ''}`}
                    aria-pressed={setup.len === len}
                    onClick={() => patchSetup({ len })}
                  >
                    {len}
                  </button>
                ))}
              </div>
              {setup.len === 'Custom' && (
                <input
                  className="sc-len-custom"
                  aria-label="Custom length"
                  placeholder="e.g. 900 words, or “until the door opens”"
                  value={setup.customLen}
                  onChange={(event) => patchSetup({ customLen: event.target.value })}
                />
              )}

              {linkedScenes.length > 0 && (
                <>
                  <div className="sc-field-label sc-section-label">LINKED SCENES</div>
                  <div className="sc-linked-list" data-testid="crafter-linked-scenes">
                    {linkedScenes.map((card) => (
                      <div className="sc-linked-row" key={card.key}>
                        <span className="sc-linked-row-title">{card.title}</span>
                        <button type="button" onClick={() => onOpenScene?.(card.sceneId)}>Go to scene</button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="sc-field-label sc-section-label">BOARDS</div>
              {boards.length > 0 && (
                <div className="sc-board-list" data-testid="crafter-board-list">
                  {boards.map((row) => (
                    <button
                      type="button"
                      key={row.id}
                      className="sc-board-row"
                      onClick={() => setOpenBoardId(row.id)}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
                        <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
                        <rect x="13.5" y="6.5" width="7" height="7" rx="1.5" />
                        <rect x="7.5" y="14.5" width="7" height="7" rx="1.5" />
                        <path d="M10.5 7.5h3M12 13.5v1" />
                      </svg>
                      <span className="sc-board-row-text">
                        <span className="sc-board-row-name">{row.name}</span>
                        <span className="sc-board-row-meta">{row.cards.length} cards · {row.links.length} links</span>
                      </span>
                      <span className="sc-board-chip">CANVAS</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="sc-help">
                Draft board builds a canvas here — click it to open, drag cards, draw connectors.
              </div>
            </div>
          </section>

          {/* ── Scene Draft column (prototype lines 1095–1145) ── */}
          <section className="sc-col sc-col-draft" aria-label="Scene draft">
            <div className="sc-col-head sc-col-head--draft">SCENE DRAFT</div>
            <div className="sc-panel">
              <div className="sc-field-label">QUICK SUMMARY</div>
              <textarea
                className="sc-summary"
                placeholder="Sketch the scene in a sentence or two — or pick a plan card below…"
                aria-label="Quick summary"
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
              />
              <div className="sc-field-label sc-section-label">PLAN CARDS — FROM YOUR VAULT</div>
              <div className="sc-plan-list">
                {planNotes.length === 0 && (
                  <div className="sc-help">No Story Plan notes yet — notes named “Plan …” (or in a Plans folder) appear here.</div>
                )}
                {planNotes.map((plan) => (
                  <button
                    type="button"
                    key={plan.id}
                    className={`sc-plan-card${planSel[plan.id] ? ' sc-plan-card--on' : ''}`}
                    aria-pressed={!!planSel[plan.id]}
                    onClick={() => setPlanSel((prev) => ({ ...prev, [plan.id]: !prev[plan.id] }))}
                  >
                    <span className="sc-plan-t">{plan.t}</span>
                    <span className="sc-plan-d">{plan.d}</span>
                  </button>
                ))}
              </div>
              <p className="sc-generate-copy">{CRAFTER_GENERATE_COPY}</p>
              {!draftStreamId && (
                <button type="button" className="sc-draft-btn" onClick={generateDraft}>
                  Generate ✦
                </button>
              )}
              {draftStartError && (
                <div className="sc-draft-error" role="alert">
                  {draftStartError}
                  <button type="button" onClick={generateDraft}>Try again</button>
                </div>
              )}
              <div className="sc-help">
                Generated text is a planning scaffold only — it never enters the manuscript. Add it to the scene board and copy from it by hand.
              </div>
            </div>

            {draftStreamId && !draftStream.done && !draftStream.error && (
              <div className="sc-draft-busy" data-testid="sc-draft-generating">
                {draftStream.text ? (
                  <div className="sc-draft-live-preview">{draftStream.text}</div>
                ) : (
                  <>
                    <div className="sc-skel" />
                    <div className="sc-skel sc-skel--short" />
                  </>
                )}
                <div className="sc-draft-busy-label">Drafting to your beats…</div>
                <button type="button" className="sc-draft-cancel" onClick={discardDraft}>Cancel</button>
              </div>
            )}

            {draftStreamId && draftStream.error && (
              <div className="sc-draft-error" role="alert">
                {draftStream.error}
                <button type="button" onClick={retryDraft}>Retry</button>
                <button type="button" onClick={discardDraft}>Discard</button>
              </div>
            )}

            {draftStreamId && draftStream.done && !draftStream.error && (
              <div className="sc-draft-card" data-testid="sc-draft-card">
                <div className="sc-draft-card-head">
                  <span className="sc-draft-card-av">✎</span>
                  <span className="sc-draft-card-title">{(setup.title.trim() || 'Untitled scene')} — first pass</span>
                </div>
                <div className="sc-draft-card-body">{draftStream.text}</div>
                <div className="sc-draft-card-meta">{wordCount(draftStream.text)} words</div>
                <div className="sc-draft-card-actions">
                  <button type="button" className="sc-draft-add" onClick={() => void addDraftToBoard()}>
                    Add to scene board
                  </button>
                  <button type="button" onClick={retryDraft}>Retry</button>
                  <button type="button" onClick={discardDraft}>Discard</button>
                </div>
              </div>
            )}

            {!draftStreamId && !draftStartError && (
              <div className="sc-draft-idle">Set beats and tone, then<br />Generate — the card lands here.</div>
            )}
            {boardsNote && <div className="sc-boards-note">{boardsNote}</div>}
          </section>
        </div>

        {/* ── Right kanban: beats / cast / places (§7.1, AC8) ── */}
        <aside className="sc-right-kanban" aria-label="Scene board: beats, cast, and places">
          <div className="sc-right-kanban-col" aria-label="Beats">
            <div className="sc-right-kanban-head">BEATS</div>
            {setup.beats.length === 0 && <div className="sc-help">Add beats in Scene Setup — they&apos;ll show up here.</div>}
            {setup.beats.map((beat, index) => (
              <div className="sc-right-kanban-card" key={`${beat}-${index}`}>{beat}</div>
            ))}
          </div>
          <div className="sc-right-kanban-col" aria-label="Cast">
            <div className="sc-right-kanban-head">CAST</div>
            {castCards.length === 0 && <div className="sc-help">No Characters notes in your vault yet.</div>}
            {castCards.map((card) => (
              <button
                type="button"
                key={card.nid}
                className="sc-right-kanban-card sc-right-kanban-card--linked"
                onClick={() => onOpenNote?.(card.nid)}
              >
                {card.t}
              </button>
            ))}
          </div>
          <div className="sc-right-kanban-col" aria-label="Places">
            <div className="sc-right-kanban-head">PLACES</div>
            {placeCards.length === 0 && <div className="sc-help">No Locations notes in your vault yet.</div>}
            {placeCards.map((card) => (
              <button
                type="button"
                key={card.nid}
                className="sc-right-kanban-card sc-right-kanban-card--linked"
                onClick={() => onOpenNote?.(card.nid)}
              >
                {card.t}
              </button>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}
