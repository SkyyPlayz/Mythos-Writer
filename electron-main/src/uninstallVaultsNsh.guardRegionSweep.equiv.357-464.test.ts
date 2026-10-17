import { registerGuardRegionEquivSweep } from './sidecarOracleClassSweep.test-helpers.js';

registerGuardRegionEquivSweep([357, 463, 464], {
  357: '            Goto mythos_nr_strip',
  463: '            StrCpy $9 $1',
  464: '            Goto mythos_reparse_walk',
});
