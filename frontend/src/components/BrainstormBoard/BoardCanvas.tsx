// Beta 4 / M20 — the ONE brainstorm board canvas (§7.2).
//
// Free-form 2200×1400 world ported from the Liquid Neon prototype:
// floating category region labels (bsCatLabels), 216px glass idea cards that
// drag anywhere (bsCardDown), wheel zoom + pan (bsPanDown/bsWheelH), the
// Connect tool (bsLinkFrom/bsLinks), double-click inline edit (bsEditKey),
// vault-note titles underlined → open the note, the Select/Connect/Frame/Text
// dock with zoom, and the `N ideas · M connections · K clusters · Synced`
// status line.

import { useCallback, useMemo, useState } from 'react';
import {
  BOARD_CATEGORIES,
  BOARD_WORLD,
  boardClusterCount,
  cardCenter,
  type BoardCard,
  type BoardLink,
} from '../../brainstormBoard';
import './BrainstormBoard.css';

// Prototype bsTools (line 7095) — exact SVG paths.
const BOARD_TOOLS = [
  { key: 'select', title: 'Select', path: 'M5 3l14 8-7 1.5L9.5 20z' },
  { key: 'connect', title: 'Connect ideas', path: 'M9.5 14.5l5-5M11 7l1.5-1.5a3.5 3.5 0 0 1 5 5L16 12M8 12l-1.5 1.5a3.5 3.5 0 0 0 5 5L13 17' },
  { key: 'frame', title: 'Frame', path: 'M4 4h16v16H4z' },
  { key: 'text', title: 'Text', path: 'M6 6h12M12 6v13' },
] as const;
type BoardTool = (typeof BOARD_TOOLS)[number]['key'];

const ZOOM_MIN = 50;
const ZOOM_MAX = 200;

interface Props {
  cards: BoardCard[];
  links: BoardLink[];
  /** Search query — cards not matching title/desc are hidden. */
  query?: string;
  onMoveCard: (id: string, x: number, y: number) => void;
  onEditCard: (id: string, updates: { title: string; desc: string }) => void;
  onAddLink: (from: string, to: string) => void;
  /** lowercase title → entity id; matching card titles underline + open the note. */
  noteIndex?: ReadonlyMap<string, string>;
  onOpenNote?: (entityId: string) => void;
  showToast: (message: string) => void;
  /** True once the latest board state has been written to the vault. */
  synced: boolean;
  /** Omit for the Board page (canvas fills). Set for the chat-stacked board. */
  stackedHeight?: number;
}

