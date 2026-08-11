import { useEffect, useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import type { Story } from './types';
import type { CanvasBoardData } from './canvas/canvasTypes';
import CanvasBoard from './canvas/CanvasBoard';
import { loadCrafterBoards } from './pages/SceneCrafter/crafterBoardStore';
import './ScenesPanel.css';

interface Props {
  story: Story | null;
  onOpenFull: () => void;
  onOpenNote?: (notePath: string) => void;
}

function storySlugFromStory(story: Story): string {
  const segments = story.path.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) || story.title;
}

/** Canvas-board glyph from the prototype's Scenes-tab board rows. */
function BoardGlyph() {
  return (
    <svg
      className="scenes-panel-board-glyph"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="6.5" width="7" height="7" rx="1.5" />
      <rect x="7.5" y="14.5" width="7" height="7" rx="1.5" />
      <path d="M10.5 7.5h3M12 13.5v1" />
    </svg>
  );
}

/**
 * Beta 4/M19 (§7.1) + M9c — editor right-panel Scenes tab: every canvas board
 * drafted in Scene Crafter is listed here; a read-only pan/zoom preview shows
 * the picked board (or, matching the prototype, the latest board when none is
 * picked) with an "Open full" button into the full crafter.
 */
export default function ScenesPanel({ story, onOpenFull, onOpenNote }: Props) {
  const [boards, setBoards] = useState<CanvasBoardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickedBoardId, setPickedBoardId] = useState<string | null>(null);

  useEffect(() => {
    setPickedBoardId(null);
    if (!story) { setBoards([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    loadCrafterBoards(storySlugFromStory(story))
      .then((loaded) => { if (!cancelled) setBoards(loaded); })
      .catch(() => { if (!cancelled) setBoards([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [story]);

  if (!story) {
    return (
      <div className="scenes-panel-empty">
        <p>Select a story to see its scene board.</p>
      </div>
    );
  }

  if (loading) {
    return <div className="scenes-panel-empty" role="status">Loading scene board…</div>;
  }

  const board = boards.find((b) => b.id === pickedBoardId) ?? boards.at(-1) ?? null;

  return (
    <div className="scenes-panel-root">
      {boards.length > 0 && (
        <div className="scenes-panel-boards" data-testid="scenes-panel-boards">
          <div className="scenes-panel-boards-label" id="scenes-panel-boards-label">
            Canvas boards
          </div>
          <ul className="scenes-panel-board-list" aria-labelledby="scenes-panel-boards-label">
            {boards.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  className="scenes-panel-board"
                  aria-pressed={b.id === pickedBoardId}
                  onClick={() => setPickedBoardId((cur) => (cur === b.id ? null : b.id))}
                >
                  <BoardGlyph />
                  <span className="scenes-panel-board-name">{b.name}</span>
                  <span className="scenes-panel-board-count">{b.cards.length} cards</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {board ? (
        <div className="scenes-panel-mini" data-testid="scenes-panel-mini">
          <CanvasBoard key={board.id} board={board} onChange={() => {}} onOpenNote={onOpenNote} readOnly />
        </div>
      ) : (
        <div className="scenes-panel-empty-boards" data-testid="scenes-panel-empty-boards">
          <LayoutGrid className="scenes-panel-empty-icon" size={24} aria-hidden="true" />
          <p>No canvas boards yet.</p>
          <p>
            Draft one in the{' '}
            <button type="button" className="scenes-panel-empty-action" onClick={onOpenFull}>
              Scene Crafter
            </button>{' '}
            and it appears here.
          </p>
        </div>
      )}
      <button type="button" className="scenes-panel-open-full" onClick={onOpenFull}>
        Open full →
      </button>
    </div>
  );
}
