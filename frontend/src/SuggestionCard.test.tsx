import { render, screen, fireEvent } from '@testing-library/react';
import { SuggestionCard, ConfidenceBadge } from './SuggestionCard';
import type { SuggestionCardData } from './SuggestionCard';

function makeSuggestion(overrides: Partial<SuggestionCardData> = {}): SuggestionCardData {
  return {
    id: 'sug-1',
    source_agent: 'writing-assistant',
    text: 'Try using shorter sentences to increase tension.',
    confidence: 0.68,
    rationale: 'Dense prose slows pacing in action scenes.',
    status: 'proposed',
    ...overrides,
  };
}

const noop = () => {};

// AC-WA-4: Card renders agent label
describe('SuggestionCard — card layout (AC-WA-4)', () => {
  it('renders the "Writing Assistant" agent label', () => {
    render(<SuggestionCard suggestion={makeSuggestion()} onApply={noop} onReject={noop} />);
    expect(screen.getByText('Writing Assistant')).toBeInTheDocument();
  });

  it('renders suggestion text', () => {
    render(<SuggestionCard suggestion={makeSuggestion()} onApply={noop} onReject={noop} />);
    expect(screen.getByText(/shorter sentences/i)).toBeInTheDocument();
  });

  it('has article role with accessible label', () => {
    render(<SuggestionCard suggestion={makeSuggestion()} onApply={noop} onReject={noop} />);
    expect(screen.getByRole('article', { name: /writing assistant suggestion/i })).toBeInTheDocument();
  });
});

// AC-WA-5: "Show more" toggle for long text
describe('SuggestionCard — text expand/collapse (AC-WA-5)', () => {
  const longText = 'A'.repeat(141);

  it('shows "Show more" button when text exceeds 140 chars', () => {
    render(<SuggestionCard suggestion={makeSuggestion({ text: longText })} onApply={noop} onReject={noop} />);
    expect(screen.getByRole('button', { name: /show more/i })).toBeInTheDocument();
  });

  it('toggles to "Show less" after click and expands rationale', () => {
    const rationale = 'Long-form rationale here.';
    render(
      <SuggestionCard
        suggestion={makeSuggestion({ text: longText, rationale })}
        onApply={noop}
        onReject={noop}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /show more/i }));
    expect(screen.getByRole('button', { name: /show less/i })).toBeInTheDocument();
    expect(screen.getByText(rationale)).toBeInTheDocument();
  });

  it('does not show "Show more" for short text', () => {
    render(<SuggestionCard suggestion={makeSuggestion()} onApply={noop} onReject={noop} />);
    expect(screen.queryByRole('button', { name: /show more/i })).not.toBeInTheDocument();
  });
});

