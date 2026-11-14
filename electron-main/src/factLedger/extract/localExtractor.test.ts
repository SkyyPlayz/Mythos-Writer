import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ProviderConfig, StreamRequest } from '../../provider.js';
import { LOCAL_MAX_REPLY_UNITS, createLocalExtractor } from './localExtractor.js';
import { EXTRACT_SYSTEM_PROMPT, PROMPT_VERSION, buildExtractorInput, type FactMode } from './types.js';

type StreamFn = (config: ProviderConfig, req: StreamRequest) => AsyncIterable<string>;

const PROSE = '---\nmood: stormy-frontmatter\n---\nDelphine tied back her copper braid and stepped onto the ferry.';
const NAMES = [{ name: 'Delphine', aliases: ['Del'] }];
const GOOD = JSON.stringify({
  facts: [
    {
      entity: 'Delphine',
      attribute: 'hair',
      value: 'copper braid',
      quote: 'copper braid',
      contextBefore: 'Delphine tied back her ',
      contextAfter: ' and stepped onto the ferry.',
    },
  ],
});

function streamOf(...chunks: string[]): Mock<StreamFn> {
  return vi.fn<StreamFn>(async function* () {
    for (const chunk of chunks) yield chunk;
  });
}

const LOOPBACK: ProviderConfig = { kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'llama3' };

let unstubbedFetch: Mock<() => never>;
let mode: FactMode | string;
let config: ProviderConfig | null;

beforeEach(() => {
  unstubbedFetch = vi.fn(() => {
    throw new Error('unstubbed fetch in a unit test');
  });
  vi.stubGlobal('fetch', unstubbedFetch);
  mode = 'local';
  config = LOOPBACK;
});

afterEach(() => {
  expect(unstubbedFetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.doUnmock('./types.js');
});

function extractor(stream: Mock<StreamFn>) {
  return createLocalExtractor({ getConfig: () => config, getMode: () => mode, stream });
}

const signal = () => new AbortController().signal;

describe('localExtractor', () => {
  it('extracts through a loopback provider and validates the reply', async () => {
    const stream = streamOf(GOOD.slice(0, 20), GOOD.slice(20));
    const out = await extractor(stream).extract(buildExtractorInput(PROSE, NAMES), signal());
    expect(out).toEqual(JSON.parse(GOOD));
    expect(stream).toHaveBeenCalledTimes(1);
    const [cfg, req] = stream.mock.calls[0];
    expect(cfg).toBe(LOOPBACK);
    expect(req.system).toBe(EXTRACT_SYSTEM_PROMPT);
    expect(req.redirect).toBe('error');
    expect(req.messages).toHaveLength(1);
    const user = JSON.parse(req.messages[0].content);
    expect(user.prose).toBe('Delphine tied back her copper braid and stepped onto the ferry.');
    expect(req.messages[0].content).not.toContain('stormy-frontmatter');
  });

  it.each([
    ['localhost', 'http://localhost:1234/v1'],
    ['::1', 'http://[::1]:8080'],
    ['127.0.0.2', 'http://127.0.0.2:5000'],
  ])('allows loopback %s', async (_label, baseUrl) => {
    config = { kind: 'custom', baseUrl, model: 'm' };
    const stream = streamOf(GOOD);
    expect(await extractor(stream).extract(buildExtractorInput(PROSE, NAMES), signal())).not.toBeNull();
  });

  it.each([
    ['a remote host', { kind: 'custom', baseUrl: 'https://api.example.com/v1', model: 'm' }],
    ['a lookalike 127. host', { kind: 'custom', baseUrl: 'http://127.example.com', model: 'm' }],
    ['openrouter', { kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'm' }],
    ['the direct ScaleDown host', { kind: 'custom', baseUrl: 'https://api.scaledown.xyz', model: 'm' }],
    ['no baseUrl', { kind: 'ollama', model: 'llama3' }],
    ['kind anthropic with a loopback baseUrl (its SDK ignores baseUrl)', { kind: 'anthropic', apiKey: 'k', baseUrl: 'http://127.0.0.1:1234', model: 'm' }],
    ['an unknown kind', { kind: 'mystery', baseUrl: 'http://127.0.0.1:1234', model: 'm' }],
  ])('never sends to %s', async (_label, cfg) => {
    config = cfg as ProviderConfig;
    const stream = streamOf(GOOD);
    expect(await extractor(stream).extract(buildExtractorInput(PROSE, NAMES), signal())).toBeNull();
    expect(stream).not.toHaveBeenCalled();
  });

  it('never sends with no provider configured', async () => {
    config = null;
    const stream = streamOf(GOOD);
    expect(await extractor(stream).extract(buildExtractorInput(PROSE, NAMES), signal())).toBeNull();
    expect(stream).not.toHaveBeenCalled();
  });

  it.each([['off'], ['unknown'], [undefined]])('mode %j sends nothing (zero egress)', async (m) => {
    mode = m as string;
    const stream = streamOf(GOOD);
    expect(await extractor(stream).extract(buildExtractorInput(PROSE, NAMES), signal())).toBeNull();
    expect(stream).not.toHaveBeenCalled();
  });

  it('kind anthropic never sends, in Local Only or Full AI', async () => {
    config = { kind: 'anthropic', apiKey: 'k', baseUrl: 'http://localhost:1234', model: 'm' };
    const stream = streamOf(GOOD);
    for (const m of ['local', 'full']) {
      mode = m;
      expect(await extractor(stream).extract(buildExtractorInput(PROSE, NAMES), signal())).toBeNull();
    }
    expect(stream).not.toHaveBeenCalled();
  });

  it.each([['ollama'], ['lmstudio'], ['llamacpp'], ['custom'], ['openai']] as const)(
    'kind %s with a loopback baseUrl may send',
    async (kind) => {
      config = { kind, baseUrl: 'http://127.0.0.1:9000', model: 'm' };
      const stream = streamOf(GOOD);
      expect(await extractor(stream).extract(buildExtractorInput(PROSE, NAMES), signal())).not.toBeNull();
      expect(stream).toHaveBeenCalledTimes(1);
    },
  );

  it('Full AI may fall back to local', async () => {
    mode = 'full';
    const stream = streamOf(GOOD);
    expect(await extractor(stream).extract(buildExtractorInput(PROSE, NAMES), signal())).not.toBeNull();
  });

  it('re-checks the mode before each send', async () => {
    const stream = streamOf(GOOD);
    const ex = extractor(stream);
    const input = buildExtractorInput(PROSE, NAMES);
    expect(await ex.extract(input, signal())).not.toBeNull();
    mode = 'off';
    expect(await ex.extract(input, signal())).toBeNull();
    mode = 'local';
    config = { kind: 'custom', baseUrl: 'https://remote.example.com', model: 'm' };
    expect(await ex.extract(input, signal())).toBeNull();
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['prose', ['Delphine has a copper braid.']],
    ['a cut-off answer', [GOOD.slice(0, 40)]],
    ['a refusal', ["I can't do that."]],
    ['empty', []],
  ])('returns null for %s', async (_label, chunks) => {
    const stream = streamOf(...chunks);
    expect(await extractor(stream).extract(buildExtractorInput(PROSE, NAMES), signal())).toBeNull();
  });

  it('returns null when the stream throws', async () => {
    const stream = vi.fn<StreamFn>(async function* () {
      yield '{"facts":';
      throw new Error('connection reset');
    });
    expect(await extractor(stream).extract(buildExtractorInput(PROSE, NAMES), signal())).toBeNull();
  });

  it('stops reading a runaway reply', async () => {
    const chunk = 'x'.repeat(64 * 1024);
    let yielded = 0;
    const stream = vi.fn<StreamFn>(async function* () {
      for (;;) {
        yielded += 1;
        yield chunk;
      }
    });
    expect(await extractor(stream).extract(buildExtractorInput(PROSE, NAMES), signal())).toBeNull();
    expect(yielded).toBe(Math.floor(LOCAL_MAX_REPLY_UNITS / chunk.length) + 1);
  });

  it('does not send when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const stream = streamOf(GOOD);
    expect(await extractor(stream).extract(buildExtractorInput(PROSE, NAMES), controller.signal)).toBeNull();
    expect(stream).not.toHaveBeenCalled();
  });

  it('returns null when the stream errors after a complete, valid reply (G4)', async () => {
    const stream = vi.fn<StreamFn>(async function* () {
      yield GOOD;
      throw new Error('connection reset after the last token');
    });
    expect(await extractor(stream).extract(buildExtractorInput(PROSE, NAMES), signal())).toBeNull();
  });
});

