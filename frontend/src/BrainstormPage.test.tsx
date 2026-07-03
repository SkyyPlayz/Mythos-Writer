import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import BrainstormPage, { STALL_TIMEOUT_MS, HARD_TIMEOUT_MS, VAULT_ROOT_SENTINEL } from './BrainstormPage';

type TokenHandler = (data: { streamId: string; token: string }) => void;
type EndHandler = (data: { streamId: string }) => void;
type ErrorHandler = (data: { streamId: string; error: string }) => void;

// ─── MediaRecorder mock (for Voice IO state-machine tests) ────────────────────
class MockMediaRecorderClass {
  static isTypeSupported = vi.fn(() => false);
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}

function installMediaRecorderMock() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).MediaRecorder = MockMediaRecorderClass;
  Object.defineProperty(global.navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
    writable: true, configurable: true,
  });
}
function removeMediaRecorderMock() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (global as any).MediaRecorder;
}


let tokenCb: TokenHandler | null = null;
let endCb: EndHandler | null = null;
let errorCb: ErrorHandler | null = null;

const mockStreamStart = vi.fn();
const mockStreamCancel = vi.fn().mockResolvedValue({ cancelled: true });
const mockStreamAck = vi.fn();
const mockEntityCreate = vi.fn();
const mockEntityList = vi.fn();
// SKY-20: brainstorm routing IPC mocks. Default-mode "written" responses are
// the common case; individual tests override these for blank-mode prompting.
const mockBrainstormWriteNote = vi.fn();
const mockBrainstormResolveRouting = vi.fn();
const mockBrainstormListNotesFolders = vi.fn();
// SKY-196: context selection mock — empty vault by default so tests stay fast.
const mockBrainstormSelectContext = vi.fn();
// Part G: TTS mocks — useTtsPlayer subscribes to the done/error events on mount.
const mockVoiceSpeak = vi.fn();
const mockVoiceSpeakCancel = vi.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockOnVoiceSpeakDone = vi.fn<any>(() => vi.fn()); // returns unsub fn
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockOnVoiceSpeakError = vi.fn<any>(() => vi.fn());

function buildApi(overrides: Record<string, unknown> = {}) {
  return {
    streamStart: mockStreamStart,
    streamCancel: mockStreamCancel,
    streamAck: mockStreamAck,
    entityCreate: mockEntityCreate,
    entityList: mockEntityList,
    brainstormWriteNote: mockBrainstormWriteNote,
    brainstormResolveRouting: mockBrainstormResolveRouting,
    brainstormListNotesFolders: mockBrainstormListNotesFolders,
    brainstormSelectContext: mockBrainstormSelectContext,
    onStreamToken: (cb: TokenHandler) => {
      tokenCb = cb;
      return () => {
        tokenCb = null;
      };
    },
    onStreamEnd: (cb: EndHandler) => {
      endCb = cb;
      return () => {
        endCb = null;
      };
    },
    onStreamError: (cb: ErrorHandler) => {
      errorCb = cb;
      return () => {
        errorCb = null;
      };
    },
    sttStart: vi.fn(),
    sttStop: vi.fn(),
    onSttResult: () => () => {},
    voiceTranscribe: vi.fn().mockResolvedValue({ text: 'test transcript', confidence: 0.95 }),
    onVaultNotesUpdated: () => () => {},
    voiceSpeak: mockVoiceSpeak,
    voiceSpeakCancel: mockVoiceSpeakCancel,
    onVoiceSpeakDone: mockOnVoiceSpeakDone,
    onVoiceSpeakError: mockOnVoiceSpeakError,
    ...overrides,
  };
}

async function simulateStream(tokens: string[], errorMessage?: string) {
  await waitFor(() => expect(tokenCb).not.toBeNull());
  // Use async act so the act() boundary stays open while microtasks from
  // persistFactWithRouting (which awaits brainstormWriteNote) drain, ensuring
  // the resulting setFacts() state update is wrapped in act().
  await act(async () => {
    for (const t of tokens) {
      tokenCb?.({ streamId: 'test-stream-1', token: t });
    }
    if (errorMessage) {
      errorCb?.({ streamId: 'test-stream-1', error: errorMessage });
    } else {
      endCb?.({ streamId: 'test-stream-1' });
    }
  });
}

