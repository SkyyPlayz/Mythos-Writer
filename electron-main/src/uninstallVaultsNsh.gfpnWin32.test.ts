import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  FILE_ATTRIBUTE_READONLY,
  FILE_ATTRIBUTE_REPARSE_POINT,
  MYTHOS_RMDIR_HELPER_KEEP_SITES,
  MYTHOS_RMDIR_HELPER_REMOVE_ALL_SITES,
  runMythosRmdirHelper,
  runSidecarNsisProgram,
  SIDECAR_NSIS_ENV_E1,
} from './sidecarNsisVm.test-helpers.js';
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
import { loadUninstallVaultsNsh } from './uninstallVaultsNsh.path.js';

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

const FILE_ATTRIBUTE_REPARSE_POINT_WIN = FILE_ATTRIBUTE_REPARSE_POINT;

function kernel32GetFileAttributesW(path: string): number {
  const escaped = path.replace(/'/g, "''");
  const script = [
    'Add-Type -Namespace K32 -Name Native -MemberDefinition @"',
    '[DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]',
    'public static extern int GetFileAttributesW(string lpFileName);',
    '"@',
    `[Console]::Out.Write([K32.Native]::GetFileAttributesW('${escaped}'))`,
  ].join('\n');
  const raw = execFileSync(
    powershellExe(),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', windowsHide: true },
  ).trim();
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    throw new Error(`GetFileAttributesW returned ${JSON.stringify(raw)} for ${path}`);
  }
  return n;
}

function cmdMklink(kind: '/J' | '/D', link: string, target: string): void {
  execFileSync('cmd.exe', ['/c', 'mklink', kind, link, target], {
    encoding: 'utf8',
    windowsHide: true,
  });
}

describe.skipIf(process.platform !== 'win32')(
  'RF-7b notes-windows reparse probe (mklink /J, /D, parent junction, readonly)',
  () => {
    it('junction and symlink vaults skip; parent junction skips; readonly vault still deletes', () => {
      const nsh = loadUninstallVaultsNsh();
      const root = mkdtempSync(join(tmpdir(), 'mythos-rf7-reparse-'));
      const documents = join(root, 'Documents');
      const sentinel = join(root, 'sentinel');
      mkdirSync(documents, { recursive: true });
      mkdirSync(sentinel, { recursive: true });
      const marker = join(sentinel, 'marker.txt');
      writeFileSync(marker, 'keep', 'utf8');
      const env = {
        ...SIDECAR_NSIS_ENV_E1,
        DOCUMENTS: documents,
        PROFILE: root,
      };

      const junctionVault = join(documents, 'j-vault');
      cmdMklink('/J', junctionVault, sentinel);
      const junctionAttr = kernel32GetFileAttributesW(junctionVault);
      expect(junctionAttr & FILE_ATTRIBUTE_REPARSE_POINT_WIN, 'mklink /J must set 0x400').not.toBe(0);

      const symlinkVault = join(documents, 'd-vault');
      cmdMklink('/D', symlinkVault, sentinel);
      const symlinkAttr = kernel32GetFileAttributesW(symlinkVault);
      expect(symlinkAttr & FILE_ATTRIBUTE_REPARSE_POINT_WIN, 'mklink /D must set 0x400').not.toBe(0);

      const parentJ = join(documents, 'parent-j');
      cmdMklink('/J', parentJ, sentinel);
      const nestedVault = join(parentJ, 'vault');
      mkdirSync(nestedVault, { recursive: true });
      const parentAttr = kernel32GetFileAttributesW(parentJ);
      const nestedAttr = kernel32GetFileAttributesW(nestedVault);
      expect(parentAttr & FILE_ATTRIBUTE_REPARSE_POINT_WIN).not.toBe(0);
      expect(nestedAttr & FILE_ATTRIBUTE_REPARSE_POINT_WIN).toBe(0);

      const readonlyVault = join(documents, 'ro-vault');
      mkdirSync(readonlyVault, { recursive: true });
      execFileSync('cmd.exe', ['/c', 'attrib', '+R', readonlyVault], { encoding: 'utf8', windowsHide: true });
      const roAttr = kernel32GetFileAttributesW(readonlyVault);
      expect(roAttr & FILE_ATTRIBUTE_READONLY, 'attrib +R must set 0x1').not.toBe(0);
      expect(roAttr & FILE_ATTRIBUTE_REPARSE_POINT_WIN).toBe(0);

      const missingVault = join(documents, 'missing-vault');
      mkdirSync(missingVault, { recursive: true });
      rmSync(missingVault, { recursive: true, force: true });
      const missingAttr = kernel32GetFileAttributesW(missingVault);
      expect(missingAttr, 'removed vault must be INVALID_FILE_ATTRIBUTES').toBe(-1);

      const reparsePaths = [junctionVault, symlinkVault, parentJ];
      const fileAttributes = {
        [nestedVault]: nestedAttr,
        [readonlyVault]: roAttr,
      };

      const run = (sidecarPath: string) =>
        runSidecarNsisProgram(nsh, [`${sidecarPath}\r\n`], {
          env,
          reparsePaths,
          fileAttributes,
          invalidAttrPaths: [missingVault],
        });

      expect(run(junctionVault).deleted, 'junction vault must skip').toEqual([]);
      expect(run(symlinkVault).deleted, 'symlink vault must skip').toEqual([]);
      expect(run(nestedVault).deleted, 'parent junction + plain vault must skip').toEqual([]);
      expect(run(readonlyVault).deleted, 'readonly vault must still delete').toEqual([readonlyVault]);
      expect(run(missingVault).deleted, 'missing vault must skip with no error').toEqual([]);
      expect(existsSync(marker), 'sentinel marker must survive').toBe(true);

      rmSync(root, { recursive: true, force: true });
    });
  },
);

