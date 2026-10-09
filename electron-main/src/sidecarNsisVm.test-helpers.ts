/**
 * Unified NSIS interpreter for the sidecar FileOpen…fallback program (oracle nsis.py).
 * Carries $1–$9 plus heap/stack across lines; models close/fallback/trim_chop/+N;
 * GFPN per-line faults; FileClose + sidecar Delete; linear step cap 20*len+2000.
 */

import { SIDECAR_FCFB_ORACLE_ROWS } from './sidecarFcfbOracleRows.test-helpers.js';
import { SIDECAR_FCFB_SUPP_ROWS } from './sidecarFcfbSuppRows.test-helpers.js';
import { gfpnModel, glpnModel, type SidecarNsisVarEnv } from './sidecarTraversalScan.test-helpers.js';

export type { SidecarNsisVarEnv };

export const SIDECAR_NSIS_MAX_STRLEN = 1024;
export const SIDECAR_LINE_STEP_LIMIT_ERROR = 'SIDECAR_LINE_STEP_LIMIT_EXCEEDED';
export const SIDECAR_SIDECAR_DELETE_PATH_SUFFIX = 'Mythos Writer\\uninstall-delete-paths.txt';

const E5_PROFILE = `C:\\Users\\${'p'.repeat(300)}`;

export const SIDECAR_NSIS_ENV_E1: SidecarNsisVarEnv = {
  WINDIR: 'C:\\Windows',
  PROGRAMFILES: 'C:\\Program Files',
  PROGRAMFILES64: 'C:\\Program Files (x86)',
  APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
  DOCUMENTS: 'C:\\Users\\me\\Documents',
  DESKTOP: 'C:\\Users\\me\\Desktop',
  PROFILE: 'C:\\Users\\me',
};

export const SIDECAR_NSIS_ENV_E5: SidecarNsisVarEnv = {
  ...SIDECAR_NSIS_ENV_E1,
  PROFILE: E5_PROFILE,
  APPDATA: `${E5_PROFILE}\\AppData\\Roaming`,
  DOCUMENTS: `${E5_PROFILE}\\Documents`,
  DESKTOP: `${E5_PROFILE}\\Desktop`,
};

export const SIDECAR_NSIS_ENV_E6: SidecarNsisVarEnv = {
  ...SIDECAR_NSIS_ENV_E1,
  PROGRAMFILES: 'D:\\Apps32',
  PROGRAMFILES64: 'C:\\Program Files',
  DOCUMENTS: 'D:\\Apps32\\Docs',
};

export const SIDECAR_NSIS_ENV_E2: SidecarNsisVarEnv = {
  WINDIR: 'C:\\Windows',
  PROGRAMFILES: 'C:\\Program Files (x86)',
  PROGRAMFILES64: 'C:\\Program Files',
  APPDATA: 'C:\\Windows\\System32\\config\\systemprofile\\AppData\\Roaming',
  DOCUMENTS: 'C:\\Program Files (x86)\\Docs',
  DESKTOP: 'C:\\Program Files\\Desk',
  PROFILE: 'C:\\Windows\\prof',
};

export function sidecarNsisEnvByName(name: 'E1' | 'E2' | 'E5' | 'E6'): SidecarNsisVarEnv {
  switch (name) {
    case 'E1':
      return SIDECAR_NSIS_ENV_E1;
    case 'E2':
      return SIDECAR_NSIS_ENV_E2;
    case 'E5':
      return SIDECAR_NSIS_ENV_E5;
    case 'E6':
      return SIDECAR_NSIS_ENV_E6;
    default: {
      const _never: never = name;
      throw new Error(`unknown fcfb env ${_never as string}`);
    }
  }
}

export function sidecarLinearStepCap(len: number): number {
  return 20 * len + 2000;
}

type Instr = { op: string; args: readonly string[]; fileLine: number };

type Prog = { ins: Instr[]; lab: Map<string, number> };

const LABEL_RE = /^\w+:$/;
const REG_RE = /^\$\d$/;

function toks(line: string): string[] {
  return line.match(/"[^"]*"|\S+/g) ?? [];
}

function compileSidecarNsisProgram(lines: readonly string[], fileLine0: number): Prog {
  const ins: Instr[] = [];
  const lab = new Map<string, number>();
  for (let i = 0; i < lines.length; i += 1) {
    const fileLine = fileLine0 + i;
    const t = lines[i]!.trim();
    if (t === '' || t.startsWith(';')) {
      continue;
    }
    const labeled = t.match(/^(\w+):\s*(.*)$/);
    if (labeled !== null && !labeled[2].startsWith(':')) {
      lab.set(labeled[1]!, ins.length);
      if (labeled[2] === '') {
        continue;
      }
      const tk = toks(labeled[2]);
      ins.push({ op: tk[0]!, args: tk.slice(1), fileLine });
      continue;
    }
    if (LABEL_RE.test(t)) {
      lab.set(t.slice(0, -1), ins.length);
      continue;
    }
    const tk = toks(t);
    ins.push({ op: tk[0]!, args: tk.slice(1), fileLine });
  }
  return { ins, lab };
}

const progCache = new Map<string, Prog>();

function programForLines(lines: readonly string[], fileLine0: number): Prog {
  const key = `${fileLine0}\n${lines.join('\n')}`;
  const hit = progCache.get(key);
  if (hit !== undefined) {
    return hit;
  }
  const prog = compileSidecarNsisProgram(lines, fileLine0);
  progCache.set(key, prog);
  return prog;
}

