/**
 * Unified NSIS interpreter for the sidecar FileOpen…fallback program (oracle nsis.py).
 * Carries $1–$9 plus heap/stack across lines; models close/fallback/trim_chop/+N;
 * GFPN per-line faults; FileClose + sidecar Delete; linear step cap 20*len+2000.
 */

import { SIDECAR_FCFB_ORACLE_ROWS } from './sidecarFcfbOracleRows.test-helpers.js';
import { gfpnModel, type SidecarNsisVarEnv } from './sidecarTraversalScan.test-helpers.js';

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

export function sidecarNsisEnvByName(name: 'E1' | 'E5' | 'E6'): SidecarNsisVarEnv {
  switch (name) {
    case 'E1':
      return SIDECAR_NSIS_ENV_E1;
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

type Instr = { op: string; args: readonly string[] };

type Prog = { ins: Instr[]; lab: Map<string, number> };

const LABEL_RE = /^\w+:$/;
const REG_RE = /^\$\d$/;

function toks(line: string): string[] {
  return line.match(/"[^"]*"|\S+/g) ?? [];
}

function compileSidecarNsisProgram(lines: readonly string[]): Prog {
  const ins: Instr[] = [];
  const lab = new Map<string, number>();
  for (const raw of lines) {
    const t = raw.trim();
    if (t === '' || t.startsWith(';')) {
      continue;
    }
    if (LABEL_RE.test(t)) {
      lab.set(t.slice(0, -1), ins.length);
      continue;
    }
    const tk = toks(t);
    ins.push({ op: tk[0]!, args: tk.slice(1) });
  }
  return { ins, lab };
}

let progCache: { nsh: string; prog: Prog } | undefined;

function programForNsh(nsh: string): Prog {
  if (progCache !== undefined && progCache.nsh === nsh) {
    return progCache.prog;
  }
  const prog = compileSidecarNsisProgram(extractSidecarNsisProgramLines(nsh));
  progCache = { nsh, prog };
  return prog;
}

/** FileOpen $0 … uninstall_vault_fallback: (oracle `code()`). */
export function extractSidecarNsisProgramLines(nsh: string): string[] {
  const fileLines = nsh.split(/\r?\n/);
  const start = fileLines.findIndex((l) => l.trim().startsWith('FileOpen $0 "$APPDATA'));
  const end = fileLines.findIndex((l) => l.trim() === 'uninstall_vault_fallback:');
  if (start < 0 || end < start) {
    throw new Error('sidecar NSIS program (FileOpen … uninstall_vault_fallback:) markers missing');
  }
  return fileLines.slice(start, end + 1);
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

function lit(tok: string, env: SidecarNsisVarEnv): string {
  let s = tok.startsWith('"') && tok.endsWith('"') && tok.length >= 2 ? tok.slice(1, -1) : tok;
  s = s
    .replace(/\$\\n/g, '\n')
    .replace(/\$\\r/g, '\r')
    .replace(/\$\\t/g, '\t')
    .replace(/\$\{NSIS_MAX_STRLEN\}/g, String(SIDECAR_NSIS_MAX_STRLEN));
  const keys = (Object.keys(env) as (keyof SidecarNsisVarEnv)[]).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    s = s.split(`$${k}`).join(env[k]);
  }
  return s;
}

function sidecarPath(env: SidecarNsisVarEnv): string {
  return `${env.APPDATA}\\${SIDECAR_SIDECAR_DELETE_PATH_SUFFIX}`;
}

export type SidecarNsisFault = string | null;

export type SidecarNsisRunOptions = {
  env?: SidecarNsisVarEnv;
  fault?: SidecarNsisFault;
};

export type SidecarNsisRunResult = {
  deleted: string[];
  fileClosed: boolean;
  sidecarDeleted: boolean;
  hung: boolean;
  steps: number;
  lineSteps: number;
};

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
  const env = options.env;
  if (env === undefined) {
    throw new Error('runSidecarNsisProgram requires env');
  }
  const stream = sidecarLines.join('');
  const P = programForNsh(nsh);
  const faultInfo = parseFault(options.fault ?? null);
  const R: Record<string, string> = {};
  let err = false;
  const st: string[] = [];
  const mem = new Map<number, Uint8Array>();
  let nextAddr = 0x10000;
  const deleted: string[] = [];
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
    const { op, args } = P.ins[pc]!;
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
      const eq = op === 'StrCmpS' ? x === y : x.toLowerCase() === y.toLowerCase();
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
      const last = val(args[0]!)
        .split('\\*.*')[0]!
        .replace(/\//g, '\\')
        .split('\\')
        .pop() ?? '';
      pc = jmp(pc, last.includes('.') ? (args[2] ?? '0') : (args[1] ?? '0'));
      continue;
    }
    if (op === 'RMDir' || op === 'Delete') {
      const path = val(args[args.length - 1]!);
      if (path === sidecar || path.endsWith(SIDECAR_SIDECAR_DELETE_PATH_SUFFIX)) {
        sidecarDeleted = true;
      } else {
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
        for (let i = 0; i + 2 <= buf.length; i += 2) {
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
        } else if (f === 'zero') {
          rv = '0';
        } else if (f === 'trunc') {
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
      sysErr(`call ${fn}`);
    }
    throw new Error(`sidecar nsis op ${op}`);
  }

  return {
    deleted,
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

/** All 90 fcfb rows: expected canonical deletes, FileClose, sidecar Delete, no hang. */
export function assertSidecarFcfbOracleRows(nsh: string): void {
  for (const row of SIDECAR_FCFB_ORACLE_ROWS) {
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
  }
}
