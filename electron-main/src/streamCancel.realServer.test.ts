// SKY-11223 AC3/AC6 — proves cancel reaches a REAL streaming provider.
//
// A mocked stream can only prove the UI stopped listening; it can't prove
// the provider stopped generating, which is the entire point of "Cancelling
// actually aborts the upstream request." This spins up a real local HTTP
// server speaking the OpenAI-compatible SSE dialect (the same one LM Studio/
// Ollama/llama.cpp use), points `streamFromProvider` at it exactly like the
// brainstorm/writing-coach/archive/beta-reader handlers in main.ts do, aborts
// mid-stream, and asserts the SERVER observed the disconnect and stopped
// producing tokens — not just that our reader stopped reading.

import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import { streamFromProvider, type ProviderConfig } from './provider.js';

describe('SKY-11223 — cancelling a stream reaches the real provider', () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  function startSseServer(): Promise<{ port: number; sawServerClose: () => boolean; chunksSent: () => number }> {
    let sawServerClose = false;
    let chunksSent = 0;
    let interval: NodeJS.Timeout | undefined;

    server = http.createServer((req, res) => {
      // Fires when the client (fetch/undici) tears down the connection — the
      // real-world signal that "the provider knows generation was cancelled."
      req.on('close', () => {
        sawServerClose = true;
        clearInterval(interval);
      });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      interval = setInterval(() => {
        chunksSent += 1;
        const delta = { choices: [{ delta: { content: `token${chunksSent} ` } }] };
        res.write(`data: ${JSON.stringify(delta)}\n\n`);
        if (chunksSent >= 200) {
          clearInterval(interval);
          res.write('data: [DONE]\n\n');
          res.end();
        }
      }, 15);
    });

    return new Promise((resolve, reject) => {
      server!.on('error', reject);
      server!.listen(0, '127.0.0.1', () => {
        const address = server!.address();
        if (address === null || typeof address === 'string') {
          reject(new Error('failed to bind test server'));
          return;
        }
        resolve({ port: address.port, sawServerClose: () => sawServerClose, chunksSent: () => chunksSent });
      });
    });
  }

  it('aborting mid-stream stops the server from generating more tokens', async () => {
    const { port, sawServerClose, chunksSent } = await startSseServer();
    const config: ProviderConfig = { kind: 'custom', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-local-model' };
    const controller = new AbortController();

    const received: string[] = [];
    await expect((async () => {
      for await (const token of streamFromProvider(config, {
        messages: [{ role: 'user', content: 'hi' }],
        signal: controller.signal,
      })) {
        received.push(token);
        if (received.length === 3) {
          // This is the exact call `agent:*:stream-cancel` / the shared
          // ai-activity:cancel channel makes against the real AbortController.
          controller.abort();
        }
      }
    })()).rejects.toThrow();

    expect(received.length).toBeGreaterThanOrEqual(3);

    // Give the server's `req.close` handler a tick to run.
    await new Promise((r) => setTimeout(r, 50));
    expect(sawServerClose()).toBe(true);

    const chunksAtAbort = chunksSent();
    await new Promise((r) => setTimeout(r, 100));
    // The server's own interval was cleared by the disconnect — it did not
    // keep "generating" tokens into the void after the abort reached it.
    expect(chunksSent()).toBe(chunksAtAbort);
    expect(chunksSent()).toBeLessThan(200);
  });

  it('without an abort, the stream runs to completion — the control for the abort test above', async () => {
    const { port, chunksSent } = await startSseServer();
    const config: ProviderConfig = { kind: 'custom', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-local-model' };
    const controller = new AbortController();

    const received: string[] = [];
    for await (const token of streamFromProvider(config, {
      messages: [{ role: 'user', content: 'hi' }],
      signal: controller.signal,
    })) {
      received.push(token);
    }

    // Confirms the abort test's early stop (received.length === 3 of 200) is
    // really the abort working, not a server/harness quirk — left alone, the
    // same server always finishes the full 200-token stream.
    expect(received.length).toBe(200);
    expect(chunksSent()).toBe(200);
  });
});
