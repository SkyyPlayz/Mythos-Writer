// Beta 4 M10 — DraftDiffView v2: the current draft is ALWAYS the left/green
// column with a "— current" label, the previous draft the right/red column
// with "— previous" (M10 acceptance: diff labels correct on both sides).
// Plus segment-kind rendering ('d' red strike / 'a' green / 's' plain) and
// the single-pane "Highlight changes" mode.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DraftDiffView from './DraftDiffView';

const PREVIOUS_TEXT = 'Cold air drifted up from below.';
const CURRENT_TEXT = 'Damp air rolled up from below.';

function makeProps() {
  return {
    documentLabel: 'Scene 4',
    previousLabel: 'Draft 6',
    currentLabel: 'Draft 7',
    previousText: PREVIOUS_TEXT,
    currentText: CURRENT_TEXT,
    onClose: vi.fn(),
  };
}

describe('<DraftDiffView variant="full">', () => {
  it('renders the header with the green current pill, "vs", legend, and close wiring', () => {
    const props = makeProps();
    render(<DraftDiffView {...props} />);
    expect(screen.getByText('Compare drafts — Scene 4')).toBeInTheDocument();
    expect(screen.getByTestId('ln-diff-current-pill').textContent).toBe('Draft 7 · current');
    expect(screen.getByText('vs')).toBeInTheDocument();
    expect(screen.getByText('Draft 6')).toBeInTheDocument();
    expect(screen.getByText('green = added')).toBeInTheDocument();
    expect(screen.getByText('red = removed')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Close compare view'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('labels both columns — current on the LEFT, previous on the RIGHT (M10 acceptance)', () => {
    render(<DraftDiffView {...makeProps()} />);
    const labelCurrent = screen.getByTestId('ln-diff-label-current');
    const labelPrevious = screen.getByTestId('ln-diff-label-previous');
    expect(labelCurrent.textContent).toBe('Draft 7 — current');
    expect(labelPrevious.textContent).toBe('Draft 6 — previous');
    // DOM order: current label/column precede the previous label/column.
    expect(
      labelCurrent.compareDocumentPosition(labelPrevious) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const colCurrent = screen.getByTestId('ln-diff-col-current');
    const colPrevious = screen.getByTestId('ln-diff-col-previous');
    expect(
      colCurrent.compareDocumentPosition(colPrevious) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Column tinting classes: current green, previous red.
    expect(colCurrent.className).toContain('ln-diff-col-current');
    expect(colPrevious.className).toContain('ln-diff-col-previous');
  });

  it('renders added segments in the current (left) column and removed struck in the previous (right)', () => {
    render(<DraftDiffView {...makeProps()} />);
    const colCurrent = screen.getByTestId('ln-diff-col-current');
    const colPrevious = screen.getByTestId('ln-diff-col-previous');

    // Current column: 'a' + 's' kinds only.
    const added = colCurrent.querySelectorAll('.ln-diff-seg-a');
    expect([...added].map((n) => n.textContent)).toEqual(['Damp ', 'rolled ']);
    expect(colCurrent.querySelectorAll('.ln-diff-seg-d')).toHaveLength(0);
    expect(colCurrent.textContent).not.toContain('Cold');

    // Previous column: 'd' + 's' kinds only.
    const removed = colPrevious.querySelectorAll('.ln-diff-seg-d');
    expect([...removed].map((n) => n.textContent)).toEqual(['Cold ', 'drifted ']);
    expect(colPrevious.querySelectorAll('.ln-diff-seg-a')).toHaveLength(0);
    expect(colPrevious.textContent).not.toContain('Damp');

    // Unchanged text carries the plain kind in both columns.
    expect(colCurrent.querySelector('.ln-diff-seg-s')?.textContent).toBe('air ');
    expect(colPrevious.querySelector('.ln-diff-seg-s')?.textContent).toBe('air ');
  });

  it('offers a previous-draft selector when previousOptions are provided', () => {
    const onSelectPrevious = vi.fn();
    render(
      <DraftDiffView
        {...makeProps()}
        previousOptions={[{ id: 'draft-6', label: 'Draft 6' }, { id: 'draft-5', label: 'Draft 5' }]}
        selectedPreviousId="draft-6"
        onSelectPrevious={onSelectPrevious}
      />,
    );
    const select = screen.getByLabelText('Draft to compare against');
    fireEvent.change(select, { target: { value: 'draft-5' } });
    expect(onSelectPrevious).toHaveBeenCalledWith('draft-5');
  });

  it('splits paragraphs on blank lines in both columns', () => {
    render(
      <DraftDiffView
        {...makeProps()}
        previousText={'One.\n\nTwo old.'}
        currentText={'One.\n\nTwo new.'}
      />,
    );
    expect(screen.getByTestId('ln-diff-col-previous').querySelectorAll('.ln-diff-para')).toHaveLength(2);
    expect(screen.getByTestId('ln-diff-col-current').querySelectorAll('.ln-diff-para')).toHaveLength(2);
  });
});

describe('<DraftDiffView variant="highlight">', () => {
  it('renders only the previous draft with removed segments highlighted, no chrome', () => {
    render(<DraftDiffView {...makeProps()} variant="highlight" />);
    const pane = screen.getByTestId('ln-diff-highlight');
    expect([...pane.querySelectorAll('.ln-diff-seg-d')].map((n) => n.textContent)).toEqual([
      'Cold ',
      'drifted ',
    ]);
    expect(pane.querySelectorAll('.ln-diff-seg-a')).toHaveLength(0);
    expect(pane.textContent).not.toContain('Damp');
    expect(screen.queryByTestId('ln-diff-view')).not.toBeInTheDocument();
    expect(screen.queryByText('Compare drafts — Scene 4')).not.toBeInTheDocument();
  });
});
