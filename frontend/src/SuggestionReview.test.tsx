import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SuggestionReview from './SuggestionReview';

const mockSuggestions = [
  {
    id: 'sug-1',
    source_agent: 'writing-assistant',
    target: 'stories/ch1/scene-1.md',
    confidence: 0.85,
    rationale: 'Pacing is slow in the opening.',
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    status: 'proposed',
  },
  {
    id: 'sug-2',
    source_agent: 'brainstorm',
    target: 'characters/hero.md',
    confidence: 0.70,
    rationale: 'Hero motivation needs clarification.',
    createdAt: new Date(Date.now() - 7_200_000).toISOString(),
    status: 'proposed',
  },
  {
    id: 'sug-3',
    source_agent: 'archive',
    target: 'locations/tower.md',
    confidence: 0.92,
    rationale: 'Tower was destroyed in ch2 but appears in ch5.',
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    status: 'proposed',
  },
];

const mockSuggestionsList = vi.fn();
const mockSuggestionsAccept = vi.fn();
const mockSuggestionsReject = vi.fn();
const mockSuggestionsIgnore = vi.fn();

function setApi(overrides: Record<string, unknown> = {}) {
  (window as unknown as { api: unknown }).api = {
    suggestionsList: mockSuggestionsList,
    suggestionsAccept: mockSuggestionsAccept,
    suggestionsReject: mockSuggestionsReject,
    suggestionsIgnore: mockSuggestionsIgnore,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockSuggestionsList.mockResolvedValue({ suggestions: mockSuggestions });
  mockSuggestionsAccept.mockResolvedValue({ id: 'sug-1', status: 'accepted' });
  mockSuggestionsReject.mockResolvedValue({ id: 'sug-1', status: 'rejected' });
  mockSuggestionsIgnore.mockResolvedValue({ id: 'sug-1', status: 'ignored' });
  setApi();
});

