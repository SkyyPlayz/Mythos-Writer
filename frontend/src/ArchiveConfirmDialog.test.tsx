import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ArchiveConfirmDialog, { W8_NOTE_REFUSAL } from './ArchiveConfirmDialog';

// Mock window.api
const mockArchiveConfirm = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'api', {
    value: { archiveConfirm: mockArchiveConfirm },
    writable: true,
    configurable: true,
  });
});

describe('ArchiveConfirmDialog', () => {
  const defaultProps = {
    suggestionId: 'sug-1',
    rationale: "Elara's vault entry states hair: blonde but scene contains dark hair",
    anchorText: 'dark hair streaming behind her',
    onClose: vi.fn(),
    onResolved: vi.fn(),
  };

  it('renders dialog with rationale and anchor text', () => {
    render(<ArchiveConfirmDialog {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/Elara's vault entry/)).toBeTruthy();
    expect(screen.getByText(/dark hair streaming/)).toBeTruthy();
  });

  it('renders match and ignore, with no suggest-story-change button', () => {
    render(<ArchiveConfirmDialog {...defaultProps} />);
    expect(screen.getByText('Match Archive to Story')).toBeTruthy();
    expect(screen.queryByText('Suggest Story Change')).toBeNull();
    expect(screen.getByText('Ignore')).toBeTruthy();
  });

  it('calls archiveConfirm with match_archive action', async () => {
    mockArchiveConfirm.mockResolvedValue({ ok: true, auditId: 'aud-1' });
    const onResolved = vi.fn();
    render(<ArchiveConfirmDialog {...defaultProps} onResolved={onResolved} />);

    fireEvent.click(screen.getByText('Match Archive to Story'));
    await waitFor(() => expect(mockArchiveConfirm).toHaveBeenCalledWith('sug-1', 'match_archive'));
    expect(onResolved).toHaveBeenCalledWith('match_archive');
  });

  it('does not offer suggest_story_change', () => {
    render(<ArchiveConfirmDialog {...defaultProps} />);
    expect(screen.queryByRole('button', { name: /suggest story change|create suggestion to revise manuscript/i })).toBeNull();
    expect(mockArchiveConfirm).not.toHaveBeenCalled();
  });

  it('calls archiveConfirm with ignore action', async () => {
    mockArchiveConfirm.mockResolvedValue({ ok: true, auditId: 'aud-3' });
    const onResolved = vi.fn();
    render(<ArchiveConfirmDialog {...defaultProps} onResolved={onResolved} />);

    fireEvent.click(screen.getByText('Ignore'));
    await waitFor(() => expect(mockArchiveConfirm).toHaveBeenCalledWith('sug-1', 'ignore'));
    expect(onResolved).toHaveBeenCalledWith('ignore');
  });

  it('shows error message on API failure', async () => {
    mockArchiveConfirm.mockRejectedValue(new Error('DB write failed'));
    render(<ArchiveConfirmDialog {...defaultProps} />);

    fireEvent.click(screen.getByText('Ignore'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/DB write failed/)).toBeTruthy();
  });

  it('calls onClose when overlay (scrim) is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<ArchiveConfirmDialog {...defaultProps} onClose={onClose} />);

    const overlay = container.querySelector('.ln-dialog-overlay')!;
    // Simulate a direct click on the scrim (target === currentTarget)
    const evt = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(evt, 'target', { value: overlay, configurable: true });
    Object.defineProperty(evt, 'currentTarget', { value: overlay, configurable: true });
    overlay.dispatchEvent(evt);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<ArchiveConfirmDialog {...defaultProps} onClose={onClose} />);

    fireEvent.click(screen.getByLabelText('Close dialog'));
    expect(onClose).toHaveBeenCalled();
  });

  it('disables buttons while busy', async () => {
    let resolveCall!: (v: unknown) => void;
    mockArchiveConfirm.mockReturnValue(new Promise((r) => { resolveCall = r; }));
    render(<ArchiveConfirmDialog {...defaultProps} />);

    fireEvent.click(screen.getByText('Match Archive to Story'));

    const btns = screen.getAllByRole('button');
    for (const btn of btns) {
      if (btn.getAttribute('aria-label') !== 'Close dialog') {
        expect((btn as HTMLButtonElement).disabled).toBe(true);
      }
    }

    resolveCall({ ok: true, auditId: 'aud-x' });
  });

  it.each([
    'manuscript_target',
    'not_allowlisted',
    'resolve_failed',
    'unresolved_relation',
    'unknown_kind',
    'no_manifest',
  ])('shows the note refusal for guard reason %s and does not resolve', async (reason) => {
    mockArchiveConfirm.mockResolvedValue({ ok: false, reason });
    const onResolved = vi.fn();
    render(<ArchiveConfirmDialog {...defaultProps} onResolved={onResolved} />);

    fireEvent.click(screen.getByText('Match Archive to Story'));
    await waitFor(() => expect(screen.getByText(W8_NOTE_REFUSAL)).toBeTruthy());
    expect(onResolved).not.toHaveBeenCalled();
  });
});
