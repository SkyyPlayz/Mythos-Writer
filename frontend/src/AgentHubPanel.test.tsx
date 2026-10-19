// Slice B — unified partner shell tests (replaces four-agent hub assertions).
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
    const card = await screen.findByTestId('partner-card');
    expect(card).toBeInTheDocument();
    // Probe #3 — PAST CHATS & CALLS lives inside the partner header card.
    expect(card.querySelector('[data-testid="ahp-past-chats"]')).toBeTruthy();
    expect(screen.getByTestId('ahp-past-chats')).toBeInTheDocument();
    expect(screen.getByTestId('ahp-past-chats-toggle')).toHaveTextContent(/Past chats/i);
    // Active session pill stays mounted without expanding Past chats (TC-8537-02).
    expect(screen.getByTestId('ahp-past-chats-menu')).toBeInTheDocument();
    expect(screen.getByTestId('ahp-past-chats').querySelector('.asp-pill-label')).toBeTruthy();
    const closedPill = within(card).getByRole('button', { name: /Session:/ });
    expect(closedPill.closest('[aria-hidden="true"]')).toBeNull();
    expect(screen.queryByTestId('ahp-writer-tips')).not.toBeInTheDocument();
    expect(screen.getByTestId('ahp-action-beta-read')).toBeInTheDocument();
    expect(screen.getByTestId('ahp-action-continuity')).toBeInTheDocument();
    expect(screen.getByTestId('ahp-action-notes-to-timeline')).toBeInTheDocument();
    expect(screen.getByTestId('ahp-action-timeline-to-notes')).toBeInTheDocument();
    expect(screen.queryByTestId('ahp-hand-writer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ahp-hand-analyst')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ahp-hand-archivist')).not.toBeInTheDocument();
  });

  it('Escape in a contenteditable outside past chats does not move focus', async () => {
    render(
      <div>
        <AgentHubPanel scene={null} onOpenPartnerHistory={() => {}} />
        <div
          contentEditable
          suppressContentEditableWarning
          data-testid="manuscript-outside"
        />
      </div>,
    );
    const card = await screen.findByTestId('partner-card');
    const toggle = within(card).getByTestId('ahp-past-chats-toggle');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const manuscript = screen.getByTestId('manuscript-outside');
    manuscript.focus();
    expect(manuscript).toHaveFocus();

    fireEvent.keyDown(manuscript, { key: 'Escape' });

    expect(manuscript).toHaveFocus();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('past chats opens as a disclosure and closes on Escape inside it', async () => {
    render(<AgentHubPanel scene={null} onOpenPartnerHistory={() => {}} />);
    const card = await screen.findByTestId('partner-card');
    const toggle = within(card).getByTestId('ahp-past-chats-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'ahp-past-chats-history');
    expect(toggle).not.toHaveAttribute('aria-haspopup');
    const panel = within(card).getByTestId('ahp-past-chats-menu');
    expect(panel).not.toHaveAttribute('role');
    // Session pill stays mounted while the disclosure is closed (TC-8537-02).
    expect(panel).toBeInTheDocument();
    const pill = within(card).getByRole('button', { name: /Session:/ });
    expect(pill.closest('[aria-hidden="true"]')).toBeNull();
    expect(within(card).queryByTestId('ahp-partner-history-link')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const history = within(card).getByTestId('ahp-partner-history-link');
    expect(history).not.toHaveAttribute('role');
    expect(pill).toBeInTheDocument();

    fireEvent.keyDown(toggle, { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
    expect(within(card).queryByTestId('ahp-partner-history-link')).not.toBeInTheDocument();
    expect(within(card).getByTestId('ahp-past-chats-menu')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /Session:/ }).closest('[aria-hidden="true"]')).toBeNull();
  });

  it('tab order is header controls, then past chats, in both call layouts', async () => {
    render(<AgentHubPanel scene={null} onOpenPartnerHistory={() => {}} />);
    const card = await screen.findByTestId('partner-card');
    const names = (root: HTMLElement) => Array.from(
      root.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea'),
    )
      .filter((el) => el.tabIndex >= 0 && !el.hasAttribute('disabled') && el.closest('[aria-hidden="true"]') === null)
      .map((el) => el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.tagName);

    const idle = names(card);
    const start = idle.indexOf('partner-start-call');
    const toggle = idle.indexOf('ahp-past-chats-toggle');
    const pill = idle.findIndex((name) => name.startsWith('Session:'));
    expect(start).toBeGreaterThanOrEqual(0);
    expect(toggle).toBeGreaterThan(start);
    expect(pill).toBeGreaterThan(toggle);

    fireEvent.click(within(card).getByTestId('partner-start-call'));
    const onCall = names(card);
    const past = onCall.indexOf('ahp-past-chats-toggle');
    const pillOnCall = onCall.findIndex((name) => name.startsWith('Session:'));
    for (const id of ['partner-call-transcript', 'partner-call-mute', 'partner-call-settings', 'partner-end-call']) {
      expect(onCall.indexOf(id)).toBeGreaterThanOrEqual(0);
      expect(onCall.indexOf(id)).toBeLessThan(past);
    }
    expect(pillOnCall).toBeGreaterThan(past);
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
    fireEvent.click(await screen.findByTestId('ahp-action-notes-to-timeline'));
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

  it('Notes→timeline quick command runs via the unified partner (no persona hand chips)', async () => {
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
    fireEvent.click(await screen.findByTestId('ahp-action-notes-to-timeline'));
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
