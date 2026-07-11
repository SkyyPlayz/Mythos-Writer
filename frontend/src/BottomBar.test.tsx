// SKY-2305: BottomBar daily goal chip unit tests
// Beta 4 M2: + page-width hint, "Saved Xm ago" pulse, single-status-bar regression
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import BottomBar, { formatSavedAgo } from './BottomBar';
import type { Scene, Chapter, Story } from './types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockGoalsGetStats = vi.fn();

function makeScene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'sc-1',
    title: 'The Opening',
    blocks: [
      { id: 'b1', type: 'prose', order: 0, content: 'The quick brown fox jumps.', updatedAt: '' },
    ],
    draftState: 'in-progress',
    order: 0,
    path: 'ch1/scene1.md',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function makeChapter(scenes: Scene[] = []): Chapter {
  return {
    id: 'ch-1',
    title: 'Chapter One',
    order: 0,
    scenes,
    path: 'chapter-one.md',
    createdAt: '',
    updatedAt: '',
  };
}

function makeStory(chapters: Chapter[] = []): Story {
  return {
    id: 'st-1',
    title: 'My Novel',
    chapters,
    path: '/vault/My Novel',
    createdAt: '',
    updatedAt: '',
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
  mockGoalsGetStats.mockResolvedValue({ todayWords: 812, weekWords: 4000, dailyGoal: 1500, streakDays: 3, heatmap: [] });

  (window as unknown as { api: unknown }).api = {
    goalsGetStats: mockGoalsGetStats,
  };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function renderBar(props: {
  selectedScene?: Scene | null;
  selectedChapter?: Chapter | null;
  selectedStory?: Story | null;
  activeNotePath?: string | null;
  pageWidthPx?: number | null;
}) {
  const scene = props.selectedScene !== undefined ? props.selectedScene : makeScene();
  const chapter = props.selectedChapter !== undefined ? props.selectedChapter : makeChapter([scene ?? makeScene()]);
  const story = props.selectedStory !== undefined ? props.selectedStory : makeStory(chapter ? [chapter] : []);

  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <BottomBar
        selectedScene={scene}
        selectedChapter={chapter}
        selectedStory={story}
        onNavigateScene={vi.fn()}
        activeNotePath={props.activeNotePath ?? null}
        pageWidthPx={props.pageWidthPx ?? null}
      />,
    );
  });
  // Flush promise microtasks from useEffect
  await act(async () => {});
  return view;
}

// ─── AC-DG-06: IPC fires on mount and after scene:saved ──────────────────────

describe('AC-DG-06 — goalsGetStats IPC calls', () => {
  it('calls goalsGetStats once on mount', async () => {
    await renderBar({});
    expect(mockGoalsGetStats).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after scene:saved event', async () => {
    await renderBar({});
    expect(mockGoalsGetStats).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new CustomEvent('scene:saved'));
    });
    await act(async () => {});

    expect(mockGoalsGetStats).toHaveBeenCalledTimes(2);
  });

  it('re-fetches on each subsequent scene:saved', async () => {
    await renderBar({});

    for (let i = 1; i <= 3; i++) {
      await act(async () => {
        window.dispatchEvent(new CustomEvent('scene:saved'));
      });
      await act(async () => {});
    }

    expect(mockGoalsGetStats).toHaveBeenCalledTimes(4); // 1 mount + 3 saves
  });
});

// ─── AC-DG-01: chip format with daily goal ────────────────────────────────────

describe('AC-DG-01 — chip shows "X / Y today"', () => {
  it('renders the daily goal chip with correct text', async () => {
    mockGoalsGetStats.mockResolvedValue({ todayWords: 812, weekWords: 0, dailyGoal: 1500, streakDays: 0, heatmap: [] });
    await renderBar({});

    const chip = screen.getByTestId('bottom-daily-goal');
    expect(chip).toBeDefined();
    expect(chip.textContent).toContain('812');
    expect(chip.textContent).toContain('1,500');
    expect(chip.textContent).toContain('today');
  });

  it('updates display when stats change after scene:saved', async () => {
    await renderBar({});

    mockGoalsGetStats.mockResolvedValue({ todayWords: 1200, weekWords: 0, dailyGoal: 1500, streakDays: 0, heatmap: [] });
    await act(async () => {
      window.dispatchEvent(new CustomEvent('scene:saved'));
    });
    await act(async () => {});

    const chip = screen.getByTestId('bottom-daily-goal');
    expect(chip.textContent).toContain('1,200');
  });
});

