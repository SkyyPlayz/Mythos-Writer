import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import ArchivePanel from './ArchivePanel';
import type { Scene } from './types';

const makeInconsistencyRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'arc-inc-1',
  source_agent: 'archive',
  confidence: 0.91,
  rationale: 'The Foundry appears here but was destroyed in chapter 1.',
  target_kind: 'manuscript',
  target_path: 'scene.md',
  target_anchor: null,
  payload_json: JSON.stringify({
    kind: 'inconsistency',
    anchorText: 'The Foundry gates swung open',
    entityName: 'The Foundry',
  }),
  status: 'proposed',
  created_at: new Date().toISOString(),
  applied_at: null,
  applied_run_id: null,
  budget_exceeded: 0,
  ...overrides,
});

const makeWikiLinkRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'arc-wl-1',
  source_agent: 'archive',
  confidence: 0.87,
  rationale: 'Detected reference to known entity.',
  target_kind: 'manuscript',
  target_path: 'scene.md',
  target_anchor: null,
  payload_json: JSON.stringify({
    kind: 'wiki-link',
    link: '[[The Foundry]]',
    anchorText: 'the foundry',
  }),
  status: 'proposed',
  created_at: new Date().toISOString(),
  applied_at: null,
  applied_run_id: null,
  budget_exceeded: 0,
  ...overrides,
});

const scene: Scene = {
  id: 'sc1',
  title: 'Test Scene',
  blocks: [{ id: 'b1', type: 'prose', order: 0, content: 'The Foundry gates swung open.', updatedAt: '' }],
  draftState: 'in-progress',
  order: 0,
  path: 'scene.md',
  createdAt: '',
  updatedAt: '',
};

const mockSuggestionsList = vi.fn();
const mockSuggestionsAccept = vi.fn();
const mockSuggestionsReject = vi.fn();
const mockArchiveScan = vi.fn();

function setApi(overrides: Record<string, unknown> = {}) {
  (window as unknown as { api: unknown }).api = {
    suggestionsList: mockSuggestionsList,
    suggestionsAccept: mockSuggestionsAccept,
    suggestionsReject: mockSuggestionsReject,
    archiveScan: mockArchiveScan,
    ...overrides,
  };
}

const onJumpToText = vi.fn();
const onInsertWikiLink = vi.fn();

const defaultProps = {
  scene,
  onJumpToText,
  onInsertWikiLink,
};

beforeEach(() => {
  vi.resetAllMocks();
  mockSuggestionsList.mockResolvedValue({
    suggestions: [makeInconsistencyRow(), makeWikiLinkRow()],
  });
  mockSuggestionsAccept.mockResolvedValue({ id: 'arc-wl-1', status: 'accepted' });
  mockSuggestionsReject.mockResolvedValue({ id: 'arc-inc-1', status: 'rejected' });
  mockArchiveScan.mockResolvedValue({ suggestions: [], inconsistenciesFound: 0, wikiLinksFound: 0 });
  setApi();
});

describe('ArchivePanel — card render', () => {
  it('renders an inconsistency card with its description', async () => {
    render(<ArchivePanel {...defaultProps} />);
    await waitFor(() =>
      expect(screen.getByText('The Foundry appears here but was destroyed in chapter 1.')).toBeInTheDocument(),
    );
  });

  it('renders the anchor text on an inconsistency card', async () => {
    render(<ArchivePanel {...defaultProps} />);
    await waitFor(() =>
      expect(screen.getByText(/The Foundry gates swung open/i)).toBeInTheDocument(),
    );
  });

  it('renders a wiki-link card with the proposed [[link]] text', async () => {
    render(<ArchivePanel {...defaultProps} />);
    await waitFor(() =>
      expect(screen.getByText('[[The Foundry]]')).toBeInTheDocument(),
    );
  });

  it('renders a wiki-link card with its rationale', async () => {
    render(<ArchivePanel {...defaultProps} />);
    await waitFor(() =>
      expect(screen.getByText('Detected reference to known entity.')).toBeInTheDocument(),
    );
  });

  it('shows empty-section status when there are no inconsistencies', async () => {
    mockSuggestionsList.mockResolvedValue({ suggestions: [makeWikiLinkRow()] });
    render(<ArchivePanel {...defaultProps} />);
    await waitFor(() =>
      expect(screen.getByText('[[The Foundry]]')).toBeInTheDocument(),
    );
    expect(screen.getByText('No inconsistencies found.')).toBeInTheDocument();
  });

  it('shows empty-section status when there are no wiki-link suggestions', async () => {
    mockSuggestionsList.mockResolvedValue({ suggestions: [makeInconsistencyRow()] });
    render(<ArchivePanel {...defaultProps} />);
    await waitFor(() =>
      expect(screen.getByText('The Foundry appears here but was destroyed in chapter 1.')).toBeInTheDocument(),
    );
    expect(screen.getByText('No wiki-link suggestions.')).toBeInTheDocument();
  });

  it('falls back to mock data when suggestionsList is not on the API', async () => {
    setApi({ suggestionsList: undefined });
    render(<ArchivePanel {...defaultProps} />);
    await waitFor(() =>
      expect(screen.getByRole('note')).toHaveTextContent('Preview mode'),
    );
    expect(screen.getAllByRole('article').length).toBeGreaterThan(0);
  });
});

