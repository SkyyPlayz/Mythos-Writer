// Beta 3 M11 — comments integration in ManuscriptView: selection bar flow,
// anchored underlines, gutter dock, comments chip, focus-mode override, and
// the agent-action IPC dispatch. (Core M9 behavior is covered in
// ManuscriptView.test.tsx; this file only exercises the comments layer.)

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

const BOOK: ManuscriptCursor = { zoom: 'book', part: 0, chapter: 0, scene: 0 };

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

function mockSelection(text: string) {
  return vi
    .spyOn(window, 'getSelection')
    .mockReturnValue({ toString: () => text } as unknown as Selection);
}

/** Select `text`, comment on it, and return the created comment. */
function addComment(text: string, body: string) {
  const spy = mockSelection(text);
  fireEvent.mouseUp(screen.getByTestId('msv-page'));
  spy.mockRestore();
  fireEvent.change(screen.getByTestId('msv-selbar-input'), { target: { value: body } });
  fireEvent.click(screen.getByTestId('msv-selbar-save'));
  return commentsStore.list('story-1').at(-1);
}

beforeEach(() => {
  commentsStore.reset();
});

afterEach(() => {
  // Unmount BEFORE resetting the store — reset() notifies subscribers, which
  // would otherwise update the still-mounted view outside act().
  cleanup();
  commentsStore.reset();
  delete (window as { api?: unknown }).api;
  document.querySelectorAll('[data-testid="ln-toast"]').forEach((el) => el.remove());
  vi.restoreAllMocks();
});