describe('localExtractor on the default provider stream: redirects (S1)', () => {
  // Real loopback servers, no injected stream: `origin` is the configured
  // loopback baseUrl and answers with a redirect; `elsewhere` stands in for the
  // host a redirect would carry the POST (prose + names) to.
  let origin: Server;
  let elsewhere: Server;
  let originUrl = '';
  let elsewhereHits: Array<{ method?: string; body: string }> = [];
  let status = 307;

  function listen(server: Server): Promise<number> {
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
  }

  beforeEach(async () => {
    vi.unstubAllGlobals(); // the default path uses the real fetch, to loopback only
    elsewhereHits = [];
    elsewhere = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString('utf8')));
      req.on('end', () => {
        elsewhereHits.push({ method: req.method, body });
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: GOOD } }] })}\n\ndata: [DONE]\n\n`);
      });
    });
    const elsewherePort = await listen(elsewhere);
    origin = createServer((req, res) => {
      req.resume();
      res.writeHead(status, { location: `http://127.0.0.1:${elsewherePort}${req.url ?? '/'}` });
      res.end();
    });
    originUrl = `http://127.0.0.1:${await listen(origin)}/v1`;
  });

  afterEach(async () => {
    await Promise.all([origin, elsewhere].map((s) => new Promise((resolve) => s.close(resolve))));
  });

  it.each([[307], [308]])('a %i from the loopback baseUrl is refused: no second request, result null', async (code) => {
    status = code;
    config = { kind: 'custom', baseUrl: originUrl, model: 'm' };
    const ex = createLocalExtractor({ getConfig: () => config, getMode: () => mode });
    expect(await ex.extract(buildExtractorInput(PROSE, NAMES), signal())).toBeNull();
    expect(elsewhereHits).toEqual([]);
  });
});

describe('promptVersion (B1)', () => {
  it('comes from PROMPT_VERSION.local', () => {
    expect(extractor(streamOf()).promptVersion).toBe(PROMPT_VERSION.local);
  });

  it('a bump to PROMPT_VERSION changes the version the extractor reports', async () => {
    vi.resetModules();
    vi.doMock('./types.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./types.js')>();
      return { ...actual, PROMPT_VERSION: Object.freeze({ ...actual.PROMPT_VERSION, local: 5 }) };
    });
    const bumped = await import('./localExtractor.js');
    expect(bumped.createLocalExtractor({ getConfig: () => null, getMode: () => 'off' }).promptVersion).toBe(5);
  });
});
