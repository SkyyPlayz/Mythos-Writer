export interface StartupVaultPolicyInput {
  onboardingComplete: boolean;
  storyVaultUsable: boolean;
  notesVaultUsable: boolean;
}

/**
 * Decide whether startup may initialize/scaffold vault storage.
 *
 * When onboarding has not yet completed, do NOT initialize vault storage at
 * startup. The ONBOARDING_COMPLETE IPC handler creates exactly the directories
 * the user chose — letting startup pre-create default roots before onboarding
 * runs causes stray directories at the old default locations that persist even
 * after the user picks a different setup path (GH #536 / SKY-2157).
 *
 * Once onboarding is complete, initialize only when both configured vault roots
 * are usable. A missing root means the user's chosen folder disappeared or was
 * unmounted — startup must not silently recreate it.
 */
export function shouldInitializeVaultStorage(input: StartupVaultPolicyInput): boolean {
  if (!input.onboardingComplete) return false;
  return input.storyVaultUsable && input.notesVaultUsable;
}
