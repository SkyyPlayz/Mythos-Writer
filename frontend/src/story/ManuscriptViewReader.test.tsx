// Beta 4 M11 — TTS reader integration in ManuscriptView: the toolbar Read
// button + right-gutter Reader card (docks above comments, centers when
// they're hidden), the sentence-level moving highlight, ±10s/scene/speed/
// voice controls, selection-bar Read, and the muted/unavailable fallbacks.
// Playback runs on the OS speechSynthesis path of the existing useTtsPlayer
// stack, mocked the same way as its unit tests (utterances captured;
// boundaries simulated by firing onend/onerror).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Block, Chapter, DraftState, Scene, Story } from '../types';
import ManuscriptView from './ManuscriptView';
import { commentsStore } from '../comments';
import { READING_HIGHLIGHT_NAME } from './readerHighlight';
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

// M11 sentence-level flow at book zoom:
//   0 heading ch1/s1
//   1 "Mira counted the bells."                              (s1-b0, 0–23)
//   2 "The lantern cast a trembling circle of light."        (s1-b0, 24–70)
//   3 "Getting out would be another story."                  (s1-b1)
//   4 heading s2
//   5 "By morning the rumor had teeth."                      (s2-b0)
const FLOW_LEN = 6;
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

/** jsdom has no CSS Custom Highlight API — stub a registry for M11 asserts. */
class FakeHighlight {
  ranges: Range[];
  constructor(...ranges: Range[]) { this.ranges = ranges; }
}

function stubHighlightApi() {
  const store = new Map<string, FakeHighlight>();
  const g = globalThis as { CSS?: unknown; Highlight?: unknown };
  g.CSS = {
    highlights: {
      set: (name: string, hl: FakeHighlight) => store.set(name, hl),
      delete: (name: string) => store.delete(name),
    },
  };
  g.Highlight = FakeHighlight;
  return store;
}

function unstubHighlightApi() {
  const g = globalThis as { CSS?: unknown; Highlight?: unknown };
  delete g.CSS;
  delete g.Highlight;
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

// W0.4: the single Read button lives on the format toolbar (msv-tb-read);
// M11 docks the Reader as a card in the right gutter.
function openCard() {
  fireEvent.click(screen.getByTestId('msv-tb-read'));
  return screen.getByTestId('msv-reader-card');
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
  unstubHighlightApi();
  delete (window as { api?: unknown }).api;
  delete (window as { speechSynthesis?: unknown }).speechSynthesis;
  document.querySelectorAll('[data-testid="ln-toast"]').forEach((el) => el.remove());
  vi.restoreAllMocks();
});

