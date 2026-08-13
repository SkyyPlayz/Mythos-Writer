import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import StoryNavigator from './StoryNavigator';
import { SCENE_NOTE_DRAG_MIME } from './sceneNotes';
import type { Story, Chapter, Scene } from './types';

const scene1: Scene = {
  id: 'sc1', title: 'Scene One', path: 'stories/st1/chapters/ch1/scenes/sc1.md',
  order: 0, chapterId: 'ch1', storyId: 'st1', blocks: [], draftState: 'in-progress',
  createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
};
const scene2: Scene = {
  id: 'sc2', title: 'Scene Two', path: 'stories/st1/chapters/ch1/scenes/sc2.md',
  order: 1, chapterId: 'ch1', storyId: 'st1', blocks: [], draftState: 'review',
  createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
};
const chapter1: Chapter = {
  id: 'ch1', title: 'Chapter One', path: 'stories/st1/chapters/ch1',
  order: 0, scenes: [scene1, scene2],
  createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
};
const story1: Story = {
  id: 'st1', title: 'My Story', path: 'stories/st1',
  chapters: [chapter1],
  createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
};

const makeProps = (overrides = {}) => ({
  stories: [story1],
  selectedSceneId: null,
  onSelectScene: vi.fn(),
  onCreateStory: vi.fn(),
  onCreateChapter: vi.fn(),
  onCreateScene: vi.fn(),
  onReorderScenes: vi.fn(),
  ...overrides,
});

