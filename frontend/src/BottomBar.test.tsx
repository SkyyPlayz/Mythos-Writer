// SKY-2305: BottomBar daily goal chip unit tests
// Beta 4 M2: + page-width hint, "Saved Xm ago" pulse, single-status-bar regression
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import BottomBar, { formatCompactCount, formatSavedAgo } from './BottomBar';
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
  isVoiceActive?: boolean;
  splitWordCounts?: { pane1: number; pane2: number } | null;
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
        isVoiceActive={props.isVoiceActive ?? false}
        splitWordCounts={props.splitWordCounts ?? null}
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
    expect(saved.querySelector('.bottom-saved-short')?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('.bottom-status-fallback--saved')).toBeNull();
  });

  it('formatSavedAgo ramps just now → minutes → hours', () => {
    const t0 = 1_000_000_000_000;
    expect(formatSavedAgo(t0, t0 + 10_000)).toBe('Saved just now');
    expect(formatSavedAgo(t0, t0 + 2 * 60_000)).toBe('Saved 2m ago');
    expect(formatSavedAgo(t0, t0 + 3 * 3_600_000)).toBe('Saved 3h ago');
  });

  it('formats a 4-digit scene count without a width class on the bar', async () => {
    const scene = makeScene({
      blocks: [
        { id: 'b1', type: 'prose', order: 0, content: 'me '.repeat(1000), updatedAt: '' },
      ],
    });
    const { container } = await renderBar({ selectedScene: scene });
    expect(container.querySelector('.bottom-bar')?.className).toBe('bottom-bar');
    expect(screen.getByTestId('bottom-stats-lead').textContent).toBe('1,000 words');
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

const SPLIT_FULL = 'Pane 1: 12,403 words · Pane 2: 0 words';

function parsedEnCompact(display: string): number {
  const suffix = display.endsWith('M') ? 'M' : display.endsWith('k') ? 'k' : '';
  const body = suffix === '' ? display.replace(/,/g, '') : display.slice(0, -1);
  const negative = body.startsWith('-');
  const unsigned = negative ? body.slice(1) : body;
  const dot = unsigned.indexOf('.');
  const fractionLength = dot === -1 ? 0 : unsigned.length - dot - 1;
  const digits = Number(unsigned.replace('.', ''));
  const scale = suffix === 'M' ? 1_000_000 : suffix === 'k' ? 1_000 : 1;
  const value = digits * (scale / 10 ** fractionLength);
  return negative ? -value : value;
}

describe('formatCompactCount', () => {
  it('keeps counts under 1000 and the zero count in full', () => {
    expect(formatCompactCount(0, 'en-US')).toBe('0');
    expect(formatCompactCount(999, 'en-US')).toBe('999');
  });

  it('truncates thousands and millions without rounding up', () => {
    expect(formatCompactCount(1000, 'en-US')).toBe('1k');
    expect(formatCompactCount(1950, 'en-US')).toBe('1.9k');
    expect(formatCompactCount(12403, 'en-US')).toBe('12.4k');
    expect(formatCompactCount(12499, 'en-US')).toBe('12.4k');
    expect(formatCompactCount(12999, 'en-US')).toBe('12.9k');
    expect(formatCompactCount(999999, 'en-US')).toBe('999.9k');
    expect(formatCompactCount(1049999, 'en-US')).toBe('1M');
    expect(formatCompactCount(1200000, 'en-US')).toBe('1.2M');
  });

  it('uses the locale decimal separator and never compact notation', () => {
    expect(formatCompactCount(12403, 'de-DE')).toBe('12,4k');
    expect(formatCompactCount(12403, 'de-DE')).not.toBe('12.403');
  });

  it('returns a negative or non-finite count unchanged', () => {
    expect(formatCompactCount(-1200, 'en-US')).toBe('-1,200');
    expect(formatCompactCount(Number.NaN, 'en-US')).toBe('NaN');
    expect(formatCompactCount(Number.POSITIVE_INFINITY, 'en-US')).toBe('∞');
    expect(formatCompactCount(-1200, 'en-US')).not.toMatch(/k|M/);
    expect(formatCompactCount(Number.NaN, 'en-US')).not.toMatch(/k|M/);
  });

  it('never displays a value higher than the count', () => {
    const samples = [1000, 999_999, 1_000_000, 1_049_999, 2_000_000];
    for (let n = 1000; n <= 2_000_000; n += 37) samples.push(n);
    for (const n of samples) {
      const display = formatCompactCount(n, 'en-US');
      expect(parsedEnCompact(display), display).toBeLessThanOrEqual(n);
    }
  });

  it('does not construct a NumberFormat on a warm call', () => {
    formatCompactCount(12403, 'en-US');
    const Original = Intl.NumberFormat;
    let constructed = 0;
    function CountingFormat(
      this: Intl.NumberFormat,
      locales?: Intl.LocalesArgument,
      options?: Intl.NumberFormatOptions,
    ) {
      constructed += 1;
      return new Original(locales, options);
    }
    CountingFormat.prototype = Original.prototype;
    CountingFormat.supportedLocalesOf = Original.supportedLocalesOf.bind(Original);
    Intl.NumberFormat = CountingFormat as unknown as typeof Intl.NumberFormat;
    try {
      expect(formatCompactCount(12499, 'en-US')).toBe('12.4k');
      expect(formatCompactCount(1200000, 'en-US')).toBe('1.2M');
      expect(constructed).toBe(0);
    } finally {
      Intl.NumberFormat = Original;
    }
  });
});

describe('voice status name', () => {
  it('omits the voice status when voice is off', async () => {
    const { container } = await renderBar({});
    expect(container.querySelector('.bottom-voice')).toBeNull();
  });

  it('has one accessible name and an empty description', async () => {
    const { container } = await renderBar({ isVoiceActive: true });
    const status = screen.getByRole('status', { name: 'Voice input active' });
    expect(status).toHaveAccessibleName('Voice input active');
    expect(status).toHaveAccessibleDescription('');
    expect(status).not.toHaveAttribute('title');
    expect(status.getAttribute('aria-describedby')).toBeNull();
    const wrap = container.querySelector('.bottom-voice-icon-wrap');
    expect(wrap?.getAttribute('aria-hidden')).toBe('true');
    expect(wrap?.getAttribute('title')).toBe('Listening');
    expect(wrap?.querySelector('.bottom-voice-icon')).not.toBeNull();
    expect(wrap?.querySelector('title')).toBeNull();
  });
});

describe('split count name', () => {
  it('keeps the unsplit word count full', async () => {
    const scene = makeScene({
      blocks: [
        { id: 'b1', type: 'prose', order: 0, content: 'word '.repeat(12403), updatedAt: '' },
      ],
    });
    const { container } = await renderBar({ selectedScene: scene });
    const lead = screen.getByTestId('bottom-stats-lead');
    expect(lead.textContent).toBe('12,403 words');
    expect(lead).not.toHaveAttribute('title');
    expect(lead.getAttribute('role')).toBeNull();
    expect(lead.getAttribute('aria-live')).toBeNull();
    expect(lead).not.toHaveAttribute('aria-label');
    expect(container.querySelector('.bottom-split-short')).toBeNull();
  });

  it('puts the full pane count on the fallback and the hidden short wrapper', async () => {
    const { container } = await renderBar({
      splitWordCounts: { pane1: 12403, pane2: 0 },
    });
    const split = screen.getByTestId('split-word-counts');
    const fallback = container.querySelector('.bottom-status-fallback--split');
    expect(fallback).not.toBeNull();
    expect(fallback?.textContent).toBe(SPLIT_FULL);
    expect(fallback?.getAttribute('title')).toBeNull();
    expect(fallback?.getAttribute('role')).toBeNull();
    expect(fallback?.getAttribute('aria-live')).toBeNull();
    expect(fallback).not.toHaveAttribute('aria-label');
    expect(split.getAttribute('title')).toBeNull();
    const shorts = container.querySelectorAll('.bottom-split-short');
    expect(shorts).toHaveLength(1);
    for (const node of shorts) {
      expect(node.getAttribute('aria-hidden')).toBe('true');
      expect(node.getAttribute('title')).toBe(SPLIT_FULL);
    }
    expect(container.querySelector('.bottom-split-short--step1')).toBeNull();
    expect(container.querySelector('.bottom-split-short--step2')?.textContent).toBe('12.4k · 0');
    expect(container.querySelector('.bottom-split-full')?.textContent).toBe(SPLIT_FULL);
  });
});
