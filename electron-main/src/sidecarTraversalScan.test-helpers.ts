/**
 * Vitest-only: behavioural model of mythos_trav_scan + WINDIR/PROGRAMFILES denies in uninstall-vaults.nsh.
 */

import { createHash } from 'node:crypto';

export const TRAVERSAL_SCAN_BLOCK_END_MARKER = 'uninstall_vault_trav_ok:';
export const TRAVERSAL_SCAN_BLOCK_PREP_LINE = '        StrCpy $7 0';
export const TRAVERSAL_SCAN_BLOCK_SCAN_LABEL = 'mythos_trav_scan:';

/** Exact sidecar traversal chain (StrCpy $7 0 … uninstall_vault_trav_ok:). */
export const CANONICAL_TRAVERSAL_SCAN_BLOCK: readonly string[] = [
  TRAVERSAL_SCAN_BLOCK_PREP_LINE,
  '        mythos_trav_scan:',
  '          StrCpy $4 $1 1 $7',
  '          StrCmp $4 "" uninstall_vault_trav_ok',
  String.raw`          StrCmp $4 "\" 0 mythos_trav_fwd`,
  '            IntOp $8 $7 + 1',
  '            StrCpy $4 $1 1 $8',
  '            StrCmp $4 "." 0 mythos_trav_inc',
  '              IntOp $8 $8 + 1',
  '              StrCpy $4 $1 1 $8',
  '              StrCmp $4 "" uninstall_vault_read',
  String.raw`              StrCmp $4 "\" uninstall_vault_read`,
  '              StrCmp $4 "." 0 mythos_trav_inc',
  '                IntOp $8 $8 + 1',
  '                StrCpy $4 $1 1 $8',
  '                StrCmp $4 "" uninstall_vault_read',
  String.raw`                StrCmp $4 "\" uninstall_vault_read`,
  '                Goto mythos_trav_inc',
  '          mythos_trav_fwd:',
  '          StrCmp $4 "/" 0 mythos_trav_inc',
  '            IntOp $8 $7 + 1',
  '            StrCpy $4 $1 1 $8',
  '            StrCmp $4 "." 0 mythos_trav_inc',
  '              IntOp $8 $8 + 1',
  '              StrCpy $4 $1 1 $8',
  '              StrCmp $4 "" uninstall_vault_read',
  '              StrCmp $4 "/" uninstall_vault_read',
  String.raw`              StrCmp $4 "\" uninstall_vault_read`,
  '              StrCmp $4 "." 0 mythos_trav_inc',
  '                IntOp $8 $8 + 1',
  '                StrCpy $4 $1 1 $8',
  '                StrCmp $4 "" uninstall_vault_read',
  '                StrCmp $4 "/" uninstall_vault_read',
  String.raw`                StrCmp $4 "\" uninstall_vault_read`,
  '          mythos_trav_inc:',
  '          IntOp $7 $7 + 1',
  '          Goto mythos_trav_scan',
  '        uninstall_vault_trav_ok:',
];

export const CANONICAL_TRAVERSAL_SCAN_BLOCK_SHA256 = createHash('sha256')
  .update(CANONICAL_TRAVERSAL_SCAN_BLOCK.join('\n'))
  .digest('hex');

export function nshExecutableLines(source: string): string {
  return source.replace(/;[^\n]*/g, '');
}

function replaceInBackslashBranch(
  nsh: string,
  needle: string,
  replacement: string,
  occurrence = 0,
): string {
  const start = nsh.indexOf(TRAV_BACKSLASH_ENTRY);
  const end = nsh.indexOf(TRAV_FWD_LABEL, start);
  if (start < 0 || end <= start) {
    throw new Error('backslash traversal branch missing');
  }
  const branch = nsh.slice(start, end);
  let idx = -1;
  for (let i = 0; i <= occurrence; i++) {
    idx = branch.indexOf(needle, idx + 1);
  }
  if (idx < 0) {
    throw new Error(`needle missing in backslash branch: ${needle.slice(0, 40)}`);
  }
  const globalAt = start + idx;
  return nsh.slice(0, globalAt) + replacement + nsh.slice(globalAt + needle.length);
}

