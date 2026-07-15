// Beta 4 M10 — DraftsPopover: version rows from the M5 file store (labels,
// delta chips, meta lines), Compare/Restore wiring, and BOTH M10 settings —
// keep-N persisted to versions.maxPerScene (the SKY-10/M5 retention field)
// and snapshot frequency persisted to editorPrefs.autosaveSeconds.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import DraftsPopover from './DraftsPopover';
import type { SceneDraftEntry } from './useSceneDrafts';

/** Flush the popover's async settings load inside act (setupTests policy). */
const flushSettingsLoad = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

const settingsGet = vi.fn();
const settingsSet = vi.fn();

const NOW = Date.now();
const DRAFTS: SceneDraftEntry[] = [
  { ts: 'draft-2', label: 'Draft 2', content: 'one two three', intent: 'save', savedAtMs: NOW - 2 * 60_000 },
  { ts: 'draft-1', label: 'Draft 1', content: 'one two', intent: 'save', savedAtMs: NOW - 26 * 3_600_000 },
];

beforeEach(() => {
  vi.clearAllMocks();
  settingsGet.mockResolvedValue({
    apiKey: '',
    theme: 'dark',
    versions: { maxPerScene: 20, maxAgeDays: 0 },
    editorPrefs: { autosaveSeconds: 30 },
  } as unknown as AppSettings);
  settingsSet.mockResolvedValue({ saved: true });
  Object.defineProperty(window, 'api', {
    value: { settingsGet, settingsSet },
    writable: true,
    configurable: true,
  });
});

function makeProps() {
  return {
    documentLabel: 'Scene 4',
    drafts: DRAFTS,
    currentLabel: 'Draft 3',
    currentContent: 'one two three four',
    onCompare: vi.fn(),
    onRestore: vi.fn(),
    onClose: vi.fn(),
  };
}

describe('<DraftsPopover>', () => {
  it('renders the header, the current row, and version rows with word deltas', async () => {
    render(<DraftsPopover {...makeProps()} />);
    await flushSettingsLoad();
    expect(screen.getByText('DRAFTS & HISTORY')).toBeInTheDocument();
    expect(screen.getByText(/drafts of what's open/)).toBeInTheDocument();

    // Current (live) row on top: currentLabel + "current" chip.
    expect(screen.getByText('Draft 3')).toBeInTheDocument();
    expect(screen.getByText('current')).toBeInTheDocument();
    expect(screen.getByText(/4 words · now/)).toBeInTheDocument();

    // Snapshot rows, newest first, delta vs the next-newer draft.
    expect(screen.getByText('Draft 2')).toBeInTheDocument();
    expect(screen.getByText('Draft 1')).toBeInTheDocument();
    // Draft 2: 3 words vs current 4 → +1; Draft 1: 2 words vs Draft 2 → +1.
    expect(await screen.findAllByText('+1 words')).toHaveLength(2);
    expect(screen.getByText(/3 words · 2m ago/)).toBeInTheDocument();
    expect(screen.getByText(/2 words · yesterday/)).toBeInTheDocument();
  });

  it('disables Compare/Restore on the current row', async () => {
    render(<DraftsPopover {...makeProps()} />);
    await flushSettingsLoad();
    const row = screen.getByTestId('ln-draft-row-current');
    const buttons = row.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    buttons.forEach((b) => expect(b).toBeDisabled());
  });

  it('Compare hands the draft entry to onCompare', async () => {
    const props = makeProps();
    render(<DraftsPopover {...props} />);
    await flushSettingsLoad();
    fireEvent.click(screen.getByLabelText('Compare Draft 2 with the current draft'));
    expect(props.onCompare).toHaveBeenCalledWith(DRAFTS[0]);
  });

  it('Restore hands the draft entry to onRestore (host runs the undoable load flow)', async () => {
    const props = makeProps();
    render(<DraftsPopover {...props} />);
    await flushSettingsLoad();
    fireEvent.click(screen.getByLabelText('Restore Draft 1'));
    expect(props.onRestore).toHaveBeenCalledWith(DRAFTS[1]);
  });

  it('loads keep-N from versions.maxPerScene and persists stepper changes to it', async () => {
    render(<DraftsPopover {...makeProps()} />);
    const value = await screen.findByTestId('ln-drafts-keep-n');
    await waitFor(() => expect(value.textContent).toBe('20'));

    fireEvent.click(screen.getByLabelText('Keep more snapshots'));
    expect(value.textContent).toBe('21');
    await waitFor(() =>
      expect(settingsSet).toHaveBeenCalledWith(
        expect.objectContaining({ versions: { maxPerScene: 21, maxAgeDays: 0 } }),
      ),
    );

    fireEvent.click(screen.getByLabelText('Keep fewer snapshots'));
    expect(value.textContent).toBe('20');
  });

  it('loads snapshot frequency from editorPrefs.autosaveSeconds and persists ±5s steps', async () => {
    render(<DraftsPopover {...makeProps()} />);
    const value = await screen.findByTestId('ln-drafts-freq-s');
    await waitFor(() => expect(value.textContent).toBe('30s'));

    fireEvent.click(screen.getByLabelText('Snapshot more often'));
    expect(value.textContent).toBe('35s');
    await waitFor(() =>
      expect(settingsSet).toHaveBeenCalledWith(
        expect.objectContaining({ editorPrefs: expect.objectContaining({ autosaveSeconds: 35 }) }),
      ),
    );

    fireEvent.click(screen.getByLabelText('Snapshot less often'));
    expect(value.textContent).toBe('30s');
  });

  it('clamps the frequency to the settings slider range (5–120s)', async () => {
    settingsGet.mockResolvedValue({
      apiKey: '',
      theme: 'dark',
      editorPrefs: { autosaveSeconds: 5 },
    } as unknown as AppSettings);
    render(<DraftsPopover {...makeProps()} />);
    const value = await screen.findByTestId('ln-drafts-freq-s');
    await waitFor(() => expect(value.textContent).toBe('5s'));
    fireEvent.click(screen.getByLabelText('Snapshot less often'));
    expect(value.textContent).toBe('5s');
  });

  it('shows the empty state without stored drafts', async () => {
    render(<DraftsPopover {...makeProps()} drafts={[]} />);
    await flushSettingsLoad();
    expect(screen.getByText(/No snapshots yet/)).toBeInTheDocument();
    expect(screen.getByText(/nothing is ever lost/)).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const props = makeProps();
    render(<DraftsPopover {...props} />);
    await flushSettingsLoad();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalled();
  });

  it('ignores outside mousedown on the anchor element (toggle pill)', async () => {
    const props = makeProps();
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const anchorRef = { current: anchor };
    render(<DraftsPopover {...props} anchorRef={anchorRef} />);
    await flushSettingsLoad();
    fireEvent.mouseDown(anchor);
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(props.onClose).toHaveBeenCalled();
    document.body.removeChild(anchor);
  });
});