// ─── AC-DG-02: no denominator when dailyGoal === 0 ───────────────────────────

describe('AC-DG-02 — no denominator when no daily goal', () => {
  it('shows only "X today" when dailyGoal is 0', async () => {
    mockGoalsGetStats.mockResolvedValue({ todayWords: 812, weekWords: 0, dailyGoal: 0, streakDays: 0, heatmap: [] });
    await renderBar({});

    const chip = screen.getByTestId('bottom-daily-goal');
    expect(chip.textContent).toBe('812 today');
  });

  it('does not render a denominator slash', async () => {
    mockGoalsGetStats.mockResolvedValue({ todayWords: 0, weekWords: 0, dailyGoal: 0, streakDays: 0, heatmap: [] });
    await renderBar({});

    const chip = screen.getByTestId('bottom-daily-goal');
    expect(chip.textContent).not.toContain('/');
  });
});

// ─── AC-DG-03: success color when goal met ───────────────────────────────────

describe('AC-DG-03 — success styling when goal met', () => {
  it('adds --met class when todayWords >= dailyGoal', async () => {
    mockGoalsGetStats.mockResolvedValue({ todayWords: 1500, weekWords: 0, dailyGoal: 1500, streakDays: 0, heatmap: [] });
    await renderBar({});

    const chip = screen.getByTestId('bottom-daily-goal');
    expect(chip.className).toContain('bottom-daily-goal--met');
  });

  it('adds --met class when todayWords exceeds dailyGoal', async () => {
    mockGoalsGetStats.mockResolvedValue({ todayWords: 2000, weekWords: 0, dailyGoal: 1500, streakDays: 0, heatmap: [] });
    await renderBar({});

    expect(screen.getByTestId('bottom-daily-goal').className).toContain('bottom-daily-goal--met');
  });

  it('does NOT add --met class when short of goal', async () => {
    mockGoalsGetStats.mockResolvedValue({ todayWords: 800, weekWords: 0, dailyGoal: 1500, streakDays: 0, heatmap: [] });
    await renderBar({});

    expect(screen.getByTestId('bottom-daily-goal').className).not.toContain('bottom-daily-goal--met');
  });

  it('does NOT add --met class when dailyGoal is 0 (even if words > 0)', async () => {
    mockGoalsGetStats.mockResolvedValue({ todayWords: 999, weekWords: 0, dailyGoal: 0, streakDays: 0, heatmap: [] });
    await renderBar({});

    expect(screen.getByTestId('bottom-daily-goal').className).not.toContain('bottom-daily-goal--met');
  });
});

// ─── AC-DG-04: keyboard accessible ───────────────────────────────────────────

describe('AC-DG-04 — keyboard accessible chip', () => {
  it('is tab-focusable (tabIndex=0)', async () => {
    await renderBar({});
    const chip = screen.getByTestId('bottom-daily-goal');
    expect(chip.getAttribute('tabindex')).toBe('0');
  });

  it('has aria-label with word count and goal', async () => {
    mockGoalsGetStats.mockResolvedValue({ todayWords: 812, weekWords: 0, dailyGoal: 1500, streakDays: 0, heatmap: [] });
    await renderBar({});

    const chip = screen.getByTestId('bottom-daily-goal');
    const label = chip.getAttribute('aria-label') ?? '';
    expect(label).toMatch(/812/);
    expect(label).toMatch(/1,500/);
    expect(label).toMatch(/word goal/i);
  });

  it('aria-label omits denominator when no goal set', async () => {
    mockGoalsGetStats.mockResolvedValue({ todayWords: 812, weekWords: 0, dailyGoal: 0, streakDays: 0, heatmap: [] });
    await renderBar({});

    const chip = screen.getByTestId('bottom-daily-goal');
    const label = chip.getAttribute('aria-label') ?? '';
    expect(label).toMatch(/812/);
    expect(label).not.toMatch(/word goal/i);
  });
});

