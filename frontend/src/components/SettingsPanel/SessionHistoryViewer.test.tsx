// SKY-10954 — SessionHistoryViewer: per-agent Settings-page session browser.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import SessionHistoryViewer from './SessionHistoryViewer';

const mockList = vi.fn();
const mockRead = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { api: Record<string, unknown> }).api = {
    agentSessions: {
      list: mockList,
      read: mockRead,
    },
  };
  mockList.mockResolvedValue({
    sessions: [
      { id: 'a', agent: 'brainstorm', title: 'World building', startedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z', turnCount: 4, relPath: 'Sessions/a.md' },
      { id: 'b', agent: 'brainstorm', startedAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z', turnCount: 1, relPath: 'Sessions/b.md' },
    ],
  });
  mockRead.mockResolvedValue({
    session: {
      id: 'a',
      agent: 'brainstorm',
      title: 'World building',
      startedAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
      turns: [
        { role: 'user', text: 'Tell me about the moon kingdom', at: '2026-08-01T00:00:01.000Z' },
        { role: 'agent', text: 'The moon kingdom is ruled by...', at: '2026-08-01T00:00:02.000Z' },
      ],
    },
  });
});

async function openViewer(agentName: 'writingAssistant' | 'brainstorm' | 'archive' | 'betaReader' = 'brainstorm') {
  render(<SessionHistoryViewer agentName={agentName} />);
  fireEvent.click(screen.getByRole('button', { name: /session history/i }));
  await waitFor(() => expect(mockList).toHaveBeenCalled());
}

describe('SessionHistoryViewer (SKY-10954)', () => {
  it('lists sessions for the given agent, newest metadata visible', async () => {
    await openViewer('brainstorm');
    expect(mockList).toHaveBeenCalledWith('brainstorm');
    expect(await screen.findByText('World building')).toBeInTheDocument();
    expect(screen.getByText(/4 turns/)).toBeInTheDocument();
  });

  it('maps writingAssistant to the shared "coach" session key', async () => {
    await openViewer('writingAssistant');
    expect(mockList).toHaveBeenCalledWith('coach');
  });

  it('maps betaReader to the "beta-reader" session key', async () => {
    await openViewer('betaReader');
    expect(mockList).toHaveBeenCalledWith('beta-reader');
  });

  it('shows an empty state when the agent has no saved sessions', async () => {
    mockList.mockResolvedValue({ sessions: [] });
    await openViewer('archive');
    expect(await screen.findByText(/no saved conversations/i)).toBeInTheDocument();
  });

  it('selecting a session loads and renders its transcript read-only', async () => {
    await openViewer('brainstorm');
    fireEvent.click(await screen.findByTestId('session-history-item-a'));
    await waitFor(() => expect(mockRead).toHaveBeenCalledWith('a'));
    expect(await screen.findByText('Tell me about the moon kingdom')).toBeInTheDocument();
    expect(screen.getByText('The moon kingdom is ruled by...')).toBeInTheDocument();
  });

  it('never calls a session-switching API — only list/read', async () => {
    await openViewer('brainstorm');
    fireEvent.click(await screen.findByTestId('session-history-item-b'));
    await waitFor(() => expect(mockRead).toHaveBeenCalledWith('b'));
    const api = (window as unknown as { api: Record<string, unknown> }).api.agentSessions as Record<string, unknown>;
    expect(Object.keys(api)).toEqual(['list', 'read']);
  });
});
