/**
 * brainstormIpcSecurity.test.ts (AC-BST-21)
 *
 * Unit tests for the brainstorm IPC payload-validation helpers.
 * No Electron, no network — pure logic tests.
 *
 * Coverage:
 *   §1  payload size cap (null, oversized, valid)
 *   §2  role allowlist — 'system' / 'tool' rejected, 'user' / 'assistant' accepted
 *   §3  history absent — no role errors when history is not supplied
 *   §4  multiple history messages — first invalid role throws immediately
 *   §5  BRAINSTORM_VALID_ROLES constant shape
 *   §6  handler-replica: BRAINSTORM_WRITE_NOTE size guard
 *   §7  handler-replica: BRAINSTORM_EXTRACT_PROPOSALS size guard
 *   §8  handler-replica: BRAINSTORM_SELECT_CONTEXT size guard
 *   §9  handler-replica: BRAINSTORM_PROPOSALS_CONFIRM size guard
 *   §10 handler-replica: BRAINSTORM_PROPOSALS_REJECT size guard
 */

import { describe, it, expect, vi } from 'vitest';

// Hoist mocks before imports so module resolution picks them up.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
}));
vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn() }));

import { assertBrainstormPayloadValid, BRAINSTORM_VALID_ROLES } from './brainstormIpcSecurity.js';
import { MAX_PAYLOAD_BYTES } from './streaming.js';

// ─── §1  Payload size cap ─────────────────────────────────────────────────────

describe('assertBrainstormPayloadValid — payload size (§1)', () => {
  it('throws "Payload too large" when payload is null', () => {
    expect(() => assertBrainstormPayloadValid(null)).toThrow('Payload too large');
  });

  it('throws "Payload too large" when payload is undefined', () => {
    expect(() => assertBrainstormPayloadValid(undefined)).toThrow('Payload too large');
  });

  it('throws "Payload too large" when JSON serialisation exceeds 256 KB', () => {
    const oversized = { content: 'x'.repeat(MAX_PAYLOAD_BYTES) };
    expect(() => assertBrainstormPayloadValid(oversized)).toThrow('Payload too large');
  });

  it('does not throw for a small valid payload', () => {
    expect(() => assertBrainstormPayloadValid({ name: 'Test', content: 'Hello world.' })).not.toThrow();
  });

  it('does not throw for an empty object', () => {
    expect(() => assertBrainstormPayloadValid({})).not.toThrow();
  });
});

// ─── §2  Role allowlist ───────────────────────────────────────────────────────

describe('assertBrainstormPayloadValid — role allowlist (§2)', () => {
  it('throws "Invalid role in history" for "system" role', () => {
    const history = [{ role: 'system', content: 'You are a helpful assistant.' }];
    expect(() => assertBrainstormPayloadValid({ prompt: 'hi' }, { history })).toThrow(
      'Invalid role in history',
    );
  });

  it('throws "Invalid role in history" for "tool" role', () => {
    const history = [
      { role: 'user', content: 'What time is it?' },
      { role: 'tool', content: '{"time":"12:00"}' },
    ];
    expect(() => assertBrainstormPayloadValid({ prompt: 'hi' }, { history })).toThrow(
      'Invalid role in history',
    );
  });

  it('throws "Invalid role in history" for empty-string role', () => {
    const history = [{ role: '', content: 'x' }];
    expect(() => assertBrainstormPayloadValid({ prompt: 'hi' }, { history })).toThrow(
      'Invalid role in history',
    );
  });

  it('does not throw for "user" role', () => {
    const history = [{ role: 'user', content: 'Tell me a story.' }];
    expect(() => assertBrainstormPayloadValid({ prompt: 'hi' }, { history })).not.toThrow();
  });

  it('does not throw for "assistant" role', () => {
    const history = [{ role: 'assistant', content: 'Once upon a time…' }];
    expect(() => assertBrainstormPayloadValid({ prompt: 'hi' }, { history })).not.toThrow();
  });

  it('accepts alternating user/assistant history', () => {
    const history = [
      { role: 'user', content: 'Chapter 1.' },
      { role: 'assistant', content: 'Here it is.' },
      { role: 'user', content: 'Continue.' },
      { role: 'assistant', content: 'Continued.' },
    ];
    expect(() => assertBrainstormPayloadValid({ prompt: 'hi' }, { history })).not.toThrow();
  });
});

