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

// ─── BEAT_STRUCTURE (Beta 4 M14: 3 templates) ───

describe('BEAT_STRUCTURE', () => {
  it('exports 3 acts for the default (Save the Cat) template', async () => {
    const { BEAT_ACTS } = await import('./BEAT_STRUCTURE');
    expect(BEAT_ACTS).toHaveLength(3);
    expect(BEAT_ACTS.map((a) => a.id)).toEqual(['setup', 'confrontation', 'resolution']);
  });

  it('Save the Cat keeps its 15 Beta 3 beat ids (persisted assignments survive)', async () => {
    const { BEAT_ACTS } = await import('./BEAT_STRUCTURE');
    const ids = BEAT_ACTS.flatMap((a) => a.beats.map((b) => b.id));
    expect(ids).toHaveLength(15);
    expect(ids).toContain('catalyst');
    expect(ids).toContain('midpoint');
    expect(ids).toContain('final-image');
  });

  it('exports the three prototype templates', async () => {
    const { BEAT_TEMPLATES } = await import('./BEAT_STRUCTURE');
    expect(BEAT_TEMPLATES.map((t) => t.id)).toEqual(['save-the-cat', 'three-act', 'heros-journey']);
    expect(BEAT_TEMPLATES.map((t) => t.name)).toEqual([
      'Save the Cat (3-Act)',
      'Three-Act Structure',
      'Hero’s Journey',
    ]);
  });

  it('every beat id is unique across ALL templates and carries a pct label', async () => {
    const { ALL_BEATS } = await import('./BEAT_STRUCTURE');
    const ids = ALL_BEATS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const beat of ALL_BEATS) expect(beat.pct).toMatch(/^\d+%$/);
  });

  it('getBeatTemplate falls back to Save the Cat for unknown ids', async () => {
    const { getBeatTemplate } = await import('./BEAT_STRUCTURE');
    expect(getBeatTemplate('nope').id).toBe('save-the-cat');
    expect(getBeatTemplate('three-act').id).toBe('three-act');
  });
});

// ─── BeatSheetSidebar (Beta 4 M14: controlled panel + templates) ───

function renderSidebar(over: Partial<Parameters<typeof BeatSheetSidebar>[0]> = {}) {
  const props = {
    scenes: [] as Scene[],
    assignments: {},
    templateId: 'save-the-cat' as const,
    onTemplateChange: vi.fn(),
    focusedBeatId: null,
    onBeatFocus: vi.fn(),
    onAssignScene: vi.fn(),
    ...over,
  };
  return { ...render(<BeatSheetSidebar {...props} />), props };
}

