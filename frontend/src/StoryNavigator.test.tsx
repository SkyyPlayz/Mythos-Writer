import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import StoryNavigator from './StoryNavigator';
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
    expect(screen.getByText('Scene One')).toBeInTheDocument();
    expect(screen.getByText('Scene Two')).toBeInTheDocument();
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

  it('shows draft badge for non-in-progress scenes', () => {
    render(<StoryNavigator {...makeProps()} />);
    expect(screen.getByText('review')).toBeInTheDocument();
  });

  it('calls onSelectScene with correct scene/chapter/story when a scene is clicked', () => {
    const onSelectScene = vi.fn();
    render(<StoryNavigator {...makeProps({ onSelectScene })} />);
    fireEvent.click(screen.getByText('Scene One'));
    expect(onSelectScene).toHaveBeenCalledTimes(1);
    expect(onSelectScene).toHaveBeenCalledWith(scene1, chapter1, story1);
  });

  it('marks the active scene row', () => {
    render(<StoryNavigator {...makeProps({ selectedSceneId: 'sc1' })} />);
    const row = screen.getByText('Scene One').closest('.nav-scene-row');
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
    expect(screen.getByText('Scene One')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Chapter One'));
    expect(screen.queryByText('Scene One')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Chapter One'));
    expect(screen.getByText('Scene One')).toBeInTheDocument();
  });

  it('calls onReorderScenes when a scene is dropped onto another scene', () => {
    const onReorderScenes = vi.fn();
    render(<StoryNavigator {...makeProps({ onReorderScenes })} />);

    const sceneOneRow = screen.getByText('Scene One').closest('.nav-scene-row')!;
    const sceneTwoRow = screen.getByText('Scene Two').closest('.nav-scene-row')!;

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
    const sceneTwoRow = screen.getByText('Scene Two').closest('.nav-scene-row')!;
    fireEvent.keyDown(sceneTwoRow, { key: 'ArrowUp' });
    expect(onReorderScenes).toHaveBeenCalledWith('st1', 'ch1', ['sc2', 'sc1']);
  });

  it('moves scene down when ArrowDown is pressed on a non-last scene', () => {
    const onReorderScenes = vi.fn();
    render(<StoryNavigator {...makeProps({ onReorderScenes })} />);
    const sceneOneRow = screen.getByText('Scene One').closest('.nav-scene-row')!;
    fireEvent.keyDown(sceneOneRow, { key: 'ArrowDown' });
    expect(onReorderScenes).toHaveBeenCalledWith('st1', 'ch1', ['sc2', 'sc1']);
  });

  it('does not call onReorderScenes when ArrowUp is pressed on the first scene', () => {
    const onReorderScenes = vi.fn();
    render(<StoryNavigator {...makeProps({ onReorderScenes })} />);
    const sceneOneRow = screen.getByText('Scene One').closest('.nav-scene-row')!;
    fireEvent.keyDown(sceneOneRow, { key: 'ArrowUp' });
    expect(onReorderScenes).not.toHaveBeenCalled();
  });

  it('does not call onReorderScenes when ArrowDown is pressed on the last scene', () => {
    const onReorderScenes = vi.fn();
    render(<StoryNavigator {...makeProps({ onReorderScenes })} />);
    const sceneTwoRow = screen.getByText('Scene Two').closest('.nav-scene-row')!;
    fireEvent.keyDown(sceneTwoRow, { key: 'ArrowDown' });
    expect(onReorderScenes).not.toHaveBeenCalled();
  });

  it('selects scene on Enter key, no reorder', () => {
    const onSelectScene = vi.fn();
    const onReorderScenes = vi.fn();
    render(<StoryNavigator {...makeProps({ onSelectScene, onReorderScenes })} />);
    const sceneOneRow = screen.getByText('Scene One').closest('.nav-scene-row')!;
    fireEvent.keyDown(sceneOneRow, { key: 'Enter' });
    expect(onSelectScene).toHaveBeenCalledWith(scene1, chapter1, story1);
    expect(onReorderScenes).not.toHaveBeenCalled();
  });
});
