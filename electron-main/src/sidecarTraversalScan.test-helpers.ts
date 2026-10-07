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
  '              StrCmp $4 "/" uninstall_vault_read',
  '              StrCmp $4 "." 0 mythos_trav_inc',
  '                IntOp $8 $8 + 1',
  '                StrCpy $4 $1 1 $8',
  '                StrCmp $4 "" uninstall_vault_read',
  String.raw`                StrCmp $4 "\" uninstall_vault_read`,
  '                StrCmp $4 "/" uninstall_vault_read',
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

/** Marker-anchored sidecar guard region (file :43–:106): read/trim + traversal + deny + M5 prefix. */
export const SIDECAR_GUARD_REGION_START_LINE = '        ClearErrors';
export const SIDECAR_GUARD_REGION_START_FOLLOW_LINE = '        FileRead $0 $1';
export const SIDECAR_GUARD_REGION_END_LINE = '          StrCmp $1 $5 uninstall_vault_read';

export const SIDECAR_GUARD_REGION_FILE_LINE_FIRST = 43;
export const SIDECAR_GUARD_REGION_FILE_LINE_LAST = 106;

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

export type TravScanRegs = { $7: number; $8: number };

/** Execute mythos_trav_scan … uninstall_vault_trav_ok block for sidecar path $1. */
export function executeTraversalScanBlock(
  blockLines: readonly string[],
  path: string,
  initialRegs: TravScanRegs = { $7: 0, $8: 0 },
): TravScanOutcome {
  return executeTraversalScanBlockStateful(blockLines, path, initialRegs).outcome;
}

export function executeTraversalScanBlockStateful(
  blockLines: readonly string[],
  path: string,
  initialRegs: TravScanRegs,
): { outcome: TravScanOutcome; regs: TravScanRegs } {
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
  const regs = { $7: initialRegs.$7, $8: initialRegs.$8 };
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
        return { outcome: jump, regs };
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
          return { outcome: jump, regs };
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
          return { outcome: jump, regs };
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
  assertSidecarGuardRegionExact(nsh);
}

function readTrimBlockFromGuardRegion(region: readonly string[]): readonly string[] {
  const prep = region.findIndex((l) => l === TRAVERSAL_SCAN_BLOCK_PREP_LINE);
  if (prep < 0) {
    throw new Error('StrCpy $7 0 missing from sidecar guard region');
  }
  return region.slice(0, prep);
}

function travBlockFromGuardRegion(region: readonly string[]): readonly string[] {
  const prep = region.findIndex((l) => l === TRAVERSAL_SCAN_BLOCK_PREP_LINE);
  const end = region.findIndex((l) => l.trim() === TRAVERSAL_SCAN_BLOCK_END_MARKER);
  if (prep < 0 || end < prep) {
    throw new Error('traversal scan block markers missing from sidecar guard region');
  }
  return region.slice(prep, end + 1);
}

function denyBlockFromGuardRegion(region: readonly string[]): readonly string[] {
  const travEnd = region.findIndex((l) => l.trim() === TRAVERSAL_SCAN_BLOCK_END_MARKER);
  const appdataStart = region.findIndex((l) => l.includes(String.raw`StrCpy $5 "$APPDATA`));
  if (travEnd < 0 || appdataStart <= travEnd) {
    throw new Error('deny-prefix block boundaries missing from sidecar guard region');
  }
  return region.slice(travEnd + 1, appdataStart);
}

function appDataM5BlockFromGuardRegion(region: readonly string[]): readonly string[] {
  const appdataStart = region.findIndex((l) => l.includes(String.raw`StrCpy $5 "$APPDATA`));
  if (appdataStart < 0) {
    throw new Error('APPDATA M5 guard start missing from sidecar guard region');
  }
  return region.slice(appdataStart);
}

/** APPDATA … Downloads allowlist gates through `mythos_al_deny` (file :102–:148). */
export function extractSidecarAllowlistDeleteLinesFromNsh(nsh: string): string[] {
  const fileLines = nshFileLines(nsh);
  const start = fileLines.findIndex((l) => l.includes(String.raw`StrCpy $5 "$APPDATA`));
  const denyLabel = fileLines.findIndex((l) => l.trim() === 'mythos_al_deny:');
  if (start < 0 || denyLabel < start) {
    throw new Error('allowlist delete block start missing in uninstall nsh');
  }
  const gotoReadIdx = denyLabel + 1;
  if (fileLines[gotoReadIdx]?.trim() !== 'Goto uninstall_vault_read') {
    throw new Error('mythos_al_deny Goto uninstall_vault_read missing');
  }
  return fileLines.slice(start, gotoReadIdx + 1);
}

function extractAppDataM5GuardLinesFromNsh(nsh: string): string[] {
  return extractSidecarAllowlistDeleteLinesFromNsh(nsh);
}

function extractSidecarGuardRegionForVm(nsh: string): string[] {
  return extractSidecarGuardRegionLinesRebaselined(nsh);
}

export function locateSidecarGuardRegion(nsh: string): { start: number; end: number; lines: string[] } {
  const fileLines = nshFileLines(nsh);
  const start = fileLines.findIndex(
    (l, i) =>
      l === SIDECAR_GUARD_REGION_START_LINE && fileLines[i + 1] === SIDECAR_GUARD_REGION_START_FOLLOW_LINE,
  );
  const end = fileLines.findIndex((l, i) => i >= start && l === SIDECAR_GUARD_REGION_END_LINE);
  if (start < 0 || end < start) {
    throw new Error('sidecar guard region (:43–:106) markers missing in uninstall nsh');
  }
  const lines = fileLines.slice(start, end + 1);
  return { start, end, lines };
}

export function extractSidecarGuardRegionLines(nsh: string, options?: { strictLength?: boolean }): string[] {
  const located = locateSidecarGuardRegion(nsh);
  if (options?.strictLength !== false) {
    if (located.lines.length !== CANONICAL_SIDECAR_GUARD_REGION.length) {
      throw new Error(
        `sidecar guard region line count: expected ${CANONICAL_SIDECAR_GUARD_REGION.length}, got ${located.lines.length}`,
      );
    }
  }
  return located.lines;
}

/** Re-baseline VM tables: marker slice only (no canonical line-count gate). */
export function extractSidecarGuardRegionLinesRebaselined(nsh: string): string[] {
  return extractSidecarGuardRegionLines(nsh, { strictLength: false });
}

export function spliceSidecarGuardRegion(nsh: string, blockLines: string[]): string {
  const { start, end } = locateSidecarGuardRegion(nsh);
  const fileLines = nshFileLines(nsh);
  return [...fileLines.slice(0, start), ...blockLines, ...fileLines.slice(end + 1)].join('\n');
}

export function replaceSidecarGuardRegionLine(
  nsh: string,
  regionLineIndex: number,
  newLine: string,
): string {
  const { lines } = locateSidecarGuardRegion(nsh);
  if (regionLineIndex < 0 || regionLineIndex >= lines.length) {
    throw new Error(`sidecar guard region line index ${regionLineIndex} out of range (${lines.length})`);
  }
  const next = [...lines];
  next[regionLineIndex] = newLine;
  return spliceSidecarGuardRegion(nsh, next);
}

/** Mutate one file line in :43–:104 (1-based file line number). */
export function replaceSidecarGuardFileLine(nsh: string, fileLineOneBased: number, newLine: string): string {
  if (
    fileLineOneBased < SIDECAR_GUARD_REGION_FILE_LINE_FIRST ||
    fileLineOneBased > SIDECAR_GUARD_REGION_FILE_LINE_LAST
  ) {
    throw new Error(`file line ${fileLineOneBased} outside guard region`);
  }
  const regionIndex = fileLineOneBased - SIDECAR_GUARD_REGION_FILE_LINE_FIRST;
  return replaceSidecarGuardRegionLine(nsh, regionIndex, newLine);
}

