import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import WritingAssistantPanel from './WritingAssistantPanel';
import type { Scene } from './types';

const mockAgentWritingAssistant = vi.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockOnWritingAssistantChunk = vi.fn<any>(() => vi.fn());
const mockWritingScan = vi.fn();
const mockWritingAssistantCadenceChange = vi.fn();
const mockWritingAssistantTipDecision = vi.fn();
const mockWritingAssistantScanNow = vi.fn();
const mockWritingAssistantSetActiveScene = vi.fn();
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
    voiceSpeak: mockVoiceSpeak,
    voiceSpeakCancel: mockVoiceSpeakCancel,
    onVoiceSpeakDone: mockOnVoiceSpeakDone,
    onVoiceSpeakError: mockOnVoiceSpeakError,
    // Probe H1 gate — refuseUnlessProviderReady needs a resolvable WA provider.
    settingsGet: vi.fn().mockResolvedValue({
      apiKey: 'sk-test',
      provider: { kind: 'anthropic', model: 'claude-haiku' },
      agents: {
        writingAssistant: {
          enabled: true,
          model: 'claude-haiku',
          provider: { kind: 'anthropic', model: 'claude-haiku' },
        },
        brainstorm: { enabled: true, model: 'x' },
        archive: { enabled: true, model: 'x' },
      },
    }),
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