describe('BeatSheetSidebar', () => {
  it('renders the prototype header: Beat Sheet + mapped count', () => {
    renderSidebar();
    expect(screen.getByText('Beat Sheet')).toBeTruthy();
    expect(screen.getByText('0 / 15 mapped')).toBeTruthy();
  });

  it('sidebar landmark carries the active template name', () => {
    const { container } = renderSidebar();
    const aside = container.querySelector('aside');
    expect(aside?.getAttribute('aria-label')).toBe('Beat sheet — Save the Cat (3-Act)');
  });

  it('renders prototype act eyebrows and pct labels', () => {
    renderSidebar();
    expect(screen.getByText('ACT I — SETUP')).toBeTruthy();
    expect(screen.getByText('ACT II — CONFRONTATION')).toBeTruthy();
    expect(screen.getByText('ACT III — RESOLUTION')).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy(); // Midpoint
  });

  it('counts a beat as mapped and shows the assigned scene title on the row', () => {
    renderSidebar({
      scenes: [makeScene({ id: 's1', title: 'The Catalyst Scene' })],
      assignments: { s1: 'catalyst' },
    });
    expect(screen.getByText('1 / 15 mapped')).toBeTruthy();
    expect(
      screen.getByRole('progressbar', { name: /beats mapped/i }),
    ).toHaveAttribute('aria-valuenow', '1');
    expect(screen.getByText('The Catalyst Scene')).toBeTruthy();
    expect(document.querySelector('.beat-item__dot')).toBeTruthy();
  });

  it('template picker switches frameworks via onTemplateChange', () => {
    const onTemplateChange = vi.fn();
    renderSidebar({ onTemplateChange });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'heros-journey' } });
    expect(onTemplateChange).toHaveBeenCalledWith('heros-journey');
  });

  it('renders the selected template beats (Hero’s Journey → 8 beats)', () => {
    renderSidebar({ templateId: 'heros-journey' });
    expect(screen.getByText('0 / 8 mapped')).toBeTruthy();
    expect(screen.getByText('Ordinary World')).toBeTruthy();
    expect(screen.getByText('Return with the Elixir')).toBeTruthy();
    expect(screen.getByText(/Hero’s Journey structure — drag scenes onto beats/)).toBeTruthy();
  });

  it('dropping a dragged scene on a beat row maps it (onAssignScene)', () => {
    const onAssignScene = vi.fn();
    renderSidebar({
      scenes: [makeScene({ id: 's1' })],
      onAssignScene,
    });
    const row = screen.getByTestId('beat-item-midpoint');
    const dataTransfer = { getData: vi.fn(() => 's1'), dropEffect: '' };
    fireEvent.dragOver(row, { dataTransfer });
    fireEvent.drop(row, { dataTransfer });
    expect(onAssignScene).toHaveBeenCalledWith('s1', 'midpoint');
  });

  it('ignores drops that do not carry a known scene id', () => {
    const onAssignScene = vi.fn();
    renderSidebar({ scenes: [makeScene({ id: 's1' })], onAssignScene });
    const row = screen.getByTestId('beat-item-midpoint');
    fireEvent.drop(row, { dataTransfer: { getData: vi.fn(() => 'not-a-scene') } });
    expect(onAssignScene).not.toHaveBeenCalled();
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

// ─── Beta 4 M14 — grid card prototype parity ───

describe('SceneGrid cards (M14)', () => {
  afterEach(() => {
    localStorage.clear();
  });

  function renderGridStory(story: Story) {
    localStorage.setItem('mythos-msv-view-mode-v1', 'card');
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
  }

  it('titles cards "Scene N · <title>" (prototype 788)', () => {
    renderGridStory(
      makeStory([
        makeChapter([
          makeSceneWithId('sc1', 0, 'Alpha'),
          makeSceneWithId('sc2', 1, 'Beta'),
        ]),
      ]),
    );
    expect(screen.getByText('Scene 1 · Alpha')).toBeTruthy();
    expect(screen.getByText('Scene 2 · Beta')).toBeTruthy();
  });

  it('shows the POV label when scene metadata carries one', () => {
    const scene = { ...makeSceneWithId('sc1', 0, 'Alpha'), timelineMetadata: { pov: 'Mira' } };
    renderGridStory(makeStory([makeChapter([scene])]));
    expect(screen.getByText('POV Mira')).toBeTruthy();
  });

  it('the whole card is draggable (no grip handle, prototype cursor:grab)', () => {
    renderGridStory(makeStory([makeChapter([makeSceneWithId('sc1', 0, 'Alpha')])]));
    const card = screen.getByRole('option', { name: /Scene: Alpha/i });
    expect(card).toHaveAttribute('draggable', 'true');
    expect(document.querySelector('.scene-card__drag-handle')).toBeNull();
  });
});

// ─── Beta 4 M14 — list view drag parity ───

describe('ListView mouse drag (M14)', () => {
  beforeEach(() => {
    localStorage.setItem('mythos-msv-view-mode-v1', 'list');
  });

  afterEach(() => {
    localStorage.clear();
  });

  const TWO_CHAPTER_STORY: Story = makeStory([
    makeChapter([
      makeSceneWithId('sc1', 0, 'Scene Alpha'),
      makeSceneWithId('sc2', 1, 'Scene Beta'),
    ], 'ch1'),
    makeChapter([makeSceneWithId('sc3', 0, 'Scene Gamma')], 'ch2'),
  ]);

  it('rows are draggable and dropping on a row reorders within the chapter', () => {
    const onReorderScenes = vi.fn();
    render(
      <ManuscriptStructureView
        story={TWO_CHAPTER_STORY}
        onSelectScene={() => {}}
        onReorderScenes={onReorderScenes}
        onMoveScene={() => {}}
        onCreateScene={() => {}}
        onCreateChapter={() => {}}
        vaultRoot="test-vault"
      />,
    );

    const alpha = screen.getByRole('treeitem', { name: /Scene: Scene Alpha/i });
    const beta = screen.getByRole('treeitem', { name: /Scene: Scene Beta/i });
    expect(alpha).toHaveAttribute('draggable', 'true');

    const dataTransfer = { setData: vi.fn(), getData: vi.fn(() => 'sc2'), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(beta, { dataTransfer });
    fireEvent.dragOver(alpha, { dataTransfer });
    fireEvent.drop(alpha, { dataTransfer });

    expect(onReorderScenes).toHaveBeenCalledWith('st1', 'ch1', ['sc2', 'sc1']);
  });

  it('dropping a row on another chapter header moves the scene across chapters', () => {
    const onMoveScene = vi.fn();
    render(
      <ManuscriptStructureView
        story={TWO_CHAPTER_STORY}
        onSelectScene={() => {}}
        onReorderScenes={() => {}}
        onMoveScene={onMoveScene}
        onCreateScene={() => {}}
        onCreateChapter={() => {}}
        vaultRoot="test-vault"
      />,
    );

    const alpha = screen.getByRole('treeitem', { name: /Scene: Scene Alpha/i });
    const ch2Header = screen.getByText('CHAPTER 2').closest('.list-chapter__header')!;

    const dataTransfer = { setData: vi.fn(), getData: vi.fn(() => 'sc1'), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(alpha, { dataTransfer });
    fireEvent.dragOver(ch2Header, { dataTransfer });
    fireEvent.drop(ch2Header, { dataTransfer });

    expect(onMoveScene).toHaveBeenCalledWith('st1', 'sc1', 'ch1', 'ch2', null);
  });
});