export function assertSidecarGuardRegionExact(nsh: string): void {
  const actual = extractSidecarGuardRegionLines(nsh, { strictLength: true });
  const expected = CANONICAL_SIDECAR_GUARD_REGION;
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(
        `sidecar guard region line ${i} (file :${SIDECAR_GUARD_REGION_FILE_LINE_FIRST + i}): expected ${JSON.stringify(expected[i])}, got ${JSON.stringify(actual[i])}`,
      );
    }
  }
  const hash = createHash('sha256').update(actual.join('\n')).digest('hex');
  if (hash !== CANONICAL_SIDECAR_GUARD_REGION_SHA256) {
    throw new Error(`sidecar guard region sha256 mismatch: ${hash}`);
  }
}

function runTraversalVmFromNsh(path: string, nsh: string): TravScanOutcome {
  const region = extractSidecarGuardRegionForVm(nsh);
  return executeTraversalScanBlock(travBlockFromGuardRegion(region), path);
}

function runDenyPrefixVmFromNsh(
  path: string,
  nsh: string,
  env: SidecarNsisVarEnv,
): DenyPrefixOutcome {
  const region = extractSidecarGuardRegionForVm(nsh);
  return executeDenyPrefixBlock(denyBlockFromGuardRegion(region), path, env);
}

export const DENY_PREFIX_BLOCK_ANCHOR_AFTER = TRAVERSAL_SCAN_BLOCK_END_MARKER;
export const DENY_PREFIX_BLOCK_START_LINE = '        StrLen $3 "$WINDIR"';
export const DENY_PREFIX_BLOCK_END_LINE =
  '        StrCmp $4 "$PROGRAMFILES64" uninstall_vault_read 0';

/** Exact $WINDIR / $PROGRAMFILES / $PROGRAMFILES64 deny chain (file :91–:99). */
export const CANONICAL_DENY_PREFIX_BLOCK: readonly string[] = [
  DENY_PREFIX_BLOCK_START_LINE,
  '        StrCpy $4 $1 $3',
  '        StrCmp $4 "$WINDIR" uninstall_vault_read 0',
  '        StrLen $3 "$PROGRAMFILES"',
  '        StrCpy $4 $1 $3',
  '        StrCmp $4 "$PROGRAMFILES" uninstall_vault_read 0',
  '        StrLen $3 "$PROGRAMFILES64"',
  '        StrCpy $4 $1 $3',
  DENY_PREFIX_BLOCK_END_LINE,
];

export const CANONICAL_DENY_PREFIX_BLOCK_SHA256 = createHash('sha256')
  .update(CANONICAL_DENY_PREFIX_BLOCK.join('\n'))
  .digest('hex');

/** APPDATA Mythos Writer prefix + root self-match (file :100–:104, M5). */
export const CANONICAL_APPDATA_M5_GUARD_BLOCK: readonly string[] = [
  String.raw`        StrCpy $5 "$APPDATA\Mythos Writer"`,
  '        StrLen $3 $5',
  '        StrCpy $4 $1 $3',
  '        StrCmp $4 $5 0 mythos_al_not_appdata',
  SIDECAR_GUARD_REGION_END_LINE,
];

/** FileRead + newline trim loop body (file :43–:52, Critic S13). */
export const CANONICAL_READ_TRIM_BLOCK: readonly string[] = [
  '        ClearErrors',
  '        FileRead $0 $1',
  '        IfErrors uninstall_vault_close',
  '        StrCpy $2 $1 1 -1',
  '        StrCmp $2 "$\\n" 0 +2',
  '          StrCpy $1 $1 -1',
  '        StrCpy $2 $1 1 -1',
  '        StrCmp $2 "$\\r" 0 +2',
  '          StrCpy $1 $1 -1',
  '        StrCmp $1 "" uninstall_vault_read',
];

export const CANONICAL_READ_TRIM_BLOCK_SHA256 = createHash('sha256')
  .update(CANONICAL_READ_TRIM_BLOCK.join('\n'))
  .digest('hex');

export const CANONICAL_SIDECAR_GUARD_REGION: readonly string[] = [
  ...CANONICAL_READ_TRIM_BLOCK,
  ...CANONICAL_TRAVERSAL_SCAN_BLOCK,
  ...CANONICAL_DENY_PREFIX_BLOCK,
  ...CANONICAL_APPDATA_M5_GUARD_BLOCK,
];

export const CANONICAL_SIDECAR_GUARD_REGION_SHA256 = createHash('sha256')
  .update(CANONICAL_SIDECAR_GUARD_REGION.join('\n'))
  .digest('hex');

export type SidecarNsisVarEnv = Readonly<{
  WINDIR: string;
  PROGRAMFILES: string;
  PROGRAMFILES64: string;
  APPDATA: string;
  DOCUMENTS: string;
  DESKTOP: string;
  PROFILE: string;
}>;

export const DEFAULT_SIDECAR_NSIS_VAR_ENV: SidecarNsisVarEnv = {
  WINDIR: 'C:\\Windows',
  PROGRAMFILES: 'C:\\Program Files',
  PROGRAMFILES64: 'C:\\Program Files (x86)',
  APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
  DOCUMENTS: 'C:\\Users\\me\\Documents',
  DESKTOP: 'C:\\Users\\me\\Desktop',
  PROFILE: 'C:\\Users\\me',
};

function unescapeNsisCString(inner: string): string {
  return inner.replace(/\\(.)/g, (_match, c: string) => {
    switch (c) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case '"':
        return '"';
      case '\\':
        return '\\';
      default:
        return `\\${c}`;
    }
  });
}

function expandNsisQuotedLiteral(quoted: string, env: SidecarNsisVarEnv): string {
  const inner = quoted.slice(1, -1);
  if (inner.startsWith('$')) {
    const varName = inner.match(/^\$([A-Z0-9_]+)/)?.[1];
    if (varName) {
      const key = varName as keyof SidecarNsisVarEnv;
      const value = env[key];
      if (value === undefined) {
        throw new Error(`missing NSIS var expansion for $${varName}`);
      }
      const suffix = inner.slice(varName.length + 1);
      return value + unescapeNsisCString(suffix);
    }
  }
  return unescapeNsisCString(inner);
}

export type DenyPrefixOutcome = 'vault_read' | 'allowlist_continue';

/** Execute StrLen/StrCpy/StrCmp deny lines for $WINDIR, $PROGRAMFILES, $PROGRAMFILES64. */
export function executeDenyPrefixBlock(
  blockLines: readonly string[],
  path: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): DenyPrefixOutcome {
  const $1 = path;
  let $3 = 0;
  let $4 = '';
  for (let pc = 0; pc < blockLines.length; pc++) {
    const line = blockLines[pc]!.trim();
    const strLen = line.match(/^StrLen \$3 ("(?:\\.|[^"])*")$/);
    if (strLen) {
      $3 = expandNsisQuotedLiteral(strLen[1]!, env).length;
      continue;
    }
    const strCpyFromLenReg = line.match(/^StrCpy \$4 \$1 \$(\d+)$/);
    if (strCpyFromLenReg) {
      const len = strCpyFromLenReg[1] === '3' ? $3 : 0;
      $4 = $1.slice(0, len);
      continue;
    }
    const strCpyFromLitLen = line.match(/^StrCpy \$4 \$1 (\d+)$/);
    if (strCpyFromLitLen) {
      $4 = $1.slice(0, Number(strCpyFromLitLen[1]));
      continue;
    }
    const strCmpDeny = line.match(/^StrCmp \$4 ("(?:\\.|[^"])*") uninstall_vault_read (\d+)$/);
    if (strCmpDeny) {
      const lit = expandNsisQuotedLiteral(strCmpDeny[1]!, env);
      if ($4 === lit) {
        return 'vault_read';
      }
      pc += Number(strCmpDeny[2]);
      continue;
    }
    if (line === 'Nop') {
      continue;
    }
    throw new Error(`unsupported deny-prefix VM instruction: ${line}`);
  }
  return 'allowlist_continue';
}

