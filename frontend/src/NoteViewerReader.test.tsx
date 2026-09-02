// SKY-11244 — Notes Editor Read aloud: the toolbar Read icon now opens a
// working reader (ReaderBar, same engine as the Story Editor) instead of
// toasting the old M13 stub. Playback mocked the same way as the Story
// Editor's own reader tests (ManuscriptViewReader.test.tsx): utterances
// captured via a stubbed window.speechSynthesis, boundaries simulated by
// firing onend.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NoteViewer from './NoteViewer';

const readNotesVault = vi.fn();
const writeNotesVault = vi.fn();
const readVault = vi.fn();
const writeVault = vi.fn();
const entityList = vi.fn();
const noteBacklinks = vi.fn();

/** Minimal SpeechSynthesisUtterance stub (same shape as the Story reader's tests). */
class MockUtterance {
  text: string;
  volume = 1;
  rate = 1;
  voice: unknown = null;
  onend: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  constructor(text: string) { this.text = text; }
}

let spoken: MockUtterance[] = [];
const speakMock = vi.fn((u: MockUtterance) => { spoken.push(u); });
const cancelMock = vi.fn();

function stubSpeech() {
  (window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
    speak: speakMock,
    cancel: cancelMock,
    getVoices: vi.fn(() => []),
  };
  (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = MockUtterance;
  (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = MockUtterance;
}

beforeEach(() => {
  vi.clearAllMocks();
  spoken = [];
  stubSpeech();
  readNotesVault.mockResolvedValue({
    content: 'First sentence here. Second sentence follows.\n\nA new paragraph starts.',
  });
  writeNotesVault.mockResolvedValue({ path: 'Notes/Test.md', bytes: 1 });
  readVault.mockResolvedValue({ content: '' });
  writeVault.mockResolvedValue({ path: 'Story/Test.md', bytes: 1 });
  entityList.mockResolvedValue({ entities: [] });
  noteBacklinks.mockResolvedValue({ backlinks: [] });
  (window as unknown as { api: unknown }).api = {
    readNotesVault, writeNotesVault, readVault, writeVault, entityList, noteBacklinks,
  };
});

afterEach(() => {
  cleanup();
  delete (window as { api?: unknown }).api;
  delete (window as { speechSynthesis?: unknown }).speechSynthesis;
  document.querySelectorAll('[data-testid="ln-toast"]').forEach((el) => el.remove());
  vi.restoreAllMocks();
});

/** Rich mode is the default, so the note loads straight into the FormatToolbar
 *  surface — wait for the load + the Rich editor's own entityList() mount. */
async function loadNote() {
  render(<NoteViewer path="Notes/Test.md" />);
  await waitFor(() => expect(readNotesVault).toHaveBeenCalledWith('Notes/Test.md'));
  await act(async () => {});
}

function openReaderBar() {
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Read aloud' }));
  return screen.getByTestId('msv-reader-bar');
}

describe('NoteViewer Read aloud (SKY-11244)', () => {
  it('no longer toasts the M13 stub anywhere in the note surface', async () => {
    await loadNote();
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Read aloud' }));
    expect(document.body.textContent).not.toMatch(/M13/);
  });

  it('the toolbar Read icon opens the reader bar, and From start actually speaks the note', async () => {
    await loadNote();
    expect(screen.queryByTestId('msv-reader-bar')).toBeNull();

    openReaderBar();
    fireEvent.click(screen.getByTestId('msv-reader-from-start'));

    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(spoken[0].text).toBe('First sentence here.');
    expect(screen.getByTestId('msv-reader-status')).toHaveTextContent('Reading 1 of 3');
  });

  it('advances to the next sentence when an utterance ends, across the paragraph break', async () => {
    await loadNote();
    openReaderBar();
    fireEvent.click(screen.getByTestId('msv-reader-from-start'));
    expect(spoken).toHaveLength(1);

    await act(async () => { spoken[0].onend?.(new Event('end')); });
    expect(spoken).toHaveLength(2);
    expect(spoken[1].text).toBe('Second sentence follows.');

    await act(async () => { spoken[1].onend?.(new Event('end')); });
    expect(spoken).toHaveLength(3);
    expect(spoken[2].text).toBe('A new paragraph starts.');
  });

  it('play/pause toggles via the transport button (pause cancels the current utterance)', async () => {
    await loadNote();
    openReaderBar();
    fireEvent.click(screen.getByTestId('msv-reader-from-start'));
    expect(screen.getByTestId('msv-reader-play')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('msv-reader-play'));
    expect(cancelMock).toHaveBeenCalled();
    expect(screen.getByTestId('msv-reader-play')).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByTestId('msv-reader-play'));
    expect(screen.getByTestId('msv-reader-play')).toHaveAttribute('aria-pressed', 'true');
  });

  it('rate and voice controls work the same as the Story Editor reader', async () => {
    await loadNote();
    openReaderBar();

    fireEvent.change(screen.getByTestId('msv-reader-rate'), { target: { value: '150' } });
    expect(screen.getByTestId('msv-reader-rate-readout')).toHaveTextContent('150%');

    fireEvent.click(screen.getByTestId('msv-reader-from-start'));
    expect(spoken[0].rate).toBeCloseTo(1.5);
  });

  it('close (clicking Read again) stops playback and hides the bar', async () => {
    await loadNote();
    openReaderBar();
    fireEvent.click(screen.getByTestId('msv-reader-from-start'));

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Read aloud' }));
    expect(cancelMock).toHaveBeenCalled();
    expect(screen.queryByTestId('msv-reader-bar')).toBeNull();
  });
});
