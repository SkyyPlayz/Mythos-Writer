import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeWordCount, computeSynopsis } from './SceneCard';
import { StatusBadge, StatusChip, draftStateToStatus } from './StatusBadge';
import { ViewToggle } from './ViewToggle';
import { BeatSheetSidebar } from './BeatSheetSidebar';
import ManuscriptStructureView from '../../ManuscriptStructureView';
import type { Scene, Chapter, Story } from '../../types';

// ─── Helpers ───

function makeBlock(content: string, order = 0) {
  return { id: `b${order}`, type: 'prose' as const, content, order, updatedAt: '' };
}

function makeScene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 's1',
    title: 'Test Scene',
    path: 'stories/s1/ch1/s1.md',
    order: 0,
    blocks: [],
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function makeChapter(scenes: Scene[] = [], id = 'ch1'): Chapter {
  return {
    id,
    title: 'Chapter One',
    path: 'stories/s1/ch1',
    order: 0,
    scenes,
    createdAt: '',
    updatedAt: '',
  };
}

function makeStory(chapters: Chapter[] = []): Story {
  return {
    id: 'st1',
    title: 'My Story',
    path: 'stories/st1',
    chapters,
    createdAt: '',
    updatedAt: '',
  };
}

// ─── computeWordCount ───

describe('computeWordCount', () => {
  it('returns 0 for a scene with no blocks', () => {
    expect(computeWordCount(makeScene())).toBe(0);
  });

  it('returns 0 for a scene with empty-content blocks', () => {
    expect(computeWordCount(makeScene({ blocks: [makeBlock('   ')] }))).toBe(0);
  });

  it('counts words across multiple blocks', () => {
    const scene = makeScene({
      blocks: [makeBlock('hello world', 0), makeBlock('three more words', 1)],
    });
    expect(computeWordCount(scene)).toBe(5);
  });

  it('handles blocks with extra whitespace', () => {
    expect(computeWordCount(makeScene({ blocks: [makeBlock('  a  b  c  ')] }))).toBe(3);
  });
});

// ─── draftStateToStatus ───

describe('draftStateToStatus', () => {
  it('maps undefined to draft', () => {
    expect(draftStateToStatus(undefined)).toBe('draft');
  });

  it('maps in-progress to draft', () => {
    expect(draftStateToStatus('in-progress')).toBe('draft');
  });

  it('maps review to review', () => {
    expect(draftStateToStatus('review')).toBe('review');
  });

  it('maps final to final', () => {
    expect(draftStateToStatus('final')).toBe('final');
  });
});

// ─── StatusBadge ───

describe('StatusBadge', () => {
  it('renders with accessible label for draft', () => {
    render(<StatusBadge status="draft" />);
    expect(screen.getByRole('img', { name: 'Status: Draft' })).toBeTruthy();
  });

  it('renders with accessible label for final', () => {
    render(<StatusBadge status="final" />);
    expect(screen.getByRole('img', { name: 'Status: Final' })).toBeTruthy();
  });

  it('renders with accessible label for cut', () => {
    render(<StatusBadge status="cut" />);
    expect(screen.getByRole('img', { name: 'Status: Cut' })).toBeTruthy();
  });

  it('applies the correct CSS class for each status', () => {
    const { rerender, container } = render(<StatusBadge status="draft" />);
    expect(container.firstChild).toHaveClass('status-badge--draft');

    rerender(<StatusBadge status="final" />);
    expect(container.firstChild).toHaveClass('status-badge--final');

    rerender(<StatusBadge status="cut" />);
    expect(container.firstChild).toHaveClass('status-badge--cut');
  });
});

// ─── ViewToggle (M14: Grid/List segmented control per prototype 559–561) ───

describe('ViewToggle', () => {
  it('renders both mode buttons labelled Grid and List', () => {
    render(<ViewToggle mode="card" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /list/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /grid/i })).toBeTruthy();
  });

  it('marks the active mode button as pressed', () => {
    render(<ViewToggle mode="card" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /grid/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /list/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('applies the neon active class to the pressed segment', () => {
    render(<ViewToggle mode="card" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /grid/i })).toHaveClass('msv-view-toggle__btn--active');
    expect(screen.getByRole('button', { name: /list/i })).not.toHaveClass('msv-view-toggle__btn--active');
  });

  it('calls onChange with the new mode when clicked', () => {
    const onChange = vi.fn();
    render(<ViewToggle mode="card" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /list/i }));
    expect(onChange).toHaveBeenCalledWith('list');
  });

  it('calls onChange with card when Grid is clicked', () => {
    const onChange = vi.fn();
    render(<ViewToggle mode="list" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /grid/i }));
    expect(onChange).toHaveBeenCalledWith('card');
  });

  it('has accessible group label', () => {
    render(<ViewToggle mode="list" onChange={vi.fn()} />);
    expect(screen.getByRole('group', { name: /view mode/i })).toBeTruthy();
  });
});

// ─── StatusChip (M14: prototype scene-card status pill) ───

