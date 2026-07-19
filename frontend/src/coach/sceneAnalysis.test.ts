// Beta 4 M13 — Full Scene Analysis flow tests (§5.4, §14.7).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildSceneAnalysisTitle,
  buildCoachReadPrompt,
  extractFirstJsonObject,
  parseCoachRead,
  buildAnalysisCard,
  runFullSceneAnalysis,
  latestAnalysisCardForScene,
  compactReadValue,
  isSceneAnalysisPending,
  READ_UNAVAILABLE_NOTE,
} from './sceneAnalysis';
import { decodeCoachCard, encodeCoachCard } from './coachMessages';
import { __resetAgentSessionStores } from '../lib/useAgentSessions';
import type { Scene } from '../types';

const AT = '2026-07-01T00:00:00.000Z';

function makeScene(): Scene {
  return {
    id: 'sc-2',
    title: 'Into the Undercity',
    path: 'Manuscript/ch-2/sc-2.md',
    order: 1,
    blocks: [
      {
        id: 'b1',
        type: 'prose',
        content: 'She felt the dark press close. “Run,” he said sharply. Mira sprinted for the stairs.',
        order: 0,
        updatedAt: AT,
      },
    ],
    createdAt: AT,
    updatedAt: AT,
  };
}

const GOOD_READ_JSON = JSON.stringify({
  purpose: 'Story progression — the descent commits Mira to the Undercity',
  tension: 'Rising — steady climb after the token beat; no release valve yet',
  pacing: 'Medium — slows at the market crowd; tightest at the stairwell',
  pov: 'Third limited (Mira) — drifts once in the patrol paragraph',
  takeaway: 'Strongest scene so far on atmosphere. Pull the risk forward and this scene sings.',
  drill: 'Drill: mark every paragraph D, A or T. Break any DDD run with motion. 5 minutes.',
});

interface MockApiOptions {
  turns?: AgentSessionTurn[];
  chatResponse?: string;
  chatError?: Error;
  omitChat?: boolean;
}

function installMockApi(opts: MockApiOptions = {}) {
  const session: AgentSessionFile = {
    id: 'coach-s1',
    agent: 'coach',
    title: 'Lesson thread',
    startedAt: AT,
    updatedAt: AT,
    turns: opts.turns ?? [],
  };
  const calls: string[] = [];
  const agentSessions = {
    list: vi.fn(async () => { calls.push('agentSessions.list'); return { sessions: [{ id: session.id, agent: 'coach', title: session.title, startedAt: AT, updatedAt: AT, turnCount: session.turns.length, relPath: 'Sessions/x.md' }] }; }),
    create: vi.fn(async () => { calls.push('agentSessions.create'); return { session, relPath: 'Sessions/x.md' }; }),
    rename: vi.fn(async () => ({ ok: true })),
    duplicate: vi.fn(async () => ({ session, relPath: 'Sessions/x.md' })),
    delete: vi.fn(async () => ({ ok: true })),
    read: vi.fn(async () => { calls.push('agentSessions.read'); return { session }; }),
    appendTurns: vi.fn(async (_id: string, turns: AgentSessionTurn[]) => {
      calls.push('agentSessions.appendTurns');
      session.turns = [...session.turns, ...turns];
      return { session: { ...session } };
    }),
  };
  const agentWritingAssistant = vi.fn(async () => {
    calls.push('agentWritingAssistant');
    if (opts.chatError) throw opts.chatError;
    return { text: opts.chatResponse ?? GOOD_READ_JSON };
  });
  const api: Record<string, unknown> = { agentSessions };
  if (!opts.omitChat) api.agentWritingAssistant = agentWritingAssistant;
  (window as unknown as Record<string, unknown>).api = api;
  return { agentSessions, agentWritingAssistant, session, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetAgentSessionStores();
  delete (window as unknown as Record<string, unknown>).api;
});

// ── Title / prompt ──────────────────────────────────────────────────────────

describe('buildSceneAnalysisTitle', () => {
  it('matches the prototype title shape (Sc. N is 1-based)', () => {
    expect(buildSceneAnalysisTitle(makeScene())).toBe('Full Scene Analysis — Sc. 2 · Into the Undercity');
  });
});

describe('buildCoachReadPrompt (the M13 agent prompt)', () => {
  const prompt = buildCoachReadPrompt();

  it('asks for all four judgment fields plus takeaway and drill', () => {
    for (const key of ['"purpose"', '"tension"', '"pacing"', '"pov"', '"takeaway"', '"drill"']) {
      expect(prompt).toContain(key);
    }
  });

  it('demands teaching clauses and JSON-only output', () => {
    expect(prompt).toMatch(/teaching clause/);
    expect(prompt).toMatch(/ONLY a JSON object/);
  });

  it('restates the agent contract — the coach never writes prose (§14.6)', () => {
    expect(prompt).toMatch(/never rewrite the scene or generate manuscript prose/);
  });
});

// ── Parsing ─────────────────────────────────────────────────────────────────

