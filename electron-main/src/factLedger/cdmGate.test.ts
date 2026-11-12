import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CDM_FACTS_FLAG, DEFAULT_CDM_SETTINGS, cdmAllowed, cdmFlagOn, readCdmOptIn } from './cdmGate.js';

const E2E_KEYS = ['MYTHOS_E2E', 'MYTHOS_IS_PACKAGED', 'MYTHOS_CDM_FACTS_E2E'] as const;

function clearEnv(): void {
  for (const key of E2E_KEYS) vi.stubEnv(key, undefined as unknown as string);
}

beforeEach(clearEnv);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('CDM_FACTS_FLAG (mutant: CDM_FACTS_FLAG = true)', () => {
  it('ships off, and the flag is off with no override', () => {
    expect(CDM_FACTS_FLAG).toBe(false);
    expect(cdmFlagOn()).toBe(false);
  });

  it('is off by default even with opt-in true and Full AI', () => {
    expect(cdmAllowed({ flag: cdmFlagOn(), optIn: true, effectiveMode: 'full' })).toBe(false);
  });
});

describe('readCdmOptIn and the default settings', () => {
  it('the default settings object has cdmOptIn === false', () => {
    expect(DEFAULT_CDM_SETTINGS.cdmOptIn).toBe(false);
    expect(readCdmOptIn(DEFAULT_CDM_SETTINGS)).toBe(false);
    expect(Object.isFrozen(DEFAULT_CDM_SETTINGS)).toBe(true);
  });

  it.each([
    ['a missing key', {}],
    ['"true"', { cdmOptIn: 'true' }],
    ['1', { cdmOptIn: 1 }],
    ['null', { cdmOptIn: null }],
    ['undefined', { cdmOptIn: undefined }],
    ['an object', { cdmOptIn: {} }],
  ])('%s means off (mutant: !!optIn)', (_label, settings) => {
    expect(readCdmOptIn(settings)).toBe(false);
  });

  it('only a literal true opts in', () => {
    expect(readCdmOptIn({ cdmOptIn: true })).toBe(true);
    expect(readCdmOptIn(null)).toBe(false);
    expect(readCdmOptIn('cdmOptIn')).toBe(false);
  });
});

describe('cdmAllowed', () => {
  it('is true only with the flag on, optIn === true and Full AI', () => {
    expect(cdmAllowed({ flag: true, optIn: true, effectiveMode: 'full' })).toBe(true);
  });

  it.each([['true'], [1], [null], [undefined], [{}]])('optIn %j is off (mutant: !!optIn)', (optIn) => {
    expect(cdmAllowed({ flag: true, optIn, effectiveMode: 'full' })).toBe(false);
  });

  it('flag off with opt-in true is off (mutant: flag checked only in the FE)', () => {
    expect(cdmAllowed({ flag: false, optIn: true, effectiveMode: 'full' })).toBe(false);
    expect(cdmAllowed({ flag: 'true', optIn: true, effectiveMode: 'full' })).toBe(false);
    expect(cdmAllowed({ flag: 1, optIn: true, effectiveMode: 'full' })).toBe(false);
  });

  it.each([['local'], ['off'], ['FULL'], [undefined], [true]])('mode %j is off', (effectiveMode) => {
    expect(cdmAllowed({ flag: true, optIn: true, effectiveMode })).toBe(false);
  });
});

describe('cdmFlagOn test override (N8)', () => {
  function setEnv(e2e?: string, packaged?: string, cdm?: string): void {
    if (e2e !== undefined) vi.stubEnv('MYTHOS_E2E', e2e);
    if (packaged !== undefined) vi.stubEnv('MYTHOS_IS_PACKAGED', packaged);
    if (cdm !== undefined) vi.stubEnv('MYTHOS_CDM_FACTS_E2E', cdm);
  }

  it('is on only with MYTHOS_E2E=1, MYTHOS_IS_PACKAGED=0 and MYTHOS_CDM_FACTS_E2E=1', () => {
    setEnv('1', '0', '1');
    expect(cdmFlagOn()).toBe(true);
  });

  it.each([
    ['MYTHOS_IS_PACKAGED unset', '1', undefined, '1'],
    ["MYTHOS_IS_PACKAGED '1'", '1', '1', '1'],
    ['MYTHOS_E2E unset', undefined, '0', '1'],
    ["MYTHOS_E2E 'true'", 'true', '0', '1'],
    ['MYTHOS_CDM_FACTS_E2E unset', '1', '0', undefined],
    ["MYTHOS_CDM_FACTS_E2E 'true'", '1', '0', 'true'],
    ["MYTHOS_IS_PACKAGED ''", '1', '', '1'],
  ])('is off when %s', (_label, e2e, packaged, cdm) => {
    setEnv(e2e, packaged, cdm);
    expect(cdmFlagOn()).toBe(false);
  });

  it('reads the env at call time, not at import (mutant: env read at import)', async () => {
    vi.resetModules();
    const fresh = await import('./cdmGate.js');
    expect(fresh.cdmFlagOn()).toBe(false);
    setEnv('1', '0', '1');
    expect(fresh.cdmFlagOn()).toBe(true);
    clearEnv();
    expect(fresh.cdmFlagOn()).toBe(false);
  });

  it('an import with the override set does not latch it on', async () => {
    setEnv('1', '0', '1');
    vi.resetModules();
    const fresh = await import('./cdmGate.js');
    expect(fresh.cdmFlagOn()).toBe(true);
    clearEnv();
    expect(fresh.cdmFlagOn()).toBe(false);
  });
});

describe('the gate lives main-side', () => {
  it('cdmGate.ts holds the one flag constant and reads process.env inside cdmFlagOn', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, 'cdmGate.ts'), 'utf8');
    expect(src).toMatch(/export const CDM_FACTS_FLAG: boolean = false;/);
    const body = src.slice(src.indexOf('export function cdmFlagOn'));
    expect(body.slice(0, body.indexOf('\n}\n'))).toContain('process.env');
    expect(src.slice(0, src.indexOf('export function cdmFlagOn'))).not.toContain('process.env.');
  });
});