// AC-WA-6: Confidence badge segments and color tiers
describe('ConfidenceBadge (AC-WA-6)', () => {
  it('renders 10 segments', () => {
    const { container } = render(<ConfidenceBadge confidence={0.5} />);
    expect(container.querySelectorAll('.wa-seg')).toHaveLength(10);
  });

  it('fills 7 segments for 68% confidence', () => {
    const { container } = render(<ConfidenceBadge confidence={0.68} />);
    expect(container.querySelectorAll('.wa-seg--on')).toHaveLength(7);
  });

  it('fills 4 segments for 35% confidence (amber tier)', () => {
    const { container } = render(<ConfidenceBadge confidence={0.35} />);
    expect(container.querySelectorAll('.wa-seg--on')).toHaveLength(4);
    expect(container.querySelector('.wa-confidence-badge--low')).toBeInTheDocument();
  });

  it('applies medium tier for 5–7 segments (60%)', () => {
    const { container } = render(<ConfidenceBadge confidence={0.6} />);
    expect(container.querySelector('.wa-confidence-badge--medium')).toBeInTheDocument();
  });

  it('applies high tier for 8–10 segments (90%)', () => {
    const { container } = render(<ConfidenceBadge confidence={0.9} />);
    expect(container.querySelector('.wa-confidence-badge--high')).toBeInTheDocument();
  });

  it('shows numeric % label', () => {
    render(<ConfidenceBadge confidence={0.68} />);
    expect(screen.getByText('68%')).toBeInTheDocument();
  });

  // AC-WA-23: aria-label format is "Confidence: XX% (tier)"
  it('includes tier name in aria-label (low)', () => {
    render(<ConfidenceBadge confidence={0.3} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', expect.stringContaining('(low)'));
  });

  it('includes tier name in aria-label (medium)', () => {
    render(<ConfidenceBadge confidence={0.6} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', expect.stringContaining('(medium)'));
  });

  it('includes tier name in aria-label (high)', () => {
    render(<ConfidenceBadge confidence={0.9} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', expect.stringContaining('(high)'));
  });

  it('aria-label follows Confidence: XX% (tier) format', () => {
    render(<ConfidenceBadge confidence={0.68} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Confidence: 68% (medium)');
  });
});

// AC-WA-7 / AC-WA-8: Apply and Reject buttons
// AC-WA-23: aria-label includes first 50 chars of suggestion text
describe('SuggestionCard — apply/reject buttons (AC-WA-7, AC-WA-8, AC-WA-23)', () => {
  it('renders "✓ Apply" and "✕ Reject" buttons for proposed suggestion', () => {
    const suggestion = makeSuggestion();
    render(<SuggestionCard suggestion={suggestion} onApply={noop} onReject={noop} />);
    expect(screen.getByRole('button', { name: new RegExp(`^Apply: ${suggestion.text.slice(0, 50)}`) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(`^Reject: ${suggestion.text.slice(0, 50)}`) })).toBeInTheDocument();
  });

  it('calls onApply with suggestion id when Apply is clicked', () => {
    const onApply = vi.fn();
    const suggestion = makeSuggestion({ id: 'sug-42' });
    render(<SuggestionCard suggestion={suggestion} onApply={onApply} onReject={noop} />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Apply: `) }));
    expect(onApply).toHaveBeenCalledWith('sug-42');
  });

  it('calls onReject with suggestion id when Reject is clicked', () => {
    const onReject = vi.fn();
    const suggestion = makeSuggestion({ id: 'sug-42' });
    render(<SuggestionCard suggestion={suggestion} onApply={noop} onReject={onReject} />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Reject: `) }));
    expect(onReject).toHaveBeenCalledWith('sug-42');
  });
});

// AC-WA-9: Terminal state — accepted
describe('SuggestionCard — terminal state accepted (AC-WA-9)', () => {
  it('does not show action buttons when accepted', () => {
    render(
      <SuggestionCard
        suggestion={makeSuggestion({ status: 'accepted', decidedAt: new Date().toISOString() })}
        onApply={noop}
        onReject={noop}
      />,
    );
    expect(screen.queryByRole('button', { name: /^Apply: / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Reject: / })).not.toBeInTheDocument();
  });

  it('shows "Applied" label in terminal state', () => {
    render(
      <SuggestionCard
        suggestion={makeSuggestion({ status: 'accepted', decidedAt: new Date().toISOString() })}
        onApply={noop}
        onReject={noop}
      />,
    );
    expect(screen.getByText(/^Applied/)).toBeInTheDocument();
  });

  it('applies terminal CSS class for opacity fade', () => {
    const { container } = render(
      <SuggestionCard
        suggestion={makeSuggestion({ status: 'accepted' })}
        onApply={noop}
        onReject={noop}
      />,
    );
    expect(container.querySelector('.wa-suggestion-card--terminal')).toBeInTheDocument();
  });
});

// AC-WA-10: Terminal state — rejected
describe('SuggestionCard — terminal state rejected (AC-WA-10)', () => {
  it('shows "Rejected" label when rejected', () => {
    render(
      <SuggestionCard
        suggestion={makeSuggestion({ status: 'rejected', decidedAt: new Date().toISOString() })}
        onApply={noop}
        onReject={noop}
      />,
    );
    expect(screen.getByText(/^Rejected/)).toBeInTheDocument();
  });
});

// AC-WA-11: Confidence badge is always present
describe('SuggestionCard — confidence badge always rendered (AC-WA-11)', () => {
  it('renders confidence badge in proposed state', () => {
    const { container } = render(
      <SuggestionCard suggestion={makeSuggestion()} onApply={noop} onReject={noop} />,
    );
    expect(container.querySelector('.wa-confidence-badge')).toBeInTheDocument();
  });

  it('renders confidence badge in terminal state', () => {
    const { container } = render(
      <SuggestionCard
        suggestion={makeSuggestion({ status: 'accepted' })}
        onApply={noop}
        onReject={noop}
      />,
    );
    expect(container.querySelector('.wa-confidence-badge')).toBeInTheDocument();
  });
});