describe('SuggestionReview', () => {
  it('renders rows for each proposed suggestion', async () => {
    render(<SuggestionReview />);
    await waitFor(() => {
      expect(screen.getByText('Pacing is slow in the opening.')).toBeInTheDocument();
      expect(screen.getByText('Hero motivation needs clarification.')).toBeInTheDocument();
      expect(screen.getByText('Tower was destroyed in ch2 but appears in ch5.')).toBeInTheDocument();
    });
  });

  it('renders agent badges for each suggestion', async () => {
    render(<SuggestionReview />);
    await waitFor(() => {
      expect(screen.getAllByText('Writing Assistant').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Brainstorm').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Archive').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders filter chips for all agent types', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));
    expect(screen.getByRole('button', { name: /^All/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Writing Assistant, \d+ pending/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Brainstorm, \d+ pending/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Archive, \d+ pending/ })).toBeInTheDocument();
  });

  it('filter chip for Writing Assistant shows only writing-assistant rows', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    fireEvent.click(screen.getByRole('button', { name: /Writing Assistant, \d+ pending/ }));

    expect(screen.getByText('Pacing is slow in the opening.')).toBeInTheDocument();
    expect(screen.queryByText('Hero motivation needs clarification.')).not.toBeInTheDocument();
    expect(screen.queryByText('Tower was destroyed in ch2 but appears in ch5.')).not.toBeInTheDocument();
  });

  it('filter chip for Brainstorm shows only brainstorm rows', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    fireEvent.click(screen.getByRole('button', { name: /Brainstorm, \d+ pending/ }));

    expect(screen.queryByText('Pacing is slow in the opening.')).not.toBeInTheDocument();
    expect(screen.getByText('Hero motivation needs clarification.')).toBeInTheDocument();
    expect(screen.queryByText('Tower was destroyed in ch2 but appears in ch5.')).not.toBeInTheDocument();
  });

  it('filter chip for Archive shows only archive rows', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    fireEvent.click(screen.getByRole('button', { name: /Archive, \d+ pending/ }));

    expect(screen.queryByText('Pacing is slow in the opening.')).not.toBeInTheDocument();
    expect(screen.queryByText('Hero motivation needs clarification.')).not.toBeInTheDocument();
    expect(screen.getByText('Tower was destroyed in ch2 but appears in ch5.')).toBeInTheDocument();
  });

  it('clicking All restores all rows', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    fireEvent.click(screen.getByRole('button', { name: /Writing Assistant, \d+ pending/ }));
    fireEvent.click(screen.getByRole('button', { name: /^All/ }));

    expect(screen.getByText('Pacing is slow in the opening.')).toBeInTheDocument();
    expect(screen.getByText('Hero motivation needs clarification.')).toBeInTheDocument();
    expect(screen.getByText('Tower was destroyed in ch2 but appears in ch5.')).toBeInTheDocument();
  });

  it('accept button calls IPC and removes row from proposed list', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    const acceptBtns = screen.getAllByRole('button', { name: /accept suggestion/i });
    fireEvent.click(acceptBtns[0]);

    await waitFor(() => {
      expect(mockSuggestionsAccept).toHaveBeenCalledWith('sug-1');
    });
    expect(screen.queryByText('Pacing is slow in the opening.')).not.toBeInTheDocument();
  });

  it('reject button calls IPC and removes row from proposed list', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    const rejectBtns = screen.getAllByRole('button', { name: /reject suggestion/i });
    fireEvent.click(rejectBtns[0]);

    await waitFor(() => {
      expect(mockSuggestionsReject).toHaveBeenCalledWith('sug-1');
    });
    expect(screen.queryByText('Pacing is slow in the opening.')).not.toBeInTheDocument();
  });

  it('ignore button calls IPC and removes row from proposed list', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    const ignoreBtns = screen.getAllByRole('button', { name: /ignore suggestion/i });
    fireEvent.click(ignoreBtns[0]);

    await waitFor(() => {
      expect(mockSuggestionsIgnore).toHaveBeenCalledWith('sug-1');
    });
    expect(screen.queryByText('Pacing is slow in the opening.')).not.toBeInTheDocument();
  });

  it('pressing Enter on a focused row accepts the suggestion', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    const rows = screen.getAllByRole('article');
    fireEvent.keyDown(rows[0], { key: 'Enter' });

    await waitFor(() => {
      expect(mockSuggestionsAccept).toHaveBeenCalledWith('sug-1');
    });
  });

  it('pressing Backspace on a focused row rejects the suggestion', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    const rows = screen.getAllByRole('article');
    fireEvent.keyDown(rows[0], { key: 'Backspace' });

    await waitFor(() => {
      expect(mockSuggestionsReject).toHaveBeenCalledWith('sug-1');
    });
  });

  it('pressing I on a focused row ignores the suggestion', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    const rows = screen.getAllByRole('article');
    fireEvent.keyDown(rows[0], { key: 'i' });

    await waitFor(() => {
      expect(mockSuggestionsIgnore).toHaveBeenCalledWith('sug-1');
    });
  });

  it('shows empty state when all suggestions are actioned', async () => {
    mockSuggestionsList.mockResolvedValue({ suggestions: [] });
    render(<SuggestionReview />);
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('No pending suggestions — all caught up!');
    });
  });

  it('shows empty state for a filtered agent with no pending items', async () => {
    mockSuggestionsList.mockResolvedValue({
      suggestions: [{ ...mockSuggestions[0] }],
    });
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    fireEvent.click(screen.getByRole('button', { name: /Brainstorm/ }));

    expect(screen.getByRole('status')).toHaveTextContent('No pending suggestions from Brainstorm.');
  });

  it('falls back to mock data when suggestionsList is not on the API', async () => {
    setApi({ suggestionsList: undefined });
    render(<SuggestionReview />);

    await waitFor(() => {
      expect(screen.getByRole('note')).toHaveTextContent('Preview mode');
    });
    // Mock suggestions have content — at least one row renders
    expect(screen.getAllByRole('article').length).toBeGreaterThan(0);
  });

  it('calls onOpenVaultPath when target link is clicked', async () => {
    const onOpenVaultPath = vi.fn();
    render(<SuggestionReview onOpenVaultPath={onOpenVaultPath} />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    const targetLinks = screen.getAllByRole('button', { name: /open.*in vault/i });
    fireEvent.click(targetLinks[0]);

    expect(onOpenVaultPath).toHaveBeenCalledWith('stories/ch1/scene-1.md');
  });
});
