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

// ── Mock EntityBrowser — SKY-9920: SplitEditorPane just needs to know it
// rendered EntityBrowser with the right props, not exercise its internals
// (which have their own component behavior, not this pane's responsibility).
vi.mock('./EntityBrowser', () => ({
  default: ({ selectedEntityId }: { onSelectEntity: () => void; selectedEntityId: string | null }) => (
    <div data-testid="mock-entity-browser" data-selected-entity-id={selectedEntityId ?? ''} />
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

// ── SKY-8907: per-pane tab strip ──────────────────────────────────────────────

describe('per-pane tab strip', () => {
  it('renders no tab strip when the tabs prop is omitted (back-compat)', () => {
    render(<SplitEditorPane {...defaultProps()} />);
    expect(screen.queryByTestId('split-pane-1-tab-strip')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('renders a tab strip above the pane header when tabs are provided', () => {
    const tab: WorkspaceTab = { id: 't1', kind: 'scene', title: 'Opening Scene', icon: '📄', docId: 'sc-1' };
    render(<SplitEditorPane {...defaultProps({ tabs: [tab], activeTabId: 't1' })} />);
    expect(screen.getByTestId('split-pane-1-tab-strip')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Opening Scene' })).toBeInTheDocument();
  });

  it('allows closing the strip down to its last tab (per-pane strips collapse instead of orphaning)', () => {
    const tab: WorkspaceTab = { id: 't1', kind: 'scene', title: 'Opening Scene', icon: '📄', docId: 'sc-1' };
    const onTabClose = vi.fn();
    render(<SplitEditorPane {...defaultProps({ tabs: [tab], activeTabId: 't1', onTabClose })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close Opening Scene' }));
    expect(onTabClose).toHaveBeenCalledWith('t1');
  });

  it('calls onNewTab when the strip + button is clicked', () => {
    const onNewTab = vi.fn();
    render(<SplitEditorPane {...defaultProps({ tabs: [], activeTabId: null, onNewTab })} />);
    fireEvent.click(screen.getByTestId('wtb-new-tab-btn'));
    expect(onNewTab).toHaveBeenCalledOnce();
  });

  it('marks the strip as a drop target and calls onTabStripDrop when acceptsTabDrop', () => {
    const onTabStripDrop = vi.fn();
    render(
      <SplitEditorPane
        {...defaultProps({ tabs: [], activeTabId: null, acceptsTabDrop: true, onTabStripDrop })}
      />,
    );
    const strip = screen.getByTestId('split-pane-1-tab-strip');
    expect(strip.className).toContain('spe-tab-strip--drop-target');
    fireEvent.drop(strip);
    expect(onTabStripDrop).toHaveBeenCalledOnce();
  });

  it('does not call onTabStripDrop when this pane is not an accepted drop target', () => {
    const onTabStripDrop = vi.fn();
    render(
      <SplitEditorPane
        {...defaultProps({ tabs: [], activeTabId: null, acceptsTabDrop: false, onTabStripDrop })}
      />,
    );
    fireEvent.drop(screen.getByTestId('split-pane-1-tab-strip'));
    expect(onTabStripDrop).not.toHaveBeenCalled();
  });
});

// ── SKY-8907: empty-pane action card wiring ───────────────────────────────────

describe('empty-pane action card', () => {
  it('wires onCreateNewDoc into the "Create new scene" action', () => {
    const onCreateNewDoc = vi.fn();
    render(<SplitEditorPane {...defaultProps({ scene: null, onCreateNewDoc })} />);
    fireEvent.click(screen.getByTestId('se-empty-action-create'));
    expect(onCreateNewDoc).toHaveBeenCalledOnce();
  });

  it('wires onCloseEmptyPane into the "Close" action', () => {
    const onCloseEmptyPane = vi.fn();
    render(<SplitEditorPane {...defaultProps({ scene: null, onCloseEmptyPane })} />);
    fireEvent.click(screen.getByTestId('se-empty-action-close'));
    expect(onCloseEmptyPane).toHaveBeenCalledOnce();
  });

  it('"Go to scene" opens the same scene picker popover as the header button', () => {
    render(<SplitEditorPane {...defaultProps({ scene: null })} />);
    expect(screen.queryByTestId('spe-scene-search')).toBeNull();
    fireEvent.click(screen.getByTestId('se-empty-action-goto'));
    expect(screen.getByTestId('spe-scene-search')).toBeInTheDocument();
  });

  it('does not render an action card while loading', () => {
    render(<SplitEditorPane {...defaultProps({ scene: null, sceneLoading: true, onCreateNewDoc: vi.fn() })} />);
    expect(screen.queryByTestId('scene-editor-empty-actions')).toBeNull();
  });
});

// ── SKY-9342: per-pane ⋮ menu ──────────────────────────────────────────────────

describe('per-pane ⋮ menu', () => {
  const tab = (): WorkspaceTab => ({ id: 't1', kind: 'scene', title: 'Scene A', icon: '📄', docId: 's1' });

  it('renders no pane menu button when neither onClosePane nor onSplitPane is provided', () => {
    render(<SplitEditorPane {...defaultProps({ tabs: [tab()], activeTabId: 't1' })} />);
    expect(screen.queryByTestId('split-pane-1-pane-menu-btn')).toBeNull();
  });

  it('renders the pane menu button when onClosePane is provided', () => {
    render(<SplitEditorPane {...defaultProps({ tabs: [tab()], activeTabId: 't1', onClosePane: vi.fn() })} />);
    expect(screen.getByTestId('split-pane-1-pane-menu-btn')).toBeInTheDocument();
  });

  it('toggles the pane menu on button click', () => {
    render(<SplitEditorPane {...defaultProps({ tabs: [tab()], activeTabId: 't1', onClosePane: vi.fn() })} />);
    expect(screen.queryByTestId('split-pane-1-pane-menu')).toBeNull();
    fireEvent.click(screen.getByTestId('split-pane-1-pane-menu-btn'));
    expect(screen.getByTestId('split-pane-1-pane-menu')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('split-pane-1-pane-menu-btn'));
    expect(screen.queryByTestId('split-pane-1-pane-menu')).toBeNull();
  });

  it('calls onClosePane and closes the menu when "Close pane" is clicked', () => {
    const onClosePane = vi.fn();
    render(<SplitEditorPane {...defaultProps({ tabs: [tab()], activeTabId: 't1', onClosePane })} />);
    fireEvent.click(screen.getByTestId('split-pane-1-pane-menu-btn'));
    fireEvent.click(screen.getByTestId('split-pane-1-pane-menu-close'));
    expect(onClosePane).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('split-pane-1-pane-menu')).toBeNull();
  });

  it('shows "Split pane" only when onSplitPane is provided', () => {
    const onSplitPane = vi.fn();
    const onClosePane = vi.fn();
    render(<SplitEditorPane {...defaultProps({ tabs: [tab()], activeTabId: 't1', onClosePane, onSplitPane })} />);
    fireEvent.click(screen.getByTestId('split-pane-1-pane-menu-btn'));
    expect(screen.getByTestId('split-pane-1-pane-menu-split')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('split-pane-1-pane-menu-split'));
    expect(onSplitPane).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('split-pane-1-pane-menu')).toBeNull();
  });

  it('dismisses the menu on outside click', () => {
    render(<SplitEditorPane {...defaultProps({ tabs: [tab()], activeTabId: 't1', onClosePane: vi.fn() })} />);
    fireEvent.click(screen.getByTestId('split-pane-1-pane-menu-btn'));
    expect(screen.getByTestId('split-pane-1-pane-menu')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('split-pane-1-pane-menu')).toBeNull();
  });
});

// ── Entity Browser as a document tab (SKY-9920, M5 item 5) ───────────────────

describe('Entity Browser tab', () => {
  it('renders EntityBrowser instead of the scene editor when activeTabIsEntityBrowser', () => {
    render(<SplitEditorPane {...defaultProps({ activeTabIsEntityBrowser: true })} />);
    expect(screen.getByTestId('mock-entity-browser')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-block-editor')).toBeNull();
  });

  it('forwards selectedEntityId to EntityBrowser', () => {
    render(<SplitEditorPane {...defaultProps({ activeTabIsEntityBrowser: true, selectedEntityId: 'ent-1' })} />);
    expect(screen.getByTestId('mock-entity-browser').dataset.selectedEntityId).toBe('ent-1');
  });

  it('hides the per-pane scene selector while showing the Entity Browser', () => {
    render(<SplitEditorPane {...defaultProps({ activeTabIsEntityBrowser: true })} />);
    expect(screen.queryByTestId('spe-scene-btn')).toBeNull();
  });

  it('renders the scene editor (not EntityBrowser) when activeTabIsEntityBrowser is false/omitted', () => {
    render(<SplitEditorPane {...defaultProps()} />);
    expect(screen.getByTestId('mock-block-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-entity-browser')).toBeNull();
  });

  it('+ stays a single-click "new scene" action when onOpenEntityBrowser is omitted', () => {
    const onNewTab = vi.fn();
    render(<SplitEditorPane {...defaultProps({ tabs: [], activeTabId: null, onNewTab })} />);
    fireEvent.click(screen.getByTestId('wtb-new-tab-btn'));
    expect(onNewTab).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('wtb-new-tab-menu')).toBeNull();
  });

  it('+ opens a picker offering Entity Browser when onOpenEntityBrowser is provided', () => {
    const onOpenEntityBrowser = vi.fn();
    render(<SplitEditorPane {...defaultProps({ tabs: [], activeTabId: null, onOpenEntityBrowser })} />);
    fireEvent.click(screen.getByTestId('wtb-new-tab-btn'));
    fireEvent.click(screen.getByTestId('wtb-new-tab-menu-item-entities'));
    expect(onOpenEntityBrowser).toHaveBeenCalledOnce();
  });
});
