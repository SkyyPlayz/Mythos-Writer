// SKY-9730: after a "Delete Everything" clean-uninstall attempt, the story
// and notes vault roots can be in independent custom locations (see
// uninstallHelper.ts's resolveDeletePaths), so one root's delete can fail
// while the other succeeds. Decide, per root, whether that side survived —
// so the caller only re-scaffolds/reopens the side still actually on disk,
// never the side that was just successfully deleted.
import fs from 'node:fs';

export interface UninstallRecoveryPlan {
  storyVaultSurvived: boolean;
  notesVaultSurvived: boolean;
  fullyCleared: boolean;
}

export function planUninstallRecovery(
  storyVaultRoot: string,
  notesVaultRoot: string,
): UninstallRecoveryPlan {
  const storyVaultSurvived = fs.existsSync(storyVaultRoot);
  const notesVaultSurvived = fs.existsSync(notesVaultRoot);
  return {
    storyVaultSurvived,
    notesVaultSurvived,
    fullyCleared: !storyVaultSurvived && !notesVaultSurvived,
  };
}
