import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import LeftRail from './LeftRail';
import type { Story } from './types';

const noop = vi.fn();

const mockStory: Story = {
  id: 's1',
  title: 'The Great Novel',
  genre: 'Fantasy',
  path: '/stories/s1',
  chapters: [
    {
      id: 'c1',
      title: 'Chapter One',
      order: 0,
      path: '/chapters/c1',
      createdAt: '',
      updatedAt: '',
      scenes: [
        { id: 'sc1', title: 'Opening', path: '/scenes/sc1', blocks: [{ id: 'b1', type: 'prose' as const, content: 'Hello world', order: 0, updatedAt: '' }], order: 0, draftState: 'in-progress', createdAt: '', updatedAt: '' },
      ],
    },
  ],
  createdAt: '',
  updatedAt: '',
};

const baseProps = {
  stories: [mockStory],
  selectedStory: mockStory,
  selectedScene: null,
  selectedSceneId: null,
  onSelectScene: noop,
  onSelectStory: noop,
  onCreateStory: noop,
  onCreateChapter: noop,
  onCreateScene: noop,
  sidebarCollapsed: false,
  onToggleCollapsed: noop,
};

// Mock window.api for StoryNavigator
vi.stubGlobal('api', {});

describe('LeftRail M6 — three-zone layout', () => {
  it('renders the story card zone when a story is selected', () => {
    render(<LeftRail {...baseProps} />);
    expect(screen.getByTestId('lr-story-card')).toBeInTheDocument();
    // Title appears in story card heading (zone 1) and StoryNavigator tree (zone 2) — use heading role
    expect(screen.getByRole('heading', { name: 'The Great Novel' })).toBeInTheDocument();
    expect(screen.getByText(/Fantasy/)).toBeInTheDocument();
  });

  it('renders the STORY NAVIGATOR label', () => {
    render(<LeftRail {...baseProps} />);
    expect(screen.getByText('STORY NAVIGATOR')).toBeInTheDocument();
    expect(screen.getByTestId('lr-nav-zone')).toBeInTheDocument();
  });

  it('renders the project footer zone', () => {
    render(<LeftRail {...baseProps} />);
    expect(screen.getByTestId('lr-project-footer')).toBeInTheDocument();
    expect(screen.getByText('Words')).toBeInTheDocument();
    expect(screen.getByText('Scenes')).toBeInTheDocument();
    expect(screen.getByText('On Track')).toBeInTheDocument();
  });

  it('shows expand button and hides content when sidebarCollapsed', () => {
    render(<LeftRail {...baseProps} sidebarCollapsed />);
    expect(screen.getByTestId('left-rail-collapsed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /expand left sidebar/i })).toBeInTheDocument();
    expect(screen.queryByTestId('lr-story-card')).not.toBeInTheDocument();
  });

  it('calls onToggleCollapsed when collapse button is clicked', () => {
    const onToggle = vi.fn();
    render(<LeftRail {...baseProps} onToggleCollapsed={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /collapse left sidebar/i }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('calls onToggleCollapsed when expand button is clicked from collapsed state', () => {
    const onToggle = vi.fn();
    render(<LeftRail {...baseProps} sidebarCollapsed onToggleCollapsed={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /expand left sidebar/i }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('has no panel controls — no Add Panel, no drag handles, no float buttons', () => {
    render(<LeftRail {...baseProps} />);
    expect(screen.queryByText(/add panel/i)).not.toBeInTheDocument();
    expect(screen.queryByText('⧉')).not.toBeInTheDocument();
    expect(screen.queryByText('⊞')).not.toBeInTheDocument();
  });

  it('renders no story card when no story selected', () => {
    render(<LeftRail {...baseProps} selectedStory={null} />);
    expect(screen.queryByTestId('lr-story-card')).not.toBeInTheDocument();
  });
});
