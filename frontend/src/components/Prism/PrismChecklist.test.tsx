// Prism (#1764) — sidebar Analytics checklist: empty states, per-book master
// switches and check toggles (persisted to prism.json), live counts from the
// editor's snapshot, "Go to" navigation and the a11y contract.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react';
import { configureAxe } from 'vitest-axe';
import * as axeMatchers from 'vitest-axe/matchers';
import type { AxeMatchers } from 'vitest-axe/matchers';
import PrismChecklist from './PrismChecklist';
import {
  __resetPrismStoresForTests,
  prismLiveStore,
  prismSettingsStore,
  type PrismLiveFinding,
  type PrismLiveSnapshot,
} from '../../prism/store';
import { prismFilePath } from '../../prism/settings';
import { PRISM_CHECKS, type PrismCheckId } from '../../prism/types';
import { __resetAiEnabledForTests, setAiEnabled } from '../../hooks/useAiEnabled';
import type { Story } from '../../types';

// vitest-axe@0.1.0's legacy matcher typing — same registration as
// accessibility.test.tsx.
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  interface Assertion<T = any> extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
expect.extend(axeMatchers);

const axe = configureAxe({
  rules: {
    // colour-contrast needs computed styles jsdom does not have.
    'color-contrast': { enabled: false },
  },
});

const story: Story = {
  id: 'story-1',
  title: 'The Glass Coast',
  path: 'stories/glass-coast',
  chapters: [],
  createdAt: '',
  updatedAt: '',
};

/** `story` with one chapter holding a scene `sceneId`. */
function storyWithScene(sceneId: string): Story {
  return {
    ...story,
    chapters: [
      {
        id: 'chapter-1',
        title: 'One',
        path: `${story.path}/chapters/chapter-1`,
        order: 0,
        scenes: [
          {
            id: sceneId,
            title: 'Scene',
            path: `${story.path}/chapters/chapter-1/scenes/${sceneId}.md`,
            order: 0,
            chapterId: 'chapter-1',
            blocks: [],
            draftState: 'in-progress',
            createdAt: '',
            updatedAt: '',
          },
        ],
        createdAt: '',
        updatedAt: '',
      },
    ],
  };
}

const readVault = vi.fn();
const writeVault = vi.fn();

function installApi() {
  Object.defineProperty(window, 'api', {
    value: { readVault, writeVault },
    writable: true,
    configurable: true,
  });
}

let nextPos = 1;
function finding(checkId: PrismCheckId, snippet: string, message = `${checkId} hit`): PrismLiveFinding {
  // Paragraph offsets differ from doc positions so a mix-up shows in tests.
  const from = nextPos;
  nextPos += 10;
  return { checkId, paragraph: 0, from, to: from + 4, message, docFrom: from + 100, docTo: from + 104, snippet };
}

function publish(findings: PrismLiveFinding[], over: Partial<PrismLiveSnapshot> = {}): PrismLiveSnapshot {
  const snapshot: PrismLiveSnapshot = {
    storyId: story.id,
    sceneId: 'scene-a',
    findings,
    stats: { words: 1234, sentences: 87, avgSentenceWords: 14.2, readingEase: 72 },
    reveal: vi.fn(),
    ...over,
  };
  act(() => prismLiveStore.publish(snapshot));
  return snapshot;
}

/** A check's one-line description from the shared catalogue. */
function desc(id: PrismCheckId): string {
  return PRISM_CHECKS.find((c) => c.id === id)?.description as string;
}

function readChecklistCss(): string {
  return readFileSync(resolve(process.cwd(), 'src/components/Prism/PrismChecklist.css'), 'utf-8');
}

/** The declarations of the top-level rule whose selector list is exactly `selector`. */
function cssBlock(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}

/** The JSON body of the latest prism.json write. */
function lastWritten(): Record<string, unknown> {
  const calls = writeVault.mock.calls.filter(([path]) => path === prismFilePath(story.path));
  expect(calls.length).toBeGreaterThan(0);
  return JSON.parse(calls[calls.length - 1][1] as string) as Record<string, unknown>;
}