function replaceInForwardBranch(
  nsh: string,
  needle: string,
  replacement: string,
  occurrence = 0,
): string {
  const start = nsh.indexOf(TRAV_FWD_LABEL);
  const end = nsh.indexOf('mythos_trav_inc:', start);
  if (start < 0 || end <= start) {
    throw new Error('forward traversal branch missing');
  }
  const branch = nsh.slice(start, end);
  let idx = -1;
  for (let i = 0; i <= occurrence; i++) {
    idx = branch.indexOf(needle, idx + 1);
  }
  if (idx < 0) {
    throw new Error(`needle missing in forward branch: ${needle.slice(0, 40)}`);
  }
  const globalAt = start + idx;
  return nsh.slice(0, globalAt) + replacement + nsh.slice(globalAt + needle.length);
}

export type TravScanOutcome = 'trav_ok' | 'vault_read';

function nshCharAt(path: string, index: number): string {
  if (index < 0 || index >= path.length) {
    return '';
  }
  return path[index]!;
}

function parseStrCmpQuotedLiteral(raw: string): string {
  if (raw.length === 0) {
    return '';
  }
  if (raw === '""') {
    return '';
  }
  const inner = raw.slice(1, -1);
  return inner.replace(/\\(.)/g, '$1');
}

function resolveTraversalJump(
  target: string,
  labels: ReadonlyMap<string, number>,
): TravScanOutcome | { pc: number } {
  if (target === 'uninstall_vault_trav_ok') {
    return 'trav_ok';
  }
  if (target === 'uninstall_vault_read') {
    return 'vault_read';
  }
  if (target === 'mythos_trav_scan') {
    return { pc: 0 };
  }
  const at = labels.get(target);
  if (at === undefined) {
    throw new Error(`unknown traversal jump label: ${target}`);
  }
  return { pc: at };
}

function readTravRegister(regs: { $7: number; $8: number }, name: string): number {
  if (name === '7') {
    return regs.$7;
  }
  if (name === '8') {
    return regs.$8;
  }
  throw new Error(`unsupported traversal register $${name}`);
}