export type SidecarAllowlistDeleteOutcome = 'delete' | 'skip_delete';

export type AppDataM5GuardOutcome = 'vault_read' | 'allowlist_continue';

function allowlistDeleteToLegacyAppData(outcome: SidecarAllowlistDeleteOutcome): AppDataM5GuardOutcome {
  return outcome === 'delete' ? 'allowlist_continue' : 'vault_read';
}

function resolveAllowlistDeleteJump(
  target: string,
  labels: ReadonlyMap<string, number>,
): SidecarAllowlistDeleteOutcome | { pc: number } {
  if (target === 'uninstall_vault_read') {
    return 'skip_delete';
  }
  if (target === 'uninstall_vault_do_delete') {
    return 'delete';
  }
  const at = labels.get(target);
  if (at === undefined) {
    throw new Error(`unknown allowlist/delete jump target: ${target}`);
  }
  return { pc: at };
}

/** Execute APPDATA/Documents/Desktop/Downloads allowlist gates (:102–:148) through delete vs read decision. */
export function executeSidecarAllowlistDeleteBlock(
  blockLines: readonly string[],
  path: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): SidecarAllowlistDeleteOutcome {
  const labels = new Map<string, number>();
  for (let i = 0; i < blockLines.length; i++) {
    const labelMatch = blockLines[i]!.trim().match(/^(\w+):$/);
    if (labelMatch) {
      labels.set(labelMatch[1]!, i);
    }
  }

  const $1 = path;
  let $3 = 0;
  let $4 = '';
  let $5 = '';
  let $6 = '';
  let pc = 0;
  const maxSteps = blockLines.length * 40 + 200;
  for (let step = 0; step < maxSteps; step++) {
    if (pc < 0 || pc >= blockLines.length) {
      return 'skip_delete';
    }
    const raw = blockLines[pc]!;
    const line = raw.trim();
    if (/^\w+:\s*$/.test(line)) {
      pc += 1;
      continue;
    }
    const strCpy5 = line.match(/^StrCpy \$5 ("(?:\\.|[^"])*")$/);
    if (strCpy5) {
      $5 = expandNsisQuotedLiteral(strCpy5[1]!, env);
      pc += 1;
      continue;
    }
    const strLenReg = line.match(/^StrLen \$3 \$5$/);
    if (strLenReg) {
      $3 = $5.length;
      pc += 1;
      continue;
    }
    const strLenLit = line.match(/^StrLen \$3 ("(?:\\.|[^"])*")$/);
    if (strLenLit) {
      $3 = expandNsisQuotedLiteral(strLenLit[1]!, env).length;
      pc += 1;
      continue;
    }
    const strCpyFromLenReg = line.match(/^StrCpy \$4 \$1 \$(\d+)$/);
    if (strCpyFromLenReg) {
      const len = strCpyFromLenReg[1] === '3' ? $3 : 0;
      $4 = $1.slice(0, len);
      pc += 1;
      continue;
    }
    const strCmpRegPair = line.match(/^StrCmp \$4 \$5 0 (\w+)$/);
    if (strCmpRegPair) {
      if ($4 === $5) {
        pc += 1;
        continue;
      }
      const jump = resolveAllowlistDeleteJump(strCmpRegPair[1]!, labels);
      if (typeof jump === 'string') {
        return jump;
      }
      pc = jump.pc;
      continue;
    }
    const strCmpRoot = line.match(/^StrCmp \$1 \$5 uninstall_vault_read$/);
    if (strCmpRoot) {
      if ($1 === $5) {
        return 'skip_delete';
      }
      pc += 1;
      continue;
    }
    const strCmpRootLit = line.match(/^StrCmp \$1 ("(?:\\.|[^"])*") uninstall_vault_read$/);
    if (strCmpRootLit) {
      const lit = expandNsisQuotedLiteral(strCmpRootLit[1]!, env);
      if ($1 === lit) {
        return 'skip_delete';
      }
      pc += 1;
      continue;
    }
    const strCpyTailIdx = line.match(/^StrCpy \$4 \$1 1 \$(\d+)$/);
    if (strCpyTailIdx) {
      const len = strCpyTailIdx[1] === '3' ? $3 : 0;
      $4 = $1.length > len ? $1[len]! : '';
      pc += 1;
      continue;
    }
    const strCmpFourLitJump = line.match(/^StrCmp \$4 ("(?:\\.|[^"])*") 0 (\w+)$/);
    if (strCmpFourLitJump) {
      const lit = expandNsisQuotedLiteral(strCmpFourLitJump[1]!, env);
      if ($4 === lit) {
        pc += 1;
        continue;
      }
      const jump = resolveAllowlistDeleteJump(strCmpFourLitJump[2]!, labels);
      if (typeof jump === 'string') {
        return jump;
      }
      pc = jump.pc;
      continue;
    }
    const strCpyRemainder = line.match(/^StrCpy \$6 \$1 "" \$(\d+)$/);
    if (strCpyRemainder) {
      const from = strCpyRemainder[1] === '3' ? $3 : 0;
      $6 = $1.slice(from);
      pc += 1;
      continue;
    }
    const strCpyChopLead = line.match(/^StrCpy \$6 \$6 "" 1$/);
    if (strCpyChopLead) {
      $6 = $6.length > 0 ? $6.slice(1) : '';
      pc += 1;
      continue;
    }
    const strCmpTailEmpty = line.match(/^StrCmp \$6 "" uninstall_vault_read$/);
    if (strCmpTailEmpty) {
      if ($6 === '') {
        return 'skip_delete';
      }
      pc += 1;
      continue;
    }
    const gotoLine = line.match(/^Goto (\w+)$/);
    if (gotoLine) {
      const jump = resolveAllowlistDeleteJump(gotoLine[1]!, labels);
      if (typeof jump === 'string') {
        return jump;
      }
      pc = jump.pc;
      continue;
    }
    if (line === 'Nop') {
      pc += 1;
      continue;
    }
    throw new Error(`unsupported allowlist/delete VM instruction: ${line}`);
  }
  throw new Error('allowlist/delete VM exceeded step limit');
}

/** @deprecated Use executeSidecarAllowlistDeleteBlock; maps delete→allowlist_continue, skip→vault_read. */
export function executeAppDataM5GuardBlock(
  blockLines: readonly string[],
  path: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): AppDataM5GuardOutcome {
  return allowlistDeleteToLegacyAppData(executeSidecarAllowlistDeleteBlock(blockLines, path, env));
}

function runSidecarAllowlistDeleteVmFromNsh(
  path: string,
  nsh: string,
  env: SidecarNsisVarEnv,
): SidecarAllowlistDeleteOutcome {
  return executeSidecarAllowlistDeleteBlock(extractSidecarAllowlistDeleteLinesFromNsh(nsh), path, env);
}

function runAppDataM5VmFromNsh(
  path: string,
  nsh: string,
  env: SidecarNsisVarEnv,
): AppDataM5GuardOutcome {
  return allowlistDeleteToLegacyAppData(runSidecarAllowlistDeleteVmFromNsh(path, nsh, env));
}