/** NSIS `validate_filename`: keep `X:` then strip `*?|<>/":` from the rest (util.c). */
const NSIS_VALIDATE_FILENAME_STRIP = new Set(['*', '?', '|', '<', '>', '/', '"', ':']);

/**
 * NSIS 3.04 `myDelete` without `DEL_DIR` (`util.c` `trimslashtoend`): parent is
 * the last `\`; the leaf is the last `\`/`/` component of the remainder. So
 * `Documents\a/b.txt` deletes `Documents\b.txt`. RMDir (`DEL_DIR`) does not use this.
 */
export function nsisMyDeletePath(path: string): string {
  const lastBs = path.lastIndexOf('\\');
  if (lastBs < 0) {
    const slash = path.lastIndexOf('/');
    return slash < 0 ? path : path.slice(slash + 1);
  }
  const parent = path.slice(0, lastBs);
  const remainder = path.slice(lastBs + 1);
  const cut = Math.max(remainder.lastIndexOf('\\'), remainder.lastIndexOf('/'));
  const leaf = cut < 0 ? remainder : remainder.slice(cut + 1);
  return parent === '' ? `\\${leaf}` : `${parent}\\${leaf}`;
}

export function nsisValidateFilename(path: string): string {
  let start = 0;
  const c0 = path.charCodeAt(0);
  const isLetter = (c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122);
  if (path.length >= 2 && isLetter && path[1] === ':') {
    start = 2;
  }
  let rest = '';
  for (let i = start; i < path.length; i += 1) {
    const ch = path[i]!;
    if (!NSIS_VALIDATE_FILENAME_STRIP.has(ch)) {
      rest += ch;
    }
  }
  return path.slice(0, start) + rest;
}

/** FileOpen $0 … uninstall_vault_fallback: (oracle `code()`). */
function extractSidecarNsisProgramSpan(nsh: string): { lines: string[]; fileLine0: number } {
  const fileLines = nsh.split(/\r?\n/);
  const start = fileLines.findIndex((l) => l.trim().startsWith('FileOpen $0 "$APPDATA'));
  const end = fileLines.findIndex((l) => l.trim() === 'uninstall_vault_fallback:');
  if (start < 0 || end < start) {
    throw new Error('sidecar NSIS program (FileOpen … uninstall_vault_fallback:) markers missing');
  }
  return { lines: fileLines.slice(start, end + 1), fileLine0: start + 1 };
}

export function extractSidecarNsisProgramLines(nsh: string): string[] {
  return extractSidecarNsisProgramSpan(nsh).lines;
}

function nsisMyAtoi(text: string): number {
  let s = text;
  let i = 0;
  let sign = 1;
  if (s.startsWith('-')) {
    sign = -1;
    i = 1;
  } else if (s.startsWith('+')) {
    i = 1;
  }
  let v = 0;
  if (s.slice(i, i + 2).toLowerCase() === '0x') {
    const m = s.slice(i + 2).match(/^[0-9a-fA-F]*/)?.[0] ?? '';
    v = m === '' ? 0 : Number.parseInt(m, 16);
  } else if (s[i] === '0') {
    const m = s.slice(i).match(/^0[0-7]*/)?.[0] ?? '0';
    v = Number.parseInt(m, 8);
  } else {
    const m = s.slice(i).match(/^\d*/)?.[0] ?? '';
    v = m === '' ? 0 : Number(m);
  }
  v = (sign * v) >>> 0;
  return v >= 0x80000000 ? v - 0x100000000 : v;
}

const litCache = new WeakMap<SidecarNsisVarEnv, Map<string, string>>();
const envKeysCache = new WeakMap<SidecarNsisVarEnv, (keyof SidecarNsisVarEnv)[]>();
const nsisLowerCache = new Map<string, string>();

function envKeys(env: SidecarNsisVarEnv): (keyof SidecarNsisVarEnv)[] {
  const hit = envKeysCache.get(env);
  if (hit !== undefined) {
    return hit;
  }
  const keys = (Object.keys(env) as (keyof SidecarNsisVarEnv)[]).sort((a, b) => b.length - a.length);
  envKeysCache.set(env, keys);
  return keys;
}

function nsisLower(s: string): string {
  const hit = nsisLowerCache.get(s);
  if (hit !== undefined) {
    return hit;
  }
  const low = s.toLowerCase();
  nsisLowerCache.set(s, low);
  return low;
}

function lit(tok: string, env: SidecarNsisVarEnv): string {
  let perEnv = litCache.get(env);
  if (perEnv === undefined) {
    perEnv = new Map();
    litCache.set(env, perEnv);
  }
  const hit = perEnv.get(tok);
  if (hit !== undefined) {
    return hit;
  }
  let s = tok.startsWith('"') && tok.endsWith('"') && tok.length >= 2 ? tok.slice(1, -1) : tok;
  s = s
    .replace(/\$\\n/g, '\n')
    .replace(/\$\\r/g, '\r')
    .replace(/\$\\t/g, '\t')
    .replace(/\$\{NSIS_MAX_STRLEN\}/g, String(SIDECAR_NSIS_MAX_STRLEN));
  for (const k of envKeys(env)) {
    s = s.split(`$${k}`).join(env[k]);
  }
  perEnv.set(tok, s);
  return s;
}

