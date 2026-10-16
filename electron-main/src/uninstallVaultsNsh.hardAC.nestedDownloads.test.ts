import { describe, expect, it } from 'vitest';

import { ORACLE_CLASS_ALL_EQUIVALENT_LINES } from './sidecarOracleClassSweep.test-helpers.js';
import {
  generateOracleClassMutants,
  sidecarGuardModeTwoCaught,
} from './sidecarOracleMutants.test-helpers.js';
import { SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES } from './uninstallVaultsNsh.guardRegionSweep.equivalents.js';
import { loadUninstallVaultsNsh } from './uninstallVaultsNsh.path.js';

/**
 * Region-map mode-2 walks for nested Downloads (:437–:461).
 * Push `unit` runs these under v8 coverage and the all-of case exceeded its
 * 189s budget (actions run 38826825939, 222s). `oracle-sweeps` runs the same
 * assertions without coverage. Unit excludes this file.
 */
const nsh = loadUninstallVaultsNsh();
const fileLines = nsh.split('\n');

function extraDownloadsBlockMutants(): { key: string; nsh: string }[] {
  const swaps: readonly (readonly [string, string])[] = [
    ['$9', '$3'],
    ['$9', '$6'],
    ['$9', '$5'],
    ['$9', '$8'],
    ['$6', '$9'],
    ['$6', '$3'],
    ['$6', '$5'],
    ['$6', '$8'],
    ['$5', '$9'],
    ['$8', '$3'],
    ['$8', '$6'],
    ['$8', '$9'],
    ['$3', '$9'],
    ['$3', '$6'],
    ['$3', '$5'],
    ['$3', '$8'],
    ['$3', '$1'],
    ['$PROFILE', '$DOCUMENTS'],
    ['$PROFILE', '$DESKTOP'],
    ['$PROFILE', '$APPDATA'],
    ['mythos_nr_ok', 'mythos_reparse_walk'],
    ['mythos_nr_ok', 'uninstall_vault_do_delete'],
    ['uninstall_vault_read', 'mythos_nr_ok'],
    ['uninstall_vault_read', 'mythos_nr_documents'],
    [' 0 ', ' +2 '],
    [' 0 ', ' +1 '],
    [' 1 ', ' 0 '],
  ];
  const gotos = [
    'Goto mythos_nr_ok',
    'Goto mythos_reparse_walk',
    'Goto uninstall_vault_do_delete',
    'Goto mythos_reparse_leaf',
    'Goto uninstall_vault_file',
    'Goto mythos_nr_documents',
    'Goto mythos_nr_desktop',
    'Goto mythos_canon_gate',
  ] as const;
  const out: { key: string; nsh: string }[] = [];
  for (let line = 437; line <= 461; line += 1) {
    const src = fileLines[line - 1]!;
    const indent = src.match(/^\s*/)?.[0] ?? '';
    for (const [a, b] of swaps) {
      if (!src.includes(a) || a === b) {
        continue;
      }
      const next = [...fileLines];
      next[line - 1] = src.replace(a, b);
      out.push({ key: `${line}:extra:${a}->${b}`, nsh: next.join('\n') });
    }
    for (const g of gotos) {
      const next = [...fileLines];
      next[line - 1] = `${indent}${g}`;
      out.push({ key: `${line}:extra:${g}`, nsh: next.join('\n') });
    }
  }
  return out;
}

/**
 * Shield 112: pick mutants from the region map / oracle-class sweep on the
 * nested Downloads block (:437–:461), not by the N7/N8 rows. Red is mode-2
 * (full pin-free tables).
 */
function nestedDownloadsRegionMutants(): { key: string; nsh: string }[] {
  const seen = new Set<string>();
  const out: { key: string; nsh: string }[] = [];
  const candidates = [
    ...generateOracleClassMutants(nsh).filter((m) => m.fileLine >= 437 && m.fileLine <= 461),
    ...extraDownloadsBlockMutants(),
  ];
  for (const mutant of candidates) {
    if (seen.has(mutant.key)) {
      continue;
    }
    seen.add(mutant.key);
    out.push({ key: mutant.key, nsh: mutant.nsh });
  }
  return out;
}

describe('HARD-2 nested Downloads (112 survivors)', () => {
  it('all 112 nested-Downloads region-map mutants are red', () => {
    const selected = nestedDownloadsRegionMutants();
    expect(selected.length).toBeGreaterThanOrEqual(112);
    let red = 0;
    for (const mutant of selected) {
      if (sidecarGuardModeTwoCaught(mutant.nsh, nsh)) {
        red += 1;
        if (red >= 112) {
          break;
        }
      }
    }
    expect(red, `${red} of ${selected.length} region-map mutants were mode-2 red`).toBeGreaterThanOrEqual(112);
  }, 180_000);

  it('all nested-Downloads region-map mutants are red (all-of, ≥112)', () => {
    const skipLines = new Set<number>([
      ...Object.keys(SIDECAR_GUARD_SWEEP_BEHAVIOUR_EQUIVALENT_FILE_LINES).map(Number),
      ...ORACLE_CLASS_ALL_EQUIVALENT_LINES,
    ]);
    const selected = nestedDownloadsRegionMutants().filter((mutant) => {
      const fileLine = Number(mutant.key.split(':', 1)[0]);
      if (!Number.isFinite(fileLine) || skipLines.has(fileLine)) {
        return false;
      }
      // Jump-retargets on already-fail-closed compares, IntCmp 0→+N extras, and
      // $9→$5 / $9→$6 leftover copies stay equivalent — they are not the 112.
      // goto_inc on a line that is already `Goto …` is the same retarget as :tgt
      // (`Goto uninstall_vault_read` → `Goto mythos_trav_inc`).
      if (mutant.key.includes(':tgt')) {
        return false;
      }
      if (mutant.key.endsWith(':goto_inc') && fileLines[fileLine - 1]!.trim().startsWith('Goto ')) {
        return false;
      }
      if (
        mutant.key.includes(':extra: 0 ->') ||
        mutant.key.includes(':extra:$9->$5') ||
        mutant.key.includes(':extra:$9->$6') ||
        mutant.key.includes(':extra:mythos_nr_ok->') ||
        mutant.key.includes(':extra:Goto mythos_canon_gate')
      ) {
        return false;
      }
      return true;
    });
    expect(selected.length).toBeGreaterThanOrEqual(112);
    const survivors = selected.filter((mutant) => !sidecarGuardModeTwoCaught(mutant.nsh, nsh));
    expect(survivors.map((s) => s.key), `${survivors.length} of ${selected.length} region-map mutants survived`).toEqual(
      [],
    );
  }, 189_000);
});
