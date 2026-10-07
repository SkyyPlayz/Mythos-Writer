/**
 * Vitest-only: behavioural model of mythos_trav_scan + WINDIR/PROGRAMFILES denies in uninstall-vaults.nsh.
 */

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

/** Mirrors mythos_trav_scan through uninstall_vault_trav_ok / uninstall_vault_read. */
export function mythosTravScanOutcome(path: string): TravScanOutcome {
  let pos = 0;
  while (pos < path.length) {
    const ch = path[pos];
    if (ch === '\\') {
      pos += 1;
      if (pos >= path.length) {
        return 'trav_ok';
      }
      const afterSep = path[pos];
      if (afterSep !== '.') {
        pos += 1;
        continue;
      }
      pos += 1;
      if (pos >= path.length) {
        return 'vault_read';
      }
      const afterDot = path[pos];
      if (afterDot === '\\') {
        return 'vault_read';
      }
      if (afterDot !== '.') {
        pos += 1;
        continue;
      }
      pos += 1;
      if (pos >= path.length) {
        return 'vault_read';
      }
      const afterDotDot = path[pos];
      if (afterDotDot === '\\') {
        return 'vault_read';
      }
      pos += 1;
      continue;
    }
    if (ch === '/') {
      pos += 1;
      if (pos >= path.length) {
        return 'trav_ok';
      }
      const afterSep = path[pos];
      if (afterSep !== '.') {
        pos += 1;
        continue;
      }
      pos += 1;
      if (pos >= path.length) {
        return 'vault_read';
      }
      const afterDot = path[pos];
      if (afterDot === '/' || afterDot === '\\') {
        return 'vault_read';
      }
      if (afterDot !== '.') {
        pos += 1;
        continue;
      }
      pos += 1;
      if (pos >= path.length) {
        return 'vault_read';
      }
      const afterDotDot = path[pos];
      if (afterDotDot === '/' || afterDotDot === '\\') {
        return 'vault_read';
      }
      pos += 1;
      continue;
    }
    pos += 1;
  }
  return 'trav_ok';
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

export function assertTraversalBranchBehaviourPins(nsh: string): void {
  const executable = nshExecutableLines(nsh);
  const travStart = executable.indexOf('mythos_trav_scan');
  const travOk = executable.indexOf('uninstall_vault_trav_ok:');
  if (travStart < 0 || travOk <= travStart) {
    throw new Error('mythos_trav_scan region missing');
  }
  const backBranch = extractBackslashTraversalBranch(executable);
  const fwdBranch = extractForwardTraversalBranch(executable);

  const dotCheckAt = backBranch.indexOf(NSH_BACKSLASH_DOT_CHECK);
  if (dotCheckAt < 0) {
    throw new Error('backslash branch missing StrCmp $4 "." after separator');
  }
  const backslashRejects = [...backBranch.matchAll(/StrCmp \$4 "\\" uninstall_vault_read/g)];
  if (backslashRejects.length < 2) {
    throw new Error('backslash branch must reject .\\ and ..\\ via StrCmp $4 "\\" uninstall_vault_read');
  }
  const firstRejectAt = backBranch.indexOf(NSH_BACKSLASH_DOT_BACKSLASH_REJECT);
  const secondRejectAt = backBranch.indexOf(NSH_BACKSLASH_DOT_BACKSLASH_REJECT, firstRejectAt + 1);
  if (firstRejectAt <= dotCheckAt || secondRejectAt <= firstRejectAt) {
    throw new Error('backslash .\\ / ..\\ rejects must follow the dot check inside the branch');
  }
  const emptyRejectAt = backBranch.indexOf(NSH_BACKSLASH_DOT_DOT_EMPTY_REJECT, dotCheckAt);
  if (emptyRejectAt < 0 || emptyRejectAt > firstRejectAt) {
    throw new Error('backslash branch must StrCmp empty to uninstall_vault_read before .\\ reject');
  }

  const fwdSlashEntry = backBranch.includes(TRAV_BACKSLASH_ENTRY);
  if (!fwdSlashEntry) {
    throw new Error('backslash entry missing');
  }
  if (fwdBranch.indexOf('StrCmp $4 "/" 0 mythos_trav_inc') < 0) {
    throw new Error('forward branch missing StrCmp $4 "/" 0 mythos_trav_inc');
  }
  const fwdDotCheckAt = fwdBranch.indexOf('StrCmp $4 "." 0 mythos_trav_inc');
  if (fwdDotCheckAt < 0) {
    throw new Error('forward branch missing dot segment check after /');
  }
  if (!fwdBranch.includes(NSH_FWD_DOT_SLASH_REJECT)) {
    throw new Error('forward branch missing ./ reject (StrCmp $4 "/" uninstall_vault_read)');
  }
  if (!fwdBranch.includes(NSH_FWD_DOT_BACKSLASH_REJECT)) {
    throw new Error('forward branch missing .\\ reject after / branch');
  }
  const fwdSlashRejects = fwdBranch.match(/StrCmp \$4 "\/" uninstall_vault_read/g) ?? [];
  if (fwdSlashRejects.length < 2) {
    throw new Error('forward branch must reject ./ and ../ via StrCmp $4 "/" uninstall_vault_read');
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
