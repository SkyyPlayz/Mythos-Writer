import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  CDM_BREAKER_THRESHOLD,
  CDM_CHAT_URL,
  CDM_CLASSIFY_MODEL,
  CDM_EXTRACT_MODEL,
  CDM_MAX_REQUEST_BYTES,
  CDM_MODEL_ALLOWLIST,
  CDM_ORIGIN,
  CDM_RETRY_DELAY_MS,
  CDM_TIMEOUT_MS,
  cdmClassify,
  createCdmClient,
  isCdmTargetAllowed,
  type CdmGateState,
  type CdmRequest,
} from './cdmClient.js';

const KEY = 'sk-or-v1-fixture-key-do-not-log-4f2a';
const QUOTE = 'Quillon wore a cracked monocle on a silver chain.';

type FakeReply = { status: number; body: string };
type FetchFn = (url: string, init: RequestInit) => Promise<Response>;
type FetchMock = Mock<FetchFn>;

function fetchMock(impl: FetchFn = async () => {
  throw new Error('no reply queued');
}): FetchMock {
  return vi.fn(impl);
}

/** Let queued promise callbacks run without moving fake time. */
async function flush(): Promise<void> {
  for (let i = 0; i < 25; i += 1) await Promise.resolve();
}

function reply(status: number, body: string): Response {
  return { status, text: async () => body } as unknown as Response;
}

function ok(content: string): Response {
  return reply(200, JSON.stringify({ choices: [{ message: { content } }] }));
}

function enableFlag(): void {
  vi.stubEnv('MYTHOS_E2E', '1');
  vi.stubEnv('MYTHOS_IS_PACKAGED', '0');
  vi.stubEnv('MYTHOS_CDM_FACTS_E2E', '1');
}

function disableFlag(): void {
  vi.stubEnv('MYTHOS_CDM_FACTS_E2E', undefined as unknown as string);
}

const accept = (text: string): string => text;

function req(model = CDM_EXTRACT_MODEL, content = QUOTE): CdmRequest {
  return { model, messages: [{ role: 'user', content }] };
}

let unstubbedFetch: Mock<() => never>;
let gate: CdmGateState;
let lines: string[];

function makeClient(fetchImpl: FetchMock, endpoint?: string) {
  return createCdmClient({
    apiKey: KEY,
    gateState: () => gate,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    endpoint,
    log: (line) => lines.push(line),
  });
}

function bodyOf(fetchImpl: FetchMock, call = 0): Record<string, unknown> {
  return JSON.parse(fetchImpl.mock.calls[call][1].body as string);
}

beforeEach(() => {
  unstubbedFetch = vi.fn(() => {
    throw new Error('unstubbed fetch in a unit test');
  });
  vi.stubGlobal('fetch', unstubbedFetch);
  enableFlag();
  gate = { optIn: true, effectiveMode: 'full' };
  lines = [];
});

