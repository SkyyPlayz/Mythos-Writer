import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import SuggestionReview from './SuggestionReview';
import type { UnifiedSuggestion } from './SuggestionDetailPane';

// --- Unified mock data ---

const makeSuggestion = (overrides: Partial<UnifiedSuggestion>): UnifiedSuggestion => ({
  id: 'sug-default',
  kind: 'suggestion',
  sourceAgent: 'writing-assistant',
  targetPath: 'stories/ch1/scene-1.md',
  targetAnchor: null,
  confidence: 0.85,
  rationale: 'Default rationale.',
  createdAt: new Date(Date.now() - 3_600_000).toISOString(),
  status: 'proposed',
  appliedAt: null,
  budgetExceeded: false,
  category: null,
  payloadJson: null,
  ...overrides,
});

const mockUnifiedSuggestions: UnifiedSuggestion[] = [
  makeSuggestion({
    id: 'sug-1',
    sourceAgent: 'writing-assistant',
    targetPath: 'stories/ch1/scene-1.md',
    confidence: 0.85,
    rationale: 'Pacing is slow in the opening.',
    status: 'proposed',
  }),
  makeSuggestion({
    id: 'sug-2',
    sourceAgent: 'brainstorm',
    targetPath: 'characters/hero.md',
    confidence: 0.7,
    rationale: 'Hero motivation needs clarification.',
    status: 'proposed',
  }),
  makeSuggestion({
    id: 'sug-3',
    kind: 'continuity-issue',
    sourceAgent: 'archive',
    targetPath: 'locations/tower.md',
    confidence: 0.92,
    rationale: 'Tower was destroyed in ch2 but appears in ch5.',
    status: 'proposed',
    category: 'high',
  }),
  makeSuggestion({
    id: 'sug-4',
    sourceAgent: 'writing-assistant',
    targetPath: 'stories/ch2/scene-1.md',
    confidence: 0.8,
    rationale: 'Chapter 2 buries the inciting event.',
    status: 'accepted',
  }),
  makeSuggestion({
    id: 'sug-5',
    sourceAgent: 'archive',
    targetPath: 'characters/herald.md',
    confidence: 0.65,
    rationale: 'Herald never introduced before ch4 reference.',
    status: 'rejected',
  }),
];

const mockUnifiedResponse = {
  items: mockUnifiedSuggestions,
  totalCount: mockUnifiedSuggestions.length,
  countByAgent: { 'writing-assistant': 1, brainstorm: 1, archive: 1 },
  countByKind: { suggestion: 3, 'continuity-issue': 1 },
};

// --- Mock API ---

const mockSuggestionsUnifiedList = vi.fn();
const mockSuggestionsAccept = vi.fn();
const mockSuggestionsReject = vi.fn();
const mockSuggestionsIgnore = vi.fn();
const mockSuggestionsRollback = vi.fn();
const mockAuditList = vi.fn();

function setApi(overrides: Record<string, unknown> = {}) {
  (window as unknown as { api: unknown }).api = {
    suggestionsUnifiedList: mockSuggestionsUnifiedList,
    suggestionsAccept: mockSuggestionsAccept,
    suggestionsReject: mockSuggestionsReject,
    suggestionsIgnore: mockSuggestionsIgnore,
    suggestionsRollback: mockSuggestionsRollback,
    auditList: mockAuditList,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockSuggestionsUnifiedList.mockResolvedValue(mockUnifiedResponse);
  mockSuggestionsAccept.mockResolvedValue({ id: 'sug-1', status: 'accepted' });
  mockSuggestionsReject.mockResolvedValue({ id: 'sug-1', status: 'rejected' });
  mockSuggestionsIgnore.mockResolvedValue({ id: 'sug-1', status: 'ignored' });
  mockSuggestionsRollback.mockResolvedValue({});
  mockAuditList.mockResolvedValue([]);
  setApi();
});

