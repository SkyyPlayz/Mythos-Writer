import { describe, expect, it } from 'vitest';
import { shouldInitializeVaultStorage } from './startupVaultPolicy.js';

describe('shouldInitializeVaultStorage', () => {
  it('does not initialize missing or unreadable vault roots after onboarding has completed', () => {
    expect(shouldInitializeVaultStorage({
      onboardingComplete: true,
      storyVaultUsable: false,
      notesVaultUsable: true,
    })).toBe(false);

    expect(shouldInitializeVaultStorage({
      onboardingComplete: true,
      storyVaultUsable: true,
      notesVaultUsable: false,
    })).toBe(false);
  });

  it('does NOT initialize storage before onboarding completes (SKY-2157: prevents stray default dirs)', () => {
    // Startup must NOT pre-create vault dirs before the user has chosen a setup
    // path. The ONBOARDING_COMPLETE handler creates exactly what the user picked.
    // Initialising here caused ~/Mythos/Story Vault + ~/Mythos/Notes Vault to
    // appear even when the user later chose the default-mythos-vault nested layout.
    expect(shouldInitializeVaultStorage({
      onboardingComplete: false,
      storyVaultUsable: false,
      notesVaultUsable: false,
    })).toBe(false);

    expect(shouldInitializeVaultStorage({
      onboardingComplete: false,
      storyVaultUsable: true,
      notesVaultUsable: true,
    })).toBe(false);
  });

  it('initializes storage after onboarding when both configured roots are usable', () => {
    expect(shouldInitializeVaultStorage({
      onboardingComplete: true,
      storyVaultUsable: true,
      notesVaultUsable: true,
    })).toBe(true);
  });
});