describe('extractFirstJsonObject', () => {
  it('parses a bare JSON object', () => {
    expect(extractFirstJsonObject('{"a": 1}')).toEqual({ a: 1 });
  });

  it('parses an object wrapped in prose and code fences', () => {
    const text = 'Here is my read:\n```json\n{"purpose": "x — y"}\n```\nHope that helps!';
    expect(extractFirstJsonObject(text)).toEqual({ purpose: 'x — y' });
  });

  it('handles braces inside quoted strings', () => {
    expect(extractFirstJsonObject('{"a": "curly } inside", "b": 2}'))
      .toEqual({ a: 'curly } inside', b: 2 });
  });

  it('skips malformed candidates and finds a later valid object', () => {
    expect(extractFirstJsonObject('{oops} then {"ok": true}')).toEqual({ ok: true });
  });

  it('returns null when no object exists', () => {
    expect(extractFirstJsonObject('no json here')).toBeNull();
    expect(extractFirstJsonObject('[1, 2, 3]')).toBeNull();
  });
});

describe('parseCoachRead', () => {
  it('maps the four fields to labelled rows in prototype order', () => {
    const parsed = parseCoachRead(GOOD_READ_JSON);
    expect(parsed).not.toBeNull();
    expect(parsed!.read.map(([k]) => k)).toEqual(['Purpose', 'Tension', 'Pacing', 'POV']);
    expect(parsed!.read[1][1]).toMatch(/^Rising/);
    expect(parsed!.takeaway).toMatch(/Strongest scene/);
    expect(parsed!.drill).toMatch(/^Drill:/);
  });

  it('keeps partial reads (missing fields are simply absent)', () => {
    const parsed = parseCoachRead('{"purpose": "Setup — plants the token", "takeaway": "Good bones."}');
    expect(parsed!.read).toEqual([['Purpose', 'Setup — plants the token']]);
    expect(parsed!.takeaway).toBe('Good bones.');
    expect(parsed!.drill).toBeUndefined();
  });

  it('returns null for prose-only or empty responses (treated as unavailable)', () => {
    expect(parseCoachRead('I cannot answer in JSON, sorry.')).toBeNull();
    expect(parseCoachRead('{"takeaway": "no judgments"}')).toBeNull();
    expect(parseCoachRead('')).toBeNull();
  });
});

// ── Card assembly ───────────────────────────────────────────────────────────

describe('buildAnalysisCard', () => {
  it('carries both sections when the AI read succeeded', () => {
    const card = buildAnalysisCard(makeScene(), parseCoachRead(GOOD_READ_JSON)!);
    expect(card.kind).toBe('analysis');
    expect(card.title).toBe('Full Scene Analysis — Sc. 2 · Into the Undercity');
    expect(card.computed).toHaveLength(6);
    expect(card.computed[0][0]).toBe('Words');
    expect(card.read).toHaveLength(4);
    expect(card.readNote).toBeUndefined();
    expect(card.drill).toMatch(/^Drill:/);
  });

  it('AI disabled: computed section is complete, AI section carries an honest note', () => {
    const card = buildAnalysisCard(makeScene(), { unavailable: READ_UNAVAILABLE_NOTE });
    expect(card.computed).toHaveLength(6);
    expect(card.computed.every(([, v]) => v.length > 0)).toBe(true);
    expect(card.read).toEqual([]);
    expect(card.readNote).toBe(READ_UNAVAILABLE_NOTE);
    expect(card.takeaway).toBe('');
    expect(card.drill).toBeUndefined();
  });

  it('round-trips losslessly through the session-file card encoding', () => {
    const card = buildAnalysisCard(makeScene(), parseCoachRead(GOOD_READ_JSON)!);
    expect(decodeCoachCard(encodeCoachCard(card))).toEqual(card);
    const unavailable = buildAnalysisCard(makeScene(), { unavailable: READ_UNAVAILABLE_NOTE });
    expect(decodeCoachCard(encodeCoachCard(unavailable))).toEqual(unavailable);
  });
});

// ── Run flow ────────────────────────────────────────────────────────────────

