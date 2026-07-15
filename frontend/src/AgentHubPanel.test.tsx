// SKY-6321: Agent hub — Suggestions card live preview + "See All Suggestions" wiring.
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, afterEach, describe, it, expect } from 'vitest';
import AgentHubPanel from './AgentHubPanel';

function makeSuggestion(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 's1',
    kind: 'suggestion',
    sourceAgent: 'writing-assistant',
    confidence: 0.9,
    rationale: 'Tighten this paragraph.',
    targetPath: 'Scenes/Ch1.md',
    targetAnchor: null,
    status: 'proposed',
    createdAt: new Date().toISOString(),
    appliedAt: null,
    budgetExceeded: false,
    category: null,
    payloadJson: null,
    ...overrides,
  };
}

describe('AgentHubPanel — Suggestions card', () => {
  afterEach(() => {
    delete (window as any).api;
  });

  it('shows the empty state when there are no proposed suggestions', async () => {
    (window as any).api = {
      suggestionsUnifiedList: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }),
    };

    render(<AgentHubPanel scene={null} />);

    expect(await screen.findByText(/No new suggestions/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/pending/i)).not.toBeInTheDocument();
  });

  it('renders live preview rows and a count badge when suggestions are proposed', async () => {
    (window as any).api = {
      suggestionsUnifiedList: vi.fn().mockResolvedValue({
        totalCount: 5,
        items: [
          {
            id: 's1',
            kind: 'suggestion',
            sourceAgent: 'writing-assistant',
            confidence: 0.82,
            rationale: 'Tighten this paragraph — it repeats the prior beat.',
            targetPath: 'Scenes/Ch1.md',
            targetAnchor: null,
            status: 'proposed',
            createdAt: new Date().toISOString(),
            appliedAt: null,
            budgetExceeded: false,
            category: null,
            payloadJson: null,
          },
        ],
      }),
    };

    render(<AgentHubPanel scene={null} />);

    expect(await screen.findByText(/Tighten this paragraph/)).toBeInTheDocument();
    expect(screen.getByText('82%')).toBeInTheDocument();
    expect(screen.getByLabelText('5 pending')).toHaveTextContent('5');
  });

  it('calls onOpenSuggestionInbox when "See All Suggestions" is clicked', async () => {
    (window as any).api = {
      suggestionsUnifiedList: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }),
    };
    const onOpenSuggestionInbox = vi.fn();

    render(<AgentHubPanel scene={null} onOpenSuggestionInbox={onOpenSuggestionInbox} />);
    await screen.findByText(/No new suggestions/i);

    fireEvent.click(screen.getByRole('button', { name: /See All Suggestions/i }));

    expect(onOpenSuggestionInbox).toHaveBeenCalledTimes(1);
  });

  it('CF-10: a suggestion rejected/dismissed elsewhere is dropped and never resurfaces on the next poll', async () => {
    vi.useFakeTimers();
    try {
      const suggestionsUnifiedList = vi
        .fn()
        .mockResolvedValueOnce({ totalCount: 1, items: [makeSuggestion()] })
        // Simulates the suggestion's status flipping to the terminal 'rejected'
        // state between polls — status filtering (status: 'proposed') must
        // exclude it permanently, so the next poll returns nothing.
        .mockResolvedValue({ totalCount: 0, items: [] });
      (window as any).api = { suggestionsUnifiedList };

      await act(async () => {
        render(<AgentHubPanel scene={null} />);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText(/Tighten this paragraph\./)).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });

      expect(screen.queryByText(/Tighten this paragraph\./)).not.toBeInTheDocument();
      expect(screen.getByText(/No new suggestions/i)).toBeInTheDocument();
      expect(suggestionsUnifiedList).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