beforeEach(() => {
  __resetPrismStoresForTests();
  nextPos = 1;
  readVault.mockReset();
  writeVault.mockReset();
  readVault.mockRejectedValue(new Error('ENOENT'));
  writeVault.mockResolvedValue({ path: 'x', bytes: 1 });
  installApi();
});

afterEach(() => {
  // Unmount before resetting: the reset notifies subscribers.
  cleanup();
  __resetPrismStoresForTests();
  __resetAiEnabledForTests();
  delete (window as { api?: unknown }).api;
});

describe('PrismChecklist — empty states', () => {
  it('asks for a book when no story is open', () => {
    render(<PrismChecklist story={null} sceneId={null} />);
    expect(screen.getByRole('heading', { name: 'Prism' })).toBeInTheDocument();
    expect(screen.getByText('Rule checks · works with AI off')).toBeInTheDocument();
    expect(screen.getByText('Open a book to use Prism.')).toBeInTheDocument();
    expect(screen.queryByTestId('prism-master-flags')).not.toBeInTheDocument();
  });

  it('asks for a scene when the book has no live snapshot for the scene', () => {
    render(<PrismChecklist story={story} sceneId="scene-a" />);
    expect(screen.getByText('Open a scene to see Prism checks.')).toBeInTheDocument();
    expect(screen.queryByTestId('prism-stats')).not.toBeInTheDocument();
    // Settings stay editable without a scene.
    expect(screen.getByTestId('prism-master-flags')).toBeInTheDocument();
    expect(screen.getByTestId('prism-check-toggle-adverbs')).toBeInTheDocument();
  });

  it('says nothing is flagged when the scene has no flag findings', () => {
    publish([finding('dialogue', '“Hello,” she said.')]);
    render(<PrismChecklist story={story} sceneId="scene-a" />);
    expect(screen.getByText('Nothing flagged in this scene.')).toBeInTheDocument();
    expect(screen.queryByText('Open a scene to see Prism checks.')).not.toBeInTheDocument();
  });

  it('counts only enabled checks toward "Nothing flagged"', () => {
    act(() => prismSettingsStore.update(story.id, { checks: { adverbs: false } }));
    publish([finding('adverbs', 'She ran quickly.')]);
    render(<PrismChecklist story={story} sceneId="scene-a" />);
    expect(screen.getByText('Nothing flagged in this scene.')).toBeInTheDocument();
  });
});

describe('PrismChecklist — stats', () => {
  it('shows words, average sentence length and reading ease', () => {
    publish([]);
    render(<PrismChecklist story={story} sceneId="scene-a" />);
    expect(screen.getByTestId('prism-stats')).toHaveTextContent(
      '1,234 words · 14.2 words per sentence · Reading ease 72'
    );
  });

  it('omits reading ease when it is unknown', () => {
    publish([], { stats: { words: 0, sentences: 0, avgSentenceWords: 0, readingEase: null } });
    render(<PrismChecklist story={story} sceneId="scene-a" />);
    const stats = screen.getByTestId('prism-stats');
    expect(stats).toHaveTextContent('0 words · 0 words per sentence');
    expect(stats).not.toHaveTextContent(/Reading ease/);
  });
});

