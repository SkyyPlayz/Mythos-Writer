// Slice B — unified partner shell tests (replaces four-agent hub assertions).
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, afterEach, beforeEach, describe, it, expect } from 'vitest';
import AgentHubPanel, { resolveAgentStatus } from './AgentHubPanel';
import { __resetAgentSessionStores } from './lib/useAgentSessions';
import { resetAiActivityForTests } from './agents/aiActivity';
import { resetBrainstormActivityForTests } from './agents/brainstormActivity';
import { setAiEnabled, __resetAiEnabledForTests } from './hooks/useAiEnabled';
import type { Scene } from './types';

function makeScene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'sc1',
    title: 'Opening',
    order: 0,
    blocks: [{ id: 'b1', type: 'prose', content: 'Hello world from the scene.' }],
    ...overrides,
  } as Scene;
}

describe('AgentHubPanel — Slice B partner shell', () => {
  beforeEach(() => {
    __resetAgentSessionStores();
    resetAiActivityForTests();
    resetBrainstormActivityForTests();
    __resetAiEnabledForTests();
    setAiEnabled(true);
    (window as any).api = {
      suggestionsUnifiedList: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }),
      suggestionsSearch: vi.fn().mockResolvedValue({ suggestions: [] }),
    };
  });
  afterEach(() => {
    delete (window as any).api;
    __resetAiEnabledForTests();
  });

  it('shows partner · Suggestions · Scenes · Notes & Analysis tabs (no AGENTS card)', async () => {
    render(<AgentHubPanel scene={null} />);
    expect(screen.getByTestId('ahp-tab-partner')).toHaveTextContent('Mythos');
    expect(screen.getByTestId('ahp-tab-suggestions')).toHaveTextContent('Suggestions');
    expect(screen.getByTestId('ahp-tab-scenes')).toHaveTextContent('Scenes');
    expect(screen.getByTestId('ahp-tab-notes-analysis')).toHaveTextContent('Notes & Analysis');
    expect(screen.queryByLabelText('Agents')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ahp-agent-row-writing-assistant')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ahp-agent-row-brainstorm')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ahp-agent-row-beta-reader')).not.toBeInTheDocument();
    expect(await screen.findByTestId('partner-card')).toBeInTheDocument();
    expect(screen.getByTestId('ahp-earlier-chats')).toBeInTheDocument();
    expect(screen.getByTestId('ahp-writer-tips')).toBeInTheDocument();
    // N4-A: tips strip keeps WA expanded (no AC-WA-20 icon latch).
    expect(screen.getByLabelText('Heartbeat panel')).toBeInTheDocument();
    expect(screen.getByTestId('ahp-action-update-timeline')).toBeInTheDocument();
    expect(screen.getByTestId('ahp-action-beta-read')).toBeInTheDocument();
    expect(screen.getByTestId('ahp-action-writer-scan')).toBeInTheDocument();
    expect(screen.queryByTestId('ahp-hand-writer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ahp-hand-analyst')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ahp-hand-archivist')).not.toBeInTheDocument();
  });

  it('action buttons post results into the unified partner thread', async () => {
    const timelineRebuild = vi.fn().mockResolvedValue({
      ok: true,
      report: { eventsAdded: 2, eventsUpdated: 1, eventsRemoved: 0, scenesRead: 3, missingSceneIds: [] },
    });
    (window as any).api = {
      ...(window as any).api,
      timelineRebuild,
      agentSessions: {
        list: vi.fn().mockResolvedValue({ sessions: [{ id: 's1', title: 'Chat', updatedAt: new Date().toISOString() }] }),
        get: vi.fn().mockResolvedValue({ id: 's1', title: 'Chat', turns: [], createdAt: '', updatedAt: '' }),
        create: vi.fn().mockResolvedValue({ id: 's1', title: 'Chat', turns: [], createdAt: '', updatedAt: '' }),
        appendTurns: vi.fn().mockResolvedValue({ ok: true }),
        rename: vi.fn().mockResolvedValue({ ok: true }),
        duplicate: vi.fn().mockResolvedValue({ id: 's2' }),
        delete: vi.fn().mockResolvedValue({ ok: true }),
      },
    };
    render(<AgentHubPanel scene={null} />);
    fireEvent.click(await screen.findByTestId('ahp-action-update-timeline'));
    await waitFor(() => expect(timelineRebuild).toHaveBeenCalled());
  });

  it('renames the partner tab from agentNames.brainstorm', () => {
    render(<AgentHubPanel scene={null} agentNames={{ brainstorm: 'Athena' }} />);
    expect(screen.getByTestId('ahp-tab-partner')).toHaveTextContent('Athena');
    expect(screen.getByTestId('partner-card')).toHaveTextContent('Athena');
  });

  it('AI off: Scenes · Notes & Analysis only', () => {
    setAiEnabled(false);
    render(<AgentHubPanel scene={null} />);
    expect(screen.queryByTestId('ahp-tab-partner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ahp-tab-suggestions')).not.toBeInTheDocument();
    expect(screen.getByTestId('ahp-tab-scenes')).toBeInTheDocument();
    expect(screen.getByTestId('ahp-tab-notes-analysis')).toBeInTheDocument();
  });

  it('Suggestions tab mounts SuggestionReview (full list)', async () => {
    render(<AgentHubPanel scene={null} />);
    fireEvent.click(screen.getByTestId('ahp-tab-suggestions'));
    expect(await screen.findByTestId('ahp-suggestions-tab')).toBeInTheDocument();
  });

  it('Notes & Analysis includes Scene Analysis + Questions-for-you', async () => {
    render(<AgentHubPanel scene={makeScene()} />);
    fireEvent.click(screen.getByTestId('ahp-tab-notes-analysis'));
    expect(await screen.findByTestId('ahp-notes-analysis')).toBeInTheDocument();
    expect(screen.getByLabelText('Scene Analysis')).toBeInTheDocument();
    expect(screen.getByTestId('questions-for-you')).toBeInTheDocument();
    expect(screen.getByTestId('qfy-subtab-activity')).toBeInTheDocument();
    expect(screen.getByTestId('qfy-subtab-notes')).toBeInTheDocument();
    expect(screen.getByTestId('qfy-subtab-story')).toBeInTheDocument();
  });

  it('Questions-for-you asks Which note? when target is ambiguous', async () => {
    render(<AgentHubPanel scene={null} />);
    fireEvent.click(screen.getByTestId('ahp-tab-notes-analysis'));
    fireEvent.click(await screen.findByTestId('qfy-subtab-notes'));
    fireEvent.click(await screen.findByTestId('qfy-question-nq-gap-1'));
    expect(screen.getByTestId('qfy-note-picker')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('qfy-answer-input'), { target: { value: 'Mara holds it.' } });
    fireEvent.click(screen.getByTestId('qfy-append'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Which note/i);
  });

  it('call chrome starts in-panel (no navigate-away)', async () => {
    render(<AgentHubPanel scene={null} />);
    fireEvent.click(screen.getByTestId('partner-start-call'));
    expect(screen.getByTestId('partner-card')).toHaveAttribute('data-on-call', 'true');
    expect(screen.getByTestId('partner-call-mute')).toBeInTheDocument();
    expect(screen.getByTestId('partner-end-call')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('partner-call-mute'));
    expect(screen.getByTestId('partner-card-status')).toHaveTextContent('MUTED');
    fireEvent.click(screen.getByTestId('partner-end-call'));
    await waitFor(() => {
      expect(screen.getByTestId('partner-card')).not.toHaveAttribute('data-on-call');
    });
  });

  it('Update Timeline action runs via the unified partner (no persona hand chips)', async () => {
    const timelineRebuild = vi.fn().mockResolvedValue({
      ok: true,
      report: { eventsAdded: 1, eventsUpdated: 0, eventsRemoved: 0, scenesRead: 1, missingSceneIds: [] },
    });
    (window as any).api = {
      ...(window as any).api,
      timelineRebuild,
    };
    render(<AgentHubPanel scene={null} />);
    expect(screen.queryByTestId('ahp-hand-analyst')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByTestId('ahp-action-update-timeline'));
    await waitFor(() => expect(timelineRebuild).toHaveBeenCalled());
  });
});

describe('resolveAgentStatus (hand engines)', () => {
  const idleBrainstorm = {
    active: false,
    hasError: false,
    factsCount: 0,
    lastActionText: null,
  };

  it('disabled beats pending', () => {
    expect(resolveAgentStatus('writing-assistant', {
      enabled: false,
      pendingCount: 3,
      continuityCount: 0,
      activeEntry: null,
      recentTerminal: null,
      brainstormActivity: idleBrainstorm,
    }).text).toBe('Disabled');
  });

  it('archive shows open flag count', () => {
    expect(resolveAgentStatus('archive', {
      enabled: true,
      pendingCount: 0,
      continuityCount: 2,
      activeEntry: null,
      recentTerminal: null,
      brainstormActivity: idleBrainstorm,
    }).text).toBe('2 flags open');
  });
});