describe('StoryNavigator', () => {
  it('renders story, chapter, and scenes from fixture manifest', () => {
    render(<StoryNavigator {...makeProps()} />);
    expect(screen.getByText('My Story')).toBeInTheDocument();
    expect(screen.getByText('Chapter One')).toBeInTheDocument();
    expect(screen.getByText('Scene 1 · Scene One')).toBeInTheDocument();
    expect(screen.getByText('Scene 2 · Scene Two')).toBeInTheDocument();
  });

  it('does not reorder the passed-in chapters array during render', () => {
    const laterChapter: Chapter = { ...chapter1, id: 'ch-later', title: 'Later Chapter', order: 1, scenes: [] };
    const earlierChapter: Chapter = { ...chapter1, id: 'ch-earlier', title: 'Earlier Chapter', order: 0, scenes: [] };
    const story: Story = {
      ...story1,
      chapters: [laterChapter, earlierChapter],
    };
    const originalChapterIds = story.chapters.map((chapter) => chapter.id);

    render(<StoryNavigator {...makeProps({ stories: [story] })} />);

    expect(story.chapters.map((chapter) => chapter.id)).toEqual(originalChapterIds);
  });

  // M6 (SKY-9022): the status dot replaced the nav-draft-badge text badge.
  it('renders a status dot per scene and no draft badge', () => {
    const { container } = render(<StoryNavigator {...makeProps()} />);
    expect(container.querySelectorAll('.nav-status-dot')).toHaveLength(2);
    expect(container.querySelector('.nav-draft-badge')).toBeNull();
    expect(screen.queryByText('review')).not.toBeInTheDocument();
    // in-progress → draft styling; a read-only span without onCycleSceneStatus.
    const dot = screen.getByLabelText('Scene status: Drafting');
    expect(dot.tagName).toBe('SPAN');
    expect(dot).toHaveClass('nav-status-dot--draft');
  });

  it('status dot is a button that cycles the scene status without selecting the row', () => {
    const onCycleSceneStatus = vi.fn();
    const onSelectScene = vi.fn();
    render(<StoryNavigator {...makeProps({ onCycleSceneStatus, onSelectScene })} />);
    const dot = screen.getByRole('button', { name: 'Scene status: Drafting — click to cycle' });
    expect(dot).toHaveAttribute('title', 'Click to cycle status');
    fireEvent.click(dot);
    expect(onCycleSceneStatus).toHaveBeenCalledWith('sc1');
    expect(onSelectScene).not.toHaveBeenCalled();
  });

  it('maps draftState final onto the done dot', () => {
    const doneScene: Scene = { ...scene1, id: 'sc-done', title: 'Done Scene', draftState: 'final' };
    const story: Story = { ...story1, chapters: [{ ...chapter1, scenes: [doneScene] }] };
    render(<StoryNavigator {...makeProps({ stories: [story], onCycleSceneStatus: vi.fn() })} />);
    const dot = screen.getByRole('button', { name: 'Scene status: Complete — click to cycle' });
    expect(dot).toHaveClass('nav-status-dot--done');
  });

  // M6 (SKY-9022): LeftRail provides the STORY NAVIGATOR header, so it hides
  // the internal one; other consumers keep it by default.
  it('hides the internal Stories header when hideHeader is set', () => {
    const { container } = render(<StoryNavigator {...makeProps({ hideHeader: true })} />);
    expect(container.querySelector('.nav-header')).toBeNull();
    expect(screen.queryByText('Stories')).not.toBeInTheDocument();
    // The tree itself still renders.
    expect(screen.getByText('My Story')).toBeInTheDocument();
  });

  it('renders the internal Stories header by default', () => {
    const { container } = render(<StoryNavigator {...makeProps()} />);
    expect(container.querySelector('.nav-header')).not.toBeNull();
    expect(screen.getByText('Stories')).toBeInTheDocument();
  });

  // M6 (SKY-9022): selecting a scene elsewhere reveals it — its chapter
  // re-expands (additively) and the row renders active.
  it('reveals the selected scene inside a collapsed chapter', () => {
    const props = makeProps();
    const { rerender } = render(<StoryNavigator {...props} />);
    fireEvent.click(screen.getByText('Chapter One'));
    expect(screen.queryByText('Scene 1 · Scene One')).not.toBeInTheDocument();

    rerender(<StoryNavigator {...props} selectedSceneId="sc1" />);
    const row = screen.getByText('Scene 1 · Scene One').closest('.nav-scene-row');
    expect(row).toHaveClass('active');
  });

  it('a deliberate collapse after the reveal sticks (ref-guarded, additive only)', () => {
    const props = makeProps();
    const { rerender } = render(<StoryNavigator {...props} />);
    rerender(<StoryNavigator {...props} selectedSceneId="sc1" />);
    expect(screen.getByText('Scene 1 · Scene One')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Chapter One'));
    expect(screen.queryByText('Scene 1 · Scene One')).not.toBeInTheDocument();
    // Same selection re-rendering must not force the chapter back open…
    rerender(<StoryNavigator {...props} selectedSceneId="sc1" />);
    expect(screen.queryByText('Scene 1 · Scene One')).not.toBeInTheDocument();
    // …but a new selection reveals again.
    rerender(<StoryNavigator {...props} selectedSceneId="sc2" />);
    expect(screen.getByText('Scene 2 · Scene Two').closest('.nav-scene-row')).toHaveClass('active');
  });

  it('reveals the selected scene through the parts render path', () => {
    const partScene: Scene = { ...scene1, id: 'sc-p1', title: 'Part Scene' };
    const partChapter: Chapter = { ...chapter1, id: 'ch-p1', title: 'Part Chapter', scenes: [partScene] };
    const partedStory: Story = {
      ...story1,
      id: 'st2',
      title: 'Parted Story',
      chapters: [partChapter],
      parts: [{ id: 'p1', title: 'Part One', order: 0, note: [], chapters: [partChapter], createdAt: '', updatedAt: '' }],
    };
    const props = makeProps({ stories: [partedStory] });
    const { rerender } = render(<StoryNavigator {...props} />);
    fireEvent.click(screen.getByText(/Part 1: Part One/));
    expect(screen.queryByText('Scene 1 · Part Scene')).not.toBeInTheDocument();

    rerender(<StoryNavigator {...props} selectedSceneId="sc-p1" />);
    expect(screen.getByText('Scene 1 · Part Scene').closest('.nav-scene-row')).toHaveClass('active');
  });

  it('calls onSelectScene with correct scene/chapter/story when a scene is clicked', () => {
    const onSelectScene = vi.fn();
    render(<StoryNavigator {...makeProps({ onSelectScene })} />);
    fireEvent.click(screen.getByText('Scene 1 · Scene One'));
    expect(onSelectScene).toHaveBeenCalledTimes(1);
    expect(onSelectScene).toHaveBeenCalledWith(scene1, chapter1, story1);
  });

  it('marks the active scene row', () => {
    render(<StoryNavigator {...makeProps({ selectedSceneId: 'sc1' })} />);
    const row = screen.getByText('Scene 1 · Scene One').closest('.nav-scene-row');
    expect(row).toHaveClass('active');
  });

  it('calls onCreateScene when the add-scene button is clicked', () => {
    const onCreateScene = vi.fn();
    render(<StoryNavigator {...makeProps({ onCreateScene })} />);
    const addSceneBtns = screen.getAllByTitle('Add scene');
    fireEvent.click(addSceneBtns[0]);
    expect(onCreateScene).toHaveBeenCalledWith('st1', 'ch1');
  });

  it('calls onCreateChapter when the add-chapter button is clicked', () => {
    const onCreateChapter = vi.fn();
    render(<StoryNavigator {...makeProps({ onCreateChapter })} />);
    fireEvent.click(screen.getByTitle('Add chapter'));
    expect(onCreateChapter).toHaveBeenCalledWith('st1');
  });

  it('collapses and expands chapter on click', () => {
    render(<StoryNavigator {...makeProps()} />);
    expect(screen.getByText('Scene 1 · Scene One')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Chapter One'));
    expect(screen.queryByText('Scene 1 · Scene One')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Chapter One'));
    expect(screen.getByText('Scene 1 · Scene One')).toBeInTheDocument();
  });

  it('calls onReorderScenes when a scene is dropped onto another scene', () => {
    const onReorderScenes = vi.fn();
    render(<StoryNavigator {...makeProps({ onReorderScenes })} />);

    const sceneOneRow = screen.getByText('Scene 1 · Scene One').closest('.nav-scene-row')!;
    const sceneTwoRow = screen.getByText('Scene 2 · Scene Two').closest('.nav-scene-row')!;

    fireEvent.dragStart(sceneOneRow);
    fireEvent.dragOver(sceneTwoRow);
    fireEvent.drop(sceneTwoRow);

    expect(onReorderScenes).toHaveBeenCalledWith('st1', 'ch1', ['sc2', 'sc1']);
  });

  it('shows empty state when no stories', () => {
    render(<StoryNavigator {...makeProps({ stories: [] })} />);
    expect(screen.getByText(/no stories yet/i)).toBeInTheDocument();
  });

  it('calls onCreateStory when the header + button is clicked', () => {
    const onCreateStory = vi.fn();
    render(<StoryNavigator {...makeProps({ onCreateStory })} />);
    fireEvent.click(screen.getByTitle('New story'));
    expect(onCreateStory).toHaveBeenCalled();
  });

  it('shows a New Story button in the empty state and calls onCreateStory when clicked', () => {
    const onCreateStory = vi.fn();
    render(<StoryNavigator {...makeProps({ stories: [], onCreateStory })} />);
    const cta = screen.getByTestId('nav-empty-cta');
    expect(cta).toBeInTheDocument();
    fireEvent.click(cta);
    expect(onCreateStory).toHaveBeenCalled();
  });

  it('moves scene up when ArrowUp is pressed on a non-first scene', () => {
    const onReorderScenes = vi.fn();
    render(<StoryNavigator {...makeProps({ onReorderScenes })} />);
    const sceneTwoRow = screen.getByText('Scene 2 · Scene Two').closest('.nav-scene-row')!;
    fireEvent.keyDown(sceneTwoRow, { key: 'ArrowUp' });
    expect(onReorderScenes).toHaveBeenCalledWith('st1', 'ch1', ['sc2', 'sc1']);
  });

  it('moves scene down when ArrowDown is pressed on a non-last scene', () => {
    const onReorderScenes = vi.fn();
    render(<StoryNavigator {...makeProps({ onReorderScenes })} />);
    const sceneOneRow = screen.getByText('Scene 1 · Scene One').closest('.nav-scene-row')!;
    fireEvent.keyDown(sceneOneRow, { key: 'ArrowDown' });
    expect(onReorderScenes).toHaveBeenCalledWith('st1', 'ch1', ['sc2', 'sc1']);
  });

  it('does not call onReorderScenes when ArrowUp is pressed on the first scene', () => {
    const onReorderScenes = vi.fn();
    render(<StoryNavigator {...makeProps({ onReorderScenes })} />);
    const sceneOneRow = screen.getByText('Scene 1 · Scene One').closest('.nav-scene-row')!;
    fireEvent.keyDown(sceneOneRow, { key: 'ArrowUp' });
    expect(onReorderScenes).not.toHaveBeenCalled();
  });

  it('does not call onReorderScenes when ArrowDown is pressed on the last scene', () => {
    const onReorderScenes = vi.fn();
    render(<StoryNavigator {...makeProps({ onReorderScenes })} />);
    const sceneTwoRow = screen.getByText('Scene 2 · Scene Two').closest('.nav-scene-row')!;
    fireEvent.keyDown(sceneTwoRow, { key: 'ArrowDown' });
    expect(onReorderScenes).not.toHaveBeenCalled();
  });

  it('selects scene on Enter key, no reorder', () => {
    const onSelectScene = vi.fn();
    const onReorderScenes = vi.fn();
    render(<StoryNavigator {...makeProps({ onSelectScene, onReorderScenes })} />);
    const sceneOneRow = screen.getByText('Scene 1 · Scene One').closest('.nav-scene-row')!;
    fireEvent.keyDown(sceneOneRow, { key: 'Enter' });
    expect(onSelectScene).toHaveBeenCalledWith(scene1, chapter1, story1);
    expect(onReorderScenes).not.toHaveBeenCalled();
  });

  // M9b (SKY-9823): scene-note drag-promote drop target
  describe('scene-note drop (promote to vault)', () => {
    const payload = { sceneId: 'sc1', index: 0, text: 'Check the tide tables.' };
    const noteDataTransfer = () => ({
      types: [SCENE_NOTE_DRAG_MIME],
      getData: vi.fn().mockReturnValue(JSON.stringify(payload)),
      dropEffect: '',
    });

    it('highlights on dragover and promotes the payload on drop', () => {
      const onPromoteSceneNote = vi.fn();
      const { container } = render(<StoryNavigator {...makeProps({ onPromoteSceneNote })} />);
      const nav = container.querySelector('.story-navigator')!;
      fireEvent.dragOver(nav, { dataTransfer: noteDataTransfer() });
      expect(nav.className).toContain('story-navigator--note-drop');
      fireEvent.drop(nav, { dataTransfer: noteDataTransfer() });
      expect(onPromoteSceneNote).toHaveBeenCalledWith(payload);
      expect(nav.className).not.toContain('story-navigator--note-drop');
    });

    it('a note dropped on a scene row still promotes and never reorders', () => {
      const onPromoteSceneNote = vi.fn();
      const onReorderScenes = vi.fn();
      render(<StoryNavigator {...makeProps({ onPromoteSceneNote, onReorderScenes })} />);
      const sceneOneRow = screen.getByText('Scene 1 · Scene One').closest('.nav-scene-row')!;
      fireEvent.drop(sceneOneRow, { dataTransfer: noteDataTransfer() });
      expect(onPromoteSceneNote).toHaveBeenCalledWith(payload);
      expect(onReorderScenes).not.toHaveBeenCalled();
    });

    it('ignores drags without the scene-note MIME', () => {
      const onPromoteSceneNote = vi.fn();
      const { container } = render(<StoryNavigator {...makeProps({ onPromoteSceneNote })} />);
      const nav = container.querySelector('.story-navigator')!;
      const dt = { types: ['text/plain'], getData: vi.fn(), dropEffect: '' };
      fireEvent.dragOver(nav, { dataTransfer: dt });
      expect(nav.className).not.toContain('story-navigator--note-drop');
      fireEvent.drop(nav, { dataTransfer: dt });
      expect(onPromoteSceneNote).not.toHaveBeenCalled();
    });

    it('ignores a malformed payload', () => {
      const onPromoteSceneNote = vi.fn();
      const { container } = render(<StoryNavigator {...makeProps({ onPromoteSceneNote })} />);
      const nav = container.querySelector('.story-navigator')!;
      const dt = { types: [SCENE_NOTE_DRAG_MIME], getData: vi.fn().mockReturnValue('not json'), dropEffect: '' };
      fireEvent.drop(nav, { dataTransfer: dt });
      expect(onPromoteSceneNote).not.toHaveBeenCalled();
    });
  });
});
