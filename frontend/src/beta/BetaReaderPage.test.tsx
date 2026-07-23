import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import BetaReaderPage from './BetaReaderPage';
import { commentsStore } from '../comments';
import type { Story, Chapter, Scene } from '../types';

type TokenHandler = (data: { streamId: string; token: string }) => void;
type EndHandler = (data: { streamId: string }) => void;
type ErrorHandler = (data: { streamId: string; error: string }) => void;

let tokenCb: TokenHandler | null = null;
let endCb: EndHandler | null = null;
let errorCb: ErrorHandler | null = null;

function makeScene(): Scene {
  return {
    id: 's1', title: 'Arrival', path: 'scenes/s1.md', order: 0,
    blocks: [
      { id: 'b1', type: 'prose', content: 'The lantern flickered in the dark.', order: 0, updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b2', type: 'prose', content: 'Mara stepped inside.', order: 1, updatedAt: '2026-01-01T00:00:00.000Z' },
    ],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeChapter(): Chapter {
  return { id: 'c1', title: 'Chapter 1', path: 'chapters/c1', order: 0, scenes: [makeScene()], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
}

function makeStory(): Story {
  return { id: 'story-1', title: 'My Story', path: 'stories/story-1', chapters: [makeChapter()], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
}

const REPORT: BetaReport = {
  id: 'report-1',
  storyId: 'story-1',
  scope: { kind: 'chapter', id: 'c1', label: 'Chapter: Chapter 1' },
  focus: { pacing: true, clarity: true, character: true, plot: true },
  overall: { score: 82, verdict: 'strong' },
  categories: [
    { key: 'hook', label: 'Hook', score: 90, verdict: 'strong' },
    { key: 'pacing', label: 'Pacing', score: 60, verdict: 'mixed' },
    { key: 'clarity', label: 'Clarity', score: 85, verdict: 'strong' },
    { key: 'emotion', label: 'Emotion', score: 40, verdict: 'weak' },
  ],
  feedback: 'Strong opening chapter.',
  reactions: [
    { id: 'r1', kind: 'loved', sceneId: 's1', quote: 'lantern flickered in the dark', where: 'Chapter 1 - Arrival', note: 'Great imagery.' },
    { id: 'r2', kind: 'confused', sceneId: 's1', quote: 'Mara stepped inside', where: 'Chapter 1 - Arrival', note: 'Unclear who Mara is.' },
  ],
  createdAt: '2026-07-15T10:00:00.000Z',
};

const mockBetaReportList = vi.fn();
const mockBetaReportGet = vi.fn();
const mockBetaReportRun = vi.fn();
const mockStreamStart = vi.fn();
const mockStreamAck = vi.fn();

function buildApi(overrides: Record<string, unknown> = {}) {
  return {
    betaReportList: mockBetaReportList,
    betaReportGet: mockBetaReportGet,
    betaReportRun: mockBetaReportRun,
    streamStart: mockStreamStart,
    streamAck: mockStreamAck,
    onStreamToken: (cb: TokenHandler) => { tokenCb = cb; return () => { tokenCb = null; }; },
    onStreamEnd: (cb: EndHandler) => { endCb = cb; return () => { endCb = null; }; },
    onStreamError: (cb: ErrorHandler) => { errorCb = cb; return () => { errorCb = null; }; },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  tokenCb = null; endCb = null; errorCb = null;
  mockBetaReportList.mockResolvedValue({ reports: [] });
  mockBetaReportGet.mockResolvedValue({ report: null });
  (window as unknown as { api: unknown }).api = buildApi();
});

afterEach(() => {
  commentsStore.reset();
});

async function renderPage(overrides: Partial<Parameters<typeof BetaReaderPage>[0]> = {}) {
  const story = makeStory();
  const chapter = story.chapters[0];
  const scene = chapter.scenes[0];
  const onClose = vi.fn();
  const result = render(
    <BetaReaderPage story={story} chapter={chapter} scene={scene} onClose={onClose} {...overrides} />,
  );
  await waitFor(() => expect(mockBetaReportList).toHaveBeenCalled());
  return { ...result, story, chapter, scene, onClose };
}

describe('BetaReaderPage — Reports page', () => {
  it('renders the empty state with a prompt to run the first read', async () => {
    await renderPage();
    expect(await screen.findByText(/no beta reads yet/i)).toBeInTheDocument();
    expect(screen.getByText(/run your first read/i)).toBeInTheDocument();
  });

  it('runs a beta read and renders score chips + reactions, posts margin comments, and toasts', async () => {
    mockBetaReportRun.mockResolvedValue({ report: REPORT });
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: /^run$/i }));

    await waitFor(() => expect(mockBetaReportRun).toHaveBeenCalledTimes(1));
    const call = mockBetaReportRun.mock.calls[0][0];
    expect(call.storyId).toBe('story-1');
    expect(call.text).toContain('The lantern flickered in the dark.');

    // Report renders: overall + 4 category chips, plus 2 reaction cards.
    // Scoped to the main column — "82" also appears in the new BETA READS history row.
    const main = screen.getByLabelText('Beta read report');
    expect(await within(main).findByText('82')).toBeInTheDocument();
    expect(screen.getByText('LOVED')).toBeInTheDocument();
    expect(screen.getByText('CONFUSED')).toBeInTheDocument();
    expect(screen.getByText(/great imagery/i)).toBeInTheDocument();

    // Toast confirms report + margin comments (§14.7).
    expect(await screen.findByText(/report ready/i)).toBeInTheDocument();
    expect(screen.getByText(/margin comment/i)).toBeInTheDocument();

    // Both reactions had valid sceneId + in-range quotes → both posted as kind:'beta' comments.
    const comments = commentsStore.list('story-1');
    expect(comments).toHaveLength(2);
    expect(comments.every((c) => c.kind === 'beta')).toBe(true);
    expect(comments.map((c) => c.sceneId)).toEqual(['s1', 's1']);
  });

  it('does not post a margin comment for a reaction whose sceneId no longer resolves', async () => {
    mockBetaReportRun.mockResolvedValue({
      report: { ...REPORT, reactions: [{ id: 'r1', kind: 'loved', sceneId: 'gone', quote: 'x'.repeat(10), where: '', note: '' }] },
    });
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^run$/i }));
    await waitFor(() => expect(mockBetaReportRun).toHaveBeenCalled());
    await screen.findByText(/report ready/i);
    expect(commentsStore.list('story-1')).toHaveLength(0);
  });

  it('surfaces a run failure as an error toast without touching the report state', async () => {
    mockBetaReportRun.mockRejectedValue(new Error('Beta Reader hit its hourly budget cap.'));
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^run$/i }));
    expect(await screen.findByText(/hourly budget cap/i)).toBeInTheDocument();
    expect(screen.getByText(/no beta reads yet/i)).toBeInTheDocument();
  });

  it('lists BETA READS history and loads a report on click', async () => {
    const summaryA = { id: 'report-a', storyId: 'story-1', scope: { kind: 'scene' as const, id: 's1', label: 'Scene: Arrival' }, overall: { score: 70, verdict: 'mixed' as const }, createdAt: '2026-07-14T00:00:00.000Z' };
    const summaryB = { id: 'report-1', storyId: 'story-1', scope: REPORT.scope, overall: REPORT.overall, createdAt: REPORT.createdAt };
    mockBetaReportList.mockResolvedValue({ reports: [summaryB, summaryA] });
    mockBetaReportGet.mockImplementation((id: string) =>
      Promise.resolve({ report: id === 'report-1' ? REPORT : { ...REPORT, id: 'report-a', feedback: 'A different read.' } }));

    await renderPage();
    // Feedback text renders both in the main report column and the right-column
    // "General feedback" card (by design) — assert both copies are present.
    await waitFor(() => expect(screen.getAllByText('Strong opening chapter.')).toHaveLength(2));

    fireEvent.click(within(screen.getByRole('list')).getByText('Scene: Arrival'));
    await waitFor(() => expect(screen.getAllByText('A different read.')).toHaveLength(2));
    expect(mockBetaReportGet).toHaveBeenCalledWith('report-a');
  });

  it('toggles the 4 focus areas independently', async () => {
    await renderPage();
    const pacing = screen.getByRole('button', { name: 'Pacing' });
    const clarity = screen.getByRole('button', { name: 'Clarity' });
    expect(pacing).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(pacing);
    expect(pacing).toHaveAttribute('aria-pressed', 'false');
    expect(clarity).toHaveAttribute('aria-pressed', 'true');
  });

  it('scope select offers scene, chapter, and story options', async () => {
    await renderPage();
    const select = screen.getByLabelText(/what to read/i) as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toEqual(['Scene: Arrival', 'Chapter: Chapter 1', 'Full story']);
  });
});