describe('SuggestionReview — Inbox tab', () => {
  it('renders rows for each proposed suggestion', async () => {
    render(<SuggestionReview />);
    await waitFor(() => {
      expect(screen.getByText('Pacing is slow in the opening.')).toBeInTheDocument();
      expect(screen.getByText('Hero motivation needs clarification.')).toBeInTheDocument();
      expect(screen.getByText('Tower was destroyed in ch2 but appears in ch5.')).toBeInTheDocument();
    });
    // Accepted items should not appear in the inbox tab
    expect(screen.queryByText('Chapter 2 buries the inciting event.')).not.toBeInTheDocument();
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
    expect(
      screen.getByRole('button', { name: /Writing Assistant, \d+ pending/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Brainstorm, \d+ pending/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Archive, \d+ pending/ })).toBeInTheDocument();
  });

  it('filter chip for Writing Assistant shows only writing-assistant rows', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    fireEvent.click(screen.getByRole('button', { name: /Writing Assistant, \d+ pending/ }));

    expect(screen.getByText('Pacing is slow in the opening.')).toBeInTheDocument();
    expect(screen.queryByText('Hero motivation needs clarification.')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Tower was destroyed in ch2 but appears in ch5.'),
    ).not.toBeInTheDocument();
  });

  it('filter chip for Brainstorm shows only brainstorm rows', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    fireEvent.click(screen.getByRole('button', { name: /Brainstorm, \d+ pending/ }));

    expect(screen.queryByText('Pacing is slow in the opening.')).not.toBeInTheDocument();
    expect(screen.getByText('Hero motivation needs clarification.')).toBeInTheDocument();
    expect(
      screen.queryByText('Tower was destroyed in ch2 but appears in ch5.'),
    ).not.toBeInTheDocument();
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

  it('accept button calls IPC and removes row from inbox', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    const acceptBtns = screen.getAllByRole('button', { name: /accept suggestion/i });
    fireEvent.click(acceptBtns[0]);

    await waitFor(() => {
      expect(mockSuggestionsAccept).toHaveBeenCalledWith('sug-1');
    });
    expect(screen.queryByText('Pacing is slow in the opening.')).not.toBeInTheDocument();
  });

  it('reject button calls IPC and removes row from inbox', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    const rejectBtns = screen.getAllByRole('button', { name: /reject suggestion/i });
    fireEvent.click(rejectBtns[0]);

    await waitFor(() => {
      expect(mockSuggestionsReject).toHaveBeenCalledWith('sug-1');
    });
    expect(screen.queryByText('Pacing is slow in the opening.')).not.toBeInTheDocument();
  });

  it('ignore button calls IPC and removes row from inbox', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    const ignoreBtns = screen.getAllByRole('button', { name: /ignore suggestion/i });
    fireEvent.click(ignoreBtns[0]);

    await waitFor(() => {
      expect(mockSuggestionsIgnore).toHaveBeenCalledWith('sug-1');
    });
    expect(screen.queryByText('Pacing is slow in the opening.')).not.toBeInTheDocument();
  });

  it('pressing Enter on a focused row opens the detail pane (AC-S4-1)', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    const rows = screen.getAllByRole('article');
    fireEvent.keyDown(rows[0], { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByRole('complementary', { name: /suggestion detail/i })).toBeInTheDocument();
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
    mockSuggestionsUnifiedList.mockResolvedValue({ items: [], totalCount: 0, countByAgent: {}, countByKind: {} });
    render(<SuggestionReview />);
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'No pending suggestions — all caught up!',
      );
    });
  });

  it('shows empty state for a filtered agent with no pending items', async () => {
    mockSuggestionsUnifiedList.mockResolvedValue({
      items: [mockUnifiedSuggestions[0]],
      totalCount: 1,
      countByAgent: { 'writing-assistant': 1 },
      countByKind: { suggestion: 1 },
    });
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    fireEvent.click(screen.getByRole('button', { name: /Brainstorm/ }));

    expect(screen.getByRole('status')).toHaveTextContent(
      'No pending suggestions from Brainstorm.',
    );
  });

  it('falls back to mock data when suggestionsUnifiedList is not on the API', async () => {
    setApi({ suggestionsUnifiedList: undefined });
    render(<SuggestionReview />);

    await waitFor(() => {
      expect(screen.getByRole('note')).toHaveTextContent('Preview mode');
    });
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

describe('SuggestionReview — Audit Trail tab', () => {
  it('shows accepted suggestion in audit trail after accepting from inbox', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    const acceptBtns = screen.getAllByRole('button', { name: /accept suggestion/i });
    fireEvent.click(acceptBtns[0]);

    fireEvent.click(screen.getByRole('tab', { name: /audit trail/i }));

    await waitFor(() => {
      expect(screen.getByText('Pacing is slow in the opening.')).toBeInTheDocument();
    });
  });

  it('shows pre-existing accepted/rejected suggestions in audit trail on load', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    fireEvent.click(screen.getByRole('tab', { name: /audit trail/i }));

    expect(screen.getByText('Chapter 2 buries the inciting event.')).toBeInTheDocument();
    expect(screen.getByText('Herald never introduced before ch4 reference.')).toBeInTheDocument();
  });

  it('rollback button calls IPC and moves suggestion back to inbox', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    fireEvent.click(screen.getByRole('tab', { name: /audit trail/i }));

    const rollbackBtn = await screen.findByRole('button', {
      name: /rollback accepted suggestion/i,
    });
    fireEvent.click(rollbackBtn);

    await waitFor(() => {
      expect(mockSuggestionsRollback).toHaveBeenCalledWith('sug-4');
    });

    fireEvent.click(screen.getByRole('tab', { name: /inbox/i }));
    expect(screen.getByText('Chapter 2 buries the inciting event.')).toBeInTheDocument();
  });

  it('per-status filter shows only accepted entries', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    fireEvent.click(screen.getByRole('tab', { name: /audit trail/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Accepted$/ }));

    expect(screen.getByText('Chapter 2 buries the inciting event.')).toBeInTheDocument();
    expect(
      screen.queryByText('Herald never introduced before ch4 reference.'),
    ).not.toBeInTheDocument();
  });

  it('per-status filter shows only rejected entries', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    fireEvent.click(screen.getByRole('tab', { name: /audit trail/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Rejected$/ }));

    expect(screen.queryByText('Chapter 2 buries the inciting event.')).not.toBeInTheDocument();
    expect(screen.getByText('Herald never introduced before ch4 reference.')).toBeInTheDocument();
  });

  it('shows empty state in audit trail when no reviewed suggestions exist', async () => {
    mockSuggestionsUnifiedList.mockResolvedValue({
      items: [mockUnifiedSuggestions[0], mockUnifiedSuggestions[1], mockUnifiedSuggestions[2]],
      totalCount: 3,
      countByAgent: {},
      countByKind: {},
    });
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    fireEvent.click(screen.getByRole('tab', { name: /audit trail/i }));

    expect(screen.getByRole('status')).toHaveTextContent('No reviewed suggestions yet.');
  });

  it('shows status badge on audit trail entries', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    fireEvent.click(screen.getByRole('tab', { name: /audit trail/i }));

    await waitFor(() => {
      expect(screen.getByText('accepted')).toBeInTheDocument();
      expect(screen.getByText('rejected')).toBeInTheDocument();
    });
  });
});

