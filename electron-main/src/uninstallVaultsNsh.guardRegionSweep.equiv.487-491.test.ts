import { registerGuardRegionEquivSweep } from './sidecarOracleClassSweep.test-helpers.js';

registerGuardRegionEquivSweep([487, 489, 491], {
  487: '          Goto uninstall_vault_do_delete',
  489: '          StrCpy $7 0',
  491: '          StrCpy $6 $3 1 $7',
});
