import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import BetaReadPanel from './BetaReadPanel';
import BetaReadCommentCard from './BetaReadCommentCard';

function makeComment(overrides: Partial<BetaReadComment> = {}): BetaReadComment {
  return {
    id: 'br-1',
    scene_id: 's1',
    anchor_text: 'The airship docked.',
    comment_text: 'Clarify the sensory detail here.',
    created_at: '2026-01-01T00:00:00.000Z',
    dismissed_at: null,
    ...overrides,
  };
}

const noopDismiss = vi.fn();
const noopScan = vi.fn();

describe('BetaReadPanel', () => {
  it('renders the Beta-Read Mode label', () => {
    render(
      <BetaReadPanel
        scene={null}
        comments={[]}
        loading={false}
        error={null}
        lastScannedAt={null}
        onRunScan={noopScan}
        onDismiss={noopDismiss}
      />,
    );
    expect(screen.getByRole('region', { name: /beta-read mode/i })).toBeInTheDocument();
  });

  it('renders a comment card for each comment', () => {
    const comments = [
      makeComment({ id: 'br-1', anchor_text: 'The airship docked.', comment_text: 'Add more sensory detail.' }),
      makeComment({ id: 'br-2', anchor_text: 'She stepped forward.', comment_text: 'Passive voice here.' }),
    ];
    render(
      <BetaReadPanel
        scene={null}
        comments={comments}
        loading={false}
        error={null}
        lastScannedAt={null}
        onRunScan={noopScan}
        onDismiss={noopDismiss}
      />,
    );
    const cards = screen.getAllByRole('article', { name: /beta-read comment/i });
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('The airship docked.');
    expect(cards[1]).toHaveTextContent('She stepped forward.');
  });

  it('shows the no-feedback empty state when no comments, not loading, no error', () => {
    render(
      <BetaReadPanel
        scene={null}
        comments={[]}
        loading={false}
        error={null}
        lastScannedAt={null}
        onRunScan={noopScan}
        onDismiss={noopDismiss}
      />,
    );
    expect(screen.getByText(/no feedback yet/i)).toBeInTheDocument();
  });

  it('shows empty-scene error message when error prop set (AC-WA-21)', () => {
    render(
      <BetaReadPanel
        scene={null}
        comments={[]}
        loading={false}
        error="This scene is empty — add prose before starting Beta-Read mode."
        lastScannedAt={null}
        onRunScan={noopScan}
        onDismiss={noopDismiss}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This scene is empty — add prose before starting Beta-Read mode.',
    );
  });

  it('shows loading state', () => {
    render(
      <BetaReadPanel
        scene={null}
        comments={[]}
        loading={true}
        error={null}
        lastScannedAt={null}
        onRunScan={noopScan}
        onDismiss={noopDismiss}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/reading for pacing/i);
    // When loading=true the primary button changes its label to "Scanning…"
    expect(screen.getByRole('button', { name: /^scanning/i })).toBeInTheDocument();
  });

  it('Beta-Read button is disabled when scene is null', () => {
    render(
      <BetaReadPanel
        scene={null}
        comments={[]}
        loading={false}
        error={null}
        lastScannedAt={null}
        onRunScan={noopScan}
        onDismiss={noopDismiss}
      />,
    );
    // Use exact name to avoid matching the "Open Beta-Read history" button
    const btn = screen.getByRole('button', { name: /^beta-read$/i });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('BetaReadCommentCard', () => {
  it('renders anchor text and comment text', () => {
    render(
      <BetaReadCommentCard
        comment={makeComment()}
        onDismiss={noopDismiss}
      />,
    );
    expect(screen.getByRole('article', { name: /beta-read comment/i })).toBeInTheDocument();
    expect(screen.getByText('The airship docked.')).toBeInTheDocument();
    expect(screen.getByText('Clarify the sensory detail here.')).toBeInTheDocument();
  });

  it('dismiss callback fires and card collapses to noted state', async () => {
    const onDismiss = vi.fn().mockResolvedValue(undefined);
    render(<BetaReadCommentCard comment={makeComment()} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    await waitFor(() => {
      expect(onDismiss).toHaveBeenCalledWith('br-1');
    });
    expect(screen.getByRole('status')).toHaveTextContent(/comment dismissed/i);
  });

  it('clicking anchor text invokes onJumpToText with anchor text', () => {
    const onJumpToText = vi.fn();
    render(
      <BetaReadCommentCard
        comment={makeComment()}
        onDismiss={noopDismiss}
        onJumpToText={onJumpToText}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /jump to: the airship docked/i }));
    expect(onJumpToText).toHaveBeenCalledWith('The airship docked.');
  });

  it('warns to console when anchor clicked and onJumpToText is not provided', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<BetaReadCommentCard comment={makeComment()} onDismiss={noopDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: /jump to/i }));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('onJumpToText not wired'));
    warnSpy.mockRestore();
  });

  it('Note-it collapses the card to a summary', () => {
    render(<BetaReadCommentCard comment={makeComment()} onDismiss={noopDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: /note it/i }));
    expect(screen.getByRole('article', { name: /beta-read comment noted/i })).toBeInTheDocument();
    expect(screen.queryByText('Clarify the sensory detail here.')).not.toBeInTheDocument();
  });
});