export function locateDenyPrefixBlock(nsh: string): { start: number; end: number; lines: string[] } {
  const fileLines = nshFileLines(nsh);
  const travOkIdx = fileLines.findIndex((l) => l.trim() === DENY_PREFIX_BLOCK_ANCHOR_AFTER);
  if (travOkIdx < 0) {
    throw new Error(`${DENY_PREFIX_BLOCK_ANCHOR_AFTER} missing before deny-prefix block`);
  }
  const start = fileLines.findIndex((l, i) => i > travOkIdx && l === DENY_PREFIX_BLOCK_START_LINE);
  const end = fileLines.findIndex((l, i) => i >= start && l === DENY_PREFIX_BLOCK_END_LINE);
  if (start < 0 || end < start) {
    throw new Error('deny-prefix block ($WINDIR..$PROGRAMFILES64) missing in uninstall nsh');
  }
  const lines = fileLines.slice(start, end + 1);
  if (lines.length !== CANONICAL_DENY_PREFIX_BLOCK.length) {
    throw new Error(
      `deny-prefix block length ${lines.length} != canonical ${CANONICAL_DENY_PREFIX_BLOCK.length}`,
    );
  }
  return { start, end, lines };
}

export function extractDenyPrefixBlockLines(nsh: string): string[] {
  return locateDenyPrefixBlock(nsh).lines;
}

export function spliceDenyPrefixBlock(nsh: string, blockLines: string[]): string {
  const { start, end } = locateDenyPrefixBlock(nsh);
  const fileLines = nshFileLines(nsh);
  return [...fileLines.slice(0, start), ...blockLines, ...fileLines.slice(end + 1)].join('\n');
}

export function replaceDenyPrefixBlockLineByExact(
  nsh: string,
  exactLine: string,
  newLine: string,
  occurrence = 0,
): string {
  const { lines } = locateDenyPrefixBlock(nsh);
  let seen = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === exactLine) {
      seen += 1;
      if (seen === occurrence) {
        const next = [...lines];
        next[i] = newLine;
        return spliceDenyPrefixBlock(nsh, next);
      }
    }
  }
  throw new Error(`deny-prefix line not found (occurrence ${occurrence}): ${exactLine}`);
}

export function assertDenyPrefixBlockExact(nsh: string): void {
  assertSidecarGuardRegionExact(nsh);
}

export const APPDATA_M5_REJECT_PATHS: readonly string[] = [
  'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer',
];

/** Prefix match with backslash at $5 length and non-empty tail (Mythos APPDATA subtree delete). */
export const APPDATA_M5_PREFIX_BACKSLASH_TAIL_PATH =
  'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x';

/** Same offset backslash as Mythos APPDATA root, but prefix mismatch (:105 gate; must not delete). */
export const APPDATA_OFFSET_BACKSLASH_NON_MYTHOS_PATH =
  'C:\\Users\\me\\AppData\\Roaming\\SomeOtherApp1\\stuff';

export const DOCUMENTS_VAULT_DELETE_PATH = 'C:\\Users\\me\\Documents\\MyVault\\x';
export const DESKTOP_VAULT_DELETE_PATH = 'C:\\Users\\me\\Desktop\\MyVault\\x';
export const DOWNLOADS_VAULT_DELETE_PATH = 'C:\\Users\\me\\Downloads\\MyVault\\x';

export const APPDATA_M5_ALLOW_PATHS: readonly string[] = [
  'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x',
];

/** Isolated deny-gate paths (H-3): each row exercises one StrLen/StrCpy/StrCmp triplet. */
export const DENY_PREFIX_WINDIR_GATE_REJECT_PATH = 'C:\\Windows\\System32\\drivers';
export const DENY_PREFIX_PROGRAMFILES_GATE_REJECT_PATH = 'C:\\Program Files\\Mythos\\bin';
export const DENY_PREFIX_PROGRAMFILES64_GATE_REJECT_PATH = 'C:\\Program Files (x86)\\Mythos\\bin';

export const DENY_PREFIX_REJECT_PATHS: readonly string[] = [
  'C:\\Windows',
  'C:\\Windows\\System32',
  DENY_PREFIX_WINDIR_GATE_REJECT_PATH,
  'C:\\Program Files\\Foo',
  DENY_PREFIX_PROGRAMFILES_GATE_REJECT_PATH,
  'C:\\Program Files (x86)\\Bar',
  DENY_PREFIX_PROGRAMFILES64_GATE_REJECT_PATH,
];

export const DENY_PREFIX_ALLOW_PATHS: readonly string[] = ['C:\\Users\\vault'];

const DENY_PREFIX_GATE_LINE_COUNT = 3;

function denyPrefixGateBlock(nsh: string, gateIndex: 0 | 1 | 2): readonly string[] {
  const deny = denyBlockFromGuardRegion(extractSidecarGuardRegionForVm(nsh));
  const start = gateIndex * DENY_PREFIX_GATE_LINE_COUNT;
  return deny.slice(start, start + DENY_PREFIX_GATE_LINE_COUNT);
}

function runDenyPrefixGateVmFromNsh(
  path: string,
  nsh: string,
  gateIndex: 0 | 1 | 2,
  env: SidecarNsisVarEnv,
): DenyPrefixOutcome {
  return executeDenyPrefixBlock(denyPrefixGateBlock(nsh, gateIndex), path, env);
}

export function assertDenyPrefixRejectAllowTables(
  nsh: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): void {
  for (const path of DENY_PREFIX_REJECT_PATHS) {
    if (runTraversalVmFromNsh(path, nsh) !== 'trav_ok') {
      throw new Error(`deny-prefix table path must pass traversal first: ${JSON.stringify(path)}`);
    }
    const outcome = runDenyPrefixVmFromNsh(path, nsh, env);
    if (outcome !== 'vault_read') {
      throw new Error(`expected vault_read for deny-prefix path ${JSON.stringify(path)}, got ${outcome}`);
    }
  }
  const gateRows: ReadonlyArray<{ gate: 0 | 1 | 2; path: string }> = [
    { gate: 0, path: DENY_PREFIX_WINDIR_GATE_REJECT_PATH },
    { gate: 1, path: DENY_PREFIX_PROGRAMFILES_GATE_REJECT_PATH },
    { gate: 2, path: DENY_PREFIX_PROGRAMFILES64_GATE_REJECT_PATH },
  ];
  for (const { gate, path } of gateRows) {
    const outcome = runDenyPrefixGateVmFromNsh(path, nsh, gate, env);
    if (outcome !== 'vault_read') {
      throw new Error(
        `expected vault_read for deny-prefix gate ${gate} path ${JSON.stringify(path)}, got ${outcome}`,
      );
    }
  }
  for (const path of DENY_PREFIX_ALLOW_PATHS) {
    if (runTraversalVmFromNsh(path, nsh) !== 'trav_ok') {
      throw new Error(`deny-prefix allow path must pass traversal first: ${JSON.stringify(path)}`);
    }
    const outcome = runDenyPrefixVmFromNsh(path, nsh, env);
    if (outcome !== 'allowlist_continue') {
      throw new Error(
        `expected allowlist_continue for deny-prefix path ${JSON.stringify(path)}, got ${outcome}`,
      );
    }
  }
}

function runSidecarPathAllowlistDeleteDisposition(
  path: string,
  nsh: string,
  env: SidecarNsisVarEnv,
): SidecarAllowlistDeleteOutcome | 'blocked_at_guard' {
  const trav = runTraversalVmFromNsh(path, nsh);
  if (trav === 'vault_read') {
    return 'blocked_at_guard';
  }
  if (trav !== 'trav_ok') {
    throw new Error(`path must reach trav_ok before allowlist: ${JSON.stringify(path)}`);
  }
  if (runDenyPrefixVmFromNsh(path, nsh, env) === 'vault_read') {
    return 'blocked_at_guard';
  }
  return runSidecarAllowlistDeleteVmFromNsh(path, nsh, env);
}

