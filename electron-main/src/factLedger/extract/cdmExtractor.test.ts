import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { CDM_CHAT_URL, CDM_EXTRACT_MODEL, createCdmClient } from '../cdmClient.js';
import { createCdmExtractor } from './cdmExtractor.js';
import { PROMPT_VERSION, buildExtractorInput, type EntityNames } from './types.js';

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

const SCENE_A = [
  '---',
  'title: The Glass Orchard',
  'secret_key: frontmatter-only-value-77',
  'eyes: violet',
  '---',
  'Perrin Ashdown knelt among the glass trees. His grey eyes caught every glint.',
  'Wick, his apprentice, swept the shards into a pail.',
].join('\n');
const SCENE_B = 'Across the valley, Perrin Ashdown climbed the bell tower with green eyes half shut.';
const LEDGER_VALUE = 'ledger-recorded-eye-colour-teal';
const NAMES: EntityNames[] = [
  { name: 'Perrin Ashdown', aliases: ['Perrin', 'the glazier'] },
  { name: 'Wick', aliases: [] },
];

function ok(content: string): Response {
  return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }] }) } as unknown as Response;
}

let unstubbedFetch: Mock<() => never>;
let fetchImpl: Mock<FetchFn>;

function extractor() {
  const client = createCdmClient({
    apiKey: 'sk-or-v1-fixture',
    gateState: () => ({ optIn: true, effectiveMode: 'full' }),
    fetchImpl: fetchImpl as unknown as typeof fetch,
    log: () => {},
  });
  return createCdmExtractor(client);
}

function sentBytes(call = 0): string {
  return fetchImpl.mock.calls[call][1].body as string;
}

beforeEach(() => {
  unstubbedFetch = vi.fn(() => {
    throw new Error('unstubbed fetch in a unit test');
  });
  vi.stubGlobal('fetch', unstubbedFetch);
  vi.stubEnv('MYTHOS_E2E', '1');
  vi.stubEnv('MYTHOS_IS_PACKAGED', '0');
  vi.stubEnv('MYTHOS_CDM_FACTS_E2E', '1');
  fetchImpl = vi.fn<FetchFn>(async () => ok('{"facts":[]}'));
});

afterEach(() => {
  expect(unstubbedFetch).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.doUnmock('./types.js');
});

describe('cdmExtractor', () => {
  it('sends Extract to the pinned route and returns validated facts', async () => {
    const fact = {
      entity: 'Perrin Ashdown',
      attribute: 'eyes',
      value: 'grey',
      quote: 'His grey eyes',
      contextBefore: 'Perrin Ashdown knelt among the glass trees. ',
      contextAfter: ' caught every glint.',
    };
    fetchImpl.mockResolvedValueOnce(ok(JSON.stringify({ facts: [fact] })));
    const out = await extractor().extract(buildExtractorInput(SCENE_A, NAMES), new AbortController().signal);
    expect(out).toEqual({ facts: [fact] });
    expect(fetchImpl.mock.calls[0][0]).toBe(CDM_CHAT_URL);
    expect(JSON.parse(sentBytes()).model).toBe(CDM_EXTRACT_MODEL);
  });

  it.each([
    ['prose', 'Perrin has grey eyes.'],
    ['a refusal', 'I cannot help with that.'],
    ['a cut-off answer', '{"facts":[{"entity":"Perrin'],
    ['a wrong shape', '{"facts":[{"entity":"Perrin"}]}'],
  ])('returns null (script fallback) for %s with no retry', async (_label, content) => {
    fetchImpl.mockResolvedValue(ok(content));
    const out = await extractor().extract(buildExtractorInput(SCENE_A, NAMES), new AbortController().signal);
    expect(out).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns null when CDM is not allowed, with 0 fetches', async () => {
    vi.stubEnv('MYTHOS_IS_PACKAGED', '1');
    const out = await extractor().extract(buildExtractorInput(SCENE_A, NAMES), new AbortController().signal);
    expect(out).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('Extract payload blindness (B4)', () => {
  it('holds the prose and the names, and no frontmatter key or value, ledger value, or other scene', async () => {
    const richNames = NAMES.map((n) => ({
      ...n,
      properties: { eyes: LEDGER_VALUE },
      ledger: [{ attribute: 'eyes', value: LEDGER_VALUE }],
      path: 'Characters/Perrin.md',
    })) as unknown as EntityNames[];
    const a = buildExtractorInput(SCENE_A, richNames);
    const b = buildExtractorInput(SCENE_B, richNames);
    const ex = extractor();
    await Promise.all([ex.extract(b, new AbortController().signal), ex.extract(a, new AbortController().signal)]);

    const bodies = [sentBytes(0), sentBytes(1)];
    const bodyA = bodies.find((s) => s.includes('glass trees'))!;
    const bodyB = bodies.find((s) => s.includes('bell tower'))!;
    expect(bodyA).toBeDefined();
    expect(bodyB).toBeDefined();

    const user = JSON.parse(JSON.parse(bodyA).messages[1].content);
    expect(Object.keys(user).sort()).toEqual(['names', 'prose']);
    expect(user.prose).toBe(a.prose);
    expect(user.prose).toContain('His grey eyes caught every glint.');
    expect(user.names).toEqual([
      { name: 'Perrin Ashdown', aliases: ['Perrin', 'the glazier'] },
      { name: 'Wick', aliases: [] },
    ]);

    for (const fm of ['title', 'The Glass Orchard', 'secret_key', 'frontmatter-only-value-77', 'violet', '---']) {
      expect(bodyA).not.toContain(fm);
    }
    for (const leak of [LEDGER_VALUE, 'Characters/Perrin.md', 'properties', 'ledger']) {
      expect(bodyA).not.toContain(leak);
      expect(bodyB).not.toContain(leak);
    }
    expect(bodyA).not.toContain('bell tower');
    expect(bodyA).not.toContain('green eyes half shut');
    expect(bodyB).not.toContain('glass trees');
    expect(bodyB).not.toContain('Wick, his apprentice');
  });

  it('ExtractorInput is frozen and has only prose and names', () => {
    const input = buildExtractorInput(SCENE_A, NAMES);
    expect(Object.keys(input).sort()).toEqual(['names', 'prose']);
    expect(Object.isFrozen(input)).toBe(true);
    expect(Object.isFrozen(input.names)).toBe(true);
    expect(Object.isFrozen(input.names[0])).toBe(true);
  });
});

describe('promptVersion (B1)', () => {
  it('comes from PROMPT_VERSION.cdm, which starts at 1', () => {
    expect(PROMPT_VERSION.cdm).toBe(1);
    expect(extractor().promptVersion).toBe(PROMPT_VERSION.cdm);
    expect(Object.isFrozen(PROMPT_VERSION)).toBe(true);
  });

  it('a bump to PROMPT_VERSION changes the version the extractor reports', async () => {
    vi.resetModules();
    vi.doMock('./types.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./types.js')>();
      return { ...actual, PROMPT_VERSION: Object.freeze({ ...actual.PROMPT_VERSION, cdm: 2 }) };
    });
    const bumped = await import('./cdmExtractor.js');
    const client = createCdmClient({ apiKey: 'k', gateState: () => ({ optIn: false, effectiveMode: 'off' }), log: () => {} });
    expect(bumped.createCdmExtractor(client).promptVersion).toBe(2);
  });
});
