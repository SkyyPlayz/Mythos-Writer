// Beta 4 M9 — CommentsGutter component: card rendering, expand/collapse,
// the v2 compact action row (archive "Edit notes" / "Suggest change" +
// Resolve — prototype 1193–1200), and agent-action availability tiers.
// The full-label actions + Show-in-focus toggle live on CommentOpenCard.

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import CommentsGutter from './CommentsGutter';
import type { StoryComment } from '../comments';

const NOW = '2026-07-07T00:00:00.000Z';

function mkComment(id: string, over: Partial<StoryComment> = {}): StoryComment {
  return {
    id,
    storyId: 'story-1',
    sceneId: 's1',
    anchor: 'the lantern cast a trembling circle of light over it',
    author: 'You',
    kind: 'user',
    text: `body of ${id}`,
    createdAt: NOW,
    ...over,
  };
}

function makeProps(comments: StoryComment[], over: Record<string, unknown> = {}) {
  return {
    comments,
    openId: null as string | null,
    onToggleOpen: vi.fn(),
    onResolve: vi.fn(),
    onAgentAction: vi.fn(),
    ...over,
  };
}

describe('CommentsGutter', () => {
  it('renders nothing without comments', () => {
    render(<CommentsGutter {...makeProps([])} />);
    expect(screen.queryByTestId('msv-gutter')).toBeNull();
  });

  it('renders the dock title, one card per comment in given order, and the hint', () => {
    render(<CommentsGutter {...makeProps([mkComment('c1'), mkComment('c2', { kind: 'archive', author: 'Archive Agent' })])} />);
    const gutter = screen.getByTestId('msv-gutter');
    expect(gutter).toHaveTextContent('COMMENTS');
    const cards = gutter.querySelectorAll('.msv-cmt');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute('data-testid', 'msv-cmt-c1');
    expect(cards[1]).toHaveAttribute('data-testid', 'msv-cmt-c2');
    expect(gutter).toHaveTextContent('Select text in the page to add one.');
  });

  it('clips the anchor at 34 chars and shows author + body', () => {
    render(<CommentsGutter {...makeProps([mkComment('c1')])} />);
    const card = screen.getByTestId('msv-cmt-c1');
    expect(card).toHaveTextContent('You');
    expect(card).toHaveTextContent('body of c1');
    expect(card).toHaveTextContent(`on “${'the lantern cast a trembling circle of light over it'.slice(0, 34)}…”`);
  });

  it('toggles open on click and on Enter/Space', () => {
    const props = makeProps([mkComment('c1')]);
    render(<CommentsGutter {...props} />);
    const card = screen.getByTestId('msv-cmt-c1');
    expect(card).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(card);
    expect(props.onToggleOpen).toHaveBeenCalledWith('c1');
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    expect(props.onToggleOpen).toHaveBeenCalledTimes(3);
  });

  it('collapsed cards hide the action rows', () => {
    render(<CommentsGutter {...makeProps([mkComment('c1', { kind: 'archive', suggestionId: 'sug-1' })])} />);
    expect(screen.queryByTestId('msv-cmt-resolve-c1')).toBeNull();
    expect(screen.queryByTestId('msv-cmt-act-match_archive-c1')).toBeNull();
  });

  it('user comments expand with Resolve but no agent-action row', () => {
    const props = makeProps([mkComment('c1')], { openId: 'c1' });
    render(<CommentsGutter {...props} />);
    expect(screen.getByTestId('msv-cmt-resolve-c1')).toBeInTheDocument();
    expect(screen.queryByTestId('msv-cmt-act-match_archive-c1')).toBeNull();
  });

  it('archive comments with a suggestion expose the 2 live compact actions (v2 labels)', () => {
    const comment = mkComment('c1', { kind: 'archive', suggestionId: 'sug-1' });
    const props = makeProps([comment], { openId: 'c1' });
    render(<CommentsGutter {...props} />);
    const edit = screen.getByTestId('msv-cmt-act-match_archive-c1');
    const suggest = screen.getByTestId('msv-cmt-act-suggest_story_change-c1');
    expect(edit).toBeEnabled();
    expect(edit).toHaveTextContent('Edit notes');
    expect(suggest).toBeEnabled();
    expect(suggest).toHaveTextContent('Suggest change');
    // v2 prototype gutter (1193–1198): no Ignore in the compact row — it lives
    // on the open comment card only.
    expect(screen.queryByTestId('msv-cmt-act-ignore-c1')).toBeNull();
    fireEvent.click(suggest);
    expect(props.onAgentAction).toHaveBeenCalledWith(comment, 'suggest_story_change');
    expect(props.onToggleOpen).not.toHaveBeenCalled(); // stopPropagation
  });

  it('archive comments without a suggestion render the actions as disabled affordances', () => {
    const props = makeProps([mkComment('c1', { kind: 'archive' })], { openId: 'c1' });
    render(<CommentsGutter {...props} />);
    const edit = screen.getByTestId('msv-cmt-act-match_archive-c1');
    expect(edit).toBeDisabled();
    expect(edit).toHaveAttribute('title', expect.stringContaining('links a suggestion'));
    fireEvent.click(edit);
    expect(props.onAgentAction).not.toHaveBeenCalled();
  });

  it('Resolve fires without toggling the card', () => {
    const comment = mkComment('c1');
    const props = makeProps([comment], { openId: 'c1' });
    render(<CommentsGutter {...props} />);
    fireEvent.click(screen.getByTestId('msv-cmt-resolve-c1'));
    expect(props.onResolve).toHaveBeenCalledWith(comment);
    expect(props.onToggleOpen).not.toHaveBeenCalled();
  });
});

describe('CommentsGutter — M11 reader slot', () => {
  const readerSlot = <div data-testid="fake-reader-card">reader</div>;

  it('renders the gutter for a reader slot alone, centered, without COMMENTS chrome', () => {
    render(<CommentsGutter {...makeProps([])} readerSlot={readerSlot} />);
    const gutter = screen.getByTestId('msv-gutter');
    expect(gutter.className).toContain('msv-gutter--center');
    expect(screen.getByTestId('fake-reader-card')).toBeInTheDocument();
    expect(screen.queryByText('COMMENTS')).toBeNull();
  });

  it('docks the reader slot above the comment cards (prototype 1154 order)', () => {
    render(<CommentsGutter {...makeProps([mkComment('c1')])} readerSlot={readerSlot} />);
    const gutter = screen.getByTestId('msv-gutter');
    expect(gutter.className).not.toContain('msv-gutter--center');
    const card = screen.getByTestId('fake-reader-card');
    const title = screen.getByText('COMMENTS');
    expect(card.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('msv-cmt-c1')).toBeInTheDocument();
  });

  it('still renders nothing with neither comments nor a reader slot', () => {
    render(<CommentsGutter {...makeProps([])} readerSlot={null} />);
    expect(screen.queryByTestId('msv-gutter')).toBeNull();
  });
});
