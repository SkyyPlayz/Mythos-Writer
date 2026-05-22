import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { request as httpRequest, Server } from 'http';
import { tmpdir } from 'os';
import { AddressInfo } from 'net';
import { join } from 'path';
import { app, createApp, resetStoryRateLimits } from './index';

const anthropicStreamMock = vi.hoisted(() =>
  vi.fn().mockImplementation(async function* () {
    yield {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'Once upon' },
    };
    yield {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: ' a time.' },
    };
  }),
);

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(function AnthropicMock() {
    return {
      messages: {
        stream: anthropicStreamMock,
      },
    };
  }),
}));

let testServer: Server | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = 'test-api-key';
  process.env.STORY_API_ACCESS_MODE = 'demo';
  process.env.STORY_RATE_LIMIT_MAX = '100';
  process.env.STORY_RATE_LIMIT_WINDOW_MS = '60000';
  delete process.env.STORY_API_TOKEN;
  delete process.env.STORY_ALLOWED_ORIGINS;
  resetStoryRateLimits();
});

afterEach(async () => {
  if (!testServer) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    testServer?.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  testServer = undefined;
});

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('production frontend hosting', () => {
  it('serves the built frontend shell from the configured static directory', async () => {
    const staticDir = mkdtempSync(join(tmpdir(), 'mythos-writer-frontend-'));
    writeFileSync(
      join(staticDir, 'index.html'),
      '<!doctype html><html><body><div id="root">Mythos Writer Shell</div></body></html>',
    );

    try {
      const productionApp = createApp({ staticFrontendDir: staticDir });
      const res = await request(productionApp).get('/');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('Mythos Writer Shell');
    } finally {
      rmSync(staticDir, { recursive: true, force: true });
    }
  });

  it('does not serve the frontend shell for unknown /api routes', async () => {
    const staticDir = mkdtempSync(join(tmpdir(), 'mythos-writer-frontend-'));
    writeFileSync(
      join(staticDir, 'index.html'),
      '<!doctype html><html><body><div id="root">Mythos Writer Shell</div></body></html>',
    );

    try {
      const productionApp = createApp({ staticFrontendDir: staticDir });
      const res = await request(productionApp).get('/api/stories/generate');

      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.body.error).toBe('API route not found');
    } finally {
      rmSync(staticDir, { recursive: true, force: true });
    }
  });
});

