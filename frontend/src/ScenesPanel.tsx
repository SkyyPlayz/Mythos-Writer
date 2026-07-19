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

/**
 * Beta 4/M19 (§7.1) — editor right-panel Scenes tab: a read-only pan/zoom
 * preview of the story's most recent Scene Crafter canvas board, with an
 * "Open full" button into the full crafter. Boards aren't scoped per scene
 * in the data model yet, so "the scene's canvas" is approximated as the
 * story's latest board — the same one Scene Crafter itself lists last.
 */
export default function ScenesPanel({ story, onOpenFull, onOpenNote }: Props) {
  const [boards, setBoards] = useState<CanvasBoardData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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

  const board = boards.at(-1) ?? null;

  return (
    <div className="scenes-panel-root">
      {board ? (
        <div className="scenes-panel-mini" data-testid="scenes-panel-mini">
          <CanvasBoard board={board} onChange={() => {}} onOpenNote={onOpenNote} readOnly />
        </div>
      ) : (
        <div className="scenes-panel-empty">
          <LayoutGrid className="scenes-panel-empty-icon" size={32} aria-hidden="true" />
          <p>No scene boards yet.</p>
          <p className="scenes-panel-empty-sub">Draft one in Scene Crafter — it&apos;ll show up here.</p>
        </div>
      )}
      <button type="button" className="scenes-panel-open-full" onClick={onOpenFull}>
        Open full →
      </button>
    </div>
  );
}