describe('WritingAssistantPanel', () => {
  it('renders tip strip without Ask composer (N4-A)', () => {
    render(<WritingAssistantPanel scene={null} />);
    expect(screen.getByLabelText(/heartbeat panel/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/writing coach prompt/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^ask$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/open a scene to scan/i)).toBeInTheDocument();
  });

  it('disables Scan now when no scene is open', () => {
    render(<WritingAssistantPanel scene={null} />);
    expect(screen.getByRole('button', { name: /^scan now$/i })).toBeDisabled();
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
});

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

    expect(screen.getByText(/writing coach is disabled/i)).toBeInTheDocument();

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
    expect(screen.getByTestId('wa-scan-now-cta')).toBeInTheDocument();
    expect(document.querySelector('.wa-heartbeat-empty')).toBeTruthy();
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

    await act(async () => { vi.advanceTimersByTime(10_000); });

    await act(async () => {
      rerender(<WritingAssistantPanel scene={scene2} scanIntervalSeconds={10} isActive={true} />);
    });
    expect(document.querySelector('.wa-spinner')).toBeNull();

    await act(async () => {
      resolveHeld({ tips: ['stale tip'], scannedAt: new Date().toISOString() });
    });
    expect(document.querySelector('.wa-spinner')).toBeNull();
    expect(screen.queryByText('stale tip')).not.toBeInTheDocument();
  });
});

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
    expect(screen.getAllByRole('button', { name: /scan now/i }).length).toBeGreaterThan(0);
  });

  it('AC9: shows warning icon, error message and Retry button on scan error', async () => {
    mockWritingScan.mockRejectedValueOnce(new Error('Provider unavailable'));
    render(<WritingAssistantPanel scene={mockScene} scanIntervalSeconds={10} isActive={true} />);

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/scan failed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry scan/i })).toBeInTheDocument();
  });

  it('AC18: Scan now button triggers a scan and updates status to Scanning', async () => {
    mockWritingAssistantScanNow.mockResolvedValue({ tips: [], scannedAt: new Date().toISOString() });

    render(<WritingAssistantPanel scene={mockScene} scanIntervalSeconds={60} isActive={true} />);

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

    expect(screen.getByRole('button', { name: /open writing coach/i })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: /writing coach/i })).not.toBeInTheDocument();
  });

  it('N4-A hub embed: allowNarrowCollapse=false keeps Heartbeat panel under <280px', async () => {
    let observerCallback: ResizeObserverCallback | null = null;
    class MockResizeObserver {
      constructor(cb: ResizeObserverCallback) { observerCallback = cb; }
      observe() {}
      disconnect() {}
    }
    window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

    render(
      <WritingAssistantPanel scene={mockScene} isActive={true} allowNarrowCollapse={false} />,
    );

    await act(async () => {
      observerCallback?.([
        { contentRect: { width: 200 } } as unknown as ResizeObserverEntry,
      ], {} as ResizeObserver);
      // Pre-layout 0-width must not latch either.
      observerCallback?.([
        { contentRect: { width: 0 } } as unknown as ResizeObserverEntry,
      ], {} as ResizeObserver);
    });

    expect(screen.queryByRole('button', { name: /open writing coach/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Heartbeat panel')).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: /open writing coach/i }));

    expect(screen.getByRole('complementary', { name: /writing coach/i })).toBeInTheDocument();
  });
});

describe('WritingAssistantPanel — TTS voice controls', () => {
  const piperSettings = { enabled: true, provider: 'local' as const, localBinaryPath: '/piper' };

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { fn(0); return 0; });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function renderWithTip(text = 'Try shorter sentences.') {
    mockWritingAssistantScanNow.mockResolvedValue({
      tips: [{ id: 'tip-hear-1', text, category: 'clarity' }],
      scannedAt: new Date().toISOString(),
    });
    render(
      <WritingAssistantPanel
        scene={mockScene}
        ttsSettings={piperSettings}
        waScanInterval="manual"
        isActive
      />,
    );
    fireEvent.click(screen.getAllByRole('button', { name: /scan now/i })[0]);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /hear suggestion aloud/i })).toBeInTheDocument();
    });
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

  it('AC-V-07: Hear button appears on a tip card', async () => {
    await renderWithTip();
    expect(screen.getByRole('button', { name: /hear suggestion aloud/i })).toBeInTheDocument();
    expect(document.querySelector('.wa-hear-btn')).toBeInTheDocument();
  });

  it('AC-V-07: clicking Hear calls voiceSpeak with the tip text', async () => {
    await renderWithTip('Try shorter sentences.');
    fireEvent.click(screen.getByRole('button', { name: /hear suggestion aloud/i }));
    expect(mockVoiceSpeak).toHaveBeenCalledWith('Try shorter sentences.');
  });

  it('AC-V-07: button switches to Stop while playing', async () => {
    await renderWithTip();
    fireEvent.click(screen.getByRole('button', { name: /hear suggestion aloud/i }));
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

    await renderWithTip();
    fireEvent.click(screen.getByRole('button', { name: /hear suggestion aloud/i }));
    await waitFor(() => screen.getByRole('button', { name: /stop voice playback/i }));

    await act(async () => { fireDone({ speakId: 'speak-1' }); });

    expect(screen.getByRole('button', { name: /hear suggestion aloud/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /stop voice playback/i })).not.toBeInTheDocument();
  });

  it('AC-V-07: clicking Stop cancels playback via voiceSpeakCancel', async () => {
    await renderWithTip();
    fireEvent.click(screen.getByRole('button', { name: /hear suggestion aloud/i }));
    await waitFor(() => screen.getByRole('button', { name: /stop voice playback/i }));
    fireEvent.click(screen.getByRole('button', { name: /stop voice playback/i }));
    expect(mockVoiceSpeakCancel).toHaveBeenCalledWith('speak-1');
  });

  it('AC-V-08: clicking Hear while session is muted does NOT call voiceSpeak', async () => {
    await renderWithTip();
    fireEvent.click(screen.getByRole('button', { name: /mute voice playback/i }));
    fireEvent.click(screen.getByRole('button', { name: /hear suggestion aloud/i }));
    expect(mockVoiceSpeak).not.toHaveBeenCalled();
  });

  it('AC-V-08: muting while playing calls voiceSpeakCancel and resets button', async () => {
    await renderWithTip();
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

describe('WritingAssistantPanel — per-category auto-apply (SKY-2979)', () => {
  it('category toggles hidden when autoApply is false', () => {
    render(<WritingAssistantPanel scene={null} autoApply={false} />);
    expect(screen.queryByTestId('wa-auto-apply-categories')).not.toBeInTheDocument();
  });

  it('category toggles hidden when autoApply is not passed', () => {
    render(<WritingAssistantPanel scene={null} />);
    expect(screen.queryByTestId('wa-auto-apply-categories')).not.toBeInTheDocument();
  });

  it('category toggle section shown when autoApply is true', () => {
    render(<WritingAssistantPanel scene={null} autoApply />);
    expect(screen.getByTestId('wa-auto-apply-categories')).toBeInTheDocument();
  });

  it('all 6 category pills rendered with correct labels', () => {
    render(<WritingAssistantPanel scene={null} autoApply />);
    const labels = [
      'Punctuation', 'Spelling', 'Grammar', 'Sentence structure', 'Style / tone', 'Other',
    ];
    for (const label of labels) {
      expect(
        screen.getByRole('button', { name: new RegExp(`auto-apply ${label}`, 'i') }),
      ).toBeInTheDocument();
    }
  });

  it('all category pills default to on (aria-pressed=true) when autoApplyCategories is undefined', () => {
    render(<WritingAssistantPanel scene={null} autoApply />);
    const pills = screen.getAllByRole('button', { name: /auto-apply/i });
    expect(pills.length).toBe(6);
    for (const pill of pills) {
      expect(pill).toHaveAttribute('aria-pressed', 'true');
    }
  });

  it('a category explicitly set to false renders as off (aria-pressed=false)', () => {
    render(
      <WritingAssistantPanel
        scene={null}
        autoApply
        autoApplyCategories={{ spelling: false }}
      />,
    );
    const spellingPill = screen.getByRole('button', { name: /auto-apply spelling/i });
    expect(spellingPill).toHaveAttribute('aria-pressed', 'false');
    const grammarPill = screen.getByRole('button', { name: /auto-apply grammar/i });
    expect(grammarPill).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicking a pill calls onAutoApplyCategoriesChange with the toggled map', () => {
    const onChange = vi.fn();
    render(
      <WritingAssistantPanel
        scene={null}
        autoApply
        autoApplyCategories={{}}
        onAutoApplyCategoriesChange={onChange}
      />,
    );
    const spellingPill = screen.getByRole('button', { name: /auto-apply spelling/i });
    fireEvent.click(spellingPill);
    expect(onChange).toHaveBeenCalledTimes(1);
    const [result] = onChange.mock.calls[0] as [Record<string, boolean>];
    expect(result.spelling).toBe(false);
    expect(result.grammar).toBe(true);
    expect(result.punctuation).toBe(true);
  });

  it('clicking a disabled pill re-enables it and calls onChange', () => {
    const onChange = vi.fn();
    render(
      <WritingAssistantPanel
        scene={null}
        autoApply
        autoApplyCategories={{ grammar: false }}
        onAutoApplyCategoriesChange={onChange}
      />,
    );
    const grammarPill = screen.getByRole('button', { name: /auto-apply grammar/i });
    expect(grammarPill).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(grammarPill);
    expect(onChange).toHaveBeenCalledTimes(1);
    const [result] = onChange.mock.calls[0] as [Record<string, boolean>];
    expect(result.grammar).toBe(true);
  });

  it('toggling does not throw when no handler is provided', () => {
    render(<WritingAssistantPanel scene={null} autoApply autoApplyCategories={{}} />);
    const pill = screen.getByRole('button', { name: /auto-apply spelling/i });
    expect(() => fireEvent.click(pill)).not.toThrow();
  });
});