function sidecarPath(env: SidecarNsisVarEnv): string {
  return `${env.APPDATA}\\${SIDECAR_SIDECAR_DELETE_PATH_SUFFIX}`;
}

export type SidecarNsisFault = string | null;

export const FILE_ATTRIBUTE_READONLY = 0x1;
export const FILE_ATTRIBUTE_HIDDEN = 0x2;
export const FILE_ATTRIBUTE_SYSTEM = 0x4;
export const FILE_ATTRIBUTE_DIRECTORY = 0x10;
export const FILE_ATTRIBUTE_REPARSE_POINT = 0x400;
export const INVALID_FILE_ATTRIBUTES = -1;

/** Per-row filesystem: path → Win32 attributes. Missing keys are INVALID_FILE_ATTRIBUTES. */
export type SidecarFsFixture = Readonly<Record<string, number>>;

export type SidecarNsisRunOptions = {
  env?: SidecarNsisVarEnv;
  fault?: SidecarNsisFault;
  /** Paths whose GetFileAttributesW result includes FILE_ATTRIBUTE_REPARSE_POINT. */
  reparsePaths?: readonly string[];
  /** Paths that return INVALID_FILE_ATTRIBUTES (0xFFFFFFFF / −1). */
  invalidAttrPaths?: readonly string[];
  /** Paths whose GetFileAttributesW System::Call returns the plugin `error` string. */
  attrErrorPaths?: readonly string[];
  /** Exact GetFileAttributesW return (used for readonly / hidden / system rows). */
  fileAttributes?: Readonly<Record<string, number>>;
  /**
   * RF-7b per-row FS fixture. When set, a path absent from the map (and from the
   * other attribute overrides) returns INVALID_FILE_ATTRIBUTES.
   */
  fs?: SidecarFsFixture;
  /** GetLongPathNameW returns 0 (fail closed) for these exact input strings. */
  glpnFailPaths?: readonly string[];
  /** GetLongPathNameW returns the buffer size (too-small) for these exact input strings. */
  glpnTruncPaths?: readonly string[];
  /** GetFullPathNameW returns 0 (fail closed) for these exact input strings. */
  gfpnFailPaths?: readonly string[];
  /** GetFullPathNameW returns the buffer size (too-small) for these exact input strings. */
  gfpnTruncPaths?: readonly string[];
  /** Fail the 1-based Nth GetFullPathNameW of this exact input (allowlist vs canon vs nested). */
  gfpnFailNth?: Readonly<Record<string, number>>;
  /** Truncate the 1-based Nth GetFullPathNameW of this exact input. */
  gfpnTruncNth?: Readonly<Record<string, number>>;
  /** Fail the 1-based Nth GetLongPathNameW of this exact input. */
  glpnFailNth?: Readonly<Record<string, number>>;
  /** Truncate the 1-based Nth GetLongPathNameW of this exact input. */
  glpnTruncNth?: Readonly<Record<string, number>>;
  /** Fail GetFullPathNameW only when the Call is on one of these 1-based file lines. */
  gfpnFailFileLines?: readonly number[];
  /** Truncate GetFullPathNameW only when the Call is on one of these 1-based file lines. */
  gfpnTruncFileLines?: readonly number[];
  /** Fail GetLongPathNameW only when the Call is on one of these 1-based file lines. */
  glpnFailFileLines?: readonly number[];
  /** Truncate GetLongPathNameW only when the Call is on one of these 1-based file lines. */
  glpnTruncFileLines?: readonly number[];
};

export type SidecarDeleteAct = Readonly<{ op: 'RMDir' | 'Delete'; path: string }>;

export type SidecarNsisRunResult = {
  deleted: string[];
  acts: SidecarDeleteAct[];
  fileClosed: boolean;
  sidecarDeleted: boolean;
  hung: boolean;
  steps: number;
  lineSteps: number;
};

