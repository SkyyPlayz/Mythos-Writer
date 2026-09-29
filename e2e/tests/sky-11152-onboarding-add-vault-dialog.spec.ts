/**
 * sky-11152-onboarding-add-vault-dialog.spec.ts
 *
 * F3#9 retired this file's OnboardingWizard `screen-welcome` / step3-* ACs.
 * Vault setup now lives on WelcomeOverlay (see f3-welcome-overlay-vault-setup.spec.ts
 * and onboarding-four-paths.spec.ts). Kept as skip stubs so the old AC ids stay discoverable.
 */

import { test } from '@playwright/test';

const RETIRED = 'F3#9 — OnboardingWizard deleted; covered by WelcomeOverlay fresh-profile specs';

test.describe('SKY-11152 first-run (retired — WelcomeOverlay)', () => {
  test('AC-OB3-01: name+destination preview', async () => {
    test.skip(true, RETIRED);
  });
  test('AC-OB3-02: import Notes/Story rows', async () => {
    test.skip(true, RETIRED);
  });
  test('AC-OB3-03: import one-is-enough copy', async () => {
    test.skip(true, RETIRED);
  });
  test('AC-OB3-04: import creates NEW vault', async () => {
    test.skip(true, RETIRED);
  });
});