/** Execute mythos_trav_scan … uninstall_vault_trav_ok block for sidecar path $1. */
export function executeTraversalScanBlock(blockLines: readonly string[], path: string): TravScanOutcome {
  const labels = new Map<string, number>();
  for (let i = 0; i < blockLines.length; i++) {
    const labelMatch = blockLines[i]!.match(/^\s*(\w+):\s*$/);
    if (labelMatch) {
      labels.set(labelMatch[1]!, i);
    }
  }

  const scanPc = labels.get('mythos_trav_scan');
  if (scanPc === undefined) {
    throw new Error('mythos_trav_scan label missing from traversal block');
  }

  let $1 = path;
  const regs = { $7: 0, $8: 0 };
  let $4 = '';
  let pc = 0;
  const maxSteps = path.length * 400 + 2000;

  for (let step = 0; step < maxSteps; step++) {
    if (pc < 0 || pc >= blockLines.length) {
      throw new Error(`traversal VM pc out of range: ${pc}`);
    }
    const raw = blockLines[pc]!;
    const line = raw.trim();
    if (/^\w+:\s*$/.test(line)) {
      pc += 1;
      continue;
    }

    const strCpy7 = line.match(/^StrCpy \$7 (\d+)$/);
    if (strCpy7) {
      regs.$7 = Number(strCpy7[1]);
      pc += 1;
      continue;
    }
    const strCpyFromPath = line.match(/^StrCpy \$4 \$1 1 \$(\d+)$/);
    if (strCpyFromPath) {
      const idx = readTravRegister(regs, strCpyFromPath[1]!);
      $4 = nshCharAt($1, idx);
      pc += 1;
      continue;
    }
    const intOp7 = line.match(/^IntOp \$8 \$7 \+ (\d+)$/);
    if (intOp7) {
      regs.$8 = regs.$7 + Number(intOp7[1]);
      pc += 1;
      continue;
    }
    const intOp8 = line.match(/^IntOp \$8 \$8 \+ (\d+)$/);
    if (intOp8) {
      regs.$8 = regs.$8 + Number(intOp8[1]);
      pc += 1;
      continue;
    }
    const intOp7inc = line.match(/^IntOp \$7 \$7 \+ (\d+)$/);
    if (intOp7inc) {
      regs.$7 += Number(intOp7inc[1]);
      pc += 1;
      continue;
    }
    if (line === 'Nop') {
      pc += 1;
      continue;
    }
    if (line === 'Goto mythos_trav_scan') {
      pc = scanPc + 1;
      continue;
    }
    if (line === 'Goto mythos_trav_inc') {
      const jump = resolveTraversalJump('mythos_trav_inc', labels);
      if (typeof jump === 'string') {
        return jump;
      }
      pc = jump.pc;
      continue;
    }

    const strCmpFour = line.match(/^StrCmp \$4 ("(?:\\.|[^"])*") (\d+) (\w+)$/);
    if (strCmpFour) {
      const lit = parseStrCmpQuotedLiteral(strCmpFour[1]!);
      const skip = Number(strCmpFour[2]);
      const target = strCmpFour[3]!;
      if ($4 === lit) {
        pc += 1 + skip;
      } else {
        const jump = resolveTraversalJump(target, labels);
        if (typeof jump === 'string') {
          return jump;
        }
        pc = jump.pc;
      }
      continue;
    }

    const strCmpThree = line.match(/^StrCmp \$4 ("(?:\\.|[^"])*") (\w+)$/);
    if (strCmpThree) {
      const lit = parseStrCmpQuotedLiteral(strCmpThree[1]!);
      const target = strCmpThree[2]!;
      if ($4 === lit) {
        const jump = resolveTraversalJump(target, labels);
        if (typeof jump === 'string') {
          return jump;
        }
        pc = jump.pc;
      } else {
        pc += 1;
      }
      continue;
    }

    throw new Error(`unsupported traversal VM instruction at block pc ${pc}: ${line}`);
  }
  throw new Error('traversal VM exceeded step limit');
}

export function locateTraversalScanBlock(nsh: string): { start: number; end: number; lines: string[] } {
  const fileLines = nshFileLines(nsh);
  const scanIdx = fileLines.findIndex((l) => l.trim() === TRAVERSAL_SCAN_BLOCK_SCAN_LABEL);
  const end = fileLines.findIndex((l) => l.trim() === TRAVERSAL_SCAN_BLOCK_END_MARKER);
  if (scanIdx < 1 || end <= scanIdx) {
    throw new Error('mythos_trav_scan chain markers missing in uninstall nsh');
  }
  const start = scanIdx - 1;
  if (fileLines[start] !== TRAVERSAL_SCAN_BLOCK_PREP_LINE) {
    throw new Error(
      `expected ${JSON.stringify(TRAVERSAL_SCAN_BLOCK_PREP_LINE)} immediately before ${TRAVERSAL_SCAN_BLOCK_SCAN_LABEL}`,
    );
  }
  return { start, end, lines: fileLines.slice(start, end + 1) };
}

export function extractTraversalScanBlockLines(nsh: string): string[] {
  return locateTraversalScanBlock(nsh).lines;
}

export function spliceTraversalScanBlock(nsh: string, blockLines: string[]): string {
  const { start, end } = locateTraversalScanBlock(nsh);
  const fileLines = nshFileLines(nsh);
  return [...fileLines.slice(0, start), ...blockLines, ...fileLines.slice(end + 1)].join('\n');
}