/** FindFirstFile wildcards / DOS wildcards / illegal `|` — reject in a non-final component. */
const FIND_FIRST_WILDCARD = /[*?<>"|]/;

export function sidecarPathHasFindFirstWildcard(path: string): boolean {
  return FIND_FIRST_WILDCARD.test(path.replace(/\//g, '\\'));
}

/**
 * Honest IfFileExists "$1\\*.*": FindFirstFile rejects a wildcard in a non-final
 * component, so `Documents\\*` → `Documents\\*\\*.*` is false and falls to Delete.
 * A last component containing `.` (and no wildcard) is a file, also false.
 */
export function sidecarIfFileExistsStarStar(pattern: string): boolean {
  const norm = pattern.replace(/\//g, '\\');
  const parts = norm.split('\\');
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (FIND_FIRST_WILDCARD.test(parts[i]!)) {
      return false;
    }
  }
  const base = norm.endsWith('\\*.*') ? norm.slice(0, -4) : norm;
  const last = base.replace(/\//g, '\\').split('\\').pop() ?? '';
  if (FIND_FIRST_WILDCARD.test(last)) {
    return false;
  }
  return !last.includes('.');
}

/** Delete when the path is a file or a FindFirstFile wildcard; RMDir only for a plain directory. */
export function sidecarDeleteOpForPath(path: string): 'RMDir' | 'Delete' {
  if (sidecarPathHasFindFirstWildcard(path)) {
    return 'Delete';
  }
  const last =
    path
      .split('\\*.*')[0]!
      .replace(/\//g, '\\')
      .split('\\')
      .pop() ?? '';
  return last.includes('.') ? 'Delete' : 'RMDir';
}

/** S-1: a self-Goto program must report hung. Changing `return hung()` to `break` goes red. */
export function assertSidecarUnifiedVmStepLimitIsFatal(): void {
  const nsh = [
    'FileOpen $0 "$APPDATA\\Mythos Writer\\uninstall-delete-paths.txt" r',
    'mythos_hang_loop:',
    '  Goto mythos_hang_loop',
    'uninstall_vault_fallback:',
  ].join('\n');
  const run = runSidecarNsisProgram(nsh, ['x\r\n'], { env: SIDECAR_NSIS_ENV_E1 });
  if (!run.hung) {
    throw new Error('unified VM step cap did not fire for a self-referential loop (fail-open)');
  }
}

function parseFault(fault: SidecarNsisFault): { spec: string; only: number | null } | null {
  if (fault === null || fault === '') {
    return null;
  }
  if (fault.includes('@')) {
    const [spec, rest] = fault.split('@');
    return { spec: spec!, only: Number(rest) };
  }
  return { spec: fault, only: null };
}

function fileReadEwfgets(stream: string, pos: number): { s: string; pos: number; err: boolean } {
  const out: string[] = [];
  let lc = '';
  const maxlen = SIDECAR_NSIS_MAX_STRLEN - 1;
  let p = pos;
  const n = stream.length;
  while (out.length < maxlen && p < n) {
    const c = stream[p]!;
    p += 1;
    if (lc === '\r' || lc === '\n') {
      if (lc === c || (c !== '\r' && c !== '\n')) {
        p -= 1;
      } else {
        out.push(c);
      }
      break;
    }
    out.push(c);
    lc = c;
    if (c === '\0') {
      break;
    }
  }
  let s = out.join('');
  const nul = s.indexOf('\0');
  if (nul >= 0) {
    s = s.slice(0, nul);
  }
  return { s, pos: p, err: out.length === 0 };
}

export function runSidecarNsisProgram(
  nsh: string,
  sidecarLines: readonly string[],
  options: SidecarNsisRunOptions = {},
): SidecarNsisRunResult {
  const span = extractSidecarNsisProgramSpan(nsh);
  return runNsisProgramLines(span.lines, sidecarLines, options, span.fileLine0);
}

export function runNsisProgramLines(
  lines: readonly string[],
  sidecarLines: readonly string[],
  options: SidecarNsisRunOptions = {},
  fileLine0 = 1,
): SidecarNsisRunResult {
  const env = options.env;
  if (env === undefined) {
    throw new Error('runSidecarNsisProgram requires env');
  }
  const stream = sidecarLines.join('');
  const P = programForLines(lines, fileLine0);
  const faultInfo = parseFault(options.fault ?? null);
  const reparse = new Set(options.reparsePaths ?? []);
  const invalidAttr = new Set(options.invalidAttrPaths ?? []);
  const attrError = new Set(options.attrErrorPaths ?? []);
  const fileAttrs = new Map(Object.entries(options.fileAttributes ?? {}));
  const fs = options.fs;
  const glpnFail = new Set(options.glpnFailPaths ?? []);
  const glpnTrunc = new Set(options.glpnTruncPaths ?? []);
  const gfpnFail = new Set(options.gfpnFailPaths ?? []);
  const gfpnTrunc = new Set(options.gfpnTruncPaths ?? []);
  const gfpnFailNth = options.gfpnFailNth ?? {};
  const gfpnTruncNth = options.gfpnTruncNth ?? {};
  const glpnFailNth = options.glpnFailNth ?? {};
  const glpnTruncNth = options.glpnTruncNth ?? {};
  const gfpnFailFileLines = new Set(options.gfpnFailFileLines ?? []);
  const gfpnTruncFileLines = new Set(options.gfpnTruncFileLines ?? []);
  const glpnFailFileLines = new Set(options.glpnFailFileLines ?? []);
  const glpnTruncFileLines = new Set(options.glpnTruncFileLines ?? []);
  const gfpnOcc = new Map<string, number>();
  const glpnOcc = new Map<string, number>();
  const bumpOcc = (map: Map<string, number>, key: string): number => {
    const next = (map.get(key) ?? 0) + 1;
    map.set(key, next);
    return next;
  };
  const R: Record<string, string> = {};
  let err = false;
  const st: string[] = [];
  const mem = new Map<number, Uint8Array>();
  let nextAddr = 0x10000;
  const deleted: string[] = [];
  const acts: SidecarDeleteAct[] = [];
  let fileClosed = false;
  let sidecarDeleted = false;
  let pos = 0;
  let gord = 0;
  let ln = 0;
  let pc = 0;
  let steps = 0;
  let lineSteps = 0;
  let lineCap = sidecarLinearStepCap(stream.length);
  const streamCap = sidecarLinearStepCap(stream.length);
  const sidecar = sidecarPath(env);

  const val = (t: string): string => {
    if (REG_RE.test(t)) {
      return R[t] ?? '';
    }
    const x = lit(t, env);
    if (!/\$\d/.test(x)) {
      return x;
    }
    return x.replace(/\$(\d)/g, (_m, d: string) => R[`$${d}`] ?? '');
  };

  const jmp = (from: number, t: string): number => {
    if (t === '0' || t === '') {
      return from + 1;
    }
    if ((t.startsWith('+') || t.startsWith('-')) && /^\d+$/.test(t.slice(1))) {
      return from + Number(t);
    }
    const at = P.lab.get(t);
    if (at === undefined) {
      throw new Error(`unknown nsis jump target: ${t}`);
    }
    return at;
  };

  const regname = (spec: string): string | null => {
    const m = spec.match(/^\.?r(\d)$/);
    return m ? `$${m[1]!}` : null;
  };

  const argval = (spec: string): string => {
    const r = regname(spec);
    if (r !== null && !spec.startsWith('.')) {
      return R[r] ?? '';
    }
    return spec;
  };

  const sysErr = (why: string): never => {
    throw new Error(`sidecar system plugin fault: ${why}`);
  };

  const hung = (): SidecarNsisRunResult => ({
    deleted,
    acts,
    fileClosed,
    sidecarDeleted,
    hung: true,
    steps,
    lineSteps,
  });

  while (pc >= 0 && pc < P.ins.length) {
    steps += 1;
    lineSteps += 1;
    if (steps > streamCap || lineSteps > lineCap) {
      return hung();
    }
    const { op, args, fileLine } = P.ins[pc]!;
    if (op.startsWith('!')) {
      break;
    }
    if (op === 'ClearErrors') {
      err = false;
      pc += 1;
      continue;
    }
    if (op === 'FileRead') {
      const got = fileReadEwfgets(stream, pos);
      pos = got.pos;
      if (got.err) {
        err = true;
      }
      R[args[1]!] = got.s;
      gord = 0;
      ln += 1;
      lineSteps = 0;
      lineCap = sidecarLinearStepCap(got.s.length);
      pc += 1;
      continue;
    }
    if (op === 'IfErrors') {
      if (err) {
        pc = jmp(pc, args[0]!);
        continue;
      }
      if (args[1] !== undefined) {
        pc = jmp(pc, args[1]);
        continue;
      }
      pc += 1;
      continue;
    }
    if (op === 'StrCpy') {
      const src = val(args[1]!);
      let p = '';
      const hasLen = args[2] !== undefined && args[2] !== '""';
      let newlen = hasLen ? nsisMyAtoi(val(args[2]!)) : 0;
      let start = args[3] !== undefined ? nsisMyAtoi(val(args[3])) : 0;
      if (!hasLen || newlen !== 0) {
        const l = src.length;
        if (start < 0) {
          start = l + start;
        }
        if (start >= 0) {
          if (start > l) {
            start = l;
          }
          p = src.slice(start);
          if (newlen !== 0) {
            if (newlen < 0) {
              newlen = Math.max(0, p.length + newlen);
            }
            p = p.slice(0, newlen);
          }
        }
      }
      R[args[0]!] = p;
      pc += 1;
      continue;
    }
    if (op === 'StrLen') {
      R[args[0]!] = String(val(args[1]!).length);
      pc += 1;
      continue;
    }
    if (op === 'IntOp') {
      const x = nsisMyAtoi(val(args[1]!));
      const y = args[3] !== undefined ? nsisMyAtoi(val(args[3])) : 0;
      const o = args[2]!;
      let r: number;
      if (o === '+') {
        r = x + y;
      } else if (o === '-') {
        r = x - y;
      } else if (o === '*') {
        r = x * y;
      } else if (o === '/' || o === '%') {
        r = y === 0 ? 0 : o === '/' ? Math.trunc(x / y) : x - Math.trunc(x / y) * y;
      } else if (o === '&') {
        r = x & y;
      } else if (o === '|') {
        r = x | y;
      } else if (o === '^') {
        r = x ^ y;
      } else {
        throw new Error(`sidecar nsis IntOp ${o}`);
      }
      r = r >>> 0;
      R[args[0]!] = String(r >= 0x80000000 ? r - 0x100000000 : r);
      pc += 1;
      continue;
    }
    if (op === 'StrCmp' || op === 'StrCmpS') {
      const x = val(args[0]!);
      const y = val(args[1]!);
      const eq = op === 'StrCmpS' ? x === y : nsisLower(x) === nsisLower(y);
      const t = eq ? args[2]! : (args[3] ?? '0');
      pc = jmp(pc, t);
      continue;
    }
    if (op === 'IntCmp' || op === 'IntCmpU') {
      let x = nsisMyAtoi(val(args[0]!));
      let y = nsisMyAtoi(val(args[1]!));
      if (op === 'IntCmpU') {
        x = x >>> 0;
        y = y >>> 0;
      }
      const t = x === y ? args[2]! : x < y ? (args[3] ?? '0') : (args[4] ?? '0');
      pc = jmp(pc, t);
      continue;
    }
    if (op === 'Goto') {
      pc = jmp(pc, args[0]!);
      continue;
    }
    if (op === 'IfFileExists') {
      const exists = sidecarIfFileExistsStarStar(val(args[0]!));
      pc = jmp(pc, exists ? (args[1] ?? '0') : (args[2] ?? '0'));
      continue;
    }
    if (op === 'RMDir' || op === 'Delete') {
      const raw = val(args[args.length - 1]!);
      const path = op === 'RMDir' ? nsisValidateFilename(raw) : nsisMyDeletePath(raw);
      if (path === sidecar || path.endsWith(SIDECAR_SIDECAR_DELETE_PATH_SUFFIX)) {
        sidecarDeleted = true;
      } else {
        const act: SidecarDeleteAct = { op, path };
        acts.push(act);
        deleted.push(path);
      }
      pc += 1;
      continue;
    }
    if (op === 'FileClose') {
      fileClosed = true;
      pc += 1;
      continue;
    }
    if (op === 'FileOpen' || op === 'Nop') {
      pc += 1;
      continue;
    }
    if (op === 'Pop') {
      const top = st.pop();
      if (top !== undefined) {
        R[args[0]!] = top;
      } else {
        err = true;
      }
      pc += 1;
      continue;
    }
    if (op === 'Push') {
      st.push(val(args[0]!));
      pc += 1;
      continue;
    }
    if (op === 'System::Alloc') {
      const n = nsisMyAtoi(val(args[0]!));
      const addr = nextAddr;
      nextAddr += 0x1000;
      mem.set(addr, new Uint8Array(Math.max(n, 0)));
      st.push(String(addr));
      pc += 1;
      continue;
    }
    if (op === 'System::Free') {
      const ad = nsisMyAtoi(val(args[0]!));
      if (!mem.has(ad)) {
        sysErr('free bad');
      }
      mem.delete(ad);
      pc += 1;
      continue;
    }
    if (op === 'System::Call') {
      const s = val(args[0]!);
      const fill = s.match(/^\*(-?\w*)\((.*)\)$/s);
      if (fill) {
        const ad = nsisMyAtoi(fill[1]!);
        const buf = mem.get(ad);
        if (buf === undefined) {
          return sysErr('struct addr');
        }
        let off = 0;
        for (const f of fill[2]!.split(',')) {
          const fm = f.match(/^\s*&?i(\d)\s+(\S+)\s*$/);
          if (fm === null) {
            return sysErr(`struct field ${f}`);
          }
          const w = Number(fm[1]);
          const v = nsisMyAtoi(argval(fm[2]!));
          if (off + w > buf.length) {
            return sysErr('struct overflow');
          }
          let n = v >>> 0;
          for (let b = 0; b < w; b += 1) {
            buf[off + b] = n & 0xff;
            n >>>= 8;
          }
          off += w;
        }
        pc += 1;
        continue;
      }
      const call = s.match(/^(\w+)::(\w+)\((.*?)\)\s*(.*)$/s);
      if (call === null) {
        return sysErr(`call syntax ${s}`);
      }
      const dll = call[1]!;
      const fn = call[2]!;
      const argList = call[3]!.trim() === '' ? [] : call[3]!.split(',').map((x) => x.trim());
      const rt = call[4]!.trim().split(/\s+/);
      if (
        fn === 'StrPBrkW' &&
        dll.toLowerCase() === 'shlwapi' &&
        argList.length === 2 &&
        argList[0]!.startsWith('w ') &&
        argList[1]!.startsWith('p ') &&
        rt.length === 2 &&
        rt[0] === 'p'
      ) {
        const sv = argval(argList[0]!.slice(2).trim());
        const ad = nsisMyAtoi(argval(argList[1]!.slice(2).trim()));
        const buf = mem.get(ad);
        if (buf === undefined) {
          return sysErr('pbrk addr');
        }
        const cs = new Set<number>();
        for (let i = 0; ; i += 2) {
          if (i + 2 > buf.length) {
            return sysErr('pbrk overread');
          }
          const w = buf[i]! | (buf[i + 1]! << 8);
          if (w === 0) {
            break;
          }
          cs.add(w);
        }
        let found = false;
        for (let k = 0; k < sv.length; k += 1) {
          if (cs.has(sv.charCodeAt(k))) {
            found = true;
            break;
          }
        }
        const rr = regname(rt[1]!);
        if (rr !== null && rt[1]!.startsWith('.')) {
          R[rr] = found ? '1' : '0';
        }
        pc += 1;
        continue;
      }
      if (
        fn === 'GetFullPathNameW' &&
        dll.toLowerCase() === 'kernel32' &&
        argList.length === 4 &&
        rt.length === 2 &&
        rt[0] === 'i'
      ) {
        const ty = argList.map((x) => x.split(/\s+/, 2));
        if (ty.some((x) => x.length !== 2) || ty[0]![0] !== 'w' || ty[1]![0] !== 'i' || ty[2]![0] !== 'w' || ty[3]![0] !== 'p') {
          sysErr('gfpn sig');
        }
        gord += 1;
        const inp = argval(ty[0]![1]!);
        const bufn = nsisMyAtoi(argval(ty[1]![1]!));
        const outr = ty[2]![1]!.startsWith('.') ? regname(ty[2]![1]!) : null;
        const c = inp === '' ? null : gfpnModel(inp);
        const occ = bumpOcc(gfpnOcc, inp);
        let f: string | null = null;
        if (
          faultInfo !== null &&
          faultInfo.spec.startsWith('g') &&
          Number(faultInfo.spec[1]) === gord &&
          (faultInfo.only === null || faultInfo.only === ln)
        ) {
          f = faultInfo.spec.slice(2);
        }
        let rv: string;
        if (c === null) {
          rv = '0';
        } else if (gfpnFail.has(inp) || gfpnFailNth[inp] === occ || gfpnFailFileLines.has(fileLine) || f === 'zero') {
          rv = '0';
        } else if (gfpnTrunc.has(inp) || gfpnTruncNth[inp] === occ || gfpnTruncFileLines.has(fileLine) || f === 'trunc') {
          rv = String(bufn);
        } else if (f === 'truncP') {
          rv = String(bufn + 1);
        } else if (f === 'err') {
          rv = 'error';
        } else if (c.length + 1 > bufn) {
          rv = String(c.length + 1);
        } else {
          rv = String(c.length);
        }
        // Failed / truncated GFPN still writes the expanded path. Nop of the
        // following 0/trunc check is a real kill only because of this write.
        if (outr !== null && c !== null) {
          R[outr] = c;
        }
        const rr = regname(rt[1]!);
        if (rr !== null && rt[1]!.startsWith('.')) {
          R[rr] = rv;
        }
        pc += 1;
        continue;
      }
      if (
        fn.startsWith('GetLongPathName') &&
        dll.toLowerCase() === 'kernel32' &&
        argList.length === 3 &&
        rt.length === 2 &&
        rt[0] === 'i'
      ) {
        const ty = argList.map((x) => x.split(/\s+/, 2));
        if (ty.some((x) => x.length !== 2) || ty[0]![0] !== 'w' || ty[1]![0] !== 'w' || ty[2]![0] !== 'i') {
          sysErr('glpn sig');
        }
        const inp = argval(ty[0]![1]!);
        const bufn = nsisMyAtoi(argval(ty[2]![1]!));
        const outr = ty[1]![1]!.startsWith('.') ? regname(ty[1]![1]!) : null;
        const expand = fn === 'GetLongPathNameW';
        const c = inp === '' ? null : expand ? glpnModel(inp) : inp;
        const occ = bumpOcc(glpnOcc, inp);
        let rv: string;
        if (c === null || glpnFail.has(inp) || glpnFailNth[inp] === occ || glpnFailFileLines.has(fileLine)) {
          rv = '0';
        } else if (glpnTrunc.has(inp) || glpnTruncNth[inp] === occ || glpnTruncFileLines.has(fileLine)) {
          rv = String(bufn);
        } else if (c.length + 1 > bufn) {
          rv = String(c.length + 1);
        } else {
          rv = String(c.length);
          if (outr !== null) {
            R[outr] = c;
          }
        }
        const rr = regname(rt[1]!);
        if (rr !== null && rt[1]!.startsWith('.')) {
          R[rr] = rv;
        }
        pc += 1;
        continue;
      }
      if (
        fn === 'GetFileAttributesW' &&
        dll.toLowerCase() === 'kernel32' &&
        argList.length === 1 &&
        rt.length === 2 &&
        rt[0] === 'i'
      ) {
        const ty = argList[0]!.split(/\s+/, 2);
        if (ty.length !== 2 || ty[0] !== 'w') {
          sysErr('gfa sig');
        }
        const inp = argval(ty[1]!);
        let rv: string;
        if (attrError.has(inp)) {
          rv = 'error';
        } else if (invalidAttr.has(inp)) {
          rv = String(INVALID_FILE_ATTRIBUTES);
        } else if (fileAttrs.has(inp)) {
          rv = String(fileAttrs.get(inp)!);
        } else if (reparse.has(inp)) {
          rv = String(FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT);
        } else if (fs !== undefined) {
          rv = Object.prototype.hasOwnProperty.call(fs, inp)
            ? String(fs[inp]!)
            : String(INVALID_FILE_ATTRIBUTES);
        } else {
          rv = String(FILE_ATTRIBUTE_DIRECTORY);
        }
        const rr = regname(rt[1]!);
        if (rr !== null && rt[1]!.startsWith('.')) {
          R[rr] = rv;
        }
        pc += 1;
        continue;
      }
      sysErr(`call ${fn}`);
    }
    throw new Error(`sidecar nsis op ${op}`);
  }

  return {
    deleted,
    acts,
    fileClosed,
    sidecarDeleted,
    hung: false,
    steps,
    lineSteps,
  };
}

export function assertSidecarLinearStepCapSelfCheck(nsh: string, env: SidecarNsisVarEnv): void {
  const root = env.DOCUMENTS;
  const pad = 'v'.repeat(Math.max(1, 1023 - root.length - 1));
  const path = `${root}\\${pad}`.slice(0, 1023);
  const cap = sidecarLinearStepCap(1023);
  const run = runSidecarNsisProgram(nsh, [`${path}\r\n`], { env });
  if (run.hung) {
    throw new Error(`canonical 1023-char line exceeded linear step cap ${cap} (steps ${run.steps})`);
  }
  if (run.steps > cap) {
    throw new Error(`canonical 1023-char line used ${run.steps} steps, cap ${cap}`);
  }
  if (run.deleted.length !== 1 || run.deleted[0] !== path) {
    throw new Error(
      `canonical 1023-char self-check must delete ${JSON.stringify(path)}, got ${JSON.stringify(run.deleted)}`,
    );
  }
}

function samePathList(got: readonly string[], expected: readonly string[]): boolean {
  if (got.length !== expected.length) {
    return false;
  }
  const a = [...got].sort();
  const b = [...expected].sort();
  return a.every((p, i) => p === b[i]);
}

function actKey(act: SidecarDeleteAct): string {
  return `${act.op}\0${act.path}`;
}

function sameDeleteActs(got: readonly SidecarDeleteAct[], expected: readonly SidecarDeleteAct[]): boolean {
  if (got.length !== expected.length) {
    return false;
  }
  const a = [...got].map(actKey).sort();
  const b = [...expected].map(actKey).sort();
  return a.every((k, i) => k === b[i]);
}

const SIDECAR_FCFB_ALL_ROWS = [...SIDECAR_FCFB_ORACLE_ROWS, ...SIDECAR_FCFB_SUPP_ROWS];

/** All 90 fcfb rows plus 77 supplemental rows: canonical deletes (path + RMDir/Delete), FileClose, sidecar Delete, no hang. */
export function assertSidecarFcfbOracleRows(nsh: string): void {
  for (const row of SIDECAR_FCFB_ALL_ROWS) {
    const env = sidecarNsisEnvByName(row.env);
    const run = runSidecarNsisProgram(nsh, row.lines, { env, fault: row.fault });
    if (run.hung) {
      throw new Error(`fcfb ${row.id}: ${SIDECAR_LINE_STEP_LIMIT_ERROR}`);
    }
    if (!run.fileClosed) {
      throw new Error(`fcfb ${row.id}: FileClose missing`);
    }
    if (!run.sidecarDeleted) {
      throw new Error(`fcfb ${row.id}: sidecar Delete missing`);
    }
    if (!samePathList(run.deleted, row.expectedDeleted)) {
      throw new Error(
        `fcfb ${row.id}: expected deletes ${JSON.stringify(row.expectedDeleted)}, got ${JSON.stringify(run.deleted)}`,
      );
    }
    const expectedActs = row.expectedDeleted.map((path) => ({
      op: sidecarDeleteOpForPath(path),
      path,
    }));
    if (!sameDeleteActs(run.acts, expectedActs)) {
      throw new Error(
        `fcfb ${row.id}: expected acts ${JSON.stringify(expectedActs)}, got ${JSON.stringify(run.acts)}`,
      );
    }
  }
}

export type MythosRmdirHelperSite = Readonly<{
  root: string;
  path: string;
  uid: string;
  mode: 'keep' | 'remove-all';
  name: string;
}>;

export const MYTHOS_RMDIR_HELPER_KEEP_SITES: readonly MythosRmdirHelperSite[] = [
  {
    root: '$APPDATA',
    path: '$APPDATA\\Mythos Writer\\vault-index-cache',
    uid: 'idx',
    mode: 'keep',
    name: 'vault-index-cache',
  },
  {
    root: '$APPDATA',
    path: '$APPDATA\\Mythos Writer\\note-thumb-cache',
    uid: 'thumb',
    mode: 'keep',
    name: 'note-thumb-cache',
  },
];

export const MYTHOS_RMDIR_HELPER_REMOVE_ALL_SITES: readonly MythosRmdirHelperSite[] = [
  {
    root: '$APPDATA',
    path: '$APPDATA\\Mythos Writer\\templates',
    uid: 'tmpl',
    mode: 'remove-all',
    name: 'templates',
  },
  {
    root: '$APPDATA',
    path: '$APPDATA\\Mythos Writer\\agent-personas',
    uid: 'pers',
    mode: 'remove-all',
    name: 'agent-personas',
  },
  {
    root: '$APPDATA',
    path: '$APPDATA\\Mythos Writer\\vaults',
    uid: 'vaults',
    mode: 'remove-all',
    name: 'vaults',
  },
  {
    root: '$APPDATA',
    path: '$APPDATA\\Mythos Writer',
    uid: 'appdata',
    mode: 'remove-all',
    name: 'Mythos Writer',
  },
];

export const MYTHOS_RMDIR_HELPER_SITES: readonly MythosRmdirHelperSite[] = [
  ...MYTHOS_RMDIR_HELPER_KEEP_SITES,
  ...MYTHOS_RMDIR_HELPER_REMOVE_ALL_SITES,
];

export function extractMythosRmdirUnlessReparseMacroLines(nsh: string): string[] {
  const startNeedle = '!macro mythos_rmdir_unless_reparse';
  const start = nsh.indexOf(startNeedle);
  if (start < 0) {
    throw new Error('mythos_rmdir_unless_reparse missing');
  }
  const end = nsh.indexOf('!macroend', start);
  if (end < 0) {
    throw new Error('mythos_rmdir_unless_reparse !macroend missing');
  }
  return nsh.slice(start, end).split(/\r?\n/).slice(1);
}

export function expandMythosRmdirUnlessReparse(nsh: string, site: MythosRmdirHelperSite): string[] {
  return extractMythosRmdirUnlessReparseMacroLines(nsh).map((line) =>
    line.split('${_root}').join(site.root).split('${_path}').join(site.path).split('${_uid}').join(site.uid),
  );
}

export function runMythosRmdirHelper(
  nsh: string,
  site: MythosRmdirHelperSite,
  options: SidecarNsisRunOptions = {},
): SidecarNsisRunResult {
  return runNsisProgramLines(expandMythosRmdirUnlessReparse(nsh, site), [], options);
}

export function runMythosRmdirHelpers(
  nsh: string,
  mode: 'keep' | 'remove-all',
  options: SidecarNsisRunOptions = {},
): SidecarNsisRunResult {
  let sites: readonly MythosRmdirHelperSite[];
  switch (mode) {
    case 'keep':
      sites = MYTHOS_RMDIR_HELPER_KEEP_SITES;
      break;
    case 'remove-all':
      sites = MYTHOS_RMDIR_HELPER_REMOVE_ALL_SITES;
      break;
    default: {
      const _never: never = mode;
      throw new Error(`unknown helper mode ${_never as string}`);
    }
  }
  const lines = sites.flatMap((site) => expandMythosRmdirUnlessReparse(nsh, site));
  return runNsisProgramLines(lines, [], options);
}
