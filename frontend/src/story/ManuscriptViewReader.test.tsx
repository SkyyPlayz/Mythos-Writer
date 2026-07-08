// Beta 3 M13 — TTS reader integration in ManuscriptView: reader chip +
// audiobook bar, moving per-paragraph highlight synced to utterance
// boundaries, skip/seek/speed/voice controls, selection-bar Read, and the
// muted/unavailable fallbacks. Playback runs on the OS speechSynthesis path
// of the existing useTtsPlayer stack, mocked the same way as its unit tests
// (utterances captured; boundaries simulated by firing onend/onerror).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Block, Chapter, DraftState, Scene, Story } from '../types';
import ManuscriptView from './ManuscriptView';
import { commentsStore } from '../comments';
import type { ManuscriptCursor } from './manuscriptModel';

const NOW = '2026-07-07T00:00:00.000Z';

function mkBlock(id: string, content: string, order: number): Block {
  return { id, type: 'prose', content, order, updatedAt: NOW };
}

function mkScene(id: string, title: string, order: number, paras: string[], draftState?: DraftState): Scene {
  return {
    id,
    title,
    path: `scenes/${id}.md`,
    order,
    blocks: paras.map((p, i) => mkBlock(`${id}-b${i}`, p, i)),
    draftState,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function mkChapter(id: string, title: string, order: number, scenes: Scene[]): Chapter {
  return { id, title, path: `chapters/${id}`, order, scenes, createdAt: NOW, updatedAt: NOW };
}

function mkStory(): Story {
  return {
    id: 'story-1',
    title: 'The Last City of Veynn',
    path: 'stories/story-1',
    chapters: [
      mkChapter('ch1', 'The Quiet Before', 0, [
        mkScene('s1', "The Watcher's Call", 0, [
          'Mira counted the bells. The lantern cast a trembling circle of light.',
          'Getting out would be another story.',
        ]),
        mkScene('s2', 'A City in Shadows', 1, ['By morning the rumor had teeth.']),
      ]),
    ],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

// Flow at book zoom:
//   0 heading ch1/s1 · 1 para s1-b0 · 2 para s1-b1 · 3 heading s2 · 4 para s2-b0
const BOOK: ManuscriptCursor = { zoom: 'book', part: 0, chapter: 0, scene: 0 };

/** Minimal SpeechSynthesisUtterance stub (same shape as useTtsPlayer tests). */
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
const ariaVoice = { name: 'Aria (Natural)', lang: 'en-US', voiceURI: 'aria' };
const getVoicesMock = vi.fn(() => [ariaVoice, { name: 'Hans', lang: 'de-DE', voiceURI: 'hans' }]);

function stubSpeech() {
  (window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
    speak: speakMock,
    cancel: cancelMock,
    getVoices: getVoicesMock,
  };
  (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = MockUtterance;
  (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = MockUtterance;
}

function renderView(over: Partial<Parameters<typeof ManuscriptView>[0]> = {}) {
  const props = {
    story: mkStory(),
    cursor: BOOK,
    onCursorChange: vi.fn(),
    onEditParagraph: vi.fn(),
    onCycleStatus: vi.fn(),
    ...over,
  };
  return { ...render(<ManuscriptView {...props} />), props };
}

function openBar() {
  fireEvent.click(screen.getByTestId('msv-reader-chip'));
  return screen.getByTestId('msv-reader-bar');
}

/** Finish the most recent utterance (the boundary the highlight follows). */
async function endUtterance(i = spoken.length - 1) {
  await act(async () => { spoken[i].onend?.(new Event('end')); });
}

beforeEach(() => {
  vi.clearAllMocks();
  spoken = [];
  stubSpeech();
  commentsStore.reset();
});

afterEach(() => {
  cleanup();
  commentsStore.reset();
  delete (window as { api?: unknown }).api;
  delete (window as { speechSynthesis?: unknown }).speechSynthesis;
  document.querySelectorAll('[data-testid="ln-toast"]').forEach((el) => el.remove());
  vi.restoreAllMocks();
});

describe('reader chip + audiobook bar', () => {
  it('the chip opens the bar (Ready) and close hides it again', () => {
    renderView();
    expect(screen.queryByTestId('msv-reader-bar')).toBeNull();
    const chip = screen.getByTestId('msv-reader-chip');
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(chip);
    expect(screen.getByTestId('msv-reader-bar')).toBeInTheDocument();
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('msv-reader-status')).toHaveTextContent('Ready');
    fireEvent.click(screen.getByTestId('msv-reader-close'));
    expect(screen.queryByTestId('msv-reader-bar')).toBeNull();
  });

  it('play at book zoom reads from the start: chapter heading first', () => {
    renderView();
    openBar();
    fireEvent.click(screen.getByTestId('msv-reader-play'));
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(spoken[0].text).toBe("Chapter 1. The Quiet Before. The Watcher's Call.");
    expect(screen.getByTestId('msv-reader-status')).toHaveTextContent('Reading 1 of 5');
    // Headings have no paragraph to highlight.
    expect(document.querySelectorAll('.msv-para-text--reading')).toHaveLength(0);
  });

  it('the moving highlight follows utterance boundaries paragraph by paragraph', async () => {
    renderView();
    openBar();
    fireEvent.click(screen.getByTestId('msv-reader-play'));

    await endUtterance(); // heading done → first paragraph
    expect(spoken[1].text).toBe(
      'Mira counted the bells. The lantern cast a trembling circle of light.'
    );
    expect(screen.getByTestId('msv-para-s1-b0').className).toContain('msv-para-text--reading');
    expect(screen.getByTestId('msv-reader-status')).toHaveTextContent('Reading 2 of 5');

    await endUtterance(); // → second paragraph, highlight moves
    expect(screen.getByTestId('msv-para-s1-b0').className).not.toContain('msv-para-text--reading');
    expect(screen.getByTestId('msv-para-s1-b1').className).toContain('msv-para-text--reading');
  });

  it('reaching the end of the flow stops playback and clears the highlight', async () => {
    renderView();
    openBar();
    fireEvent.click(screen.getByTestId('msv-reader-play'));
    for (let i = 0; i < 5; i++) await endUtterance();
    expect(speakMock).toHaveBeenCalledTimes(5);
    expect(screen.getByTestId('msv-reader-status')).toHaveTextContent('Paused');
    expect(document.querySelectorAll('.msv-para-text--reading')).toHaveLength(0);
  });

  it('pause cancels speech and resume replays the current utterance', async () => {
    renderView();
    openBar();
    const play = screen.getByTestId('msv-reader-play');
    fireEvent.click(play);
    await endUtterance(); // now reading paragraph 1 (idx 1)

    fireEvent.click(play); // pause
    expect(cancelMock).toHaveBeenCalled();
    expect(screen.getByTestId('msv-reader-status')).toHaveTextContent('Paused');
    expect(document.querySelectorAll('.msv-para-text--reading')).toHaveLength(0);

    fireEvent.click(play); // resume — same utterance, not a rebuilt flow
    expect(spoken[spoken.length - 1].text).toBe(spoken[1].text);
    expect(screen.getByTestId('msv-para-s1-b0').className).toContain('msv-para-text--reading');
  });
});

describe('skips, position and scene jumps', () => {
  it('±10s buttons move one utterance either way', async () => {
    renderView();
    openBar();
    fireEvent.click(screen.getByTestId('msv-reader-play')); // idx 0
    fireEvent.click(screen.getByTestId('msv-reader-fwd'));
    expect(spoken[spoken.length - 1].text).toBe(
      'Mira counted the bells. The lantern cast a trembling circle of light.'
    );
    fireEvent.click(screen.getByTestId('msv-reader-back'));
    expect(spoken[spoken.length - 1].text).toBe(
      "Chapter 1. The Quiet Before. The Watcher's Call."
    );
  });

  it('scene skips jump to the adjacent scene heading', () => {
    renderView();
    openBar();
    fireEvent.click(screen.getByTestId('msv-reader-play')); // idx 0 (scene 0)
    fireEvent.click(screen.getByTestId('msv-reader-next-scene'));
    expect(spoken[spoken.length - 1].text).toBe('A City in Shadows.');
    fireEvent.click(screen.getByTestId('msv-reader-prev-scene'));
    expect(spoken[spoken.length - 1].text).toBe(
      "Chapter 1. The Quiet Before. The Watcher's Call."
    );
  });

  it('the position scrubber seeks to an utterance index', () => {
    renderView();
    openBar();
    fireEvent.click(screen.getByTestId('msv-reader-play'));
    const pos = screen.getByTestId('msv-reader-pos');
    expect(pos).toHaveAttribute('max', '4');
    fireEvent.change(pos, { target: { value: '4' } });
    expect(spoken[spoken.length - 1].text).toBe('By morning the rumor had teeth.');
    expect(screen.getByTestId('msv-para-s2-b0').className).toContain('msv-para-text--reading');
  });

  it('From cursor starts at the cursor scene; From start rebuilds from the top', () => {
    renderView({ cursor: { zoom: 'chapter', part: 0, chapter: 0, scene: 1 } });
    openBar();
    fireEvent.click(screen.getByTestId('msv-reader-from-cursor'));
    expect(spoken[0].text).toBe('By morning the rumor had teeth.');
    fireEvent.click(screen.getByTestId('msv-reader-from-start'));
    expect(spoken[spoken.length - 1].text).toBe(
      "Chapter 1. The Quiet Before. The Watcher's Call."
    );
  });
});

describe('speed + voice controls', () => {
  it('seeds speed from voice prefs and applies slider changes to the next utterance', () => {
    renderView({ voicePrefs: { ttsRate: 1.2 } });
    openBar();
    expect(screen.getByTestId('msv-reader-rate-readout')).toHaveTextContent('120%');
    fireEvent.change(screen.getByTestId('msv-reader-rate'), { target: { value: '150' } });
    expect(screen.getByTestId('msv-reader-rate-readout')).toHaveTextContent('150%');
    fireEvent.click(screen.getByTestId('msv-reader-play'));
    expect(spoken[0].rate).toBe(1.5);
  });

  it('lists Default + English system voices and applies the selection', () => {
    renderView();
    openBar();
    const select = screen.getByTestId('msv-reader-voice');
    const labels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(labels).toEqual(['Default voice', 'Aria — system']);
    fireEvent.change(select, { target: { value: 'Aria (Natural)' } });
    fireEvent.click(screen.getByTestId('msv-reader-play'));
    expect(spoken[0].voice).toBe(ariaVoice);
  });

  it('seeds the voice from stored prefs and keeps it selectable', () => {
    renderView({ voicePrefs: { ttsVoiceId: 'en_US/vctk_low' } });
    openBar();
    const select = screen.getByTestId('msv-reader-voice') as HTMLSelectElement;
    expect(select.value).toBe('en_US/vctk_low');
    expect(
      Array.from(select.querySelectorAll('option')).some(
        (o) => o.value === 'en_US/vctk_low'
      )
    ).toBe(true);
  });
});

describe('selection-bar Read action', () => {
  function selectText(text: string) {
    const spy = vi
      .spyOn(window, 'getSelection')
      .mockReturnValue({ toString: () => text } as unknown as Selection);
    fireEvent.mouseUp(screen.getByTestId('msv-page'));
    spy.mockRestore();
  }

  it('reads exactly the selection once and dismisses the bar', async () => {
    renderView();
    selectText('rumor had teeth');
    const read = screen.getByTestId('msv-selbar-read');
    expect(read).toBeEnabled();
    fireEvent.click(read);

    expect(screen.queryByTestId('msv-selbar')).toBeNull(); // bar dismissed
    expect(screen.getByTestId('msv-reader-bar')).toBeInTheDocument(); // reader opened
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(spoken[0].text).toBe('rumor had teeth');

    await endUtterance(); // selection flows never auto-advance
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('msv-reader-status')).toHaveTextContent('Paused');
  });

  it('toasts instead of silently failing when no voice path exists', () => {
    delete (window as { speechSynthesis?: unknown }).speechSynthesis;
    renderView();
    selectText('rumor had teeth');
    fireEvent.click(screen.getByTestId('msv-selbar-read'));
    expect(speakMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('msv-selbar')).toBeInTheDocument(); // bar stays
    expect(document.querySelector('[data-testid="ln-toast"]')?.textContent).toContain(
      'Voice unavailable'
    );
  });
});

describe('failure + teardown behavior', () => {
  it('a persistent utterance error streak stops playback instead of racing through', async () => {
    renderView();
    openBar();
    fireEvent.click(screen.getByTestId('msv-reader-play'));
    // Every utterance fails: 1 initial + 2 error-advances, then the reader halts.
    await act(async () => { spoken[0].onerror?.(new Event('error')); });
    await act(async () => { spoken[1].onerror?.(new Event('error')); });
    await act(async () => { spoken[2].onerror?.(new Event('error')); });
    expect(speakMock).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('msv-reader-status')).toHaveTextContent('Paused');
  });

  it('a muted voice session toasts instead of pretending to play', () => {
    renderView({ voicePrefs: { persistentMute: true } });
    openBar();
    fireEvent.click(screen.getByTestId('msv-reader-play'));
    expect(speakMock).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="ln-toast"]')?.textContent).toContain(
      'Voice is muted'
    );
  });

  it('unmounting mid-read cancels the OS utterance', async () => {
    const { unmount } = renderView();
    openBar();
    fireEvent.click(screen.getByTestId('msv-reader-play'));
    await endUtterance();
    cancelMock.mockClear();
    unmount();
    expect(cancelMock).toHaveBeenCalled();
  });
});
