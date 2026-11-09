// Truth-table tests for the pure AI mode resolver (PLAN-AI-MODES M0).
//
// Every combination of picked mode × online × local probe is a row, tagged
// with its plan cell. The mutant block below proves the table catches each
// mutant the plan names: a mutant that the table cannot tell apart from the
// real resolver fails this file.

import { describe, expect, it } from 'vitest';
import { isAiMode, resolveEffective } from './aiMode.js';
import type { AiMode, AiModeInput, AiModeResult } from './aiMode.js';

type Cell = 1 | 2 | 3 | 4 | 5 | 'local-online-local';

interface Row {
  cell: Cell;
  input: AiModeInput;
  expected: AiModeResult;
}

function row(
  cell: Cell,
  mode: AiMode,
  online: boolean,
  localAvailable: boolean,
  expected: AiModeResult,
): Row {
  return { cell, input: { mode, online, localAvailable }, expected };
}

const OFF: AiModeResult = { effective: 'off' };
const FULL: AiModeResult = { effective: 'full' };
const LOCAL: AiModeResult = { effective: 'local' };
const LOCAL_OFFLINE: AiModeResult = { effective: 'local', reason: 'offline-using-local' };
const OFF_OFFLINE_NO_LOCAL: AiModeResult = { effective: 'off', reason: 'offline-no-local' };
const OFF_NO_LOCAL: AiModeResult = { effective: 'off', reason: 'no-local' };

// All 12 combinations of mode × online × localAvailable.
const TABLE: Row[] = [
  // 1. AI Off, any → AI Off.
  row(1, 'off', true, true, OFF),
  row(1, 'off', true, false, OFF),
  row(1, 'off', false, true, OFF),
  row(1, 'off', false, false, OFF),
  // 2. Full, online → Full AI (the probe does not matter).
  row(2, 'full', true, true, FULL),
  row(2, 'full', true, false, FULL),
  // 3. Full or Local, offline, local → Local Only.
  row(3, 'full', false, true, LOCAL_OFFLINE),
  row(3, 'local', false, true, LOCAL),
  // 4. Full, offline, no local → AI Off.
  row(4, 'full', false, false, OFF_OFFLINE_NO_LOCAL),
  // 5. Local, any, no local → AI Off.
  row(5, 'local', true, false, OFF_NO_LOCAL),
  row(5, 'local', false, false, OFF_NO_LOCAL),
  // Not a numbered cell: Local picked, online, local up stays Local Only.
  row('local-online-local', 'local', true, true, LOCAL),
];

function label(r: Row): string {
  const { mode, online, localAvailable } = r.input;
  return `cell ${r.cell}: ${mode}, ${online ? 'online' : 'offline'}, ${localAvailable ? 'local' : 'no local'}`;
}

function rowsFor(cell: Cell): Row[] {
  return TABLE.filter((r) => r.cell === cell);
}

describe('resolveEffective — truth table', () => {
  it('covers every mode × online × local combination exactly once', () => {
    const keys = TABLE.map((r) => `${r.input.mode}|${r.input.online}|${r.input.localAvailable}`);
    expect(new Set(keys).size).toBe(12);
    expect(keys).toHaveLength(12);
  });

  it.each(TABLE.map((r) => [label(r), r] as const))('%s', (_name, r) => {
    expect(resolveEffective(r.input)).toEqual(r.expected);
  });

  // Readable invariants over the same table, kept so a broken row reads as a
  // broken rule rather than a mismatched object.
  it('never falls back to Full when offline', () => {
    for (const r of TABLE.filter((t) => !t.input.online)) {
      expect(resolveEffective(r.input).effective).not.toBe('full');
    }
  });

  it('only offers Local Only when the probe says yes', () => {
    for (const r of TABLE.filter((t) => !t.input.localAvailable)) {
      expect(resolveEffective(r.input).effective).not.toBe('local');
    }
  });

  it('gives cells 4 and 5 a no-local reason code so M1 can show the Settings line', () => {
    for (const r of rowsFor(4)) expect(resolveEffective(r.input)).toEqual(OFF_OFFLINE_NO_LOCAL);
    for (const r of rowsFor(5)) expect(resolveEffective(r.input)).toEqual(OFF_NO_LOCAL);
  });

  it('sets a reason exactly when the effective mode differs from the picked mode', () => {
    for (const r of TABLE) {
      const result = resolveEffective(r.input);
      if (result.effective === r.input.mode) expect(result.reason, label(r)).toBeUndefined();
      else expect(result.reason, label(r)).toBeDefined();
    }
  });
});

