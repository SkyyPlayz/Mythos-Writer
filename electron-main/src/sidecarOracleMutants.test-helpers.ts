/**
 * Vitest-only port of Forge's oracle mutant generator (oracle-1690 gen.py) for the sidecar guard
 * region. Keys and mutant texts match gen.py byte-for-byte so CI and the oracle sweep the same set.
 */

import {
  assertSidecarGuardVmBehaviourTables,
  DEFAULT_SIDECAR_NSIS_VAR_ENV,
  DENY_PREFIX_STRCPY_ACCEPTANCE_FILE_LINES,
  simulateSidecarDeleteReadLoop,
  SIDECAR_GUARD_REGION_FILE_LINE_FIRST,
  SIDECAR_GUARD_REGION_FILE_LINE_LAST,
  TRAVERSAL_ALLOW_DOT_LETTER_DELETE_PATHS,
  TRAVERSAL_ALLOW_SEGMENT_TAIL_DELETE_PATHS,
  type SidecarNsisVarEnv,
} from './sidecarTraversalScan.test-helpers.js';

/** Mode-2 detector: true when the pin-free VM tables (re-baselined on `canonical`) reject `mutant`. */
export function sidecarGuardModeTwoCaught(mutant: string, canonical: string): boolean {
  return sidecarGuardModeTwoFailure(mutant, canonical) !== undefined;
}

