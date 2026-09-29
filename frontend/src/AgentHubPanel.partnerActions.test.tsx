// F3#1 / Critic H1 — partner actions post into the shared brainstorm thread.
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, afterEach, beforeEach, describe, it, expect } from 'vitest';
import AgentHubPanel from './AgentHubPanel';
import { __resetAgentSessionStores, getAgentSessionStore } from './lib/useAgentSessions';
import { PARTNER_SESSION_AGENT } from './agents/partnerIdentity';
import { resetAiActivityForTests } from './agents/aiActivity';
import { resetBrainstormActivityForTests } from './agents/brainstormActivity';
import { setAiEnabled, __resetAiEnabledForTests } from './hooks/useAiEnabled';
import type { Scene, Story } from './types';

function makeScene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'sc1',
    title: 'Opening',
    order: 0,
    blocks: [{ id: 'b1', type: 'prose', content: 'Hello world from the scene.' }],
    ...overrides,
  } as Scene;
}

function makeStory(): Story {
  return {
    id: 'st1',
    title: 'Test Story',
    path: 'Manuscript/Test',
    chapters: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function mockSessionsApi() {
  const session = {
    id: 's1',
    agent: 'brainstorm',
    title: 'Chat',
    turns: [] as AgentSessionTurn[],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    startedAt: '2026-01-01T00:00:00Z',
  };
  return {
    list: vi.fn().mockResolvedValue({
      sessions: [{ id: 's1', agent: 'brainstorm', title: 'Chat', startedAt: session.startedAt, updatedAt: session.updatedAt, turnCount: 0, relPath: 'Sessions/x.md' }],
    }),
    read: vi.fn().mockResolvedValue({ session }),
    create: vi.fn().mockResolvedValue({ session, relPath: 'Sessions/x.md' }),
    appendTurns: vi.fn().mockImplementation(async (_id: string, turns: AgentSessionTurn[]) => {
      session.turns = [...session.turns, ...turns];
      session.updatedAt = new Date().toISOString();
      return { session: { ...session } };
    }),
    rename: vi.fn().mockResolvedValue({ ok: true }),
    duplicate: vi.fn().mockResolvedValue({ session, relPath: 'Sessions/x.md' }),
    delete: vi.fn().mockResolvedValue({ ok: true }),
  };
}

describe('AgentHubPanel — F3#1 / H1 in-thread partner actions', () => {
  beforeEach(() => {
    __resetAgentSessionStores();
    resetAiActivityForTests();
    resetBrainstormActivityForTests();
    __resetAiEnabledForTests();
    setAiEnabled(true);
    (window as unknown as { api: Record<string, unknown> }).api = {
      suggestionsUnifiedList: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }),
      suggestionsSearch: vi.fn().mockResolvedValue({ suggestions: [] }),
      agentSessions: mockSessionsApi(),
    };
  });
  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api;
    __resetAiEnabledForTests();
  });

  it('Update Timeline posts a card into the partner thread', async () => {
    const timelineRebuild = vi.fn().mockResolvedValue({
      ok: true,
      report: { eventsAdded: 2, eventsUpdated: 1, eventsRemoved: 0, scenesRead: 3, missingSceneIds: [] },
    });
    (window as unknown as { api: Record<string, unknown> }).api = {
      ...(window as unknown as { api: Record<string, unknown> }).api,
      timelineRebuild,
    };
    render(<AgentHubPanel scene={null} story={makeStory()} />);
    fireEvent.click(await screen.findByTestId('ahp-action-update-timeline'));
    await waitFor(() => expect(timelineRebuild).toHaveBeenCalled());
    await waitFor(() => {
      const store = getAgentSessionStore(PARTNER_SESSION_AGENT);
      const turns = store.getSnapshot().activeSession?.turns ?? [];
      expect(turns.some((t) => t.cardTitle === 'Update Timeline' || t.text.includes('Added 2'))).toBe(true);
    });
  });

  it('Beta Read posts a card into the partner thread (no overlay nav)', async () => {
    const betaReportRun = vi.fn().mockResolvedValue({
      report: {
        id: 'r1',
        overall: { score: 80, verdict: 'strong' },
        categories: [{ key: 'pacing', label: 'Pacing', score: 80, verdict: 'strong' }],
        feedback: 'Solid opening.',
        reactions: [],
      },
    });
    const navSpy = vi.fn();
    window.addEventListener('mythos:nav', navSpy);
    (window as unknown as { api: Record<string, unknown> }).api = {
      ...(window as unknown as { api: Record<string, unknown> }).api,
      betaReportRun,
    };
    render(<AgentHubPanel scene={makeScene()} story={makeStory()} />);
    fireEvent.click(await screen.findByTestId('ahp-action-beta-read'));
    await waitFor(() => expect(betaReportRun).toHaveBeenCalled());
    expect(navSpy).not.toHaveBeenCalled();
    window.removeEventListener('mythos:nav', navSpy);
    await waitFor(() => {
      expect(screen.getByText(/Solid opening/)).toBeInTheDocument();
    });
  });

  it('Writer Scan posts tip text into the partner thread (chat stays mounted)', async () => {
    const writingAssistantScanNow = vi.fn().mockResolvedValue({
      tips: [{ text: 'Tighten the opening beat.' }],
    });
    (window as unknown as { api: Record<string, unknown> }).api = {
      ...(window as unknown as { api: Record<string, unknown> }).api,
      writingAssistantScanNow,
    };
    render(<AgentHubPanel scene={makeScene()} story={makeStory()} />);
    expect(screen.getByTestId('ahp-partner-thread')).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId('ahp-action-writer-scan'));
    await waitFor(() => expect(writingAssistantScanNow).toHaveBeenCalled());
    // Partner chat remains — tips strip is additive, not a coach-thread swap.
    expect(screen.getByTestId('ahp-partner-thread')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/Tighten the opening beat/)).toBeInTheDocument();
    });
  });
});