describe('SuggestionReview — per-vault filter', () => {
  it('renders vault select when multiple vaults are provided', async () => {
    render(
      <SuggestionReview availableVaults={['/vault/project-a', '/vault/project-b']} />,
    );
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    expect(screen.getByRole('combobox', { name: /filter by vault/i })).toBeInTheDocument();
  });

  it('does not render vault select when only one vault is provided', async () => {
    render(<SuggestionReview availableVaults={['/vault/project-a']} />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    expect(screen.queryByRole('combobox', { name: /filter by vault/i })).not.toBeInTheDocument();
  });

  it('does not render vault select when availableVaults is omitted', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    expect(screen.queryByRole('combobox', { name: /filter by vault/i })).not.toBeInTheDocument();
  });
});

describe('SuggestionReview — tab navigation', () => {
  it('renders both Inbox and Audit Trail tabs', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    expect(screen.getByRole('tab', { name: /inbox/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /audit trail/i })).toBeInTheDocument();
  });

  it('Inbox tab is selected by default', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    expect(screen.getByRole('tab', { name: /inbox/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /audit trail/i })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('switching to Audit Trail tab hides inbox content', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    fireEvent.click(screen.getByRole('tab', { name: /audit trail/i }));

    expect(screen.queryByRole('button', { name: /accept suggestion/i })).not.toBeInTheDocument();
  });
});

// --- SLICE-4 Acceptance Criteria ---

