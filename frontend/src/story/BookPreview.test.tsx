// Beta 4 M14 — Book view unit tests (FULL-SPEC §5.5).

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import BookPreview, { formatBookMeta } from './BookPreview';
import { commentsStore } from '../comments';
import type { Story } from '../types';

function makeStory(over: Partial<Story> = {}): Story {
  return {
    id: 'st1',
    title: 'The Last City',
    path: 'stories/st1',
    synopsis: 'A city sinks; a smuggler rises.',
    createdAt: '',
    updatedAt: '',
    chapters: [
      {
        id: 'ch1',
        title: 'The Descent',
        path: 'stories/st1/ch1',
        order: 0,
        createdAt: '',
        updatedAt: '',
        scenes: [
          {
            id: 'sc1',
            title: 'The Watcher',
            path: 'stories/st1/ch1/sc1.md',
            order: 0,
            blocks: [
              { id: 'b1', type: 'prose', content: 'The lantern flickered over the drowned street.', order: 0, updatedAt: '' },
            ],
            createdAt: '',
            updatedAt: '',
          },
          {
            id: 'sc2',
            title: 'Undercity',
            path: 'stories/st1/ch1/sc2.md',
            order: 1,
            blocks: [
              { id: 'b2', type: 'prose', content: 'Deeper still they went.', order: 0, updatedAt: '' },
            ],
            createdAt: '',
            updatedAt: '',
          },
        ],
      },
    ],
    ...over,
  };
}

beforeEach(() => {
  commentsStore.reset();
});

afterEach(() => {
  // Unmount BEFORE resetting the store — reset() notifies subscribers, which
  // would otherwise update the still-mounted view outside act().
  cleanup();
  commentsStore.reset();
});

describe('formatBookMeta', () => {
  it('formats short reads in minutes and long reads in hours', () => {
    expect(formatBookMeta(238)).toBe('238 words · ~1 min read');
    expect(formatBookMeta(100_000)).toBe('100,000 words · ~7.0 hr read');
    expect(formatBookMeta(0)).toBe('0 words · <1 min read');
  });
});

describe('BookPreview', () => {
  it('renders empty states without a story or chapters', () => {
    const { rerender } = render(
      <BookPreview story={null} pageWidth={1000} onExport={() => {}} />,
    );
    expect(screen.getByText('No story selected')).toBeInTheDocument();

    rerender(
      <BookPreview story={makeStory({ chapters: [] })} pageWidth={1000} onExport={() => {}} />,
    );
    expect(screen.getByText(/No chapters yet/)).toBeInTheDocument();
  });

  it('renders the compiled header: READ-ONLY badge, word meta and Export…', () => {
    render(<BookPreview story={makeStory()} pageWidth={1000} onExport={() => {}} />);

    expect(screen.getByText('READ-ONLY')).toBeInTheDocument();
    expect(screen.getByText(/Compiled just now · 11 words/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export…/i })).toBeInTheDocument();
  });

  it('Export… opens the export modal via onExport', () => {
    const onExport = vi.fn();
    render(<BookPreview story={makeStory()} pageWidth={1000} onExport={onExport} />);
    fireEvent.click(screen.getByRole('button', { name: /export…/i }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('page width follows the editor pageW setting (bookWrapSt)', () => {
    const { container } = render(
      <BookPreview story={makeStory()} pageWidth={1234} onExport={() => {}} />,
    );
    const page = container.querySelector('.book-preview__page') as HTMLElement;
    expect(page.style.maxWidth).toBe('1234px');
  });

  it('compiles chapter kicker, prose, ◆ ◆ ◆ separators and END OF DRAFT', () => {
    render(<BookPreview story={makeStory()} pageWidth={1000} onExport={() => {}} />);

    expect(screen.getByText('CHAPTER 1')).toBeInTheDocument();
    expect(screen.getByText('The Descent')).toBeInTheDocument();
    expect(screen.getByText(/lantern flickered/)).toBeInTheDocument();
    expect(screen.getByText('◆ ◆ ◆')).toBeInTheDocument(); // between sc1 and sc2 only
    expect(screen.getByText('— END OF DRAFT —')).toBeInTheDocument();
  });

  it('names each compiled scene article for assistive tech (GH#946, CF-7)', () => {
    render(<BookPreview story={makeStory()} pageWidth={1000} onExport={() => {}} />);

    // The compiled book shows no per-scene titles (v2 prototype), so the
    // <article> landmarks carry positional aria-labels instead.
    expect(screen.getByRole('article', { name: 'Scene 1 of The Descent' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Scene 2 of The Descent' })).toBeInTheDocument();
  });

  it('underlines comment anchors and opens a read-only comment card on click', () => {
    const story = makeStory();
    const created = commentsStore.create({
      storyId: story.id,
      sceneId: 'sc1',
      anchor: 'lantern flickered',
      text: 'Love this image.',
      kind: 'user',
    });

    const onOpenScene = vi.fn();
    render(
      <BookPreview story={story} pageWidth={1000} onExport={() => {}} onOpenScene={onOpenScene} />,
    );

    const anchor = screen.getByTestId(`book-anchor-${created.id}`);
    expect(anchor).toHaveClass('book-anchor--user');
    fireEvent.click(anchor);

    expect(screen.getByText('Love this image.')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /open in editor/i }));
    expect(onOpenScene).toHaveBeenCalledWith('sc1');
  });

  it('comment anchors on OTHER scenes do not leak into a scene', () => {
    const story = makeStory();
    commentsStore.create({
      storyId: story.id,
      sceneId: 'sc2',
      anchor: 'lantern flickered', // text exists in sc1, comment belongs to sc2
      text: 'Wrong scene.',
      kind: 'archive',
    });

    render(<BookPreview story={story} pageWidth={1000} onExport={() => {}} />);
    expect(document.querySelector('.book-anchor')).toBeNull();
  });
});
