import { describe, it, expect } from 'vitest';

import { loadUninstallVaultsNsh } from './uninstallVaultsNsh.path.js';
import { sidecarGuardModeTwoFailure } from './sidecarOracleMutants.test-helpers.js';

const nsh = loadUninstallVaultsNsh();
const fileLines = nsh.split('\n');

/** Replace whole file lines (1-based, original indent kept); a replacement may span several lines. */
function withLines(edits: Readonly<Record<number, string | readonly string[]>>): string {
  return fileLines
    .flatMap((line, i) => {
      const edit = edits[i + 1];
      if (edit === undefined) {
        return [line];
      }
      const indent = line.match(/^\s*/)?.[0] ?? '';
      return (typeof edit === 'string' ? [edit] : edit).map((l) => `${indent}${l}`);
    })
    .join('\n');
}

/** Pin-free (mode 2) failure that is about behaviour, not the VM refusing an instruction. */
function behaviourFailure(mutant: string): string {
  const failure = sidecarGuardModeTwoFailure(mutant, nsh);
  expect(failure, 'mutant passes the pin-free VM tables').toBeDefined();
  expect(failure).not.toMatch(/unsupported|unknown .*target|is not a /);
  return failure!;
}

const ROOT_GUARDS = [
  { root: 'APPDATA', boundary: 188, emptyChild: 191, next: 'mythos_al_not_appdata' },
  { root: 'DOCUMENTS', boundary: 206, emptyChild: 209, next: 'mythos_al_not_documents' },
  { root: 'DESKTOP', boundary: 224, emptyChild: 227, next: 'mythos_al_not_desktop' },
  { root: 'Downloads', boundary: 242, emptyChild: 245, next: 'mythos_al_deny' },
] as const;

describe('allowlist root guards — a Nop on any of the 8 is caught pin-free (mode 2)', () => {
  it('negative control — canonical passes the pin-free VM tables', () => {
    expect(sidecarGuardModeTwoFailure(nsh, nsh)).toBeUndefined();
  });

  for (const g of ROOT_GUARDS) {
    it(`:${g.boundary} ${g.root} boundary \`StrCmp $4 "\\" 0 ${g.next}\``, () => {
      expect(fileLines[g.boundary - 1]!.trim()).toBe(`StrCmp $4 "\\" 0 ${g.next}`);
      expect(behaviourFailure(withLines({ [g.boundary]: 'Nop' }))).toMatch(
        /allowlist root guard|fcfb /,
      );
    });
    it(`:${g.emptyChild} ${g.root} empty child \`StrCmp $6 "" uninstall_vault_read\``, () => {
      expect(fileLines[g.emptyChild - 1]!.trim()).toBe('StrCmp $6 "" uninstall_vault_read');
      expect(behaviourFailure(withLines({ [g.emptyChild]: 'Nop' }))).toMatch(
        /allowlist root guard|fcfb /,
      );
    });
  }
});

const PATH_CALL = 'System::Call "kernel32::GetFullPathNameW(w r1, i ${NSIS_MAX_STRLEN}, w .r3, p 0) i .r4"';
const ROOT_CALL = 'System::Call "kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r9, p 0) i .r4"';
const DENY_ROOT_CALL = 'System::Call "kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r5, p 0) i .r4"';
const ZERO_CHECK = 'IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0';
const TRUNC_CHECK = 'IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read';

const GATE_LINES: Readonly<Record<number, string>> = {
  140: PATH_CALL,
  141: ZERO_CHECK,
  142: TRUNC_CHECK,
  147: DENY_ROOT_CALL,
  148: ZERO_CHECK,
  149: TRUNC_CHECK,
  250: PATH_CALL,
  256: ROOT_CALL,
  262: 'StrLen $8 $9',
  264: 'StrCmp $6 $9 0 uninstall_vault_read',
  266: 'StrCmp $6 "\\" 0 uninstall_vault_read',
  269: 'StrCmp $6 "" uninstall_vault_read',
};

/** Ivy's System::Call / containment mutants of the GetFullPathNameW gate. */
const GATE_MUTANTS: readonly { name: string; edits: Readonly<Record<number, string | readonly string[]>> }[] = [
  { name: 'path buffer too small (i 16)', edits: { 250: PATH_CALL.replace('${NSIS_MAX_STRLEN}', '16') } },
  { name: 'first GFPN buffer too small (i 16)', edits: { 140: PATH_CALL.replace('${NSIS_MAX_STRLEN}', '16') } },
  { name: 'truncation bound below the buffer (16)', edits: { 142: TRUNC_CHECK.replace('${NSIS_MAX_STRLEN}', '16') } },
  { name: 'path 0 return falls through', edits: { 141: 'IntCmp $4 0 0 uninstall_vault_read 0' } },
  {
    name: 'path error goes to delete',
    edits: { 141: 'IntCmp $4 0 uninstall_vault_do_delete uninstall_vault_do_delete 0' },
  },
  { name: 'path truncated return falls through', edits: { 142: 'IntCmp $4 ${NSIS_MAX_STRLEN} 0 0 0' } },
  {
    name: 'path truncated return goes to delete',
    edits: { 142: 'IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_do_delete 0 uninstall_vault_do_delete' },
  },
  { name: 'WINDIR 0 return falls through', edits: { 148: 'IntCmp $4 0 0 uninstall_vault_read 0' } },
  { name: 'WINDIR truncated return falls through', edits: { 149: 'IntCmp $4 ${NSIS_MAX_STRLEN} 0 0 0' } },
  {
    name: 'root canonicalisation removed (compare against the raw $5)',
    edits: { 262: 'StrLen $8 $5', 264: 'StrCmp $6 $5 0 uninstall_vault_read' },
  },
  { name: 'root GetFullPathNameW replaced by a copy of $5', edits: { 256: 'StrCpy $9 $5' } },
  {
    name: 'path canonicalisation removed (compare the raw $1)',
    edits: { 250: 'StrCpy $3 $1', 251: 'Nop', 252: 'Nop' },
  },
  {
    name: 'prefix compare cut by one char',
    edits: { 264: ['StrCpy $6 $6 -1', 'StrCpy $9 $9 -1', 'StrCmp $6 $9 0 uninstall_vault_read'] },
  },
  { name: 'strictly deeper relaxed to >= (an empty child passes)', edits: { 269: 'Nop' } },
  { name: 'trailing `\\` after the root dropped', edits: { 266: 'Nop' } },
  { name: 'case folding dropped (StrCmpS)', edits: { 264: 'StrCmpS $6 $9 0 uninstall_vault_read' } },
];

describe('GetFullPathNameW gate — System::Call and containment mutants are caught pin-free (mode 2)', () => {
  it('the gate lines these mutants edit are where the table says', () => {
    for (const [line, text] of Object.entries(GATE_LINES)) {
      expect(fileLines[Number(line) - 1]!.trim(), `:${line}`).toBe(text);
    }
  });

  for (const { name, edits } of GATE_MUTANTS) {
    it(`${name} (${Object.keys(edits).map((l) => `:${l}`).join(' ')})`, () => {
      behaviourFailure(withLines(edits));
    });
  }
});