describe('runFullSceneAnalysis', () => {
  it('appends ONE agent turn carrying the full card (computed + AI read)', async () => {
    const mock = installMockApi();
    const outcome = await runFullSceneAnalysis(makeScene());

    expect(outcome).toBe('appended');
    expect(mock.agentWritingAssistant).toHaveBeenCalledTimes(1);
    // The dedicated analysis prompt + the scene text as separate context.
    const [prompt, context] = mock.agentWritingAssistant.mock.calls[0] as unknown as [string, string];
    expect(prompt).toBe(buildCoachReadPrompt());
    expect(context).toContain('Into the Undercity');
    expect(context).toContain('Mira sprinted for the stairs.');

    expect(mock.agentSessions.appendTurns).toHaveBeenCalledTimes(1);
    const [, turns] = mock.agentSessions.appendTurns.mock.calls[0];
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('agent');
    const card = decodeCoachCard(turns[0].text);
    expect(card?.kind).toBe('analysis');
    if (card?.kind !== 'analysis') return;
    expect(card.computed).toHaveLength(6);
    expect(card.read).toHaveLength(4);
    expect(isSceneAnalysisPending()).toBe(false);
  });

  it('M13 acceptance: with AI erroring, the computed section still lands with an honest note', async () => {
    const mock = installMockApi({ chatError: new Error('Writing Coach is disabled in settings.') });
    const outcome = await runFullSceneAnalysis(makeScene());

    expect(outcome).toBe('appended');
    const [, turns] = mock.agentSessions.appendTurns.mock.calls[0];
    const card = decodeCoachCard(turns[0].text);
    expect(card?.kind).toBe('analysis');
    if (card?.kind !== 'analysis') return;
    expect(card.computed).toHaveLength(6);
    expect(card.read).toEqual([]);
    expect(card.readNote).toContain('Writing Coach is disabled in settings.');
  });

  it('M13 acceptance: with no AI surface at all, the card is computed-only', async () => {
    const mock = installMockApi({ omitChat: true });
    await runFullSceneAnalysis(makeScene());

    const [, turns] = mock.agentSessions.appendTurns.mock.calls[0];
    const card = decodeCoachCard(turns[0].text);
    if (card?.kind !== 'analysis') throw new Error('expected analysis card');
    expect(card.computed).toHaveLength(6);
    expect(card.readNote).toBe(READ_UNAVAILABLE_NOTE);
    expect(mock.agentWritingAssistant).not.toHaveBeenCalled();
  });

  it('an unparseable model reply degrades to the honest unavailable state', async () => {
    const mock = installMockApi({ chatResponse: 'Sure! Your scene is great, nice pacing.' });
    await runFullSceneAnalysis(makeScene());

    const [, turns] = mock.agentSessions.appendTurns.mock.calls[0];
    const card = decodeCoachCard(turns[0].text);
    if (card?.kind !== 'analysis') throw new Error('expected analysis card');
    expect(card.read).toEqual([]);
    expect(card.readNote).toMatch(/unexpected shape/);
  });

  it('prototype 7259: skips when the newest turn is already this scene’s analysis card', async () => {
    const scene = makeScene();
    const existing = buildAnalysisCard(scene, parseCoachRead(GOOD_READ_JSON)!);
    const mock = installMockApi({
      turns: [{ role: 'agent', text: encodeCoachCard(existing), at: AT }],
    });

    const outcome = await runFullSceneAnalysis(scene);

    expect(outcome).toBe('skipped');
    expect(mock.agentWritingAssistant).not.toHaveBeenCalled();
    expect(mock.agentSessions.appendTurns).not.toHaveBeenCalled();
  });

  it('§14.6 contract: the whole flow touches only allowlisted APIs', async () => {
    const mock = installMockApi();
    await runFullSceneAnalysis(makeScene());

    const allowed = new Set([
      'agentSessions.list', 'agentSessions.create', 'agentSessions.read', 'agentSessions.appendTurns',
      'agentWritingAssistant',
    ]);
    for (const call of mock.calls) {
      expect(allowed.has(call), `analysis flow called ${call} — outside the no-ghost-write allowlist`).toBe(true);
    }
  });
});

// ── Right-panel helpers ─────────────────────────────────────────────────────

describe('latestAnalysisCardForScene', () => {
  it('finds the newest analysis card matching the scene title', () => {
    const scene = makeScene();
    const older = buildAnalysisCard(scene, { unavailable: READ_UNAVAILABLE_NOTE });
    const newer = buildAnalysisCard(scene, parseCoachRead(GOOD_READ_JSON)!);
    const turns: AgentSessionTurn[] = [
      { role: 'agent', text: encodeCoachCard(older), at: AT },
      { role: 'user', text: 'thanks', at: AT },
      { role: 'agent', text: encodeCoachCard(newer), at: AT },
    ];
    expect(latestAnalysisCardForScene(turns, scene)).toEqual(newer);
  });

  it('ignores cards for other scenes and non-card turns', () => {
    const scene = makeScene();
    const other = buildAnalysisCard({ ...makeScene(), title: 'Other Scene' }, { unavailable: READ_UNAVAILABLE_NOTE });
    const turns: AgentSessionTurn[] = [
      { role: 'agent', text: 'plain coach reply', at: AT },
      { role: 'agent', text: encodeCoachCard(other), at: AT },
    ];
    expect(latestAnalysisCardForScene(turns, scene)).toBeNull();
    expect(latestAnalysisCardForScene(undefined, scene)).toBeNull();
    expect(latestAnalysisCardForScene(turns, null)).toBeNull();
  });
});

describe('compactReadValue', () => {
  it('keeps the verdict before the em-dash teaching clause', () => {
    expect(compactReadValue('Rising — steady climb after the token beat')).toBe('Rising');
    expect(compactReadValue('Third limited (Mira) — drifts once')).toBe('Third limited (Mira)');
  });

  it('truncates verdicts that are still too long for a panel row', () => {
    const long = compactReadValue('An enormously long verdict that cannot possibly fit the row');
    expect(long.length).toBeLessThanOrEqual(30);
    expect(long.endsWith('…')).toBe(true);
  });

  it('falls back to the whole clause when there is no em-dash', () => {
    expect(compactReadValue('Rising')).toBe('Rising');
  });
});
