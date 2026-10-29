import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import LeftRail from './LeftRail';
import type { Story } from './types';
import { __resetPrismStoresForTests, prismSettingsStore } from './prism/store';

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

  // M6 (SKY-9022): LeftRail's zone-2 header is the ONLY navigator header —
  // StoryNavigator's internal "Stories" header is suppressed via hideHeader.
  it('renders no duplicate StoryNavigator header inside the rail', () => {
    const { container } = render(<LeftRail {...baseProps} />);
    expect(container.querySelector('.nav-header')).toBeNull();
    expect(screen.queryByText('Stories')).not.toBeInTheDocument();
  });

  it('renders the project footer zone with the PROJECT label', () => {
    render(<LeftRail {...baseProps} />);
    expect(screen.getByTestId('lr-project-footer')).toBeInTheDocument();
    expect(screen.getByText('PROJECT')).toBeInTheDocument();
    expect(screen.getByText('Words')).toBeInTheDocument();
    expect(screen.getByText('Scenes')).toBeInTheDocument();
    expect(screen.getByText('On Track')).toBeInTheDocument();
  });

  // M6 (SKY-9022): status-dot pass-through — the rail threads
  // onCycleSceneStatus down to StoryNavigator's scene rows.
  it('passes onCycleSceneStatus through to the scene status dots', () => {
    const onCycleSceneStatus = vi.fn();
    render(<LeftRail {...baseProps} onCycleSceneStatus={onCycleSceneStatus} />);
    fireEvent.click(screen.getByRole('button', { name: 'Scene status: Drafting — click to cycle' }));
    expect(onCycleSceneStatus).toHaveBeenCalledWith('sc1');
  });

  it('keeps full navigator content when sidebarCollapsed (shell edge peek owns collapse)', () => {
    render(<LeftRail {...baseProps} sidebarCollapsed />);
    expect(screen.queryByTestId('left-rail-collapsed')).not.toBeInTheDocument();
    expect(screen.getByTestId('lr-story-card')).toBeInTheDocument();
    expect(screen.getByText('STORY NAVIGATOR')).toBeInTheDocument();
  });

  it('calls onToggleCollapsed when collapse button is clicked', () => {
    const onToggle = vi.fn();
    render(<LeftRail {...baseProps} onToggleCollapsed={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /collapse left sidebar/i }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('still exposes collapse control on the story card when sidebarCollapsed', () => {
    const onToggle = vi.fn();
    render(<LeftRail {...baseProps} sidebarCollapsed onToggleCollapsed={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /collapse left sidebar/i }));
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

// Prism (#1764): the Analytics zone sits between the navigator and the
// PROJECT footer and hosts the Prism checklist; its open state is per-book.
describe('LeftRail — Analytics zone', () => {
  afterEach(() => {
    // Unmount first: the reset notifies store subscribers.
    cleanup();
    __resetPrismStoresForTests();
  });

  it('renders the Analytics zone with the Prism checklist between navigator and footer', () => {
    render(<LeftRail {...baseProps} />);
    const zone = screen.getByTestId('lr-analytics-zone');
    expect(screen.getByRole('region', { name: 'ANALYTICS' })).toBe(zone);
    expect(within(zone).getByTestId('prism-checklist')).toBeInTheDocument();
    expect(within(zone).getByRole('heading', { name: 'Prism' })).toBeInTheDocument();
    // DOM order: navigator → analytics → footer.
    const nav = screen.getByTestId('lr-nav-zone');
    const footer = screen.getByTestId('lr-project-footer');
    expect(nav.compareDocumentPosition(zone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(zone.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('collapses and expands the zone, saving the state on the book', () => {
    render(<LeftRail {...baseProps} />);
    const toggle = screen.getByTestId('lr-analytics-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const body = document.getElementById(toggle.getAttribute('aria-controls') as string);
    expect(body).not.toBeNull();
    expect(within(body as HTMLElement).getByTestId('prism-checklist')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('prism-checklist')).not.toBeInTheDocument();
    expect(prismSettingsStore.get(mockStory.id).analyticsOpen).toBe(false);
    // The navigator and footer are unaffected.
    expect(screen.getByText('STORY NAVIGATOR')).toBeInTheDocument();
    expect(screen.getByTestId('lr-project-footer')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('prism-checklist')).toBeInTheDocument();
    expect(prismSettingsStore.get(mockStory.id).analyticsOpen).toBe(true);
  });

  it('opens collapsed when the book saved the zone closed', () => {
    prismSettingsStore.update(mockStory.id, { analyticsOpen: false });
    render(<LeftRail {...baseProps} />);
    expect(screen.getByTestId('lr-analytics-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('prism-checklist')).not.toBeInTheDocument();
  });

  it('still renders and toggles with no book open', () => {
    render(<LeftRail {...baseProps} selectedStory={null} />);
    expect(screen.getByText('ANALYTICS')).toBeInTheDocument();
    expect(screen.getByText('Open a book to use Prism.')).toBeInTheDocument();
    const toggle = screen.getByTestId('lr-analytics-toggle');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Open a book to use Prism.')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Open a book to use Prism.')).toBeInTheDocument();
  });
});

/** Declarations of the first top-level rule whose selector is exactly `selector`. */
function cssBlock(file: string, selector: string): string {
  const css = `\n${readFileSync(resolve(process.cwd(), 'src', file), 'utf-8')}`;
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `${file}: rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}

// Prism (#1764) review: jsdom has no layout, so these pin the two CSS rules
// that keep the PROJECT footer inside the rail at 1280x700/800. Measured in
// Chromium: with a `%` cap and no definite rail height the zone grew to its
// content (543px of an 870px rail) and .shell-left clipped the footer.
describe('LeftRail — Analytics zone never pushes the footer out', () => {
  it('caps the zone by the viewport, not by a % of an auto-height rail', () => {
    const zone = cssBlock('LeftRail.css', '.lr-analytics-zone');
    const caps = [...zone.matchAll(/max-height:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(caps.length).toBeGreaterThan(0);
    for (const cap of caps) {
      expect(cap).toMatch(/^\d+(\.\d+)?d?vh$/);
    }
    expect(zone).toMatch(/min-height:\s*0/);
    // The body is the scroller; the header and the footer stay put.
    const body = cssBlock('LeftRail.css', '.lr-analytics-body');
    expect(body).toMatch(/overflow-y:\s*auto/);
    expect(body).toMatch(/min-height:\s*0/);
    expect(cssBlock('LeftRail.css', '.lr-project-footer')).toMatch(/flex-shrink:\s*0/);
  });

  // Measured in Chromium at 1280x520 with 41 scenes: without a floor the
  // 36vh Analytics cap left the scene tree 6px of 1201px.
  it('keeps the navigator a floor on short windows while its tree is shown', () => {
    const floor = cssBlock('LeftRail.css', '.lr-nav-zone:has(> .lr-nav-tree)');
    const m = floor.match(/min-height:\s*min\(\s*(\d+)px\s*,\s*(\d+)%\s*\)/);
    expect(m, 'navigator min-height floor').not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(120);
    // The % term (of the definite rail) stops the floor pushing the footer out.
    expect(Number(m![2])).toBeGreaterThan(0);
    expect(Number(m![2])).toBeLessThanOrEqual(50);
    // Analytics is the zone that gives way: it may shrink to nothing and scroll.
    const zone = cssBlock('LeftRail.css', '.lr-analytics-zone');
    expect(zone).toMatch(/flex:\s*0 1 auto/);
    expect(zone).toMatch(/min-height:\s*0/);
  });

  it('gives the rail a definite height inside the shell so the navigator scrolls internally', () => {
    expect(cssBlock('LeftRail.css', '.left-rail')).toMatch(/height:\s*100%/);
    expect(cssBlock('DesktopShell.css', '.shell-left__peek')).toMatch(/(^|[\s;])height:\s*100%/);
  });
});