describe('StatusChip', () => {
  it('renders the prototype label for each status', () => {
    const { rerender } = render(<StatusChip status="draft" />);
    expect(screen.getByText('Drafting')).toBeTruthy();

    rerender(<StatusChip status="final" />);
    expect(screen.getByText('Complete')).toBeTruthy();

    rerender(<StatusChip status="review" />);
    expect(screen.getByText('In review')).toBeTruthy();

    rerender(<StatusChip status="cut" />);
    expect(screen.getByText('Cut')).toBeTruthy();
  });

  it('applies the status modifier class', () => {
    const { container } = render(<StatusChip status="draft" />);
    expect(container.firstChild).toHaveClass('status-chip', 'status-chip--draft');
  });
});

// ─── computeSynopsis (M14: card synopsis line) ───

describe('computeSynopsis', () => {
  it('returns an empty string for a scene with no written blocks', () => {
    expect(computeSynopsis(makeScene())).toBe('');
    expect(computeSynopsis(makeScene({ blocks: [makeBlock('   ')] }))).toBe('');
  });

  it('returns the full first block when it is 14 words or fewer', () => {
    const scene = makeScene({ blocks: [makeBlock('A short opening line.')] });
    expect(computeSynopsis(scene)).toBe('A short opening line.');
  });

  it('truncates to 14 words with an ellipsis', () => {
    const words = Array.from({ length: 20 }, (_, i) => `w${i}`).join(' ');
    const scene = makeScene({ blocks: [makeBlock(words)] });
    expect(computeSynopsis(scene)).toBe(
      Array.from({ length: 14 }, (_, i) => `w${i}`).join(' ') + '…',
    );
  });

  it('uses the first block by order', () => {
    const scene = makeScene({
      blocks: [makeBlock('second block', 1), makeBlock('first block', 0)],
    });
    expect(computeSynopsis(scene)).toBe('first block');
  });
});

// ─── BEAT_STRUCTURE ───

describe('BEAT_STRUCTURE', () => {
  it('exports 3 acts', async () => {
    const { BEAT_ACTS } = await import('./BEAT_STRUCTURE');
    expect(BEAT_ACTS).toHaveLength(3);
    expect(BEAT_ACTS.map((a) => a.id)).toEqual(['setup', 'confrontation', 'resolution']);
  });

  it('has 15 total beats', async () => {
    const { ALL_BEATS } = await import('./BEAT_STRUCTURE');
    expect(ALL_BEATS).toHaveLength(15);
  });

  it('each beat has a unique id', async () => {
    const { ALL_BEATS } = await import('./BEAT_STRUCTURE');
    const ids = ALL_BEATS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── BeatSheetSidebar header label (SKY-573) ───

describe('BeatSheetSidebar', () => {
  it('renders "Save the Cat (3-Act)" as the sidebar header', () => {
    render(
      <BeatSheetSidebar
        scenes={[]}
        vaultKey="test"
        focusedBeatId={null}
        onBeatFocus={() => {}}
        onAssignmentsChange={() => {}}
      />,
    );
    expect(screen.getByText('Save the Cat (3-Act)')).toBeTruthy();
  });

  it('sidebar landmark has correct accessible label', () => {
    const { container } = render(
      <BeatSheetSidebar
        scenes={[]}
        vaultKey="test"
        focusedBeatId={null}
        onBeatFocus={() => {}}
        onAssignmentsChange={() => {}}
      />,
    );
    const aside = container.querySelector('aside');
    expect(aside?.getAttribute('aria-label')).toBe('Beat sheet — Save the Cat (3-Act)');
  });

  // M14: mapped-progress header per prototype 2361–2363
  it('shows "0 / 15 mapped" and an empty progress bar with no assignments', () => {
    render(
      <BeatSheetSidebar
        scenes={[]}
        vaultKey="test"
        focusedBeatId={null}
        onBeatFocus={() => {}}
        onAssignmentsChange={() => {}}
      />,
    );
    expect(screen.getByText('0 / 15 mapped')).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: /beats mapped/i });
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '15');
  });

  it('counts a beat as mapped once a scene is assigned to it', () => {
    localStorage.setItem(
      'mythos-beats-v1:test-mapped',
      JSON.stringify({ s1: 'catalyst', s2: 'catalyst' }),
    );
    render(
      <BeatSheetSidebar
        scenes={[makeScene({ id: 's1' }), makeScene({ id: 's2', title: 'Second' })]}
        vaultKey="test-mapped"
        focusedBeatId={null}
        onBeatFocus={() => {}}
        onAssignmentsChange={() => {}}
      />,
    );
    // Two scenes on one beat → 1 / 15 mapped, with a mapped dot on the row
    expect(screen.getByText('1 / 15 mapped')).toBeTruthy();
    expect(
      screen.getByRole('progressbar', { name: /beats mapped/i }),
    ).toHaveAttribute('aria-valuenow', '1');
    expect(document.querySelector('.beat-item__dot')).toBeTruthy();
    localStorage.removeItem('mythos-beats-v1:test-mapped');
  });
});

// ─── ManuscriptStructureView header (M14: prototype 558–565) ───

describe('ManuscriptStructureView header', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('shows the prototype meta line and editor hint', () => {
    const story = makeStory([makeChapter([makeScene()])]);
    render(
      <ManuscriptStructureView
        story={story}
        onSelectScene={() => {}}
        onReorderScenes={() => {}}
        onMoveScene={() => {}}
        onCreateScene={() => {}}
        onCreateChapter={() => {}}
        vaultRoot="test-vault"
      />,
    );
    expect(screen.getByText(/1 scenes · 1 chapter · grouped by chapter/)).toBeTruthy();
    expect(screen.getByText('Click a scene to open it in the editor')).toBeTruthy();
  });

  it('renders the chapter eyebrow in grid view', () => {
    localStorage.setItem('mythos-msv-view-mode-v1', 'card');
    const story = makeStory([makeChapter([makeScene()])]);
    render(
      <ManuscriptStructureView
        story={story}
        onSelectScene={() => {}}
        onReorderScenes={() => {}}
        onMoveScene={() => {}}
        onCreateScene={() => {}}
        onCreateChapter={() => {}}
        vaultRoot="test-vault"
      />,
    );
    expect(screen.getByText('CHAPTER 1')).toBeTruthy();
  });
});

