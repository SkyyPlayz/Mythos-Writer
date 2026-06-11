export interface StartupVaultPolicyInput {
  onboardingComplete: boolean;
  storyVaultUsable: boolean;
  notesVaultUsable: boolean;
}

/**
 * Decide whether startup may initialize/scaffold vault storage.
 *
 * First-run onboarding still needs default roots to be creatable. Once
 * onboarding is complete, though, a missing or unreadable configured vault means
 * the user's chosen folder disappeared/unmounted and startup must not silently
 * recreate it.
 */
export function shouldInitializeVaultStorage(input: StartupVaultPolicyInput): boolean {
  if (!input.onboardingComplete) return true;
  return input.storyVaultUsable && input.notesVaultUsable;
}
