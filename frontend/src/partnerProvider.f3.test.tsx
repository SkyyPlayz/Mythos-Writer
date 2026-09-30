/**
 * Probe P4 / Ivy — per-action provider routing.
 * Coach / Beta Read / Writer Scan / Full Analysis never hit brainstorm when
 * their own agent is local and brainstorm is cloud.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { __resetAgentSessionStores, getAgentSessionStore } from './lib/useAgentSessions';
import { useCoachConversation } from './coach/useCoachConversation';
import { runPartnerAction } from './AgentHubPanel';
import { runFullSceneAnalysis } from './coach/sceneAnalysis';
import { decodeCoachCard } from './coach/coachMessages';
import { PARTNER_SESSION_AGENT } from './agents/partnerIdentity';
import {
  assertAgentProviderReady,
  PartnerProviderRefuseError,
  resolveAgentProvider,
} from './agents/partnerProviderGate';
import type { Scene, Story } from './types';

function localCloudSettings(): AppSettings {
  return {
    provider: { kind: 'anthropic', model: 'claude-haiku' },
    agents: {
      writingAssistant: {
        enabled: true,
        model: 'qwen-local',
        provider: { kind: 'ollama', model: 'qwen-local' },
      },
      brainstorm: {
        enabled: true,
        model: 'claude-haiku',
        provider: { kind: 'anthropic', model: 'claude-haiku', apiKey: 'sk-cloud' },
      },
      archive: { enabled: true, model: 'x' },
      betaReader: {
        enabled: true,
        model: 'qwen-local',
        provider: { kind: 'ollama', model: 'qwen-local' },
      },
    },
  } as AppSettings;
}

function installApi(settings: AppSettings) {
  const agentBrainstorm = vi.fn().mockResolvedValue({ text: 'CLOUD LEAK' });
  const agentWritingAssistant = vi.fn().mockResolvedValue({
    text: JSON.stringify({
      purpose: 'p', tension: 't', pacing: 'pa', pov: 'po', takeaway: 'tk', drill: 'd',
    }),
  });
  const writingAssistantScanNow = vi.fn().mockResolvedValue({ tips: ['Tighten the opener.'] });
  const betaReportRun = vi.fn().mockResolvedValue({
    report: {
      id: 'r1',
      storyId: 'st1',
      scope: { kind: 'scene', id: 'sc1', label: 'Sc' },
      focus: { pacing: true, clarity: true, character: true, plot: true },
      overall: { score: 80, verdict: 'strong' },
      categories: [],
      feedback: 'Local beta feedback.',
      reactions: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  });
  const session: AgentSessionFile = {
    id: 's1',
    agent: 'brainstorm',
    title: 'Chat',
    turns: [],
    startedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  (window as unknown as { api: Record<string, unknown> }).api = {
    settingsGet: vi.fn().mockResolvedValue(settings),
    agentBrainstorm,
    agentWritingAssistant,
    writingAssistantScanNow,
    betaReportRun,
    agentSessions: {
      list: vi.fn().mockResolvedValue({ sessions: [] }),
      read: vi.fn().mockResolvedValue({ session: null }),
      create: vi.fn().mockResolvedValue({ session, relPath: 'Sessions/x.md' }),
      appendTurns: vi.fn().mockImplementation(async (_id: string, turns: AgentSessionTurn[]) => {
        session.turns = [...session.turns, ...turns];
        return { session: { ...session } };
      }),
      rename: vi.fn().mockResolvedValue({ ok: true }),
      duplicate: vi.fn().mockResolvedValue({ session, relPath: 'Sessions/y.md' }),
      delete: vi.fn().mockResolvedValue({ ok: true }),
    },
  };
  return { agentBrainstorm, agentWritingAssistant, writingAssistantScanNow, betaReportRun };
}

const scene = {
  id: 'sc1',
  title: 'Harbor',
  path: 'scenes/sc1.md',
  order: 0,
  blocks: [{ id: 'b1', type: 'prose' as const, content: 'The lantern flickered.', order: 0, updatedAt: '2026-01-01T00:00:00.000Z' }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} satisfies Scene;

const story: Story = {
  id: 'st1',
  title: 'Book',
  path: 'stories/st1',
  chapters: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('F3 provider privacy — per-action routing', () => {
  beforeEach(() => {
    __resetAgentSessionStores();
  });
  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api;
  });

  it('resolves writingAssistant/betaReader local while brainstorm is cloud', () => {
    const s = localCloudSettings();
    expect(resolveAgentProvider(s, 'writingAssistant')?.kind).toBe('ollama');
    expect(resolveAgentProvider(s, 'betaReader')?.kind).toBe('ollama');
    expect(resolveAgentProvider(s, 'brainstorm')?.kind).toBe('anthropic');
  });

  it('refuses when writingAssistant provider cannot resolve (no fallback)', () => {
    const s = {
      provider: undefined,
      agents: {
        writingAssistant: { enabled: true, model: '' },
        brainstorm: { enabled: true, model: 'x', provider: { kind: 'anthropic', model: 'c' } },
        archive: { enabled: true, model: 'x' },
      },
    } as unknown as AppSettings;
    expect(() => assertAgentProviderReady(s, 'writingAssistant')).toThrow(PartnerProviderRefuseError);
  });

  it('Critic hard 5: accepts legacy settings.apiKey when provider block is absent', () => {
    const s = {
      apiKey: 'sk-legacy-from-secrets',
      provider: undefined,
      agents: {
        writingAssistant: { enabled: true, model: '' },
        brainstorm: { enabled: true, model: 'x' },
        archive: { enabled: true, model: 'x' },
      },
    } as unknown as AppSettings;
    const resolved = resolveAgentProvider(s, 'writingAssistant');
    expect(resolved?.kind).toBe('anthropic');
    expect(resolved?.model).toBeTruthy();
    expect(() => assertAgentProviderReady(s, 'writingAssistant')).not.toThrow();
  });

  it('Critic hard 5: accepts ANTHROPIC_API_KEY env when settings.apiKey empty', () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-env-key';
    try {
      const s = {
        apiKey: '',
        provider: undefined,
        agents: {
          writingAssistant: { enabled: true, model: '' },
          brainstorm: { enabled: true, model: 'x' },
          archive: { enabled: true, model: 'x' },
        },
      } as unknown as AppSettings;
      expect(resolveAgentProvider(s, 'writingAssistant')?.kind).toBe('anthropic');
      expect(() => assertAgentProviderReady(s, 'betaReader')).not.toThrow();
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it('Coach chat (local WA) never calls agentBrainstorm when brainstorm is cloud', async () => {
    const { agentBrainstorm, agentWritingAssistant } = installApi(localCloudSettings());
    const { result } = renderHook(() => useCoachConversation(scene));
    await waitFor(() => expect(result.current.store.loading).toBe(false));
    await act(async () => {
      await result.current.send('How is the pacing?');
    });
    expect(agentWritingAssistant).toHaveBeenCalled();
    expect(agentBrainstorm).not.toHaveBeenCalled();
    const ctx = agentWritingAssistant.mock.calls[0][1] as string;
    expect(ctx).toContain('The lantern flickered');
  });

  it('Writer Scan never calls agentBrainstorm', async () => {
    const { agentBrainstorm, writingAssistantScanNow } = installApi(localCloudSettings());
    const out = await runPartnerAction('writer-scan', { scene, story });
    expect(writingAssistantScanNow).toHaveBeenCalled();
    expect(agentBrainstorm).not.toHaveBeenCalled();
    expect(out.cardTitle).toBe('Writer Scan');
    expect(out.text).toContain('Tighten');
  });

  it('Beta Read never calls agentBrainstorm', async () => {
    const { agentBrainstorm, betaReportRun } = installApi(localCloudSettings());
    const out = await runPartnerAction('beta-read', { scene, story });
    expect(betaReportRun).toHaveBeenCalled();
    expect(agentBrainstorm).not.toHaveBeenCalled();
    expect(out.text).toContain('Local beta feedback');
  });

  it('N3: empty Beta Read source text → inline notice, no betaReportRun IPC', async () => {
    const { betaReportRun } = installApi(localCloudSettings());
    const emptyScene = {
      ...scene,
      blocks: [{ id: 'b1', type: 'prose' as const, content: '   ', order: 0, updatedAt: '2026-01-01T00:00:00.000Z' }],
    };
    const out = await runPartnerAction('beta-read', { scene: emptyScene, story });
    expect(betaReportRun).not.toHaveBeenCalled();
    expect(out.cardTitle).toBe('Beta Read');
    expect(out.text).toMatch(/nothing to read/i);
  });

  it('N3 soft: empty-scene Writer Scan → notice, no scan IPC', async () => {
    const { writingAssistantScanNow } = installApi(localCloudSettings());
    const emptyScene = {
      ...scene,
      blocks: [{ id: 'b1', type: 'prose' as const, content: '', order: 0, updatedAt: '2026-01-01T00:00:00.000Z' }],
    };
    const out = await runPartnerAction('writer-scan', { scene: emptyScene, story });
    expect(writingAssistantScanNow).not.toHaveBeenCalled();
    expect(out.text).toMatch(/no prose/i);
  });

  it('Full Analysis never calls agentBrainstorm', async () => {
    const { agentBrainstorm, agentWritingAssistant } = installApi(localCloudSettings());
    await runFullSceneAnalysis(scene);
    expect(agentWritingAssistant).toHaveBeenCalled();
    expect(agentBrainstorm).not.toHaveBeenCalled();
  });

  it('break-it: pointing Coach invoke at brainstorm would call cloud (guard must stay WA)', async () => {
    // Documents the red case — if Coach wrongly used invokeBrainstorm, cloud fires.
    const { agentBrainstorm, agentWritingAssistant } = installApi(localCloudSettings());
    agentBrainstorm.mockResolvedValue({ text: 'leaked' });
    // Simulate the forbidden path once to prove the spy catches it.
    await window.api!.agentBrainstorm!('oops', []);
    expect(agentBrainstorm).toHaveBeenCalled();
    // Real Coach path must not add another brainstorm call.
    agentBrainstorm.mockClear();
    const { result } = renderHook(() => useCoachConversation(scene));
    await waitFor(() => expect(result.current.store.loading).toBe(false));
    await act(async () => {
      await result.current.send('safe');
    });
    expect(agentBrainstorm).not.toHaveBeenCalled();
    expect(agentWritingAssistant).toHaveBeenCalled();
  });
});

function noProviderSettings(): AppSettings {
  return {
    apiKey: '',
    provider: undefined,
    agents: {
      writingAssistant: { enabled: true, model: '' },
      brainstorm: { enabled: true, model: 'x' },
      archive: { enabled: true, model: 'x' },
      betaReader: { enabled: true, model: '' },
    },
  } as unknown as AppSettings;
}

describe('Probe H2 — per-call-site refuseUnlessProviderReady (red on revert)', () => {
  beforeEach(() => {
    __resetAgentSessionStores();
  });
  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api;
  });

  it('Writer Scan call site refuses with no provider and makes 0 scan IPC', async () => {
    const { writingAssistantScanNow, agentBrainstorm, betaReportRun } = installApi(noProviderSettings());
    await expect(runPartnerAction('writer-scan', { scene, story })).rejects.toThrow(/Cannot run this action|no provider/i);
    expect(writingAssistantScanNow).not.toHaveBeenCalled();
    expect(agentBrainstorm).not.toHaveBeenCalled();
    expect(betaReportRun).not.toHaveBeenCalled();
  });

  it('Beta Read call site refuses with no provider and makes 0 beta IPC', async () => {
    const { betaReportRun, agentBrainstorm, writingAssistantScanNow } = installApi(noProviderSettings());
    await expect(runPartnerAction('beta-read', { scene, story })).rejects.toThrow(/Cannot run this action|no provider/i);
    expect(betaReportRun).not.toHaveBeenCalled();
    expect(agentBrainstorm).not.toHaveBeenCalled();
    expect(writingAssistantScanNow).not.toHaveBeenCalled();
  });

  it('Full Analysis call site refuses with no provider and makes 0 WA IPC', async () => {
    const { agentWritingAssistant, agentBrainstorm } = installApi(noProviderSettings());
    // Full Analysis appends an unavailable card rather than throwing — refuse path still blocks IPC.
    const outcome = await runFullSceneAnalysis(scene);
    expect(outcome).toBe('appended');
    expect(agentWritingAssistant).not.toHaveBeenCalled();
    expect(agentBrainstorm).not.toHaveBeenCalled();
    const turns = getAgentSessionStore(PARTNER_SESSION_AGENT).getSnapshot().activeSession?.turns ?? [];
    const analysis = turns.find((t) => t.cardKind === 'analysis');
    expect(analysis).toBeTruthy();
    const card = decodeCoachCard(analysis!.text);
    expect(card && 'readNote' in card ? card.readNote : '').toMatch(/Cannot run this action|no provider/i);
  });

  it('Coach invoke call site refuses with no provider and makes 0 WA IPC', async () => {
    const { agentWritingAssistant, agentBrainstorm } = installApi(noProviderSettings());
    const { result } = renderHook(() => useCoachConversation(scene));
    await waitFor(() => expect(result.current.store.loading).toBe(false));
    await act(async () => {
      await result.current.send('How is the pacing?');
    });
    expect(agentWritingAssistant).not.toHaveBeenCalled();
    expect(agentBrainstorm).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/Cannot run this action|no provider/i);
  });
});