// ─── AC-DG-07: not shown in Notes tab ────────────────────────────────────────

describe('AC-DG-07 — chip hidden in Notes view', () => {
  it('does not render chip when activeNotePath is set (no scene)', async () => {
    await renderBar({ selectedScene: null, activeNotePath: '/vault/notes/my-note.md' });
    expect(screen.queryByTestId('bottom-daily-goal')).toBeNull();
  });

  it('does not call goalsGetStats in notes view (chip hidden)', async () => {
    await renderBar({ selectedScene: null, activeNotePath: '/vault/notes/my-note.md' });
    // Stats are still fetched (useEffect always fires), but chip is hidden
    // The key AC-DG-07 requirement is that the chip is not visible
    expect(screen.queryByTestId('bottom-daily-goal')).toBeNull();
  });

  it('does not render chip when no scene is selected and no note active', async () => {
    await renderBar({ selectedScene: null, activeNotePath: null });
    expect(screen.queryByTestId('bottom-daily-goal')).toBeNull();
  });

  it('renders chip when a scene is selected (story view)', async () => {
    await renderBar({});
    await waitFor(() => {
      expect(screen.getByTestId('bottom-daily-goal')).toBeDefined();
    });
  });
});

// ─── Beta 4 M2 — page-width hint (§4: "Page W px — drag page edge to resize") ─

describe('Beta 4 M2 — page-width hint', () => {
  it('renders the hint with the current page width when a scene is open', async () => {
    await renderBar({ pageWidthPx: 1000 });
    const hint = screen.getByTestId('bottom-page-hint');
    expect(hint.textContent).toContain('Page 1,000 px');
    expect(hint.textContent).toContain('drag page edge to resize');
  });

  it('omits the hint when no page width is supplied (non-editor surfaces)', async () => {
    await renderBar({});
    expect(screen.queryByTestId('bottom-page-hint')).toBeNull();
  });
});

// ─── Beta 4 M2 — "Saved Xm ago" + pulse dot (§4, prototype 3630) ─────────────

describe('Beta 4 M2 — Saved indicator', () => {
  it('is hidden until the first scene:saved event', async () => {
    await renderBar({});
    expect(screen.queryByTestId('bottom-saved')).toBeNull();
  });

  it('appears with a pulse dot after scene:saved', async () => {
    await renderBar({});
    await act(async () => {
      window.dispatchEvent(new CustomEvent('scene:saved'));
    });
    const saved = screen.getByTestId('bottom-saved');
    expect(saved.textContent).toContain('Saved just now');
    expect(saved.querySelector('.bottom-saved-dot')).not.toBeNull();
  });

  it('formatSavedAgo ramps just now → minutes → hours', () => {
    const t0 = 1_000_000_000_000;
    expect(formatSavedAgo(t0, t0 + 10_000)).toBe('Saved just now');
    expect(formatSavedAgo(t0, t0 + 2 * 60_000)).toBe('Saved 2m ago');
    expect(formatSavedAgo(t0, t0 + 3 * 3_600_000)).toBe('Saved 3h ago');
  });
});

// ─── Beta 4 M2 regression — exactly ONE status bar in the DOM (§4 / GAP #10) ─

describe('Beta 4 M2 — single status bar regression', () => {
  it('renders exactly one .bottom-bar and owns the words/characters stats', async () => {
    const { container } = await renderBar({ pageWidthPx: 1000 });
    expect(container.querySelectorAll('.bottom-bar')).toHaveLength(1);
    // The full §4 stat run lives here: nav · words · chars · read time · page hint.
    const stats = screen.getByTestId('bottom-live-stats');
    expect(stats.textContent).toMatch(/words/);
    expect(stats.textContent).toMatch(/characters/);
    expect(stats.textContent).toMatch(/min read/);
    // The deleted in-editor duplicate must never come back.
    expect(document.querySelector('.be-wordcount')).toBeNull();
  });
});
