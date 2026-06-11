import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import BrainstormPage, { STALL_TIMEOUT_MS, HARD_TIMEOUT_MS, VAULT_ROOT_SENTINEL } from './BrainstormPage';

type TokenHandler = (data: { streamId: string; token: string }) => void;
type EndHandler = (data: { streamId: string }) => void;
type ErrorHandler = (data: { streamId: string; error: string }) => void;

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
    onVaultNotesUpdated: () => () => {},
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
      expect(screen.getByText('Lyra Ashveil')).toBeInTheDocument();
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
  it('renders a mic button for voice input', () => {
    render(<BrainstormPage onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /start recording/i })).toBeInTheDocument();
  });

  it('calls sttStart when the mic button is clicked', () => {
    const mockSttStart = vi.fn();
    (window as unknown as { api: unknown }).api = buildApi({ sttStart: mockSttStart });
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /start recording/i }));
    expect(mockSttStart).toHaveBeenCalled();
  });

  it('shows Stop Recording state when recording is active', () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /start recording/i }));
    expect(screen.getByRole('button', { name: /stop recording/i })).toBeInTheDocument();
  });

  it('calls sttStop when the mic is active and clicked again', () => {
    const mockSttStop = vi.fn();
    (window as unknown as { api: unknown }).api = buildApi({ sttStop: mockSttStop });
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /start recording/i }));
    fireEvent.click(screen.getByRole('button', { name: /stop recording/i }));
    expect(mockSttStop).toHaveBeenCalled();
  });

  it('fills the composer with STT result text', async () => {
    let sttResultCb: ((text: string) => void) | null = null;
    (window as unknown as { api: unknown }).api = buildApi({
      onSttResult: (cb: (text: string) => void) => {
        sttResultCb = cb;
        return () => { sttResultCb = null; };
      },
    });
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /start recording/i }));
    await waitFor(() => expect(sttResultCb).not.toBeNull());
    act(() => { sttResultCb?.('hello world'); });
    await waitFor(() =>
      expect(screen.getByLabelText(/brainstorm prompt/i)).toHaveValue('hello world'),
    );
  });
});

// ─── Archive: continuity issues in Brainstorm sidebar ────────────────────────

function makeInconsistencySuggestion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cont-1',
    source_agent: 'archive',
    confidence: 0.92,
    rationale: 'Elara has blonde hair in the vault but dark hair in this scene.',
    target_kind: 'manuscript',
    target_path: 'scenes/ch1/scene1.md',
    target_anchor: null,
    payload_json: JSON.stringify({
      kind: 'inconsistency',
      entityName: 'Elara',
      anchorText: 'her dark hair',
    }),
    status: 'proposed',
    created_at: new Date().toISOString(),
    applied_at: null,
    applied_run_id: null,
    budget_exceeded: 0,
    ...overrides,
  };
}

