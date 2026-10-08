import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  CANON_GATE_FAULT_SKIP_ROWS,
  CANON_GATE_MUST_DELETE_ROWS,
  CANON_GATE_NONCANONICAL_ROOT_DELETE_ROWS,
  CANON_GATE_ROOT_SKIP_ROWS,
  CANON_GATE_SIBLING_SKIP_ROWS,
  CANON_MUST_DELETE_PATHS,
  GFPN_WIN32_W_MODEL_ROWS,
  gfpnModel,
} from './sidecarTraversalScan.test-helpers.js';

type GfpnRefRow = { table: string; field: 'path' | 'root'; input: string };

/** Every canonical-gate string the VM model must match against real kernel32 GetFullPathNameW. */
export function canonicalGateGfpnReferenceRows(): GfpnRefRow[] {
  const rows: GfpnRefRow[] = [];
  const addPair = (table: string, path: string, root: string): void => {
    rows.push({ table, field: 'path', input: path });
    rows.push({ table, field: 'root', input: root });
  };
  for (const r of CANON_GATE_ROOT_SKIP_ROWS) {
    addPair('root-skip', r.path, r.root);
  }
  for (const r of CANON_GATE_MUST_DELETE_ROWS) {
    addPair('must-delete-gate', r.path, r.root);
  }
  for (const r of CANON_GATE_SIBLING_SKIP_ROWS) {
    addPair('sibling-skip', r.path, r.root);
  }
  for (const r of CANON_GATE_NONCANONICAL_ROOT_DELETE_ROWS) {
    addPair('noncanonical-root', r.path, r.root);
  }
  for (const r of CANON_GATE_FAULT_SKIP_ROWS) {
    addPair('fault-skip', r.path, r.root);
  }
  for (const path of CANON_MUST_DELETE_PATHS) {
    rows.push({ table: 'must-delete-e2e', field: 'path', input: path });
  }
  for (const input of GFPN_WIN32_W_MODEL_ROWS) {
    rows.push({ table: 'w-model', field: 'path', input });
  }
  return rows;
}

function uniqueInputs(rows: readonly GfpnRefRow[]): string[] {
  return [...new Set(rows.map((r) => r.input))];
}

function powershellExe(): string {
  const root = process.env.SystemRoot ?? 'C:\\Windows';
  return join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function kernel32GetFullPathNameW(inputs: readonly string[]): Map<string, string> {
  const dir = mkdtempSync(join(tmpdir(), 'mythos-gfpn-ref-'));
  const inFile = join(dir, 'in.json');
  writeFileSync(inFile, JSON.stringify(inputs), 'utf8');
  const script = join(dirname(fileURLToPath(import.meta.url)), 'uninstallVaultsNsh.gfpnWin32.ps1');
  const raw = execFileSync(
    powershellExe(),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-InFile', inFile],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true },
  );
  const parsed = JSON.parse(raw) as { input: string; win: string } | { input: string; win: string }[];
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const out = new Map<string, string>();
  for (const item of items) {
    out.set(item.input, item.win);
  }
  return out;
}

function compact(s: string): string {
  return JSON.stringify(s);
}

const GFPN_W_MODEL_EXPECTED: readonly { input: string; win32: string }[] = [
  { input: 'C:\\a\\b\\..', win32: 'C:\\a' },
  { input: 'C:\\a\\b\\.', win32: 'C:\\a\\b' },
  { input: 'C:\\a\\b/..', win32: 'C:\\a' },
  { input: 'C:\\Users\\me\\Documents\\v\\..', win32: 'C:\\Users\\me\\Documents' },
  { input: 'C:\\Users\\me\\Documents\\v\\.', win32: 'C:\\Users\\me\\Documents\\v' },
  { input: 'C:\\Users\\me\\Documents.', win32: 'C:\\Users\\me\\Documents' },
  { input: 'C:\\Users\\me\\Documents ', win32: 'C:\\Users\\me\\Documents' },
  { input: 'C:\\a\\b\\.. ', win32: 'C:\\a\\b\\' },
  { input: 'C:\\a\\b\\...', win32: 'C:\\a\\b\\' },
];

describe('canonical-gate GFPN reference inputs (any platform)', () => {
  it('lists every gate row path and root plus the must-delete e2e paths', () => {
    const rows = canonicalGateGfpnReferenceRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.table === 'root-skip')).toBe(true);
    expect(rows.some((r) => r.table === 'must-delete-gate')).toBe(true);
    expect(rows.some((r) => r.table === 'must-delete-e2e')).toBe(true);
    expect(rows.some((r) => r.table === 'sibling-skip')).toBe(true);
    expect(rows.some((r) => r.table === 'noncanonical-root')).toBe(true);
    expect(rows.some((r) => r.table === 'fault-skip')).toBe(true);
    expect(rows.some((r) => r.table === 'w-model')).toBe(true);
    expect(rows.filter((r) => r.table === 'w-model').map((r) => r.input)).toEqual([...GFPN_WIN32_W_MODEL_ROWS]);
  });

  it('resolves a final . / .. with no trailing separator (Win32 / W model)', () => {
    for (const row of GFPN_W_MODEL_EXPECTED) {
      expect(gfpnModel(row.input), row.input).toBe(row.win32);
    }
  });
});

describe.skipIf(process.platform !== 'win32')(
  'GetFullPathNameW model vs kernel32 (notes-windows)',
  () => {
    it('matches gfpnModel row for row and prints the reference table', () => {
      const rows = canonicalGateGfpnReferenceRows();
      const win = kernel32GetFullPathNameW(uniqueInputs(rows));
      const mismatches: string[] = [];
      const lines = [
        `GFPN-REF rows=${rows.length} unique=${win.size}`,
        'ok table field model win32 input',
      ];
      for (const row of rows) {
        const model = gfpnModel(row.input);
        const real = win.get(row.input);
        if (real === undefined) {
          mismatches.push(`${row.table} ${row.field} missing kernel32 result for ${compact(row.input)}`);
          lines.push(`MISS ${row.table} ${row.field} ${compact(model)} — ${compact(row.input)}`);
          continue;
        }
        const ok = model === real;
        if (!ok) {
          mismatches.push(
            `${row.table} ${row.field} input=${compact(row.input)} model=${compact(model)} win32=${compact(real)}`,
          );
        }
        lines.push(
          `${ok ? 'OK' : 'MISMATCH'} ${row.table} ${row.field} ${compact(model)} ${compact(real)} ${compact(row.input)}`,
        );
      }
      lines.push(`GFPN-REF match=${rows.length - mismatches.length} mismatch=${mismatches.length}`);
      process.stdout.write(`${lines.join('\n')}\n`);
      expect(mismatches, mismatches.join('\n')).toEqual([]);
    });
  },
);
