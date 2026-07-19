// Beta 4 M25 — right-panel tabs + Inspector editors (§8.6, AC1–AC3).
// The mini-chat tabs have their own suite (miniChat.test.tsx) — these tests
// pin the tab strip, the three Inspector editors, and the exact-time →
// calendar-editor modal chain (AC2).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import type { TimelinesStore } from '../../timelinesTypes';
import { ARC_LANE, CHARACTER_LANE, WORLD_LANE } from '../axis/storyLanes';
import TimelineRightPanel, { type TimelineRightPanelProps } from './TimelineRightPanel';

const STANDARD = { preset: 'standard' as const, monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 };

function makeStore(): TimelinesStore {
  return {
    schemaVersion: 1,
    activeTimelineId: 'tl-story',
    timelines: [
      { id: 'tl-story', name: 'Story Timeline', kind: 'story', axis: 'calendar', calendar: { ...STANDARD }, createdAt: '', updatedAt: '' },
      { id: 'tl-world', name: 'World of Veynn', kind: 'world', axis: 'calendar', calendar: { ...STANDARD }, createdAt: '', updatedAt: '' },
    ],
    eras: [{ id: 'era-1', timelineId: 'tl-story', name: 'DAWN', startWhen: 0, endWhen: 400 }],
    spans: [
      { id: 'book-1', timelineId: 'tl-story', name: 'BOOK ONE', startWhen: 0, endWhen: 432, color: '#00f0ff' },
      { id: 'arc-1', timelineId: 'tl-story', name: 'Arc I', startWhen: 0, endWhen: 200, rowId: ARC_LANE },
      { id: 'char-1', timelineId: 'tl-story', name: 'Kael', startWhen: 0, endWhen: 800, rowId: CHARACTER_LANE },
    ],
    rows: [{ id: 'pl-1', timelineId: 'tl-story', name: 'Main Plot', kind: 'plotline' }],
    events: [
      { id: 'ev-1', timelineId: 'tl-story', name: 'Inciting incident', when: 100, chapter: 3, pov: 'Kael', location: 'Veynn', summary: 'It begins.', impact: 'War begins, The city falls' },
      { id: 'card-1', timelineId: 'tl-story', name: 'Opening beat', when: 200, rowId: 'pl-1', chapter: 2, beat: true },
      { id: 'world-1', timelineId: 'tl-story', name: 'Eclipse', when: 300, rowId: WORLD_LANE, summary: 'Skies darken.' },
    ],
  };
}