export function assertSidecarAllowlistDeleteTables(
  nsh: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): void {
  const rows: ReadonlyArray<{ path: string; expected: SidecarAllowlistDeleteOutcome }> = [
    { path: APPDATA_M5_REJECT_PATHS[0]!, expected: 'skip_delete' },
    { path: APPDATA_OFFSET_BACKSLASH_NON_MYTHOS_PATH, expected: 'skip_delete' },
    { path: APPDATA_M5_PREFIX_BACKSLASH_TAIL_PATH, expected: 'delete' },
    { path: DOCUMENTS_VAULT_DELETE_PATH, expected: 'delete' },
    { path: DESKTOP_VAULT_DELETE_PATH, expected: 'delete' },
    { path: DOWNLOADS_VAULT_DELETE_PATH, expected: 'delete' },
  ];
  for (const { path, expected } of rows) {
    const disposition = runSidecarPathAllowlistDeleteDisposition(path, nsh, env);
    if (disposition === 'blocked_at_guard') {
      throw new Error(`allowlist/delete path blocked at guard: ${JSON.stringify(path)}`);
    }
    if (disposition !== expected) {
      throw new Error(
        `allowlist/delete expected ${expected} for ${JSON.stringify(path)}, got ${disposition}`,
      );
    }
  }
  for (const path of APPDATA_M5_ALLOW_PATHS) {
    const disposition = runSidecarPathAllowlistDeleteDisposition(path, nsh, env);
    if (disposition === 'blocked_at_guard') {
      throw new Error(`APPDATA allow path blocked at guard: ${JSON.stringify(path)}`);
    }
    if (disposition !== 'delete') {
      throw new Error(`expected delete for APPDATA allow path ${JSON.stringify(path)}, got ${disposition}`);
    }
  }
}

export function assertAppDataM5RejectAllowTables(
  nsh: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): void {
  assertSidecarAllowlistDeleteTables(nsh, env);
}

export type SidecarGuardPathOutcome = 'vault_read' | 'allowlist_continue';

function runSidecarGuardOutcomeOnPath(
  path: string,
  nsh: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): SidecarGuardPathOutcome {
  const trav = runTraversalVmFromNsh(path, nsh);
  if (trav === 'vault_read') {
    return 'vault_read';
  }
  if (trav !== 'trav_ok') {
    throw new Error(`guard path must reach trav_ok before deny, got ${trav}: ${JSON.stringify(path)}`);
  }
  if (runDenyPrefixVmFromNsh(path, nsh, env) === 'vault_read') {
    return 'vault_read';
  }
  const disposition = runSidecarPathAllowlistDeleteDisposition(path, nsh, env);
  if (disposition === 'blocked_at_guard') {
    return 'vault_read';
  }
  return 'allowlist_continue';
}

function parseNsisDollarEscape(quoted: string): string {
  if (quoted === '$\\n' || quoted === '"$\\n"') {
    return '\n';
  }
  if (quoted === '$\\r' || quoted === '"$\\r"') {
    return '\r';
  }
  return parseStrCmpQuotedLiteral(quoted.startsWith('"') ? quoted : `"${quoted}"`);
}

/** Trim + empty check after a simulated FileRead into $1 (Critic S13 / :46–:52). */
export function executeSidecarReadTrimFromLineContent(
  blockLines: readonly string[],
  lineContent: string,
): 'empty' | string {
  let $1 = lineContent;
  let $2 = '';
  let started = false;
  let pc = 0;
  while (pc < blockLines.length) {
    const line = blockLines[pc]!.trim();
    if (line === 'ClearErrors') {
      pc += 1;
      continue;
    }
    if (line === 'FileRead $0 $1') {
      started = true;
      pc += 1;
      continue;
    }
    if (!started) {
      if (line.startsWith('IfErrors')) {
        pc += 1;
        continue;
      }
      pc += 1;
      continue;
    }
    if (line.startsWith('IfErrors')) {
      pc += 1;
      continue;
    }
    const strCpyLast = line.match(/^StrCpy \$2 \$1 1 -1$/);
    if (strCpyLast) {
      $2 = $1.length > 0 ? $1[$1.length - 1]! : '';
      pc += 1;
      continue;
    }
    const strCpyChop = line.match(/^StrCpy \$1 \$1 -1$/);
    if (strCpyChop) {
      $1 = $1.length > 0 ? $1.slice(0, -1) : '';
      pc += 1;
      continue;
    }
    const strCmpRel = line.match(/^StrCmp \$2 ("(?:\\.|[^"])*") 0 \+(\d+)$/);
    if (strCmpRel) {
      const lit = parseNsisDollarEscape(strCmpRel[1]!);
      if ($2 === lit) {
        pc += 1;
        continue;
      }
      pc += 1 + Number(strCmpRel[2]);
      continue;
    }
    if (line === 'StrCmp $1 "" uninstall_vault_read') {
      if ($1 === '') {
        return 'empty';
      }
      pc += 1;
      continue;
    }
    if (line === 'Nop') {
      pc += 1;
      continue;
    }
    throw new Error(`unsupported read-trim VM instruction: ${line}`);
  }
  return $1 === '' ? 'empty' : $1;
}

/** Execute FileRead + newline trim chain for one simulated sidecar line (Critic S13). */
export function executeSidecarReadTrimBlock(
  blockLines: readonly string[],
  simulatedFileReadLine: string,
): 'empty' | string {
  return executeSidecarReadTrimFromLineContent(blockLines, simulatedFileReadLine);
}

export const SIDECAR_READ_TRIM_EXACT_STRING_ROWS: readonly { raw: string; trimmed: string }[] = [
  { raw: 'C:\\vault\\a\r\n', trimmed: 'C:\\vault\\a' },
  { raw: 'C:\\vault\\b\n', trimmed: 'C:\\vault\\b' },
  { raw: 'C:\\Users\\me\\vault1', trimmed: 'C:\\Users\\me\\vault1' },
];

export const SIDECAR_READ_LOOP_STEP_LIMIT = 5000;

export const SIDECAR_DELETE_READ_LOOP_ROWS: readonly {
  rawLines: readonly string[];
  expectedDeleted: readonly string[];
  expectClosed: boolean;
}[] = [
  {
    rawLines: [
      `${DOCUMENTS_VAULT_DELETE_PATH}\r\n`,
      `${DESKTOP_VAULT_DELETE_PATH}\n`,
      'C:\\Users\\me\\Documents\\vault1',
    ],
    expectedDeleted: [
      DOCUMENTS_VAULT_DELETE_PATH,
      DESKTOP_VAULT_DELETE_PATH,
      'C:\\Users\\me\\Documents\\vault1',
    ],
    expectClosed: true,
  },
];

export function simulateSidecarDeleteReadLoop(
  nsh: string,
  rawLines: readonly string[],
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): { deleted: string[]; closed: boolean; steps: number } {
  const region = extractSidecarGuardRegionForVm(nsh);
  const readBlock = readTrimBlockFromGuardRegion(region);
  const ifErrorsLine = readBlock.map((l) => l.trim()).find((l) => l.startsWith('IfErrors '));
  const ifErrorsTarget = ifErrorsLine?.slice('IfErrors '.length).trim() ?? null;
  const ifErrorsIsNop = ifErrorsLine?.trim() === 'Nop';

  let lineIndex = 0;
  const deleted: string[] = [];
  let steps = 0;
  let closed = false;

  while (steps < SIDECAR_READ_LOOP_STEP_LIMIT) {
    steps += 1;
    const eof = lineIndex >= rawLines.length;
    if (eof) {
      if (!ifErrorsIsNop && ifErrorsTarget === 'uninstall_vault_close') {
        closed = true;
        break;
      }
      if (ifErrorsIsNop || !ifErrorsTarget) {
        // :45 survivor — spin until step limit (assert tables expect canonical to close instead).
      } else {
        closed = true;
        break;
      }
    }

    const rawLine = eof ? '' : rawLines[lineIndex]!;
    if (!eof) {
      lineIndex += 1;
    }

    const trimmed = executeSidecarReadTrimFromLineContent(readBlock, rawLine);
    if (trimmed === 'empty') {
      continue;
    }
    const disposition = runSidecarPathAllowlistDeleteDisposition(trimmed, nsh, env);
    if (disposition === 'delete') {
      deleted.push(trimmed);
    }
  }

  return { deleted, closed, steps };
}

