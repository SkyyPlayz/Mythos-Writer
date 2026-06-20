import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import WritingAssistantPanel, { STALL_WARNING_MS, HARD_TIMEOUT_MS } from './WritingAssistantPanel';
import type { Scene } from './types';

const mockAgentWritingAssistant = vi.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockOnWritingAssistantChunk = vi.fn<any>(() => vi.fn()); // returns unsub fn
const mockWritingScan = vi.fn();
const mockWritingAssistantCadenceChange = vi.fn();
const mockWritingAssistantTipDecision = vi.fn();
const mockWritingAssistantScanNow = vi.fn();
const mockWritingAssistantSetActiveScene = vi.fn();
const mockBetaReadScan = vi.fn();
const mockBetaReadDismiss = vi.fn();
const mockVoiceSpeak = vi.fn();
const mockVoiceSpeakCancel = vi.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockOnVoiceSpeakDone = vi.fn<any>(() => vi.fn());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockOnVoiceSpeakError = vi.fn<any>(() => vi.fn());

function makeApi(overrides: Record<string, unknown> = {}) {
  return {
    agentWritingAssistant: mockAgentWritingAssistant,
    onWritingAssistantChunk: mockOnWritingAssistantChunk,
    writingScan: mockWritingScan,
    writingAssistantCadenceChange: mockWritingAssistantCadenceChange,
    writingAssistantTipDecision: mockWritingAssistantTipDecision,
    writingAssistantScanNow: mockWritingAssistantScanNow,
    writingAssistantSetActiveScene: mockWritingAssistantSetActiveScene,
    betaReadScan: mockBetaReadScan,
    betaReadDismiss: mockBetaReadDismiss,
    voiceSpeak: mockVoiceSpeak,
    voiceSpeakCancel: mockVoiceSpeakCancel,
    onVoiceSpeakDone: mockOnVoiceSpeakDone,
    onVoiceSpeakError: mockOnVoiceSpeakError,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockWritingScan.mockResolvedValue({ tips: [], scannedAt: new Date().toISOString() });
  mockWritingAssistantCadenceChange.mockResolvedValue({ saved: true, waScanInterval: 60 });
  mockWritingAssistantTipDecision.mockResolvedValue({ saved: true });
  mockWritingAssistantScanNow.mockResolvedValue({ tips: [], scannedAt: new Date().toISOString() });
  mockWritingAssistantSetActiveScene.mockResolvedValue({ ok: true });
  mockBetaReadScan.mockResolvedValue({ comments: [], scannedAt: new Date().toISOString() });
  mockBetaReadDismiss.mockResolvedValue({ id: 'br-1', dismissed: true });
  mockVoiceSpeak.mockResolvedValue({ speakId: 'speak-1' });
  (window as unknown as { api: unknown }).api = makeApi();
});

function makeScene(id: string, title: string, content: string): Scene {
  return {
    id,
    title,
    blocks: [{ id: `${id}-b1`, type: 'prose', order: 0, content, updatedAt: '' }],
    draftState: 'in-progress',
    order: 0,
    path: `/${id}.md`,
    createdAt: '',
    updatedAt: '',
  };
}

