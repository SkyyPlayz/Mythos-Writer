/**
 * agentPayloadValidation.test.ts (SKY-701)
 *
 * Regression tests for RISK-4: agent:brainstorm and agent:writing-assistant
 * payload size cap + role validation added in main.ts handlers.
 *
 * Uses inline handler replicas (no Electron, no network) matching the pattern
 * established in agentDisabled.test.ts.
 *
 * Coverage:
 *   §1  Brainstorm — history length cap (> 50 turns → error)
 *   §2  Brainstorm — role allowlist ('system' role → error)
 *   §3  Brainstorm — prompt length cap (> 32 000 chars → error)
 *   §4  Brainstorm — total payload size cap (> 256 KB → error)
 *   §5  Brainstorm — valid payloads pass all guards
 *   §6  Writing Assistant — prompt length cap
 *   §7  Writing Assistant — context length cap
 *   §8  Writing Assistant — total payload size cap
 *   §9  Writing Assistant — valid payloads pass all guards
 */

import { describe, it, expect, vi } from 'vitest';

// Hoist mocks before any imports so module resolution picks them up.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
}));
vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn() }));

import { MAX_PAYLOAD_BYTES } from './streaming.js';

// ─── Validation constants (mirror main.ts) ────────────────────────────────────

const MAX_AGENT_HISTORY_TURNS = 50;
const MAX_AGENT_PROMPT_LENGTH = 32_000;
const VALID_AGENT_ROLES = new Set<string>(['user', 'assistant']);

// ─── Inline handler replicas ──────────────────────────────────────────────────

type HistoryMessage = { role: string; content: string };

function validateBrainstormPayload(payload: {
  prompt: unknown;
  history?: unknown;
}): void {
  if (!payload || Buffer.byteLength(JSON.stringify(payload)) > MAX_PAYLOAD_BYTES) {
    throw new Error('Payload too large');
  }
  if (Array.isArray(payload.history)) {
    if (payload.history.length > MAX_AGENT_HISTORY_TURNS) {
      throw new Error('History too long');
    }
    if ((payload.history as HistoryMessage[]).some((m) => !VALID_AGENT_ROLES.has(m.role))) {
      throw new Error('Invalid role in history');
    }
  }
  if (typeof payload.prompt !== 'string' || payload.prompt.length > MAX_AGENT_PROMPT_LENGTH) {
    throw new Error('Prompt invalid or too long');
  }
}

function validateWritingAssistantPayload(payload: {
  prompt: unknown;
  context?: unknown;
}): void {
  if (!payload || Buffer.byteLength(JSON.stringify(payload)) > MAX_PAYLOAD_BYTES) {
    throw new Error('Payload too large');
  }
  if (typeof payload.prompt !== 'string' || payload.prompt.length > MAX_AGENT_PROMPT_LENGTH) {
    throw new Error('Prompt invalid or too long');
  }
  if (
    payload.context !== undefined &&
    (typeof payload.context !== 'string' || (payload.context as string).length > MAX_AGENT_PROMPT_LENGTH)
  ) {
    throw new Error('Context invalid or too long');
  }
}

// ─── §1 Brainstorm — history length cap ──────────────────────────────────────

describe('Brainstorm — history length cap (§1)', () => {
  it('rejects history with 51 turns', () => {
    const history = Array.from({ length: 51 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'x',
    }));
    expect(() => validateBrainstormPayload({ prompt: 'hello', history })).toThrow('History too long');
  });

  it('accepts history with exactly 50 turns', () => {
    const history = Array.from({ length: 50 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'x',
    }));
    expect(() => validateBrainstormPayload({ prompt: 'hello', history })).not.toThrow();
  });

  it('accepts payload with no history field', () => {
    expect(() => validateBrainstormPayload({ prompt: 'hello' })).not.toThrow();
  });
});

// ─── §2 Brainstorm — role allowlist ──────────────────────────────────────────

describe('Brainstorm — role allowlist (§2)', () => {
  it('rejects "system" role in history', () => {
    const history = [{ role: 'system', content: 'You are helpful.' }];
    expect(() => validateBrainstormPayload({ prompt: 'hello', history })).toThrow('Invalid role in history');
  });

  it('rejects unknown role "tool"', () => {
    const history = [
      { role: 'user', content: 'hi' },
      { role: 'tool', content: 'result' },
    ];
    expect(() => validateBrainstormPayload({ prompt: 'hello', history })).toThrow('Invalid role in history');
  });

  it('accepts valid user/assistant roles', () => {
    const history = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hey' },
    ];
    expect(() => validateBrainstormPayload({ prompt: 'hello', history })).not.toThrow();
  });
});

// ─── §3 Brainstorm — prompt length cap ───────────────────────────────────────

describe('Brainstorm — prompt length cap (§3)', () => {
  it('rejects prompt longer than 32 000 chars', () => {
    expect(() => validateBrainstormPayload({ prompt: 'a'.repeat(32_001) })).toThrow(
      'Prompt invalid or too long',
    );
  });

  it('accepts prompt exactly 32 000 chars', () => {
    expect(() => validateBrainstormPayload({ prompt: 'a'.repeat(32_000) })).not.toThrow();
  });

  it('rejects non-string prompt', () => {
    expect(() => validateBrainstormPayload({ prompt: 42 as unknown as string })).toThrow(
      'Prompt invalid or too long',
    );
  });
});

