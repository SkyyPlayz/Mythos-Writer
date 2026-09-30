/**
 * Critic hard 4 — Coach prompt character budget (separate from Shield S1 turn cap).
 */
import { describe, it, expect } from 'vitest';
import {
  buildCoachInvokePrompt,
  COACH_PROMPT_CHAR_BUDGET,
  formatHistoryForWritingAssistant,
} from './coachInvoke';
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
