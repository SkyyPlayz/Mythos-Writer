// M12 — DraftsPopover: version rows with delta chips, Compare/Restore wiring
// to the existing SKY-1611 drafts IPC, and keep-N persistence through
// settings.snapshots.maxPerScene (the SnapshotsSection field).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DraftsPopover from './DraftsPopover';

const draftsList = vi.fn();
const draftsPreview = vi.fn();
const draftsRestore = vi.fn();
const settingsGet = vi.fn();
const settingsSet = vi.fn();

const NOW = Date.now();
const SNAPS = [
  { id: 's1', sceneId: 'scene-1', createdAt: NOW - 2 * 60_000, label: null },
  { id: 's2', sceneId: 'scene-1', createdAt: NOW - 26 * 3_600_000, label: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  draftsList.mockResolvedValue({ snapshots: SNAPS });
  draftsPreview.mockImplementation(async (id: string) => ({
    content: id === 's1' ? 'one two three' : 'one two',
  }));
  draftsRestore.mockResolvedValue({ content: 'restored text', preRestoreSnapshotId: 'pre-1' });
  settingsGet.mockResolvedValue({
    apiKey: '',
    theme: 'dark',
    snapshots: { maxPerScene: 20, maxAgeDays: 30 },
  } as unknown as AppSettings);
  settingsSet.mockResolvedValue({ saved: true });
  Object.defineProperty(window, 'api', {
    value: { draftsList, draftsPreview, draftsRestore, settingsGet, settingsSet },
    writable: true,
    configurable: true,
  });
});

function makeProps() {
  return {
    sceneId: 'scene-1',
    documentLabel: 'Scene 4',
    currentContent: 'one two three four',
    onCompare: vi.fn(),
    onRestore: vi.fn(),
    onClose: vi.fn(),
  };
}

describe('<DraftsPopover>', () => {
  it('renders the header, the current row, and version rows with word deltas', async () => {
    render(<DraftsPopover {...makeProps()} />);
    expect(screen.getByText(/DRAFTS & HISTORY — SCENE 4/)).toBeInTheDocument();

    // Current (live) row on top: Draft 3 of 3, delta chip "current".
    expect(await screen.findByText('Draft 3')).toBeInTheDocument();
    expect(screen.getByText('current')).toBeInTheDocument();
    expect(screen.getByText(/4 words · now/)).toBeInTheDocument();

    // Snapshot rows, newest first, delta vs the next-newer draft.
    expect(await screen.findByText('Draft 2')).toBeInTheDocument();
    expect(screen.getByText('Draft 1')).toBeInTheDocument();
    // Draft 2: 3 words vs current 4 → +1; Draft 1: 2 words vs Draft 2 → +1.
    expect(await screen.findAllByText('+1 words')).toHaveLength(2);
    expect(screen.getByText(/3 words · 2m ago/)).toBeInTheDocument();
    expect(screen.getByText(/2 words · yesterday/)).toBeInTheDocument();
  });

  it('disables Compare/Restore on the current row', async () => {
    render(<DraftsPopover {...makeProps()} />);
    const row = await screen.findByTestId('ln-draft-row-current');
    const buttons = row.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    buttons.forEach((b) => expect(b).toBeDisabled());
  });

  it('Compare passes the snapshot, its content, and its label to onCompare', async () => {
    const props = makeProps();
    render(<DraftsPopover {...props} />);
    fireEvent.click(await screen.findByLabelText('Compare Draft 2 with the current draft'));
    await waitFor(() =>
      expect(props.onCompare).toHaveBeenCalledWith({
        snapshot: expect.objectContaining({ id: 's1' }),
        content: 'one two three',
        label: 'Draft 2',
      }),
    );
  });

  it('Restore reuses the existing draftsRestore flow, then notifies and closes', async () => {
    const props = makeProps();
    render(<DraftsPopover {...props} />);
    fireEvent.click(await screen.findByLabelText('Restore Draft 2'));
    await waitFor(() => expect(props.onRestore).toHaveBeenCalledWith('restored text'));
    expect(draftsRestore).toHaveBeenCalledWith('s1', 'scene-1', 'one two three four');
    expect(props.onClose).toHaveBeenCalled();
  });

  it('surfaces a restore failure without notifying or closing', async () => {
    draftsRestore.mockRejectedValueOnce(new Error('restore boom'));
    const props = makeProps();
    render(<DraftsPopover {...props} />);
    fireEvent.click(await screen.findByLabelText('Restore Draft 2'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('restore boom');
    expect(props.onRestore).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('loads keep-N from settings.snapshots.maxPerScene and persists stepper changes', async () => {
    render(<DraftsPopover {...makeProps()} />);
    const value = await screen.findByTestId('ln-drafts-keep-n');
    await waitFor(() => expect(value.textContent).toBe('20'));

    fireEvent.click(screen.getByLabelText('Keep more snapshots'));
    expect(value.textContent).toBe('21');
    await waitFor(() =>
      expect(settingsSet).toHaveBeenCalledWith(
        expect.objectContaining({ snapshots: { maxPerScene: 21, maxAgeDays: 30 } }),
      ),
    );

    fireEvent.click(screen.getByLabelText('Keep fewer snapshots'));
    expect(value.textContent).toBe('20');
  });

  it('shows the display-only cadence label (default: every save)', async () => {
    render(<DraftsPopover {...makeProps()} />);
    expect(await screen.findByText('Snapshot every save')).toBeInTheDocument();
    expect(screen.getByText(/nothing is ever lost/)).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const props = makeProps();
    render(<DraftsPopover {...props} />);
    await screen.findByText('Draft 2');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalled();
  });
});