afterEach(() => {
  expect(unstubbedFetch).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('request body and transport', () => {
  it('sends the policy provider block, no models list, no tools, redirect:error, to the pinned route', async () => {
    const fetchImpl = fetchMock(async () => ok('fine'));
    const client = makeClient(fetchImpl);
    const caller = {
      ...req(),
      provider: { zdr: false, data_collection: 'allow', order: ['some-vendor'] },
      models: ['scaledown/extract', 'google/gemini-2.5-pro'],
      tools: [{ type: 'function', function: { name: 'x' } }],
      route: 'fallback',
    } as unknown as CdmRequest;
    const result = await client.complete(caller, undefined, accept);
    expect(result).toEqual({ ok: true, value: 'fine' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(CDM_CHAT_URL);
    expect(url.startsWith(`${CDM_ORIGIN}/`)).toBe(true);
    expect(CDM_ORIGIN).toBe('https://openrouter.ai/api/v1');
    expect(init.redirect).toBe('error');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const body = bodyOf(fetchImpl);
    expect(body.provider).toEqual({ ignore: ['google-vertex', 'google-ai-studio'], zdr: true, data_collection: 'deny' });
    expect(body).not.toHaveProperty('models');
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('route');
    expect(Object.keys(body).sort()).toEqual(['messages', 'model', 'provider', 'stream', 'temperature']);
    expect(body.model).toBe(CDM_EXTRACT_MODEL);
  });

  it('the model allowlist is frozen to extract and classify-1', () => {
    expect([...CDM_MODEL_ALLOWLIST]).toEqual(['scaledown/extract', 'scaledown/classify-1']);
    expect(Object.isFrozen(CDM_MODEL_ALLOWLIST)).toBe(true);
  });

  it('never has more than 2 calls in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const fetchImpl = fetchMock(
      () =>
        new Promise<Response>((resolve) => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          releases.push(() => {
            inFlight -= 1;
            resolve(ok('x'));
          });
        }),
    );
    const client = makeClient(fetchImpl);
    const all = Promise.all([1, 2, 3, 4, 5].map(() => client.complete(req(), undefined, accept)));
    for (let i = 0; i < 5; i += 1) {
      await vi.waitFor(() => expect(releases.length).toBeGreaterThan(i));
      releases[i]();
    }
    const results = await all;
    expect(results.every((r) => r.ok)).toBe(true);
    expect(peak).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });
});

describe('refused before fetch', () => {
  it.each([
    ['http origin', 'http://openrouter.ai/api/v1/chat/completions'],
    ['lookalike host', 'https://openrouter.ai.evil.example/api/v1/chat/completions'],
    ['lookalike prefix', 'https://notopenrouter.ai/api/v1/chat/completions'],
    ['subdomain', 'https://eu.openrouter.ai/api/v1/chat/completions'],
    ['non-pinned path', 'https://openrouter.ai/api/v1/completions'],
    ['other version path', 'https://openrouter.ai/api/v2/chat/completions'],
    ['query string', 'https://openrouter.ai/api/v1/chat/completions?model=x'],
    ['port', 'https://openrouter.ai:8443/api/v1/chat/completions'],
    ['credentials', 'https://user:pw@openrouter.ai/api/v1/chat/completions'],
    ['direct ScaleDown host', 'https://api.scaledown.xyz/v1/chat/completions'],
    ['ScaleDown host over http', 'http://api.scaledown.xyz/v1/extract'],
  ])('%s', async (_label, endpoint) => {
    const fetchImpl = fetchMock(async () => ok('x'));
    const client = makeClient(fetchImpl, endpoint);
    const result = await client.complete(req(), undefined, accept);
    expect(result).toEqual({ ok: false, reason: 'refused_target' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(isCdmTargetAllowed(endpoint, CDM_EXTRACT_MODEL)).toBe(false);
  });

  it.each([
    ['scaledown/summarize'],
    ['scaledown/summarize-1'],
    ['scaledown/extract-2'],
    ['scaledown/classify'],
    [' scaledown/extract'],
    ['SCALEDOWN/EXTRACT'],
    ['google/gemini-2.5-pro'],
    ['google/scaledown-extract'],
    ['openai/gpt-4o-mini'],
    [''],
  ])('off-allowlist model %j', async (model) => {
    const fetchImpl = fetchMock(async () => ok('x'));
    const client = makeClient(fetchImpl);
    const result = await client.complete(req(model), undefined, accept);
    expect(result).toEqual({ ok: false, reason: 'refused_target' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('allows exactly the pinned route with an allowlisted model', () => {
    expect(isCdmTargetAllowed(CDM_CHAT_URL, CDM_EXTRACT_MODEL)).toBe(true);
    expect(isCdmTargetAllowed(CDM_CHAT_URL, CDM_CLASSIFY_MODEL)).toBe(true);
    expect(isCdmTargetAllowed(undefined, CDM_EXTRACT_MODEL)).toBe(false);
    expect(isCdmTargetAllowed(CDM_CHAT_URL, undefined)).toBe(false);
  });

  it('refuses with no key', async () => {
    const fetchImpl = fetchMock(async () => ok('x'));
    const client = createCdmClient({
      apiKey: '',
      gateState: () => gate,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: () => {},
    });
    expect(await client.complete(req(), undefined, accept)).toEqual({ ok: false, reason: 'no_key' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('gate checked right before every send', () => {
  it.each([
    ['AI Off', () => (gate = { optIn: true, effectiveMode: 'off' })],
    ['Local Only', () => (gate = { optIn: true, effectiveMode: 'local' })],
    ['opt-out', () => (gate = { optIn: false, effectiveMode: 'full' })],
    ['opt-in "true"', () => (gate = { optIn: 'true', effectiveMode: 'full' })],
    ['flag off', () => disableFlag()],
  ])('a flip to %s between enqueue and send gives 0 fetches for the queued call', async (_label, flip) => {
    const releases: Array<() => void> = [];
    const fetchImpl = fetchMock(() => new Promise<Response>((resolve) => releases.push(() => resolve(ok('x')))));
    const client = makeClient(fetchImpl);
    const first = client.complete(req(), undefined, accept);
    const second = client.complete(req(), undefined, accept);
    const queued = client.complete(req(), undefined, accept);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    flip();
    releases.forEach((release) => release());
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
    expect(await queued).toEqual({ ok: false, reason: 'gate_closed' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('a flip to Off during the retry wait stops the retry', async () => {
    vi.useFakeTimers();
    const fetchImpl = fetchMock(async () => reply(503, 'busy'));
    const client = makeClient(fetchImpl);
    const pending = client.complete(req(), undefined, accept);
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    gate = { optIn: true, effectiveMode: 'off' };
    await vi.advanceTimersByTimeAsync(CDM_RETRY_DELAY_MS);
    expect(await pending).toEqual({ ok: false, reason: 'gate_closed' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('flag off from the start gives 0 fetches even with opt-in and Full AI', async () => {
    disableFlag();
    const fetchImpl = fetchMock(async () => ok('x'));
    const client = makeClient(fetchImpl);
    expect(await client.complete(req(), undefined, accept)).toEqual({ ok: false, reason: 'gate_closed' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('failures', () => {
  it.each<[string, FakeReply]>([
    ['404 no ZDR endpoint', { status: 404, body: '{"error":{"message":"No endpoints found matching your data policy (Zero data retention)"}}' }],
    ['400 ZDR', { status: 400, body: '{"error":{"message":"No ZDR endpoint available for this model"}}' }],
    ['503 ZDR', { status: 503, body: '{"error":{"message":"zero data retention is not supported"}}' }],
    ['429 ZDR', { status: 429, body: 'no endpoints found that respect zdr' }],
  ])('%s: unsure no_zdr with 0 retries and no other route', async (_label, r) => {
    const fetchImpl = fetchMock(async () => reply(r.status, r.body));
    const client = makeClient(fetchImpl);
    expect(await client.complete(req(), undefined, accept)).toEqual({ ok: false, reason: 'no_zdr' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(CDM_CHAT_URL);
    expect(bodyOf(fetchImpl).model).toBe(CDM_EXTRACT_MODEL);
  });

  it('404 for the model: unsure with 0 retries', async () => {
    const fetchImpl = fetchMock(async () => reply(404, '{"error":{"message":"Model scaledown/extract is not a valid model ID"}}'));
    const client = makeClient(fetchImpl);
    expect(await client.complete(req(), undefined, accept)).toEqual({ ok: false, reason: 'model_unavailable' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([[429], [500], [502], [503]])('%i gets exactly 1 retry after 2 s', async (status) => {
    vi.useFakeTimers();
    const fetchImpl = fetchMock(async () => reply(status, 'later'));
    const client = makeClient(fetchImpl);
    const pending = client.complete(req(), undefined, accept);
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CDM_RETRY_DELAY_MS - 1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // Well past any further retry window: still exactly one retry.
    await vi.advanceTimersByTimeAsync(CDM_RETRY_DELAY_MS * 5);
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.every((call) => call[0] === CDM_CHAT_URL)).toBe(true);
    expect(fetchImpl.mock.calls.every((_c, i) => bodyOf(fetchImpl, i).model === CDM_EXTRACT_MODEL)).toBe(true);
  });

  it('a retry that succeeds returns the reply', async () => {
    vi.useFakeTimers();
    const fetchImpl = fetchMock().mockResolvedValueOnce(reply(429, 'slow down')).mockResolvedValueOnce(ok('second'));
    const client = makeClient(fetchImpl);
    const pending = client.complete(req(), undefined, accept);
    await flush();
    await vi.advanceTimersByTimeAsync(CDM_RETRY_DELAY_MS);
    expect(await pending).toEqual({ ok: true, value: 'second' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([[400], [401], [403], [418]])('other non-200 (%i) is unsure with no retry', async (status) => {
    const fetchImpl = fetchMock(async () => reply(status, 'nope'));
    const client = makeClient(fetchImpl);
    expect(await client.complete(req(), undefined, accept)).toEqual({ ok: false, reason: 'http_error' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('a timeout is unsure', async () => {
    vi.useFakeTimers();
    const fetchImpl = fetchMock(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const client = makeClient(fetchImpl);
    const pending = client.complete(req(), undefined, accept);
    await flush();
    await vi.advanceTimersByTimeAsync(CDM_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, reason: 'timeout' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['not JSON', 'not json at all'],
    ['no choices', '{"id":"x"}'],
    ['non-string content', '{"choices":[{"message":{"content":null}}]}'],
    ['an error object', '{"error":{"message":"oops"}}'],
  ])('bad JSON (%s) is unsure', async (_label, body) => {
    const fetchImpl = fetchMock(async () => reply(200, body));
    const client = makeClient(fetchImpl);
    expect(await client.complete(req(), undefined, accept)).toEqual({ ok: false, reason: 'bad_json' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('a reply off the contract is unsure', async () => {
    const fetchImpl = fetchMock(async () => ok('Sure! Here are the facts.'));
    const client = makeClient(fetchImpl);
    expect(await client.complete(req(), undefined, () => null)).toEqual({ ok: false, reason: 'bad_contract' });
  });

  it('a redirect (fetch rejects under redirect:error) is unsure and not followed', async () => {
    const fetchImpl = fetchMock(async () => {
      throw new TypeError('fetch failed: unexpected redirect');
    });
    const client = makeClient(fetchImpl);
    expect(await client.complete(req(), undefined, accept)).toEqual({ ok: false, reason: 'network' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('a caller abort is unsure and does not trip the breaker', async () => {
    const fetchImpl = fetchMock(async () => ok('x'));
    const client = makeClient(fetchImpl);
    const controller = new AbortController();
    controller.abort();
    for (let i = 0; i < CDM_BREAKER_THRESHOLD + 1; i += 1) {
      expect(await client.complete(req(), controller.signal, accept)).toEqual({ ok: false, reason: 'aborted' });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(client.stats().breakerOpen).toBe(false);
  });
});

describe('circuit breaker (N10)', () => {
  it('3 vendor unsures in a row stop calls on that instance; a new instance calls again', async () => {
    const fetchImpl = fetchMock(async () => reply(400, 'bad'));
    const jobOne = makeClient(fetchImpl);
    for (let i = 0; i < CDM_BREAKER_THRESHOLD; i += 1) await jobOne.complete(req(), undefined, accept);
    expect(fetchImpl).toHaveBeenCalledTimes(CDM_BREAKER_THRESHOLD);
    expect(jobOne.stats().breakerOpen).toBe(true);
    expect(await jobOne.complete(req(), undefined, accept)).toEqual({ ok: false, reason: 'breaker_open' });
    expect(fetchImpl).toHaveBeenCalledTimes(CDM_BREAKER_THRESHOLD);

    const jobTwo = makeClient(fetchImpl);
    expect(jobTwo.stats().breakerOpen).toBe(false);
    await jobTwo.complete(req(), undefined, accept);
    expect(fetchImpl).toHaveBeenCalledTimes(CDM_BREAKER_THRESHOLD + 1);
  });

  it('a success resets the streak', async () => {
    const fetchImpl = fetchMock()
      .mockResolvedValueOnce(reply(400, 'x'))
      .mockResolvedValueOnce(reply(400, 'x'))
      .mockResolvedValueOnce(ok('fine'))
      .mockResolvedValueOnce(reply(400, 'x'))
      .mockResolvedValueOnce(reply(400, 'x'));
    const client = makeClient(fetchImpl);
    for (let i = 0; i < 5; i += 1) await client.complete(req(), undefined, accept);
    expect(client.stats().breakerOpen).toBe(false);
  });

  it('local refusals (over cap, refused target) do not trip it', async () => {
    const fetchImpl = fetchMock(async () => ok('x'));
    const client = makeClient(fetchImpl);
    for (let i = 0; i < CDM_BREAKER_THRESHOLD; i += 1) {
      await client.complete(req('scaledown/summarize'), undefined, accept);
      await client.complete(req(CDM_EXTRACT_MODEL, 'x'.repeat(CDM_MAX_REQUEST_BYTES + 1)), undefined, accept);
    }
    expect(client.stats().breakerOpen).toBe(false);
    expect((await client.complete(req(), undefined, accept)).ok).toBe(true);
  });
});

describe('request size cap (B5)', () => {
  it('an over-cap request is not sent, is counted, and the largest request size is reported', async () => {
    const fetchImpl = fetchMock(async () => ok('x'));
    const client = makeClient(fetchImpl);
    await client.complete(req(CDM_EXTRACT_MODEL, 'small scene'), undefined, accept);
    const small = client.stats().largestRequestBytes;
    expect(small).toBeGreaterThan(0);
    expect(small).toBe(Buffer.byteLength(fetchImpl.mock.calls[0][1].body as string, 'utf8'));

    const big = 'é'.repeat(CDM_MAX_REQUEST_BYTES / 2);
    const result = await client.complete(req(CDM_EXTRACT_MODEL, big), undefined, accept);
    expect(result).toEqual({ ok: false, reason: 'over_cap' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const stats = client.stats();
    expect(stats.overCap).toBe(1);
    expect(stats.largestRequestBytes).toBeGreaterThan(CDM_MAX_REQUEST_BYTES);
    expect(stats.largestResponseBytes).toBeGreaterThan(0);
  });

  it('measures UTF-8 bytes, not string length', async () => {
    const fetchImpl = fetchMock(async () => ok('x'));
    const client = makeClient(fetchImpl);
    // Under the cap in code units, over it in UTF-8 bytes.
    const content = '🦊'.repeat(Math.ceil(CDM_MAX_REQUEST_BYTES / 4) + 8);
    expect(content.length).toBeLessThan(CDM_MAX_REQUEST_BYTES);
    expect(await client.complete(req(CDM_EXTRACT_MODEL, content), undefined, accept)).toEqual({
      ok: false,
      reason: 'over_cap',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('logs', () => {
  it('captured logs hold byte counts only: no fixture quote, no key', async () => {
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const fetchImpl = fetchMock()
      .mockResolvedValueOnce(ok(QUOTE))
      .mockResolvedValueOnce(reply(400, `{"error":"${QUOTE}"}`))
      .mockResolvedValueOnce(reply(404, `no endpoints found ${QUOTE}`));
    const viaOption = makeClient(fetchImpl);
    await viaOption.complete(req(), undefined, accept);
    await viaOption.complete(req(), undefined, accept);
    await viaOption.complete(req(), undefined, accept);
    await viaOption.complete(req(CDM_EXTRACT_MODEL, QUOTE.repeat(3000)), undefined, accept);

    const viaConsole = createCdmClient({
      apiKey: KEY,
      gateState: () => gate,
      fetchImpl: fetchMock(async () => ok(QUOTE)) as unknown as typeof fetch,
    });
    await viaConsole.complete(req(), undefined, accept);

    const consoleText = consoleSpies.flatMap((s) => s.mock.calls.flat().map(String));
    const all = [...lines, ...consoleText].join('\n');
    expect(lines.length).toBeGreaterThan(0);
    expect(consoleText.length).toBeGreaterThan(0);
    expect(all).not.toContain(QUOTE);
    expect(all).not.toContain('cracked monocle');
    expect(all).not.toContain(KEY);
    expect(all).not.toContain('fixture-key');
    expect(all).toMatch(/\d+ bytes/);
    consoleSpies.forEach((s) => s.mockRestore());
  });
});

describe('cdmClassify', () => {
  it('sends to classify-1 and returns the verdict; off-set replies are null', async () => {
    const fetchImpl = fetchMock()
      .mockResolvedValueOnce(ok('{"top_label":"high","p":0.9}'))
      .mockResolvedValueOnce(ok('{"top_label":"severe","p":0.9}'));
    const client = makeClient(fetchImpl);
    const labels = ['critical', 'high', 'low'] as const;
    expect(await cdmClassify(client, labels, 'sys', { a: 1 })).toEqual({ label: 'high', p: 0.9 });
    expect(bodyOf(fetchImpl).model).toBe(CDM_CLASSIFY_MODEL);
    expect(await cdmClassify(client, labels, 'sys', { a: 1 })).toBeNull();
  });
});
