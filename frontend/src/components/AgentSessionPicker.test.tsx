// SKY-7076 (gh-960 gap): the picker must refuse to switch or start a new
// session while a reply is generating on the hosting surface — pinning at
// the store level already keeps persisted data correct, but letting the
// user swap out from under a generating reply is still confusing UX.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import AgentSessionPicker from './AgentSessionPicker';
import type { UseAgentSessionsResult } from '../lib/useAgentSessions';

function makeStore(overrides: Partial<UseAgentSessionsResult> = {}): UseAgentSessionsResult {
  return {
    sessions: [
      { id: 's1', agent: 'coach', title: 'Session 1', startedAt: 't', updatedAt: 't', turnCount: 2, relPath: 'a.md' },
      { id: 's2', agent: 'coach', title: 'Session 2', startedAt: 't', updatedAt: 't', turnCount: 0, relPath: 'b.md' },
    ],
    activeSession: null,
    activeSessionId: 's1',
    loading: false,
    switchSession: vi.fn(),
    newSession: vi.fn(),
    renameSession: vi.fn(),
    duplicateSession: vi.fn(),
    deleteSession: vi.fn(),
    appendTurns: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  };
}

function openDropdown() {
  fireEvent.click(screen.getByRole('button', { name: /^Session:/ }));
}

describe('AgentSessionPicker', () => {
  it('switches sessions and starts a new chat when not busy', () => {
    const store = makeStore();
    act(() => { render(<AgentSessionPicker store={store} />); });
    openDropdown();

    fireEvent.click(screen.getByRole('option', { name: /Session 2/ }).querySelector('.asp-row-label')!);
    expect(store.switchSession).toHaveBeenCalledWith('s2');

    openDropdown();
    fireEvent.click(screen.getByText('+ New chat'));
    expect(store.newSession).toHaveBeenCalled();
  });

  it('disables session rows and "+ New chat" while busy, and blocks the click handlers', () => {
    const store = makeStore();
    act(() => { render(<AgentSessionPicker store={store} busy />); });
    openDropdown();

    const rowButton = screen.getByRole('option', { name: /Session 2/ }).querySelector('.asp-row-label')!;
    expect(rowButton).toBeDisabled();
    fireEvent.click(rowButton);
    expect(store.switchSession).not.toHaveBeenCalled();

    const newChatButton = screen.getByText('+ New chat');
    expect(newChatButton).toBeDisabled();
    fireEvent.click(newChatButton);
    expect(store.newSession).not.toHaveBeenCalled();
  });

  it('does not disable the picker when busy is false (default)', () => {
    const store = makeStore();
    act(() => { render(<AgentSessionPicker store={store} />); });
    openDropdown();

    expect(screen.getByRole('option', { name: /Session 2/ }).querySelector('.asp-row-label')).not.toBeDisabled();
    expect(screen.getByText('+ New chat')).not.toBeDisabled();
  });

  describe('§10: session ordering', () => {
    it('pins the active session first, then sorts the rest newest-first', () => {
      const store = makeStore({
        sessions: [
          { id: 's1', agent: 'coach', title: 'Oldest', startedAt: 't', updatedAt: '2026-01-01T00:00:00.000Z', turnCount: 1, relPath: 'a.md' },
          { id: 's2', agent: 'coach', title: 'Active but stale', startedAt: 't', updatedAt: '2026-01-02T00:00:00.000Z', turnCount: 1, relPath: 'b.md' },
          { id: 's3', agent: 'coach', title: 'Newest', startedAt: 't', updatedAt: '2026-01-03T00:00:00.000Z', turnCount: 1, relPath: 'c.md' },
        ],
        activeSessionId: 's2',
      });
      act(() => { render(<AgentSessionPicker store={store} />); });
      openDropdown();

      const rowNames = screen.getAllByRole('option').map((r) => r.textContent);
      // Active row ('Active but stale') pinned first despite not being newest;
      // the rest fall back to newest-updated-first ('Newest' before 'Oldest').
      expect(rowNames[0]).toContain('Active but stale');
      expect(rowNames[1]).toContain('Newest');
      expect(rowNames[2]).toContain('Oldest');
    });
  });

  describe('§3: session action failures', () => {
    afterEach(() => {
      document.querySelectorAll('[data-testid="ln-toast"]').forEach((el) => el.remove());
    });

    it('shows a toast when deleting a session fails, without crashing', async () => {
      const store = makeStore({ deleteSession: vi.fn().mockRejectedValue(new Error('locked')) });
      act(() => { render(<AgentSessionPicker store={store} />); });
      openDropdown();

      fireEvent.click(screen.getByRole('button', { name: /Delete session Session 2/ }));

      await waitFor(() => {
        expect(screen.getByTestId('ln-toast')).toHaveTextContent(/couldn't delete this chat/i);
      });
    });

    it('shows a toast when duplicating a session fails', async () => {
      const store = makeStore({ duplicateSession: vi.fn().mockRejectedValue(new Error('io error')) });
      act(() => { render(<AgentSessionPicker store={store} />); });
      openDropdown();

      fireEvent.click(screen.getByRole('button', { name: /Duplicate session Session 2/ }));

      await waitFor(() => {
        expect(screen.getByTestId('ln-toast')).toHaveTextContent(/couldn't duplicate this chat/i);
      });
    });

    it('shows a toast when renaming a session fails', async () => {
      const store = makeStore({ renameSession: vi.fn().mockRejectedValue(new Error('io error')) });
      act(() => { render(<AgentSessionPicker store={store} />); });
      openDropdown();

      fireEvent.click(screen.getByRole('button', { name: /Rename session Session 2/ }));
      fireEvent.change(screen.getByLabelText('Rename session'), { target: { value: 'New name' } });
      fireEvent.keyDown(screen.getByLabelText('Rename session'), { key: 'Enter' });

      await waitFor(() => {
        expect(screen.getByTestId('ln-toast')).toHaveTextContent(/couldn't rename this chat/i);
      });
    });
  });
});
