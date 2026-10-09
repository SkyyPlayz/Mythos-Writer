import { describe, expect, it } from 'vitest';

import {
  mutantSidecarIntCmpMaxTgt3To0,
  SIDECAR_NSIS_LONG_DOCUMENTS_ROOT,
  SIDECAR_TGT3_MAXLEN_SPECS,
  sidecarHardADeleted,
  simulateSidecarDeleteReadLoop,
} from './sidecarTraversalScan.test-helpers.js';
import {
  nsisTruncatedPrefix,
  SIDECAR_NSIS_ENV_E1,
  SIDECAR_NSIS_MAX_STRLEN,
} from './sidecarNsisVm.test-helpers.js';
import { loadUninstallVaultsNsh } from './uninstallVaultsNsh.path.js';

const nsh = loadUninstallVaultsNsh();
const fileLines = nsh.split('\n');

describe('tgt3->0 MAX-length checks (required size > NSIS_MAX_STRLEN)', () => {
  it(`pins ${SIDECAR_TGT3_MAXLEN_SPECS.length} GLP MAX IntCmp sites`, () => {
    expect(SIDECAR_TGT3_MAXLEN_SPECS).toHaveLength(12);
    expect(SIDECAR_NSIS_LONG_DOCUMENTS_ROOT.length).toBeGreaterThan(SIDECAR_NSIS_MAX_STRLEN);
    for (const spec of SIDECAR_TGT3_MAXLEN_SPECS) {
      expect(fileLines[spec.intCmpLine - 1]!.trim()).toMatch(
        /^IntCmp \$4 \$\{NSIS_MAX_STRLEN\} uninstall_vault_read 0 uninstall_vault_read$/,
      );
      expect(fileLines[spec.callLine - 1]!).toContain('GetLongPathNameW');
    }
  });

  for (const spec of SIDECAR_TGT3_MAXLEN_SPECS) {
    it(`:${spec.intCmpLine} ${spec.name} oversize keeps folder and never deletes truncated path`, () => {
      const truncated = nsisTruncatedPrefix(spec.path);
      const deleted = simulateSidecarDeleteReadLoop(nsh, [`${spec.path}\r\n`], SIDECAR_NSIS_ENV_E1, spec.options)
        .deleted;
      expect(deleted, spec.name).toEqual([]);
      expect(deleted, spec.name).not.toContain(truncated);
      expect(deleted, spec.name).not.toContain(spec.path);
    });

    it(`:${spec.intCmpLine} ${spec.name} tgt3->0 is live on oversize (mutant deletes or differs)`, () => {
      const mutant = mutantSidecarIntCmpMaxTgt3To0(nsh, spec.intCmpLine);
      expect(mutant).not.toBe(nsh);
      const row = {
        name: spec.name,
        path: spec.path,
        env: SIDECAR_NSIS_ENV_E1,
        expect: 'skip' as const,
        options: spec.options,
        mustNotDelete: [spec.path, nsisTruncatedPrefix(spec.path)],
      };
      expect(sidecarHardADeleted(nsh, row)).toEqual([]);
      const mutantDeleted = sidecarHardADeleted(mutant, row);
      expect(mutantDeleted.join('\0'), `${spec.name} tgt3->0 must not stay identity`).not.toBe('');
    });
  }
});
