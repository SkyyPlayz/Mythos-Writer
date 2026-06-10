import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import EntriesQuickAdd, { buildNoteContent, ENTRIES_SYSTEM_PROMPT, ENTRIES_MAX_TOKENS } from './EntriesQuickAdd';

type TokenHandler = (data: { streamId: string; token: string }) => void;
type EndHandler = (data: { streamId: string }) => void;
type ErrorHandler = (data: { streamId: string; error: string }) => void;

let tokenCb: TokenHandler | null = null;
let endCb: EndHandler | null = null;
let errorCb: ErrorHandler | null = null;

const mockStreamStart = vi.fn();
const mockStreamAck = vi.fn();
const mockMkdirNotesVault = vi.fn();
const mockWriteNotesVault = vi.fn();
const mockDeleteNotesVault = vi.fn();

function buildApi(overrides: Record<string, unknown> = {}) {
  return {
    streamStart: mockStreamStart,
    streamAck: mockStreamAck,
    mkdirNotesVault: mockMkdirNotesVault,
    writeNotesVault: mockWriteNotesVault,
    deleteNotesVault: mockDeleteNotesVault,
    onStreamToken: (cb: TokenHandler) => {
      tokenCb = cb;
      return () => { tokenCb = null; };
    },
    onStreamEnd: (cb: EndHandler) => {
      endCb = cb;
      return () => { endCb = null; };
    },
    onStreamError: (cb: ErrorHandler) => {
      errorCb = cb;
      return () => { errorCb = null; };
    },
    ...overrides,
  };
}