/** The pin-free VM tables' failure message for `mutant`, or `undefined` when they pass. */
export function sidecarGuardModeTwoFailure(mutant: string, canonical: string): string | undefined {
  try {
    assertSidecarGuardVmBehaviourTables(mutant, DEFAULT_SIDECAR_NSIS_VAR_ENV, {
      sweepRebaseline: true,
      canonicalNsh: canonical,
    });
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

const TAB = '\t';

/** oracle-1690 nsis.py ENV, and corpus.py ENVS[1] (allowlist roots nested under the deny roots). */
const ORACLE_ENV_BASE: SidecarNsisVarEnv = {
  WINDIR: 'C:\\Windows',
  PROGRAMFILES: 'C:\\Program Files',
  PROGRAMFILES64: 'C:\\Program Files (x86)',
  APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
  DOCUMENTS: 'C:\\Users\\me\\Documents',
  DESKTOP: 'C:\\Users\\me\\Desktop',
  PROFILE: 'C:\\Users\\me',
};
const ORACLE_ENV_NESTED: SidecarNsisVarEnv = {
  ...ORACLE_ENV_BASE,
  APPDATA: 'C:\\Windows\\System32\\config\\systemprofile\\AppData\\Roaming',
  DOCUMENTS: 'C:\\Program Files (x86)\\Docs',
  DESKTOP: 'C:\\Program Files\\Desk',
  PROFILE: 'C:\\Windows\\prof',
  PROGRAMFILES: 'C:\\Program Files (x86)',
  PROGRAMFILES64: 'C:\\Program Files',
};

/** corpus.py SH: tails appended to `Documents\v` and to `Documents`. */
const ORACLE_CORPUS_TAILS = [
  '\\..', '\\.', '\\..\\x', '\\.\\x', '\\../x', '\\./x', '/..\\x', '/.\\x', '/../x', '/./x', '/..', '/.',
  '\\.a\\x', '\\..a\\x', '/.a/x', '/..a/x', '\\...\\x', '/.../x', '\\a.\\x', '/a./x', '\\a..\\x', '\\a.',
  '\\a..', '/a.', '/a..', '\\.. ', `\\..${TAB}`, '\\...', '\\. ', '\\.. \\x', '/... ', '\\ ', `\\${TAB}`,
  `\\.${TAB}`, `\\..${TAB}\\x`, '\\a/... ', '\\v ', '\\v.', '\\. .', '\\.. .\\x', '\\a /x', `\\a${TAB}\\x`,
  '\\ a\\x', `\\${TAB}a\\x`, '/ a/x', `/${TAB}a/x`, '\\a//b', '\\a\\\\b', '/a//b',
  '\\.git\\..\\..\\..\\Windows', '\\a/.git/../../../Windows', '\\My Vault', '\\My Vault\\notes',
  '\\v1.2\\notes', '\\a.b.c', '\\v 1.2\\x', '\\.hidden', '\\..b', '\\v1.2\\x', '/v1.2/x', '\\a b',
  `\\a${TAB}b`, '\\x',
];

/** danger.py SEG / prefixes: segment shapes before `\` or `/`, then `Windows` or a further `..`. */
const ORACLE_DANGER_SEGMENTS = [
  '..', '.', ' ..', '.. ', '..  ', '.. .', '. .', `..${TAB}`, `.${TAB}`, '. ', '...', '....', '.. . ',
  `..${TAB}.`, '. ..',
];
const ORACLE_DANGER_PREFIXES = ['', 'v\\', 'ab\\', 'a b\\', 'a.b\\', 'xyz\\q\\', 'My Vault\\'];

/** Extra shapes: separator-adjacent segments, mixed separators and leading-separator paths. */
const BROAD_SEGMENTS = [
  '..', '.', ' ..', '.. ', '.. .', '. .', `..${TAB}`, `.${TAB}`, '. ', '...', '....', 'a.', 'a ',
  `a${TAB}`, '.a', '..a', 'a..', 'v', ' a', `${TAB}a`, 'a b', '.git', '..b',
];
const BROAD_PREFIXES = ['', 'v\\', 'v/', 'ab\\', 'a b\\', 'a.b\\', 'My Vault\\', 'w/'];

export type SidecarGuardCorpusCase = Readonly<{ env: SidecarNsisVarEnv; reads: readonly string[] }>;

/**
 * Systematic segment-tail shapes from `.`, space, TAB and letters, so the stricter-than-canonical
 * literal swaps on the `.`/`..`-then-separator rejects are covered as a class, not just by the
 * explicit allow rows. Decorations sit in prefix, middle and suffix positions around dot cores.
 * `x` is a gen.py literal, so it is one of the letters: an `"x"` swap refuses `.x` / `..x` names.
 */
function segmentTailShapes(): string[] {
  const letters = ['a', 'x'];
  const deco = ['', ' ', TAB, '.', ...letters];
  const cores = ['', '.', '..', '...', '....'];
  const out = new Set<string>();
  for (const lead of deco) {
    for (const core of cores) {
      for (const trail of deco) {
        const seg = `${lead}${core}${trail}`;
        if (seg !== '') {
          out.add(seg);
        }
      }
    }
  }
  const twoCharTails = ['. ', ' .', `${TAB} `];
  for (const l of letters) {
    twoCharTails.push(` ${l}`, `${TAB}${l}`, `.${l}`, `${l} `, `${l}${TAB}`, `${l}.`);
  }
  for (const core of ['.', '..', '...']) {
    for (const t of twoCharTails) {
      out.add(`${core}${t}`);
    }
  }
  return [...out];
}

/**
 * Paths that exercise every segment-tail shape in prefix/middle/suffix × both separators × doubled/
 * trailing. Suffix and trailing-separator paths also run LF-only and unterminated: without a `\r`
 * the trim leaves $2 = the path's last char while the scan runs, which a `$4`→`$2` swap reads.
 */
function segmentTailCases(d: string): string[][] {
  const seps = ['\\', '/'];
  const terms = ['\r\n', '\n', ''];
  const cases: string[][] = [];
  for (const seg of segmentTailShapes()) {
    for (const s1 of seps) {
      for (const s2 of seps) {
        cases.push([`${d}\\v${s1}${seg}${s2}x\r\n`]);
        cases.push([`${d}\\v${s1}${seg}${s2}${s2}y\r\n`]);
        for (const term of terms) {
          cases.push([`${d}\\v${s1}${seg}${s2}${term}`]);
        }
      }
      for (const term of terms) {
        cases.push([`${d}\\v${s1}${seg}${term}`]);
      }
      cases.push([`${d}\\${seg}${s1}x\r\n`]);
    }
  }
  for (const s1 of seps) {
    for (const s2 of seps) {
      cases.push([`${d}\\v${s1}${s2}x\r\n`]);
      cases.push([`${d}\\v${s1}${s2}\r\n`]);
    }
    cases.push([`${d}\\v${s1}\r\n`]);
  }
  for (const path of [...TRAVERSAL_ALLOW_SEGMENT_TAIL_DELETE_PATHS, ...TRAVERSAL_ALLOW_DOT_LETTER_DELETE_PATHS]) {
    cases.push([`${path}\r\n`]);
  }
  return cases;
}

/**
 * Multi-line sidecars where a long line is followed by a traversal line under every terminator, so a
 * skipped per-line $7 reset or empty check (the read-trim `+N` overshoot) shows as an extra delete.
 */
function multilineCarryCases(d: string): string[][] {
  const firsts = [`${d}\\${'a'.repeat(40)}`, `${d}\\${'b'.repeat(50)}`, `${d}\\v`];
  const travs = [
    `${d}\\..\\..\\..\\Windows`,
    `${d}/../../../Windows`,
    `${d}\\a\\..\\..\\Windows`,
    `${d}\\v\\.. \\x`,
    `${d}\\v/.. /x`,
    `${d}\\.\\x`,
    `${d}\\..`,
  ];
  const terms = ['\r\n', '\n', '\r', ''];
  const cases: string[][] = [];
  for (const first of firsts) {
    for (const firstTerm of ['\r\n', '\n']) {
      for (const trav of travs) {
        for (const term of terms) {
          cases.push([`${first}${firstTerm}`, `${trav}${term}`]);
        }
      }
    }
  }
  for (const trav of travs.slice(0, 3)) {
    cases.push([`${firsts[0]}\r\n`, `${trav}\n`, `${d}\\w\r\n`]);
    cases.push([`${firsts[0]}\n`, `${trav}\n`, `${d}\\w\n`]);
  }
  return cases;
}

function oracleCorpusCases(): string[][] {
  const d = ORACLE_ENV_BASE.DOCUMENTS;
  const a = ORACLE_ENV_BASE.APPDATA;
  const paths = [
    ...ORACLE_CORPUS_TAILS.map((s) => `${d}\\v${s}`),
    ...ORACLE_CORPUS_TAILS.map((s) => `${d}${s}`),
    d,
    `${d}\\`,
    'C:\\Users\\me\\Desktop\\v',
    'C:\\Users\\me\\Downloads\\v',
    'C:\\Users\\me\\Downloads',
    `${a}\\Mythos Writer`,
    `${a}\\Mythos Writer\\`,
    `${a}\\Mythos Writer\\v`,
    `${a}\\Mythos Writerx\\v`,
    `${a}\\SomeOtherApp1\\stuff`,
    'C:\\Windows\\System32',
    'C:\\Program Files\\x',
    'C:\\Program Files (x86)\\x',
    '\\..\\x',
    '..\\x',
    '.\\x',
    'x',
    '',
    ' ',
    '.',
    TAB,
  ];
  const cases = [
    ...paths.map((p) => [`${p}\r\n`]),
    ...paths.filter((_, i) => i % 3 === 0).map((p) => [p]),
    ...paths.filter((_, i) => i % 3 === 1).map((p) => [`${p}\n`]),
    ['\r\n', `${d}\\v\r\n`],
    [`${d}\\${'a'.repeat(30)}\r\n`, `${d}\\..\r\n`],
    [`${d}\\${'a'.repeat(40)}\r\n`, `${d}\\..\\..\\..\\Windows\r\n`, `${d}\\w\r\n`],
    [`${d}\\v\r\n`, 'C:\\Windows\\x\r\n', `${d}\\w\r\n`],
    [`${d}\\${'v'.repeat(29)}\r\n`, `${d}\\.\r\n`],
    [`${d}\\vault1`],
    [`${d}\\vault1\n`],
    [`${d}\\vault1\r`],
    [`${d}\\a\r\n`, `${d}\\b`],
  ];
  for (const pre of ORACLE_DANGER_PREFIXES) {
    for (const seg of ORACLE_DANGER_SEGMENTS) {
      for (const sep of ['\\', '/']) {
        cases.push([`${d}\\${pre}${seg}${sep}Windows\r\n`]);
        cases.push([`${d}\\${pre}${seg}\r\n`]);
        cases.push([`${d}\\${pre}${seg}${sep}..${sep}Windows\r\n`]);
      }
    }
  }
  for (const pre of BROAD_PREFIXES) {
    for (const seg of BROAD_SEGMENTS) {
      for (const sep of ['\\', '/']) {
        cases.push([`${d}\\${pre}${seg}${sep}Windows\r\n`]);
        cases.push([`${d}\\${pre}${seg}${sep}x\r\n`]);
        cases.push([`${d}\\${pre}${seg}${sep}..${sep}Windows\r\n`]);
      }
    }
  }
  for (const seg of BROAD_SEGMENTS) {
    cases.push([`\\${seg}\\x\r\n`], [`/${seg}/x\r\n`], [`${d}\\${seg}/x\r\n`], [`${d}/${seg}\\x\r\n`]);
  }
  cases.push(...segmentTailCases(d));
  cases.push(...multilineCarryCases(d));
  return cases;
}

/**
 * Forge's full oracle corpus (corpus.py CASES with both ENVS, as score.py runs it, plus danger.py
 * PATHS) and the broad separator shapes. Under the nested env `Documents` is rebased as score.py does.
 */
export function sidecarGuardOracleCorpus(): SidecarGuardCorpusCase[] {
  const base = oracleCorpusCases();
  const d = ORACLE_ENV_BASE.DOCUMENTS;
  const seen = new Set<string>();
  const out: SidecarGuardCorpusCase[] = [];
  const add = (env: SidecarNsisVarEnv, reads: readonly string[]): void => {
    const key = `${env.DOCUMENTS}\u0001${reads.join('\u0002')}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ env, reads });
    }
  };
  for (const reads of base) {
    add(ORACLE_ENV_BASE, reads);
  }
  const n = ORACLE_ENV_NESTED;
  for (const reads of base) {
    add(n, reads.map((r) => r.split(d).join(n.DOCUMENTS)));
  }
  add(n, [`${n.APPDATA}\\Mythos Writer\\v\r\n`]);
  add(n, [`${n.DESKTOP}\\v\r\n`]);
  add(n, [`${n.PROFILE}\\Downloads\\v\r\n`]);
  const n1 = { ...ORACLE_ENV_BASE, DESKTOP: 'C:\\Users\\me\\Documents\\Desktop' };
  const n3 = { ...ORACLE_ENV_BASE, DOCUMENTS: 'C:\\Users\\me' };
  const n5 = { ...ORACLE_ENV_BASE, DOCUMENTS: 'C:\\Users\\me\\Desktop\\Documents' };
  const n6 = { ...ORACLE_ENV_BASE, DESKTOP: 'C:\\Users\\me\\Downloads\\Desktop' };
  add(n1, ['C:\\Users\\me\\Documents\\Desktop\r\n']);
  add(n1, ['C:\\Users\\me\\Documents\\Desktop\\\r\n']);
  add(n1, ['C:\\Users\\me\\Documents\\Desktop/\r\n']);
  add(n1, ['C:\\Users\\me\\Documents\\Desktop\\v\r\n']);
  add(n3, ['C:\\Users\\me\\Desktop\r\n']);
  add(n3, ['C:\\Users\\me\\Downloads\r\n']);
  add(n3, ['C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\r\n']);
  add(n3, ['C:\\Users\\me\\AppData\r\n']);
  add(n3, ['C:\\Users\\me\\Desktop\\v\r\n']);
  add(n5, ['C:\\Users\\me\\Desktop\\Documents\r\n']);
  add(n5, ['C:\\Users\\me\\Desktop\\Documents\\v\r\n']);
  add(n6, ['C:\\Users\\me\\Downloads\\Desktop\r\n']);
  add(n6, ['C:\\Users\\me\\Downloads\\Desktop\\v\r\n']);
  add(ORACLE_ENV_BASE, ['C:\\Users\\me\\Documents\\*\r\n']);
  add(ORACLE_ENV_BASE, ['C:\\Users\\me\\Documents\\*.*\r\n']);
  add(ORACLE_ENV_BASE, ['C:\\Users\\me\\Desktop\\?\r\n']);
  add(ORACLE_ENV_BASE, ['C:\\Users\\me\\Documents\\v*\r\n']);
  return out;
}

/** Delete list plus loop termination for one corpus case; a VM throw is its own distinct outcome. */
export function sidecarGuardCaseOutcome(nsh: string, c: SidecarGuardCorpusCase): string {
  try {
    const run = simulateSidecarDeleteReadLoop(nsh, c.reads, c.env);
    const hang = run.hung;
    return `${run.closed ? 'closed' : 'open'}${hang ? ':hang' : ''}|${JSON.stringify(run.acts)}`;
  } catch (err) {
    return `THROW:${err instanceof Error ? err.message : String(err)}`;
  }
}

const ORACLE_JUMP_LABELS = [
  'uninstall_vault_read',
  'uninstall_vault_trav_ok',
  'mythos_trav_fwd',
  'mythos_trav_inc',
  'mythos_trav_scan',
  'uninstall_vault_close',
  'mythos_al_not_appdata',
  'uninstall_vault_do_delete',
  'mythos_reparse_walk',
  'mythos_reparse_next',
  'mythos_reparse_hit',
  'mythos_reparse_leaf',
  'mythos_nested_root_guard',
  'mythos_nr_strip',
  'mythos_nr_appdata',
  'mythos_nr_documents',
  'mythos_nr_desktop',
  'mythos_nr_downloads',
  'mythos_nr_ok',
  'uninstall_vault_file',
] as const;

const ORACLE_JUMP_OFFSETS = ['0', '+2', '+4', '+6'] as const;

const ORACLE_LITERALS = ['"."', '" "', '"$\\t"', '"\\"', '"/"', '""', '"x"'] as const;

const ORACLE_TOKEN_SWAPS: readonly (readonly [string, string])[] = [
  ['$1', '$2'],
  ['$1', '$4'],
  ['$2', '$1'],
  ['$4', '$2'],
  ['$4', '$5'],
  ['$7', '$8'],
  ['$8', '$7'],
  ['$3', '$2'],
  ['$5', '$4'],
  ['+ 1', '+ 2'],
  ['+ 1', '+ 0'],
  ['+ 1', '- 1'],
  ['- 1', '- 2'],
  ['- 1', '+ 1'],
  ['- 1', '- 0'],
  [' 1 ', ' 2 '],
  ['-1', '-2'],
  ['-1', '0'],
  ['"0"', '"1"'],
  ['StrCpy $7 0', 'StrCpy $7 1'],
  ['StrCpy $7 0', 'StrCpy $7 9999'],
  ['Mythos Writer', 'Mythos'],
  ['$APPDATA', '$PROFILE'],
  ['"$WINDIR"', '"C:\\Win"'],
  ['"$PROGRAMFILES"', '"C:\\Prog"'],
  ['"$PROGRAMFILES64"', '"C:\\ProgX"'],
  ['0x400', '0x407'],
  ['0x400', '0x1'],
  ['0x400', '0x11'],
  ['0x400', '0xFFFFFFFF'],
];

export type OracleClassMutant = { key: string; fileLine: number; nsh: string };

function replaceFirst(source: string, needle: string, replacement: string): string {
  const at = source.indexOf(needle);
  return at < 0 ? source : source.slice(0, at) + replacement + source.slice(at + needle.length);
}

/** gen.py: every mutant class over file lines :43–:307 plus the H6 deny StrCpy variants. */
export function generateOracleClassMutants(nsh: string): OracleClassMutant[] {
  const src = nsh.split('\n');
  const muts = new Map<string, OracleClassMutant>();
  const put = (key: string, fileLine: number, lines: readonly string[]): void => {
    const text = lines.join('\n');
    if (text !== nsh) {
      muts.set(key, { key, fileLine, nsh: text });
    }
  };
  const rep = (n: number, line: string): string[] => {
    const next = [...src];
    next[n - 1] = line;
    return next;
  };

  for (let n = SIDECAR_GUARD_REGION_FILE_LINE_FIRST; n <= SIDECAR_GUARD_REGION_FILE_LINE_LAST; n += 1) {
    const s = src[n - 1]!;
    const t = s.trim();
    const indent = s.match(/^\s*/)?.[0] ?? '';
    const labeled = t.match(/^(\w+):\s*(.*)$/);
    const instr =
      labeled && labeled[2] !== '' && !labeled[2].startsWith(':') ? labeled[2] : t;
    const tk = instr.split(/\s+/);
    put(`${n}:nop`, n, rep(n, `${indent}Nop`));
    put(`${n}:del`, n, [...src.slice(0, n - 1), ...src.slice(n)]);
    if (/^\w+:$/.test(t)) {
      put(`${n}:label_rename`, n, rep(n, indent + t.replace(':', 'X:')));
      continue;
    }
    put(`${n}:goto_inc`, n, rep(n, `${indent}Goto mythos_trav_inc`));
    if (tk[0] === 'StrCmp' || tk[0] === 'IfErrors' || tk[0] === 'Goto') {
      const firstTarget = tk[0] === 'StrCmp' ? 3 : 1;
      for (let j = firstTarget; j < tk.length; j += 1) {
        for (const lab of [...ORACLE_JUMP_LABELS, ...ORACLE_JUMP_OFFSETS]) {
          if (tk[j] !== lab) {
            const nt = [...tk];
            nt[j] = lab;
            put(`${n}:tgt${j}:${tk[j]}->${lab}`, n, rep(n, indent + nt.join(' ')));
          }
        }
      }
    }
    for (const a of ORACLE_LITERALS) {
      if (s.includes(a)) {
        for (const b of ORACLE_LITERALS) {
          if (a !== b) {
            put(`${n}:${a}->${b}`, n, rep(n, replaceFirst(s, a, b)));
          }
        }
      }
    }
    for (const [a, b] of ORACLE_TOKEN_SWAPS) {
      if (s.includes(a)) {
        put(`${n}:${a}->${b}`, n, rep(n, replaceFirst(s, a, b)));
      }
    }
  }

  for (const n of DENY_PREFIX_STRCPY_ACCEPTANCE_FILE_LINES) {
    const s = src[n - 1]!;
    const indent = s.match(/^\s*/)?.[0] ?? '';
    const variants: readonly (readonly [string, string])[] = [
      ['$4->$3', replaceFirst(s, 'StrCpy $4', 'StrCpy $3')],
      ['$1->$0', s.split('$1').join('$0')],
      ['len->1', replaceFirst(s, '$3 $8', '$3 1')],
      ['StrCpy $4 $5', `${indent}StrCpy $4 $5`],
    ];
    for (const [k, line] of variants) {
      put(`${n}:H6 ${k}`, n, rep(n, line));
    }
  }
  return [...muts.values()];
}