beforeEach(() => {
  // useLiveAnnounce calls requestAnimationFrame to avoid re-announcing the same string.
  // In jsdom rAF is a macrotask (setTimeout 0) which fires outside act() and causes
  // act() warnings. Make it synchronous so the setLiveText call lands inside act().
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { fn(0); return 0; });
  vi.stubGlobal('cancelAnimationFrame', () => {});

  vi.resetAllMocks();
  tokenCb = null;
  endCb = null;
  errorCb = null;
  mockStreamStart.mockResolvedValue({ streamId: 'test-stream-1' });
  mockStreamCancel.mockResolvedValue({ cancelled: true });
  mockVoiceSpeak.mockResolvedValue({ speakId: 'speak-1' });
  // Default: no existing entities — new facts are saved directly.
  mockEntityList.mockResolvedValue({ entities: [] });
  // SKY-20 default-mode behavior — every fact lands at the seeded category
  // path silently. Tests that exercise blank-mode prompting override this.
  mockBrainstormWriteNote.mockResolvedValue({
    status: 'written', path: 'Universes/My First Universe/Characters/Auto.md',
    suggestionId: 'sug-default', reason: 'default-layout',
  });
  mockBrainstormResolveRouting.mockResolvedValue({
    status: 'written', path: 'Worldbuilding/People/Auto.md', notesRouting: {},
  });
  mockBrainstormListNotesFolders.mockResolvedValue({
    folders: [
      { path: '', label: '/ (vault root)' },
      { path: 'Universes', label: 'Universes' },
      { path: 'Worldbuilding/People', label: 'Worldbuilding/People' },
    ],
    notesVaultRoot: '/tmp/notes',
  });
  // SKY-196: empty vault context by default so context fetch resolves fast.
  mockBrainstormSelectContext.mockResolvedValue({
    included: [], excluded: [], usedTokens: 0, budgetTokens: 4000,
  });
  (window as unknown as { api: unknown }).api = buildApi();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BrainstormPage', () => {
  it('renders prompt textarea and disabled Send button initially', () => {
    render(<BrainstormPage onClose={() => {}} />);
    expect(screen.getByLabelText(/brainstorm prompt/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^send$/i })).toBeDisabled();
  });

  it('sends a message and displays the response', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'I want to write a fantasy novel' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await simulateStream(['Your story sounds epic.']);

    await waitFor(() =>
      expect(screen.getByText('Your story sounds epic.')).toBeInTheDocument(),
    );
  });

  it('extracts FACT tags, shows them in the Facts panel, and auto-saves (default-mode routing)', async () => {
    // SKY-20: default-mode vault routes characters into the seeded
    // Universes/<World>/Characters/ folder without prompting.
    mockBrainstormWriteNote.mockResolvedValue({
      status: 'written',
      path: 'Universes/My First Universe/Characters/Lyra Ashveil.md',
      suggestionId: 'sug-1',
      reason: 'default-layout',
    });

    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'Tell me about the hero' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await simulateStream([
      'Great character! [FACT:character|Lyra Ashveil|A young mage with silver hair and a troubled past]',
    ]);

    // Wait for brainstormWriteNote to resolve and final 'Saved ✓' state to settle.
    // A single waitFor ensures all state updates from persistFactWithRouting land
    // inside the same act() boundary (avoiding the race where 'Lyra Ashveil' becomes
    // visible from the initial 'saving' state before brainstormWriteNote resolves).
    await waitFor(() => {
      expect(screen.getAllByText('Lyra Ashveil').length).toBeGreaterThan(0);
      expect(screen.getByText('A young mage with silver hair and a troubled past')).toBeInTheDocument();
      expect(screen.getByText(/saved ✓/i)).toBeInTheDocument();
    });
    expect(mockBrainstormWriteNote).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Lyra Ashveil', category: 'character' }),
    );
  });

  it('SKY-20: blank-mode first character fact triggers a routing prompt with a folder picker', async () => {
    // Override write-note to simulate Blank-mode "needs_routing" — main has
    // staged the file under .brainstorm-staging/ and tells the renderer to
    // ask the user where character notes should live.
    mockBrainstormWriteNote.mockResolvedValue({
      status: 'needs_routing',
      stagedPath: '.brainstorm-staging/uuid__Aria Voss.md',
      category: 'character',
      name: 'Aria Voss',
    });

    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'tell me about the hero' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await simulateStream([
      '[FACT:character|Aria Voss|A young sorceress]',
    ]);

    // The chat bubble appears inline. AC1 — routing prompt instead of silent
    // write to a default folder.
    const prompt = await screen.findByTestId('brainstorm-routing-prompt-character');
    expect(prompt).toBeInTheDocument();
    expect(prompt).toHaveTextContent('Aria Voss');
    // Folder picker is populated from the Notes Vault catalog.
    // Vault root is shown as an explicit sentinel option; the disabled placeholder '' is separate.
    await waitFor(() => expect(mockBrainstormListNotesFolders).toHaveBeenCalled());
    const select = screen.getByTestId('brainstorm-routing-select-character') as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(
      expect.arrayContaining([VAULT_ROOT_SENTINEL, 'Universes', 'Worldbuilding/People']),
    );
    // The path:'' vault-root folder from the API must NOT appear as a duplicate '' option.
    expect(optionValues.filter((v) => v === '').length).toBe(1); // only the disabled placeholder
  });

  it('SKY-20: picking "Save here & remember" calls resolveRouting and clears the prompt', async () => {
    mockBrainstormWriteNote.mockResolvedValue({
      status: 'needs_routing',
      stagedPath: '.brainstorm-staging/uuid__Aria Voss.md',
      category: 'character',
      name: 'Aria Voss',
    });

    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'tell me about the hero' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await simulateStream(['[FACT:character|Aria Voss|A young sorceress]']);

    await screen.findByTestId('brainstorm-routing-prompt-character');
    const select = screen.getByTestId('brainstorm-routing-select-character') as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBeGreaterThan(1));
    fireEvent.change(select, { target: { value: 'Worldbuilding/People' } });
    fireEvent.click(screen.getByTestId('brainstorm-routing-save-character'));

    await waitFor(() =>
      expect(mockBrainstormResolveRouting).toHaveBeenCalledWith({
        stagedPath: '.brainstorm-staging/uuid__Aria Voss.md',
        category: 'character',
        destination: 'Worldbuilding/People',
        remember: true,
      }),
    );
    // AC1 — once the user resolves, the prompt disappears and the fact reads
    // as saved.
    await waitFor(() =>
      expect(screen.queryByTestId('brainstorm-routing-prompt-character')).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.getByText(/saved ✓/i)).toBeInTheDocument());
  });

  it('SKY-441: save buttons are disabled and resolveRouting is NOT called when nothing is selected', async () => {
    // Regression: the old guard (destination==='' && ... && destination!=='') could never fire,
    // so a user could submit with nothing selected. This test proves the guard works.
    mockBrainstormWriteNote.mockResolvedValue({
      status: 'needs_routing',
      stagedPath: '.brainstorm-staging/uuid__Aria Voss.md',
      category: 'character',
      name: 'Aria Voss',
    });

    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'tell me about the hero' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await simulateStream(['[FACT:character|Aria Voss|A young sorceress]']);

    await screen.findByTestId('brainstorm-routing-prompt-character');

    // Neither destination nor customFolder has been touched — both buttons must be disabled.
    const saveBtn = screen.getByTestId('brainstorm-routing-save-character');
    const onceBtn = screen.getByRole('button', { name: /just this once/i });
    expect(saveBtn).toBeDisabled();
    expect(onceBtn).toBeDisabled();

    // Simulate a direct click attempt (e.g. via keyboard shortcut bypass) — resolveRouting must NOT be called.
    fireEvent.click(saveBtn);
    expect(mockBrainstormResolveRouting).not.toHaveBeenCalled();
  });

  it('SKY-441: picking "Vault root" calls resolveRouting with destination="" (empty string)', async () => {
    // Vault root is a distinct sentinel in the select — resolving it must send '' to the API,
    // not the sentinel string, so the backend writes directly to the vault root.
    mockBrainstormWriteNote.mockResolvedValue({
      status: 'needs_routing',
      stagedPath: '.brainstorm-staging/uuid__Aria Voss.md',
      category: 'character',
      name: 'Aria Voss',
    });

    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'tell me about the hero' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await simulateStream(['[FACT:character|Aria Voss|A young sorceress]']);

    await screen.findByTestId('brainstorm-routing-prompt-character');
    const select = screen.getByTestId('brainstorm-routing-select-character') as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBeGreaterThan(1));

    // Select the vault root sentinel.
    fireEvent.change(select, { target: { value: VAULT_ROOT_SENTINEL } });

    // Both save buttons must now be enabled.
    const saveBtn = screen.getByTestId('brainstorm-routing-save-character');
    expect(saveBtn).not.toBeDisabled();

    fireEvent.click(saveBtn);

    await waitFor(() =>
      expect(mockBrainstormResolveRouting).toHaveBeenCalledWith({
        stagedPath: '.brainstorm-staging/uuid__Aria Voss.md',
        category: 'character',
        destination: '',  // sentinel translated → empty string (vault root)
        remember: true,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId('brainstorm-routing-prompt-character')).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.getByText(/saved ✓/i)).toBeInTheDocument());
  });

  it('SKY-20: second same-category fact routes silently when main returns "written"', async () => {
    // First fact triggers the prompt — main stages and asks.
    mockBrainstormWriteNote
      .mockResolvedValueOnce({
        status: 'needs_routing',
        stagedPath: '.brainstorm-staging/uuid1__Aria.md',
        category: 'character',
        name: 'Aria',
      })
      // Second fact silently lands because main has remembered the choice.
      .mockResolvedValueOnce({
        status: 'written',
        path: 'Worldbuilding/People/Kael.md',
        suggestionId: 'sug-2',
        reason: 'remembered',
      });

    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'two heroes' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await simulateStream([
      '[FACT:character|Aria|Hero 1][FACT:character|Kael|Hero 2]',
    ]);

    // Wait for both the routing prompt (Aria) AND the silent save (Kael) to settle in
    // a single waitFor so all state updates from persistFactWithRouting land inside
    // the same act() boundary — avoiding a race where the routing prompt appears before
    // brainstormWriteNote resolves for the second fact.
    await waitFor(() => {
      expect(screen.getByTestId('brainstorm-routing-prompt-character')).toBeInTheDocument();
      const saved = screen.getAllByText(/saved ✓/i);
      expect(saved.length).toBeGreaterThanOrEqual(1);
    });
    // Exactly one prompt — the second fact did NOT trigger another one.
    expect(screen.getAllByTestId(/brainstorm-routing-prompt-/)).toHaveLength(1);
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<BrainstormPage onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close brainstorm/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows an error when streamStart fails', async () => {
    mockStreamStart.mockRejectedValueOnce(new Error('ANTHROPIC_API_KEY is not set.'));

    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('ANTHROPIC_API_KEY is not set.'),
    );
  });

  it('shows an error when STREAM_ERROR fires mid-stream', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await simulateStream([], 'mid-stream failure');

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('mid-stream failure'),
    );
  });

  it('shows Cancel button while streaming and hides after completion', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /cancel streaming/i })).toBeInTheDocument(),
    );

    await simulateStream(['Done.']);

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /cancel streaming/i })).not.toBeInTheDocument(),
    );
  });

  it('Cancel button aborts the stream and removes the pending bubble', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(tokenCb).not.toBeNull());
    act(() => {
      tokenCb?.({ streamId: 'test-stream-1', token: 'partial' });
    });

    fireEvent.click(screen.getByRole('button', { name: /cancel streaming/i }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /cancel streaming/i })).not.toBeInTheDocument(),
    );
    expect(mockStreamCancel).toHaveBeenCalledWith('test-stream-1');
  });
});

describe('BrainstormPage disabled state', () => {
  it('shows disabled banner when enabled=false', () => {
    render(<BrainstormPage onClose={() => {}} enabled={false} />);
    expect(screen.getByText(/brainstorm agent is disabled/i)).toBeInTheDocument();
  });

  it('hides the prompt textarea when disabled', () => {
    render(<BrainstormPage onClose={() => {}} enabled={false} />);
    expect(screen.queryByLabelText(/brainstorm prompt/i)).not.toBeInTheDocument();
  });

  it('does not call streamStart when disabled', async () => {
    render(<BrainstormPage onClose={() => {}} enabled={false} />);
    expect(mockStreamStart).not.toHaveBeenCalled();
  });

  it('shows a Close button on the disabled view that calls onClose', () => {
    const onClose = vi.fn();
    render(<BrainstormPage onClose={onClose} enabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('BrainstormPage — STREAM_ERROR handling', () => {
  it('shows error when STREAM_ERROR fires before any content arrives', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    // Fire error immediately — no tokens precede it.
    await waitFor(() => expect(errorCb).not.toBeNull());
    act(() => {
      errorCb?.({ streamId: 'test-stream-1', error: 'Authentication error — check your API key in Settings.' });
    });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Authentication error — check your API key in Settings.',
      ),
    );
    // Pending assistant bubble should be gone.
    expect(screen.queryByText(/▍/)).not.toBeInTheDocument();
  });

  it('displays user-friendly auth error when STREAM_ERROR carries 401 message', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(errorCb).not.toBeNull());
    act(() => {
      errorCb?.({
        streamId: 'test-stream-1',
        error: 'Authentication error — check your API key in Settings.',
      });
    });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Authentication error'),
    );
  });

  it('displays user-friendly rate-limit message when STREAM_ERROR carries 429 category', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(errorCb).not.toBeNull());
    act(() => {
      errorCb?.({
        streamId: 'test-stream-1',
        error: 'Rate limit reached — try again shortly.',
      });
    });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Rate limit reached'),
    );
  });

  it('displays model-unavailable message when STREAM_ERROR carries invalid_request category', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(errorCb).not.toBeNull());
    act(() => {
      errorCb?.({
        streamId: 'test-stream-1',
        error: 'Invalid request — check the model and input parameters.',
      });
    });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid request'),
    );
  });

  it('falls back to generic message when STREAM_ERROR has empty message string', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(errorCb).not.toBeNull());
    act(() => {
      errorCb?.({ streamId: 'test-stream-1', error: '' });
    });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('AI unavailable'),
    );
  });

  it('re-enables Send button after STREAM_ERROR fires', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    const input = screen.getByLabelText(/brainstorm prompt/i);
    fireEvent.change(input, { target: { value: 'test' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(errorCb).not.toBeNull());
    act(() => {
      errorCb?.({ streamId: 'test-stream-1', error: 'Rate limit reached — try again shortly.' });
    });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );
    // Input is re-enabled; Send button shows (not Cancel).
    expect(screen.queryByRole('button', { name: /cancel streaming/i })).not.toBeInTheDocument();
  });
});

