import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { runSidecarNsisProgram } from './sidecarNsisVm.test-helpers.js';
import type { SidecarNsisVarEnv } from './sidecarTraversalScan.test-helpers.js';
import { loadUninstallVaultsNsh } from './uninstallVaultsNsh.path.js';

type ProbeNestedExpect = 'skip' | 'delete';

type ProbeNestedRow = Readonly<{
  id: string;
  env: string;
  envObj: SidecarNsisVarEnv;
  lines: readonly string[];
  expect: ProbeNestedExpect;
}>;

const ENV_KEYS = [
  'WINDIR',
  'PROGRAMFILES',
  'PROGRAMFILES64',
  'APPDATA',
  'DOCUMENTS',
  'DESKTOP',
  'PROFILE',
] as const;

const FIXTURE_PATH = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'probe-hard-nested-rows.json');

function sidecarPathFromLines(lines: readonly string[]): string {
  const raw = lines[0] ?? '';
  if (raw.endsWith('\r\n')) {
    return raw.slice(0, -2);
  }
  if (raw.endsWith('\n') || raw.endsWith('\r')) {
    return raw.slice(0, -1);
  }
  return raw;
}

function loadProbeNestedRows(): ProbeNestedRow[] {
  const parsed: unknown = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error('probe-hard-nested-rows.json must be an array');
  }
  return parsed.map((row, index) => {
    if (row === null || typeof row !== 'object') {
      throw new Error(`probe nested row ${index} is not an object`);
    }
    const rec = row as Record<string, unknown>;
    const envObjRaw = rec.envObj;
    if (envObjRaw === null || typeof envObjRaw !== 'object') {
      throw new Error(`probe nested row ${index} missing envObj`);
    }
    const envSrc = envObjRaw as Record<string, unknown>;
    const envObj = {} as { [K in (typeof ENV_KEYS)[number]]: string };
    for (const key of ENV_KEYS) {
      const value = envSrc[key];
      if (typeof value !== 'string') {
        throw new Error(`probe nested row ${index} envObj.${key} must be a string`);
      }
      envObj[key] = value;
    }
    const expectValue = rec.expect;
    if (expectValue !== 'skip' && expectValue !== 'delete') {
      throw new Error(`probe nested row ${index} expect must be skip|delete`);
    }
    if (typeof rec.id !== 'string' || typeof rec.env !== 'string' || !Array.isArray(rec.lines)) {
      throw new Error(`probe nested row ${index} missing id/env/lines`);
    }
    const lines = rec.lines.map((line, lineIndex) => {
      if (typeof line !== 'string') {
        throw new Error(`probe nested row ${index} lines[${lineIndex}] must be a string`);
      }
      return line;
    });
    return {
      id: rec.id,
      env: rec.env,
      envObj,
      lines,
      expect: expectValue,
    };
  });
}

describe('Probe nested-rows.json — 360/360 PR VM (N1–N6)', () => {
  const nsh = loadUninstallVaultsNsh();
  const rows = loadProbeNestedRows();

  it('vendors Probe nested-rows.json: 360 rows across N1–N6 including N5 Documents-under-Desktop and N6 Desktop-under-Downloads', () => {
    expect(rows).toHaveLength(360);
    const envs = new Set(rows.map((row) => row.env));
    expect([...envs].some((env) => env.startsWith('N1_'))).toBe(true);
    expect([...envs].some((env) => env.startsWith('N2_'))).toBe(true);
    expect([...envs].some((env) => env.startsWith('N3_'))).toBe(true);
    expect([...envs].some((env) => env.startsWith('N4_'))).toBe(true);
    expect([...envs].some((env) => env.startsWith('N5_'))).toBe(true);
    expect([...envs].some((env) => env.startsWith('N6_'))).toBe(true);
    expect(envs.has('N5_Documents_under_Desktop')).toBe(true);
    expect(envs.has('N6_Desktop_under_Downloads')).toBe(true);
    expect(rows.filter((row) => row.expect === 'skip').length).toBe(280);
    expect(rows.filter((row) => row.expect === 'delete').length).toBe(80);
  });

  it(
    '360/360: each must-skip row skips; each real-vault row still deletes; no row hangs',
    () => {
      let ok = 0;
      const failures: string[] = [];
      for (const row of rows) {
        const run = runSidecarNsisProgram(nsh, row.lines, { env: row.envObj });
        const path = sidecarPathFromLines(row.lines);
        if (run.hung) {
          failures.push(`${row.id}: hung after ${run.steps} steps`);
          continue;
        }
        switch (row.expect) {
          case 'skip':
            if (run.deleted.length !== 0) {
              failures.push(`${row.id}: expected skip, deleted ${JSON.stringify(run.deleted)}`);
            } else {
              ok += 1;
            }
            break;
          case 'delete':
            if (run.deleted.length !== 1 || run.deleted[0] !== path) {
              failures.push(
                `${row.id}: expected delete ${JSON.stringify(path)}, deleted ${JSON.stringify(run.deleted)}`,
              );
            } else {
              ok += 1;
            }
            break;
          default: {
            const _never: never = row.expect;
            failures.push(`${row.id}: unknown expect ${_never as string}`);
          }
        }
      }
      expect(failures, failures.join('\n')).toEqual([]);
      expect(`${ok}/${rows.length}`).toBe('360/360');
    },
    60_000,
  );
});
