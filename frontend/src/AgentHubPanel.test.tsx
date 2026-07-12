// SKY-6321: Agent hub — Suggestions card live preview + "See All Suggestions" wiring.
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, afterEach, describe, it, expect } from 'vitest';
import AgentHubPanel from './AgentHubPanel';

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
});