describe('POST /api/stories/generate', () => {
  it('streams story chunks for a valid prompt', async () => {
    const res = await request(app)
      .post('/api/stories/generate')
      .send({ prompt: 'A dragon discovers a book' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('"chunk":"Once upon"');
    expect(res.text).toContain('[DONE]');
  });

  it('aborts the Anthropic stream when the client disconnects', async () => {
    const abortStream = vi.fn();
    let resolveFirstChunkSent!: () => void;
    const firstChunkSent = new Promise<void>((resolve) => {
      resolveFirstChunkSent = resolve;
    });

    anthropicStreamMock.mockImplementationOnce(() => ({
      abort: abortStream,
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Opening line' },
        };
        resolveFirstChunkSent();
        await new Promise((resolve) => setTimeout(resolve, 500));
      },
    }));

    testServer = app.listen(0);
    const { port } = testServer.address() as AddressInfo;

    const disconnectObserved = new Promise<void>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/stories/generate',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        (res) => {
          res.once('data', () => {
            req.destroy();
            resolve();
          });
        },
      );
      req.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ECONNRESET') {
          reject(error);
        }
      });
      req.end(JSON.stringify({ prompt: 'A client disconnect tale' }));
    });

    await Promise.race([
      disconnectObserved,
      new Promise((_, reject) => setTimeout(() => reject(new Error('client did not disconnect')), 250)),
    ]);
    await firstChunkSent;
    await vi.waitFor(() => expect(abortStream).toHaveBeenCalledTimes(1));
  });

  it('accepts genre and length params', async () => {
    const res = await request(app)
      .post('/api/stories/generate')
      .send({ prompt: 'A wizard casts a spell', genre: 'fantasy', length: 'short' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('[DONE]');
  });

  it('returns 400 when prompt is missing', async () => {
    const res = await request(app).post('/api/stories/generate').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('prompt is required');
  });

  it('returns 400 and does not stream when prompt is blank or not a string', async () => {
    const blankPrompt = await request(app)
      .post('/api/stories/generate')
      .send({ prompt: '   \n\t  ' });
    expect(blankPrompt.status).toBe(400);
    expect(blankPrompt.body.error).toBe('prompt is required');

    const nonStringPrompt = await request(app)
      .post('/api/stories/generate')
      .send({ prompt: { text: 'A tale' } });
    expect(nonStringPrompt.status).toBe(400);
    expect(nonStringPrompt.body.error).toBe('prompt must be a string');
    expect(anthropicStreamMock).not.toHaveBeenCalled();
  });

  it('returns 400 when prompt exceeds max length', async () => {
    const res = await request(app)
      .post('/api/stories/generate')
      .send({ prompt: 'x'.repeat(2001) });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('2000 characters');
  });

  it('returns 400 for invalid length value', async () => {
    const res = await request(app)
      .post('/api/stories/generate')
      .send({ prompt: 'A tale', length: 'enormous' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('length must be one of');
  });

  it('rejects story generation before opening an SSE stream when Anthropic API key is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const res = await request(app)
      .post('/api/stories/generate')
      .send({ prompt: 'A tale without configuration' });

    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.error).toContain('ANTHROPIC_API_KEY');
    expect(anthropicStreamMock).not.toHaveBeenCalled();
  });



  it('allows the served browser to exchange for an HttpOnly story session without exposing the API token', async () => {
    process.env.STORY_API_ACCESS_MODE = 'token';
    process.env.STORY_API_TOKEN = 'test-token';

    const session = await request(app).post('/api/stories/session').send({});
    expect(session.status).toBe(200);
    expect(session.body.csrfToken).toEqual(expect.any(String));
    expect(session.body.csrfToken).not.toContain('test-token');
    expect(session.headers['set-cookie']?.[0]).toContain('HttpOnly');

    const browserRequest = await request(app)
      .post('/api/stories/generate')
      .set('Cookie', session.headers['set-cookie'])
      .set('X-Story-CSRF', session.body.csrfToken)
      .send({ prompt: 'A browser session tale' });
    expect(browserRequest.status).toBe(200);
    expect(browserRequest.text).toContain('[DONE]');
  });

  it('still rejects direct token-mode story generation without bearer auth or browser session proof', async () => {
    process.env.STORY_API_ACCESS_MODE = 'token';
    process.env.STORY_API_TOKEN = 'test-token';

    const res = await request(app)
      .post('/api/stories/generate')
      .set('X-Story-CSRF', 'missing-cookie-proof')
      .send({ prompt: 'An unauthenticated direct tale' });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('authorization bearer token or browser session is required');
  });

  it('requires a bearer token when token access mode is configured', async () => {
    process.env.STORY_API_ACCESS_MODE = 'token';
    process.env.STORY_API_TOKEN = 'test-token';

    const missingToken = await request(app)
      .post('/api/stories/generate')
      .send({ prompt: 'A locked tale' });
    expect(missingToken.status).toBe(401);
    expect(missingToken.body.error).toContain('authorization bearer token is required');

    const validToken = await request(app)
      .post('/api/stories/generate')
      .set('Authorization', 'Bearer test-token')
      .send({ prompt: 'An authorized tale' });
    expect(validToken.status).toBe(200);
    expect(validToken.text).toContain('[DONE]');
  });

  it('rejects story generation when neither token mode nor explicit demo mode is configured', async () => {
    delete process.env.STORY_API_ACCESS_MODE;

    const res = await request(app)
      .post('/api/stories/generate')
      .send({ prompt: 'An unsafe default tale' });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('disabled until STORY_API_ACCESS_MODE is set');
  });

  it('enforces the configured per-client story generation rate limit', async () => {
    process.env.STORY_RATE_LIMIT_MAX = '1';

    const first = await request(app)
      .post('/api/stories/generate')
      .send({ prompt: 'A first tale' });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/stories/generate')
      .send({ prompt: 'A second tale' });
    expect(second.status).toBe(429);
    expect(second.body.error).toContain('rate limit exceeded');
  });

  it('applies the configured CORS allowlist', async () => {
    process.env.STORY_ALLOWED_ORIGINS = 'https://app.example.com';

    const allowed = await request(app)
      .post('/api/stories/generate')
      .set('Origin', 'https://app.example.com')
      .send({ prompt: 'A CORS tale' });
    expect(allowed.status).toBe(200);
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'https://app.example.com',
    );

    const blocked = await request(app)
      .post('/api/stories/generate')
      .set('Origin', 'https://evil.example.com')
      .send({ prompt: 'A blocked tale' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toContain('origin is not allowed');
  });
});
