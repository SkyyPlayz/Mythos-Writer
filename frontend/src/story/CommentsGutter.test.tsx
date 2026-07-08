// Beta 3 M11 — CommentsGutter component: card rendering, expand/collapse,
// agent-action availability tiers, resolve, and the Show-in-focus toggle.

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
    commentsInFocus: false,
    onToggleCommentsInFocus: vi.fn(),
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

  it('archive comments with a suggestion expose the 3 live actions', () => {
    const comment = mkComment('c1', { kind: 'archive', suggestionId: 'sug-1' });
    const props = makeProps([comment], { openId: 'c1' });
    render(<CommentsGutter {...props} />);
    const edit = screen.getByTestId('msv-cmt-act-match_archive-c1');
    const suggest = screen.getByTestId('msv-cmt-act-suggest_story_change-c1');
    const ignore = screen.getByTestId('msv-cmt-act-ignore-c1');
    expect(edit).toBeEnabled();
    expect(edit).toHaveTextContent('Edit notes to match');
    expect(suggest).toBeEnabled();
    expect(suggest).toHaveTextContent('Suggest story change');
    expect(ignore).toBeEnabled();
    fireEvent.click(suggest);
    expect(props.onAgentAction).toHaveBeenCalledWith(comment, 'suggest_story_change');
    expect(props.onToggleOpen).not.toHaveBeenCalled(); // stopPropagation
  });

  it('archive comments without a suggestion render the actions as disabled M23 affordances', () => {
    const props = makeProps([mkComment('c1', { kind: 'archive' })], { openId: 'c1' });
    render(<CommentsGutter {...props} />);
    const edit = screen.getByTestId('msv-cmt-act-match_archive-c1');
    expect(edit).toBeDisabled();
    expect(edit).toHaveAttribute('title', expect.stringContaining('M23'));
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

  it('the Show-in-focus switch reflects state and fires the toggle', () => {
    const props = makeProps([mkComment('c1')], { openId: 'c1', commentsInFocus: true });
    render(<CommentsGutter {...props} />);
    const toggle = screen.getByTestId('msv-cmt-focus-toggle');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    expect(props.onToggleCommentsInFocus).toHaveBeenCalledTimes(1);
    expect(props.onToggleOpen).not.toHaveBeenCalled();
  });
});
