/**
 * SKY-1699 (Wave 2e): SplitEditorPane unit tests.
 * Covers: pane label, empty state, focus indicator, click-to-focus, scene selector.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Scene, Chapter, Story } from './types';

// ── Mock BlockEditor — avoid TipTap initialization in jsdom ──────────────────

vi.mock('./BlockEditor', () => ({
  default: ({ scene }: { scene: Scene }) => (
    <div data-testid="mock-block-editor" data-scene-id={scene.id} />
  ),
}));

// ── Fixture helpers ──────────────────────────────────────────────────────────

function makeScene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'sc-1',
    title: 'Opening Scene',
    path: 'story/ch1/opening.md',
    order: 1,
    blocks: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Scene;
}

function makeChapter(scenes: Scene[] = []): Chapter {
  return { id: 'ch-1', title: 'Chapter One', order: 1, scenes } as Chapter;
}

function makeStory(chapters: Chapter[] = []): Story {
  return { id: 'st-1', title: 'My Story', chapters } as Story;
}

// ── Default prop factory ─────────────────────────────────────────────────────

function defaultProps(overrides: Partial<Parameters<typeof SplitEditorPane>[0]> = {}) {
  const scene = makeScene();
  const chapter = makeChapter([scene]);
  const story = makeStory([chapter]);

  return {
    paneNumber: 1 as const,
    isFocused: false,
    scene,
    chapter,
    story,
    stories: [story],
    onFocus: vi.fn(),
    onSelectScene: vi.fn(),
    onBlocksChange: vi.fn(),
    onEditorReady: vi.fn(),
    ...overrides,
  };
}

import SplitEditorPane from './SplitEditorPane';

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Pane label ───────────────────────────────────────────────────────────────

describe('pane label', () => {
  it('shows "Pane 1" for paneNumber=1', () => {
    render(<SplitEditorPane {...defaultProps({ paneNumber: 1 })} />);
    expect(screen.getByText('Pane 1')).toBeDefined();
  });

  it('shows "Pane 2" for paneNumber=2', () => {
    render(<SplitEditorPane {...defaultProps({ paneNumber: 2 })} />);
    expect(screen.getByText('Pane 2')).toBeDefined();
  });
});

// ── Focus indicator (AC-S-04) ────────────────────────────────────────────────

describe('focus indicator', () => {
  it('does not add focused class when isFocused=false', () => {
    const { container } = render(<SplitEditorPane {...defaultProps({ isFocused: false })} />);
    const pane = container.querySelector('[data-testid="split-pane-1"]')!;
    expect(pane.className).not.toContain('spe-pane--focused');
  });

  it('adds focused class when isFocused=true', () => {
    const { container } = render(<SplitEditorPane {...defaultProps({ isFocused: true })} />);
    const pane = container.querySelector('[data-testid="split-pane-1"]')!;
    expect(pane.className).toContain('spe-pane--focused');
  });

  it('shows focused badge only when focused', () => {
    const { rerender } = render(<SplitEditorPane {...defaultProps({ isFocused: false })} />);
    expect(screen.queryByText('●')).toBeNull();

    rerender(<SplitEditorPane {...defaultProps({ isFocused: true })} />);
    expect(screen.getByText('●')).toBeDefined();
  });
});

// ── Empty state (no scene) ────────────────────────────────────────────────────

describe('empty state', () => {
  it('renders empty prompt when no scene is selected', () => {
    render(<SplitEditorPane {...defaultProps({ scene: null })} />);
    expect(screen.getByText(/Select a scene from your story to start writing/)).toBeDefined();
    expect(screen.queryByTestId('mock-block-editor')).toBeNull();
  });
});

// ── BlockEditor (scene present) ───────────────────────────────────────────────

describe('with scene', () => {
  it('renders BlockEditor when a scene is provided', () => {
    render(<SplitEditorPane {...defaultProps()} />);
    expect(screen.getByTestId('mock-block-editor')).toBeDefined();
  });

  it('passes scene.id to BlockEditor', () => {
    const scene = makeScene({ id: 'custom-sc' });
    render(<SplitEditorPane {...defaultProps({ scene })} />);
    expect(screen.getByTestId('mock-block-editor').getAttribute('data-scene-id')).toBe('custom-sc');
  });
});

// ── Click-to-focus (AC-S-05) ─────────────────────────────────────────────────

describe('click-to-focus', () => {
  it('calls onFocus when content area is clicked', () => {
    const onFocus = vi.fn();
    const { container } = render(<SplitEditorPane {...defaultProps({ onFocus })} />);
    const content = container.querySelector('.spe-content')!;
    fireEvent.click(content);
    expect(onFocus).toHaveBeenCalledOnce();
  });
});

// ── Scene selector popover ────────────────────────────────────────────────────

describe('scene selector', () => {
  it('shows current scene title in the selector button', () => {
    render(<SplitEditorPane {...defaultProps()} />);
    expect(screen.getByTestId('spe-scene-btn').textContent).toContain('Opening Scene');
  });

  it('shows placeholder when no scene selected', () => {
    render(<SplitEditorPane {...defaultProps({ scene: null })} />);
    expect(screen.getByTestId('spe-scene-btn').textContent).toContain('Select scene');
  });

  it('opens popover on button click', () => {
    render(<SplitEditorPane {...defaultProps()} />);
    expect(screen.queryByTestId('spe-scene-search')).toBeNull();
    fireEvent.click(screen.getByTestId('spe-scene-btn'));
    expect(screen.getByTestId('spe-scene-search')).toBeDefined();
  });

  it('filters scenes by query', () => {
    const sc1 = makeScene({ id: 'sc-1', title: 'Alpha Scene' });
    const sc2 = makeScene({ id: 'sc-2', title: 'Beta Scene', path: 'story/ch1/beta.md' });
    const ch = makeChapter([sc1, sc2]);
    const st = makeStory([ch]);

    render(
      <SplitEditorPane
        {...defaultProps({ scene: sc1, chapter: ch, story: st, stories: [st] })}
      />,
    );

    fireEvent.click(screen.getByTestId('spe-scene-btn'));
    const search = screen.getByTestId('spe-scene-search');
    fireEvent.change(search, { target: { value: 'beta' } });

    expect(screen.queryByTestId(`spe-scene-option-sc-1`)).toBeNull();
    expect(screen.getByTestId(`spe-scene-option-sc-2`)).toBeDefined();
  });

  it('calls onSelectScene and closes popover when a scene is clicked', () => {
    const sc1 = makeScene({ id: 'sc-1', title: 'Alpha Scene' });
    const sc2 = makeScene({ id: 'sc-2', title: 'Beta Scene', path: 'story/ch1/beta.md' });
    const ch = makeChapter([sc1, sc2]);
    const st = makeStory([ch]);
    const onSelectScene = vi.fn();

    render(
      <SplitEditorPane
        {...defaultProps({ scene: sc1, chapter: ch, story: st, stories: [st], onSelectScene })}
      />,
    );

    fireEvent.click(screen.getByTestId('spe-scene-btn'));
    fireEvent.click(screen.getByTestId('spe-scene-option-sc-2'));

    expect(onSelectScene).toHaveBeenCalledWith(sc2, ch, st);
    expect(screen.queryByTestId('spe-scene-search')).toBeNull();
  });

  it('marks the currently selected scene as selected in the list', () => {
    const sc = makeScene({ id: 'sc-active' });
    const ch = makeChapter([sc]);
    const st = makeStory([ch]);

    render(<SplitEditorPane {...defaultProps({ scene: sc, chapter: ch, story: st, stories: [st] })} />);
    fireEvent.click(screen.getByTestId('spe-scene-btn'));

    const option = screen.getByTestId('spe-scene-option-sc-active');
    expect(option.className).toContain('spe-scene-option--selected');
  });
});
