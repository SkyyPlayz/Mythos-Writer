import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../index.js';
import { buildStoryRateLimiter } from './story.js';
import express from 'express';

// Helpers ----------------------------------------------------------------

function makeApp(trustProxy: boolean | string | number = false) {
  return createApp({ trustProxy });
}

async function post(app: express.Application, ip?: string) {
  const req = request(app).post('/api/story/generate');
  if (ip) req.set('X-Forwarded-For', ip);
  return req.send({});
}

// Tests ------------------------------------------------------------------

describe('story rate limiter — proxy bucket isolation', () => {
  it('responds 200 on first request', async () => {
    const app = makeApp();
    const res = await post(app);
    expect(res.status).toBe(200);
  });

  it('returns RateLimit headers on every 2xx response (draft-7 combined format)', async () => {
    const app = makeApp();
    const res = await post(app);
    // draft-7 uses a single combined header: "ratelimit: limit=N, remaining=M, reset=T"
    expect(res.headers).toHaveProperty('ratelimit');
    expect(res.headers['ratelimit']).toMatch(/limit=\d+/);
    expect(res.headers['ratelimit']).toMatch(/remaining=\d+/);
    expect(res.headers['ratelimit']).toMatch(/reset=\d+/);
  });

  it('distinct forwarded IPs get separate buckets when trust proxy is enabled', async () => {
    // Build a tight limiter (max=1) so the second request from the same IP
    // is rejected but the first request from a different IP is still allowed.
    const limiter = buildStoryRateLimiter({ windowMs: 60_000, max: 1 });
    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.post('/api/story/generate', limiter, (_req, res) => res.status(200).json({}));

    const clientA = '10.0.0.1';
    const clientB = '10.0.0.2';

    // Client A's first request — should pass.
    const a1 = await post(app, clientA);
    expect(a1.status).toBe(200);

    // Client A's second request — should be rate-limited.
    const a2 = await post(app, clientA);
    expect(a2.status).toBe(429);

    // Client B's first request — different bucket, should still pass.
    const b1 = await post(app, clientB);
    expect(b1.status).toBe(200);
  });

  it('without trust proxy, all forwarded IPs collapse into the same bucket', async () => {
    const limiter = buildStoryRateLimiter({ windowMs: 60_000, max: 1 });
    const app = express();
    // trust proxy NOT set — req.ip resolves to the loopback/socket address for all requests.
    app.use(express.json());
    app.post('/api/story/generate', limiter, (_req, res) => res.status(200).json({}));

    const res1 = await post(app, '10.0.0.1');
    expect(res1.status).toBe(200);

    // Second request from a "different" forwarded IP is still rejected because
    // Express ignores X-Forwarded-For without trust proxy, so both share the
    // loopback bucket.
    const res2 = await post(app, '10.0.0.2');
    expect(res2.status).toBe(429);
  });

  it('429 response includes retryAfter metadata', async () => {
    const limiter = buildStoryRateLimiter({ windowMs: 60_000, max: 1 });
    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.post('/api/story/generate', limiter, (_req, res) => res.status(200).json({}));

    await post(app, '10.0.0.1');
    const res = await post(app, '10.0.0.1');

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({
      error: 'Too many requests',
    });
    // retryAfter is a Unix timestamp (number) or null
    expect(typeof res.body.retryAfter === 'number' || res.body.retryAfter === null).toBe(true);
    // Retry-After and combined ratelimit header are set by express-rate-limit
    expect(res.headers).toHaveProperty('retry-after');
    expect(res.headers).toHaveProperty('ratelimit');
  });
});