export function replaceTraversalScanBlockLine(
  nsh: string,
  blockLineIndex: number,
  newLine: string,
): string {
  const { lines } = locateTraversalScanBlock(nsh);
  if (blockLineIndex < 0 || blockLineIndex >= lines.length) {
    throw new Error(`block line index ${blockLineIndex} out of range (${lines.length})`);
  }
  const next = [...lines];
  next[blockLineIndex] = newLine;
  return spliceTraversalScanBlock(nsh, next);
}

export function replaceTraversalScanBlockLineByExact(
  nsh: string,
  exactLine: string,
  newLine: string,
  occurrence = 0,
): string {
  const { lines } = locateTraversalScanBlock(nsh);
  let seen = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === exactLine) {
      seen += 1;
      if (seen === occurrence) {
        return replaceTraversalScanBlockLine(nsh, i, newLine);
      }
    }
  }
  throw new Error(`exact block line not found (occurrence ${occurrence}): ${exactLine}`);
}

export function assertTraversalScanBlockExact(nsh: string): void {
  const actual = extractTraversalScanBlockLines(nsh);
  const expected = CANONICAL_TRAVERSAL_SCAN_BLOCK;
  if (actual.length !== expected.length) {
    throw new Error(
      `traversal scan block (StrCpy $7 0..${TRAVERSAL_SCAN_BLOCK_END_MARKER}) line count: expected ${expected.length}, got ${actual.length}`,
    );
  }
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(
        `traversal scan block line ${i} (prep + ${i}): expected ${JSON.stringify(expected[i])}, got ${JSON.stringify(actual[i])}`,
      );
    }
  }
  const hash = createHash('sha256').update(actual.join('\n')).digest('hex');
  if (hash !== CANONICAL_TRAVERSAL_SCAN_BLOCK_SHA256) {
    throw new Error(`traversal scan block sha256 mismatch: ${hash}`);
  }
}

/** Sidecar traversal outcome from the real .nsh mythos_trav_scan chain. */
export function mythosTravScanOutcome(path: string, nsh: string): TravScanOutcome {
  const block = extractTraversalScanBlockLines(nsh);
  return executeTraversalScanBlock(block, path);
}

export const TRAVERSAL_REJECT_PATHS: readonly string[] = [
  'C:\\vault\\.\\note',
  'C:\\vault\\..\\note',
  'C:/vault/./note',
  'C:/vault/../note',
  'C:/vault/.',
  'C:/vault/..',
  String.raw`C:/vault/.\note`,
  String.raw`C:/vault/..\note`,
  'C:\\a\\..\\..\\Windows',
  '...\\Documents\\..\\..\\Windows',
];

export const TRAVERSAL_ALLOW_PATHS: readonly string[] = [
  'C:\\Users\\me\\Mythos Writer\\vaults\\x',
  'D:/data/vault',
];

export function assertTraversalRejectAllowTables(nsh: string): void {
  for (const path of TRAVERSAL_REJECT_PATHS) {
    const outcome = mythosTravScanOutcome(path, nsh);
    if (outcome !== 'vault_read') {
      throw new Error(`expected vault_read for traversal path ${JSON.stringify(path)}, got ${outcome}`);
    }
  }
  for (const path of TRAVERSAL_ALLOW_PATHS) {
    const outcome = mythosTravScanOutcome(path, nsh);
    if (outcome !== 'trav_ok') {
      throw new Error(`expected trav_ok for traversal path ${JSON.stringify(path)}, got ${outcome}`);
    }
  }
}

export function mythosPrefixDenyOutcome(
  path: string,
  prefixes: readonly string[],
): 'vault_read' | 'allowlist_continue' {
  for (const prefix of prefixes) {
    if (path.length < prefix.length) {
      continue;
    }
    if (path.slice(0, prefix.length) !== prefix) {
      continue;
    }
    if (path.length === prefix.length) {
      return 'vault_read';
    }
    const next = path[prefix.length];
    if (next === '\\' || next === '/') {
      return 'vault_read';
    }
  }
  return 'allowlist_continue';
}

