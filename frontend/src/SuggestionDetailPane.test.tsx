import { render, screen } from '@testing-library/react';
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