export type SidecarReadTrimGuardExpectation = 'empty' | SidecarGuardPathOutcome;

export const SIDECAR_READ_TRIM_GUARD_ROWS: readonly {
  raw: string;
  expected: SidecarReadTrimGuardExpectation;
}[] = [
  { raw: '\r\n', expected: 'empty' },
  { raw: '\n', expected: 'empty' },
  { raw: 'C:\\Users\\me\\Documents\\vault\\..\r\n', expected: 'vault_read' },
  { raw: 'C:\\Users\\me\\Documents\\vault\\..\n', expected: 'vault_read' },
  { raw: 'C:\\vault\\.\r\n', expected: 'vault_read' },
  { raw: 'C:\\vault\\..\r\n', expected: 'vault_read' },
  { raw: 'C:/vault/../note\r\n', expected: 'vault_read' },
  { raw: 'C:\\Users\\vault\r\n', expected: 'allowlist_continue' },
  { raw: 'C:\\Users\\vault\\note\n', expected: 'allowlist_continue' },
  { raw: 'C:\\a\\.hidden\\x\r\n', expected: 'allowlist_continue' },
  { raw: 'C:/v1.2/x\r\n', expected: 'allowlist_continue' },
];

/** Simulate sidecar read loop with persistent $7/$8 across non-empty lines (NSIS :53 carry-over). */
export function runSidecarMultilineGuardOutcome(
  nsh: string,
  rawLines: readonly string[],
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): SidecarGuardPathOutcome {
  const region = extractSidecarGuardRegionForVm(nsh);
  const readBlock = readTrimBlockFromGuardRegion(region);
  const travBlock = travBlockFromGuardRegion(region);
  let travRegs: TravScanRegs = { $7: 0, $8: 0 };
  let lastOutcome: SidecarGuardPathOutcome = 'allowlist_continue';
  for (const raw of rawLines) {
    const trimmed = executeSidecarReadTrimBlock(readBlock, raw);
    if (trimmed === 'empty') {
      continue;
    }
    const path = trimmed;
    const { outcome: travOutcome, regs } = executeTraversalScanBlockStateful(travBlock, path, travRegs);
    travRegs = regs;
    if (travOutcome === 'vault_read') {
      return 'vault_read';
    }
    if (travOutcome !== 'trav_ok') {
      throw new Error(`unexpected traversal outcome ${travOutcome}`);
    }
    if (runDenyPrefixVmFromNsh(path, nsh, env) === 'vault_read') {
      return 'vault_read';
    }
    const disposition = runSidecarPathAllowlistDeleteDisposition(path, nsh, env);
    if (disposition === 'blocked_at_guard') {
      return 'vault_read';
    }
    lastOutcome = 'allowlist_continue';
  }
  return lastOutcome;
}

export function assertSidecarMultilineTravGuardTables(
  nsh: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): void {
  for (const row of SIDECAR_MULTILINE_TRAV_GUARD_ROWS) {
    const outcome = runSidecarMultilineGuardOutcome(nsh, row.rawLines, env);
    if (outcome !== row.expected) {
      throw new Error(
        `multiline sidecar guard expected ${row.expected} for ${JSON.stringify(row.rawLines)}, got ${outcome}`,
      );
    }
  }
}

/** VM-driven FileRead + trim then full guard on trimmed path (S13 / :43–:52). */
export function assertSidecarReadTrimExactStringTables(nsh: string): void {
  const readBlock = readTrimBlockFromGuardRegion(extractSidecarGuardRegionForVm(nsh));
  for (const row of SIDECAR_READ_TRIM_EXACT_STRING_ROWS) {
    const trimmed = executeSidecarReadTrimBlock(readBlock, row.raw);
    if (trimmed === 'empty') {
      throw new Error(`read-trim exact expected path for raw ${JSON.stringify(row.raw)}, got empty`);
    }
    if (trimmed !== row.trimmed) {
      throw new Error(
        `read-trim exact mismatch for raw ${JSON.stringify(row.raw)}: expected ${JSON.stringify(row.trimmed)}, got ${JSON.stringify(trimmed)}`,
      );
    }
  }
}

export function assertSidecarDeleteReadLoopTables(
  nsh: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): void {
  for (const row of SIDECAR_DELETE_READ_LOOP_ROWS) {
    const result = simulateSidecarDeleteReadLoop(nsh, row.rawLines, env);
    if (result.closed !== row.expectClosed) {
      throw new Error(
        `read-loop closed=${result.closed} expected ${row.expectClosed} for ${JSON.stringify(row.rawLines)}`,
      );
    }
    if (result.steps >= SIDECAR_READ_LOOP_STEP_LIMIT) {
      throw new Error(`read-loop exceeded step limit for ${JSON.stringify(row.rawLines)}`);
    }
    const got = [...result.deleted].sort();
    const expected = [...row.expectedDeleted].sort();
    if (got.length !== expected.length || got.some((p, i) => p !== expected[i])) {
      throw new Error(
        `read-loop delete set mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`,
      );
    }
  }
}

export function assertSidecarReadTrimGuardTables(
  nsh: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): void {
  assertSidecarReadTrimExactStringTables(nsh);
  const readBlock = readTrimBlockFromGuardRegion(extractSidecarGuardRegionForVm(nsh));
  for (const row of SIDECAR_READ_TRIM_GUARD_ROWS) {
    const trimmed = executeSidecarReadTrimBlock(readBlock, row.raw);
    if (row.expected === 'empty') {
      if (trimmed !== 'empty') {
        throw new Error(
          `read-trim expected empty for raw ${JSON.stringify(row.raw)}, got ${JSON.stringify(trimmed)}`,
        );
      }
      continue;
    }
    if (trimmed === 'empty') {
      throw new Error(`read-trim expected path for raw ${JSON.stringify(row.raw)}, got empty`);
    }
    const outcome = runSidecarGuardOutcomeOnPath(trimmed, nsh, env);
    if (outcome !== row.expected) {
      throw new Error(
        `read-trim guard expected ${row.expected} for raw ${JSON.stringify(row.raw)} (trimmed ${JSON.stringify(trimmed)}), got ${outcome}`,
      );
    }
  }
}

/** Deny-prefix VM tables only (re-baseline / H6; pin excluded). */
export function assertDenyPrefixVmBehaviourTables(
  nsh: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): void {
  const gateRows: ReadonlyArray<{ gate: 0 | 1 | 2; path: string }> = [
    { gate: 0, path: DENY_PREFIX_WINDIR_GATE_REJECT_PATH },
    { gate: 1, path: DENY_PREFIX_PROGRAMFILES_GATE_REJECT_PATH },
    { gate: 2, path: DENY_PREFIX_PROGRAMFILES64_GATE_REJECT_PATH },
  ];
  for (const { gate, path } of gateRows) {
    const outcome = runDenyPrefixGateVmFromNsh(path, nsh, gate, env);
    if (outcome !== 'vault_read') {
      throw new Error(
        `expected vault_read for deny-prefix gate ${gate} path ${JSON.stringify(path)}, got ${outcome}`,
      );
    }
  }
  for (const path of DENY_PREFIX_REJECT_PATHS) {
    const outcome = runDenyPrefixVmFromNsh(path, nsh, env);
    if (outcome !== 'vault_read') {
      throw new Error(`expected vault_read for deny-prefix path ${JSON.stringify(path)}, got ${outcome}`);
    }
  }
  for (const path of DENY_PREFIX_ALLOW_PATHS) {
    const outcome = runDenyPrefixVmFromNsh(path, nsh, env);
    if (outcome !== 'allowlist_continue') {
      throw new Error(
        `expected allowlist_continue for deny-prefix path ${JSON.stringify(path)}, got ${outcome}`,
      );
    }
  }
}

