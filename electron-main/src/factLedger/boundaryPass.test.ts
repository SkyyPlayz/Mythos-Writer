import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { CDM_CLASSIFY_MODEL, createCdmClient } from './cdmClient.js';
import {
  BOUNDARY_SYSTEM_PROMPT,
  CLASSIFY_MIN_P,
  boundaryNote,
  runBoundaryPass,
  type BoundaryInput,
} from './boundaryPass.js';

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

const SCENE_A = '---\npov: frontmatter-pov-value\n---\nAt the mill, Hessa wore her hair long and dark.';
const SCENE_B = 'By the river, Hessa shook out her short white hair.';
const OTHER_SCENE = 'Far away, a third scene about the harbour that must never be sent.';

const INPUT: BoundaryInput = {
  sceneA: { sceneId: 'ch1-s2', prose: SCENE_A },
  sceneB: { sceneId: 'ch1-s3', prose: SCENE_B },
  factA: { entity: 'Hessa', attribute: 'hair', value: 'dark', quote: 'hair long and dark' },
  factB: { entity: 'Hessa', attribute: 'hair', value: 'white', quote: 'short white hair' },
};

const NOTE = "Hessa: hair changed from 'dark' to 'white' between these scenes; no explanation found.";

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
  fetchImpl = vi.fn<FetchFn>(async () => ok('{"top_label":"absent","p":0.9}'));
});

afterEach(() => {
  expect(unstubbedFetch).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('boundaryPass, Full AI', () => {
  it('Classify payload has exactly the two bracketing scenes and the two facts (B4)', async () => {
    await runBoundaryPass(INPUT, { mode: 'full', client: client() });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.model).toBe(CDM_CLASSIFY_MODEL);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({ role: 'system', content: BOUNDARY_SYSTEM_PROMPT });
    const payload = JSON.parse(body.messages[1].content);
    expect(Object.keys(payload).sort()).toEqual(['factA', 'factB', 'labels', 'sceneA', 'sceneB']);
    expect(payload.sceneA).toBe('At the mill, Hessa wore her hair long and dark.');
    expect(payload.sceneB).toBe(SCENE_B);
    expect(payload.factA).toEqual(INPUT.factA);
    expect(payload.factB).toEqual(INPUT.factB);
    expect(payload.labels).toEqual(['shown', 'stated', 'implied', 'absent']);
    const sent = fetchImpl.mock.calls[0][1].body as string;
    expect(sent).not.toContain('frontmatter-pov-value');
    expect(sent).not.toContain('ch1-s2');
    expect(sent).not.toContain(OTHER_SCENE);
  });

  it('drops extra keys a caller adds to the facts or scenes', async () => {
    const noisy = {
      sceneA: { ...INPUT.sceneA, neighbour: OTHER_SCENE },
      sceneB: INPUT.sceneB,
      factA: { ...INPUT.factA, ledgerId: 'row-991', otherScene: OTHER_SCENE },
      factB: INPUT.factB,
      extraScene: { sceneId: 'x', prose: OTHER_SCENE },
    } as unknown as BoundaryInput;
    await runBoundaryPass(noisy, { mode: 'full', client: client() });
    const sent = fetchImpl.mock.calls[0][1].body as string;
    expect(sent).not.toContain(OTHER_SCENE);
    expect(sent).not.toContain('row-991');
  });

  it.each([
    ['shown', false],
    ['stated', false],
    ['implied', true],
    ['absent', true],
  ])('top label %s at p >= 0.6 gives flag=%s', async (label, flag) => {
    fetchImpl.mockResolvedValueOnce(ok(JSON.stringify({ top_label: label, p: CLASSIFY_MIN_P })));
    const result = await runBoundaryPass(INPUT, { mode: 'full', client: client() });
    expect(result).toEqual({ label, source: 'cdm', flag, note: flag ? NOTE : null });
  });

  it.each([
    ['p below 0.6', ok('{"top_label":"shown","p":0.59}')],
    ['a label off the set', ok('{"top_label":"maybe","p":0.99}')],
    ['prose', ok('The change is shown.')],
    ['a 400', { status: 400, text: async () => 'bad' } as unknown as Response],
  ])('%s is unsure and flags', async (_label, response) => {
    fetchImpl.mockResolvedValueOnce(response);
    const result = await runBoundaryPass(INPUT, { mode: 'full', client: client() });
    expect(result).toEqual({ label: 'unsure', source: 'cdm', flag: true, note: NOTE });
  });

  it('with no client is unsure and flags, with no fetch', async () => {
    expect(await runBoundaryPass(INPUT, { mode: 'full' })).toEqual({
      label: 'unsure',
      source: 'cdm',
      flag: true,
      note: NOTE,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('boundaryPass, Local Only and AI Off', () => {
  it.each([['local'], ['off']] as const)('%s uses script absent and sends nothing', async (mode) => {
    const result = await runBoundaryPass(INPUT, { mode, client: client() });
    expect(result).toEqual({ label: 'absent', source: 'script', flag: true, note: NOTE });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('boundaryNote', () => {
  it('fills the template', () => {
    expect(boundaryNote('Hessa', 'hair', 'dark', 'white')).toBe(NOTE);
  });
});