export const TRAV_BACKSLASH_ENTRY = String.raw`StrCmp $4 "\" 0 mythos_trav_fwd`;
export const TRAV_FWD_LABEL = 'mythos_trav_fwd:';

export const NSH_BACKSLASH_DOT_CHECK = String.raw`StrCmp $4 "." 0 mythos_trav_inc`;
export const NSH_BACKSLASH_DOT_BACKSLASH_REJECT = String.raw`StrCmp $4 "\" uninstall_vault_read`;
export const NSH_BACKSLASH_DOT_DOT_EMPTY_REJECT = String.raw`StrCmp $4 "" uninstall_vault_read`;
export const NSH_FWD_SLASH_DOT_CHECK = String.raw`StrCmp $4 "/" 0 mythos_trav_inc`;
export const NSH_FWD_DOT_SLASH_REJECT = String.raw`StrCmp $4 "/" uninstall_vault_read`;
export const NSH_FWD_DOT_BACKSLASH_REJECT = String.raw`StrCmp $4 "\" uninstall_vault_read`;

export function extractBackslashTraversalBranch(executable: string): string {
  const start = executable.indexOf(TRAV_BACKSLASH_ENTRY);
  const end = executable.indexOf(TRAV_FWD_LABEL, start);
  if (start < 0 || end <= start) {
    throw new Error('backslash traversal branch missing in uninstall nsh');
  }
  return executable.slice(start, end);
}

export function extractForwardTraversalBranch(executable: string): string {
  const start = executable.indexOf(TRAV_FWD_LABEL);
  const end = executable.indexOf('mythos_trav_inc:', start);
  if (start < 0 || end <= start) {
    throw new Error('forward-slash traversal branch missing in uninstall nsh');
  }
  return executable.slice(start, end);
}

export function nshFileLines(nsh: string): string[] {
  return nsh.split(/\r?\n/);
}

export function replaceNshLine(nsh: string, lineOneBased: number, newLine: string): string {
  const lines = nshFileLines(nsh);
  if (lineOneBased < 1 || lineOneBased > lines.length) {
    throw new Error(`line ${lineOneBased} out of range (${lines.length} lines)`);
  }
  const out = [...lines];
  out[lineOneBased - 1] = newLine;
  return out.join('\n');
}

/** Shield gotoinc: replace one exact line inside the marker block with Goto mythos_trav_inc */
export function mutantGotoTravIncAtBlockLine(nsh: string, exactLine: string, occurrence = 0): string {
  const { lines } = locateTraversalScanBlock(nsh);
  let seen = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === exactLine) {
      seen += 1;
      if (seen === occurrence) {
        const indent = lines[i]!.match(/^\s*/)?.[0] ?? '';
        return replaceTraversalScanBlockLine(nsh, i, `${indent}Goto mythos_trav_inc`);
      }
    }
  }
  throw new Error(`block line not found for gotoinc: ${exactLine}`);
}

/** Probe nopl: StrCmp target uninstall_vault_read -> mythos_trav_inc on one block line */
export function mutantNeutralizeVaultReadAtBlockLine(
  nsh: string,
  exactLine: string,
  occurrence = 0,
): string {
  const { lines } = locateTraversalScanBlock(nsh);
  let seen = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === exactLine) {
      seen += 1;
      if (seen === occurrence) {
        return replaceTraversalScanBlockLine(
          nsh,
          i,
          lines[i]!.replace('uninstall_vault_read', 'mythos_trav_inc'),
        );
      }
    }
  }
  throw new Error(`block line not found for neutralize: ${exactLine}`);
}

