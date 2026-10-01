/**
 * Critic hard 4 — Coach prompt character budget (separate from Shield S1 turn cap).
 * Shield batch R4 / residual 6 — WA slot pin + `{error}` handling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildCoachInvokePrompt,
  COACH_INVOKE_PROVIDER_SLOT,
  COACH_PROMPT_CHAR_BUDGET,
  formatHistoryForWritingAssistant,
  makeCoachInvoke,
  turnsToCoachHistory,
} from './coachInvoke';
import { encodeCoachCard } from '../coach/coachMessages';
import { MAX_HISTORY_TURNS } from '../timeline2/panel/useMiniAgentChat';

describe('coachInvoke character budget (Critic hard 4 / N1)', () => {
  it('COACH_PROMPT_CHAR_BUDGET stays under main MAX_AGENT_PROMPT_LENGTH (32000)', () => {
    expect(COACH_PROMPT_CHAR_BUDGET).toBeLessThan(32_000);
    expect(COACH_PROMPT_CHAR_BUDGET).toBeGreaterThan(20_000);
  });

  it('trims oldest history when folded prompt would exceed the budget', () => {
    const fat = 'X'.repeat(4_000);
    const history = Array.from({ length: MAX_HISTORY_TURNS }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `${fat}-${i}`,
    }));
    const uncapped = `${formatHistoryForWritingAssistant(history)}\n\nUser: final`;
    expect(uncapped.length).toBeGreaterThan(COACH_PROMPT_CHAR_BUDGET);

    const composed = buildCoachInvokePrompt('final', history);
    expect(composed.length).toBeLessThanOrEqual(COACH_PROMPT_CHAR_BUDGET);
    expect(composed.endsWith('User: final') || composed === 'final').toBe(true);
    // Oldest fat turn dropped.
    expect(composed).not.toContain(`${fat}-0`);
    // Newest history turn still present when budget allows.
    expect(composed).toContain(`${fat}-${MAX_HISTORY_TURNS - 1}`);
  });

  it('turn-cap window is unchanged when under budget (does not loosen Shield S1)', () => {
    const history = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `short-${i}`,
    }));
    const composed = buildCoachInvokePrompt('final coach prompt', history);
    const entries = composed.split(/\n\n/);
    expect(entries).toHaveLength(MAX_HISTORY_TURNS + 1);
    expect(entries[entries.length - 1]).toBe('User: final coach prompt');
  });
});

describe('turnsToCoachHistory — Critic soft pin (Coach path)', () => {
  it('strips raw coach-card marker JSON from structural analysis turns (RED if strip removed)', () => {
    const encoded = encodeCoachCard({
      kind: 'analysis',
      title: 'Full Scene Analysis — Harbor',
      computed: [['Words', '12']],
      read: [],
      takeaway: 'Lean into the fog.',
    });
    const history = turnsToCoachHistory([
      { role: 'user', text: 'Analyze', at: '2026-01-01T00:00:00.000Z' },
      {
        role: 'agent',
        text: encoded,
        at: '2026-01-01T00:00:01.000Z',
        cardKind: 'analysis',
        cardTitle: 'Full Scene Analysis — Harbor',
      },
    ]);
    expect(history).toHaveLength(2);
    expect(history[1].role).toBe('assistant');
    expect(history[1].content).toContain('Lean into the fog');
    expect(history[1].content).not.toContain('mythos:coach-card');
    expect(history[1].content).not.toMatch(/\{"kind":"analysis"/);
  });

  /**
   * Critic r6 BLOCKER — CoachPage (`useCoachConversation` → `turnsToCoachHistory`)
   * never passes sessionAgent. Legacy coach turns have no cardKind; history must
   * still strip marker+JSON. RED if `historyContentForModel` re-gates on coach.
   */
  it('CoachPage path: strips no-cardKind legacy marker without sessionAgent (RED if sessionAgent gate restored)', () => {
    const encoded = encodeCoachCard({
      kind: 'analysis',
      title: 'Full Scene Analysis — Undercity',
      computed: [['Words', '10']],
      read: [],
      takeaway: 'Main-format must not reach the model raw.',
    });
    // Mirrors useCoachConversation.ts:53 — turnsToCoachHistory(turns) with no opts.
    const history = turnsToCoachHistory([
      { role: 'user', text: 'Analyze this scene', at: '2026-01-01T00:00:00.000Z' },
      {
        role: 'agent',
        text: encoded,
        at: '2026-01-01T00:00:01.000Z',
        // no cardKind — main-saved legacy coach format
      },
    ]);
    expect(history).toHaveLength(2);
    expect(history[1].role).toBe('assistant');
    expect(history[1].content).toContain('Main-format must not reach the model raw');
    expect(history[1].content).toContain('Full Scene Analysis — Undercity');
    expect(history[1].content).not.toContain('mythos:coach-card');
    expect(history[1].content).not.toMatch(/\{"kind":"analysis"/);
    expect(history[1].content).not.toBe(encoded);
  });

  it('caps to MAX_HISTORY_TURNS (RED if cap removed or bypassed)', () => {
    const turns = Array.from({ length: MAX_HISTORY_TURNS + 5 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'agent') as 'user' | 'agent',
      text: `t-${i}`,
      at: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`,
    }));
    expect(turnsToCoachHistory(turns)).toHaveLength(MAX_HISTORY_TURNS);
  });
});

describe('makeCoachInvoke — Shield batch R4 / residual 6', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('R4: COACH_INVOKE_PROVIDER_SLOT is writingAssistant (not brainstorm)', () => {
    expect(COACH_INVOKE_PROVIDER_SLOT).toBe('writingAssistant');
    expect(COACH_INVOKE_PROVIDER_SLOT).not.toBe('brainstorm');
  });

  it('R4: refuses when writingAssistant missing even if brainstorm is ready', async () => {
    const agentWritingAssistant = vi.fn(async () => ({ text: 'should not run' }));
    Object.defineProperty(window, 'api', {
      value: {
        settingsGet: vi.fn(async () => ({
          // No global/legacy Anthropic — WA cannot resolve.
          apiKey: '',
          anthropicEnvKeyPresent: false,
          agents: {
            writingAssistant: { enabled: true, model: '' },
            // Brainstorm has its own cloud override — would be ready if gate pointed there.
            brainstorm: {
              enabled: true,
              model: 'c',
              provider: { kind: 'anthropic', model: 'c', apiKey: 'sk-test' },
            },
          },
        })),
        agentWritingAssistant,
      },
      writable: true,
      configurable: true,
    });
    const invoke = makeCoachInvoke(() => undefined);
    await expect(invoke('hi', [])).rejects.toThrow(/writingAssistant/);
    expect(agentWritingAssistant).not.toHaveBeenCalled();
  });

  it('residual 6: throws on wrapIpcHandler `{ error }` (does not return undefined text)', async () => {
    const agentWritingAssistant = vi.fn(async () => ({ error: 'provider down' }));
    Object.defineProperty(window, 'api', {
      value: {
        settingsGet: vi.fn(async () => ({
          provider: { kind: 'ollama', model: 'qwen' },
          agents: {
            writingAssistant: {
              enabled: true,
              model: 'qwen',
              provider: { kind: 'ollama', model: 'qwen' },
            },
          },
        })),
        agentWritingAssistant,
      },
      writable: true,
      configurable: true,
    });
    const invoke = makeCoachInvoke(() => 'Scene: "X"');
    await expect(invoke('hi', [])).rejects.toThrow(/provider down/);
  });

  it('calls agentWritingAssistant (never agentBrainstorm) on success', async () => {
    const agentWritingAssistant = vi.fn(async () => ({ text: 'coach reply' }));
    const agentBrainstorm = vi.fn(async () => ({ text: 'wrong' }));
    Object.defineProperty(window, 'api', {
      value: {
        settingsGet: vi.fn(async () => ({
          provider: { kind: 'ollama', model: 'qwen' },
          agents: {
            writingAssistant: {
              enabled: true,
              model: 'qwen',
              provider: { kind: 'ollama', model: 'qwen' },
            },
          },
        })),
        agentWritingAssistant,
        agentBrainstorm,
      },
      writable: true,
      configurable: true,
    });
    const invoke = makeCoachInvoke(() => undefined);
    await expect(invoke('hi', [])).resolves.toBe('coach reply');
    expect(agentWritingAssistant).toHaveBeenCalled();
    expect(agentBrainstorm).not.toHaveBeenCalled();
  });
});
