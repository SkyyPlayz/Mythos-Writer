import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProposalCard } from './ProposalCard';
import type { NoteProposal } from './ProposalCard';

function makeProposal(overrides: Partial<NoteProposal> = {}): NoteProposal {
  return {
    id: 'p1',
    kind: 'character',
    title: 'Lyra Stormwind',
    destinationPath: 'Characters/Heroes/',
    body: 'Lyra is a fierce warrior from the northern mountains.',
    frontmatter: {},
    sourceConversationTurnId: 'turn-1',
    extractionConfidence: 0.9,
    status: 'pending',
    ...overrides,
  };
}

describe('ProposalCard', () => {
  const onConfirm = vi.fn();
  const onReject = vi.fn();
  const onDismissAll = vi.fn();

  beforeEach(() => {
    onConfirm.mockClear();
    onReject.mockClear();
    onDismissAll.mockClear();
  });

  it('renders nothing when proposals array is empty', () => {
    render(
      <ProposalCard
        proposals={[]}
        onConfirm={onConfirm}
        onReject={onReject}
        onDismissAll={onDismissAll}
      />,
    );
    expect(screen.queryByTestId('proposal-card-region')).toBeInTheDocument();
    expect(screen.queryByTestId('proposal-card-p1')).not.toBeInTheDocument();
  });

  it('renders kind badge with correct label', () => {
    render(
      <ProposalCard
        proposals={[makeProposal({ kind: 'character' })]}
        onConfirm={onConfirm}
        onReject={onReject}
        onDismissAll={onDismissAll}
      />,
    );
    const badge = screen.getByRole('img', { name: 'Character note proposal' });
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('CHARACTER');
  });

  it('renders all 7 kind badges correctly', () => {
    const kinds: NoteProposal['kind'][] = [
      'character', 'location', 'item', 'faction', 'scene_card', 'scene_crafter_card', 'inbox',
    ];
    const ariaLabels: Record<NoteProposal['kind'], string> = {
      character: 'Character note proposal',
      location: 'Location note proposal',
      item: 'Item note proposal',
      faction: 'Faction note proposal',
      scene_card: 'Scene card proposal',
      scene_crafter_card: 'Scene Crafter board card proposal',
      inbox: 'Inbox note proposal',
    };
    for (const kind of kinds) {
      const { unmount } = render(
        <ProposalCard
          proposals={[makeProposal({ kind, id: kind })]}
          onConfirm={onConfirm}
          onReject={onReject}
          onDismissAll={onDismissAll}
        />,
      );
      expect(screen.getByRole('img', { name: ariaLabels[kind] })).toBeInTheDocument();
      unmount();
    }
  });

  it('calls onConfirm with confirmed status when Confirm is clicked', () => {
    render(
      <ProposalCard
        proposals={[makeProposal()]}
        onConfirm={onConfirm}
        onReject={onReject}
        onDismissAll={onDismissAll}
      />,
    );
    fireEvent.click(screen.getByTestId('pc-confirm-btn'));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1', status: 'confirmed' }),
    );
  });

  it('calls onReject when Reject is clicked', () => {
    render(
      <ProposalCard
        proposals={[makeProposal()]}
        onConfirm={onConfirm}
        onReject={onReject}
        onDismissAll={onDismissAll}
      />,
    );
    fireEvent.click(screen.getByTestId('pc-reject-btn'));
    expect(onReject).toHaveBeenCalledWith('p1');
  });

  it('enters edit mode and saves with edited_and_confirmed status', () => {
    render(
      <ProposalCard
        proposals={[makeProposal()]}
        onConfirm={onConfirm}
        onReject={onReject}
        onDismissAll={onDismissAll}
      />,
    );
    fireEvent.click(screen.getByTestId('pc-edit-btn'));
    const titleInput = screen.getByTestId('pc-edit-title');
    fireEvent.change(titleInput, { target: { value: 'Lyra Edited' } });
    fireEvent.click(screen.getByTestId('pc-save-btn'));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Lyra Edited', status: 'edited_and_confirmed' }),
    );
  });

  it('cancel edit reverts to read mode without calling onConfirm', () => {
    render(
      <ProposalCard
        proposals={[makeProposal()]}
        onConfirm={onConfirm}
        onReject={onReject}
        onDismissAll={onDismissAll}
      />,
    );
    fireEvent.click(screen.getByTestId('pc-edit-btn'));
    expect(screen.getByTestId('pc-edit-title')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('pc-cancel-btn'));
    expect(screen.queryByTestId('pc-edit-title')).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows Blank-mode disambiguation when destinationPath is empty', () => {
    render(
      <ProposalCard
        proposals={[makeProposal({ destinationPath: '' })]}
        onConfirm={onConfirm}
        onReject={onReject}
        onDismissAll={onDismissAll}
      />,
    );
    expect(screen.getByTestId('pc-blank-prompt')).toBeInTheDocument();
    expect(screen.queryByTestId('pc-confirm-btn')).not.toBeInTheDocument();
  });

  it('Blank-mode confirm button is disabled when path is empty', () => {
    render(
      <ProposalCard
        proposals={[makeProposal({ destinationPath: '' })]}
        onConfirm={onConfirm}
        onReject={onReject}
        onDismissAll={onDismissAll}
      />,
    );
    const confirmBtn = screen.getByTestId('pc-blank-confirm-btn');
    expect(confirmBtn).toBeDisabled();
  });

  it('Blank-mode confirm calls onConfirm with entered path', () => {
    render(
      <ProposalCard
        proposals={[makeProposal({ destinationPath: '' })]}
        onConfirm={onConfirm}
        onReject={onReject}
        onDismissAll={onDismissAll}
      />,
    );
    fireEvent.change(screen.getByTestId('pc-blank-path-input'), {
      target: { value: 'Characters/Villains/' },
    });
    fireEvent.click(screen.getByTestId('pc-blank-confirm-btn'));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ destinationPath: 'Characters/Villains/', status: 'confirmed' }),
    );
  });

  it('shows queue depth "1 of N proposals" for multiple proposals', () => {
    render(
      <ProposalCard
        proposals={[makeProposal(), makeProposal({ id: 'p2', title: 'Another' })]}
        onConfirm={onConfirm}
        onReject={onReject}
        onDismissAll={onDismissAll}
      />,
    );
    expect(screen.getByText(/1 of 2 proposals/)).toBeInTheDocument();
  });

  it('shows Dismiss all button when queue has multiple proposals', () => {
    render(
      <ProposalCard
        proposals={[makeProposal(), makeProposal({ id: 'p2', title: 'Another' })]}
        onConfirm={onConfirm}
        onReject={onReject}
        onDismissAll={onDismissAll}
      />,
    );
    const dismissBtn = screen.getByTestId('pc-dismiss-all-btn');
    expect(dismissBtn).toBeInTheDocument();
    fireEvent.click(dismissBtn);
    expect(onDismissAll).toHaveBeenCalled();
  });

  it('does not show Dismiss all for a single proposal', () => {
    render(
      <ProposalCard
        proposals={[makeProposal()]}
        onConfirm={onConfirm}
        onReject={onReject}
        onDismissAll={onDismissAll}
      />,
    );
    expect(screen.queryByTestId('pc-dismiss-all-btn')).not.toBeInTheDocument();
  });

  it('toggles body expand/collapse', () => {
    render(
      <ProposalCard
        proposals={[makeProposal()]}
        onConfirm={onConfirm}
        onReject={onReject}
        onDismissAll={onDismissAll}
      />,
    );
    const showMore = screen.getByTestId('pc-show-more');
    expect(showMore).toHaveTextContent('Show more');
    fireEvent.click(showMore);
    expect(showMore).toHaveTextContent('Show less');
    fireEvent.click(showMore);
    expect(showMore).toHaveTextContent('Show more');
  });

  it('pc-region has role="region" and aria-label="Proposed notes"', () => {
    render(
      <ProposalCard
        proposals={[makeProposal()]}
        onConfirm={onConfirm}
        onReject={onReject}
        onDismissAll={onDismissAll}
      />,
    );
    expect(screen.getByRole('region', { name: 'Proposed notes' })).toBeInTheDocument();
  });
});
