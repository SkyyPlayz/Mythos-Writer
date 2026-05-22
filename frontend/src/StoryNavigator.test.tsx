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
});