// ─── §3  History absent ───────────────────────────────────────────────────────

describe('assertBrainstormPayloadValid — history absent (§3)', () => {
  it('does not throw when opts is omitted', () => {
    expect(() => assertBrainstormPayloadValid({ name: 'Test', content: 'hello' })).not.toThrow();
  });

  it('does not throw when opts.history is undefined', () => {
    expect(() =>
      assertBrainstormPayloadValid({ name: 'Test', content: 'hello' }, { history: undefined }),
    ).not.toThrow();
  });

  it('does not throw when opts.history is an empty array', () => {
    expect(() =>
      assertBrainstormPayloadValid({ prompt: 'Go!' }, { history: [] }),
    ).not.toThrow();
  });
});

// ─── §4  Multiple history messages — first invalid role throws ────────────────

describe('assertBrainstormPayloadValid — multi-message history (§4)', () => {
  it('throws on the first invalid role when mixed with valid ones', () => {
    const history = [
      { role: 'user', content: 'Hello.' },
      { role: 'assistant', content: 'Hi!' },
      { role: 'system', content: 'INJECTED' },
    ];
    expect(() => assertBrainstormPayloadValid({ prompt: 'continue' }, { history })).toThrow(
      'Invalid role in history',
    );
  });
});

// ─── §5  BRAINSTORM_VALID_ROLES constant ─────────────────────────────────────

describe('BRAINSTORM_VALID_ROLES constant (§5)', () => {
  it('contains "user" and "assistant"', () => {
    expect(BRAINSTORM_VALID_ROLES.has('user')).toBe(true);
    expect(BRAINSTORM_VALID_ROLES.has('assistant')).toBe(true);
  });

  it('does not contain "system"', () => {
    expect(BRAINSTORM_VALID_ROLES.has('system')).toBe(false);
  });

  it('does not contain "tool"', () => {
    expect(BRAINSTORM_VALID_ROLES.has('tool')).toBe(false);
  });

  it('has exactly two members', () => {
    expect(BRAINSTORM_VALID_ROLES.size).toBe(2);
  });
});

// ─── §6  Handler-replica: BRAINSTORM_WRITE_NOTE size guard ───────────────────
// Mirrors the assertBrainstormPayloadValid call added to the BRAINSTORM_WRITE_NOTE handler.

describe('BRAINSTORM_WRITE_NOTE handler — payload size guard (§6)', () => {
  function handleWriteNote(payload: { name: string; content: string; category?: string }) {
    assertBrainstormPayloadValid(payload);
    return { status: 'written' as const, path: `notes/${payload.name}.md` };
  }

  it('rejects oversized write-note payload', () => {
    const payload = { name: 'Big Note', content: 'y'.repeat(MAX_PAYLOAD_BYTES), category: 'character' };
    expect(() => handleWriteNote(payload)).toThrow('Payload too large');
  });

  it('accepts normal write-note payload', () => {
    const payload = { name: 'Elena', content: 'A brave hero.', category: 'character' };
    expect(() => handleWriteNote(payload)).not.toThrow();
    expect(handleWriteNote(payload).status).toBe('written');
  });
});

// ─── §7  Handler-replica: BRAINSTORM_EXTRACT_PROPOSALS size guard ─────────────