describe('resolveEffective — fails closed', () => {
  it('treats an unknown mode as Off with reason invalid-mode', () => {
    for (const mode of ['turbo', '', 'Full', undefined, null, true]) {
      const input = { mode, online: true, localAvailable: true } as unknown as AiModeInput;
      expect(resolveEffective(input), String(mode)).toEqual({ effective: 'off', reason: 'invalid-mode' });
    }
  });

  it('isAiMode accepts only the three modes', () => {
    expect(['off', 'local', 'full'].every(isAiMode)).toBe(true);
    for (const v of ['turbo', 'OFF', '', undefined, null, 0, {}]) expect(isAiMode(v), String(v)).toBe(false);
  });

  it('counts only a strict true as online or local', () => {
    const truthy = { mode: 'full', online: 1, localAvailable: 'yes' } as unknown as AiModeInput;
    expect(resolveEffective(truthy)).toEqual(OFF_OFFLINE_NO_LOCAL);
    const local = { mode: 'local', online: true, localAvailable: 1 } as unknown as AiModeInput;
    expect(resolveEffective(local)).toEqual(OFF_NO_LOCAL);
  });

  it('does not mutate its input', () => {
    const input: AiModeInput = Object.freeze({ mode: 'full', online: false, localAvailable: true });
    expect(() => resolveEffective(input)).not.toThrow();
    expect(input).toEqual({ mode: 'full', online: false, localAvailable: true });
  });
});

// Each mutant is the real resolver with one plan-named fault injected through
// its input, matching a one-line edit to aiMode.ts. The table must disagree
// with the mutant on every listed cell, so a regression shaped like that
// mutant turns this suite red.
describe('resolveEffective — plan mutants go red', () => {
  type Resolver = (input: AiModeInput) => AiModeResult;

  const mutants: { name: string; resolver: Resolver; redCells: Cell[] }[] = [
    {
      // "offline ignored": same as `const online = true` in the source.
      name: 'offline ignored',
      resolver: (i) => resolveEffective({ ...i, online: true }),
      redCells: [3, 4],
    },
    {
      // Deleting the Off short-circuit line sends Off down the Local Only path.
      name: 'Off short-circuit removed',
      resolver: (i) => resolveEffective(i.mode === 'off' ? { ...i, mode: 'local' } : i),
      redCells: [1],
    },
    {
      // "empty Local Only shown": same as `const local = true` in the source.
      name: 'Local Only without a local model',
      resolver: (i) => resolveEffective({ ...i, localAvailable: true }),
      redCells: [4, 5],
    },
  ];

  it.each(mutants.map((m) => [m.name, m] as const))('%s', (_name, m) => {
    for (const cell of m.redCells) {
      const rows = rowsFor(cell);
      expect(rows.length).toBeGreaterThan(0);
      const caught = rows.some((r) => {
        const got = m.resolver(r.input);
        return got.effective !== r.expected.effective || got.reason !== r.expected.reason;
      });
      expect(caught, `mutant "${m.name}" survives cell ${cell}`).toBe(true);
    }
  });

  // "Local allows non-loopback" cannot be expressed here: this function never
  // sees a provider kind or URL. M1's provider gate must enforce loopback-only
  // with `isLoopbackUrl` on every kind and test that mutant there.
});
