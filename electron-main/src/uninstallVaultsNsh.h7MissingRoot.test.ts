import { describe, expect, it } from 'vitest';

import { sidecarHardADeleted } from './sidecarTraversalScan.test-helpers.js';
import { loadUninstallVaultsNsh } from './uninstallVaultsNsh.path.js';
import {
  H7_LESS_DESTS,
  H7_LESS_SITES,
  SIDECAR_H7_MISSING_ROOT_ROWS,
  h7LessMutants,
  h7MutantKillHits,
} from './sidecarH7MissingRoot.test-helpers.js';

const nsh = loadUninstallVaultsNsh();
const fileLines = nsh.split('\n');
const mutants = h7LessMutants(nsh);

describe('H7 missing-root fallback IntCmp less-branch', () => {
  it('pins all eight missing-root GFA IntCmp $4 0 h3 h3 0 lines', () => {
    expect(H7_LESS_SITES.map((s) => s.fileLine)).toEqual([546, 551, 556, 561, 566, 571, 576, 581]);
    for (const site of H7_LESS_SITES) {
      expect(fileLines[site.fileLine - 1]!.trim(), `:${site.fileLine}`).toBe(
        `IntCmp $4 0 ${site.h3} ${site.h3} 0`,
      );
    }
    expect(H7_LESS_DESTS).toEqual([
      'uninstall_vault_do_delete',
      'mythos_reparse_walk',
      'mythos_nr_ok',
      '+2',
      '+4',
      '+6',
    ]);
    expect(mutants).toHaveLength(H7_LESS_SITES.length * H7_LESS_DESTS.length);
  });

  it(`canonical keeps or deletes on each of ${SIDECAR_H7_MISSING_ROOT_ROWS.length} H7 rows`, () => {
    expect(SIDECAR_H7_MISSING_ROOT_ROWS.length).toBeGreaterThanOrEqual(32);
    for (const id of ['5a', '5d', '5k', '5l', '9a', '9d', '9k', '9l'] as const) {
      const rows = SIDECAR_H7_MISSING_ROOT_ROWS.filter((r) => r.name.startsWith(`H7 ${id} `));
      expect(rows.some((r) => r.name.includes('junction vault')), `${id} junction`).toBe(true);
      expect(rows.some((r) => r.name.includes('parent junction')), `${id} parent junction`).toBe(true);
      expect(rows.some((r) => r.name.includes('nested Downloads exact')), `${id} Downloads exact`).toBe(true);
      expect(rows.some((r) => r.name.includes('nested Downloads ancestor')), `${id} Downloads ancestor`).toBe(
        true,
      );
    }
    for (const row of SIDECAR_H7_MISSING_ROOT_ROWS) {
      const deleted = sidecarHardADeleted(nsh, row);
      if (row.expect === 'skip') {
        expect(deleted, row.name).toEqual([]);
      } else {
        expect(deleted, row.name).toHaveLength(1);
      }
      for (const ban of row.mustNotDelete ?? []) {
        expect(deleted, row.name).not.toContain(ban);
      }
    }
  });

  it('every less-branch retarget is red on at least one H7 row (all-of)', () => {
    const survivors: string[] = [];
    const listing: string[] = [];
    for (const mutant of mutants) {
      const hits = h7MutantKillHits(mutant.nsh, nsh);
      if (hits.length === 0) {
        survivors.push(mutant.key);
        listing.push(`${mutant.key} SURVIVE`);
        continue;
      }
      const first = hits[0]!;
      listing.push(
        `${mutant.key} KILL via ${first.via} ${first.row} ${JSON.stringify(first.canonical)} → ${JSON.stringify(first.mutant)}`,
      );
    }
    expect(listing, listing.join('\n')).toHaveLength(mutants.length);
    expect(survivors, `H7 less-branch survivors:\n${survivors.join('\n')}`).toEqual([]);
    for (const line of listing) {
      expect(line, line).toContain(' KILL ');
    }
    // Visible in --reporter=verbose so PROOF can paste the 48-mutant kill list.
    console.log(`H7 less-branch kill list (${listing.length}):\n${listing.join('\n')}`);
  }, 60_000);
});
