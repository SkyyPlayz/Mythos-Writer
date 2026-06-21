import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ArchiveConfirmDialog from './ArchiveConfirmDialog';

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

  it('renders all three action buttons', () => {
    render(<ArchiveConfirmDialog {...defaultProps} />);
    expect(screen.getByText('Match Archive to Story')).toBeTruthy();
    expect(screen.getByText('Suggest Story Change')).toBeTruthy();
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

  it('calls archiveConfirm with suggest_story_change action', async () => {
    mockArchiveConfirm.mockResolvedValue({ ok: true, auditId: 'aud-2', newSuggestionId: 'sug-2' });
    const onResolved = vi.fn();
    render(<ArchiveConfirmDialog {...defaultProps} onResolved={onResolved} />);

    fireEvent.click(screen.getByText('Suggest Story Change'));
    await waitFor(() => expect(mockArchiveConfirm).toHaveBeenCalledWith('sug-1', 'suggest_story_change'));
    expect(onResolved).toHaveBeenCalledWith('suggest_story_change');
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
});