describe('selection comment bar', () => {
  it('appears on a valid text selection and hides on cancel', () => {
    renderView();
    expect(screen.queryByTestId('msv-selbar')).toBeNull();
    mockSelection('lantern cast a trembling');
    fireEvent.mouseUp(screen.getByTestId('msv-page'));
    expect(screen.getByTestId('msv-selbar')).toBeInTheDocument();
    expect(screen.getByTestId('msv-selbar')).toHaveTextContent('lantern cast a trembling');
    fireEvent.click(screen.getByTestId('msv-selbar-cancel'));
    expect(screen.queryByTestId('msv-selbar')).toBeNull();
  });

  it('ignores selections outside the 4–219 char prototype gate', () => {
    renderView();
    mockSelection('ab');
    fireEvent.mouseUp(screen.getByTestId('msv-page'));
    expect(screen.queryByTestId('msv-selbar')).toBeNull();
    mockSelection('x'.repeat(220));
    fireEvent.mouseUp(screen.getByTestId('msv-page'));
    expect(screen.queryByTestId('msv-selbar')).toBeNull();
  });

  it('creates an anchored comment on the owning scene and toasts', () => {
    renderView();
    const created = addComment('rumor had teeth', 'love this line');
    expect(created).toMatchObject({
      storyId: 'story-1',
      sceneId: 's2',
      anchor: 'rumor had teeth',
      text: 'love this line',
      kind: 'user',
    });
    expect(screen.queryByTestId('msv-selbar')).toBeNull();
    expect(document.querySelector('[data-testid="ln-toast"]')?.textContent).toContain(
      'Comment added'
    );
  });

  it('saves on Enter in the input', () => {
    renderView();
    mockSelection('counted the bells');
    fireEvent.mouseUp(screen.getByTestId('msv-page'));
    const input = screen.getByTestId('msv-selbar-input');
    fireEvent.change(input, { target: { value: 'nice opener' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(commentsStore.list('story-1')).toHaveLength(1);
  });

  it('does nothing without a comment body', () => {
    renderView();
    mockSelection('counted the bells');
    fireEvent.mouseUp(screen.getByTestId('msv-page'));
    fireEvent.click(screen.getByTestId('msv-selbar-save'));
    expect(commentsStore.list('story-1')).toHaveLength(0);
    expect(screen.getByTestId('msv-selbar')).toBeInTheDocument(); // bar stays
  });

  it('rejects selections that span paragraphs (no owning scene) with a toast', () => {
    renderView();
    mockSelection('text that exists nowhere in the story');
    fireEvent.mouseUp(screen.getByTestId('msv-page'));
    fireEvent.change(screen.getByTestId('msv-selbar-input'), { target: { value: 'body' } });
    fireEvent.click(screen.getByTestId('msv-selbar-save'));
    expect(commentsStore.list('story-1')).toHaveLength(0);
    expect(screen.queryByTestId('msv-selbar')).toBeNull();
    expect(document.querySelector('[data-testid="ln-toast"]')?.textContent).toContain(
      'Select text inside a paragraph'
    );
  });

  it('renders the Read action enabled — wired to the M13 reader', () => {
    // (Reader behavior itself is covered in ManuscriptViewReader.test.tsx.)
    renderView();
    mockSelection('counted the bells');
    fireEvent.mouseUp(screen.getByTestId('msv-page'));
    const read = screen.getByTestId('msv-selbar-read');
    expect(read).toBeEnabled();
    expect(read).toHaveAttribute('title', 'Read this selection aloud');
  });
});

describe('gutter dock + anchored underlines', () => {
  it('shows the gutter card and the kind-colored anchor underline', () => {
    renderView();
    const created = addComment('rumor had teeth', 'keep');
    expect(screen.getByTestId('msv-gutter')).toBeInTheDocument();
    expect(screen.getByTestId(`msv-cmt-${created!.id}`)).toHaveTextContent('keep');
    const anchor = screen.getByTestId(`msv-anchor-${created!.id}`);
    expect(anchor).toHaveTextContent('rumor had teeth');
    expect(anchor.className).toContain('msv-anchor--user');
    // Paragraph text is intact around the underline (contentEditable-safe).
    expect(screen.getByTestId('msv-para-s2-b0')).toHaveTextContent(
      'By morning the rumor had teeth.'
    );
  });

  it('orders gutter cards by document position, not creation order', () => {
    renderView();
    const late = addComment('rumor had teeth', 'second scene');
    const early = addComment('Mira counted', 'first scene');
    const cards = screen.getByTestId('msv-gutter').querySelectorAll('.msv-cmt');
    expect(cards[0]).toHaveAttribute('data-testid', `msv-cmt-${early!.id}`);
    expect(cards[1]).toHaveAttribute('data-testid', `msv-cmt-${late!.id}`);
  });

  it('clicking an anchored underline expands its gutter card', () => {
    renderView();
    const created = addComment('another story', 'strong closer');
    const card = screen.getByTestId(`msv-cmt-${created!.id}`);
    expect(card).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByTestId(`msv-anchor-${created!.id}`));
    expect(card).toHaveAttribute('aria-expanded', 'true');
  });

  it('Resolve removes the comment, its card and its underline', () => {
    renderView();
    const created = addComment('another story', 'strong closer');
    fireEvent.click(screen.getByTestId(`msv-cmt-${created!.id}`));
    fireEvent.click(screen.getByTestId(`msv-cmt-resolve-${created!.id}`));
    expect(commentsStore.list('story-1')).toHaveLength(0);
    expect(screen.queryByTestId('msv-gutter')).toBeNull();
    expect(screen.queryByTestId(`msv-anchor-${created!.id}`)).toBeNull();
  });

  it('agent comments created programmatically (the M23 hook) appear live', () => {
    renderView();
    act(() => {
      commentsStore.create({
        storyId: 'story-1',
        sceneId: 's1',
        anchor: 'lantern cast a trembling circle of light',
        text: 'Continuity: oil-lit in Ch. 1 but crystal-lit later.',
        kind: 'archive',
        suggestionId: 'sug-1',
      });
    });
    const card = screen.getByTestId('msv-gutter').querySelector('.msv-cmt');
    expect(card).toHaveTextContent('Archive Agent');
    expect(card?.className).toContain('msv-cmt--archive');
    const anchor = screen.getByTestId(`msv-anchor-${commentsStore.list('story-1')[0].id}`);
    expect(anchor.className).toContain('msv-anchor--archive');
  });
});

describe('agent actions from the gutter', () => {
  it('dispatches archive:confirm and resolves the comment on success', async () => {
    const archiveConfirm = vi.fn().mockResolvedValue({ ok: true });
    Object.defineProperty(window, 'api', {
      value: { archiveConfirm },
      writable: true,
      configurable: true,
    });
    renderView();
    let id = '';
    act(() => {
      id = commentsStore.create({
        storyId: 'story-1',
        sceneId: 's1',
        anchor: 'trembling circle',
        text: 'Continuity flag',
        kind: 'archive',
        suggestionId: 'sug-9',
      }).id;
    });
    fireEvent.click(screen.getByTestId(`msv-cmt-${id}`));
    await act(async () => {
      fireEvent.click(screen.getByTestId(`msv-cmt-act-match_archive-${id}`));
    });
    expect(archiveConfirm).toHaveBeenCalledWith('sug-9', 'match_archive');
    expect(commentsStore.list('story-1')).toHaveLength(0);
    expect(document.querySelector('[data-testid="ln-toast"]')?.textContent).toContain(
      'Note updated to match the story'
    );
  });

  it('keeps the comment and toasts the error when the IPC fails', async () => {
    const archiveConfirm = vi.fn().mockResolvedValue({ error: 'already resolved' });
    Object.defineProperty(window, 'api', {
      value: { archiveConfirm },
      writable: true,
      configurable: true,
    });
    renderView();
    let id = '';
    act(() => {
      id = commentsStore.create({
        storyId: 'story-1',
        sceneId: 's1',
        anchor: 'trembling circle',
        text: 'Continuity flag',
        kind: 'archive',
        suggestionId: 'sug-9',
      }).id;
    });
    fireEvent.click(screen.getByTestId(`msv-cmt-${id}`));
    await act(async () => {
      fireEvent.click(screen.getByTestId(`msv-cmt-act-ignore-${id}`));
    });
    expect(commentsStore.list('story-1')).toHaveLength(1);
    expect(document.querySelector('[data-testid="ln-toast"]')?.textContent).toContain(
      'already resolved'
    );
  });
});

describe('comments chip + focus mode', () => {
  it('the chip shows the live count and toggles visibility', () => {
    renderView();
    const chip = screen.getByTestId('msv-comments-chip');
    expect(chip).toHaveTextContent('0');
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    const created = addComment('rumor had teeth', 'keep');
    expect(chip).toHaveTextContent('1');
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('msv-gutter')).toBeNull();
    expect(screen.queryByTestId(`msv-anchor-${created!.id}`)).toBeNull();
    fireEvent.click(chip);
    expect(screen.getByTestId('msv-gutter')).toBeInTheDocument();
  });

  it('focus mode hides comments unless the Show-in-focus override is on', () => {
    const { unmount } = renderView();
    addComment('rumor had teeth', 'keep');
    unmount();

    renderView({ focusMode: true });
    expect(screen.queryByTestId('msv-gutter')).toBeNull();
    expect(document.querySelectorAll('.msv-anchor')).toHaveLength(0);

    act(() => {
      commentsStore.setCommentsInFocus(true);
    });
    expect(screen.getByTestId('msv-gutter')).toBeInTheDocument();
    expect(document.querySelectorAll('.msv-anchor')).toHaveLength(1);
  });

  it('the expanded card carries the Show-in-focus override toggle', () => {
    renderView();
    const created = addComment('rumor had teeth', 'keep');
    fireEvent.click(screen.getByTestId(`msv-cmt-${created!.id}`));
    const toggle = screen.getByTestId('msv-cmt-focus-toggle');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(commentsStore.uiState().commentsInFocus).toBe(true);
  });
});