/** VM behaviour tables only (no exact region pin) — Probe re-baseline sweep mode. */
export function assertSidecarGuardVmBehaviourTables(
  nsh: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): void {
  assertSidecarReadTrimGuardTables(nsh, env);
  assertSidecarDeleteReadLoopTables(nsh, env);
  assertSidecarMultilineTravGuardTables(nsh, env);
  assertTraversalRejectAllowTables(nsh);
  assertDenyPrefixVmBehaviourTables(nsh, env);
  assertSidecarAllowlistDeleteTables(nsh, env);
}

/** All sidecar guard VM tables (traversal, deny-prefix, APPDATA M5) from the pinned :53–:104 region. */
export function assertSidecarGuardRejectAllowTables(
  nsh: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): void {
  assertSidecarGuardVmBehaviourTables(nsh, env);
}

/** Trailing `\.` / `/.` at path end — backslash + forward branches (Probe H-2 :63). */
export const TRAVERSAL_REJECT_TRAILING_DOT_PATHS: readonly string[] = [
  'C:\\Users\\me\\Documents\\vault\\.',
  'C:/Users/me/Documents/vault/.',
  'D:\\data\\vault\\.',
  'D:/data/vault/.',
];

/** Trailing `\..` / `/..` at path end — both branches (Probe H-2 :68; Documents escape). */
export const TRAVERSAL_REJECT_TRAILING_DOTDOT_PATHS: readonly string[] = [
  'C:\\Users\\me\\Documents\\vault\\..',
  'C:/Users/me/Documents/vault/..',
  'C:\\Users\\me\\Documents\\vault\\..\\note',
  'C:/Users/me/Documents/vault/../note',
];

/** Leading `\..` / `/..` at offset 0 (Probe H-2 :53). */
export const TRAVERSAL_REJECT_LEADING_DOTDOT_PATHS: readonly string[] = [
  String.raw`\..\Users\me\Documents\vault`,
  '/../Users/me/Documents/vault',
];

/** Critic S12 — trailing single- and double-dot vault roots. */
export const TRAVERSAL_REJECT_S12_PATHS: readonly string[] = ['C:\\vault\\.', 'C:\\vault\\..'];

/** Critic S12 — dotted segment names and version-like paths (not traversal). */
export const TRAVERSAL_ALLOW_S12_PATHS: readonly string[] = [
  'C:\\a\\.hidden\\x',
  'C:\\a\\..b\\x',
  'C:/v1.2/x',
];

/** Mixed separator traversal (Ivy product bug :64/:69 — backslash branch must reject `/` after `\.` / `\..`). */
export const TRAVERSAL_REJECT_MIXED_SEPARATOR_PATHS: readonly string[] = [
  'C:\\Users\\me\\Documents\\../Windows',
  'Documents\\./x',
  'Documents/..\\Windows',
  'Documents/.\\x',
  String.raw`\../x`,
  String.raw`\./x`,
  '/..\\x',
  '/.\\x',
];

export const TRAVERSAL_REJECT_PATHS: readonly string[] = [
  ...TRAVERSAL_REJECT_S12_PATHS,
  ...TRAVERSAL_REJECT_MIXED_SEPARATOR_PATHS,
  'C:\\vault\\.\\note',
  'C:\\vault\\..\\note',
  'C:/vault/./note',
  'C:/vault/../note',
  'C:/vault/.',
  'C:/vault/..',
  'C:\\vault\\.',
  'C:\\vault\\..',
  String.raw`C:/vault/.\note`,
  String.raw`C:/vault/..\note`,
  String.raw`C:\vault/.\note`,
  String.raw`C:\vault/..\note`,
  ...TRAVERSAL_REJECT_TRAILING_DOT_PATHS,
  ...TRAVERSAL_REJECT_TRAILING_DOTDOT_PATHS,
  ...TRAVERSAL_REJECT_LEADING_DOTDOT_PATHS,
  String.raw`\..\x`,
  '/../x',
  'C:\\odd\\pre\\..\\post',
  'C:/odd/pre/../post',
  'C:\\a\\..\\..\\Windows',
  '...\\Documents\\..\\..\\Windows',
  'C:\\segment\\..\\peer',
  'C:/segment/../peer',
  'C:/only/../',
  'C:\\only\\..\\',
];

/** Dotted dir names that are not traversal (Probe S9 soft allows). */
export const TRAVERSAL_ALLOW_DOTTED_NAME_PATHS: readonly string[] = [
  'C:\\a\\.git',
  'C:/a/..b',
  'C:\\vault\\.a',
  'C:\\segment\\name.',
  '/.a',
];

export const TRAVERSAL_ALLOW_PATHS: readonly string[] = [
  'C:\\Users\\me\\Mythos Writer\\vaults\\x',
  'D:/data/vault',
  ...TRAVERSAL_ALLOW_DOTTED_NAME_PATHS,
  ...TRAVERSAL_ALLOW_S12_PATHS,
];

/** Long benign line then traversal — $7 must reset at StrCpy $7 0 (:53) between sidecar lines. */
export const SIDECAR_MULTILINE_TRAV_GUARD_ROWS: readonly {
  rawLines: readonly string[];
  expected: SidecarGuardPathOutcome;
}[] = [
  {
    rawLines: [
      'C:\\Users\\me\\aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\r\\n',
      'C:\\Users\\me\\Documents\\..\\Windows\\r\\n',
    ],
    expected: 'vault_read',
  },
];

/** Critic H6 — file lines for StrCpy $4 $1 $3 deny gates. */
export const DENY_PREFIX_STRCPY_ACCEPTANCE_FILE_LINES: readonly [94, 97, 100] = [94, 97, 100];

export type DenyPrefixStrcpyAcceptanceVariant =
  | 'nop'
  | 'delete'
  | 'goto_trav_inc'
  | 'reg_4_to_3'
  | 'reg_4_to_5'
  | 'reg_1_to_0'
  | 'reg_1_to_2'
  | 'reg_3_to_2'
  | 'reg_3_to_4'
  | 'len_1'
  | 'len_2'
  | 'len_0'
  | 'len_reg_5'
  | 'strcpy_4_from_5';

export const DENY_PREFIX_STRCPY_ACCEPTANCE_VARIANTS: readonly DenyPrefixStrcpyAcceptanceVariant[] = [
  'nop',
  'delete',
  'goto_trav_inc',
  'reg_4_to_3',
  'reg_4_to_5',
  'reg_1_to_0',
  'reg_1_to_2',
  'reg_3_to_2',
  'reg_3_to_4',
  'len_1',
  'len_2',
  'len_0',
  'len_reg_5',
  'strcpy_4_from_5',
];

function denyStrcpyReplacementLine(
  baseLine: string,
  variant: DenyPrefixStrcpyAcceptanceVariant,
): string | null {
  const indent = baseLine.match(/^\s*/)?.[0] ?? '        ';
  switch (variant) {
    case 'nop':
      return `${indent}Nop`;
    case 'delete':
      return null;
    case 'goto_trav_inc':
      return `${indent}Goto mythos_trav_inc`;
    case 'reg_4_to_3':
      return `${indent}StrCpy $3 $1 $3`;
    case 'reg_4_to_5':
      return `${indent}StrCpy $5 $1 $3`;
    case 'reg_1_to_0':
      return `${indent}StrCpy $4 $0 $3`;
    case 'reg_1_to_2':
      return `${indent}StrCpy $4 $2 $3`;
    case 'reg_3_to_2':
      return `${indent}StrCpy $4 $1 $2`;
    case 'reg_3_to_4':
      return `${indent}StrCpy $4 $1 $4`;
    case 'len_1':
      return `${indent}StrCpy $4 $1 1`;
    case 'len_2':
      return `${indent}StrCpy $4 $1 2`;
    case 'len_0':
      return `${indent}StrCpy $4 $1 0`;
    case 'len_reg_5':
      return `${indent}StrCpy $4 $1 $5`;
    case 'strcpy_4_from_5':
      return `${indent}StrCpy $4 $5`;
    default: {
      const _exhaustive: never = variant;
      throw new Error(`unknown deny strcpy variant: ${_exhaustive}`);
    }
  }
}

