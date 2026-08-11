import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LeftRail, { DEFAULT_LEFT_SIDEBAR_LAYOUT } from './LeftRail';
import type { Story } from './types';

const mockStory: Story = {
  id: 'story-1',
  title: 'Test Story',
  path: '/test',
  genre: 'Fantasy',
  chapters: [
    {
      id: 'chapter-1',
      title: 'Chapter 1',
      path: '/test/ch1',
      order: 0,
      scenes: [
        {
          id: 'scene-1',
          title: 'Scene 1',
          path: '/test/ch1/s1',
          order: 0,
          blocks: [{ id: 'b1', type: 'prose', content: 'hello world', order: 0, updatedAt: '' }],
          createdAt: '',
          updatedAt: '',
        },
      ],
      createdAt: '',
      updatedAt: '',
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
  onSelectScene: vi.fn(),
  onSelectStory: vi.fn(),
  onCreateStory: vi.fn(),
  onCreateChapter: vi.fn(),
  onCreateScene: vi.fn(),
  sidebarCollapsed: false,
  onToggleCollapsed: vi.fn(),
};

// Mock window.api so StoryNavigator doesn't crash
Object.defineProperty(window, 'api', {
  value: undefined,
  writable: true,
});

describe('LeftRail (M6 three-zone sidebar)', () => {
  it('renders three zones when a story is selected', () => {
    const { container } = render(<LeftRail {...baseProps} />);
    expect(container.querySelector('.lr-story-card')).not.toBeNull();
    expect(container.querySelector('.lr-nav-zone')).not.toBeNull();
    expect(container.querySelector('.lr-project-footer')).not.toBeNull();
  });

  it('shows collapsed state with lr-expand-btn and no lr-story-card', () => {
    const { container } = render(<LeftRail {...baseProps} sidebarCollapsed={true} />);
    expect(container.querySelector('.left-rail--collapsed')).not.toBeNull();
    expect(container.querySelector('.lr-expand-btn')).not.toBeNull();
    expect(container.querySelector('.lr-story-card')).toBeNull();
  });

  it('calls onToggleCollapsed when collapse button is clicked', () => {
    const onToggle = vi.fn();
    render(<LeftRail {...baseProps} onToggleCollapsed={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /collapse left sidebar/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('calls onToggleCollapsed when expand button is clicked in collapsed state', () => {
    const onToggle = vi.fn();
    render(<LeftRail {...baseProps} sidebarCollapsed={true} onToggleCollapsed={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /expand left sidebar/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('shows story title and meta', () => {
    const { container } = render(<LeftRail {...baseProps} />);
    const card = container.querySelector('.lr-story-card');
    expect(card).not.toBeNull();
    expect(card!.querySelector('.lr-story-title')?.textContent).toBe('Test Story');
    expect(card!.querySelector('.lr-story-meta')?.textContent).toMatch(/Fantasy/);
    expect(card!.querySelector('.lr-story-meta')?.textContent).toMatch(/words/);
  });

  it('has no Add Panel button or panel controls in the DOM', () => {
    render(<LeftRail {...baseProps} />);
    expect(screen.queryByRole('button', { name: /add panel/i })).toBeNull();
    // No ⧉ float button
    expect(screen.queryByRole('button', { name: /float/i })).toBeNull();
    // No × remove button
    expect(document.querySelector('.lr-panel-remove-btn')).toBeNull();
  });

  it('shows STORY NAVIGATOR label', () => {
    render(<LeftRail {...baseProps} />);
    expect(screen.getByText('STORY NAVIGATOR')).toBeInTheDocument();
  });

  it('does not render lr-story-card when selectedStory is null', () => {
    const { container } = render(<LeftRail {...baseProps} selectedStory={null} />);
    expect(container.querySelector('.lr-story-card')).toBeNull();
  });

  it('DEFAULT_LEFT_SIDEBAR_LAYOUT has expected shape', () => {
    expect(DEFAULT_LEFT_SIDEBAR_LAYOUT.sidebarCollapsed).toBe(false);
    expect(DEFAULT_LEFT_SIDEBAR_LAYOUT.panels).toHaveLength(1);
    expect(DEFAULT_LEFT_SIDEBAR_LAYOUT.panels[0].id).toBe('stories');
  });
});