describe('PrismChecklist — counts', () => {
  it('counts the live findings per check and follows new snapshots', () => {
    publish([
      finding('adverbs', 'She ran quickly.'),
      finding('adverbs', 'He spoke softly.'),
      finding('crutch-words', 'It was just fine.'),
      finding('dialogue', '“Run,” she said.'),
      finding('dialogue', '“Now!”'),
      finding('dialogue', '“Go.”'),
    ]);
    render(<PrismChecklist story={story} sceneId="scene-a" />);
    expect(screen.getByTestId('prism-count-adverbs')).toHaveTextContent(/^2 found$/);
    expect(screen.getByTestId('prism-count-crutch-words')).toHaveTextContent(/^1 found$/);
    expect(screen.getByTestId('prism-count-passive-voice')).toHaveTextContent(/^0 found$/);
    expect(screen.getByTestId('prism-count-dialogue')).toHaveTextContent(/^3 found$/);
    // Narrator is off by default.
    expect(screen.getByTestId('prism-count-narrator')).toHaveTextContent(/^Off$/);
    expect(screen.queryByText('Nothing flagged in this scene.')).not.toBeInTheDocument();

    publish([finding('adverbs', 'She ran quickly.')]);
    expect(screen.getByTestId('prism-count-adverbs')).toHaveTextContent(/^1 found$/);
    expect(screen.getByTestId('prism-count-crutch-words')).toHaveTextContent(/^0 found$/);
  });

  it('reads the snapshot for its own scene only', () => {
    publish([finding('adverbs', 'She ran quickly.')], { sceneId: 'scene-b' });
    render(<PrismChecklist story={story} sceneId="scene-a" />);
    expect(screen.getByText('Open a scene to see Prism checks.')).toBeInTheDocument();
  });

  it('ignores a snapshot that belongs to another book', () => {
    // The shell can keep book A's scene selected after switching to book B
    // (which has no scenes); B's checklist must not show A's counts or "Go to"
    // targets, since its switches write to B's prism.json.
    publish([finding('adverbs', 'She ran quickly.')], { storyId: 'other-book' });
    render(<PrismChecklist story={story} sceneId="scene-a" />);
    expect(screen.getByText('Open a scene to see Prism checks.')).toBeInTheDocument();
    expect(screen.queryByTestId('prism-stats')).not.toBeInTheDocument();
    expect(screen.queryByTestId('prism-count-adverbs')).not.toBeInTheDocument();
    expect(screen.queryByTestId('prism-expand-adverbs')).not.toBeInTheDocument();
  });

  it('accepts a snapshot whose book is unknown when the scene is in this book', () => {
    // Legacy/imported scenes leave Scene.storyId unset, so the snapshot has no
    // book id; it still belongs here when this book owns the scene.
    publish([finding('adverbs', 'She ran quickly.')], { storyId: null });
    render(<PrismChecklist story={storyWithScene('scene-a')} sceneId="scene-a" />);
    expect(screen.getByTestId('prism-count-adverbs')).toHaveTextContent(/^1 found$/);
  });

  it('accepts a book-less snapshot for a scene inside one of the book\'s Parts', () => {
    publish([finding('adverbs', 'She ran quickly.')], { storyId: null });
    const base = storyWithScene('scene-a');
    const parted: Story = {
      ...base,
      chapters: [],
      parts: [{ id: 'part-1', title: 'Part One', order: 0, note: [], chapters: base.chapters, createdAt: '', updatedAt: '' }],
    };
    render(<PrismChecklist story={parted} sceneId="scene-a" />);
    expect(screen.getByTestId('prism-count-adverbs')).toHaveTextContent(/^1 found$/);
  });

  it('ignores a book-less snapshot for a scene that is not in this book', () => {
    // Book A's legacy scene (no storyId) stays selected after switching to
    // book B, which has no scenes: B must not show A's counts or "Go to".
    publish([finding('adverbs', 'She ran quickly.')], { storyId: null });
    render(<PrismChecklist story={storyWithScene('scene-other')} sceneId="scene-a" />);
    expect(screen.getByText('Open a scene to see Prism checks.')).toBeInTheDocument();
    expect(screen.queryByTestId('prism-stats')).not.toBeInTheDocument();
    expect(screen.queryByTestId('prism-count-adverbs')).not.toBeInTheDocument();
    expect(screen.queryByTestId('prism-expand-adverbs')).not.toBeInTheDocument();
  });

  it('gives voice colors a count but no finding list', () => {
    publish([finding('dialogue', '“Run,” she said.')]);
    render(<PrismChecklist story={story} sceneId="scene-a" />);
    expect(screen.queryByTestId('prism-expand-dialogue')).not.toBeInTheDocument();
    expect(screen.queryByTestId('prism-item-dialogue')).not.toBeInTheDocument();
    const voice = screen.getByRole('group', { name: 'Voice colors' });
    expect(within(voice).getByTestId('prism-check-toggle-dialogue')).toBeChecked();
  });
});