describe('Draft persistence', () => {
  it('restores messages and facts from localStorage draft on mount', () => {
    const draft = {
      v: 2,
      savedAt: new Date().toISOString(),
      prompt: '',
      messages: [
        { role: 'user', text: 'Restored user message' },
        { role: 'assistant', text: 'Restored assistant reply', streaming: false },
      ],
      facts: [],
    };
    localStorage.setItem('brainstorm:draft', JSON.stringify(draft));

    render(<BrainstormPage onClose={() => {}} />);

    expect(screen.getByText('Restored user message')).toBeInTheDocument();
    expect(screen.getByText('Restored assistant reply')).toBeInTheDocument();
    expect(screen.getByText(/recovered your previous brainstorm draft/i)).toBeInTheDocument();
  });

  it('restores unsent prompt text from localStorage draft on mount', () => {
    const draft = {
      v: 2,
      savedAt: new Date().toISOString(),
      prompt: 'Keep this idea for later',
      messages: [],
      facts: [],
    };
    localStorage.setItem('brainstorm:draft', JSON.stringify(draft));

    render(<BrainstormPage onClose={() => {}} />);

    expect(screen.getByLabelText(/brainstorm prompt/i)).toHaveValue('Keep this idea for later');
  });

  it('saves a completed message to localStorage after stream ends', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'Save this conversation' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await simulateStream(['Saved response text.']);

    await waitFor(() =>
      expect(screen.getByText('Saved response text.')).toBeInTheDocument(),
    );

    const stored = localStorage.getItem('brainstorm:draft');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.v).toBe(2);
    expect(parsed.messages.some((m: { text: string }) => m.text === 'Save this conversation')).toBe(true);
    expect(parsed.messages.some((m: { text: string }) => m.text === 'Saved response text.')).toBe(true);
  });

  it('persists unsent prompt text to localStorage while drafting', () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'Unsent but important premise' },
    });

    const stored = localStorage.getItem('brainstorm:draft');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.prompt).toBe('Unsent but important premise');
  });

  it('New Session clears localStorage draft and removes messages from view', () => {
    const draft = {
      v: 2,
      savedAt: new Date().toISOString(),
      prompt: 'unsent draft prompt',
      messages: [
        { role: 'user', text: 'Prior session message' },
        { role: 'assistant', text: 'Prior session reply' },
      ],
      facts: [],
    };
    localStorage.setItem('brainstorm:draft', JSON.stringify(draft));

    render(<BrainstormPage onClose={() => {}} />);
    expect(screen.getByText('Prior session message')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /new session/i }));

    expect(screen.queryByText('Prior session message')).not.toBeInTheDocument();
    expect(localStorage.getItem('brainstorm:draft')).toBeNull();
    expect(screen.getByLabelText(/brainstorm prompt/i)).toHaveValue('');
  });

  it('shows Download button when messages are present', () => {
    const draft = {
      v: 2,
      savedAt: new Date().toISOString(),
      prompt: '',
      messages: [
        { role: 'user', text: 'A question' },
        { role: 'assistant', text: 'An answer' },
      ],
      facts: [],
    };
    localStorage.setItem('brainstorm:draft', JSON.stringify(draft));

    render(<BrainstormPage onClose={() => {}} />);

    expect(screen.getByRole('button', { name: /download session/i })).toBeInTheDocument();
  });

  it('hides Download button when no messages are present', () => {
    render(<BrainstormPage onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: /download session/i })).not.toBeInTheDocument();
  });

  it('Download button triggers file download via URL.createObjectURL', () => {
    const mockCreateObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    const mockRevokeObjectURL = vi.fn();
    global.URL.createObjectURL = mockCreateObjectURL;
    global.URL.revokeObjectURL = mockRevokeObjectURL;
    const mockClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const draft = {
      v: 2,
      savedAt: new Date().toISOString(),
      prompt: '',
      messages: [
        { role: 'user', text: 'My question' },
        { role: 'assistant', text: 'My answer' },
      ],
      facts: [],
    };
    localStorage.setItem('brainstorm:draft', JSON.stringify(draft));

    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /download session/i }));

    expect(mockCreateObjectURL).toHaveBeenCalled();
    expect(mockClick).toHaveBeenCalled();
    expect(mockRevokeObjectURL).toHaveBeenCalled();

    mockClick.mockRestore();
  });

  it('ignores a malformed localStorage draft without throwing', () => {
    localStorage.setItem('brainstorm:draft', 'not-valid-json{{{');
    expect(() => render(<BrainstormPage onClose={() => {}} />)).not.toThrow();
    expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument();
  });
});

describe('Stalled-stream UX', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('exported constants have correct values', () => {
    expect(STALL_TIMEOUT_MS).toBe(20_000);
    expect(HARD_TIMEOUT_MS).toBe(90_000);
  });

  it('shows the stalled panel after STALL_TIMEOUT_MS with no tokens', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    // Flush the brainstormSelectContext microtask so _runStream (and onStreamToken) run
    await act(async () => {});

    expect(tokenCb).not.toBeNull();

    // Use async act to flush React 18 batched updates triggered by timer callbacks
    await act(async () => { vi.advanceTimersByTime(STALL_TIMEOUT_MS + 1000); });

    expect(screen.getByRole('status', { name: /generation stalled/i })).toBeInTheDocument();
    expect(screen.getByText(/taking longer than expected/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry generation/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel generation/i })).toBeInTheDocument();
  });

  it('hides the stalled panel when tokens resume after stall', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    // Flush the brainstormSelectContext microtask so _runStream (and onStreamToken) run
    await act(async () => {});

    expect(tokenCb).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(STALL_TIMEOUT_MS + 1000); });
    expect(screen.getByRole('status', { name: /generation stalled/i })).toBeInTheDocument();

    // Token arrives — streamPhase resets to 'streaming', stall panel disappears
    act(() => { tokenCb?.({ streamId: 'test-stream-1', token: 'hello' }); });
    await act(async () => {});  // flush React batched updates
    expect(screen.queryByRole('status', { name: /generation stalled/i })).not.toBeInTheDocument();
  });

  it('Cancel button in stalled panel aborts the stream and shows toast', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await act(async () => {});  // flush brainstormSelectContext microtask

    expect(tokenCb).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(STALL_TIMEOUT_MS + 1000); });
    expect(screen.getByRole('button', { name: /cancel generation/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /cancel generation/i }));
    await act(async () => {});  // flush

    expect(mockStreamCancel).toHaveBeenCalledWith('test-stream-1');
    expect(screen.queryByRole('status', { name: /generation stalled/i })).not.toBeInTheDocument();
    expect(screen.getByText(/generation cancelled/i)).toBeInTheDocument();
  });

  it('Retry button re-starts the stream with the same messages', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'retry-me' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await act(async () => {});  // flush brainstormSelectContext microtask

    expect(tokenCb).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(STALL_TIMEOUT_MS + 1000); });
    expect(screen.getByRole('button', { name: /retry generation/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry generation/i }));
    // retryFromStalled is async — flush its promise chain
    await act(async () => {});

    expect(mockStreamCancel).toHaveBeenCalledWith('test-stream-1');
    expect(mockStreamStart).toHaveBeenCalledTimes(2);

    // End the new stream — stalled panel should not reappear
    act(() => { endCb?.({ streamId: 'test-stream-1' }); });
    await act(async () => {});
    expect(screen.queryByRole('status', { name: /generation stalled/i })).not.toBeInTheDocument();
  });

  it('auto-aborts after HARD_TIMEOUT_MS and shows an error', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'slow request' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    // Flush brainstormSelectContext microtask, then the streamStart() microtask
    await act(async () => {});
    await act(async () => {});

    expect(tokenCb).not.toBeNull();

    await act(async () => { vi.advanceTimersByTime(HARD_TIMEOUT_MS + 1000); });

    expect(screen.getByRole('alert')).toHaveTextContent(/timed out/i);
    expect(mockStreamCancel).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /cancel streaming/i })).not.toBeInTheDocument();
  });

  it('Cancel button in input area shows cancelled toast', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    // Flush brainstormSelectContext microtask, then streamStart() microtask
    await act(async () => {});
    await act(async () => {});

    expect(tokenCb).not.toBeNull();
    expect(screen.getByRole('button', { name: /cancel streaming/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /cancel streaming/i }));
    await act(async () => {});

    expect(mockStreamCancel).toHaveBeenCalledWith('test-stream-1');
    expect(screen.getByText(/generation cancelled/i)).toBeInTheDocument();
  });
});

describe('Mic button', () => {
  const renderVoiceEnabledBrainstorm = () => render(<BrainstormPage onClose={() => {}} voiceEnabled />);

  beforeEach(() => { installMediaRecorderMock(); });
  afterEach(() => { removeMediaRecorderMock(); });

  it('renders a mic button for voice input', () => {
    renderVoiceEnabledBrainstorm();
    expect(screen.getByRole('button', { name: /start voice input/i })).toBeInTheDocument();
  });

  it('transitions to listening state after mic click (MediaRecorder path)', async () => {
    renderVoiceEnabledBrainstorm();
    fireEvent.click(screen.getByRole('button', { name: /start voice input/i }));
    // getUserMedia is async; wait for listening state
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /stop voice input/i })).toBeInTheDocument(),
    );
  });

  it('fills the composer with transcription text via voiceTranscribe', async () => {
    (window as unknown as { api: unknown }).api = buildApi({
      voiceTranscribe: vi.fn().mockResolvedValue({ text: 'hello world', confidence: 0.95 }),
    });
    renderVoiceEnabledBrainstorm();
    const btn = screen.getByRole('button', { name: /start voice input/i });
    fireEvent.click(btn);
    // Wait for listening state
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /stop voice input/i })).toBeInTheDocument(),
    );
    // Stop recording → triggers transcription
    fireEvent.click(screen.getByRole('button', { name: /stop voice input/i }));
    await waitFor(() =>
      expect(screen.getByLabelText(/brainstorm prompt/i)).toHaveValue('hello world'),
    );
  });

  it('SKY-3189: uses MediaRecorder path regardless of isPackaged — SpeechRecognition is never used', async () => {
    let webSpeechConstructed = false;
    class MockSpeech { constructor() { webSpeechConstructed = true; } start() {} }
    (window as unknown as Record<string, unknown>).SpeechRecognition = MockSpeech;
    (window as unknown as { api: unknown }).api = buildApi({ isPackaged: true });
    renderVoiceEnabledBrainstorm();
    fireEvent.click(screen.getByRole('button', { name: /start voice input/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /stop voice input/i })).toBeInTheDocument(),
    );
    expect(webSpeechConstructed).toBe(false);
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
  });
});

// ─── Archive: ContinuityPanel in Brainstorm sidebar (SKY-2585/SKY-2588) ────────