describe('SuggestionReview — SLICE-4: detail pane (AC-S4)', () => {
  it('AC-S4-1: clicking row background opens detail pane with correct rationale', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    const rows = screen.getAllByRole('article');
    // Click the row itself (not a button inside)
    fireEvent.click(rows[0]);

    await waitFor(() => {
      expect(screen.getByRole('complementary', { name: /suggestion detail/i })).toBeInTheDocument();
      expect(screen.getAllByText('Pacing is slow in the opening.').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('AC-S4-2: pressing Escape closes the detail pane', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    const rows = screen.getAllByRole('article');
    fireEvent.click(rows[0]);

    await waitFor(() =>
      screen.getByRole('complementary', { name: /suggestion detail/i }),
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(
        screen.queryByRole('complementary', { name: /suggestion detail/i }),
      ).not.toBeInTheDocument();
    });
  });

  it('AC-S4-3: detail pane shows audit trail rows', async () => {
    const auditRow = {
      id: 'audit-1',
      action: 'accept',
      actor: 'user',
      created_at: new Date(Date.now() - 60_000).toISOString(),
    };
    mockAuditList.mockResolvedValue([auditRow]);

    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    const rows = screen.getAllByRole('article');
    fireEvent.click(rows[0]);

    await waitFor(() => {
      expect(screen.getByRole('complementary', { name: /suggestion detail/i })).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByRole('list', { name: /audit trail/i })).toBeInTheDocument();
      expect(screen.getByText('accept')).toBeInTheDocument();
    });
  });

  it('AC-S4-4: continuity issue rows show severity badge (not confidence bar)', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Tower was destroyed in ch2 but appears in ch5.'));

    // sug-3 is kind=continuity-issue with category='high'
    const severityBadge = screen.getByRole('generic', { name: /severity: high/i });
    expect(severityBadge).toBeInTheDocument();

    // The continuity row should NOT have a confidence bar (progressbar role)
    // The other rows do have confidence bars, but within the continuity row there shouldn't be one
    // We can verify by checking the row doesn't contain a progressbar
    const rows = screen.getAllByRole('article');
    const continuityRow = rows.find((r) =>
      r.textContent?.includes('Tower was destroyed'),
    );
    expect(continuityRow).toBeDefined();
    expect(continuityRow!.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('AC-S4-5: wiki-link rows show proposed_link text', async () => {
    const wikiSuggestion = makeSuggestion({
      id: 'sug-wiki',
      kind: 'wiki-link',
      sourceAgent: 'archive',
      rationale: 'Add wiki link to Herald',
      status: 'proposed',
      payloadJson: JSON.stringify({ proposed_link: '[[Herald]]', anchor_text: 'the herald' }),
    });
    mockSuggestionsUnifiedList.mockResolvedValue({
      items: [wikiSuggestion],
      totalCount: 1,
      countByAgent: { archive: 1 },
      countByKind: { 'wiki-link': 1 },
    });

    render(<SuggestionReview />);
    await waitFor(() => {
      expect(screen.getByText('[[Herald]]')).toBeInTheDocument();
    });
  });

  it('AC-S4-6: rollback button appears in detail pane for accepted suggestions', async () => {
    const acceptedSuggestion = makeSuggestion({
      id: 'sug-accepted',
      rationale: 'An accepted suggestion.',
      status: 'accepted',
    });
    mockSuggestionsUnifiedList.mockResolvedValue({
      items: [acceptedSuggestion],
      totalCount: 1,
      countByAgent: { 'writing-assistant': 1 },
      countByKind: { suggestion: 1 },
    });

    render(<SuggestionReview />);
    // Switch to audit tab to see accepted suggestions
    await waitFor(() => screen.getByRole('tab', { name: /audit trail/i }));
    fireEvent.click(screen.getByRole('tab', { name: /audit trail/i }));

    await waitFor(() => screen.getByText('An accepted suggestion.'));

    // Open detail pane by clicking the row
    const auditRows = screen.getAllByRole('article');
    fireEvent.click(auditRows[0]);

    await waitFor(() => {
      const pane = screen.getByRole('complementary', { name: /suggestion detail/i });
      expect(pane).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /rollback this accepted suggestion/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /rollback this accepted suggestion/i }));

    await waitFor(() => {
      expect(mockSuggestionsRollback).toHaveBeenCalledWith('sug-accepted');
    });
  });

  it('clicking a button inside a row does not open the detail pane', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    const acceptBtns = screen.getAllByRole('button', { name: /accept suggestion/i });
    fireEvent.click(acceptBtns[0]);

    // Detail pane should NOT open; the accept action fired instead
    expect(
      screen.queryByRole('complementary', { name: /suggestion detail/i }),
    ).not.toBeInTheDocument();
  });

  it('closing the detail pane via X button removes it from DOM', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    const rows = screen.getAllByRole('article');
    fireEvent.click(rows[0]);

    await waitFor(() =>
      screen.getByRole('complementary', { name: /suggestion detail/i }),
    );

    fireEvent.click(screen.getByRole('button', { name: /close detail pane/i }));

    await waitFor(() => {
      expect(
        screen.queryByRole('complementary', { name: /suggestion detail/i }),
      ).not.toBeInTheDocument();
    });
  });

  it('accept in detail pane calls IPC and closes pane', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    const rows = screen.getAllByRole('article');
    fireEvent.click(rows[0]);

    await waitFor(() =>
      screen.getByRole('complementary', { name: /suggestion detail/i }),
    );

    fireEvent.click(screen.getByRole('button', { name: /accept this suggestion/i }));

    await act(async () => {});

    await waitFor(() => {
      expect(mockSuggestionsAccept).toHaveBeenCalledWith('sug-1');
      expect(
        screen.queryByRole('complementary', { name: /suggestion detail/i }),
      ).not.toBeInTheDocument();
    });
  });
});

