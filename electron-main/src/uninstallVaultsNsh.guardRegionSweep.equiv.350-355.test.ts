import { registerGuardRegionEquivSweep } from './sidecarOracleClassSweep.test-helpers.js';

registerGuardRegionEquivSweep([350, 354, 355], {
  350: '          StrCpy $1 $9',
  354: '            StrLen $8 $3',
  355: '            IntCmp $8 3 mythos_nr_appdata mythos_nr_appdata 0',
});
