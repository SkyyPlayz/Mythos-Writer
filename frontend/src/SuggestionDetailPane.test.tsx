import { render, screen, fireEvent } from '@testing-library/react';
import SuggestionDetailPane, { type UnifiedSuggestion } from './SuggestionDetailPane';

const handlers = {
  onClose: vi.fn(),
  onAccept: vi.fn(),
  onReject: vi.fn(),
  onRollback: vi.fn(),
};

function makeSuggestion(overrides: Partial<UnifiedSuggestion> = {}): UnifiedSuggestion {
  return {
    id: 'sug-1',
    kind: 'suggestion',
    sourceAgent: 'writing-assistant',
    confidence: 0.82,
    rationale: 'Tighten the opening beat.',
    targetPath: 'Story/Scene.md',
    targetAnchor: null,
    status: 'proposed',
    createdAt: '2026-01-01T00:00:00.000Z',
    appliedAt: null,
    budgetExceeded: false,
    category: null,
    payloadJson: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  (window as unknown as { api: unknown }).api = {};
});

describe('SuggestionDetailPane', () => {
  it('renders a collapsible Before section when pre_change_snapshot is present', () => {
    render(
      <SuggestionDetailPane
        suggestion={makeSuggestion({ preChangeSnapshot: 'Original scene text before the suggestion.' })}
        {...handlers}
      />,
    );

    expect(screen.getByRole('button', { name: /before/i })).toBeInTheDocument();
    expect(screen.getByText('Original scene text before the suggestion.')).toBeInTheDocument();
  });

  it('does not render a Before section when pre_change_snapshot is null', () => {
    render(
      <SuggestionDetailPane
        suggestion={makeSuggestion({ preChangeSnapshot: null })}
        {...handlers}
      />,
    );

    expect(screen.queryByRole('button', { name: /before/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Original scene text/i)).not.toBeInTheDocument();
  });
});

describe('SuggestionDetailPane — A/R/I keyboard shortcuts text-input guard', () => {
  it('fires onAccept when A is pressed outside a text input', () => {
    const onAccept = vi.fn();
    render(
      <SuggestionDetailPane suggestion={makeSuggestion()} {...handlers} onAccept={onAccept} />,
    );
    fireEvent.keyDown(document, { key: 'a' });
    expect(onAccept).toHaveBeenCalledWith('sug-1');
  });

  it('does NOT fire onAccept when A is pressed while focused in an <input>', () => {
    const onAccept = vi.fn();
    render(
      <>
        <input type="text" data-testid="search" />
        <SuggestionDetailPane suggestion={makeSuggestion()} {...handlers} onAccept={onAccept} />
      </>,
    );
    fireEvent.keyDown(screen.getByTestId('search'), { key: 'a' });
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('does NOT fire onReject when R is pressed while focused in a <textarea>', () => {
    const onReject = vi.fn();
    render(
      <>
        <textarea data-testid="notes" />
        <SuggestionDetailPane suggestion={makeSuggestion()} {...handlers} onReject={onReject} />
      </>,
    );
    fireEvent.keyDown(screen.getByTestId('notes'), { key: 'r' });
    expect(onReject).not.toHaveBeenCalled();
  });

  it('does NOT fire onIgnore when I is pressed while focused in an <input>', () => {
    const onIgnore = vi.fn();
    render(
      <>
        <input type="text" data-testid="search" />
        <SuggestionDetailPane suggestion={makeSuggestion()} {...handlers} onIgnore={onIgnore} />
      </>,
    );
    fireEvent.keyDown(screen.getByTestId('search'), { key: 'i' });
    expect(onIgnore).not.toHaveBeenCalled();
  });

  it('still fires onClose when Escape is pressed inside a text input', () => {
    const onClose = vi.fn();
    render(
      <>
        <input type="text" data-testid="search" />
        <SuggestionDetailPane suggestion={makeSuggestion()} {...handlers} onClose={onClose} />
      </>,
    );
    fireEvent.keyDown(screen.getByTestId('search'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
