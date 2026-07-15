// Beta 4 M11 — the Book preview's audiobook bar (prototype Book-preview bar
// 849–867): persistent transport under the compiled pages, book-scoped flow,
// paragraph wash + sentence highlight while reading. Playback runs on the OS
// speechSynthesis path, mocked like the useTtsPlayer unit tests.
//
// M14 (#939) moved the Book view from DesktopShell's FullBookPreviewView into
// story/BookPreview.tsx; this suite (formerly FullBookPreview.test.tsx) keeps
// every M11 behavioral assertion (#938) retargeted onto BookPreview.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Block, Chapter, Scene, Story } from '../types';
import BookPreview from './BookPreview';
import { READING_HIGHLIGHT_NAME } from './readerHighlight';

const NOW = '2026-07-07T00:00:00.000Z';

function mkBlock(id: string, content: string, order: number): Block {
  return { id, type: 'prose', content, order, updatedAt: NOW };
}

function mkScene(id: string, title: string, order: number, paras: string[]): Scene {
  return {
    id,
    title,
    path: `scenes/${id}.md`,
    order,
    blocks: paras.map((p, i) => mkBlock(`${id}-b${i}`, p, i)),
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
        mkScene('s1', "The Watcher's Call", 0, ['Mira counted the bells. The lantern trembled.']),
      ]),
    ],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function renderPreview(story: Story | null) {
  return render(<BookPreview story={story} pageWidth={1000} onExport={() => {}} />);
}

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
    getVoices: () => [],
  };
  (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = MockUtterance;
  (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = MockUtterance;
}

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

beforeEach(() => {
  vi.clearAllMocks();
  spoken = [];
  stubSpeech();
});

afterEach(() => {
  cleanup();
  document.querySelector('[data-testid="ln-toast"]')?.remove();
  const g = globalThis as { CSS?: unknown; Highlight?: unknown };
  delete g.CSS;
  delete g.Highlight;
  delete (window as { speechSynthesis?: unknown }).speechSynthesis;
  vi.restoreAllMocks();
});

describe('BookPreview audiobook bar (M11)', () => {
  it('shows the persistent bar with transport, speed, voice and From start', () => {
    renderPreview(mkStory());
    const bar = screen.getByTestId('msv-reader-bar');
    expect(bar).toBeInTheDocument();
    expect(screen.getByTestId('msv-reader-play')).toBeInTheDocument();
    expect(screen.getByTestId('msv-reader-prev-scene')).toBeInTheDocument();
    expect(screen.getByTestId('msv-reader-next-scene')).toBeInTheDocument();
    expect(screen.getByTestId('msv-reader-back')).toBeInTheDocument();
    expect(screen.getByTestId('msv-reader-fwd')).toBeInTheDocument();
    expect(screen.getByTestId('msv-reader-rate')).toBeInTheDocument();
    expect(screen.getByTestId('msv-reader-voice')).toBeInTheDocument();
    expect(screen.getByTestId('msv-reader-from-start')).toBeInTheDocument();
    expect(screen.getByTestId('msv-reader-status')).toHaveTextContent('Ready');
  });

  it('coexists with the M14 compiled header (READ-ONLY chip + Export…)', () => {
    renderPreview(mkStory());
    expect(screen.getByTestId('msv-reader-bar')).toBeInTheDocument();
    expect(screen.getByText('READ-ONLY')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export…/i })).toBeInTheDocument();
  });

  it('renders no bar without a story (empty state)', () => {
    renderPreview(null);
    expect(screen.queryByTestId('msv-reader-bar')).toBeNull();
  });

  it('keeps the bar on a book with nothing to read — play is a guarded no-op with a toast', () => {
    const story = mkStory();
    story.chapters = [mkChapter('ch1', 'The Quiet Before', 0, [])];
    renderPreview(story);
    expect(screen.getByTestId('msv-reader-bar')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('msv-reader-play'));
    expect(speakMock).not.toHaveBeenCalled();
    // GH#946: the refusal names the real cause (empty book), not the voice.
    expect(screen.getByTestId('ln-toast')).toHaveTextContent(
      'Nothing to read yet — this book has no scenes with prose'
    );
    expect(screen.getByTestId('msv-reader-status')).toHaveTextContent('Ready');
  });

  it('play reads the whole book from the top and highlights the sentence', async () => {
    const store = stubHighlightApi();
    renderPreview(mkStory());
    fireEvent.click(screen.getByTestId('msv-reader-play'));
    expect(spoken[0].text).toBe("Chapter 1. The Quiet Before. The Watcher's Call.");

    await act(async () => { spoken[0].onend?.(new Event('end')); });
    expect(spoken[1].text).toBe('Mira counted the bells.');
    // Paragraph wash on the preview block…
    const block = document.querySelector('[data-fbp-block="s1-b0"]');
    expect(block?.className).toContain('book-preview__para--reading');
    // …and the exact sentence painted through the Highlight API.
    const hl = store.get(READING_HIGHLIGHT_NAME);
    expect(hl).toBeInstanceOf(FakeHighlight);
    expect(hl!.ranges[0].toString()).toBe('Mira counted the bells.');
  });

  it('pause clears the wash and the sentence highlight', async () => {
    const store = stubHighlightApi();
    renderPreview(mkStory());
    const play = screen.getByTestId('msv-reader-play');
    fireEvent.click(play);
    await act(async () => { spoken[0].onend?.(new Event('end')); });
    expect(store.has(READING_HIGHLIGHT_NAME)).toBe(true);

    fireEvent.click(play); // pause
    expect(cancelMock).toHaveBeenCalled();
    expect(store.has(READING_HIGHLIGHT_NAME)).toBe(false);
    expect(
      document.querySelector('.book-preview__para--reading')
    ).toBeNull();
    expect(screen.getByTestId('msv-reader-status')).toHaveTextContent('Paused');
  });
});