export default function BoardCanvas({
  cards,
  links,
  query = '',
  onMoveCard,
  onEditCard,
  onAddLink,
  noteIndex,
  onOpenNote,
  showToast,
  synced,
  stackedHeight,
}: Props) {
  const [tool, setTool] = useState<BoardTool>('select');
  const [zoom, setZoom] = useState(100);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ title: '', desc: '' });

  const visibleCards = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter(
      (card) => card.title.toLowerCase().includes(q) || card.desc.toLowerCase().includes(q),
    );
  }, [cards, query]);

  const visibleIds = useMemo(() => new Set(visibleCards.map((c) => c.id)), [visibleCards]);

  const visibleLinks = useMemo(
    () => links.filter((l) => visibleIds.has(l.from) && visibleIds.has(l.to)),
    [links, visibleIds],
  );

  const cardById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

  // ── Pan (prototype bsPanDown) ──
  const handlePanDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const px = pan.x;
    const py = pan.y;
    const move = (ev: MouseEvent) => setPan({ x: px + (ev.clientX - sx), y: py + (ev.clientY - sy) });
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [pan]);

  // ── Wheel zoom (prototype bsWheelH: ×1.08 / ×0.93) ──
  const handleWheel = useCallback((e: React.WheelEvent) => {
    setZoom((z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * (e.deltaY < 0 ? 1.08 : 0.93)))));
  }, []);

  // ── Card mousedown: connect-tool linking or drag-anywhere (bsCardDown) ──
  const handleCardDown = useCallback((card: BoardCard) => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (editingId === card.id) return;
    if (tool === 'connect') {
      if (!linkFrom) {
        setLinkFrom(card.id);
        showToast('Now click the idea to connect it to');
      } else if (linkFrom === card.id) {
        setLinkFrom(null);
      } else {
        const duplicate = links.some(
          (l) => (l.from === linkFrom && l.to === card.id) || (l.from === card.id && l.to === linkFrom),
        );
        if (duplicate) {
          showToast('Those ideas are already connected');
        } else {
          onAddLink(linkFrom, card.id);
          showToast('Ideas connected');
        }
        setLinkFrom(null);
      }
      return;
    }
    e.preventDefault();
    const scale = zoom / 100;
    const startX = e.clientX;
    const startY = e.clientY;
    const x0 = card.x;
    const y0 = card.y;
    const move = (ev: MouseEvent) => {
      onMoveCard(card.id, x0 + (ev.clientX - startX) / scale, y0 + (ev.clientY - startY) / scale);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [tool, linkFrom, links, zoom, editingId, onAddLink, onMoveCard, showToast]);

  // ── Inline edit (double-click → title input + desc textarea + Done) ──
  const startEdit = useCallback((card: BoardCard) => {
    setEditingId(card.id);
    setEditDraft({ title: card.title, desc: card.desc });
  }, []);

  const commitEdit = useCallback(() => {
    if (!editingId) return;
    onEditCard(editingId, { title: editDraft.title, desc: editDraft.desc });
    setEditingId(null);
  }, [editingId, editDraft, onEditCard]);

  const handleToolPick = useCallback((key: BoardTool, title: string) => {
    setTool(key);
    if (key !== 'connect') setLinkFrom(null);
    if (key === 'frame' || key === 'text') showToast(`${title} tool — coming soon`);
  }, [showToast]);

  const canvasHint = tool === 'connect'
    ? (linkFrom ? 'Click a second idea to link it' : 'Connect tool — click two ideas to link them')
    : 'Drag ideas anywhere · wheel to zoom · flesh things out in the Agent Chat';

  const clusterCount = boardClusterCount(cards);
  const ideasLabel = query.trim() && visibleCards.length !== cards.length
    ? `${visibleCards.length} of ${cards.length} ideas`
    : `${cards.length} ideas`;

  return (
    <div
      className={`bsb-root${stackedHeight != null ? ' bsb-root--stacked' : ''}`}
      style={stackedHeight != null ? { height: stackedHeight } : undefined}
    >
      <div className="bsb-canvas-wrap" data-testid="bsc-board" onWheel={handleWheel}>
        <div className="bsb-pan-layer" onMouseDown={handlePanDown} />
        <div
          className="bsb-world"
          data-testid="bsc-world"
          style={{
            width: BOARD_WORLD.width,
            height: BOARD_WORLD.height,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom / 100})`,
          }}
          onMouseDown={handlePanDown}
        >
          <svg
            className="bsb-links"
            width={BOARD_WORLD.width}
            height={BOARD_WORLD.height}
            aria-hidden="true"
          >
            {visibleLinks.map((link, i) => {
              const a = cardById.get(link.from);
              const b = cardById.get(link.to);
              if (!a || !b) return null;
              const ca = cardCenter(a);
              const cb = cardCenter(b);
              return (
                <line
                  key={`${link.from}-${link.to}-${i}`}
                  data-testid="bsc-link"
                  x1={ca.x}
                  y1={ca.y}
                  x2={cb.x}
                  y2={cb.y}
                />
              );
            })}
          </svg>
          {BOARD_CATEGORIES.map((cat) => (
            <div
              key={cat.key}
              className={`bsb-cat-label bsc-s${cat.color + 1}`}
              style={{ left: cat.home[0], top: cat.home[1] - 46 }}
              data-testid={`bsc-cat-label-${cat.key}`}
            >
              {cat.title}
            </div>
          ))}
          {visibleCards.map((card) => {
            const cat = BOARD_CATEGORIES.find((c) => c.key === card.cat) ?? BOARD_CATEGORIES[4];
            const editing = editingId === card.id;
            const noteId = noteIndex?.get(card.title.trim().toLowerCase());
            return (
              <div
                key={card.id}
                className={
                  `bsb-card bsc-s${cat.color + 1}` +
                  (linkFrom === card.id ? ' bsb-card--linking' : '') +
                  (tool === 'connect' ? ' bsb-card--connectable' : '')
                }
                style={{ left: card.x, top: card.y }}
                data-testid={`bsc-card-${card.id}`}
                onMouseDown={handleCardDown(card)}
                onDoubleClick={(e) => { e.stopPropagation(); startEdit(card); }}
                title={editing ? undefined : 'Double-click to edit'}
              >
                {editing ? (
                  <div className="bsb-card-edit" onMouseDown={(e) => e.stopPropagation()}>
                    <input
                      autoFocus
                      className="bsb-edit-title"
                      value={editDraft.title}
                      onChange={(e) => setEditDraft((d) => ({ ...d, title: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(); }
                      }}
                      aria-label="Idea title"
                      data-testid={`bsc-edit-title-${card.id}`}
                    />
                    <textarea
                      className="bsb-edit-desc"
                      value={editDraft.desc}
                      onChange={(e) => setEditDraft((d) => ({ ...d, desc: e.target.value }))}
                      aria-label="Idea description"
                      data-testid={`bsc-edit-desc-${card.id}`}
                    />
                    <button
                      type="button"
                      className="bsb-edit-done"
                      onClick={commitEdit}
                      data-testid={`bsc-edit-done-${card.id}`}
                    >
                      Done
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="bsb-card-row">
                      {card.av && <span className="bsb-av" aria-hidden="true">{card.av}</span>}
                      <div className="bsb-card-main">
                        {noteId && onOpenNote ? (
                          <button
                            type="button"
                            className="bsb-card-title bsb-card-title--note"
                            title="Linked note — click to open it in your vault"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); onOpenNote(noteId); }}
                            data-testid={`bsc-card-title-${card.id}`}
                          >
                            {card.title}
                          </button>
                        ) : (
                          <span className="bsb-card-title">{card.title}</span>
                        )}
                        {card.desc && <span className="bsb-card-desc">{card.desc}</span>}
                      </div>
                    </div>
                    {card.chips.length > 0 && (
                      <div className="bsb-card-chips">
                        {card.chips.map((chip) => (
                          <span key={chip} className="bsb-chip">{chip}</span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
        <div className="bsb-hint" data-testid="bsc-canvas-hint">{canvasHint}</div>
        <div className="bsb-dock" role="toolbar" aria-label="Board tools">
          {BOARD_TOOLS.map((t) => (
            <button
              key={t.key}
              type="button"
              title={t.title}
              aria-label={t.title}
              aria-pressed={tool === t.key}
              className={`bsc-tool${tool === t.key ? ' bsc-tool--active' : ''}`}
              onClick={() => handleToolPick(t.key, t.title)}
              data-testid={`bsc-tool-${t.key}`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={t.path} />
              </svg>
            </button>
          ))}
          <div className="bsb-dock-sep" aria-hidden="true" />
          <button
            type="button"
            className="bsc-zoom-btn"
            onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - 25))}
            aria-label="Zoom out"
            data-testid="bsc-zoom-out"
          >
            −
          </button>
          <span className="bsc-zoom-pct" data-testid="bsc-zoom-pct">{zoom}%</span>
          <button
            type="button"
            className="bsc-zoom-btn"
            onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + 25))}
            aria-label="Zoom in"
            data-testid="bsc-zoom-in"
          >
            +
          </button>
        </div>
      </div>
      <div className="bsb-status" data-testid="bsc-status">
        <span>{ideasLabel}</span>
        <span className="bsb-status-dot" aria-hidden="true">·</span>
        <span>{links.length} connections</span>
        <span className="bsb-status-dot" aria-hidden="true">·</span>
        <span>{clusterCount} clusters</span>
        <span className="bsb-status-spacer" />
        <span data-testid="bsc-status-sync">{synced ? 'Synced' : 'Saving…'}</span>
      </div>
    </div>
  );
}