function makeProps(overrides: Partial<TimelineRightPanelProps> = {}): TimelineRightPanelProps {
  const store = makeStore();
  return {
    store,
    activeTimeline: store.timelines[0],
    selection: null,
    onSelectionChange: vi.fn(),
    tab: 'inspector',
    onTabChange: vi.fn(),
    chapterLabels: ['Ch. 1', 'Ch. 2', 'Ch. 3'],
    whenForChapter: (i) => (i + 1) * 100,
    onLocalMutate: vi.fn(),
    onPersist: vi.fn(),
    onDelete: vi.fn(),
    onCalendarChange: vi.fn(),
    showToast: vi.fn(),
    onJumpTo: vi.fn(),
    flags: [],
    recentAutoAdds: [],
    onQuickAdd: vi.fn(async () => {}),
    onUndoAutoAdd: vi.fn(),
    onFlagResolved: vi.fn(),
    archiveBusy: false,
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('tab strip (§8.6)', () => {
  it('renders the three tabs and reports switches', () => {
    const props = makeProps();
    render(<TimelineRightPanel {...props} />);
    expect(screen.getByTestId('trp-tab-inspector')).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByTestId('trp-tab-archive'));
    expect(props.onTabChange).toHaveBeenCalledWith('archive');
  });

  it('Inspector with nothing selected explains itself', () => {
    render(<TimelineRightPanel {...makeProps()} />);
    expect(screen.getByTestId('trp-inspector-empty')).toHaveTextContent('Nothing selected');
  });
});

describe('event editor (AC2)', () => {
  it('static view shows KEY EVENT badge, rows and impact chips; pencil opens edit', () => {
    render(<TimelineRightPanel {...makeProps({ selection: { type: 'event', id: 'ev-1' } })} />);
    expect(screen.getByText('KEY EVENT')).toBeInTheDocument();
    expect(screen.getByTestId('trp-event-static')).toHaveTextContent('Ch. 3');
    expect(screen.getByTestId('trp-event-static')).toHaveTextContent('Veynn');
    const chips = screen.getByTestId('trp-event-impact-chips');
    expect(chips).toHaveTextContent('War begins');
    expect(chips).toHaveTextContent('The city falls');

    fireEvent.click(screen.getByTestId('trp-event-pencil'));
    expect(screen.getByTestId('trp-event-title-input')).toHaveValue('Inciting incident');
  });

  it('edit fields commit on blur through onLocalMutate + onPersist', () => {
    const props = makeProps({ selection: { type: 'event', id: 'ev-1' } });
    render(<TimelineRightPanel {...props} />);
    fireEvent.click(screen.getByTestId('trp-event-pencil'));
    const pov = screen.getByTestId('trp-event-pov');
    fireEvent.change(pov, { target: { value: 'Mira' } });
    fireEvent.blur(pov);
    expect(props.onPersist).toHaveBeenCalledWith('event', expect.objectContaining({ id: 'ev-1', pov: 'Mira' }));
  });

  it('DATE/TIME opens the exact-time picker; change opens the calendar editor; Apply persists', () => {
    const props = makeProps({ selection: { type: 'event', id: 'ev-1' } });
    render(<TimelineRightPanel {...props} />);
    fireEvent.click(screen.getByTestId('trp-event-pencil'));
    fireEvent.click(screen.getByTestId('trp-event-datetime'));
    // AC2: 4 mono inputs seeded from the active calendar
    expect(screen.getByTestId('exact-time-modal')).toBeInTheDocument();
    expect(screen.getByTestId('etm-start-year')).toBeInTheDocument();
    expect(screen.getByTestId('etm-start-hour')).toBeInTheDocument();

    // `change` link → calendar editor modal
    fireEvent.click(screen.getByTestId('etm-change-calendar'));
    expect(screen.getByTestId('calendar-editor-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('cem-close'));

    fireEvent.change(screen.getByTestId('etm-start-year'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('etm-apply'));
    // Y2 keeps the seeded M2·D12·16:00 remainder: 2×864 + 100 = 1828
    expect(props.onPersist).toHaveBeenCalledWith('event', expect.objectContaining({ id: 'ev-1', when: 1828 }));
    expect(props.showToast).toHaveBeenCalledWith('Exact time set — replotted on the axis');
  });

  it('Delete hands the full item back for the undoable delete', () => {
    const props = makeProps({ selection: { type: 'event', id: 'ev-1' } });
    render(<TimelineRightPanel {...props} />);
    fireEvent.click(screen.getByTestId('trp-event-pencil'));
    fireEvent.click(screen.getByTestId('trp-event-delete'));
    expect(props.onDelete).toHaveBeenCalledWith('event', expect.objectContaining({ id: 'ev-1' }), 'Event');
  });
});

describe('lane-item editor (AC3)', () => {
  it('a main span gets EMBEDS listing the OTHER timelines; picking one persists', () => {
    const props = makeProps({ selection: { type: 'span', id: 'book-1' } });
    render(<TimelineRightPanel {...props} />);
    expect(screen.getByTestId('trp-lane-kind')).toHaveTextContent('Timeline span');
    const embed = screen.getByTestId('trp-lane-embed') as HTMLSelectElement;
    const labels = [...embed.options].map((o) => o.textContent);
    expect(labels).toContain('World of Veynn');
    expect(labels).not.toContain('Story Timeline');
    fireEvent.change(embed, { target: { value: 'tl-world' } });
    expect(props.onPersist).toHaveBeenCalledWith('span', expect.objectContaining({ id: 'book-1', opensTimelineId: 'tl-world' }));
  });

  it('the color row persists a swatch pick', () => {
    const props = makeProps({ selection: { type: 'span', id: 'book-1' } });
    render(<TimelineRightPanel {...props} />);
    const swatches = screen.getByTestId('trp-lane-colors').querySelectorAll('button');
    expect(swatches.length).toBeGreaterThanOrEqual(6);
    fireEvent.click(swatches[3]);
    expect(props.onPersist).toHaveBeenCalledWith('span', expect.objectContaining({ id: 'book-1', color: expect.any(String) }));
  });

  it('arcs and journeys resolve their kind labels; journeys label APPEARS/UNTIL', () => {
    const props = makeProps({ selection: { type: 'span', id: 'char-1' } });
    render(<TimelineRightPanel {...props} />);
    expect(screen.getByTestId('trp-lane-kind')).toHaveTextContent('Character journey');
    expect(screen.getByText('APPEARS (YEAR)')).toBeInTheDocument();
    expect(screen.getByText('UNTIL (YEAR)')).toBeInTheDocument();
  });

  it('STARTS commits year floats through the calendar codec (§1.4 draft-commit)', () => {
    const props = makeProps({ selection: { type: 'span', id: 'book-1' } });
    render(<TimelineRightPanel {...props} />);
    const start = screen.getByTestId('trp-lane-start');
    // typing does not persist mid-keystroke
    fireEvent.change(start, { target: { value: '0.25' } });
    expect(props.onPersist).not.toHaveBeenCalled();
    fireEvent.blur(start);
    // 0.25 years × 864 when/yr = 216
    expect(props.onPersist).toHaveBeenCalledWith('span', expect.objectContaining({ id: 'book-1', startWhen: 216 }));
  });

  it('an END at or before START snaps back instead of persisting (§8.2 guard)', () => {
    const props = makeProps({ selection: { type: 'span', id: 'book-1' } });
    render(<TimelineRightPanel {...props} />);
    const end = screen.getByTestId('trp-lane-end');
    fireEvent.change(end, { target: { value: '-1' } });
    fireEvent.blur(end);
    expect(props.onPersist).not.toHaveBeenCalled();
  });

  it('world events get the point editor with a WHAT HAPPENS field', () => {
    const props = makeProps({ selection: { type: 'event', id: 'world-1' } });
    render(<TimelineRightPanel {...props} />);
    expect(screen.getByTestId('trp-lane-kind')).toHaveTextContent('World event');
    expect(screen.getByTestId('trp-lane-year')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('trp-lane-summary'), { target: { value: 'The sun hides.' } });
    fireEvent.blur(screen.getByTestId('trp-lane-summary'));
    expect(props.onPersist).toHaveBeenCalledWith('event', expect.objectContaining({ id: 'world-1', summary: 'The sun hides.' }));
    // events carry no color field — no color row
    expect(screen.queryByTestId('trp-lane-colors')).toBeNull();
  });
});

describe('scene-card editor', () => {
  it('shows the TEMPLATE BEAT badge and re-plots when the chapter changes', () => {
    const props = makeProps({ selection: { type: 'event', id: 'card-1' } });
    render(<TimelineRightPanel {...props} />);
    expect(screen.getByTestId('trp-beat-badge')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('trp-card-chapter'), { target: { value: '3' } });
    expect(props.onPersist).toHaveBeenCalledWith('event', expect.objectContaining({ id: 'card-1', chapter: 3, when: 300 }));
  });

  it('the written toggle flips and clears the beat flag', () => {
    const props = makeProps({ selection: { type: 'event', id: 'card-1' } });
    render(<TimelineRightPanel {...props} />);
    fireEvent.click(screen.getByTestId('trp-card-written'));
    expect(props.onPersist).toHaveBeenCalledWith('event', expect.objectContaining({ id: 'card-1', written: true }));
  });

  it('close (✕) clears the selection', () => {
    const props = makeProps({ selection: { type: 'event', id: 'card-1' } });
    render(<TimelineRightPanel {...props} />);
    fireEvent.click(screen.getByTestId('trp-card-close'));
    expect(props.onSelectionChange).toHaveBeenCalledWith(null);
  });
});
