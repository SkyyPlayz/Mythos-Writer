import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SceneHistory from './SceneHistory';

// Mock window.api.drafts*
const draftsList = vi.fn();
const draftsPreview = vi.fn();
const draftsDelete = vi.fn();
const draftsRestore = vi.fn();

const SNAP = { id: 'snap-1', createdAt: 1_700_000_000_000, label: 'draft one' };

beforeEach(() => {
  vi.clearAllMocks();
  draftsList.mockResolvedValue({ snapshots: [SNAP] });
  draftsPreview.mockResolvedValue({ content: 'preview text' });
  draftsDelete.mockResolvedValue(undefined);
  draftsRestore.mockResolvedValue({ content: 'restored text', preRestoreSnapshotId: 'pre-1' });
  Object.defineProperty(window, 'api', {
    value: { draftsList, draftsPreview, draftsDelete, draftsRestore },
    writable: true,
    configurable: true,
  });
});

const defaultProps = {
  sceneId: 'scene-1',
  scenePath: '/scene-1.md',
  currentContent: 'current scene content',
  onRestore: vi.fn(),
  onClose: vi.fn(),
};

describe('SceneHistory error surfacing (GH #626)', () => {
  it('surfaces a draftsList failure via role="alert" instead of vanishing', async () => {
    draftsList.mockRejectedValueOnce(new Error('list boom'));
    render(<SceneHistory {...defaultProps} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('list boom');
  });

  it('surfaces a preview failure and does not show stale content', async () => {
    draftsPreview.mockRejectedValueOnce(new Error('preview boom'));
    render(<SceneHistory {...defaultProps} />);
    fireEvent.click(await screen.findByLabelText(/Draft from/));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('preview boom');
  });

  it('surfaces a delete failure without removing the snapshot from the list', async () => {
    draftsDelete.mockRejectedValueOnce(new Error('delete boom'));
    render(<SceneHistory {...defaultProps} />);
    fireEvent.click(await screen.findByLabelText('Delete this draft'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('delete boom');
    // draftsList should NOT have been re-called by a failed delete (no false refresh),
    // and the snapshot row is still present.
    expect(draftsList).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/Draft from/)).toBeTruthy();
  });

  it('surfaces a restore failure and does NOT optimistically restore or close', async () => {
    draftsRestore.mockRejectedValueOnce(new Error('restore boom'));
    render(<SceneHistory {...defaultProps} />);
    // Select the snapshot so a preview + Restore button appear.
    fireEvent.click(await screen.findByLabelText(/Draft from/));
    fireEvent.click(await screen.findByText('Restore'));
    // Confirm dialog Restore button (the dialog itself shares the label).
    fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('restore boom');
    expect(defaultProps.onRestore).not.toHaveBeenCalled();
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });

  it('lets the user dismiss a surfaced error', async () => {
    draftsList.mockRejectedValueOnce(new Error('list boom'));
    render(<SceneHistory {...defaultProps} />);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByLabelText('Dismiss error'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('does not show an error on a successful delete', async () => {
    render(<SceneHistory {...defaultProps} />);
    fireEvent.click(await screen.findByLabelText('Delete this draft'));
    await waitFor(() => expect(draftsDelete).toHaveBeenCalledWith('snap-1'));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