describe('BetaReaderPage — Chat page', () => {
  it('renders the session picker and streams a reply to a sent message', async () => {
    mockStreamStart.mockResolvedValue({ streamId: 'stream-1' });
    await renderPage();

    fireEvent.click(screen.getByRole('tab', { name: /chat/i }));
    const input = screen.getByLabelText(/message the beta reader/i);
    fireEvent.change(input, { target: { value: 'How did chapter 2 land?' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(mockStreamStart).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(tokenCb).not.toBeNull());

    await act(async () => {
      tokenCb?.({ streamId: 'stream-1', token: 'It landed ' });
      tokenCb?.({ streamId: 'stream-1', token: 'well!' });
      endCb?.({ streamId: 'stream-1' });
    });

    expect(await screen.findByText('It landed well!')).toBeInTheDocument();
    expect(screen.getByText('How did chapter 2 land?')).toBeInTheDocument();
  });

  it('sends a chip prompt directly without typing', async () => {
    mockStreamStart.mockResolvedValue({ streamId: 'stream-2' });
    await renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /chat/i }));

    fireEvent.click(screen.getByText('Where did you get bored?'));
    await waitFor(() => expect(mockStreamStart).toHaveBeenCalledTimes(1));
    expect(mockStreamStart.mock.calls[0][0].messages.at(-1)).toEqual({ role: 'user', content: 'Where did you get bored?' });
  });

  it('surfaces a stream error without crashing', async () => {
    mockStreamStart.mockResolvedValue({ streamId: 'stream-3' });
    await renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /chat/i }));
    fireEvent.change(screen.getByLabelText(/message the beta reader/i), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(errorCb).not.toBeNull());
    act(() => errorCb?.({ streamId: 'stream-3', error: 'No API key configured.' }));
    expect(await screen.findByText(/no api key configured/i)).toBeInTheDocument();
  });
});

describe('BetaReaderPage — close + navigation', () => {
  it('calls onClose when the close button is clicked', async () => {
    const { onClose } = await renderPage();
    fireEvent.click(screen.getByRole('button', { name: /close beta reader/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('"Show in manuscript" navigates to the reaction scene and closes the overlay', async () => {
    mockBetaReportRun.mockResolvedValue({ report: REPORT });
    const onNavigateToScene = vi.fn();
    const { onClose } = await renderPage({ onNavigateToScene });
    fireEvent.click(screen.getByRole('button', { name: /^run$/i }));
    await screen.findByText(/great imagery/i);

    const [firstCard] = screen.getAllByText('Show in manuscript');
    fireEvent.click(firstCard);
    expect(onNavigateToScene).toHaveBeenCalledWith('s1', 'c1');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
