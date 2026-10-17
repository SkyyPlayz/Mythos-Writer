import { registerGuardRegionEquivSweep } from './sidecarOracleClassSweep.test-helpers.js';

registerGuardRegionEquivSweep([493, 494, 495], {
  493: '          StrCmp $6 "/" uninstall_vault_read',
  494: '          IntOp $7 $7 + 1',
  495: '          Goto mythos_canon_slash',
});
