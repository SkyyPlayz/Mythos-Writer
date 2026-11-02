// PLAN-AI-MODES M-1 review: the model-list GET refuses redirects, caps the
// body at 1 MiB, and checks the connected address, not just the URL text.
//
// Real undici (no mock) against a local HTTP server on 127.0.0.1, so the
// redirect, size and loopback rules are proven on the actual transport.

import { describe, it, expect, afterEach, vi } from 'vitest';
import http from 'http';
import { listModels, isBlockedAddress, MAX_GUARDED_BODY_BYTES } from './provider.js';

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

let server: http.Server | undefined;
let requests = 0;

afterEach(async () => {
  vi.unstubAllEnvs();
  requests = 0;
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

function startServer(handler: Handler): Promise<number> {
  server = http.createServer((req, res) => {
    requests += 1;
    res.on('error', () => undefined);
    handler(req, res);
  });
  return new Promise((resolve, reject) => {
    server!.on('error', reject);
    server!.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('failed to bind test server'));
        return;
      }
      resolve(address.port);
    });
  });
}

function errorOf(result: Awaited<ReturnType<typeof listModels>>): string {
  expect(result.ok).toBe(false);
  return (result as { ok: false; error: string }).error;
}

/** Valid JSON with one model, padded past the 1 MiB cap. */
function oversizedCatalog(): string {
  return JSON.stringify({ data: [{ id: 'm' }], pad: 'x'.repeat(MAX_GUARDED_BODY_BYTES + 1024) });
}

describe('listModels guarded GET (real undici)', () => {
  it('lists models from a local LM Studio server', async () => {
    const port = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'local-model' }] }));
    });
    const result = await listModels({ kind: 'lmstudio', baseUrl: `http://127.0.0.1:${port}/v1` });
    expect(result).toEqual({ ok: true, models: ['local-model'] });
    expect(requests).toBe(1);
  });

  it('refuses a redirect to cloud metadata and never follows it', async () => {
    const port = await startServer((_req, res) => {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
    });
    const result = await listModels({ kind: 'lmstudio', baseUrl: `http://127.0.0.1:${port}/v1` });
    expect(errorOf(result)).toMatch(/redirect/i);
    expect(requests).toBe(1);
  });

  it('refuses a same-host redirect too', async () => {
    const port = await startServer((req, res) => {
      if (req.url === '/v1/models') {
        res.writeHead(302, { Location: '/v1/elsewhere' });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'followed' }] }));
    });
    const result = await listModels({ kind: 'lmstudio', baseUrl: `http://127.0.0.1:${port}/v1` });
    expect(errorOf(result)).toMatch(/redirect/i);
    expect(requests).toBe(1);
  });

  it('refuses a body over 1 MiB announced by Content-Length, before reading it', async () => {
    const port = await startServer((_req, res) => {
      // Announce 2 MiB, send a few bytes and stall: only the header check can answer fast.
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': 2 * MAX_GUARDED_BODY_BYTES });
      res.write('{"data":');
    });
    const result = await listModels({ kind: 'lmstudio', baseUrl: `http://127.0.0.1:${port}/v1` });
    expect(errorOf(result)).toMatch(/larger than 1 MiB/);
  });

  it('refuses a chunked body once it streams past 1 MiB', async () => {
    const body = oversizedCatalog();
    const port = await startServer((_req, res) => {
      // No Content-Length: the cap has to be enforced while reading.
      res.writeHead(200, { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' });
      for (let i = 0; i < body.length; i += 64 * 1024) res.write(body.slice(i, i + 64 * 1024));
      res.end();
    });
    const result = await listModels({ kind: 'lmstudio', baseUrl: `http://127.0.0.1:${port}/v1` });
    expect(errorOf(result)).toMatch(/larger than 1 MiB/);
  });

  it('refuses loopback for a cloud kind before any request (IP literal)', async () => {
    const port = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'gpt-4o' }] }));
    });
    const result = await listModels({ kind: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'sk-test' });
    expect(errorOf(result)).toMatch(/private or reserved address/);
    expect(requests).toBe(0);
  });

  it('refuses loopback for a cloud kind when a hostname resolves to it', async () => {
    const port = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'gpt-4o' }] }));
    });
    const result = await listModels({ kind: 'openai', baseUrl: `http://localhost:${port}/v1`, apiKey: 'sk-test' });
    expect(errorOf(result)).toMatch(/private or reserved address/);
    expect(requests).toBe(0);
  });

  // ANTHROPIC_BASE_URL is the user's environment, never renderer input, and
  // the SDK chat path already talks to it: a local gateway (LiteLLM) is reached.
  it('reaches a loopback ANTHROPIC_BASE_URL gateway, as the SDK chat path does', async () => {
    const port = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'claude-sonnet-4-6' }] }));
    });
    vi.stubEnv('ANTHROPIC_BASE_URL', `http://127.0.0.1:${port}`);
    const result = await listModels({ kind: 'anthropic', apiKey: 'sk-ant-api03-test' });
    expect(result).toEqual({ ok: true, models: ['claude-sonnet-4-6'] });
    expect(requests).toBe(1);
  });

});