describe.skipIf(process.platform !== 'win32')(
  'H2 notes-windows helper reparse probe (mklink /J on fixed Mythos Writer targets)',
  () => {
    it('junction cache skips; readonly cache still deletes; missing cache skips', () => {
      const nsh = loadUninstallVaultsNsh();
      const root = mkdtempSync(join(tmpdir(), 'mythos-h2-helper-'));
      const appdata = join(root, 'AppData', 'Roaming');
      const mythos = join(appdata, 'Mythos Writer');
      const sentinel = join(root, 'sentinel');
      mkdirSync(mythos, { recursive: true });
      mkdirSync(sentinel, { recursive: true });
      const marker = join(sentinel, 'marker.txt');
      writeFileSync(marker, 'keep', 'utf8');
      const env = {
        ...SIDECAR_NSIS_ENV_E1,
        APPDATA: appdata,
        PROFILE: root,
      };

      const junctionCache = join(mythos, 'vault-index-cache');
      cmdMklink('/J', junctionCache, sentinel);
      const junctionAttr = kernel32GetFileAttributesW(junctionCache);
      expect(junctionAttr & FILE_ATTRIBUTE_REPARSE_POINT_WIN, 'mklink /J must set 0x400').not.toBe(0);

      const readonlyCache = join(mythos, 'note-thumb-cache');
      mkdirSync(readonlyCache, { recursive: true });
      execFileSync('cmd.exe', ['/c', 'attrib', '+R', readonlyCache], { encoding: 'utf8', windowsHide: true });
      const roAttr = kernel32GetFileAttributesW(readonlyCache);
      expect(roAttr & FILE_ATTRIBUTE_READONLY, 'attrib +R must set 0x1').not.toBe(0);
      expect(roAttr & FILE_ATTRIBUTE_REPARSE_POINT_WIN).toBe(0);

      const missingCache = join(mythos, 'templates');
      const missingAttr = kernel32GetFileAttributesW(missingCache);
      expect(missingAttr, 'missing templates must be INVALID_FILE_ATTRIBUTES').toBe(-1);

      const idxSite = MYTHOS_RMDIR_HELPER_KEEP_SITES.find((s) => s.uid === 'idx')!;
      const thumbSite = MYTHOS_RMDIR_HELPER_KEEP_SITES.find((s) => s.uid === 'thumb')!;
      const tmplSite = MYTHOS_RMDIR_HELPER_REMOVE_ALL_SITES.find((s) => s.uid === 'tmpl')!;

      expect(
        runMythosRmdirHelper(nsh, idxSite, {
          env,
          reparsePaths: [junctionCache],
          fileAttributes: { [junctionCache]: junctionAttr },
        }).deleted,
        'junction vault-index-cache must skip',
      ).toEqual([]);
      expect(
        runMythosRmdirHelper(nsh, thumbSite, {
          env,
          fileAttributes: { [readonlyCache]: roAttr },
        }).deleted,
        'readonly note-thumb-cache must still delete',
      ).toEqual([readonlyCache]);
      expect(
        runMythosRmdirHelper(nsh, tmplSite, {
          env,
          invalidAttrPaths: [missingCache],
        }).deleted,
        'missing templates must skip',
      ).toEqual([]);
      expect(existsSync(marker), 'sentinel marker must survive').toBe(true);

      rmSync(root, { recursive: true, force: true });
    });
  },
);

describe.skipIf(process.platform !== 'win32')(
  'HARD-A notes-windows 8.3 GetLongPathNameW / fsutil probe',
  () => {
    it('generated 8.3 names expand; a real Notes~1 vault keeps its long name and deletes', () => {
      const nsh = loadUninstallVaultsNsh();
      const root = mkdtempSync(join(tmpdir(), 'mythos-hard-a-83-'));
      const documents = join(root, 'Documents');
      mkdirSync(documents, { recursive: true });
      const downloads = join(root, 'Downloads');
      mkdirSync(downloads, { recursive: true });
      const notesTilde = join(documents, 'Notes~1');
      mkdirSync(notesTilde, { recursive: true });
      const env = {
        ...SIDECAR_NSIS_ENV_E1,
        DOCUMENTS: documents,
        PROFILE: root,
      };
      expect(
        runSidecarNsisProgram(nsh, [`${notesTilde}\r\n`], { env }).deleted,
        'real Notes~1 vault must still delete',
      ).toEqual([notesTilde]);

      let shortDownloads = '';
      try {
        shortDownloads = execFileSync('cmd.exe', ['/c', `for %I in ("${downloads}") do @echo %~sI`], {
          encoding: 'utf8',
          windowsHide: true,
        }).trim();
      } catch {
        shortDownloads = '';
      }
      if (shortDownloads !== '' && /~/.test(shortDownloads)) {
        expect(
          runSidecarNsisProgram(nsh, [`${shortDownloads}\r\n`], { env }).deleted,
          '8.3 Downloads must skip (nested-root / allowlist after GLP)',
        ).toEqual([]);
      }
      rmSync(root, { recursive: true, force: true });
    });
  },
);