/** Critic H6 acceptance mutant on :94 / :97 / :100 StrCpy $4 $1 $3 (re-baseline deny VM must go red). */
export function mutantDenyPrefixStrcpyAcceptance(
  nsh: string,
  fileLine: 94 | 97 | 100,
  variant: DenyPrefixStrcpyAcceptanceVariant,
): string {
  const regionIndex = fileLine - SIDECAR_GUARD_REGION_FILE_LINE_FIRST;
  const { lines } = locateSidecarGuardRegion(nsh);
  const baseLine = lines[regionIndex];
  if (baseLine === undefined || !/StrCpy \$4 \$1/.test(baseLine)) {
    throw new Error(`file :${fileLine} is not a deny StrCpy $4 $1 line`);
  }
  const replacement = denyStrcpyReplacementLine(baseLine, variant);
  if (replacement === null) {
    const next = lines.filter((_, i) => i !== regionIndex);
    return spliceSidecarGuardRegion(nsh, next);
  }
  return replaceSidecarGuardRegionLine(nsh, regionIndex, replacement);
}

export function assertTraversalRejectAllowTables(nsh: string): void {
  for (const path of TRAVERSAL_REJECT_PATHS) {
    const outcome = runTraversalVmFromNsh(path, nsh);
    if (outcome !== 'vault_read') {
      throw new Error(`expected vault_read for traversal path ${JSON.stringify(path)}, got ${outcome}`);
    }
  }
  for (const path of TRAVERSAL_ALLOW_PATHS) {
    const outcome = runTraversalVmFromNsh(path, nsh);
    if (outcome !== 'trav_ok') {
      throw new Error(`expected trav_ok for traversal path ${JSON.stringify(path)}, got ${outcome}`);
    }
  }
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
  assertSidecarGuardRegionExact(nsh);
  if (executable.indexOf(TRAV_BACKSLASH_ENTRY) < 0) {
    throw new Error('backslash traversal entry missing');
  }
  if (executable.indexOf(TRAV_FWD_LABEL) < 0) {
    throw new Error('forward traversal label mythos_trav_fwd: missing');
  }
}

export const WINDIR_DENY_STRCMP = '        StrCmp $4 "$WINDIR" uninstall_vault_read 0';
export const PROGRAMFILES_DENY_STRCMP = '        StrCmp $4 "$PROGRAMFILES" uninstall_vault_read 0';
export const PROGRAMFILES64_DENY_STRCMP = '        StrCmp $4 "$PROGRAMFILES64" uninstall_vault_read 0';

export function assertWindirProgramFilesDenyBehaviourPins(nsh: string): void {
  assertSidecarGuardRegionExact(nsh);
}

/** Primary sweep mutant for one guard-region file line (:43–:104). */
export function mutantSidecarGuardRegionSweepLine(nsh: string, fileLineOneBased: number): string {
  const { lines } = locateSidecarGuardRegion(nsh);
  const regionIndex = fileLineOneBased - SIDECAR_GUARD_REGION_FILE_LINE_FIRST;
  const line = lines[regionIndex];
  if (line === undefined) {
    throw new Error(`guard region file line ${fileLineOneBased} missing`);
  }
  const trimmed = line.trim();
  if (trimmed === 'IfErrors uninstall_vault_close') {
    const indent = line.match(/^\s*/)?.[0] ?? '';
    return replaceSidecarGuardRegionLine(nsh, regionIndex, `${indent}Goto uninstall_vault_close`);
  }
  if (trimmed === 'StrCmp $2 "$\\n" 0 +2') {
    const indent = line.match(/^\s*/)?.[0] ?? '';
    return replaceSidecarGuardRegionLine(nsh, regionIndex, `${indent}StrCmp $2 "$\\r" 0 +2`);
  }
  if (trimmed === 'StrCmp $2 "$\\r" 0 +2') {
    const indent = line.match(/^\s*/)?.[0] ?? '';
    return replaceSidecarGuardRegionLine(nsh, regionIndex, `${indent}StrCmp $2 "$\\n" 0 +2`);
  }
  if (trimmed === 'FileRead $0 $1') {
    const indent = line.match(/^\s*/)?.[0] ?? '';
    return replaceSidecarGuardRegionLine(nsh, regionIndex, `${indent}Nop`);
  }
  if (/^\w+:\s*$/.test(trimmed)) {
    const indent = line.match(/^\s*/)?.[0] ?? '';
    return replaceSidecarGuardRegionLine(nsh, regionIndex, `${indent}${trimmed.replace(':', 'X:')}`);
  }
  const intOpPlus1 = line.match(/^(\s*)IntOp (\$\d+) (\$\d+) \+ 1$/);
  if (intOpPlus1) {
    return replaceSidecarGuardRegionLine(
      nsh,
      regionIndex,
      `${intOpPlus1[1]}IntOp ${intOpPlus1[2]} ${intOpPlus1[3]} + 2`,
    );
  }
  const strCpyIdx = line.match(/^(\s*)StrCpy \$4 \$1 1 \$(\d+)$/);
  if (strCpyIdx) {
    const swapped = strCpyIdx[2] === '7' ? '8' : '7';
    return replaceSidecarGuardRegionLine(
      nsh,
      regionIndex,
      `${strCpyIdx[1]}StrCpy $4 $1 1 $${swapped}`,
    );
  }
  const strCpyLen = line.match(/^(\s*)StrCpy \$4 \$1 \$(\d+)$/);
  if (strCpyLen) {
    return replaceSidecarGuardRegionLine(nsh, regionIndex, `${strCpyLen[1]}StrCpy $4 $1 1`);
  }
  const gotoScan = line.match(/^(\s*)Goto mythos_trav_scan$/);
  if (gotoScan) {
    return replaceSidecarGuardRegionLine(nsh, regionIndex, `${gotoScan[1]}Goto mythos_trav_inc`);
  }
  const indent = line.match(/^\s*/)?.[0] ?? '';
  return replaceSidecarGuardRegionLine(nsh, regionIndex, `${indent}Nop`);
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
    '\n                StrCmp $4 "/" uninstall_vault_read\n' +
    '                Goto mythos_trav_inc';
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
  return replaceDenyPrefixBlockLineByExact(nsh, WINDIR_DENY_STRCMP, '        Nop');
}

export function mutantProgramFilesDenyDrop(nsh: string): string {
  return replaceDenyPrefixBlockLineByExact(nsh, PROGRAMFILES_DENY_STRCMP, '        Nop');
}

export function mutantProgramFiles64DenyDrop(nsh: string): string {
  return replaceDenyPrefixBlockLineByExact(nsh, PROGRAMFILES64_DENY_STRCMP, '        Nop');
}

/** Shield F11 :92 — StrCpy $4 $1 $3 -> StrCpy $4 $1 1 (WINDIR deny broken). */
export function mutantF11_strcpy4Windir(nsh: string): string {
  return replaceDenyPrefixBlockLineByExact(nsh, '        StrCpy $4 $1 $3', '        StrCpy $4 $1 1', 0);
}

export function mutantF11_strcpy4ProgramFiles(nsh: string): string {
  return replaceDenyPrefixBlockLineByExact(nsh, '        StrCpy $4 $1 $3', '        StrCpy $4 $1 1', 1);
}

export function mutantF11_strcpy4ProgramFiles64(nsh: string): string {
  return replaceDenyPrefixBlockLineByExact(nsh, '        StrCpy $4 $1 $3', '        StrCpy $4 $1 1', 2);
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