describe('isBlockedAddress', () => {
  const cases: Array<[address: string, family: 4 | 6, local: boolean, cloud: boolean]> = [
    // [address, family, blocked for a local kind, blocked for a cloud kind]
    ['169.254.169.254', 4, true, true],
    ['10.0.0.1', 4, true, true],
    ['172.20.0.1', 4, true, true],
    ['192.168.1.1', 4, true, true],
    ['0.0.0.0', 4, true, true],
    ['224.0.0.1', 4, true, true],
    ['255.255.255.255', 4, true, true],
    ['fd12::1', 6, true, true],
    ['fe80::1', 6, true, true],
    ['ff02::1', 6, true, true],
    ['::', 6, true, true],
    ['::ffff:169.254.169.254', 6, true, true],
    ['::ffff:a9fe:a9fe', 6, true, true],
    ['::ffff:10.0.0.1', 6, true, true],
    ['::10.0.0.1', 6, true, true],
    // IPv6 transition forms that embed an IPv4 address (NAT64, 6to4, RFC 6145).
    ['64:ff9b::a9fe:a9fe', 6, true, true],
    ['64:ff9b::10.0.0.1', 6, true, true],
    ['2002:a9fe:a9fe::', 6, true, true],
    ['2002:c0a8:101::1', 6, true, true],
    ['::ffff:0:a9fe:a9fe', 6, true, true],
    ['::ffff:0:10.0.0.1', 6, true, true],
    // Carrier-grade NAT (Tailscale) and benchmarking: local kinds only, as validateBaseUrl allows.
    ['100.64.0.1', 4, false, true],
    ['100.101.102.103', 4, false, true],
    ['198.18.0.1', 4, false, true],
    ['64:ff9b::7f00:1', 6, false, true],
    ['127.0.0.1', 4, false, true],
    ['127.8.9.10', 4, false, true],
    ['::1', 6, false, true],
    ['::ffff:127.0.0.1', 6, false, true],
    ['8.8.8.8', 4, false, false],
    ['172.15.0.1', 4, false, false],
    ['100.128.0.1', 4, false, false],
    ['2606:4700:4700::1111', 6, false, false],
    ['::ffff:8.8.8.8', 6, false, false],
    ['64:ff9b::808:808', 6, false, false],
    ['2002:808:808::1', 6, false, false],
  ];

  it.each(cases)('%s (IPv%s): local blocked=%s, cloud blocked=%s', (address, family, local, cloud) => {
    expect(isBlockedAddress(address, family, true)).toBe(local);
    expect(isBlockedAddress(address, family, false)).toBe(cloud);
  });

  it('blocks anything that is not an IP address', () => {
    expect(isBlockedAddress('localhost', undefined, true)).toBe(true);
    expect(isBlockedAddress('', 4, true)).toBe(true);
  });

  it('blocks an address whose declared family does not match', () => {
    expect(isBlockedAddress('8.8.8.8', 6, false)).toBe(true);
  });
});