describe('BrainstormPage — continuity issues (Archive)', () => {
  it('shows ContinuityPanel disabled message when archiveContinuityEnabled is false', async () => {
    render(<BrainstormPage onClose={() => {}} archiveContinuityEnabled={false} />);
    await waitFor(() =>
      expect(screen.getByText(/Archive Agent is disabled/i)).toBeInTheDocument(),
    );
  });
  // ─── SKY-1263: Inline body preview toggle ───────────────────────────────────

  describe('inline body preview toggle', () => {
    async function renderWithFact(content: string) {
      render(<BrainstormPage onClose={() => {}} />);
      fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
        target: { value: 'test' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
      await simulateStream([
        `[FACT:character|Hero|${content}]`,
      ]);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Open idea detail for Hero' })).toBeInTheDocument());
    }

    it('fact card starts expanded with body preview visible', async () => {
      await renderWithFact('A brave warrior');
      expect(screen.getByText('A brave warrior')).toBeInTheDocument();
      // When expanded the chevron label reads "Collapse <name>"
      const chevron = screen.getByRole('button', { name: /collapse hero/i });
      expect(chevron).toHaveAttribute('aria-expanded', 'true');
    });

    it('chevron collapses the card body on first click', async () => {
      await renderWithFact('A brave warrior');
      const chevron = screen.getByRole('button', { name: /collapse hero/i });
      fireEvent.click(chevron);
      expect(screen.queryByText('A brave warrior')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /expand hero/i })).toHaveAttribute('aria-expanded', 'false');
    });

    it('chevron re-expands the card body on second click', async () => {
      await renderWithFact('A brave warrior');
      const chevron = screen.getByRole('button', { name: /collapse hero/i });
      fireEvent.click(chevron);
      fireEvent.click(screen.getByRole('button', { name: /expand hero/i }));
      expect(screen.getByText('A brave warrior')).toBeInTheDocument();
    });

    it('truncates body to 120 chars with ellipsis when longer', async () => {
      const longContent = 'A'.repeat(130);
      await renderWithFact(longContent);
      const desc = screen.getByText(`${'A'.repeat(120)}…`);
      expect(desc).toBeInTheDocument();
      expect(desc).not.toHaveTextContent('A'.repeat(121));
    });

    it('shows full body when content is exactly 120 chars', async () => {
      const exact = 'B'.repeat(120);
      await renderWithFact(exact);
      expect(screen.getByText(exact)).toBeInTheDocument();
    });

    it('Collapse all hides all card bodies', async () => {
      render(<BrainstormPage onClose={() => {}} />);
      fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
        target: { value: 'test' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
      await simulateStream([
        '[FACT:character|Alice|Desc A][FACT:character|Bob|Desc B]',
      ]);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Open idea detail for Alice' })).toBeInTheDocument());

      // Both descriptions visible initially
      expect(screen.getByText('Desc A')).toBeInTheDocument();
      expect(screen.getByText('Desc B')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Collapse all fact cards' }));

      expect(screen.queryByText('Desc A')).not.toBeInTheDocument();
      expect(screen.queryByText('Desc B')).not.toBeInTheDocument();
    });

    it('Expand all shows all card bodies after collapse', async () => {
      render(<BrainstormPage onClose={() => {}} />);
      fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
        target: { value: 'test' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
      await simulateStream([
        '[FACT:character|Alice|Desc A][FACT:character|Bob|Desc B]',
      ]);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Open idea detail for Alice' })).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Collapse all fact cards' }));
      expect(screen.queryByText('Desc A')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Expand all fact cards' }));
      expect(screen.getByText('Desc A')).toBeInTheDocument();
      expect(screen.getByText('Desc B')).toBeInTheDocument();
    });

    it('Expand all / Collapse all buttons are absent when no facts exist', () => {
      render(<BrainstormPage onClose={() => {}} />);
      expect(screen.queryByRole('button', { name: 'Expand all fact cards' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Collapse all fact cards' })).not.toBeInTheDocument();
    });

    it('title click does not interfere with chevron toggle', async () => {
      await renderWithFact('A brave warrior');
      // Clicking the title button opens the drawer but does not collapse the body preview
      const nameEl = screen.getByRole('button', { name: 'Open idea detail for Hero' });
      fireEvent.click(nameEl);
      // Body preview still in the card — title click doesn't change expand state.
      // getAllByText handles the case where the drawer also shows the same text.
      const matches = screen.getAllByText('A brave warrior');
      expect(matches.some((el) => el.classList.contains('idea-card-body'))).toBe(true);
    });
  });
});

describe('BrainstormPage — archive ContinuityPanel integration (SKY-2585 AC-F-01)', () => {
  const archiveApi = {
    archiveListContinuity: vi.fn().mockResolvedValue({ items: [] }),
    archiveResolveContinuity: vi.fn().mockResolvedValue({ ok: true }),
    archiveScanContinuity: vi.fn().mockResolvedValue(undefined),
    onArchiveContScanStart: () => () => {},
    onArchiveContScanResult: () => () => {},
    onArchiveContScanError: () => () => {},
    settingsGet: vi.fn().mockResolvedValue({}),
    settingsSet: vi.fn().mockResolvedValue(undefined),
  };

  it('does not render ContinuityPanel when archiveContinuityEnabled is false (default)', () => {
    (window as unknown as { api: unknown }).api = buildApi();
    render(<BrainstormPage onClose={() => {}} />);
    expect(screen.queryByRole('status', { name: /continuity/i })).toBeNull();
  });

  it('renders ContinuityPanel loading state when archiveContinuityEnabled is true', async () => {
    (window as unknown as { api: unknown }).api = buildApi(archiveApi);
    render(<BrainstormPage onClose={() => {}} archiveContinuityEnabled={true} />);
    await waitFor(() => expect(archiveApi.archiveListContinuity).toHaveBeenCalled());
  });
});

describe('BrainstormPage — prompt char counter', () => {
  it('shows 0 / 2,000 counter when textarea is empty', () => {
    render(<BrainstormPage onClose={() => {}} />);
    expect(screen.getByText('0 / 2,000')).toBeInTheDocument();
  });

  it('updates counter as the user types', () => {
    render(<BrainstormPage onClose={() => {}} />);
    const textarea = screen.getByLabelText(/brainstorm prompt/i);
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    expect(screen.getByText('5 / 2,000')).toBeInTheDocument();
  });

  it('counter shows warning style at >=90% of cap', () => {
    render(<BrainstormPage onClose={() => {}} />);
    const textarea = screen.getByLabelText(/brainstorm prompt/i);
    fireEvent.change(textarea, { target: { value: 'a'.repeat(1800) } });
    const counter = screen.getByText('1,800 / 2,000');
    expect(counter.className).toContain('brainstorm-char-counter--warning');
  });

  it('counter shows error style at cap', () => {
    render(<BrainstormPage onClose={() => {}} />);
    const textarea = screen.getByLabelText(/brainstorm prompt/i);
    fireEvent.change(textarea, { target: { value: 'a'.repeat(2000) } });
    const counter = screen.getByText('2,000 / 2,000');
    expect(counter.className).toContain('brainstorm-char-counter--error');
  });

  it('shows paste-truncation warning when pasted text would exceed cap', () => {
    render(<BrainstormPage onClose={() => {}} />);
    const textarea = screen.getByLabelText(/brainstorm prompt/i);
    fireEvent.change(textarea, { target: { value: 'a'.repeat(1990) } });
    fireEvent.paste(textarea, {
      clipboardData: { getData: () => 'b'.repeat(20) },
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/pasted text exceeded/i);
  });

  it('does not show paste warning when paste fits within cap', () => {
    render(<BrainstormPage onClose={() => {}} />);
    const textarea = screen.getByLabelText(/brainstorm prompt/i);
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.paste(textarea, {
      clipboardData: { getData: () => ' world' },
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('BrainstormPage — sort + filter controls (Wave 3.2)', () => {
  async function renderWithFacts() {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await simulateStream([
      '[FACT:character|Alice|A hero]',
      '[FACT:location|Forest|Dark woods]',
      '[FACT:item|Sword|Magic blade]',
    ]);
    await waitFor(() => expect(screen.getByTestId('bs-facts-controls')).toBeInTheDocument());
  }

  it('shows sort and filter dropdowns when facts exist', async () => {
    await renderWithFacts();
    expect(screen.getByTestId('bs-sort-select')).toBeInTheDocument();
    expect(screen.getByTestId('bs-filter-select')).toBeInTheDocument();
  });

  it('sort select defaults to Newest first', async () => {
    await renderWithFacts();
    expect(screen.getByTestId('bs-sort-select')).toHaveValue('newest');
  });

  it('filter select defaults to All types', async () => {
    await renderWithFacts();
    expect(screen.getByTestId('bs-filter-select')).toHaveValue('all');
  });

  it('sort dropdown includes core sort options', async () => {
    await renderWithFacts();
    const select = screen.getByTestId('bs-sort-select');
    const options = Array.from((select as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toEqual(expect.arrayContaining(['newest', 'oldest', 'by-type', 'by-status']));
  });

  it('filter dropdown has all five options', async () => {
    await renderWithFacts();
    const select = screen.getByTestId('bs-filter-select');
    const options = Array.from((select as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toEqual(['all', 'character', 'location', 'item', 'note']);
  });

  it('filtering to Characters hides location and item groups', async () => {
    await renderWithFacts();
    fireEvent.change(screen.getByTestId('bs-filter-select'), {
      target: { value: 'character' },
    });
    await waitFor(() => {
      expect(screen.getByTestId('bs-group-toggle-character')).toBeInTheDocument();
      expect(screen.queryByTestId('bs-group-toggle-location')).not.toBeInTheDocument();
      expect(screen.queryByTestId('bs-group-toggle-item')).not.toBeInTheDocument();
    });
  });

  it('filtering to a type with no matching ideas shows empty message', async () => {
    await renderWithFacts();
    fireEvent.change(screen.getByTestId('bs-filter-select'), {
      target: { value: 'note' },
    });
    await waitFor(() => {
      expect(screen.getByTestId('bs-empty-type-note')).toBeInTheDocument();
      expect(screen.getByTestId('bs-empty-type-note')).toHaveTextContent(/no concept notes ideas yet/i);
    });
  });

  it('changing sort order does not cause IPC or disk calls', async () => {
    await renderWithFacts();
    const callsBefore = mockBrainstormWriteNote.mock.calls.length;
    fireEvent.change(screen.getByTestId('bs-sort-select'), { target: { value: 'oldest' } });
    fireEvent.change(screen.getByTestId('bs-sort-select'), { target: { value: 'by-type' } });
    fireEvent.change(screen.getByTestId('bs-sort-select'), { target: { value: 'by-status' } });
    expect(mockBrainstormWriteNote.mock.calls.length).toBe(callsBefore);
  });

  it('changing filter does not cause IPC or disk calls', async () => {
    await renderWithFacts();
    const callsBefore = mockBrainstormWriteNote.mock.calls.length;
    fireEvent.change(screen.getByTestId('bs-filter-select'), { target: { value: 'character' } });
    fireEvent.change(screen.getByTestId('bs-filter-select'), { target: { value: 'all' } });
    expect(mockBrainstormWriteNote.mock.calls.length).toBe(callsBefore);
  });

  it('Collapse all hides fact cards within all groups', async () => {
    await renderWithFacts();
    fireEvent.click(screen.getByTestId('bs-collapse-all'));
    await waitFor(() => {
      // idea-card-{id} cards should not be present (only group headers remain)
      expect(screen.queryAllByRole('listitem').filter((el) =>
        el.getAttribute('data-testid')?.match(/^idea-card-[^c]/)
      )).toHaveLength(0);
    });
  });

  it('Expand all after Collapse all restores all visible cards', async () => {
    await renderWithFacts();
    fireEvent.click(screen.getByTestId('bs-collapse-all'));
    fireEvent.click(screen.getByTestId('bs-expand-all'));
    await waitFor(() => {
      // each IdeaCard renders as a <li> with data-testid="idea-card-{id}" (not chips)
      const cards = screen.getAllByRole('listitem').filter((el) =>
        /^idea-card-(?!chips-)/.test(el.getAttribute('data-testid') ?? ''),
      );
      expect(cards.length).toBe(3);
    });
  });

  it('sort and filter controls are not shown when there are no facts', () => {
    render(<BrainstormPage onClose={() => {}} />);
    expect(screen.queryByTestId('bs-facts-controls')).not.toBeInTheDocument();
  });
});

describe('BrainstormPage — chip-click entity navigation (SKY-1264)', () => {
  async function renderWithFact(props: { onNavigateToEntity?: (id: string) => void; onNavigateToScene?: (id: string) => Promise<boolean> } = {}) {
    mockBrainstormWriteNote.mockResolvedValue({
      status: 'written',
      path: 'Universes/World/Characters/Lyra Ashveil.md',
      suggestionId: 'sug-1',
      reason: 'default-layout',
    });
    render(<BrainstormPage onClose={() => {}} {...props} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), { target: { value: 'tell me about the hero' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await simulateStream(['[FACT:character|Lyra Ashveil|A young mage]']);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Navigate to Lyra Ashveil' })).toBeInTheDocument());
  }

  it('navigates to entity when chip is clicked and entity exists in vault', async () => {
    const onNavigateToEntity = vi.fn();
    mockEntityList.mockResolvedValue({
      entities: [{ id: 'real-entity-id', name: 'Lyra Ashveil', type: 'character' }],
    });

    await renderWithFact({ onNavigateToEntity });

    fireEvent.click(screen.getByRole('button', { name: 'Navigate to Lyra Ashveil' }));

    await waitFor(() => expect(onNavigateToEntity).toHaveBeenCalledWith('real-entity-id'));
  });

  it('shows "Entity not found in vault" toast when entity is missing from vault', async () => {
    mockEntityList.mockResolvedValue({ entities: [] });

    await renderWithFact();

    fireEvent.click(screen.getByRole('button', { name: 'Navigate to Lyra Ashveil' }));

    await waitFor(() => expect(screen.getByText('Entity not found in vault')).toBeInTheDocument());
  });

  it('shows "Entity not found in vault" toast on entityList API failure', async () => {
    mockEntityList.mockRejectedValue(new Error('network error'));

    await renderWithFact();

    fireEvent.click(screen.getByRole('button', { name: 'Navigate to Lyra Ashveil' }));

    await waitFor(() => expect(screen.getByText('Entity not found in vault')).toBeInTheDocument());
  });
});

describe('BrainstormPage — open-in-writing-panel (SKY-1393)', () => {
  const MANIFEST_WITH_SCENE = {
    stories: [{ title: 'My Story', chapters: [{ title: 'Ch 1', scenes: [{ id: 'scene-1', title: 'Opening Scene' }] }] }],
  };
  const MANIFEST_EMPTY = { stories: [] };

  function buildApiWithScenes(overrides: Record<string, unknown> = {}) {
    return buildApi({
      readManifest: vi.fn().mockResolvedValue(MANIFEST_WITH_SCENE),
      sceneAppendBrainstormNote: vi.fn().mockResolvedValue({ appended: true }),
      ...overrides,
    });
  }

  async function renderWithFact(
    props: { onNavigateToScene?: (id: string) => Promise<boolean> } = {},
    apiOverrides: Record<string, unknown> = {},
  ) {
    (window as unknown as { api: unknown }).api = buildApiWithScenes(apiOverrides);
    mockBrainstormWriteNote.mockResolvedValue({
      status: 'written',
      path: 'Characters/Lyra.md',
      suggestionId: 'sug-1',
      reason: 'default-layout',
    });
    render(<BrainstormPage onClose={() => {}} {...props} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), { target: { value: 'tell me about the hero' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await simulateStream(['[FACT:character|Lyra Ashveil|A young mage]']);
    await waitFor(() => expect(screen.getAllByText('Lyra Ashveil').length).toBeGreaterThan(0));
  }

  it('context menu shows "Open in writing panel" item', async () => {
    await renderWithFact();
    fireEvent.click(screen.getByRole('button', { name: 'Idea actions for Lyra Ashveil' }));
    expect(screen.getByTestId('menu-item-open-in-writing-panel')).toBeInTheDocument();
  });

  it('opens scene picker when no linkedSceneId and scenes exist', async () => {
    await renderWithFact();
    fireEvent.click(screen.getByRole('button', { name: 'Idea actions for Lyra Ashveil' }));
    await act(async () => {
      fireEvent.click(screen.getByTestId('menu-item-open-in-writing-panel'));
    });
    await waitFor(() => expect(screen.getByTestId('scene-picker')).toBeInTheDocument());
  });

  it('picker selection calls sceneAppendBrainstormNote + navigate + toast', async () => {
    const onNavigateToScene = vi.fn().mockResolvedValue(true);
    await renderWithFact({ onNavigateToScene });

    fireEvent.click(screen.getByRole('button', { name: 'Idea actions for Lyra Ashveil' }));
    await act(async () => {
      fireEvent.click(screen.getByTestId('menu-item-open-in-writing-panel'));
    });
    await waitFor(() => expect(screen.getByTestId('scene-picker')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId('scene-picker-item-scene-1'));
    });

    await waitFor(() => {
      expect((window as unknown as { api: { sceneAppendBrainstormNote: ReturnType<typeof vi.fn> } }).api.sceneAppendBrainstormNote)
        .toHaveBeenCalledWith('scene-1', expect.any(String));
      expect(onNavigateToScene).toHaveBeenCalledWith('scene-1');
      expect(screen.getByText('Opened in Opening Scene.')).toBeInTheDocument();
    });
  });

  it('shows "No scenes found" toast when manifest has no scenes', async () => {
    await renderWithFact({}, {
      readManifest: vi.fn().mockResolvedValue(MANIFEST_EMPTY),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Idea actions for Lyra Ashveil' }));
    await act(async () => {
      fireEvent.click(screen.getByTestId('menu-item-open-in-writing-panel'));
    });
    await waitFor(() =>
      expect(screen.getByText('No scenes found. Create a scene first.')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('scene-picker')).not.toBeInTheDocument();
  });

  it('shows "No scenes found" toast when readManifest throws', async () => {
    await renderWithFact({}, {
      readManifest: vi.fn().mockRejectedValue(new Error('IPC error')),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Idea actions for Lyra Ashveil' }));
    await act(async () => {
      fireEvent.click(screen.getByTestId('menu-item-open-in-writing-panel'));
    });
    await waitFor(() =>
      expect(screen.getByText('No scenes found. Create a scene first.')).toBeInTheDocument(),
    );
  });

  it('shows error toast when sceneAppendBrainstormNote throws after picker selection', async () => {
    const onNavigateToScene = vi.fn().mockResolvedValue(true);
    await renderWithFact({ onNavigateToScene }, {
      sceneAppendBrainstormNote: vi.fn().mockRejectedValue(new Error('IPC error')),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Idea actions for Lyra Ashveil' }));
    await act(async () => {
      fireEvent.click(screen.getByTestId('menu-item-open-in-writing-panel'));
    });
    await waitFor(() => expect(screen.getByTestId('scene-picker')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId('scene-picker-item-scene-1'));
    });

    await waitFor(() =>
      expect(screen.getByText('Failed to open in writing panel.')).toBeInTheDocument(),
    );
  });

  it('IdeaDetailDrawer shows "Open in writing panel" CTA', async () => {
    await renderWithFact();
    // Open the detail drawer via card title click
    fireEvent.click(screen.getByRole('button', { name: 'Open idea detail for Lyra Ashveil' }));
    await waitFor(() => expect(screen.getByTestId('idea-detail-drawer')).toBeInTheDocument());
    expect(screen.getByTestId('idd-open-in-writing-panel')).toBeInTheDocument();
  });

  it('fast-path: linkedSceneId skips picker and navigates directly', async () => {
    const DRAFT_KEY = 'brainstorm:draft';
    const onNavigateToScene = vi.fn().mockResolvedValue(true);
    (window as unknown as { api: unknown }).api = buildApiWithScenes();
    // Seed a fact with linkedSceneId via draft recovery
    const draft = {
      v: 2,
      savedAt: new Date().toISOString(),
      prompt: '',
      messages: [{ role: 'assistant', text: 'Here is a fact.' }],
      facts: [{
        id: 'fact-linked-1',
        type: 'character',
        name: 'Zara',
        content: 'A bold warrior',
        savedStatus: 'saved',
        savedPath: 'Characters/Zara.md',
        linkedSceneId: 'scene-1',
        createdAt: Date.now(),
      }],
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    render(<BrainstormPage onClose={() => {}} onNavigateToScene={onNavigateToScene} />);

    await waitFor(() => expect(screen.getAllByText('Zara').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: 'Idea actions for Zara' }));
    await act(async () => {
      fireEvent.click(screen.getByTestId('menu-item-open-in-writing-panel'));
    });

    await waitFor(() => {
      expect(onNavigateToScene).toHaveBeenCalledWith('scene-1');
      expect(screen.queryByTestId('scene-picker')).not.toBeInTheDocument();
      expect(screen.getByText('Opened in Opening Scene.')).toBeInTheDocument();
    });
  });
});

// ─── SKY-1392: drag-and-drop reorder + Alt+Arrow + localStorage persistence ───

async function seedTwoFacts() {
  render(<BrainstormPage onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), { target: { value: 'go' } });
  fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
  await simulateStream([
    '[FACT:character|Alpha|First character][FACT:character|Beta|Second character]',
  ]);
  await waitFor(() => expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0));
}

describe('BrainstormPage — custom order (SKY-1392)', () => {
  it('sort select includes Custom order option', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await simulateStream(['[FACT:character|Solo|A lone figure]']);
    await waitFor(() => expect(screen.getAllByText('Solo').length).toBeGreaterThan(0));

    const sortSelect = screen.getByTestId('bs-sort-select');
    expect(sortSelect).toHaveTextContent('Custom order');
  });

  it('drag handles are hidden when sort is not "custom"', async () => {
    await seedTwoFacts();
    // Default sort is 'newest' — no drag handles
    expect(document.querySelectorAll('.idea-card-drag-handle')).toHaveLength(0);
  });

  it('drag handles appear when switching to custom sort', async () => {
    await seedTwoFacts();
    await act(async () => {
      fireEvent.change(screen.getByTestId('bs-sort-select'), { target: { value: 'custom' } });
    });
    await waitFor(() =>
      expect(document.querySelectorAll('.idea-card-drag-handle').length).toBeGreaterThan(0),
    );
  });

  it('drag handles hidden in multi-select mode even with custom sort active', async () => {
    await seedTwoFacts();
    await act(async () => {
      fireEvent.change(screen.getByTestId('bs-sort-select'), { target: { value: 'custom' } });
    });
    await waitFor(() =>
      expect(document.querySelectorAll('.idea-card-drag-handle').length).toBeGreaterThan(0),
    );
    fireEvent.click(screen.getByTestId('bs-multiselect-toggle'));
    await waitFor(() =>
      expect(document.querySelectorAll('.idea-card-drag-handle')).toHaveLength(0),
    );
  });

  it('drag handles hidden while streaming (loading state)', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    // Seed one fact first
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), { target: { value: 'seed' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await simulateStream(['[FACT:note|SomeFact|detail]']);
    await waitFor(() => expect(screen.getAllByText('SomeFact').length).toBeGreaterThan(0));
    // Switch to custom sort
    await act(async () => {
      fireEvent.change(screen.getByTestId('bs-sort-select'), { target: { value: 'custom' } });
    });
    await waitFor(() =>
      expect(document.querySelectorAll('.idea-card-drag-handle').length).toBeGreaterThan(0),
    );
    // Start a second stream (loading = true)
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), { target: { value: 'more' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    });
    await waitFor(() =>
      expect(document.querySelectorAll('.idea-card-drag-handle')).toHaveLength(0),
    );
    // Clean up stream
    await act(async () => { endCb?.({ streamId: 'test-stream-1' }); });
  });

  it('drag reorders cards: drop second card above first', async () => {
    await seedTwoFacts();
    await act(async () => {
      fireEvent.change(screen.getByTestId('bs-sort-select'), { target: { value: 'custom' } });
    });

    await waitFor(() =>
      expect(document.querySelectorAll('.idea-card-drag-handle').length).toBeGreaterThan(0),
    );

    const cards = document.querySelectorAll('li[data-testid^="idea-card-"]');
    expect(cards.length).toBeGreaterThanOrEqual(2);
    const firstCard = cards[0] as HTMLElement;
    const secondCard = cards[1] as HTMLElement;

    // Drag second card over first (above mid-point) → second should land before first
    await act(async () => {
      fireEvent.dragStart(secondCard, { dataTransfer: { effectAllowed: '', setData: () => {} } });
      // Mock getBoundingClientRect so mid-point check works
      vi.spyOn(firstCard, 'getBoundingClientRect').mockReturnValue(
        { top: 100, height: 72, left: 0, right: 200, bottom: 172, width: 200, x: 0, y: 100, toJSON: () => ({}) }
      );
      fireEvent.dragOver(firstCard, { clientY: 110, dataTransfer: { dropEffect: '' } }); // above mid
      fireEvent.drop(firstCard, { dataTransfer: {} });
      fireEvent.dragEnd(secondCard);
    });

    await waitFor(() => {
      const updatedCards = document.querySelectorAll('li[data-testid^="idea-card-"]');
      const names = Array.from(updatedCards).map(
        (c) => c.querySelector('.idea-card-title')?.textContent?.trim(),
      );
      // secondCard (Alpha, originally at index 1) was dragged above firstCard (Beta, index 0).
      expect(names[0]).toBe('Alpha');
      expect(names[1]).toBe('Beta');
    });
  });

  it('Alt+Up moves card up in custom sort', async () => {
    await seedTwoFacts();
    await act(async () => {
      fireEvent.change(screen.getByTestId('bs-sort-select'), { target: { value: 'custom' } });
    });

    await waitFor(() =>
      expect(document.querySelectorAll('.idea-card-drag-handle').length).toBeGreaterThan(0),
    );

    // Focus the second card
    const cards = document.querySelectorAll('li[data-testid^="idea-card-"]');
    const secondCard = cards[1] as HTMLElement;
    secondCard.focus();

    await act(async () => {
      fireEvent.keyDown(document, { key: 'ArrowUp', altKey: true });
    });

    await waitFor(() => {
      const updatedCards = document.querySelectorAll('li[data-testid^="idea-card-"]');
      const names = Array.from(updatedCards).map(
        (c) => c.querySelector('.idea-card-title')?.textContent?.trim(),
      );
      // secondCard (Alpha, at index 1) was moved up with Alt+Up — it lands before Beta.
      expect(names[0]).toBe('Alpha');
      expect(names[1]).toBe('Beta');
    });
  });

  it('persists custom order to localStorage after reorder', async () => {
    await seedTwoFacts();
    await act(async () => {
      fireEvent.change(screen.getByTestId('bs-sort-select'), { target: { value: 'custom' } });
    });
    await waitFor(() =>
      expect(document.querySelectorAll('.idea-card-drag-handle').length).toBeGreaterThan(0),
    );

    const cards = document.querySelectorAll('li[data-testid^="idea-card-"]');
    const secondCard = cards[1] as HTMLElement;
    secondCard.focus();
    await act(async () => {
      fireEvent.keyDown(document, { key: 'ArrowUp', altKey: true });
    });

    await waitFor(() => {
      const raw = localStorage.getItem('brainstorm:draft');
      expect(raw).not.toBeNull();
      const draft = JSON.parse(raw!);
      expect(draft.sortMode).toBe('custom');
      expect(Array.isArray(draft.customOrder)).toBe(true);
      expect(draft.customOrder.length).toBeGreaterThan(0);
    });
  });

  it('restores custom order and sort mode from localStorage on mount', async () => {
    // Pre-seed localStorage with custom order [betaId, alphaId]
    const fakeDraft = {
      v: 2,
      savedAt: new Date().toISOString(),
      prompt: '',
      messages: [],
      facts: [
        { id: 'id-alpha', type: 'character', name: 'Alpha', content: 'First', savedStatus: 'unsaved', createdAt: 1000 },
        { id: 'id-beta', type: 'character', name: 'Beta', content: 'Second', savedStatus: 'unsaved', createdAt: 2000 },
      ],
      sortMode: 'custom',
      customOrder: ['id-beta', 'id-alpha'],
    };
    localStorage.setItem('brainstorm:draft', JSON.stringify(fakeDraft));

    render(<BrainstormPage onClose={() => {}} />);

    await waitFor(() => {
      // Sort select should show 'custom'
      expect(screen.getByTestId('bs-sort-select')).toHaveValue('custom');
      // Cards should be in beta-first order
      const cards = document.querySelectorAll('li[data-testid^="idea-card-"]');
      const names = Array.from(cards).map(
        (c) => c.querySelector('.idea-card-title')?.textContent?.trim(),
      );
      expect(names[0]).toBe('Beta');
      expect(names[1]).toBe('Alpha');
    });
  });

  it('shows "Order not saved — storage full." toast on QuotaExceededError', async () => {
    await seedTwoFacts();
    await act(async () => {
      fireEvent.change(screen.getByTestId('bs-sort-select'), { target: { value: 'custom' } });
    });
    await waitFor(() =>
      expect(document.querySelectorAll('.idea-card-drag-handle').length).toBeGreaterThan(0),
    );

    // Make localStorage.setItem throw QuotaExceededError.
    // vitest's jsdom exposes setItem as an own property on localStorage (not on
    // Storage.prototype), so vi.spyOn is the correct intercept point.
    const setItemSpy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });

    const secondCard = document.querySelectorAll('li[data-testid^="idea-card-"]')[1] as HTMLElement;
    secondCard.focus();
    await act(async () => {
      fireEvent.keyDown(document, { key: 'ArrowUp', altKey: true });
    });

    await waitFor(() =>
      expect(screen.getByText(/order not saved — storage full/i)).toBeInTheDocument(),
    );

    setItemSpy.mockRestore();
  });
});

// ─── SKY-1485: Proposal queue ────────────────────────────────────────────────

function makeBrainstormSuggestion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prop-1',
    source_agent: 'brainstorm',
    confidence: 0.9,
    rationale: 'character: Lyra Stormwind',
    target: 'Characters/Heroes/',
    payload_json: JSON.stringify({
      kind: 'character',
      title: 'Lyra Stormwind',
      body: 'A fierce warrior from the northern mountains.',
    }),
    status: 'proposed',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function buildApiWithProposals(
  proposals: unknown[],
  extraOverrides: Record<string, unknown> = {},
) {
  const mockSuggestionsList = vi.fn().mockImplementation(
    (_status?: string, sourceAgent?: string) => {
      if (sourceAgent === 'brainstorm') {
        return Promise.resolve({ suggestions: proposals });
      }
      return Promise.resolve({ suggestions: [] });
    },
  );
  return buildApi({ suggestionsList: mockSuggestionsList, ...extraOverrides });
}

describe('BrainstormPage — proposal queue (SKY-1485)', () => {
  it('calls suggestionsList("proposed", "brainstorm") on mount', async () => {
    const mockSuggestionsList = vi.fn().mockResolvedValue({ suggestions: [] });
    (window as unknown as { api: unknown }).api = buildApi({ suggestionsList: mockSuggestionsList });

    render(<BrainstormPage onClose={() => {}} />);

    await waitFor(() =>
      expect(mockSuggestionsList).toHaveBeenCalledWith('proposed', 'brainstorm'),
    );
  });

  it('renders ProposalCard when pending proposals are loaded', async () => {
    (window as unknown as { api: unknown }).api = buildApiWithProposals([makeBrainstormSuggestion()]);

    render(<BrainstormPage onClose={() => {}} />);

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Proposed notes' })).toBeInTheDocument(),
    );
    expect(screen.getByText('Lyra Stormwind')).toBeInTheDocument();
  });

  it('does not render ProposalCard region when no proposals are queued', async () => {
    (window as unknown as { api: unknown }).api = buildApiWithProposals([]);

    render(<BrainstormPage onClose={() => {}} />);

    // Wait for both suggestionsList calls to settle so proposals state is final
    await act(async () => {});
    await act(async () => {});

    expect(screen.queryByRole('region', { name: 'Proposed notes' })).not.toBeInTheDocument();
  });

  it('appends incoming proposals from onBrainstormProposalQueued push event', async () => {
    let proposalQueuedCb: ((data: { proposals: unknown[] }) => void) | null = null;
    (window as unknown as { api: unknown }).api = buildApi({
      onBrainstormProposalQueued: (cb: (data: { proposals: unknown[] }) => void) => {
        proposalQueuedCb = cb;
        return () => { proposalQueuedCb = null; };
      },
    });

    render(<BrainstormPage onClose={() => {}} />);
    await waitFor(() => expect(proposalQueuedCb).not.toBeNull());

    act(() => {
      proposalQueuedCb?.({
        proposals: [{
          id: 'push-1',
          kind: 'location',
          title: 'The Frozen Peak',
          body: 'A mountain summit covered in eternal ice.',
          destinationPath: 'Locations/Mountains/',
          frontmatter: {},
          sourceConversationTurnId: 'turn-2',
          extractionConfidence: 0.85,
        }],
      });
    });

    await waitFor(() =>
      expect(screen.getByText('The Frozen Peak')).toBeInTheDocument(),
    );
  });

  it('Confirm calls brainstormProposalConfirm + brainstormWriteNote', async () => {
    const mockProposalConfirm = vi.fn().mockResolvedValue({ ok: true });
    (window as unknown as { api: unknown }).api = buildApiWithProposals(
      [makeBrainstormSuggestion()],
      { brainstormProposalConfirm: mockProposalConfirm },
    );

    render(<BrainstormPage onClose={() => {}} />);
    const confirmBtn = await screen.findByTestId('pc-confirm-btn');
    await act(async () => { fireEvent.click(confirmBtn); });

    await waitFor(() =>
      expect(mockProposalConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ proposalId: 'prop-1', decision: 'confirm' }),
      ),
    );
    await waitFor(() =>
      expect(mockBrainstormWriteNote).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Lyra Stormwind', category: 'character' }),
      ),
    );
  });

  it('Confirm routes scene_crafter_card proposals to Scene Crafter board', async () => {
    const mockSceneCrafterAddCard = vi.fn().mockResolvedValue({ ok: true });
    (window as unknown as { api: unknown }).api = buildApiWithProposals(
      [makeBrainstormSuggestion({
        payload_json: JSON.stringify({
          kind: 'scene_crafter_card',
          title: 'HeroArrivesAtVillage',
          body: 'The hero rides into the village at dawn.',
        }),
        target: 'HeroArrivesAtVillage',
      })],
      { sceneCrafterAddCard: mockSceneCrafterAddCard },
    );

    render(<BrainstormPage onClose={() => {}} activeStorySlug="story-1" />);
    const confirmBtn = await screen.findByTestId('pc-confirm-btn');
    await act(async () => { fireEvent.click(confirmBtn); });

    await waitFor(() =>
      expect(mockSceneCrafterAddCard).toHaveBeenCalledWith({
        storySlug: 'story-1',
        laneIndex: 0,
        card: { wikilink: 'HeroArrivesAtVillage', title: 'HeroArrivesAtVillage', done: false },
      }),
    );
    expect(mockBrainstormWriteNote).not.toHaveBeenCalled();
  });

  it('Confirm removes proposal from queue', async () => {
    (window as unknown as { api: unknown }).api = buildApiWithProposals(
      [makeBrainstormSuggestion()],
      { brainstormProposalConfirm: vi.fn().mockResolvedValue({ ok: true }) },
    );

    render(<BrainstormPage onClose={() => {}} />);
    const confirmBtn = await screen.findByTestId('pc-confirm-btn');
    await act(async () => { fireEvent.click(confirmBtn); });

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Proposed notes' })).not.toBeInTheDocument(),
    );
  });

  it('Reject calls brainstormProposalReject and removes the proposal', async () => {
    const mockProposalReject = vi.fn().mockResolvedValue({ ok: true });
    (window as unknown as { api: unknown }).api = buildApiWithProposals(
      [makeBrainstormSuggestion()],
      { brainstormProposalReject: mockProposalReject },
    );

    render(<BrainstormPage onClose={() => {}} />);
    const rejectBtn = await screen.findByTestId('pc-reject-btn');
    fireEvent.click(rejectBtn);

    await waitFor(() =>
      expect(mockProposalReject).toHaveBeenCalledWith(
        expect.objectContaining({ proposalId: 'prop-1', title: 'Lyra Stormwind' }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Proposed notes' })).not.toBeInTheDocument(),
    );
  });

  it('Dismiss all calls brainstormProposalReject for every proposal', async () => {
    const mockProposalReject = vi.fn().mockResolvedValue({ ok: true });
    (window as unknown as { api: unknown }).api = buildApiWithProposals(
      [
        makeBrainstormSuggestion(),
        makeBrainstormSuggestion({
          id: 'prop-2',
          payload_json: JSON.stringify({ kind: 'location', title: 'The Peak', body: 'Cold.' }),
        }),
      ],
      { brainstormProposalReject: mockProposalReject },
    );

    render(<BrainstormPage onClose={() => {}} />);
    const dismissBtn = await screen.findByTestId('pc-dismiss-all-btn');
    fireEvent.click(dismissBtn);

    await waitFor(() => expect(mockProposalReject).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('region', { name: 'Proposed notes' })).not.toBeInTheDocument();
  });

  it('Blank-mode proposal shows disambiguation prompt, not confirm button', async () => {
    (window as unknown as { api: unknown }).api = buildApiWithProposals([
      makeBrainstormSuggestion({ target: '' }),
    ]);

    render(<BrainstormPage onClose={() => {}} />);

    await waitFor(() =>
      expect(screen.getByTestId('pc-blank-prompt')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('pc-confirm-btn')).not.toBeInTheDocument();
  });

  it('push event deduplicates proposals already in queue', async () => {
    let proposalQueuedCb: ((data: { proposals: unknown[] }) => void) | null = null;
    (window as unknown as { api: unknown }).api = buildApiWithProposals(
      [makeBrainstormSuggestion()],
      {
        onBrainstormProposalQueued: (cb: (data: { proposals: unknown[] }) => void) => {
          proposalQueuedCb = cb;
          return () => { proposalQueuedCb = null; };
        },
      },
    );

    render(<BrainstormPage onClose={() => {}} />);
    // Wait for mount proposal to load
    await waitFor(() => expect(screen.getByText('Lyra Stormwind')).toBeInTheDocument());
    await waitFor(() => expect(proposalQueuedCb).not.toBeNull());

    // Push a duplicate — same id as the loaded proposal
    act(() => {
      proposalQueuedCb?.({
        proposals: [{
          id: 'prop-1',
          kind: 'character',
          title: 'Lyra Stormwind',
          body: 'Duplicate.',
          destinationPath: 'Characters/Heroes/',
          frontmatter: {},
          sourceConversationTurnId: 'turn-1',
          extractionConfidence: 0.9,
        }],
      });
    });

    await act(async () => {});
    // Still only 1 proposal in queue — no "1 of N proposals" header
    expect(screen.queryByText(/1 of/)).not.toBeInTheDocument();
    expect(screen.getByText('1 proposal')).toBeInTheDocument();
  });
});

describe('Voice IO state machine (SKY-1503)', () => {
  const renderVoiceEnabledBrainstorm = () => render(<BrainstormPage onClose={() => {}} voiceEnabled />);

  beforeEach(() => {
    installMediaRecorderMock();
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { cb(); return 0; });
  });
  afterEach(() => {
    removeMediaRecorderMock();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('AC-V-00: hides the mic button when voice is disabled by default', () => {
    render(<BrainstormPage onClose={() => {}} />);
    expect(screen.queryByTestId('brainstorm-mic-btn')).not.toBeInTheDocument();
  });

  it('AC-V-00: shows the mic button when voice is enabled', () => {
    renderVoiceEnabledBrainstorm();
    expect(screen.getByTestId('brainstorm-mic-btn')).toBeInTheDocument();
  });

  it('AC-V-01: mic button starts in idle state with correct aria-label', () => {
    renderVoiceEnabledBrainstorm();
    const btn = screen.getByTestId('brainstorm-mic-btn');
    expect(btn.getAttribute('aria-label')).toBe('Start voice input');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('AC-V-01: mic button transitions to listening state on click', async () => {
    renderVoiceEnabledBrainstorm();
    const btn = screen.getByTestId('brainstorm-mic-btn');
    fireEvent.click(btn);
    // getUserMedia is async; waitFor listening state
    await waitFor(() => {
      expect(btn.getAttribute('aria-label')).toBe('Stop voice input — listening');
      expect(btn.getAttribute('aria-pressed')).toBe('true');
    });
  });

  it('AC-V-02: transcript strip is not visible in idle state', () => {
    renderVoiceEnabledBrainstorm();
    const strip = screen.getByTestId('voice-transcript-strip');
    expect(strip.className).not.toContain('voice-transcript-strip--visible');
  });

  it('AC-V-02: transcript strip becomes visible in listening state', async () => {
    renderVoiceEnabledBrainstorm();
    fireEvent.click(screen.getByTestId('brainstorm-mic-btn'));
    await waitFor(() => {
      const strip = screen.getByTestId('voice-transcript-strip');
      expect(strip.className).toContain('voice-transcript-strip--visible');
    });
  });

  it('AC-V-04: Escape key cancels voice input and announces cancellation', async () => {
    renderVoiceEnabledBrainstorm();
    fireEvent.click(screen.getByTestId('brainstorm-mic-btn'));
    // Wait for listening state
    await waitFor(() =>
      expect(screen.getByTestId('brainstorm-mic-btn').getAttribute('aria-label')).toBe('Stop voice input — listening'),
    );
    fireEvent.keyDown(document.body, { key: 'Escape', bubbles: true });
    await waitFor(() => {
      const btn = screen.getByTestId('brainstorm-mic-btn');
      expect(btn.getAttribute('aria-label')).toBe('Start voice input');
    });
    const voiceAlert = screen.getByTestId('voice-alert');
    expect(voiceAlert.textContent).toContain('Voice input cancelled');
  });

  it('AC-V-05: aria-live polite region is always in DOM', () => {
    render(<BrainstormPage onClose={() => {}} />);
    const regions = document.querySelectorAll('[aria-live="polite"]');
    expect(regions.length).toBeGreaterThan(0);
  });

  it('AC-V-05: voice assertive region is always in DOM', () => {
    render(<BrainstormPage onClose={() => {}} />);
    const region = screen.getByTestId('voice-alert');
    expect(region).toBeTruthy();
    expect(region.getAttribute('aria-live')).toBe('assertive');
  });

  it('AC-V-01: processing state renders correctly while voiceTranscribe is in-flight', async () => {
    // Never-resolving mock keeps the component in processing state indefinitely.
    (window as unknown as { api: unknown }).api = buildApi({
      voiceTranscribe: vi.fn().mockReturnValue(new Promise(() => {})),
    });
    renderVoiceEnabledBrainstorm();
    const btn = screen.getByTestId('brainstorm-mic-btn');
    fireEvent.click(btn);
    // Wait for listening
    await waitFor(() => expect(btn.getAttribute('aria-label')).toBe('Stop voice input — listening'));
    // Click to stop (triggers transcription)
    fireEvent.click(btn);
    await waitFor(() => expect(btn.getAttribute('aria-label')).toBe('Processing speech…'));
  });
});

// ─── Part G: TTS voice controls (mirrors WritingAssistantPanel's contract) ────
describe('BrainstormPage — TTS voice controls', () => {
  // Pass configured Piper settings so tests exercise the IPC path (voiceSpeak).
  // The OS-speechSynthesis fallback path is covered by useTtsPlayer.test.ts.
  const piperSettings = { enabled: true, provider: 'local' as const, localBinaryPath: '/piper' };

  async function renderWithReply(text = 'Great idea for a story.') {
    render(<BrainstormPage onClose={() => {}} ttsSettings={piperSettings} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'Tell me about my hero' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await simulateStream([text]);
    await waitFor(() => screen.getByRole('button', { name: /hear suggestion aloud/i }));
  }

  it('AC-V-06: mute button is present in the header', () => {
    render(<BrainstormPage onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /mute voice playback/i })).toBeInTheDocument();
  });

  it('AC-V-06: mute button toggles its label and aria-pressed', () => {
    render(<BrainstormPage onClose={() => {}} />);
    const btn = screen.getByRole('button', { name: /mute voice playback/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(btn);

    expect(screen.getByRole('button', { name: /unmute voice playback/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /unmute voice playback/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('AC-V-07: Hear button appears on a completed assistant reply', async () => {
    await renderWithReply();
    expect(screen.getByRole('button', { name: /hear suggestion aloud/i })).toBeInTheDocument();
  });

  it('AC-V-07: no Hear button while the reply is still streaming', async () => {
    render(<BrainstormPage onClose={() => {}} ttsSettings={piperSettings} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'Tell me about my hero' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await waitFor(() => expect(tokenCb).not.toBeNull());
    await act(async () => {
      tokenCb?.({ streamId: 'test-stream-1', token: 'Streaming…' });
    });

    expect(screen.queryByRole('button', { name: /hear suggestion aloud/i })).not.toBeInTheDocument();

    // Finish the stream — the button appears once streaming completes.
    await act(async () => { endCb?.({ streamId: 'test-stream-1' }); });
    expect(screen.getByRole('button', { name: /hear suggestion aloud/i })).toBeInTheDocument();
  });

  it('AC-V-07: clicking Hear calls voiceSpeak with the reply text', async () => {
    await renderWithReply('Great idea for a story.');
    fireEvent.click(screen.getByRole('button', { name: /hear suggestion aloud/i }));
    expect(mockVoiceSpeak).toHaveBeenCalledWith('Great idea for a story.');
  });

  it('AC-V-07: button switches to Stop while playing', async () => {
    await renderWithReply();
    fireEvent.click(screen.getByRole('button', { name: /hear suggestion aloud/i }));
    // voiceSpeak resolves next tick — button shows stop immediately (optimistic)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /stop voice playback/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /stop voice playback/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: /hear suggestion aloud/i })).not.toBeInTheDocument();
  });

  it('AC-V-07: onVoiceSpeakDone event resets button back to Hear', async () => {
    let fireDone!: (evt: { speakId: string }) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockOnVoiceSpeakDone as any).mockImplementationOnce((cb: (evt: { speakId: string }) => void) => {
      fireDone = cb;
      return () => {};
    });

    await renderWithReply();
    fireEvent.click(screen.getByRole('button', { name: /hear suggestion aloud/i }));
    await waitFor(() => screen.getByRole('button', { name: /stop voice playback/i }));

    // speakId is 'speak-1' per default mock
    await act(async () => { fireDone({ speakId: 'speak-1' }); });

    expect(screen.getByRole('button', { name: /hear suggestion aloud/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /stop voice playback/i })).not.toBeInTheDocument();
  });

  it('AC-V-07: clicking Stop cancels playback via voiceSpeakCancel', async () => {
    await renderWithReply();
    fireEvent.click(screen.getByRole('button', { name: /hear suggestion aloud/i }));
    await waitFor(() => screen.getByRole('button', { name: /stop voice playback/i }));
    fireEvent.click(screen.getByRole('button', { name: /stop voice playback/i }));
    expect(mockVoiceSpeakCancel).toHaveBeenCalledWith('speak-1');
  });

  it('one reply plays at a time — Hear on a second reply supersedes the first', async () => {
    await renderWithReply('Reply one.');

    // Second exchange produces a second assistant reply.
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'And the villain?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await simulateStream(['Reply two.']);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /hear suggestion aloud/i })).toHaveLength(2),
    );

    fireEvent.click(screen.getAllByRole('button', { name: /hear suggestion aloud/i })[0]);
    await waitFor(() => screen.getByRole('button', { name: /stop voice playback/i }));

    // Start the second reply — the first resets to Hear; only one Stop at a time.
    fireEvent.click(screen.getAllByRole('button', { name: /hear suggestion aloud/i })[0]);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /stop voice playback/i })).toHaveLength(1),
    );
    expect(mockVoiceSpeakCancel).toHaveBeenCalledWith('speak-1');
    expect(mockVoiceSpeak).toHaveBeenCalledTimes(2);
  });

  it('AC-V-08: clicking Hear while session is muted does NOT call voiceSpeak', async () => {
    await renderWithReply();
    // Mute first
    fireEvent.click(screen.getByRole('button', { name: /mute voice playback/i }));
    // Then click Hear — should be a no-op
    fireEvent.click(screen.getByRole('button', { name: /hear suggestion aloud/i }));
    expect(mockVoiceSpeak).not.toHaveBeenCalled();
  });

  it('AC-V-08: muting while playing calls voiceSpeakCancel and resets button', async () => {
    await renderWithReply();
    fireEvent.click(screen.getByRole('button', { name: /hear suggestion aloud/i }));
    await waitFor(() => screen.getByRole('button', { name: /stop voice playback/i }));

    fireEvent.click(screen.getByRole('button', { name: /mute voice playback/i }));

    expect(mockVoiceSpeakCancel).toHaveBeenCalledWith('speak-1');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /hear suggestion aloud/i })).toBeInTheDocument(),
    );
  });
});