describe('BRAINSTORM_EXTRACT_PROPOSALS handler — payload size guard (§7)', () => {
  function handleExtractProposals(payload: { turnText: string; turnId: string; existingEntityNames?: string[] }) {
    assertBrainstormPayloadValid(payload);
    return { proposals: [] };
  }

  it('rejects oversized extract-proposals payload', () => {
    const payload = { turnText: 'z'.repeat(MAX_PAYLOAD_BYTES), turnId: 'turn-1' };
    expect(() => handleExtractProposals(payload)).toThrow('Payload too large');
  });

  it('accepts normal extract-proposals payload', () => {
    const payload = { turnText: 'Elena entered the tower.', turnId: 'turn-1', existingEntityNames: [] };
    expect(() => handleExtractProposals(payload)).not.toThrow();
  });
});

// ─── §8  Handler-replica: BRAINSTORM_SELECT_CONTEXT size guard ────────────────

describe('BRAINSTORM_SELECT_CONTEXT handler — payload size guard (§8)', () => {
  function handleSelectContext(payload: { userMessage: string; conversationText: string; tokenBudget?: number }) {
    assertBrainstormPayloadValid(payload);
    return { included: [], excluded: [], usedTokens: 0, budgetTokens: payload.tokenBudget ?? 4000 };
  }

  it('rejects oversized select-context payload', () => {
    const payload = { userMessage: 'help', conversationText: 'c'.repeat(MAX_PAYLOAD_BYTES) };
    expect(() => handleSelectContext(payload)).toThrow('Payload too large');
  });

  it('accepts normal select-context payload', () => {
    const payload = { userMessage: 'Who is Elena?', conversationText: 'Elena is brave.', tokenBudget: 4000 };
    expect(() => handleSelectContext(payload)).not.toThrow();
  });
});

// ─── §9  Handler-replica: BRAINSTORM_PROPOSALS_CONFIRM size guard ─────────────

describe('BRAINSTORM_PROPOSALS_CONFIRM handler — payload size guard (§9)', () => {
  function handleProposalConfirm(payload: {
    proposalId: string;
    kind: string;
    extractionConfidence: number;
    timeToDecideMs: number;
    decision: 'confirm' | 'edit_and_confirm';
  }) {
    assertBrainstormPayloadValid(payload);
    return { ok: true as const };
  }

  it('rejects oversized confirm payload', () => {
    const payload = {
      proposalId: 'a'.repeat(MAX_PAYLOAD_BYTES),
      kind: 'character',
      extractionConfidence: 0.9,
      timeToDecideMs: 1234,
      decision: 'confirm' as const,
    };
    expect(() => handleProposalConfirm(payload)).toThrow('Payload too large');
  });

  it('accepts normal confirm payload', () => {
    const payload = {
      proposalId: 'abc-123',
      kind: 'character',
      extractionConfidence: 0.9,
      timeToDecideMs: 1234,
      decision: 'confirm' as const,
    };
    expect(() => handleProposalConfirm(payload)).not.toThrow();
    expect(handleProposalConfirm(payload)).toEqual({ ok: true });
  });
});

// ─── §10 Handler-replica: BRAINSTORM_PROPOSALS_REJECT size guard ──────────────

describe('BRAINSTORM_PROPOSALS_REJECT handler — payload size guard (§10)', () => {
  function handleProposalReject(payload: {
    proposalId: string;
    title: string;
    kind: string;
    extractionConfidence: number;
    timeToDecideMs: number;
  }) {
    assertBrainstormPayloadValid(payload);
    return { ok: true as const };
  }

  it('rejects oversized reject payload', () => {
    const payload = {
      proposalId: 'abc-123',
      title: 'z'.repeat(MAX_PAYLOAD_BYTES),
      kind: 'character',
      extractionConfidence: 0.8,
      timeToDecideMs: 500,
    };
    expect(() => handleProposalReject(payload)).toThrow('Payload too large');
  });

  it('accepts normal reject payload', () => {
    const payload = {
      proposalId: 'abc-123',
      title: 'Elena',
      kind: 'character',
      extractionConfidence: 0.8,
      timeToDecideMs: 500,
    };
    expect(() => handleProposalReject(payload)).not.toThrow();
    expect(handleProposalReject(payload)).toEqual({ ok: true });
  });
});
