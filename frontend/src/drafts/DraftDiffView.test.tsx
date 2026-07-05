// M12 — DraftDiffView: prototype segment-kind rendering ('d' red strike /
// 'a' green / 's' plain), the two-column full mode, and the single-pane
// "Highlight changes" mode.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DraftDiffView from './DraftDiffView';

const OLD_TEXT = 'Cold air drifted up from below.';
const NEW_TEXT = 'Damp air rolled up from below.';

function makeProps() {
  return {
    documentLabel: 'Scene 4',
    oldLabel: 'Draft 6',
    newLabel: 'Draft 7',
    oldText: OLD_TEXT,
    newText: NEW_TEXT,
    onClose: vi.fn(),
  };
}

describe('<DraftDiffView variant="full">', () => {
  it('renders the header with labels, legend, and close wiring', () => {
    const props = makeProps();
    render(<DraftDiffView {...props} />);
    expect(screen.getByText('Compare drafts — Scene 4')).toBeInTheDocument();
    expect(screen.getByText('Draft 6')).toBeInTheDocument();
    expect(screen.getByText('Draft 7 · current')).toBeInTheDocument();
    expect(screen.getByText('green = added')).toBeInTheDocument();
    expect(screen.getByText('red = removed')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Close compare view'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('renders removed segments struck in the old column and added in the new', () => {
    render(<DraftDiffView {...makeProps()} />);
    const oldCol = screen.getByTestId('ln-diff-col-old');
    const newCol = screen.getByTestId('ln-diff-col-new');

    // Old column: 'd' + 's' kinds only.
    const removed = oldCol.querySelectorAll('.ln-diff-seg-d');
    expect([...removed].map((n) => n.textContent)).toEqual(['Cold ', 'drifted ']);
    expect(oldCol.querySelectorAll('.ln-diff-seg-a')).toHaveLength(0);
    expect(oldCol.textContent).not.toContain('Damp');

    // New column: 'a' + 's' kinds only.
    const added = newCol.querySelectorAll('.ln-diff-seg-a');
    expect([...added].map((n) => n.textContent)).toEqual(['Damp ', 'rolled ']);
    expect(newCol.querySelectorAll('.ln-diff-seg-d')).toHaveLength(0);
    expect(newCol.textContent).not.toContain('Cold');

    // Unchanged text carries the plain kind in both columns.
    expect(oldCol.querySelector('.ln-diff-seg-s')?.textContent).toBe('air ');
    expect(newCol.querySelector('.ln-diff-seg-s')?.textContent).toBe('air ');
  });

  it('offers a draft selector when oldOptions are provided', () => {
    const onSelectOld = vi.fn();
    render(
      <DraftDiffView
        {...makeProps()}
        oldOptions={[{ id: 'd6', label: 'Draft 6' }, { id: 'd5', label: 'Draft 5' }]}
        selectedOldId="d6"
        onSelectOld={onSelectOld}
      />,
    );
    const select = screen.getByLabelText('Draft to compare against');
    fireEvent.change(select, { target: { value: 'd5' } });
    expect(onSelectOld).toHaveBeenCalledWith('d5');
  });

  it('splits paragraphs on blank lines in both columns', () => {
    render(
      <DraftDiffView
        {...makeProps()}
        oldText={'One.\n\nTwo old.'}
        newText={'One.\n\nTwo new.'}
      />,
    );
    expect(screen.getByTestId('ln-diff-col-old').querySelectorAll('.ln-diff-para')).toHaveLength(2);
    expect(screen.getByTestId('ln-diff-col-new').querySelectorAll('.ln-diff-para')).toHaveLength(2);
  });
});

describe('<DraftDiffView variant="highlight">', () => {
  it('renders only the old draft with removed segments highlighted, no chrome', () => {
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