export function assertTraversalBranchBehaviourPins(nsh: string): void {
  const executable = nshExecutableLines(nsh);
  const travStart = executable.indexOf('mythos_trav_scan');
  const travOk = executable.indexOf('uninstall_vault_trav_ok:');
  if (travStart < 0 || travOk <= travStart) {
    throw new Error('mythos_trav_scan region missing');
  }
  assertTraversalScanBlockExact(nsh);
  if (executable.indexOf(TRAV_BACKSLASH_ENTRY) < 0) {
    throw new Error('backslash traversal entry missing');
  }
  if (executable.indexOf(TRAV_FWD_LABEL) < 0) {
    throw new Error('forward traversal label mythos_trav_fwd: missing');
  }
}

export const WINDIR_DENY_STRCMP = String.raw`StrCmp $4 "$WINDIR" uninstall_vault_read 0`;
export const PROGRAMFILES_DENY_STRCMP = String.raw`StrCmp $4 "$PROGRAMFILES" uninstall_vault_read 0`;
export const PROGRAMFILES64_DENY_STRCMP = String.raw`StrCmp $4 "$PROGRAMFILES64" uninstall_vault_read 0`;

export function assertWindirProgramFilesDenyBehaviourPins(nsh: string): void {
  const executable = nshExecutableLines(nsh);
  for (const [varName, strcmpLine] of [
    ['$WINDIR', WINDIR_DENY_STRCMP],
    ['$PROGRAMFILES', PROGRAMFILES_DENY_STRCMP],
    ['$PROGRAMFILES64', PROGRAMFILES64_DENY_STRCMP],
  ] as const) {
    const strLen = `StrLen $3 "${varName}"`;
    const strLenAt = executable.indexOf(strLen);
    const strcmpAt = executable.indexOf(strcmpLine);
    if (strLenAt < 0 || strcmpAt < 0) {
      throw new Error(`allowlist deny missing for ${varName}`);
    }
    if (strcmpAt <= strLenAt) {
      throw new Error(`${varName} StrCmp deny must follow StrLen`);
    }
  }
}

export function applyNshReplaceOnce(source: string, needle: string, replacement: string): string {
  const at = source.indexOf(needle);
  if (at < 0) {
    throw new Error(`mutant needle missing: ${needle.slice(0, 60)}`);
  }
  return source.slice(0, at) + replacement + source.slice(at + needle.length);
}

export function applyNshReplaceAll(source: string, needle: string, replacement: string): string {
  return source.split(needle).join(replacement);
}

const TRAV_INC_NOP = String.raw`StrCmp $4 "\" mythos_trav_inc`;

export function mutantMB1_neutralizeBackslashDotBackslashReject(nsh: string): string {
  return replaceInBackslashBranch(nsh, NSH_BACKSLASH_DOT_BACKSLASH_REJECT, TRAV_INC_NOP, 0);
}

export function mutantMB2_neutralizeBackslashDotDotBackslashReject(nsh: string): string {
  return replaceInBackslashBranch(nsh, NSH_BACKSLASH_DOT_BACKSLASH_REJECT, TRAV_INC_NOP, 1);
}

export function mutantMB3_deleteBackslashDotDotRejectPair(nsh: string): string {
  const block =
    '                StrCmp $4 "" uninstall_vault_read\n' +
    String.raw`                StrCmp $4 "\" uninstall_vault_read` +
    '\n                Goto mythos_trav_inc';
  if (!nsh.includes(block)) {
    throw new Error('M-B3 block missing from nsh');
  }
  return nsh.replace(block, '                Goto mythos_trav_inc');
}

export function mutantMB4_neutralizeAllBackslashTravRejects(nsh: string): string {
  let mutant = nsh;
  const back = extractBackslashTraversalBranch(nshExecutableLines(mutant));
  const backslashRejects = back.match(/StrCmp \$4 "\\" uninstall_vault_read/g) ?? [];
  for (let i = backslashRejects.length - 1; i >= 0; i--) {
    mutant = replaceInBackslashBranch(mutant, NSH_BACKSLASH_DOT_BACKSLASH_REJECT, TRAV_INC_NOP, i);
  }
  const emptyRejects = back.match(/StrCmp \$4 "" uninstall_vault_read/g) ?? [];
  for (let i = emptyRejects.length - 1; i >= 0; i--) {
    mutant = replaceInBackslashBranch(
      mutant,
      NSH_BACKSLASH_DOT_DOT_EMPTY_REJECT,
      String.raw`StrCmp $4 "" mythos_trav_inc`,
      i,
    );
  }
  return mutant;
}