async function simulateStream(tokens: string[], errorMessage?: string) {
  await waitFor(() => expect(tokenCb).not.toBeNull());
  await act(async () => {
    for (const t of tokens) {
      tokenCb?.({ streamId: 'test-sid', token: t });
    }
    if (errorMessage) {
      errorCb?.({ streamId: 'test-sid', error: errorMessage });
    } else {
      endCb?.({ streamId: 'test-sid' });
    }
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  tokenCb = null;
  endCb = null;
  errorCb = null;
  mockStreamStart.mockResolvedValue({ streamId: 'test-sid' });
  mockMkdirNotesVault.mockResolvedValue({ path: 'Entries', created: false });
  mockWriteNotesVault.mockResolvedValue({ path: 'Entries/test.md', bytes: 100 });
  mockDeleteNotesVault.mockResolvedValue({ path: 'Entries/test.md', deleted: true });
  Object.defineProperty(window, 'api', { value: buildApi(), writable: true, configurable: true });
});

// ── Unit: buildNoteContent ────────────────────────────────────────────────────

describe('buildNoteContent', () => {
  it('produces frontmatter + body', () => {
    const content = buildNoteContent('2024-01-01T00:00:00.000Z', 'Expanded content here.');
    expect(content).toContain('entry: true');
    expect(content).toContain('source: quick-add');
    expect(content).toContain('createdAt: 2024-01-01T00:00:00.000Z');
    expect(content).toContain('Expanded content here.');
  });

  it('trims body whitespace', () => {
    const content = buildNoteContent('2024-01-01T00:00:00.000Z', '  body with spaces  ');
    expect(content).toContain('body with spaces');
    expect(content).not.toMatch(/\n {2,}/);
  });
});

// ── Component ─────────────────────────────────────────────────────────────────

describe('EntriesQuickAdd', () => {
  it('renders textarea and disabled save button when empty', () => {
    render(<EntriesQuickAdd />);
    const textarea = screen.getByTestId('entries-qa-textarea');
    const btn = screen.getByTestId('entries-qa-save-btn');
    expect(textarea).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });

  it('enables save button once text is entered', () => {
    render(<EntriesQuickAdd />);
    fireEvent.change(screen.getByTestId('entries-qa-textarea'), {
      target: { value: 'A great idea' },
    });
    expect(screen.getByTestId('entries-qa-save-btn')).not.toBeDisabled();
  });

  it('calls streamStart with correct system prompt and maxTokens', async () => {
    render(<EntriesQuickAdd />);
    fireEvent.change(screen.getByTestId('entries-qa-textarea'), {
      target: { value: 'My quick entry' },
    });
    fireEvent.click(screen.getByTestId('entries-qa-save-btn'));
    await waitFor(() => expect(mockStreamStart).toHaveBeenCalledTimes(1));
    const payload = mockStreamStart.mock.calls[0][0];
    expect(payload.system).toBe(ENTRIES_SYSTEM_PROMPT);
    expect(payload.maxTokens).toBe(ENTRIES_MAX_TOKENS);
    expect(payload.messages[0].content).toBe('My quick entry');
  });

  it('saves note to Notes Vault under Entries/ after stream completes', async () => {
    render(<EntriesQuickAdd />);
    fireEvent.change(screen.getByTestId('entries-qa-textarea'), {
      target: { value: 'Dragon ally' },
    });
    fireEvent.click(screen.getByTestId('entries-qa-save-btn'));
    await simulateStream(['A dragon who', ' secretly helps', ' the protagonist.']);
    await waitFor(() => expect(mockWriteNotesVault).toHaveBeenCalledTimes(1));
    const [writtenPath, writtenContent] = mockWriteNotesVault.mock.calls[0];
    expect(writtenPath).toMatch(/^Entries\//);
    expect(writtenPath).toMatch(/\.md$/);
    expect(writtenContent).toContain('entry: true');
    expect(writtenContent).toContain('A dragon who secretly helps the protagonist.');
  });

  it('clears textarea after successful save', async () => {
    render(<EntriesQuickAdd />);
    fireEvent.change(screen.getByTestId('entries-qa-textarea'), {
      target: { value: 'Clear after save' },
    });
    fireEvent.click(screen.getByTestId('entries-qa-save-btn'));
    await simulateStream(['expanded content']);
    await waitFor(() => expect(mockWriteNotesVault).toHaveBeenCalled());
    expect(screen.getByTestId('entries-qa-textarea')).toHaveValue('');
  });

  it('shows undo toast after successful save', async () => {
    render(<EntriesQuickAdd />);
    fireEvent.change(screen.getByTestId('entries-qa-textarea'), { target: { value: 'Test entry' } });
    fireEvent.click(screen.getByTestId('entries-qa-save-btn'));
    await simulateStream(['expanded']);
    await waitFor(() => expect(mockWriteNotesVault).toHaveBeenCalled());
    expect(screen.getByTestId('entries-qa-toast')).toBeInTheDocument();
    expect(screen.getByTestId('entries-qa-undo-btn')).toBeInTheDocument();
  });

  it('calls onEntrySaved callback with the vault path', async () => {
    const onEntrySaved = vi.fn();
    render(<EntriesQuickAdd onEntrySaved={onEntrySaved} />);
    fireEvent.change(screen.getByTestId('entries-qa-textarea'), { target: { value: 'Callback test' } });
    fireEvent.click(screen.getByTestId('entries-qa-save-btn'));
    await simulateStream(['body text']);
    await waitFor(() => expect(onEntrySaved).toHaveBeenCalledTimes(1));
    expect(onEntrySaved.mock.calls[0][0]).toMatch(/^Entries\//);
  });

  it('calls deleteNotesVault when undo is clicked', async () => {
    render(<EntriesQuickAdd />);
    fireEvent.change(screen.getByTestId('entries-qa-textarea'), { target: { value: 'Undo me' } });
    fireEvent.click(screen.getByTestId('entries-qa-save-btn'));
    await simulateStream(['body']);
    await waitFor(() => expect(screen.getByTestId('entries-qa-undo-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('entries-qa-undo-btn'));
    await waitFor(() => expect(mockDeleteNotesVault).toHaveBeenCalledTimes(1));
    expect(mockDeleteNotesVault.mock.calls[0][0]).toMatch(/^Entries\//);
  });

  it('shows error message on stream failure', async () => {
    render(<EntriesQuickAdd />);
    fireEvent.change(screen.getByTestId('entries-qa-textarea'), { target: { value: 'Will fail' } });
    fireEvent.click(screen.getByTestId('entries-qa-save-btn'));
    await simulateStream([], 'Network error');
    await waitFor(() => expect(screen.getByTestId('entries-qa-error')).toBeInTheDocument());
    expect(screen.getByTestId('entries-qa-error').textContent).toContain('Network error');
  });

  it('shows error message when streamStart rejects', async () => {
    mockStreamStart.mockRejectedValue(new Error('API unavailable'));
    render(<EntriesQuickAdd />);
    fireEvent.change(screen.getByTestId('entries-qa-textarea'), { target: { value: 'fail here' } });
    fireEvent.click(screen.getByTestId('entries-qa-save-btn'));
    await waitFor(() => expect(screen.getByTestId('entries-qa-error')).toBeInTheDocument());
    expect(screen.getByTestId('entries-qa-error').textContent).toContain('API unavailable');
  });

  it('submits on Enter key (not Shift+Enter)', async () => {
    render(<EntriesQuickAdd />);
    const textarea = screen.getByTestId('entries-qa-textarea');
    fireEvent.change(textarea, { target: { value: 'Enter key' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    await waitFor(() => expect(mockStreamStart).toHaveBeenCalledTimes(1));
  });

  it('does NOT submit on Shift+Enter', () => {
    render(<EntriesQuickAdd />);
    const textarea = screen.getByTestId('entries-qa-textarea');
    fireEvent.change(textarea, { target: { value: 'No submit' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(mockStreamStart).not.toHaveBeenCalled();
  });
});