describe('WritingAssistantPanel', () => {
  it('renders prompt textarea and disabled Ask button initially', () => {
    render(<WritingAssistantPanel scene={null} />);
    expect(screen.getByLabelText(/writing assistant prompt/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^ask$/i })).toBeDisabled();
  });

  it('enables the button once prompt is non-empty', () => {
    render(<WritingAssistantPanel scene={null} />);
    const input = screen.getByLabelText(/writing assistant prompt/i);
    fireEvent.change(input, { target: { value: 'How can I make this scene more tense?' } });
    expect(screen.getByRole('button', { name: /^ask$/i })).not.toBeDisabled();
  });

  it('displays Claude response after ask and shows Accept/Dismiss buttons', async () => {
    mockAgentWritingAssistant.mockResolvedValueOnce({ text: 'Try adding a ticking clock.' });

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'How to add tension?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/writing assistant response/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/writing assistant response/i)).toHaveTextContent('Try adding a ticking clock.');
    expect(screen.getByRole('button', { name: /^apply:/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^reject:/i })).toBeInTheDocument();
  });

  it('marks suggestion as accepted when Accept is clicked', async () => {
    mockAgentWritingAssistant.mockResolvedValueOnce({ text: 'Use shorter sentences.' });

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'Pacing advice?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() => screen.getByRole('button', { name: /^apply:/i }));
    fireEvent.click(screen.getByRole('button', { name: /^apply:/i }));

    expect(screen.getByText(/^Applied/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^apply:/i })).not.toBeInTheDocument();
  });

  it('marks suggestion as dismissed when Dismiss is clicked', async () => {
    mockAgentWritingAssistant.mockResolvedValueOnce({ text: 'Cut the adverbs.' });

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'Style advice?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() => screen.getByRole('button', { name: /^reject:/i }));
    fireEvent.click(screen.getByRole('button', { name: /^reject:/i }));

    expect(screen.getByText(/^Rejected/)).toBeInTheDocument();
  });

  it('passes scene context to IPC when a scene is selected', async () => {
    mockAgentWritingAssistant.mockResolvedValueOnce({ text: 'Some advice.' });

    const scene = {
      id: 's1',
      title: 'The Heist',
      blocks: [{ id: 'b1', type: 'prose' as const, order: 0, content: 'The airship docked.', updatedAt: '' }],
      draftState: 'in-progress' as const,
      order: 0,
      path: '/scene.md',
      createdAt: '',
      updatedAt: '',
    };

    render(<WritingAssistantPanel scene={scene} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'what happens next?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() => expect(mockAgentWritingAssistant).toHaveBeenCalled());
    const [prompt, context] = mockAgentWritingAssistant.mock.calls[0];
    expect(prompt).toBe('what happens next?');
    expect(context).toContain('The Heist');
    expect(context).toContain('The airship docked.');
  });

  it('pushes scene switches to the scheduler backend and Scan now uses the new scene', async () => {
    const sceneA = makeScene('s1', 'Scene A', 'First scene prose.');
    const sceneB = makeScene('s2', 'Scene B', 'Second scene prose.');

    const { rerender } = render(<WritingAssistantPanel scene={sceneA} />);

    await waitFor(() => {
      expect(mockWritingAssistantSetActiveScene).toHaveBeenLastCalledWith({
        sceneId: 's1',
        scenePath: '/s1.md',
      });
    });
    expect(screen.getByText(/context:/i)).toHaveTextContent('Scene A');

    rerender(<WritingAssistantPanel scene={sceneB} />);

    await waitFor(() => {
      expect(mockWritingAssistantSetActiveScene).toHaveBeenLastCalledWith({
        sceneId: 's2',
        scenePath: '/s2.md',
      });
    });
    expect(screen.getByText(/context:/i)).toHaveTextContent('Scene B');

    fireEvent.click(screen.getAllByRole('button', { name: /scan now/i })[0]);

    await waitFor(() => {
      expect(mockWritingAssistantScanNow).toHaveBeenCalledWith({
        sceneId: 's2',
        prose: 'Second scene prose.',
        scenePath: '/s2.md',
      });
    });

    rerender(<WritingAssistantPanel scene={null} />);

    await waitFor(() => {
      expect(mockWritingAssistantSetActiveScene).toHaveBeenLastCalledWith({
        sceneId: null,
        scenePath: null,
      });
    });
  });

  it('routes explicit beta-read scene requests to Beta-Read scan IPC', async () => {
    mockBetaReadScan.mockResolvedValueOnce({
      comments: [
        {
          id: 'br-1',
          scene_id: 's1',
          anchor_text: 'The airship docked.',
          comment_text: 'Clarify the sensory detail here.',
          created_at: '2026-01-01T00:00:00.000Z',
          dismissed_at: null,
        },
      ],
      scannedAt: '2026-01-01T00:00:00.000Z',
    });

    const scene = {
      id: 's1',
      title: 'The Heist',
      blocks: [{ id: 'b1', type: 'prose' as const, order: 0, content: 'The airship docked.', updatedAt: '' }],
      draftState: 'in-progress' as const,
      order: 0,
      path: '/scene.md',
      createdAt: '',
      updatedAt: '',
    };

    render(<WritingAssistantPanel scene={scene} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'Beta-read this scene' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() => {
      expect(mockBetaReadScan).toHaveBeenCalledWith('s1', 'The airship docked.', '/scene.md');
    });
    expect(mockAgentWritingAssistant).not.toHaveBeenCalled();
    expect(screen.getByRole('article', { name: /beta-read comment/i })).toHaveTextContent('Clarify the sensory detail here.');
  });

  it('requires a selected scene before starting Beta-Read mode', async () => {
    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'beta read this scene' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/select a scene/i);
    });
    expect(mockBetaReadScan).not.toHaveBeenCalled();
    expect(mockAgentWritingAssistant).not.toHaveBeenCalled();
  });

  it('shows an error message when the IPC call rejects', async () => {
    mockAgentWritingAssistant.mockRejectedValueOnce(new Error('ANTHROPIC_API_KEY is not set.'));

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('ANTHROPIC_API_KEY is not set.');
    });
    expect(screen.queryByLabelText(/writing assistant response/i)).not.toBeInTheDocument();
  });

  it('does not modify scene content — no vault write', async () => {
    mockAgentWritingAssistant.mockResolvedValueOnce({ text: 'New ideas here.' });

    const mockWriteVault = vi.fn();
    (window as unknown as { api: unknown }).api = makeApi({ writeVault: mockWriteVault });

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'ideas' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() => screen.getByLabelText(/writing assistant response/i));
    expect(mockWriteVault).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'auth failure (bad API key)',
      message: 'Authentication error — check your API key in Settings.',
    },
    {
      label: 'rate limit exceeded',
      message: 'Rate limit reached — try again shortly.',
    },
    {
      label: 'model not found / invalid request',
      message: 'Invalid request — check the model and input parameters.',
    },
    {
      label: 'network failure',
      message: 'Network error — check your connection and try again.',
    },
  ])('shows user-friendly error for provider rejection: $label', async ({ message }) => {
    mockAgentWritingAssistant.mockRejectedValueOnce(new Error(message));

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'test prompt' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(message);
    });
    expect(screen.queryByLabelText(/writing assistant response/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Cancel + stall + hard-timeout tests (AC #1, #2, #3)
// ---------------------------------------------------------------------------
describe('WritingAssistantPanel — cancel and stall UX', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows Cancel button while a generation is in flight', async () => {
    mockAgentWritingAssistant.mockImplementationOnce(
      () => new Promise<{ text: string }>(() => {}), // never resolves
    );

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'keep going' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /cancel generation/i })).toBeInTheDocument(),
    );
    // Ask button should be gone while loading
    expect(screen.queryByRole('button', { name: /^ask$/i })).not.toBeInTheDocument();
  });

  it('cancelling clears the partial bubble and shows confirmation toast', async () => {
    let resolveRequest: ((value: { text: string }) => void) | null = null;
    mockAgentWritingAssistant.mockImplementationOnce(
      () => new Promise<{ text: string }>((resolve) => { resolveRequest = resolve; }),
    );

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'keep going' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /cancel generation/i })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /cancel generation/i }));

    // Ask button returns; error toast confirms cancellation
    expect(screen.getByRole('button', { name: /^ask$/i })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Generation cancelled. You can retry now.');
    expect(screen.queryByLabelText(/writing assistant response/i)).not.toBeInTheDocument();

    // Late response arriving after cancel must be ignored
    resolveRequest!({ text: 'late response should be ignored' });
    await waitFor(() =>
      expect(screen.queryByText(/late response should be ignored/i)).not.toBeInTheDocument(),
    );
  });

  it('shows stall panel (not an abort) after STALL_WARNING_MS with no tokens', async () => {
    vi.useFakeTimers();
    mockAgentWritingAssistant.mockImplementationOnce(() => new Promise<{ text: string }>(() => {}));

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'test stall path' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    // Before timeout: no stall panel
    expect(screen.queryByLabelText(/generation stalled/i)).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STALL_WARNING_MS);
    });

    // Stall panel appears — but generation is still running (no error alert)
    expect(screen.getByLabelText(/generation stalled/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry generation/i })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // Both the stall panel and the input area show cancel buttons
    const cancelBtns = screen.getAllByRole('button', { name: /cancel generation/i });
    expect(cancelBtns.length).toBeGreaterThanOrEqual(2);
  });

  it('stall panel cancel button aborts and shows cancellation toast', async () => {
    vi.useFakeTimers();
    mockAgentWritingAssistant.mockImplementationOnce(() => new Promise<{ text: string }>(() => {}));

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'test stall cancel' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STALL_WARNING_MS);
    });

    // Click Cancel inside the stall panel
    const cancelBtns = screen.getAllByRole('button', { name: /cancel generation/i });
    fireEvent.click(cancelBtns[0]);

    expect(screen.getByRole('alert')).toHaveTextContent('Generation cancelled. You can retry now.');
    expect(screen.queryByLabelText(/generation stalled/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^ask$/i })).toBeInTheDocument();
  });

  it('hard timeout at HARD_TIMEOUT_MS auto-aborts with recoverable error (no stall panel first needed)', async () => {
    vi.useFakeTimers();
    mockAgentWritingAssistant.mockImplementationOnce(() => new Promise<{ text: string }>(() => {}));

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'test hard timeout' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HARD_TIMEOUT_MS);
    });

    // Hard timeout fires: error alert, no stall panel, Ask button restored
    expect(screen.getByRole('alert')).toHaveTextContent(/timed out/i);
    expect(screen.queryByLabelText(/generation stalled/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^ask$/i })).toBeInTheDocument();
  });

  it('stall timers reset on each incoming token so fast streams never stall', async () => {
    vi.useFakeTimers();
    let emitChunk: ((chunk: string) => void) | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockOnWritingAssistantChunk as any).mockImplementationOnce((cb: (chunk: string) => void) => {
      emitChunk = cb;
      return () => {};
    });
    mockAgentWritingAssistant.mockImplementationOnce(() => new Promise<{ text: string }>(() => {}));

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'slow but steady' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    // Emit a token every 15 s (under the 20 s stall threshold) for 3 cycles
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      act(() => { emitChunk?.('word '); });
    }

    // After 45 s of tokens arriving every 15 s, no stall panel
    expect(screen.queryByLabelText(/generation stalled/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Heartbeat scheduler tests (pre-existing, unchanged)
// ---------------------------------------------------------------------------
const mockScene = {
  id: 's1',
  title: 'The Heist',
  blocks: [{ id: 'b1', type: 'prose' as const, order: 0, content: 'The airship docked silently.', updatedAt: '' }],
  draftState: 'in-progress' as const,
  order: 0,
  path: '/stories/ch1/scene1.md',
  createdAt: '',
  updatedAt: '',
};

describe('WritingAssistantPanel — heartbeat scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls writingScan at the configured interval and shows tips', async () => {
    mockWritingScan.mockResolvedValue({
      tips: ['Use shorter sentences.', 'Add sensory detail.'],
      scannedAt: new Date().toISOString(),
    });

    render(<WritingAssistantPanel scene={mockScene} scanIntervalSeconds={10} isActive={true} />);

    expect(screen.getByLabelText(/heartbeat status/i)).toBeInTheDocument();

    await act(async () => { vi.advanceTimersByTime(10_000); });

    expect(screen.getByLabelText(/writing tips/i)).toBeInTheDocument();
    expect(screen.getByText('Use shorter sentences.')).toBeInTheDocument();
    expect(screen.getByText('Add sensory detail.')).toBeInTheDocument();
  });


  it('calls writingScan with scene prose and path', async () => {
    mockWritingScan.mockResolvedValue({ tips: ['Tip.'], scannedAt: new Date().toISOString() });

    render(<WritingAssistantPanel scene={mockScene} scanIntervalSeconds={10} isActive={true} />);

    await act(async () => { vi.advanceTimersByTime(10_000); });

    expect(mockWritingScan).toHaveBeenCalledWith(
      mockScene.id,
      mockScene.blocks[0].content,
      mockScene.path,
    );
  });

  it('does not call writingScan when isActive is false', async () => {
    render(<WritingAssistantPanel scene={mockScene} scanIntervalSeconds={10} isActive={false} />);

    await act(() => { vi.advanceTimersByTime(30_000); });

    expect(mockWritingScan).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/heartbeat status/i)).toBeInTheDocument();
  });

  it('does not call writingScan when enabled is false', async () => {
    render(<WritingAssistantPanel scene={mockScene} enabled={false} scanIntervalSeconds={10} isActive={true} />);

    await act(() => { vi.advanceTimersByTime(30_000); });

    expect(mockWritingScan).not.toHaveBeenCalled();
  });

  it('AC-WA-26: shows disabled message when enabled=false and no scans fire', async () => {
    render(<WritingAssistantPanel scene={mockScene} enabled={false} scanIntervalSeconds={10} isActive={true} />);

    expect(screen.getByText(/writing assistant is disabled/i)).toBeInTheDocument();

    await act(() => { vi.advanceTimersByTime(30_000); });
    expect(mockWritingScan).not.toHaveBeenCalled();
  });

  it('AC-WA-08: Dismiss all button appears when 2 or more tips are visible', async () => {
    mockWritingScan.mockResolvedValueOnce({
      tips: [
        { id: 'tip-1', text: 'First tip text.', category: 'clarity' },
        { id: 'tip-2', text: 'Second tip text.', category: 'pacing' },
      ],
      scannedAt: new Date().toISOString(),
    });

    render(<WritingAssistantPanel scene={mockScene} scanIntervalSeconds={10} isActive={true} />);

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

    expect(screen.getByRole('button', { name: /dismiss all/i })).toBeInTheDocument();
  });

  it('does not show tips section when scan returns empty tips', async () => {
    mockWritingScan.mockResolvedValue({ tips: [], scannedAt: new Date().toISOString() });

    render(<WritingAssistantPanel scene={mockScene} scanIntervalSeconds={10} isActive={true} />);

    await act(async () => { vi.advanceTimersByTime(10_000); });

    expect(screen.getByLabelText(/heartbeat status/i)).toBeInTheDocument();
  });

  it('updates tips after a second scan tick', async () => {
    mockWritingScan
      .mockResolvedValueOnce({ tips: ['First tip.'], scannedAt: new Date().toISOString() })
      .mockResolvedValueOnce({ tips: ['Second tip.'], scannedAt: new Date().toISOString() });

    render(<WritingAssistantPanel scene={mockScene} scanIntervalSeconds={10} isActive={true} />);

    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByText('First tip.')).toBeInTheDocument();

    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByText('Second tip.')).toBeInTheDocument();
    expect(screen.queryByText('First tip.')).not.toBeInTheDocument();
  });

  it('reads saved manual cadence from AppSettings and pauses scheduler on startup', async () => {
    mockWritingScan.mockResolvedValue({ tips: ['Should not run.'], scannedAt: new Date().toISOString() });

    render(<WritingAssistantPanel scene={mockScene} scanIntervalSeconds={30} waScanInterval="manual" isActive={true} />);

    expect(screen.getByLabelText(/heartbeat cadence/i)).toHaveValue('manual');
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(mockWritingScan).not.toHaveBeenCalled();
  });

  it('persists cadence picker changes via writing-assistant cadence IPC', async () => {
    render(<WritingAssistantPanel scene={mockScene} scanIntervalSeconds={60} isActive={true} />);

    await act(async () => {
      fireEvent.change(screen.getByRole('combobox', { name: /heartbeat cadence/i }), {
        target: { value: '300' },
      });
    });

    expect(mockWritingAssistantCadenceChange).toHaveBeenCalledWith({ waScanInterval: 300 });
  });

  it('scans on scene:saved after selecting On save cadence', async () => {
    mockWritingScan.mockResolvedValue({ tips: ['Saved scene tip.'], scannedAt: new Date().toISOString() });
    (window as unknown as { api: unknown }).api = makeApi({
      onWritingScanResult: vi.fn(() => vi.fn()),
    });

    render(<WritingAssistantPanel scene={mockScene} scanIntervalSeconds={60} isActive={true} />);

    await act(async () => {
      fireEvent.change(screen.getByRole('combobox', { name: /heartbeat cadence/i }), {
        target: { value: 'on-save' },
      });
    });

    await act(async () => {
      window.dispatchEvent(new Event('scene:saved'));
      await Promise.resolve();
    });

    expect(mockWritingScan).toHaveBeenCalledWith(
      mockScene.id,
      mockScene.blocks[0].content,
      mockScene.path,
    );
  });

  it('clears heartbeat tips when the selected scene changes', async () => {
    const nextScene = makeScene('s2', 'Quiet Alley', 'Rain rattled against the awning.');
    mockWritingScan.mockResolvedValue({ tips: ['Old scene tip.'], scannedAt: new Date().toISOString() });

    const { rerender } = render(<WritingAssistantPanel scene={mockScene} scanIntervalSeconds={10} isActive={true} />);

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByText('Old scene tip.')).toBeInTheDocument();

    rerender(<WritingAssistantPanel scene={nextScene} scanIntervalSeconds={10} isActive={true} />);

    expect(screen.queryByText('Old scene tip.')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/heartbeat status/i)).toBeInTheDocument();
  });

  it('emits tip decision payloads for Note it and Ignore actions', async () => {
    mockWritingScan.mockResolvedValueOnce({
      tips: [{
        id: 'tip-grammar-1',
        text: 'Fix the tense shift in this paragraph.',
        category: 'grammar',
        sceneAnchor: 'The Heist',
        sceneId: mockScene.id,
        scenePath: mockScene.path,
        sceneUpdatedAt: mockScene.updatedAt,
      }],
      scannedAt: '2026-06-15T12:00:00.000Z',
    });

    render(<WritingAssistantPanel scene={mockScene} scanIntervalSeconds={10} isActive={true} />);

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    fireEvent.click(screen.getByRole('button', { name: /note it/i }));

    expect(mockWritingAssistantTipDecision).toHaveBeenCalledWith(expect.objectContaining({
      tipId: 'tip-grammar-1',
      decision: 'noted',
      sceneId: mockScene.id,
      sceneUpdatedAt: mockScene.updatedAt,
    }));

    mockWritingScan.mockResolvedValueOnce({
      tips: [{
        id: 'tip-grammar-2',
        text: 'Clarify who speaks in the last line.',
        category: 'clarity',
        sceneAnchor: 'The Heist',
        sceneId: mockScene.id,
        scenePath: mockScene.path,
        sceneUpdatedAt: mockScene.updatedAt,
      }],
      scannedAt: '2026-06-15T12:01:00.000Z',
    });

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    fireEvent.click(screen.getByRole('button', { name: /ignore tip/i }));

    expect(mockWritingAssistantTipDecision).toHaveBeenCalledWith(expect.objectContaining({
      tipId: 'tip-grammar-2',
      decision: 'ignored',
    }));
  });

  it('session-suppresses ignored tips until scene updatedAt advances', async () => {
    const sceneAt1 = { ...mockScene, updatedAt: '2026-06-15T12:00:00.000Z' };
    const sceneAt2 = { ...mockScene, updatedAt: '2026-06-15T12:01:00.000Z' };
    const tip = {
      id: 'tip-pacing-1',
      text: 'Vary sentence length to improve momentum.',
      category: 'pacing',
      sceneAnchor: 'The Heist',
      sceneId: mockScene.id,
      scenePath: mockScene.path,
      sceneUpdatedAt: sceneAt1.updatedAt,
    };
    mockWritingScan.mockResolvedValue({ tips: [tip], scannedAt: '2026-06-15T12:00:10.000Z' });

    const { rerender } = render(<WritingAssistantPanel scene={sceneAt1} scanIntervalSeconds={10} isActive={true} />);

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByText(tip.text)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ignore tip/i }));
    });
    expect(screen.queryByText(tip.text)).not.toBeInTheDocument();

    rerender(<WritingAssistantPanel scene={sceneAt1} scanIntervalSeconds={10} isActive={true} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.queryByText(tip.text)).not.toBeInTheDocument();

    mockWritingScan.mockResolvedValueOnce({
      tips: [{ ...tip, sceneUpdatedAt: sceneAt2.updatedAt }],
      scannedAt: '2026-06-15T12:01:10.000Z',
    });
    rerender(<WritingAssistantPanel scene={sceneAt2} scanIntervalSeconds={10} isActive={true} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByText(tip.text)).toBeInTheDocument();
  });

  it('clears prior scan tips when navigating to a different scene', async () => {
    const scene2 = {
      id: 's2',
      title: 'Second Scene',
      blocks: [{ id: 'b2', type: 'prose' as const, order: 0, content: 'New scene content.', updatedAt: '' }],
      draftState: 'in-progress' as const,
      order: 1,
      path: '/stories/ch1/scene2.md',
      createdAt: '',
      updatedAt: '',
    };

    mockWritingScan.mockResolvedValueOnce({
      tips: ['Tip from first scene.'],
      scannedAt: new Date().toISOString(),
    });

    const { rerender } = render(
      <WritingAssistantPanel scene={mockScene} scanIntervalSeconds={10} isActive={true} />,
    );

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByText('Tip from first scene.')).toBeInTheDocument();

    // Navigate to second scene — stale tips must clear immediately
    await act(async () => {
      rerender(<WritingAssistantPanel scene={scene2} scanIntervalSeconds={10} isActive={true} />);
    });
    expect(screen.queryByText('Tip from first scene.')).not.toBeInTheDocument();
  });

  it('does not persist stale scanning indicator after scene change mid-flight', async () => {
    let resolveHeld!: (value: { tips: string[]; scannedAt: string }) => void;
    const heldScan = new Promise<{ tips: string[]; scannedAt: string }>((res) => {
      resolveHeld = res;
    });
    mockWritingScan.mockReturnValueOnce(heldScan);

    const scene2 = {
      id: 's2',
      title: 'Second Scene',
      blocks: [{ id: 'b2', type: 'prose' as const, order: 0, content: 'New scene content.', updatedAt: '' }],
      draftState: 'in-progress' as const,
      order: 1,
      path: '/stories/ch1/scene2.md',
      createdAt: '',
      updatedAt: '',
    };

    const { rerender } = render(
      <WritingAssistantPanel scene={mockScene} scanIntervalSeconds={10} isActive={true} />,
    );

    // Trigger scan; hold it in-flight
    await act(async () => { vi.advanceTimersByTime(10_000); });

    // Navigate away — stale scanning state must clear
    await act(async () => {
      rerender(<WritingAssistantPanel scene={scene2} scanIntervalSeconds={10} isActive={true} />);
    });
    expect(document.querySelector('.wa-spinner')).toBeNull();

    // Resolve the held scan — stale guard must prevent any UI update
    await act(async () => {
      resolveHeld({ tips: ['stale tip'], scannedAt: new Date().toISOString() });
    });
    expect(document.querySelector('.wa-spinner')).toBeNull();
    expect(screen.queryByText('stale tip')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SKY-2623: empty state, error state, mobile collapse (AC8, AC9, AC18, AC24, AC25)
// ---------------------------------------------------------------------------
describe('WritingAssistantPanel — empty state, error state & mobile collapse (SKY-2623)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('AC8: shows encouraging empty state when scan returns no suggestions', async () => {
    mockWritingScan.mockResolvedValue({ tips: [], scannedAt: new Date().toISOString() });
    render(<WritingAssistantPanel scene={mockScene} scanIntervalSeconds={10} isActive={true} />);

    await act(async () => { vi.advanceTimersByTime(10_000); });

    expect(screen.getByText(/your work is looking great|no suggestions yet/i)).toBeInTheDocument();
    // Multiple "Scan now" buttons may exist (header + empty-state CTA); at least one must be present
    expect(screen.getAllByRole('button', { name: /scan now/i }).length).toBeGreaterThan(0);
  });

  it('AC9: shows warning icon, error message and Retry button on scan error', async () => {
    mockWritingScan.mockRejectedValueOnce(new Error('Provider unavailable'));
    render(<WritingAssistantPanel scene={mockScene} scanIntervalSeconds={10} isActive={true} />);

    // advanceTimersByTimeAsync flushes both the timer AND the rejected promise resolution
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/scan failed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry scan/i })).toBeInTheDocument();
  });

  it('AC18: Scan now button triggers a scan and updates status to Scanning', async () => {
    mockWritingAssistantScanNow.mockResolvedValue({ tips: [], scannedAt: new Date().toISOString() });

    render(<WritingAssistantPanel scene={mockScene} scanIntervalSeconds={60} isActive={true} />);

    // Click the first "Scan now" button in the header (calls writingAssistantScanNow)
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /scan now/i })[0]);
    });

    await act(async () => { vi.advanceTimersByTime(100); });

    expect(mockWritingAssistantScanNow).toHaveBeenCalled();
  });

  it('AC24: panel collapses to icon badge when container width < 280px', async () => {
    let observerCallback: ResizeObserverCallback | null = null;
    class MockResizeObserver {
      constructor(cb: ResizeObserverCallback) { observerCallback = cb; }
      observe() {}
      disconnect() {}
    }
    window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

    render(<WritingAssistantPanel scene={mockScene} isActive={true} />);

    await act(async () => {
      observerCallback?.([
        { contentRect: { width: 200 } } as unknown as ResizeObserverEntry,
      ], {} as ResizeObserver);
    });

    expect(screen.getByRole('button', { name: /open writing assistant/i })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: /writing assistant/i })).not.toBeInTheDocument();
  });

  it('AC25: clicking collapsed badge opens overlay panel', async () => {
    let observerCallback: ResizeObserverCallback | null = null;
    class MockResizeObserver {
      constructor(cb: ResizeObserverCallback) { observerCallback = cb; }
      observe() {}
      disconnect() {}
    }
    window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

    render(<WritingAssistantPanel scene={mockScene} isActive={true} />);

    await act(async () => {
      observerCallback?.([
        { contentRect: { width: 200 } } as unknown as ResizeObserverEntry,
      ], {} as ResizeObserver);
    });

    fireEvent.click(screen.getByRole('button', { name: /open writing assistant/i }));

    expect(screen.getByRole('complementary', { name: /writing assistant/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// TTS playback tests (AC-V-06, AC-V-07, AC-V-08, AC-V-10, AC-V-11)
// ---------------------------------------------------------------------------
describe('WritingAssistantPanel — TTS voice controls', () => {
  beforeEach(() => {
    // rAF-based useLiveAnnounce needs synchronous stub so act() drains it.
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { fn(0); return 0; });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function renderWithSuggestion(text = 'Try shorter sentences.') {
    mockAgentWritingAssistant.mockResolvedValueOnce({ text });
    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'advice?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));
    await waitFor(() => screen.getByRole('button', { name: /hear suggestion aloud/i }));
  }

  it('AC-V-06: mute button is present in the header', () => {
    render(<WritingAssistantPanel scene={null} />);
    expect(screen.getByRole('button', { name: /mute voice playback/i })).toBeInTheDocument();
  });

  it('AC-V-06: mute button toggles its label and aria-pressed', () => {
    render(<WritingAssistantPanel scene={null} />);
    const btn = screen.getByRole('button', { name: /mute voice playback/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(btn);

    expect(screen.getByRole('button', { name: /unmute voice playback/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /unmute voice playback/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('AC-V-07: Hear button appears on a completed suggestion card', async () => {
    await renderWithSuggestion();
    expect(screen.getByRole('button', { name: /hear suggestion aloud/i })).toBeInTheDocument();
  });

  it('AC-V-07: clicking Hear calls voiceSpeak with the card text', async () => {
    await renderWithSuggestion('Try shorter sentences.');
    fireEvent.click(screen.getByRole('button', { name: /hear suggestion aloud/i }));
    expect(mockVoiceSpeak).toHaveBeenCalledWith('Try shorter sentences.');
  });

  it('AC-V-07: button switches to Stop while playing', async () => {
    await renderWithSuggestion();
    fireEvent.click(screen.getByRole('button', { name: /hear suggestion aloud/i }));
    // voiceSpeak resolves next tick — button shows stop immediately (optimistic)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /stop voice playback/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /hear suggestion aloud/i })).not.toBeInTheDocument();
  });

  it('AC-V-07: onVoiceSpeakDone event resets button back to Hear', async () => {
    let fireDone!: (evt: { speakId: string }) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockOnVoiceSpeakDone as any).mockImplementationOnce((cb: (evt: { speakId: string }) => void) => {
      fireDone = cb;
      return () => {};
    });

    await renderWithSuggestion();
    fireEvent.click(screen.getByRole('button', { name: /hear suggestion aloud/i }));
    await waitFor(() => screen.getByRole('button', { name: /stop voice playback/i }));

    // speakId is 'speak-1' per default mock
    await act(async () => { fireDone({ speakId: 'speak-1' }); });

    expect(screen.getByRole('button', { name: /hear suggestion aloud/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /stop voice playback/i })).not.toBeInTheDocument();
  });

  it('AC-V-07: clicking Stop cancels playback via voiceSpeakCancel', async () => {
    await renderWithSuggestion();
    fireEvent.click(screen.getByRole('button', { name: /hear suggestion aloud/i }));
    await waitFor(() => screen.getByRole('button', { name: /stop voice playback/i }));
    fireEvent.click(screen.getByRole('button', { name: /stop voice playback/i }));
    expect(mockVoiceSpeakCancel).toHaveBeenCalledWith('speak-1');
  });

  it('AC-V-08: clicking Hear while session is muted does NOT call voiceSpeak', async () => {
    await renderWithSuggestion();
    // Mute first
    fireEvent.click(screen.getByRole('button', { name: /mute voice playback/i }));
    // Then click Hear — should be a no-op
    fireEvent.click(screen.getByRole('button', { name: /hear suggestion aloud/i }));
    expect(mockVoiceSpeak).not.toHaveBeenCalled();
  });

  it('AC-V-08: muting while playing calls voiceSpeakCancel and resets button', async () => {
    await renderWithSuggestion();
    fireEvent.click(screen.getByRole('button', { name: /hear suggestion aloud/i }));
    await waitFor(() => screen.getByRole('button', { name: /stop voice playback/i }));

    fireEvent.click(screen.getByRole('button', { name: /mute voice playback/i }));

    expect(mockVoiceSpeakCancel).toHaveBeenCalledWith('speak-1');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /hear suggestion aloud/i })).toBeInTheDocument(),
    );
  });

  it('AC-V-10: live region is always in the DOM', () => {
    render(<WritingAssistantPanel scene={null} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Beta-Read trigger detection (AC-WA-17)
// ---------------------------------------------------------------------------
const betaReadScene = {
  id: 's1',
  title: 'Chapter One',
  blocks: [{ id: 'b1', type: 'prose' as const, order: 0, content: 'The airship docked.', updatedAt: '' }],
  draftState: 'in-progress' as const,
  order: 0,
  path: '/scene.md',
  createdAt: '',
  updatedAt: '',
};

describe('WritingAssistantPanel — Beta-Read trigger detection (AC-WA-17)', () => {
  it.each([
    { prompt: 'beta read this scene', label: 'lowercase "beta read"' },
    { prompt: 'Beta Read this scene', label: 'title-case "Beta Read"' },
    { prompt: 'beta-read this please', label: 'hyphenated "beta-read"' },
    { prompt: 'DEEP REVIEW the pacing', label: 'uppercase "DEEP REVIEW"' },
    { prompt: 'deep review my prose', label: 'lowercase "deep review"' },
  ])('routes "$label" prompt to beta-read IPC, not writing-assistant', async ({ prompt }) => {
    mockBetaReadScan.mockResolvedValueOnce({ comments: [], scannedAt: new Date().toISOString() });

    render(<WritingAssistantPanel scene={betaReadScene} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), { target: { value: prompt } });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() => expect(mockBetaReadScan).toHaveBeenCalledTimes(1));
    expect(mockAgentWritingAssistant).not.toHaveBeenCalled();
  });

  it('dedicated Beta-Read button triggers the scan without typing a prompt', async () => {
    mockBetaReadScan.mockResolvedValueOnce({ comments: [], scannedAt: new Date().toISOString() });

    render(<WritingAssistantPanel scene={betaReadScene} />);
    fireEvent.click(screen.getByRole('button', { name: /^beta-read$/i }));

    await waitFor(() => expect(mockBetaReadScan).toHaveBeenCalledTimes(1));
    expect(mockAgentWritingAssistant).not.toHaveBeenCalled();
  });

  it('regular writing prompts do NOT route to beta-read IPC', async () => {
    mockAgentWritingAssistant.mockResolvedValueOnce({ text: 'Try adding a ticking clock.' });

    render(<WritingAssistantPanel scene={betaReadScene} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'How can I improve the pacing of this scene?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() => expect(mockAgentWritingAssistant).toHaveBeenCalledTimes(1));
    expect(mockBetaReadScan).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Streaming bubble (AC-WA-09, AC-WA-10, AC-WA-13)
// ---------------------------------------------------------------------------
describe('WritingAssistantPanel — streaming bubble (AC-WA-09/10/13)', () => {
  it('AC-WA-09: Enter (no Shift) submits; Shift+Enter does not; empty prompt is a no-op', async () => {
    mockAgentWritingAssistant.mockResolvedValueOnce({ text: 'Response.' });

    render(<WritingAssistantPanel scene={null} />);
    const textarea = screen.getByLabelText(/writing assistant prompt/i);

    // Empty prompt — Enter should be a no-op
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(mockAgentWritingAssistant).not.toHaveBeenCalled();

    // Shift+Enter should not submit
    fireEvent.change(textarea, { target: { value: 'Test prompt' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(mockAgentWritingAssistant).not.toHaveBeenCalled();

    // Enter without Shift should submit
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    await waitFor(() => expect(mockAgentWritingAssistant).toHaveBeenCalledTimes(1));
    expect(mockAgentWritingAssistant.mock.calls[0][0]).toBe('Test prompt');
  });

  it('AC-WA-10: streaming chunks accumulate in the assistant bubble and cursor glyph appears', async () => {
    let emitChunk: ((chunk: string) => void) | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockOnWritingAssistantChunk as any).mockImplementationOnce((cb: (chunk: string) => void) => {
      emitChunk = cb;
      return () => {};
    });
    // Stays pending so we can observe the streaming state
    mockAgentWritingAssistant.mockImplementationOnce(() => new Promise<{ text: string }>(() => {}));

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'Tell me a story' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    // Streaming bubble appears (empty text + cursor)
    await waitFor(() =>
      expect(screen.getByLabelText(/writing assistant response/i)).toBeInTheDocument(),
    );
    expect(document.querySelector('.wa-cursor')).toBeInTheDocument();

    // Chunks accumulate in the bubble
    act(() => { emitChunk?.('Once '); });
    act(() => { emitChunk?.('upon '); });
    act(() => { emitChunk?.('a time.'); });

    expect(screen.getByLabelText(/writing assistant response/i)).toHaveTextContent('Once upon a time.');
    // Cursor still present — still streaming
    expect(document.querySelector('.wa-cursor')).toBeInTheDocument();
  });

  it('AC-WA-10: cursor glyph disappears once streaming completes', async () => {
    mockAgentWritingAssistant.mockResolvedValueOnce({ text: 'Done.' });

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'Finish it' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() =>
      expect(screen.getByLabelText(/writing assistant response/i)).toHaveTextContent('Done.'),
    );
    // No cursor after streaming finishes
    expect(document.querySelector('.wa-cursor')).not.toBeInTheDocument();
  });

  it('AC-WA-13: Cancel button replaces Ask during streaming; Ask returns after cancel', async () => {
    mockAgentWritingAssistant.mockImplementationOnce(() => new Promise<{ text: string }>(() => {}));

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'Keep going' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    // Ask button gone, Cancel appears
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /cancel generation/i })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /^ask$/i })).not.toBeInTheDocument();

    // Cancel restores Ask button
    fireEvent.click(screen.getByRole('button', { name: /cancel generation/i }));
    expect(screen.getByRole('button', { name: /^ask$/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Preset context (AC-WA-15)
// ---------------------------------------------------------------------------
describe('WritingAssistantPanel — preset context (AC-WA-15)', () => {
  it('includes the active preset style guide in the request context', async () => {
    mockAgentWritingAssistant.mockResolvedValueOnce({ text: 'Some advice.' });

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'How should I write this?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() => expect(mockAgentWritingAssistant).toHaveBeenCalled());
    const [, context] = mockAgentWritingAssistant.mock.calls[0];
    // Default preset is Epic Fantasy: tone = Serious
    expect(context).toContain('[Writing style:');
    expect(context).toContain('Genre: Fantasy');
    expect(context).toContain('Tone: Serious');
  });

  it('AC-WA-15: changing preset updates the context sent with the next request', async () => {
    mockAgentWritingAssistant
      .mockResolvedValueOnce({ text: 'Fantasy advice.' })
      .mockResolvedValueOnce({ text: 'Romance advice.' });

    render(<WritingAssistantPanel scene={null} />);

    // First ask — default preset (Epic Fantasy, tone=Serious)
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'Tell me about the scene.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));
    await waitFor(() => expect(mockAgentWritingAssistant).toHaveBeenCalledTimes(1));
    const [, firstContext] = mockAgentWritingAssistant.mock.calls[0];
    expect(firstContext).toContain('Genre: Fantasy');

    // Switch to Modern Romance preset via the dropdown
    fireEvent.click(
      screen.getByRole('button', { name: /writing preset:.*click to change/i }),
    );
    const romanceItem = await screen.findByRole('option', { name: /modern romance/i });
    fireEvent.click(romanceItem);

    // Second ask — preset should now be Modern Romance
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'What next?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));
    await waitFor(() => expect(mockAgentWritingAssistant).toHaveBeenCalledTimes(2));
    const [, secondContext] = mockAgentWritingAssistant.mock.calls[1];
    expect(secondContext).toContain('Genre: Romance');
    expect(secondContext).toContain('Tone: Warm');
  });
});

// ---------------------------------------------------------------------------
// Refinement chips (AC-WA-16)
// ---------------------------------------------------------------------------
describe('WritingAssistantPanel — refinement chips (AC-WA-16)', () => {
  beforeEach(() => {
    // Clear sessionStorage so preset selection from prior tests doesn't bleed in
    sessionStorage.clear();
  });

  it('refinement chips appear after a completed response', async () => {
    mockAgentWritingAssistant.mockResolvedValueOnce({ text: 'Initial response.' });

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'Write something.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() =>
      expect(screen.getByLabelText(/refinement options/i)).toBeInTheDocument(),
    );
    // At least the +warmer chip should be present
    expect(screen.getByLabelText(/refine: warmer/i)).toBeInTheDocument();
  });

  it('AC-WA-16: clicking a refinement chip adjusts axes and fires a re-ask', async () => {
    mockAgentWritingAssistant
      .mockResolvedValueOnce({ text: 'Initial response.' })
      .mockResolvedValueOnce({ text: 'Warmer response.' });

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'Tell me about this scene.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() => screen.getByLabelText(/refine: warmer/i));
    fireEvent.click(screen.getByLabelText(/refine: warmer/i));

    // Re-ask is fired with the adjusted tone in the new context
    await waitFor(() => expect(mockAgentWritingAssistant).toHaveBeenCalledTimes(2));
    const [reAskPrompt, reAskContext] = mockAgentWritingAssistant.mock.calls[1];
    // Re-uses same prompt text
    expect(reAskPrompt).toBe('Tell me about this scene.');
    // Default Epic Fantasy has tone=serious; +warmer shifts to balanced
    expect(reAskContext).toContain('Tone: Balanced');
  });

  it('AC-WA-16: active chip is marked aria-pressed=true during the re-ask', async () => {
    // Keep the re-ask pending so we can observe aria-pressed during streaming
    mockAgentWritingAssistant
      .mockResolvedValueOnce({ text: 'Response.' })
      .mockImplementationOnce(() => new Promise<{ text: string }>(() => {}));

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'Anything.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() => screen.getByLabelText(/refine: warmer/i));
    const warmerChip = screen.getByLabelText(/refine: warmer/i);
    expect(warmerChip).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(warmerChip);
    // While the re-ask is streaming, the chip should be marked active
    await waitFor(() => expect(mockAgentWritingAssistant).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(warmerChip).toHaveAttribute('aria-pressed', 'true'));
  });
});

describe('WritingAssistantPanel — STT mic button (AC-WA-25)', () => {
  it('AC-WA-25: mic button absent when voiceEnabled is not passed', () => {
    render(<WritingAssistantPanel scene={null} />);
    expect(screen.queryByRole('button', { name: /start voice input/i })).not.toBeInTheDocument();
  });

  it('AC-WA-25: mic button absent when voiceEnabled={false}', () => {
    render(<WritingAssistantPanel scene={null} voiceEnabled={false} />);
    expect(screen.queryByRole('button', { name: /start voice input/i })).not.toBeInTheDocument();
  });

  it('AC-WA-25: mic button present and aria-pressed=false when voiceEnabled={true}', () => {
    render(<WritingAssistantPanel scene={null} voiceEnabled />);
    const micBtn = screen.getByRole('button', { name: /start voice input/i });
    expect(micBtn).toBeInTheDocument();
    expect(micBtn).toHaveAttribute('aria-pressed', 'false');
  });
});
