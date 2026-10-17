import { registerGuardRegionEquivSweep } from './sidecarOracleClassSweep.test-helpers.js';

registerGuardRegionEquivSweep([467, 473, 480], {
  467: '          IntOp $7 $8 + 1',
  473: '          Goto mythos_reparse_next',
  480: '          IntOp $7 $7 + 1',
});
