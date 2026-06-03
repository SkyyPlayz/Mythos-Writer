import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PromptHistoryPanel from './PromptHistoryPanel';

const mockGenerationLogRecent = vi.fn();
const mockOnClose = vi.fn();

function makeEntry(overrides: Partial<GenerationLogRow> = {}): GenerationLogRow {
  return {
    id: 'e1',
    agent: 'writing-assistant',
    model: 'claude-sonnet-4-6',
    endpoint: 'messages.stream',
    request_id: 'req-1',
    tokens_in: 100,
    tokens_out: 200,
    latency_ms: 512,
    error: null,
    created_at: '2026-05-23T10:00:00.000Z',
    payload_digest: 'abc123',
    prompt_text: 'Improve this scene.',
    response_text: 'Try adding more tension.',
    entity_count: null,
    context_chars: null,
    truncated: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  (window as unknown as { api: unknown }).api = {
    generationLogRecent: mockGenerationLogRecent,
  };
});

describe('PromptHistoryPanel', () => {
  it('renders all four agent tabs', async () => {
    mockGenerationLogRecent.mockResolvedValue({ entries: [], total: 0 });
    render(<PromptHistoryPanel onClose={mockOnClose} />);
    // Wait for the initial data fetch to settle so its state updates are inside act()
    await waitFor(() => expect(mockGenerationLogRecent).toHaveBeenCalled());
    expect(screen.getByRole('tab', { name: /^All$/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /writing assistant/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /brainstorm/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /archive/i })).toBeInTheDocument();
  });

  it('renders search input and date range filters', async () => {
    mockGenerationLogRecent.mockResolvedValue({ entries: [], total: 0 });
    render(<PromptHistoryPanel onClose={mockOnClose} />);
    // Wait for the initial data fetch to settle so its state updates are inside act()
    await waitFor(() => expect(mockGenerationLogRecent).toHaveBeenCalled());
    expect(screen.getByRole('searchbox', { name: /search prompt history/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/filter from date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/filter to date/i)).toBeInTheDocument();
  });

  it('shows loading state while fetching', () => {
    mockGenerationLogRecent.mockReturnValue(new Promise(() => {}));
    render(<PromptHistoryPanel onClose={mockOnClose} />);
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
  });

  it('renders entries in the list', async () => {
    mockGenerationLogRecent.mockResolvedValue({
      entries: [
        makeEntry({ id: 'e1', prompt_text: 'Write a scene.' }),
        makeEntry({ id: 'e2', agent: 'brainstorm', prompt_text: 'Brainstorm ideas.' }),
      ],
      total: 2,
    });
    render(<PromptHistoryPanel onClose={mockOnClose} />);
    await waitFor(() => {
      expect(screen.getByText(/Write a scene/i)).toBeInTheDocument();
      expect(screen.getByText(/Brainstorm ideas/i)).toBeInTheDocument();
    });
  });

  it('shows empty state when no entries', async () => {
    mockGenerationLogRecent.mockResolvedValue({ entries: [], total: 0 });
    render(<PromptHistoryPanel onClose={mockOnClose} />);
    await waitFor(() => {
      expect(screen.getByText(/no prompt history found/i)).toBeInTheDocument();
    });
  });

  it('shows error message on IPC failure', async () => {
    mockGenerationLogRecent.mockRejectedValue(new Error('DB error'));
    render(<PromptHistoryPanel onClose={mockOnClose} />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Error: DB error');
    });
  });

  it('calls onClose when close button is clicked', async () => {
    mockGenerationLogRecent.mockResolvedValue({ entries: [], total: 0 });
    render(<PromptHistoryPanel onClose={mockOnClose} />);
    // Wait for initial data fetch so its state updates are inside act()
    await waitFor(() => expect(mockGenerationLogRecent).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /close prompt history/i }));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('filters by agent when a tab is clicked', async () => {
    mockGenerationLogRecent.mockResolvedValue({ entries: [], total: 0 });
    render(<PromptHistoryPanel onClose={mockOnClose} />);
    await waitFor(() => expect(mockGenerationLogRecent).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('tab', { name: /brainstorm/i }));
    await waitFor(() => expect(mockGenerationLogRecent).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'brainstorm' })
    ));
  });

  it('All tab sends no agent field', async () => {
    mockGenerationLogRecent.mockResolvedValue({ entries: [], total: 0 });
    render(<PromptHistoryPanel onClose={mockOnClose} />);
    await waitFor(() => expect(mockGenerationLogRecent).toHaveBeenCalledTimes(1));
    const firstCall = mockGenerationLogRecent.mock.calls[0][0];
    expect(firstCall.agent).toBeUndefined();
  });

  it('expands row to show full prompt and response on click', async () => {
    const entry = makeEntry({ prompt_text: 'Full prompt text here.', response_text: 'Full response here.' });
    mockGenerationLogRecent.mockResolvedValue({ entries: [entry], total: 1 });
    render(<PromptHistoryPanel onClose={mockOnClose} />);

    await waitFor(() => screen.getByRole('button', { name: /writing assistant entry/i }));

    const rowBtn = screen.getByRole('button', { name: /writing assistant entry/i });
    expect(rowBtn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(rowBtn);

    await waitFor(() => {
      expect(screen.getByLabelText('Full prompt text')).toHaveTextContent('Full prompt text here.');
      expect(screen.getByLabelText('Full response text')).toHaveTextContent('Full response here.');
    });
    expect(rowBtn).toHaveAttribute('aria-expanded', 'true');
  });

  it('collapses expanded row when clicked again', async () => {
    const entry = makeEntry({ prompt_text: 'Some prompt.', response_text: 'Some response.' });
    mockGenerationLogRecent.mockResolvedValue({ entries: [entry], total: 1 });
    render(<PromptHistoryPanel onClose={mockOnClose} />);

    await waitFor(() => screen.getByRole('button', { name: /writing assistant entry/i }));
    const rowBtn = screen.getByRole('button', { name: /writing assistant entry/i });

    fireEvent.click(rowBtn);
    await waitFor(() => screen.getByLabelText('Entry detail'));

    fireEvent.click(rowBtn);
    await waitFor(() => {
      expect(screen.queryByLabelText('Entry detail')).not.toBeInTheDocument();
    });
  });

  it('shows pagination controls when total > PAGE_SIZE', async () => {
    mockGenerationLogRecent.mockResolvedValue({
      entries: Array.from({ length: 20 }, (_, i) => makeEntry({ id: `e${i}`, prompt_text: `Prompt ${i}` })),
      total: 45,
    });
    render(<PromptHistoryPanel onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Pagination')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /previous page/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next page/i })).not.toBeDisabled();
    expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument();
  });

  it('hides pagination when total <= PAGE_SIZE', async () => {
    mockGenerationLogRecent.mockResolvedValue({
      entries: [makeEntry()],
      total: 1,
    });
    render(<PromptHistoryPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByText(/Improve this scene/i));
    expect(screen.queryByLabelText('Pagination')).not.toBeInTheDocument();
  });

  it('advances to next page when Next is clicked', async () => {
    mockGenerationLogRecent.mockResolvedValue({
      entries: Array.from({ length: 20 }, (_, i) => makeEntry({ id: `e${i}` })),
      total: 25,
    });
    render(<PromptHistoryPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('button', { name: /next page/i }));
    fireEvent.click(screen.getByRole('button', { name: /next page/i }));

    await waitFor(() => expect(mockGenerationLogRecent).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 20 })
    ));
  });

  it('shows clear dates button when a date is set and clears on click', async () => {
    mockGenerationLogRecent.mockResolvedValue({ entries: [], total: 0 });
    render(<PromptHistoryPanel onClose={mockOnClose} />);
    const fromInput = screen.getByLabelText(/filter from date/i);
    fireEvent.change(fromInput, { target: { value: '2026-05-01' } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /clear date range/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /clear date range/i }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /clear date range/i })).not.toBeInTheDocument();
    });
    expect((fromInput as HTMLInputElement).value).toBe('');
  });

  it('sends dateFrom and dateTo with midnight/end-of-day time to IPC', async () => {
    mockGenerationLogRecent.mockResolvedValue({ entries: [], total: 0 });
    render(<PromptHistoryPanel onClose={mockOnClose} />);

    fireEvent.change(screen.getByLabelText(/filter from date/i), { target: { value: '2026-05-01' } });
    fireEvent.change(screen.getByLabelText(/filter to date/i), { target: { value: '2026-05-31' } });

    await waitFor(() => expect(mockGenerationLogRecent).toHaveBeenCalledWith(
      expect.objectContaining({
        dateFrom: '2026-05-01T00:00:00.000Z',
        dateTo: '2026-05-31T23:59:59.999Z',
      })
    ));
  });

  it('shows error badge on entries with error field', async () => {
    mockGenerationLogRecent.mockResolvedValue({
      entries: [makeEntry({ error: 'Rate limit exceeded' })],
      total: 1,
    });
    render(<PromptHistoryPanel onClose={mockOnClose} />);
    await waitFor(() => {
      expect(screen.getByText('Error')).toBeInTheDocument();
    });
  });

  it('shows error detail in expanded view', async () => {
    mockGenerationLogRecent.mockResolvedValue({
      entries: [makeEntry({ error: 'API key invalid' })],
      total: 1,
    });
    render(<PromptHistoryPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('button', { name: /writing assistant entry/i }));
    fireEvent.click(screen.getByRole('button', { name: /writing assistant entry/i }));

    await waitFor(() => {
      expect(screen.getByText(/Error: API key invalid/i)).toBeInTheDocument();
    });
  });
});
