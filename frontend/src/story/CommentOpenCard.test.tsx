// Beta 4 M9 — CommentOpenCard: the v2 prototype open comment card (cOpenData
// 1063–1085): kind chip labels, 60-char anchor clip, the three full-label
// archive actions with availability tiers, Resolve, and Show-in-focus.

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import CommentOpenCard from './CommentOpenCard';
import type { StoryComment } from '../comments';

const NOW = '2026-07-14T00:00:00.000Z';
const LONG_ANCHOR =
  'the lantern cast a trembling circle of light over the drowned stone stairway below';

function mkComment(over: Partial<StoryComment> = {}): StoryComment {
  return {
    id: 'c1',
    storyId: 'story-1',
    sceneId: 's1',
    anchor: LONG_ANCHOR,
    author: 'You',
    kind: 'user',
    text: 'Love this beat — keep.',
    createdAt: NOW,
    ...over,
  };
}

function makeProps(comment: StoryComment, over: Record<string, unknown> = {}) {
  return {
    comment,
    onClose: vi.fn(),
    onResolve: vi.fn(),
    onAgentAction: vi.fn(),
    commentsInFocus: false,
    onToggleCommentsInFocus: vi.fn(),
    ...over,
  };
}

describe('CommentOpenCard', () => {
  it('shows the kind chip label, the 60-char clipped anchor, and the body', () => {
    render(<CommentOpenCard {...makeProps(mkComment())} />);
    const card = screen.getByTestId('msv-copen');
    expect(card.className).toContain('msv-copen--user');
    expect(screen.getByTestId('msv-copen-chip')).toHaveTextContent('Comment');
    expect(card).toHaveTextContent(`on “${LONG_ANCHOR.slice(0, 60)}…”`);
    expect(card).toHaveTextContent('Love this beat — keep.');
  });

  it('labels agent kinds per the v2 kMeta (Writing Coach / Archive Agent — continuity)', () => {
    const { unmount } = render(
      <CommentOpenCard {...makeProps(mkComment({ kind: 'writing', author: 'Writing Coach' }))} />
    );
    expect(screen.getByTestId('msv-copen-chip')).toHaveTextContent('Writing Coach');
    expect(screen.getByTestId('msv-copen').className).toContain('msv-copen--writing');
    unmount();
    render(
      <CommentOpenCard {...makeProps(mkComment({ kind: 'archive', author: 'Archive Agent' }))} />
    );
    expect(screen.getByTestId('msv-copen-chip')).toHaveTextContent('Archive Agent — continuity');
    expect(screen.getByTestId('msv-copen').className).toContain('msv-copen--archive');
  });

  it('close button fires onClose', () => {
    const props = makeProps(mkComment());
    render(<CommentOpenCard {...props} />);
    fireEvent.click(screen.getByTestId('msv-copen-close'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('user comments carry no agent-action row, only Resolve + focus toggle', () => {
    render(<CommentOpenCard {...makeProps(mkComment())} />);
    expect(screen.queryByTestId('msv-copen-act-match_archive')).toBeNull();
    expect(screen.getByTestId('msv-copen-resolve')).toBeInTheDocument();
    expect(screen.getByTestId('msv-cmt-focus-toggle')).toBeInTheDocument();
  });

  it('archive comments with a suggestion expose the 3 live full-label actions', () => {
    const comment = mkComment({ kind: 'archive', author: 'Archive Agent', suggestionId: 'sug-1' });
    const props = makeProps(comment);
    render(<CommentOpenCard {...props} />);
    const edit = screen.getByTestId('msv-copen-act-match_archive');
    const suggest = screen.getByTestId('msv-copen-act-suggest_story_change');
    const ignore = screen.getByTestId('msv-copen-act-ignore');
    expect(edit).toBeEnabled();
    expect(edit).toHaveTextContent('Edit notes to match');
    expect(suggest).toHaveTextContent('Suggest story change');
    expect(ignore).toHaveTextContent('Ignore');
    fireEvent.click(ignore);
    expect(props.onAgentAction).toHaveBeenCalledWith(comment, 'ignore');
  });

  it('archive comments without a suggestion render the actions disabled', () => {
    const props = makeProps(mkComment({ kind: 'archive', author: 'Archive Agent' }));
    render(<CommentOpenCard {...props} />);
    const edit = screen.getByTestId('msv-copen-act-match_archive');
    expect(edit).toBeDisabled();
    fireEvent.click(edit);
    expect(props.onAgentAction).not.toHaveBeenCalled();
  });

  it('Resolve fires with the comment', () => {
    const comment = mkComment();
    const props = makeProps(comment);
    render(<CommentOpenCard {...props} />);
    fireEvent.click(screen.getByTestId('msv-copen-resolve'));
    expect(props.onResolve).toHaveBeenCalledWith(comment);
  });

  it('the Show-in-focus switch reflects state and fires the toggle', () => {
    const props = makeProps(mkComment(), { commentsInFocus: true });
    render(<CommentOpenCard {...props} />);
    const toggle = screen.getByTestId('msv-cmt-focus-toggle');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    expect(props.onToggleCommentsInFocus).toHaveBeenCalledTimes(1);
  });
});