// ─── §4 Brainstorm — total payload size cap ──────────────────────────────────

describe('Brainstorm — total payload size cap (§4)', () => {
  it('rejects payload whose JSON serialisation exceeds 256 KB', () => {
    const oversized = { prompt: 'x', history: [{ role: 'user', content: 'y'.repeat(MAX_PAYLOAD_BYTES) }] };
    expect(() => validateBrainstormPayload(oversized)).toThrow('Payload too large');
  });
});

// ─── §5 Brainstorm — valid payloads pass all guards ──────────────────────────

describe('Brainstorm — valid payloads (§5)', () => {
  it('passes prompt-only payload', () => {
    expect(() => validateBrainstormPayload({ prompt: 'Write me a story.' })).not.toThrow();
  });

  it('passes payload with valid history and prompt', () => {
    const history = [
      { role: 'user', content: 'Chapter one.' },
      { role: 'assistant', content: 'Here it is.' },
    ];
    expect(() => validateBrainstormPayload({ prompt: 'Continue the story.', history })).not.toThrow();
  });
});

// ─── §6 Writing Assistant — prompt length cap ────────────────────────────────

describe('Writing Assistant — prompt length cap (§6)', () => {
  it('rejects prompt longer than 32 000 chars', () => {
    expect(() => validateWritingAssistantPayload({ prompt: 'b'.repeat(32_001) })).toThrow(
      'Prompt invalid or too long',
    );
  });

  it('accepts prompt exactly 32 000 chars', () => {
    expect(() => validateWritingAssistantPayload({ prompt: 'b'.repeat(32_000) })).not.toThrow();
  });

  it('rejects non-string prompt', () => {
    expect(() => validateWritingAssistantPayload({ prompt: null as unknown as string })).toThrow(
      'Prompt invalid or too long',
    );
  });
});

// ─── §7 Writing Assistant — context length cap ───────────────────────────────

describe('Writing Assistant — context length cap (§7)', () => {
  it('rejects context longer than 32 000 chars', () => {
    expect(() =>
      validateWritingAssistantPayload({ prompt: 'fix this', context: 'c'.repeat(32_001) }),
    ).toThrow('Context invalid or too long');
  });

  it('accepts context exactly 32 000 chars', () => {
    expect(() =>
      validateWritingAssistantPayload({ prompt: 'fix this', context: 'c'.repeat(32_000) }),
    ).not.toThrow();
  });

  it('accepts payload without context', () => {
    expect(() => validateWritingAssistantPayload({ prompt: 'improve the pace' })).not.toThrow();
  });

  it('rejects non-string context', () => {
    expect(() =>
      validateWritingAssistantPayload({ prompt: 'fix', context: 123 as unknown as string }),
    ).toThrow('Context invalid or too long');
  });
});

// ─── §8 Writing Assistant — total payload size cap ───────────────────────────

describe('Writing Assistant — total payload size cap (§8)', () => {
  it('rejects payload whose JSON serialisation exceeds 256 KB', () => {
    const oversized = { prompt: 'x', context: 'z'.repeat(MAX_PAYLOAD_BYTES) };
    expect(() => validateWritingAssistantPayload(oversized)).toThrow('Payload too large');
  });
});

// ─── §9 Writing Assistant — valid payloads pass all guards ───────────────────

describe('Writing Assistant — valid payloads (§9)', () => {
  it('passes prompt-only payload', () => {
    expect(() => validateWritingAssistantPayload({ prompt: 'Rewrite the opening.' })).not.toThrow();
  });

  it('passes prompt + context payload', () => {
    expect(() =>
      validateWritingAssistantPayload({ prompt: 'Fix pacing.', context: 'She walked into the room.' }),
    ).not.toThrow();
  });
});

// ─── §10 Archive — payload validation (SKY-6663: same {prompt, context} shape
//        as Writing Assistant — registerArchiveHandler in main.ts reuses this
//        exact validation code) ──────────────────────────────────────────────

describe('Archive — payload validation (§10)', () => {
  it('rejects prompt longer than 32 000 chars', () => {
    expect(() => validateWritingAssistantPayload({ prompt: 'a'.repeat(32_001) })).toThrow(
      'Prompt invalid or too long',
    );
  });

  it('rejects context longer than 32 000 chars', () => {
    expect(() =>
      validateWritingAssistantPayload({ prompt: 'check continuity', context: 'c'.repeat(32_001) }),
    ).toThrow('Context invalid or too long');
  });

  it('passes a valid prompt + scene-context payload', () => {
    expect(() =>
      validateWritingAssistantPayload({
        prompt: 'Does this scene contradict chapter one?',
        context: 'Scene: "The Reveal"\n\nElara had always had green eyes.',
      }),
    ).not.toThrow();
  });
});