describe('BrainstormPage — continuity issues (Archive)', () => {
  it('loads continuity issues from suggestionsList on mount', async () => {
    const mockSuggestionsList = vi.fn().mockResolvedValue({
      suggestions: [makeInconsistencySuggestion()],
    });
    (window as unknown as { api: unknown }).api = buildApi({ suggestionsList: mockSuggestionsList });

    render(<BrainstormPage onClose={() => {}} />);

    await waitFor(() => expect(mockSuggestionsList).toHaveBeenCalledWith(undefined, 'archive'));
  });

  it('renders a continuity issue as a checkbox with its description', async () => {
    const mockSuggestionsList = vi.fn().mockResolvedValue({
      suggestions: [makeInconsistencySuggestion()],
    });
    (window as unknown as { api: unknown }).api = buildApi({ suggestionsList: mockSuggestionsList });

    render(<BrainstormPage onClose={() => {}} />);

    const checkbox = await screen.findByRole('checkbox', { name: /continuity issue: elara has blonde hair/i });
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
  });

  it('renders the issue description text in the sidebar', async () => {
    const mockSuggestionsList = vi.fn().mockResolvedValue({
      suggestions: [makeInconsistencySuggestion()],
    });
    (window as unknown as { api: unknown }).api = buildApi({ suggestionsList: mockSuggestionsList });

    render(<BrainstormPage onClose={() => {}} />);

    await waitFor(() =>
      expect(
        screen.getByText(/Elara has blonde hair in the vault but dark hair in this scene\./i),
      ).toBeInTheDocument(),
    );
  });

  it('shows empty state when no continuity issues exist', async () => {
    const mockSuggestionsList = vi.fn().mockResolvedValue({ suggestions: [] });
    (window as unknown as { api: unknown }).api = buildApi({ suggestionsList: mockSuggestionsList });

    render(<BrainstormPage onClose={() => {}} />);

    await waitFor(() =>
      expect(screen.getByText(/no continuity issues flagged/i)).toBeInTheDocument(),
    );
  });

  it('clicking "Send to Chat" on an expanded issue marks it resolved and calls suggestionsAccept', async () => {
    const mockSuggestionsList = vi.fn().mockResolvedValue({
      suggestions: [makeInconsistencySuggestion()],
    });
    const mockSuggestionsAccept = vi.fn().mockResolvedValue({ id: 'cont-1', status: 'accepted' });
    (window as unknown as { api: unknown }).api = buildApi({
      suggestionsList: mockSuggestionsList,
      suggestionsAccept: mockSuggestionsAccept,
    });

    render(<BrainstormPage onClose={() => {}} />);

    // Click the label button to expand the issue form
    const labelBtn = await screen.findByRole('button', {
      name: /Elara has blonde hair in the vault but dark hair in this scene\./i,
    });
    fireEvent.click(labelBtn);

    // Click "Send to Chat" to resolve and call suggestionsAccept
    const sendBtn = await screen.findByRole('button', { name: /send to chat/i });
    fireEvent.click(sendBtn);

    await waitFor(() => expect(mockSuggestionsAccept).toHaveBeenCalledWith('cont-1'));
  });

  it('renders multiple continuity issues as separate checkboxes', async () => {
    const mockSuggestionsList = vi.fn().mockResolvedValue({
      suggestions: [
        makeInconsistencySuggestion({ id: 'cont-1', rationale: 'Hair colour mismatch.' }),
        makeInconsistencySuggestion({
          id: 'cont-2',
          rationale: 'Eye colour mismatch.',
          payload_json: JSON.stringify({ kind: 'inconsistency', entityName: 'Kira', anchorText: 'brown eyes' }),
        }),
      ],
    });
    (window as unknown as { api: unknown }).api = buildApi({ suggestionsList: mockSuggestionsList });

    render(<BrainstormPage onClose={() => {}} />);

    const checkboxes = await screen.findAllByRole('checkbox', { name: /continuity issue/i });
    expect(checkboxes).toHaveLength(2);
  });

  it('wiki-link suggestions from archive are not shown as continuity issues', async () => {
    const mockSuggestionsList = vi.fn().mockResolvedValue({
      suggestions: [
        {
          id: 'wl-1',
          source_agent: 'archive',
          rationale: 'Entity mention without wiki-link.',
          payload_json: JSON.stringify({ kind: 'wiki-link', link: '[[Elara]]', anchorText: 'Elara' }),
          status: 'proposed',
          created_at: new Date().toISOString(),
        },
      ],
    });
    (window as unknown as { api: unknown }).api = buildApi({ suggestionsList: mockSuggestionsList });

    render(<BrainstormPage onClose={() => {}} />);

    await waitFor(() =>
      expect(screen.getByText(/no continuity issues flagged/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole('checkbox', { name: /continuity issue/i })).not.toBeInTheDocument();
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

describe('BrainstormPage — sort and filter (SKY-1310)', () => {
  const DRAFT_FACTS = [
    { id: 'f1', type: 'character', name: 'Alice', content: 'A hero', savedStatus: 'saved', updatedAt: '2024-01-01T00:00:00.000Z' },
    { id: 'f2', type: 'location', name: 'Forest', content: 'Dark woods', savedStatus: 'unsaved', updatedAt: '2024-01-02T00:00:00.000Z' },
    { id: 'f3', type: 'character', name: 'Bob', content: 'A villain', savedStatus: 'unsaved', updatedAt: '2024-01-03T00:00:00.000Z' },
  ];

  function seedFacts(facts: typeof DRAFT_FACTS) {
    localStorage.setItem(
      'brainstorm:draft',
      JSON.stringify({
        v: 2,
        savedAt: new Date().toISOString(),
        messages: [
          { role: 'user', text: 'q' },
          { role: 'assistant', text: 'a', streaming: false },
        ],
        facts,
      }),
    );
  }

  it('renders sort dropdown with 4 options when facts exist', () => {
    seedFacts(DRAFT_FACTS);
    render(<BrainstormPage onClose={() => {}} />);
    const select = screen.getByTestId('brainstorm-sort-select') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(['newest', 'oldest', 'by-type', 'by-status']);
  });

  it('renders filter chips for all 5 filter options', () => {
    seedFacts(DRAFT_FACTS);
    render(<BrainstormPage onClose={() => {}} />);
    expect(screen.getByTestId('brainstorm-filter-all')).toBeInTheDocument();
    expect(screen.getByTestId('brainstorm-filter-character')).toBeInTheDocument();
    expect(screen.getByTestId('brainstorm-filter-location')).toBeInTheDocument();
    expect(screen.getByTestId('brainstorm-filter-item')).toBeInTheDocument();
    expect(screen.getByTestId('brainstorm-filter-note')).toBeInTheDocument();
  });

  it('"All types" chip is aria-pressed=true by default', () => {
    seedFacts(DRAFT_FACTS);
    render(<BrainstormPage onClose={() => {}} />);
    expect(screen.getByTestId('brainstorm-filter-all')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('brainstorm-filter-character')).toHaveAttribute('aria-pressed', 'false');
  });

  it('default sort is newest — cards in reverse insertion order', () => {
    seedFacts(DRAFT_FACTS);
    const { container } = render(<BrainstormPage onClose={() => {}} />);
    const cards = Array.from(container.querySelectorAll('li[data-testid^="idea-card-"]')).map(
      (c) => c.getAttribute('data-testid'),
    );
    expect(cards).toEqual(['idea-card-f3', 'idea-card-f2', 'idea-card-f1']);
  });

  it('sort oldest shows cards in insertion order', () => {
    seedFacts(DRAFT_FACTS);
    const { container } = render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByTestId('brainstorm-sort-select'), { target: { value: 'oldest' } });
    const cards = Array.from(container.querySelectorAll('li[data-testid^="idea-card-"]')).map(
      (c) => c.getAttribute('data-testid'),
    );
    expect(cards).toEqual(['idea-card-f1', 'idea-card-f2', 'idea-card-f3']);
  });

  it('sort by-type groups characters before location', () => {
    seedFacts(DRAFT_FACTS);
    const { container } = render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByTestId('brainstorm-sort-select'), { target: { value: 'by-type' } });
    const cards = Array.from(container.querySelectorAll('li[data-testid^="idea-card-"]')).map(
      (c) => c.getAttribute('data-testid'),
    );
    const locationIdx = cards.indexOf('idea-card-f2');
    expect(cards.indexOf('idea-card-f1')).toBeLessThan(locationIdx);
    expect(cards.indexOf('idea-card-f3')).toBeLessThan(locationIdx);
  });

  it('sort by-status shows saved fact first', () => {
    seedFacts(DRAFT_FACTS);
    const { container } = render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByTestId('brainstorm-sort-select'), { target: { value: 'by-status' } });
    const cards = Array.from(container.querySelectorAll('li[data-testid^="idea-card-"]')).map(
      (c) => c.getAttribute('data-testid'),
    );
    expect(cards[0]).toBe('idea-card-f1');
  });

  it('filter by character shows only character cards', () => {
    seedFacts(DRAFT_FACTS);
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('brainstorm-filter-character'));
    expect(screen.getByTestId('idea-card-f1')).toBeInTheDocument();
    expect(screen.getByTestId('idea-card-f3')).toBeInTheDocument();
    expect(screen.queryByTestId('idea-card-f2')).not.toBeInTheDocument();
  });

  it('filter to empty type shows type-specific empty state', () => {
    seedFacts(DRAFT_FACTS);
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('brainstorm-filter-item'));
    expect(screen.getByText('No item ideas yet')).toBeInTheDocument();
    expect(screen.queryByTestId('idea-card-f1')).not.toBeInTheDocument();
  });

  it('filter + sort are combined: characters oldest-first', () => {
    seedFacts(DRAFT_FACTS);
    const { container } = render(<BrainstormPage onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('brainstorm-filter-character'));
    fireEvent.change(screen.getByTestId('brainstorm-sort-select'), { target: { value: 'oldest' } });
    const cards = Array.from(container.querySelectorAll('li[data-testid^="idea-card-"]')).map(
      (c) => c.getAttribute('data-testid'),
    );
    expect(cards).toEqual(['idea-card-f1', 'idea-card-f3']);
    expect(screen.queryByTestId('idea-card-f2')).not.toBeInTheDocument();
  });

  it('expand all only expands visible (filtered) cards', () => {
    seedFacts(DRAFT_FACTS);
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('brainstorm-filter-character'));
    fireEvent.click(screen.getByTestId('bs-expand-all-btn'));
    expect(screen.getByTestId('idea-card-toggle-f1')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('idea-card-toggle-f3')).toHaveAttribute('aria-expanded', 'true');
    // Switch back to all — location card should be collapsed (was not in filtered set)
    fireEvent.click(screen.getByTestId('brainstorm-filter-all'));
    expect(screen.getByTestId('idea-card-toggle-f2')).toHaveAttribute('aria-expanded', 'false');
  });

  it('unified Expand all / Collapse all button toggles label', () => {
    seedFacts(DRAFT_FACTS);
    render(<BrainstormPage onClose={() => {}} />);
    const btn = screen.getByTestId('bs-expand-all-btn');
    expect(btn).toHaveTextContent('Expand all');
    fireEvent.click(btn);
    expect(btn).toHaveTextContent('Collapse all');
    fireEvent.click(btn);
    expect(btn).toHaveTextContent('Expand all');
  });
});