describe('ArchivePanel — jump to line', () => {
  it('clicking Jump to Line calls onJumpToText with the anchor text', async () => {
    render(<ArchivePanel {...defaultProps} />);
    const btn = await screen.findByRole('button', { name: /jump to line: the foundry gates swung open/i });
    fireEvent.click(btn);
    expect(onJumpToText).toHaveBeenCalledWith('The Foundry gates swung open');
  });

  it('Jump to Line button is present for inconsistency cards', async () => {
    render(<ArchivePanel {...defaultProps} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /jump to line/i })).toBeInTheDocument(),
    );
  });
});

describe('ArchivePanel — accept wiki-link', () => {
  it('clicking Accept calls onInsertWikiLink with the link and anchor text', async () => {
    render(<ArchivePanel {...defaultProps} />);
    const btn = await screen.findByRole('button', { name: /accept wiki-link \[\[the foundry\]\]/i });
    fireEvent.click(btn);
    expect(onInsertWikiLink).toHaveBeenCalledWith('[[The Foundry]]', 'the foundry');
  });

  it('clicking Accept calls suggestionsAccept IPC with the suggestion id', async () => {
    render(<ArchivePanel {...defaultProps} />);
    const btn = await screen.findByRole('button', { name: /accept wiki-link/i });
    fireEvent.click(btn);
    await waitFor(() => expect(mockSuggestionsAccept).toHaveBeenCalledWith('arc-wl-1'));
  });

  it('accepted wiki-link card is removed from the list', async () => {
    render(<ArchivePanel {...defaultProps} />);
    const btn = await screen.findByRole('button', { name: /accept wiki-link/i });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(screen.queryByText('[[The Foundry]]')).not.toBeInTheDocument(),
    );
  });
});

describe('ArchivePanel — reject / dismiss', () => {
  it('clicking Resolve on an inconsistency opens the confirm dialog', async () => {
    render(<ArchivePanel {...defaultProps} />);
    const btn = await screen.findByRole('button', { name: /resolve inconsistency/i });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: /archive continuity issue/i })).toBeInTheDocument(),
    );
  });

  it('inconsistency card is removed after dialog resolves', async () => {
    const mockArchiveConfirm = vi.fn().mockResolvedValue({ ok: true, auditId: 'aud-1' });
    setApi({ archiveConfirm: mockArchiveConfirm });
    render(<ArchivePanel {...defaultProps} />);

    const btn = await screen.findByRole('button', { name: /resolve inconsistency/i });
    fireEvent.click(btn);

    const ignoreBtn = await screen.findByRole('button', { name: /ignore this finding/i });
    fireEvent.click(ignoreBtn);

    await waitFor(() =>
      expect(
        screen.queryByText('The Foundry appears here but was destroyed in chapter 1.'),
      ).not.toBeInTheDocument(),
    );
  });

  it('clicking Reject on a wiki-link calls suggestionsReject IPC', async () => {
    render(<ArchivePanel {...defaultProps} />);
    const btn = await screen.findByRole('button', { name: /reject wiki-link \[\[the foundry\]\]/i });
    fireEvent.click(btn);
    await waitFor(() => expect(mockSuggestionsReject).toHaveBeenCalledWith('arc-wl-1'));
  });

  it('rejected wiki-link card is removed from the list', async () => {
    render(<ArchivePanel {...defaultProps} />);
    const btn = await screen.findByRole('button', { name: /reject wiki-link/i });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(screen.queryByText('[[The Foundry]]')).not.toBeInTheDocument(),
    );
  });
});

describe('ArchivePanel — manual Scan now', () => {
  it('renders a Scan now button in the archive toolbar', async () => {
    render(<ArchivePanel {...defaultProps} />);

    expect(await screen.findByRole('button', { name: /scan now/i })).toBeInTheDocument();
  });

  it('clicking Scan now calls archiveScan with the active scene prose and path', async () => {
    render(<ArchivePanel {...defaultProps} />);

    fireEvent.click(await screen.findByRole('button', { name: /scan now/i }));

    await waitFor(() =>
      expect(mockArchiveScan).toHaveBeenCalledWith('The Foundry gates swung open.', 'scene.md'),
    );
  });

  it('disables the Scan now button with aria-disabled while the scan is running, then re-enables it', async () => {
    let resolveScan!: (value: { suggestions: unknown[]; inconsistenciesFound: number; wikiLinksFound: number }) => void;
    mockArchiveScan.mockReturnValue(new Promise((resolve) => { resolveScan = resolve; }));
    render(<ArchivePanel {...defaultProps} />);

    const button = await screen.findByRole('button', { name: /scan now/i });
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('status', { name: /archive scan status/i })).toHaveTextContent(/scanning/i);

    resolveScan({ suggestions: [], inconsistenciesFound: 0, wikiLinksFound: 0 });

    await waitFor(() => expect(button).not.toBeDisabled());
    expect(button).toHaveAttribute('aria-disabled', 'false');
  });

  it('refreshes archive suggestions after Scan now completes', async () => {
    mockSuggestionsList
      .mockResolvedValueOnce({ suggestions: [makeInconsistencyRow()] })
      .mockResolvedValueOnce({ suggestions: [makeWikiLinkRow({ id: 'arc-wl-refreshed', rationale: 'Fresh scan found a new wiki-link.' })] });

    render(<ArchivePanel {...defaultProps} />);

    expect(await screen.findByText('The Foundry appears here but was destroyed in chapter 1.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /scan now/i }));

    await waitFor(() => expect(screen.getByText('Fresh scan found a new wiki-link.')).toBeInTheDocument());
    expect(mockSuggestionsList).toHaveBeenCalledTimes(2);
  });
});
