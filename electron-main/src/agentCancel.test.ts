/**
 * agentCancel.test.ts
 *
 * Tests for the stream-cancel IPC mechanic added in MYT-179.
 *
 * We don't import main.ts (too many Electron side-effects). Instead we test
 * the exact pattern used there: a Map<requestId, AbortController> + a cancel
 * handler that calls .abort() and removes the entry. Keeping the logic as a
 * standalone helper means we can also verify the async-stream behaviour.
 */

import { describe, it, expect } from 'vitest';

// ─── Minimal replica of the agentControllers pattern from main.ts ───

function makeAgentCancelSystem() {
  const controllers = new Map<string, AbortController>();

  function cancelHandler(requestId: string): void {
    controllers.get(requestId)?.abort();
    controllers.delete(requestId);
  }

  function register(requestId: string, controller: AbortController): void {
    controllers.set(requestId, controller);
  }

  function cleanup(requestId: string): void {
    controllers.delete(requestId);
  }

  return { controllers, cancelHandler, register, cleanup };
}

// ─── Tests ───

describe('agentControllers cancel mechanic', () => {
  it('cancel aborts the controller for a known requestId', () => {
    const { controllers, cancelHandler, register } = makeAgentCancelSystem();
    const ctrl = new AbortController();
    register('req-1', ctrl);

    cancelHandler('req-1');

    expect(ctrl.signal.aborted).toBe(true);
  });

  it('cancel removes the entry from the map', () => {
    const { controllers, cancelHandler, register } = makeAgentCancelSystem();
    register('req-1', new AbortController());

    cancelHandler('req-1');

    expect(controllers.has('req-1')).toBe(false);
  });

  it('cancel for an unknown requestId is a no-op', () => {
    const { cancelHandler } = makeAgentCancelSystem();
    expect(() => cancelHandler('ghost-id')).not.toThrow();
  });

  it('cleanup removes entry without aborting', () => {
    const { controllers, cleanup, register } = makeAgentCancelSystem();
    const ctrl = new AbortController();
    register('req-2', ctrl);

    cleanup('req-2');

    expect(controllers.has('req-2')).toBe(false);
    expect(ctrl.signal.aborted).toBe(false);
  });

  it('multiple controllers are tracked independently', () => {
    const { controllers, cancelHandler, register } = makeAgentCancelSystem();
    const ctrlA = new AbortController();
    const ctrlB = new AbortController();
    register('a', ctrlA);
    register('b', ctrlB);

    cancelHandler('a');

    expect(ctrlA.signal.aborted).toBe(true);
    expect(ctrlB.signal.aborted).toBe(false);
    expect(controllers.has('a')).toBe(false);
    expect(controllers.has('b')).toBe(true);
  });
});

// ─── Async-stream cancel test ───

/**
 * Replicates the exact stream loop in each agent handler to verify that an
 * AbortError thrown from the async generator is caught and does NOT propagate,
 * and that chunks after cancel are not produced.
 */

async function runStreamWithCancel(cancelAfterFirst: boolean): Promise<{
  chunks: string[];
  threw: boolean;
}> {
  const ctrl = new AbortController();
  const chunks: string[] = [];
  let threw = false;

  async function* fakeStream() {
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'first' } };
    if (ctrl.signal.aborted) {
      const e = new Error('aborted'); e.name = 'AbortError'; throw e;
    }
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'second' } };
  }

  if (cancelAfterFirst) {
    ctrl.abort();
  }

  try {
    for await (const chunk of fakeStream()) {
      if (
        chunk.type === 'content_block_delta' &&
        chunk.delta.type === 'text_delta'
      ) {
        chunks.push(chunk.delta.text);
      }
    }
  } catch (err: unknown) {
    if ((err as Error)?.name !== 'AbortError') {
      threw = true;
      throw err;
    }
    // AbortError is swallowed — generation stopped cleanly.
  }

  return { chunks, threw };
}

describe('stream AbortError swallow behaviour', () => {
  it('all chunks arrive when not cancelled', async () => {
    const { chunks, threw } = await runStreamWithCancel(false);
    expect(chunks).toEqual(['first', 'second']);
    expect(threw).toBe(false);
  });

  it('AbortError is caught and does not propagate', async () => {
    await expect(runStreamWithCancel(true)).resolves.not.toThrow();
  });

  it('only chunks before cancel are delivered after abort', async () => {
    const { chunks } = await runStreamWithCancel(true);
    expect(chunks).toEqual(['first']);
  });
});