describe('toolbar Read button + gutter Reader card', () => {
  it('the Read button opens the card in the gutter (Ready) and close hides it', () => {
    renderView();
    expect(screen.queryByTestId('msv-reader-card')).toBeNull();
    expect(screen.queryByTestId('msv-gutter')).toBeNull();
    const read = screen.getByTestId('msv-tb-read');
    expect(read).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(read);
    const card = screen.getByTestId('msv-reader-card');
    expect(screen.getByTestId('msv-gutter')).toContainElement(card);
    expect(read).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('msv-reader-status')).toHaveTextContent('Ready');
    fireEvent.click(screen.getByTestId('msv-reader-close'));
    expect(screen.queryByTestId('msv-reader-card')).toBeNull();
    expect(screen.queryByTestId('msv-gutter')).toBeNull();
  });

  it('the play button reflects playing state via aria-pressed', () => {
    renderView();
    openCard();
    const play = screen.getByTestId('msv-reader-play');
    expect(play).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(play);
    expect(play).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(play);
    expect(play).toHaveAttribute('aria-pressed', 'false');
  });

  it('transport buttons carry accessible names', () => {
    renderView();
    openCard();
    expect(screen.getByTestId('msv-reader-prev-scene')).toHaveAttribute('aria-label', 'Previous scene');
    expect(screen.getByTestId('msv-reader-back')).toHaveAttribute('aria-label', 'Back 10 seconds');
    expect(screen.getByTestId('msv-reader-fwd')).toHaveAttribute('aria-label', 'Forward 10 seconds');
    expect(screen.getByTestId('msv-reader-next-scene')).toHaveAttribute('aria-label', 'Next scene');
  });

  it('Escape closes the Reader card', () => {
    renderView();
    openCard();
    expect(screen.getByTestId('msv-reader-card')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId('msv-reader-card'), { key: 'Escape' });
    expect(screen.queryByTestId('msv-reader-card')).toBeNull();
  });

  it('centers the card when no comments are visible (prototype gutterSt)', () => {
    renderView();
    openCard();
    expect(screen.getByTestId('msv-gutter').className).toContain('msv-gutter--center');
    expect(screen.queryByText('COMMENTS')).toBeNull();
  });

  it('docks the card above the comment cards when comments are visible', () => {
    renderView();
    // Create a user comment through the selection bar.
    const spy = vi
      .spyOn(window, 'getSelection')
      .mockReturnValue({ toString: () => 'rumor had teeth' } as unknown as Selection);
    fireEvent.mouseUp(screen.getByTestId('msv-page'));
    spy.mockRestore();
    fireEvent.change(screen.getByTestId('msv-selbar-input'), { target: { value: 'note' } });
    fireEvent.click(screen.getByTestId('msv-selbar-save'));

    openCard();
    const gutter = screen.getByTestId('msv-gutter');
    expect(gutter.className).not.toContain('msv-gutter--center');
    // DOM order: Reader card first, then the COMMENTS section (prototype 1154).
    const card = screen.getByTestId('msv-reader-card');
    const title = screen.getByText('COMMENTS');
    expect(card.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('play at book zoom reads from the start: chapter heading first', () => {
    renderView();
    openCard();
    fireEvent.click(screen.getByTestId('msv-reader-play'));
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(spoken[0].text).toBe("Chapter 1. The Quiet Before. The Watcher's Call.");
    expect(screen.getByTestId('msv-reader-status')).toHaveTextContent(`Reading 1 of ${FLOW_LEN}`);
    // Headings have no paragraph to highlight.
    expect(document.querySelectorAll('.msv-para-text--reading')).toHaveLength(0);
  });

  it('reaching the end of the flow stops playback and clears the highlight', async () => {
    renderView();
    openCard();
    fireEvent.click(screen.getByTestId('msv-reader-play'));
    for (let i = 0; i < FLOW_LEN; i++) await endUtterance();
    expect(speakMock).toHaveBeenCalledTimes(FLOW_LEN);
    expect(screen.getByTestId('msv-reader-status')).toHaveTextContent('Paused');
    expect(document.querySelectorAll('.msv-para-text--reading')).toHaveLength(0);
  });

  it('pause cancels speech and resume replays the current utterance', async () => {
    renderView();
    openCard();
    const play = screen.getByTestId('msv-reader-play');
    fireEvent.click(play);
    await endUtterance(); // now reading sentence 1 (idx 1)

    fireEvent.click(play); // pause
    expect(cancelMock).toHaveBeenCalled();
    expect(screen.getByTestId('msv-reader-status')).toHaveTextContent('Paused');
    expect(document.querySelectorAll('.msv-para-text--reading')).toHaveLength(0);

    fireEvent.click(play); // resume — same utterance, not a rebuilt flow
    expect(spoken[spoken.length - 1].text).toBe(spoken[1].text);
    expect(screen.getByTestId('msv-para-s1-b0').className).toContain('msv-para-text--reading');
  });
});

describe('sentence highlight (M11 §5.1)', () => {
  it('utterances advance sentence by sentence; the block wash follows the block', async () => {
    renderView();
    openCard();
    fireEvent.click(screen.getByTestId('msv-reader-play'));

    await endUtterance(); // heading done → first sentence of s1-b0
    expect(spoken[1].text).toBe('Mira counted the bells.');
    expect(screen.getByTestId('msv-para-s1-b0').className).toContain('msv-para-text--reading');
    expect(screen.getByTestId('msv-reader-status')).toHaveTextContent(`Reading 2 of ${FLOW_LEN}`);

    await endUtterance(); // second sentence — SAME paragraph stays washed
    expect(spoken[2].text).toBe('The lantern cast a trembling circle of light.');
    expect(screen.getByTestId('msv-para-s1-b0').className).toContain('msv-para-text--reading');

    await endUtterance(); // next paragraph — wash moves
    expect(spoken[3].text).toBe('Getting out would be another story.');
    expect(screen.getByTestId('msv-para-s1-b0').className).not.toContain('msv-para-text--reading');
    expect(screen.getByTestId('msv-para-s1-b1').className).toContain('msv-para-text--reading');
  });

  it('paints the exact sentence via the CSS Custom Highlight API', async () => {
    const store = stubHighlightApi();
    renderView();
    openCard();
    fireEvent.click(screen.getByTestId('msv-reader-play'));
    expect(store.has(READING_HIGHLIGHT_NAME)).toBe(false); // heading — nothing to paint

    await endUtterance(); // → "Mira counted the bells." (offsets 0–23 in s1-b0)
    const first = store.get(READING_HIGHLIGHT_NAME);
    expect(first).toBeInstanceOf(FakeHighlight);
    expect(first!.ranges[0].toString()).toBe('Mira counted the bells.');

    await endUtterance(); // → second sentence of the same block
    const second = store.get(READING_HIGHLIGHT_NAME);
    expect(second!.ranges[0].toString()).toBe(
      'The lantern cast a trembling circle of light.'
    );
  });

  it('clears the sentence highlight when playback pauses', async () => {
    const store = stubHighlightApi();
    renderView();
    openCard();
    const play = screen.getByTestId('msv-reader-play');
    fireEvent.click(play);
    await endUtterance();
    expect(store.has(READING_HIGHLIGHT_NAME)).toBe(true);
    fireEvent.click(play); // pause
    expect(store.has(READING_HIGHLIGHT_NAME)).toBe(false);
  });
});

describe('skips and scene jumps', () => {
  it('±10s buttons skip by estimated speech time across sentences', () => {
    renderView();
    openCard();
    fireEvent.click(screen.getByTestId('msv-reader-play')); // idx 0
    // ~10s forward at 3.2 w/s crosses the whole first scene (≈9.4s) and lands
    // on the last sentence.
    fireEvent.click(screen.getByTestId('msv-reader-fwd'));
    expect(spoken[spoken.length - 1].text).toBe('By morning the rumor had teeth.');
    fireEvent.click(screen.getByTestId('msv-reader-back'));
    expect(spoken[spoken.length - 1].text).toBe(
      "Chapter 1. The Quiet Before. The Watcher's Call."
    );
  });

  it('scene skips jump to the adjacent scene heading', () => {
    renderView();
    openCard();
    fireEvent.click(screen.getByTestId('msv-reader-play')); // idx 0 (scene 0)
    fireEvent.click(screen.getByTestId('msv-reader-next-scene'));
    expect(spoken[spoken.length - 1].text).toBe('A City in Shadows.');
    fireEvent.click(screen.getByTestId('msv-reader-prev-scene'));
    expect(spoken[spoken.length - 1].text).toBe(
      "Chapter 1. The Quiet Before. The Watcher's Call."
    );
  });

  it('From cursor starts at the cursor scene; From start rebuilds from the top', () => {
    renderView({ cursor: { zoom: 'chapter', part: 0, chapter: 0, scene: 1 } });
    openCard();
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
    openCard();
    expect(screen.getByTestId('msv-reader-rate-readout')).toHaveTextContent('120%');
    fireEvent.change(screen.getByTestId('msv-reader-rate'), { target: { value: '150' } });
    expect(screen.getByTestId('msv-reader-rate-readout')).toHaveTextContent('150%');
    fireEvent.click(screen.getByTestId('msv-reader-play'));
    expect(spoken[0].rate).toBe(1.5);
  });

  it('lists Default + OS voices (naturals labeled) + offline catalog entries', () => {
    renderView();
    openCard();
    const select = screen.getByTestId('msv-reader-voice');
    const labels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(labels[0]).toBe('Default voice');
    expect(labels[1]).toBe('Aria — Edge natural'); // 'Aria (Natural)' detected
    expect(labels).toContain('Amy — Piper (offline)');
    expect(labels).toContain('Nicole — Kokoro (offline)');
  });

  it('applies a real OS voice selection to the next utterance', () => {
    renderView();
    openCard();
    fireEvent.change(screen.getByTestId('msv-reader-voice'), {
      target: { value: 'Aria (Natural)' },
    });
    fireEvent.click(screen.getByTestId('msv-reader-play'));
    expect(spoken[0].voice).toBe(ariaVoice);
  });

  it('catalog picks explain themselves and fall back to the default voice (§1.2)', () => {
    renderView();
    openCard();
    const select = screen.getByTestId('msv-reader-voice') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'piper:amy' } });
    expect(select.value).toBe('piper:amy'); // pick sticks — not dead
    expect(document.querySelector('[data-testid="ln-toast"]')?.textContent).toContain(
      'Settings → Voice'
    );
    fireEvent.click(screen.getByTestId('msv-reader-play'));
    expect(speakMock).toHaveBeenCalledTimes(1); // still reads…
    expect(spoken[0].voice).toBeNull(); // …with the default voice
  });

  it('seeds the voice from stored prefs and keeps it selectable', () => {
    renderView({ voicePrefs: { ttsVoiceId: 'en_US/vctk_low' } });
    openCard();
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
    expect(screen.getByTestId('msv-reader-card')).toBeInTheDocument(); // reader opened
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
    openCard();
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
    openCard();
    fireEvent.click(screen.getByTestId('msv-reader-play'));
    expect(speakMock).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="ln-toast"]')?.textContent).toContain(
      'Voice is muted'
    );
  });

  it('unmounting mid-read cancels the OS utterance', async () => {
    const { unmount } = renderView();
    openCard();
    fireEvent.click(screen.getByTestId('msv-reader-play'));
    await endUtterance();
    cancelMock.mockClear();
    unmount();
    expect(cancelMock).toHaveBeenCalled();
  });
});
