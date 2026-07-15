// Beta 4 M10 — DraftsCompareSplit: scope header, draft select, "Highlight
// changes" toggle DEFAULT ON, Full diff / Load draft wiring, and the yellow
// Undo chip (visible only while a loaded draft can be rolled back).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DraftsCompareSplit from './DraftsCompareSplit';
import type { SceneDraftEntry } from './useSceneDrafts';

const DRAFTS: SceneDraftEntry[] = [
  { ts: 'draft-6', label: 'Draft 6', content: 'Cold air drifted up from below.', intent: 'save', savedAtMs: null },
  { ts: 'draft-5', label: 'Draft 5', content: 'Old fifth draft text.', intent: 'save', savedAtMs: null },
];

function makeProps() {
  return {
    scopeLabel: 'Scene 4: The Gate',
    drafts: DRAFTS,
    currentLabel: 'Draft 7',
    currentContent: 'Damp air rolled up from below.',
    selectedTs: 'draft-6',
    onSelectTs: vi.fn(),
    onFullDiff: vi.fn(),
    onLoadDraft: vi.fn(),
    undoLabel: null as string | null,
    onUndo: vi.fn(),
    onClose: vi.fn(),
  };
}

describe('<DraftsCompareSplit>', () => {
  it('renders the DRAFTS — <scope> chip for the open document', () => {
    render(<DraftsCompareSplit {...makeProps()} />);
    expect(screen.getByText('DRAFTS — Scene 4: The Gate')).toBeInTheDocument();
    expect(screen.getByTestId('ln-drafts-split')).toBeInTheDocument();
  });

  it('defaults "Highlight changes" ON and shows the diff-highlighted body', () => {
    render(<DraftsCompareSplit {...makeProps()} />);
    const toggle = screen.getByTestId('ln-drafts-hl-toggle');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    // Highlight body: the selected draft with its differing words struck.
    const pane = screen.getByTestId('ln-diff-highlight');
    expect([...pane.querySelectorAll('.ln-diff-seg-d')].map((n) => n.textContent)).toEqual([
      'Cold ',
      'drifted ',
    ]);
    expect(screen.queryByTestId('ln-drafts-split-plain')).not.toBeInTheDocument();
  });

  it('toggling highlight OFF renders the plain read-only draft text', () => {
    render(<DraftsCompareSplit {...makeProps()} />);
    fireEvent.click(screen.getByTestId('ln-drafts-hl-toggle'));
    expect(screen.getByTestId('ln-drafts-hl-toggle')).toHaveAttribute('aria-checked', 'false');
    const plain = screen.getByTestId('ln-drafts-split-plain');
    expect(plain.textContent).toContain('Cold air drifted up from below.');
    expect(plain.querySelectorAll('.ln-diff-seg-d')).toHaveLength(0);
    expect(screen.queryByTestId('ln-diff-highlight')).not.toBeInTheDocument();
  });

  it('lists drafts in the select (newest marked "previous") and reports selection', () => {
    const props = makeProps();
    render(<DraftsCompareSplit {...props} />);
    const select = screen.getByLabelText('Draft to compare') as HTMLSelectElement;
    const labels = [...select.querySelectorAll('option')].map((o) => o.textContent);
    expect(labels).toEqual(['Draft 6 (previous)', 'Draft 5']);
    fireEvent.change(select, { target: { value: 'draft-5' } });
    expect(props.onSelectTs).toHaveBeenCalledWith('draft-5');
  });

  it('shows the selected draft body when a non-default draft is selected', () => {
    render(<DraftsCompareSplit {...makeProps()} selectedTs="draft-5" />);
    fireEvent.click(screen.getByTestId('ln-drafts-hl-toggle')); // plain text is easier to assert
    expect(screen.getByTestId('ln-drafts-split-plain').textContent).toContain('Old fifth draft text.');
  });

  it('Full diff and Load draft fire with the selected draft', () => {
    const props = makeProps();
    render(<DraftsCompareSplit {...props} />);
    fireEvent.click(screen.getByText('Full diff'));
    expect(props.onFullDiff).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Load draft'));
    expect(props.onLoadDraft).toHaveBeenCalledWith(DRAFTS[0]);
  });

  it('hides the Undo chip until a draft was loaded, then wires it to onUndo', () => {
    const props = makeProps();
    const { rerender } = render(<DraftsCompareSplit {...props} />);
    expect(screen.queryByTestId('ln-drafts-undo-chip')).not.toBeInTheDocument();

    rerender(<DraftsCompareSplit {...props} undoLabel="Draft 6" />);
    const chip = screen.getByTestId('ln-drafts-undo-chip');
    expect(chip).toHaveAttribute('aria-label', 'Undo loading Draft 6');
    fireEvent.click(chip);
    expect(props.onUndo).toHaveBeenCalledTimes(1);
  });

  it('close button reports up; empty store renders the empty state with actions disabled', () => {
    const props = makeProps();
    render(<DraftsCompareSplit {...props} drafts={[]} selectedTs={null} />);
    expect(screen.getByText(/No drafts yet/)).toBeInTheDocument();
    expect(screen.getByText('Load draft').closest('button')).toBeDisabled();
    expect(screen.getByText('Full diff').closest('button')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Close drafts compare'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('surfaces store errors inline', () => {
    render(<DraftsCompareSplit {...makeProps()} error="Couldn't load drafts: boom" />);
    expect(screen.getByRole('alert').textContent).toContain('boom');
  });

  it('re-syncs the host selection when the selected draft was pruned', () => {
    const props = makeProps();
    render(<DraftsCompareSplit {...props} selectedTs="draft-99" />);
    expect(props.onSelectTs).toHaveBeenCalledWith('draft-6');
  });
});
