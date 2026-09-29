import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import BetaReaderPage from './BetaReaderPage';
import { commentsStore } from '../comments';
import { __resetAgentSessionStores } from '../lib/useAgentSessions';
import type { Story, Chapter, Scene } from '../types';

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

function buildApi(overrides: Record<string, unknown> = {}) {
  return {
    betaReportList: mockBetaReportList,
    betaReportGet: mockBetaReportGet,
    betaReportRun: mockBetaReportRun,
    streamStart: vi.fn().mockResolvedValue({ streamId: 'unused' }),
    streamAck: vi.fn(),
    onStreamToken: () => () => {},
    onStreamEnd: () => () => {},
    onStreamError: () => () => {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBetaReportList.mockResolvedValue({ reports: [] });
  mockBetaReportGet.mockResolvedValue({ report: null });
  __resetAgentSessionStores();
  const session = {
    id: 's1',
    agent: 'brainstorm',
    title: 'Chat',
    turns: [] as AgentSessionTurn[],
    startedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  (window as unknown as { api: unknown }).api = buildApi({
    agentBrainstorm: vi.fn().mockResolvedValue({ text: 'It landed well!' }),
    agentSessions: {
      list: vi.fn().mockResolvedValue({
        sessions: [{ id: 's1', agent: 'brainstorm', title: 'Chat', startedAt: session.startedAt, updatedAt: session.updatedAt, turnCount: 0, relPath: 'Sessions/x.md' }],
      }),
      read: vi.fn().mockResolvedValue({ session }),
      create: vi.fn().mockResolvedValue({ session, relPath: 'Sessions/x.md' }),
      appendTurns: vi.fn().mockImplementation(async (_id: string, turns: AgentSessionTurn[]) => {
        session.turns = [...session.turns, ...turns];
        return { session: { ...session } };
      }),
      rename: vi.fn().mockResolvedValue({ ok: true }),
      duplicate: vi.fn().mockResolvedValue({ session, relPath: 'Sessions/x.md' }),
      delete: vi.fn().mockResolvedValue({ ok: true }),
    },
  });
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

describe('BetaReaderPage — Chat page (F3#1 shared partner thread)', () => {
  it('renders MiniAgentChat on the partner thread and sends via agentBrainstorm', async () => {
    await renderPage();

    fireEvent.click(screen.getByRole('tab', { name: /chat/i }));
    expect(screen.getByTestId('beta-partner-chat')).toBeInTheDocument();
    // Page header owns identity — chat must not add a second partner-avatar.
    expect(screen.queryAllByTestId('partner-avatar')).toHaveLength(0);
    const input = screen.getByTestId('beta-partner-chat-input');
    fireEvent.change(input, { target: { value: 'How did chapter 2 land?' } });
    fireEvent.click(screen.getByTestId('beta-partner-chat-send'));

    const api = (window as unknown as { api: { agentBrainstorm: ReturnType<typeof vi.fn> } }).api;
    await waitFor(() => expect(api.agentBrainstorm).toHaveBeenCalled());
    expect(await screen.findByText('How did chapter 2 land?')).toBeInTheDocument();
    expect(await screen.findByText('It landed well!')).toBeInTheDocument();
  });

  it('Send stays disabled for an empty draft', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /chat/i }));
    expect(screen.getByTestId('beta-partner-chat-send')).toBeDisabled();
    fireEvent.change(screen.getByTestId('beta-partner-chat-input'), { target: { value: 'hi' } });
    expect(screen.getByTestId('beta-partner-chat-send')).not.toBeDisabled();
  });

  it('surfaces a brainstorm error without crashing', async () => {
    const api = (window as unknown as { api: { agentBrainstorm: ReturnType<typeof vi.fn> } }).api;
    api.agentBrainstorm = vi.fn().mockRejectedValue(new Error('No API key configured.'));
    await renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /chat/i }));
    fireEvent.change(screen.getByTestId('beta-partner-chat-input'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByTestId('beta-partner-chat-send'));
    expect(await screen.findByTestId('beta-partner-chat-error')).toHaveTextContent(/no api key configured/i);
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
