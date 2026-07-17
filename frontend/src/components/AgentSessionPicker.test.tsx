// SKY-7076 (gh-960 gap): the picker must refuse to switch or start a new
// session while a reply is generating on the hosting surface — pinning at
// the store level already keeps persisted data correct, but letting the
// user swap out from under a generating reply is still confusing UX.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
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
});