describe('PrismChecklist — master switches', () => {
  it('turns Flags on through the store and saves it to prism.json', async () => {
    render(<PrismChecklist story={story} sceneId={null} />);
    const flags = screen.getByTestId('prism-master-flags');
    expect(flags).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Flags' })).toBe(flags);

    fireEvent.click(flags);
    expect(flags).toBeChecked();
    expect(prismSettingsStore.get(story.id).flags).toBe(true);

    await act(() => prismSettingsStore.flush(story.id));
    expect(lastWritten()).toMatchObject({ flags: true, proseColors: false });
  });

  it('turns Prose colors on through the store and saves it to prism.json', async () => {
    render(<PrismChecklist story={story} sceneId={null} />);
    const colors = screen.getByRole('switch', { name: 'Prose colors' });
    expect(colors).toHaveAttribute('data-testid', 'prism-master-prose-colors');

    fireEvent.click(colors);
    expect(colors).toBeChecked();
    expect(prismSettingsStore.get(story.id).proseColors).toBe(true);

    await act(() => prismSettingsStore.flush(story.id));
    expect(lastWritten()).toMatchObject({ proseColors: true, flags: false });
  });

  it('keeps the list with Flags off and says underlines are hidden', () => {
    publish([finding('adverbs', 'She ran quickly.')]);
    render(<PrismChecklist story={story} sceneId="scene-a" />);
    expect(screen.getByText('Underlines hidden')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('prism-expand-adverbs'));
    expect(screen.getByRole('button', { name: 'Go to: She ran quickly.' })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('prism-master-flags'));
    expect(screen.queryByText('Underlines hidden')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to: She ran quickly.' })).toBeInTheDocument();
  });
});

describe('PrismChecklist — check toggles', () => {
  it('turning a check off hides its findings, shows Off and saves', async () => {
    publish([finding('adverbs', 'She ran quickly.'), finding('crutch-words', 'It was just fine.')]);
    render(<PrismChecklist story={story} sceneId="scene-a" />);

    fireEvent.click(screen.getByTestId('prism-expand-adverbs'));
    expect(screen.getAllByTestId('prism-item-adverbs')).toHaveLength(1);

    const toggle = screen.getByTestId('prism-check-toggle-adverbs');
    expect(toggle).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Adverbs' })).toBe(toggle);
    fireEvent.click(toggle);

    expect(toggle).not.toBeChecked();
    expect(screen.getByTestId('prism-count-adverbs')).toHaveTextContent(/^Off$/);
    expect(screen.queryByTestId('prism-item-adverbs')).not.toBeInTheDocument();
    expect(screen.queryByTestId('prism-expand-adverbs')).not.toBeInTheDocument();
    // Other checks are untouched.
    expect(screen.getByTestId('prism-count-crutch-words')).toHaveTextContent(/^1 found$/);
    expect(prismSettingsStore.get(story.id).checks.adverbs).toBe(false);

    await act(() => prismSettingsStore.flush(story.id));
    expect(lastWritten()).toMatchObject({ checks: { adverbs: false, 'crutch-words': true } });

    // Back on: findings return.
    fireEvent.click(toggle);
    expect(screen.getByTestId('prism-count-adverbs')).toHaveTextContent(/^1 found$/);
  });

  it('turning a voice color off shows Off', () => {
    publish([finding('dialogue', '“Run,” she said.')]);
    render(<PrismChecklist story={story} sceneId="scene-a" />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Dialogue' }));
    expect(screen.getByTestId('prism-count-dialogue')).toHaveTextContent(/^Off$/);
    expect(prismSettingsStore.get(story.id).checks.dialogue).toBe(false);
  });
});

describe('PrismChecklist — finding list', () => {
  it('discloses the findings and jumps to one with Go to', () => {
    const snapshot = publish([
      finding('adverbs', 'She ran quickly.', 'Adverb: ‘quickly’'),
      finding('adverbs', 'He spoke softly.', 'Adverb: ‘softly’'),
    ]);
    render(<PrismChecklist story={story} sceneId="scene-a" />);

    const expand = screen.getByTestId('prism-expand-adverbs');
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    const listId = expand.getAttribute('aria-controls');
    expect(listId).toBeTruthy();
    expect(screen.queryByTestId('prism-item-adverbs')).not.toBeInTheDocument();

    fireEvent.click(expand);
    expect(expand).toHaveAttribute('aria-expanded', 'true');
    const list = document.getElementById(listId as string);
    expect(list).not.toBeNull();
    expect(within(list as HTMLElement).getAllByTestId('prism-item-adverbs')).toHaveLength(2);
    expect(screen.getByText('Adverb: ‘softly’')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Go to: He spoke softly.' }));
    const target = snapshot.findings[1];
    expect(snapshot.reveal).toHaveBeenCalledTimes(1);
    expect(snapshot.reveal).toHaveBeenCalledWith(target.docFrom, target.docTo);

    fireEvent.click(expand);
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('prism-item-adverbs')).not.toBeInTheDocument();
  });

  it('caps a check at 50 items with a "+N more" note', () => {
    publish(Array.from({ length: 53 }, (_, i) => finding('adverbs', `Line ${i} went badly.`)));
    render(<PrismChecklist story={story} sceneId="scene-a" />);
    fireEvent.click(screen.getByTestId('prism-expand-adverbs'));
    expect(screen.getAllByTestId('prism-item-adverbs')).toHaveLength(50);
    expect(screen.getByText('+3 more')).toBeInTheDocument();
    expect(screen.getByTestId('prism-count-adverbs')).toHaveTextContent(/^53 found$/);
  });

  it('never labels a control with a rewrite verb', () => {
    publish([finding('adverbs', 'She ran quickly.')]);
    render(<PrismChecklist story={story} sceneId="scene-a" />);
    fireEvent.click(screen.getByTestId('prism-expand-adverbs'));
    for (const el of [...screen.getAllByRole('button'), ...screen.getAllByRole('checkbox')]) {
      expect(el.textContent ?? '').not.toMatch(/\b(apply|accept|fix|insert|use this)\b/i);
      expect(el.getAttribute('aria-label') ?? '').not.toMatch(/\b(apply|accept|fix|insert|use this)\b/i);
    }
  });
});

describe('PrismChecklist — accessibility', () => {
  it('has no axe violations with a finding list open', async () => {
    publish([
      finding('adverbs', 'She ran quickly.'),
      finding('crutch-words', 'It was just fine.'),
      finding('dialogue', '“Run,” she said.'),
    ]);
    const { container } = render(<PrismChecklist story={story} sceneId="scene-a" />);
    fireEvent.click(screen.getByTestId('prism-expand-adverbs'));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no axe violations in the empty states', async () => {
    const { container, rerender } = render(<PrismChecklist story={null} sceneId={null} />);
    expect(await axe(container)).toHaveNoViolations();
    rerender(<PrismChecklist story={story} sceneId="scene-a" />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('describes each check checkbox with its count and what it looks for', () => {
    publish([finding('adverbs', 'She ran quickly.'), finding('adverbs', 'He spoke softly.')]);
    act(() => prismSettingsStore.update(story.id, { checks: { 'crutch-words': false } }));
    render(<PrismChecklist story={story} sceneId="scene-a" />);

    const adverbs = screen.getByRole('checkbox', { name: 'Adverbs' });
    expect(adverbs).toHaveAccessibleDescription(`2 found ${desc('adverbs')}`);
    expect(screen.getByRole('checkbox', { name: 'Crutch words' })).toHaveAccessibleDescription(
      `Off ${desc('crutch-words')}`
    );
    expect(screen.getByRole('checkbox', { name: 'Dialogue' })).toHaveAccessibleDescription(
      `0 found ${desc('dialogue')}`
    );
    // The disclosure button announces the count too.
    expect(screen.getByRole('button', { name: 'Adverbs findings' })).toHaveAccessibleDescription('2 found');
  });

  it('describes the checkboxes before any scene is open (no count yet)', () => {
    render(<PrismChecklist story={story} sceneId={null} />);
    const adverbs = screen.getByRole('checkbox', { name: 'Adverbs' });
    const ids = (adverbs.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(document.getElementById(id)).not.toBeNull();
    expect(adverbs).toHaveAccessibleDescription(desc('adverbs'));
  });

  it('reserves the disclosure slot on every row so the count badges line up', () => {
    publish([finding('adverbs', 'She ran quickly.'), finding('dialogue', '“Run,” she said.')]);
    act(() => prismSettingsStore.update(story.id, { checks: { 'crutch-words': false } }));
    const { container } = render(<PrismChecklist story={story} sceneId="scene-a" />);
    const rows = container.querySelectorAll('.prism-cl-row-main');
    expect(rows).toHaveLength(PRISM_CHECKS.length);
    for (const row of rows) {
      const last = row.lastElementChild as HTMLElement;
      // Either the real button or an empty placeholder of the same width.
      expect(last.matches('.prism-cl-expand, .prism-cl-expand-slot')).toBe(true);
      expect(row.querySelectorAll('.prism-cl-expand, .prism-cl-expand-slot')).toHaveLength(1);
    }
    expect(screen.getByTestId('prism-expand-adverbs')).toHaveClass('prism-cl-expand');
    const css = readChecklistCss();
    expect(cssBlock(css, '.prism-cl-expand,\n.prism-cl-expand-slot')).toMatch(/width:\s*var\(--prism-cl-expand-w\)/);
  });

  it('lets the master switches and check names fit the 160px rail', () => {
    const css = readChecklistCss();
    // Chips stack instead of squeezing two columns into a narrow rail.
    expect(cssBlock(css, '.prism-cl-masters')).toMatch(/grid-template-columns:\s*repeat\(auto-fit,/);
    // Names wrap rather than clip: no nowrap on the switch or check labels.
    for (const sel of ['.prism-cl-switch', '.prism-cl-switch-label', '.prism-cl-check-label']) {
      expect(cssBlock(css, sel)).not.toMatch(/white-space:\s*nowrap/);
    }
    render(<PrismChecklist story={story} sceneId={null} />);
    expect(screen.getByRole('switch', { name: 'Prose colors' }).nextElementSibling).toHaveClass(
      'prism-cl-switch-label'
    );
  });

  it('groups the checks in labelled fieldsets', () => {
    render(<PrismChecklist story={story} sceneId={null} />);
    const flags = screen.getByRole('group', { name: 'Flags' });
    expect(flags.tagName).toBe('FIELDSET');
    expect(within(flags).getByTestId('prism-check-toggle-adverbs')).toBeInTheDocument();
    expect(within(flags).queryByTestId('prism-check-toggle-dialogue')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Voice colors' }).tagName).toBe('FIELDSET');
  });
});

describe('PrismChecklist — AI off', () => {
  it('renders and works with the AI master switch off', async () => {
    act(() => setAiEnabled(false));
    const snapshot = publish([finding('adverbs', 'She ran quickly.')]);
    render(<PrismChecklist story={story} sceneId="scene-a" />);

    expect(screen.getByText('Rule checks · works with AI off')).toBeInTheDocument();
    expect(screen.getByTestId('prism-count-adverbs')).toHaveTextContent(/^1 found$/);
    fireEvent.click(screen.getByTestId('prism-expand-adverbs'));
    fireEvent.click(screen.getByRole('button', { name: 'Go to: She ran quickly.' }));
    expect(snapshot.reveal).toHaveBeenCalledWith(snapshot.findings[0].docFrom, snapshot.findings[0].docTo);

    fireEvent.click(screen.getByTestId('prism-master-flags'));
    await act(() => prismSettingsStore.flush(story.id));
    expect(lastWritten()).toMatchObject({ flags: true });
  });
});
