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

  it('initializes storage for first-run onboarding even when the default roots are absent', () => {
    expect(shouldInitializeVaultStorage({
      onboardingComplete: false,
      storyVaultUsable: false,
      notesVaultUsable: false,
    })).toBe(true);
  });

  it('initializes storage after onboarding when both configured roots are usable', () => {
    expect(shouldInitializeVaultStorage({
      onboardingComplete: true,
      storyVaultUsable: true,
      notesVaultUsable: true,
    })).toBe(true);
  });
});
