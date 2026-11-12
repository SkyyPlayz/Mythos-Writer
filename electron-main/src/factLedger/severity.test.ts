import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { PROPERTY_CONTRADICTION_PAIRS } from '../archiveAgent.js';
import { CDM_CLASSIFY_MODEL, createCdmClient } from './cdmClient.js';
import { assignSeverities, classifySeverity, scriptSeverity, type SeverityChange } from './severity.js';

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

const HAIR: SeverityChange = {
  entity: 'Hessa',
  attribute: 'hair',
  a: 'dark',
  b: 'white',
  quoteA: 'hair long and dark',
  quoteB: 'short white hair',
};
const SCAR: SeverityChange = { entity: 'Hessa', attribute: 'scar', a: 'left', b: 'right', quoteA: 'left', quoteB: 'right' };

function ok(content: string): Response {
  return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }] }) } as unknown as Response;
}

let unstubbedFetch: Mock<() => never>;
let fetchImpl: Mock<FetchFn>;

function client() {
  return createCdmClient({
    apiKey: 'sk-or-v1-fixture',
    gateState: () => ({ optIn: true, effectiveMode: 'full' }),
    fetchImpl: fetchImpl as unknown as typeof fetch,
    log: () => {},
  });
}

beforeEach(() => {
  unstubbedFetch = vi.fn(() => {
    throw new Error('unstubbed fetch in a unit test');
  });
  vi.stubGlobal('fetch', unstubbedFetch);
  vi.stubEnv('MYTHOS_E2E', '1');
  vi.stubEnv('MYTHOS_IS_PACKAGED', '0');
  vi.stubEnv('MYTHOS_CDM_FACTS_E2E', '1');
  fetchImpl = vi.fn<FetchFn>(async () => ok('{"top_label":"critical","p":0.95}'));
});

afterEach(() => {
  expect(unstubbedFetch).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('scriptSeverity (the single rule for unsure)', () => {
  it('PROPERTY_CONTRADICTION_PAIRS keys are high, everything else low', () => {
    for (const key of Object.keys(PROPERTY_CONTRADICTION_PAIRS)) expect(scriptSeverity(key)).toBe('high');
    expect(scriptSeverity(' Hair ')).toBe('high');
    expect(scriptSeverity('scar')).toBe('low');
    expect(scriptSeverity('constructor')).toBe('low');
    expect(scriptSeverity('')).toBe('low');
  });
});

describe('classifySeverity', () => {
  it('Full AI uses the second Classify at p >= 0.6, with no scene text', async () => {
    expect(await classifySeverity(SCAR, { mode: 'full', client: client() })).toEqual({ severity: 'critical', source: 'cdm' });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.model).toBe(CDM_CLASSIFY_MODEL);
    const payload = JSON.parse(body.messages[1].content);
    expect(Object.keys(payload).sort()).toEqual(['attribute', 'entity', 'from', 'labels', 'quoteA', 'quoteB', 'to']);
    expect(payload.labels).toEqual(['critical', 'high', 'low']);
  });

  it.each([
    ['p below 0.6', ok('{"top_label":"critical","p":0.4}')],
    ['an off-set label', ok('{"top_label":"absent","p":0.9}')],
    ['prose', ok('critical')],
    ['a 500 twice', { status: 500, text: async () => 'x' } as unknown as Response],
  ])('unsure (%s) uses the script table', async (_label, response) => {
    vi.useFakeTimers();
    fetchImpl.mockResolvedValue(response);
    const pending = Promise.all([
      classifySeverity(HAIR, { mode: 'full', client: client() }),
      classifySeverity(SCAR, { mode: 'full', client: client() }),
    ]);
    await vi.runAllTimersAsync();
    expect(await pending).toEqual([
      { severity: 'high', source: 'script' },
      { severity: 'low', source: 'script' },
    ]);
    vi.useRealTimers();
  });

  it.each([['local'], ['off']] as const)('%s uses the script table and sends nothing', async (mode) => {
    expect(await classifySeverity(HAIR, { mode, client: client() })).toEqual({ severity: 'high', source: 'script' });
    expect(await classifySeverity(SCAR, { mode, client: client() })).toEqual({ severity: 'low', source: 'script' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('assignSeverities never drops a flag (mutant: unsure drops the flag)', () => {
  it('returns one entry per flag, in order, whatever Classify says', async () => {
    fetchImpl
      .mockResolvedValueOnce(ok('{"top_label":"low","p":0.9}'))
      .mockResolvedValueOnce(ok('not json'))
      .mockResolvedValueOnce(ok('{"top_label":"high","p":0.1}'));
    const flags = [
      { ...HAIR, id: 'f1' },
      { ...SCAR, id: 'f2' },
      { ...HAIR, attribute: 'eyes', id: 'f3' },
    ];
    const out = await assignSeverities(flags, { mode: 'full', client: client() });
    expect(out.map((f) => [f.id, f.severity, f.source])).toEqual([
      ['f1', 'low', 'cdm'],
      ['f2', 'low', 'script'],
      ['f3', 'high', 'script'],
    ]);
  });

  it('keeps every flag when the client throws', async () => {
    const throwing = {
      complete: async () => {
        throw new Error('boom');
      },
      stats: () => client().stats(),
    };
    const out = await assignSeverities([HAIR, SCAR], { mode: 'full', client: throwing });
    expect(out).toHaveLength(2);
    expect(out.map((f) => f.severity)).toEqual(['high', 'low']);
  });

  it('keeps every flag in Local Only and AI Off', async () => {
    for (const mode of ['local', 'off'] as const) {
      expect(await assignSeverities([HAIR, SCAR, HAIR], { mode })).toHaveLength(3);
    }
  });
});