export function mutantMB5_neutralizeBackslashDotCheck(nsh: string): string {
  return replaceInBackslashBranch(
    nsh,
    NSH_BACKSLASH_DOT_CHECK,
    String.raw`StrCmp $4 "." mythos_trav_inc`,
    0,
  );
}

export function mutantMB6_neutralizeForwardSlashTravRejects(nsh: string): string {
  let mutant = nsh;
  const fwd = extractForwardTraversalBranch(nshExecutableLines(mutant));
  const slashRejects = fwd.match(/StrCmp \$4 "\/" uninstall_vault_read/g) ?? [];
  for (let i = slashRejects.length - 1; i >= 0; i--) {
    mutant = replaceInForwardBranch(mutant, NSH_FWD_DOT_SLASH_REJECT, String.raw`StrCmp $4 "/" mythos_trav_inc`, i);
  }
  const backslashInFwd = fwd.match(/StrCmp \$4 "\\" uninstall_vault_read/g) ?? [];
  for (let i = backslashInFwd.length - 1; i >= 0; i--) {
    mutant = replaceInForwardBranch(
      mutant,
      NSH_FWD_DOT_BACKSLASH_REJECT,
      TRAV_INC_NOP,
      i,
    );
  }
  return mutant;
}

export function mutantWindirDenyDrop(nsh: string): string {
  return applyNshReplaceOnce(nsh, WINDIR_DENY_STRCMP, 'Nop');
}

export function mutantProgramFilesDenyDrop(nsh: string): string {
  return applyNshReplaceOnce(nsh, PROGRAMFILES_DENY_STRCMP, 'Nop');
}

export function mutantProgramFiles64DenyDrop(nsh: string): string {
  return applyNshReplaceOnce(nsh, PROGRAMFILES64_DENY_STRCMP, 'Nop');
}

export function mutantXF1_gotoIncLine79(nsh: string): string {
  return mutantGotoTravIncAtBlockLine(nsh, '              StrCmp $4 "/" uninstall_vault_read', 0);
}

export function mutantXF2_gotoIncLine80(nsh: string): string {
  return mutantGotoTravIncAtBlockLine(
    nsh,
    String.raw`              StrCmp $4 "\" uninstall_vault_read`,
    0,
  );
}

export function mutantXF3_gotoIncLine85(nsh: string): string {
  return mutantGotoTravIncAtBlockLine(nsh, '                StrCmp $4 "/" uninstall_vault_read', 0);
}

export function mutantXF4_gotoIncLine86(nsh: string): string {
  return mutantGotoTravIncAtBlockLine(
    nsh,
    String.raw`                StrCmp $4 "\" uninstall_vault_read`,
    0,
  );
}

export function mutantXF5_gotoIncLine75(nsh: string): string {
  return mutantGotoTravIncAtBlockLine(nsh, '            StrCmp $4 "." 0 mythos_trav_inc', 0);
}

export function mutantXF6_gotoIncLine81(nsh: string): string {
  return mutantGotoTravIncAtBlockLine(nsh, '              StrCmp $4 "." 0 mythos_trav_inc', 1);
}

export function mutantXB7_gotoIncLine65(nsh: string): string {
  return mutantGotoTravIncAtBlockLine(nsh, '              StrCmp $4 "." 0 mythos_trav_inc', 0);
}

export function mutantMB5a_neutralizeLine78(nsh: string): string {
  return mutantNeutralizeVaultReadAtBlockLine(nsh, '              StrCmp $4 "" uninstall_vault_read', 1);
}

export function mutantMB6a_neutralizeLine84(nsh: string): string {
  return mutantNeutralizeVaultReadAtBlockLine(nsh, '                StrCmp $4 "" uninstall_vault_read', 0);
}