// ─── ManuscriptStructureView — drag-and-drop undo (SKY-573) ───

function makeSceneWithId(id: string, order: number, title: string): Scene {
  return {
    id,
    title,
    path: `stories/st1/ch1/${id}.md`,
    order,
    chapterId: 'ch1',
    storyId: 'st1',
    blocks: [],
    draftState: 'in-progress',
    createdAt: '',
    updatedAt: '',
  };
}

describe('ManuscriptStructureView — Ctrl+Z undo (SKY-573)', () => {
  const THREE_SCENE_STORY: Story = makeStory([
    makeChapter([
      makeSceneWithId('sc1', 0, 'Scene Alpha'),
      makeSceneWithId('sc2', 1, 'Scene Beta'),
      makeSceneWithId('sc3', 2, 'Scene Gamma'),
    ]),
  ]);
  beforeEach(() => {
    // Force list view so keyboard reorder is straightforward to trigger
    localStorage.setItem('mythos-msv-view-mode-v1', 'list');
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('Ctrl+Z after a keyboard reorder restores the original scene order', () => {
    const onReorderScenes = vi.fn();
    render(
      <ManuscriptStructureView
        story={THREE_SCENE_STORY}
        onSelectScene={() => {}}
        onReorderScenes={onReorderScenes}
        onMoveScene={() => {}}
        onCreateScene={() => {}}
        onCreateChapter={() => {}}
        vaultRoot="test-vault"
      />,
    );

    // Find Scene Beta list item and enter keyboard reorder mode (Space)
    const betaItem = screen.getByRole('treeitem', { name: /Scene: Scene Beta/i });
    fireEvent.keyDown(betaItem, { key: ' ' });

    // Move it down (ArrowDown) — triggers the reorder
    fireEvent.keyDown(betaItem, { key: 'ArrowDown' });

    // Wrapper should have forwarded the reorder to the prop callback
    expect(onReorderScenes).toHaveBeenCalledTimes(1);
    expect(onReorderScenes).toHaveBeenCalledWith('st1', 'ch1', ['sc1', 'sc3', 'sc2']);

    // Ctrl+Z should restore the original order
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });

    expect(onReorderScenes).toHaveBeenCalledTimes(2);
    expect(onReorderScenes.mock.calls[1]).toEqual(['st1', 'ch1', ['sc1', 'sc2', 'sc3']]);
  });

  it('Ctrl+Z is a no-op when the undo stack is empty', () => {
    const onReorderScenes = vi.fn();
    render(
      <ManuscriptStructureView
        story={THREE_SCENE_STORY}
        onSelectScene={() => {}}
        onReorderScenes={onReorderScenes}
        onMoveScene={() => {}}
        onCreateScene={() => {}}
        onCreateChapter={() => {}}
        vaultRoot="test-vault"
      />,
    );

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(onReorderScenes).not.toHaveBeenCalled();
  });

  it('Ctrl+Z inside a text input does not consume the undo stack', () => {
    const onReorderScenes = vi.fn();
    const { container } = render(
      <>
        <input type="text" data-testid="text-input" />
        <ManuscriptStructureView
          story={THREE_SCENE_STORY}
          onSelectScene={() => {}}
          onReorderScenes={onReorderScenes}
          onMoveScene={() => {}}
          onCreateScene={() => {}}
          onCreateChapter={() => {}}
          vaultRoot="test-vault"
        />
      </>,
    );

    // Trigger a reorder to populate the undo stack
    const betaItem = screen.getByRole('treeitem', { name: /Scene: Scene Beta/i });
    fireEvent.keyDown(betaItem, { key: ' ' });
    fireEvent.keyDown(betaItem, { key: 'ArrowDown' });
    expect(onReorderScenes).toHaveBeenCalledTimes(1);

    // Ctrl+Z while an input has focus should NOT trigger our undo
    const input = container.querySelector('input')!;
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
    expect(onReorderScenes).toHaveBeenCalledTimes(1); // still only 1 call
  });
});