// --- SLICE-3 Acceptance Criteria ---

describe('SuggestionReview — SLICE-3: batch select (AC-S3)', () => {
  const mockSuggestionsBatchAction = vi.fn();

  beforeEach(() => {
    mockSuggestionsBatchAction.mockResolvedValue({ updated: 3, failed: [] });
    setApi({ suggestionsBatchAction: mockSuggestionsBatchAction });
  });

  it('AC-S3-1: Ctrl+Click on 3 rows shows "3 selected" in the batch bar', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    const rows = screen.getAllByRole('article');
    fireEvent.click(rows[0], { ctrlKey: true });
    fireEvent.click(rows[1], { ctrlKey: true });
    fireEvent.click(rows[2], { ctrlKey: true });

    expect(screen.getByText('3 selected')).toBeInTheDocument();
  });

  it('AC-S3-2: Accept all removes all selected rows from inbox and calls batch IPC', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    const rows = screen.getAllByRole('article');
    fireEvent.click(rows[0], { ctrlKey: true });
    fireEvent.click(rows[1], { ctrlKey: true });
    fireEvent.click(rows[2], { ctrlKey: true });

    fireEvent.click(screen.getByRole('button', { name: /accept all selected/i }));

    await waitFor(() => {
      expect(mockSuggestionsBatchAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'accept' }),
      );
    });
    expect(screen.queryByText('Pacing is slow in the opening.')).not.toBeInTheDocument();
    expect(screen.queryByText('Hero motivation needs clarification.')).not.toBeInTheDocument();
    expect(screen.queryByText('Tower was destroyed in ch2 but appears in ch5.')).not.toBeInTheDocument();
  });

  it('AC-S3-3: Clear selection collapses the batch bar and deselects all rows', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    const rows = screen.getAllByRole('article');
    fireEvent.click(rows[0], { ctrlKey: true });
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /clear selection/i }));

    expect(screen.queryByText('selected')).not.toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: /batch actions/i })).not.toBeInTheDocument();
  });

  it('AC-S3-4: Select all checkbox selects all visible rows (respects active filter)', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    const selectAll = screen.getByRole('checkbox', { name: /select all/i });
    fireEvent.click(selectAll);

    // All 3 proposed rows visible (3 proposed in mock data)
    expect(screen.getByText('3 selected')).toBeInTheDocument();
  });

  it('AC-S3-4b: Select all respects the active agent filter', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    // Filter to Writing Assistant only (1 proposed row)
    fireEvent.click(screen.getByRole('button', { name: /Writing Assistant, \d+ pending/ }));

    const selectAll = screen.getByRole('checkbox', { name: /select all/i });
    fireEvent.click(selectAll);

    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('AC-S3-5: Batch bar buttons are keyboard-reachable (no tabIndex=-1)', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    const rows = screen.getAllByRole('article');
    fireEvent.click(rows[0], { ctrlKey: true });

    const batchBar = screen.getByRole('toolbar', { name: /batch actions/i });
    const buttons = within(batchBar).getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((btn) => {
      expect(btn).not.toHaveAttribute('tabIndex', '-1');
    });
  });

  it('Ctrl+Click toggles selection off when row is already selected', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    const rows = screen.getAllByRole('article');
    fireEvent.click(rows[0], { ctrlKey: true });
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    fireEvent.click(rows[0], { ctrlKey: true });
    expect(screen.queryByText('selected')).not.toBeInTheDocument();
  });

  it('Reject all calls batch IPC with action=reject', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    const rows = screen.getAllByRole('article');
    fireEvent.click(rows[0], { ctrlKey: true });

    fireEvent.click(screen.getByRole('button', { name: /reject all selected/i }));

    await waitFor(() => {
      expect(mockSuggestionsBatchAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'reject' }),
      );
    });
  });

  it('Ignore all calls batch IPC with action=ignore', async () => {
    render(<SuggestionReview />);
    await waitFor(() => screen.getByText('Pacing is slow in the opening.'));

    const rows = screen.getAllByRole('article');
    fireEvent.click(rows[0], { ctrlKey: true });

    fireEvent.click(screen.getByRole('button', { name: /ignore all selected/i }));

    await waitFor(() => {
      expect(mockSuggestionsBatchAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ignore' }),
      );
    });
  });
});