/** Shield N1: forward `/` check disabled (`|`). */
export function mutantN1_forwardSlashCheckPipe(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(
    nsh,
    '          StrCmp $4 "/" 0 mythos_trav_inc',
    '          StrCmp $4 "|" 0 mythos_trav_inc',
  );
}

/** Shield N2: first IntOp $8 $7 + 1 -> +2 (backslash branch). */
export function mutantN2_intOpLine58Plus2(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(
    nsh,
    '            IntOp $8 $7 + 1',
    '            IntOp $8 $7 + 2',
    0,
  );
}

/** Shield N3: second IntOp $8 $7 + 1 -> +2 (forward branch). */
export function mutantN3_intOpLine73Plus2(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(
    nsh,
    '            IntOp $8 $7 + 1',
    '            IntOp $8 $7 + 2',
    1,
  );
}

/** Probe U1 — same as N2 (file :58 IntOp +1 -> +2). */
export function mutantU1_intOp58Plus2(nsh: string): string {
  return mutantN2_intOpLine58Plus2(nsh);
}

/** Probe U3 — empty-char scan exit disabled (:56). */
export function mutantU3_disableEmptyEndCheck(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(
    nsh,
    '          StrCmp $4 "" uninstall_vault_trav_ok',
    '          Nop',
  );
}

/** Probe U4 — char load uses wrong index (:55 early end). */
export function mutantU4_strcpy4Uses8(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(
    nsh,
    '          StrCpy $4 $1 1 $7',
    '          StrCpy $4 $1 1 $8',
  );
}

/** Probe U5 — forward `/` branch never taken (:72). */
export function mutantU5_forwardSlashPipe(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(
    nsh,
    '          StrCmp $4 "/" 0 mythos_trav_inc',
    '          StrCmp $4 "|" 0 mythos_trav_inc',
  );
}

/** Probe U6 — scan start index past path end (:53). */
export function mutantU6_strcpy7PastEnd(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(nsh, TRAVERSAL_SCAN_BLOCK_PREP_LINE, '        StrCpy $7 99999');
}

/** Probe U7 — loop increment +1 -> +3 (:88). */
export function mutantU7_intOp7Plus3(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(
    nsh,
    '          IntOp $7 $7 + 1',
    '          IntOp $7 $7 + 3',
  );
}

/** Critic E-58: first IntOp $8 $7 + 1 neutralised. */
export function mutantE58_intOpFirstPlus1(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(nsh, '            IntOp $8 $7 + 1', '            Nop', 0);
}

/** Critic E-59: first StrCpy $4 $1 1 $8 uses $7 (bad index). */
export function mutantE59_strcpyUse7(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(
    nsh,
    '            StrCpy $4 $1 1 $8',
    '            StrCpy $4 $1 1 $7',
    0,
  );
}

export function mutantE61_intOp8Plus1(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(nsh, '              IntOp $8 $8 + 1', '              IntOp $8 $8 + 2', 0);
}

export function mutantE62_strcpySecondUse7(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(
    nsh,
    '              StrCpy $4 $1 1 $8',
    '              StrCpy $4 $1 1 $7',
    0,
  );
}

export function mutantE67_intOp8Plus1Second(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(nsh, '                IntOp $8 $8 + 1', '                IntOp $8 $8 + 2', 0);
}

export function mutantE74_strcpyFwdBranch(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(
    nsh,
    '            StrCpy $4 $1 1 $8',
    '            StrCpy $4 $1 1 $7',
    1,
  );
}

export function mutantE77_intOpFwdInner(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(nsh, '              IntOp $8 $8 + 1', '              IntOp $8 $8 + 2', 1);
}

export function mutantE83_strcpyFwdInner(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(
    nsh,
    '                StrCpy $4 $1 1 $8',
    '                StrCpy $4 $1 1 $7',
    0,
  );
}
