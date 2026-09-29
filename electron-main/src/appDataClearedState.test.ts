import { describe, it, expect, beforeEach } from 'vitest';
import {
  APP_DATA_CLEARED_SETTINGS_ERROR,
  isAppDataCleared,
  markAppDataCleared,
  resetAppDataClearedForTests,
  settingsWriteBlockedReason,
} from './appDataClearedState.js';

describe('appDataClearedState (Ivy — session-only settings write gate)', () => {
  beforeEach(() => {
    resetAppDataClearedForTests();
  });

  it('allows settings writes until markAppDataCleared', () => {
    expect(isAppDataCleared()).toBe(false);
    expect(settingsWriteBlockedReason()).toBeNull();
  });

  it('blocks settings writes after mark with a stable plain-text error', () => {
    markAppDataCleared();
    expect(isAppDataCleared()).toBe(true);
    expect(settingsWriteBlockedReason()).toBe(APP_DATA_CLEARED_SETTINGS_ERROR);
  });

  it('is session-only: reset (relaunch / fresh setup) allows writes again', () => {
    markAppDataCleared();
    expect(settingsWriteBlockedReason()).toBe(APP_DATA_CLEARED_SETTINGS_ERROR);

    // Process relaunch re-inits the module; tests simulate that with reset.
    resetAppDataClearedForTests();
    expect(isAppDataCleared()).toBe(false);
    expect(settingsWriteBlockedReason()).toBeNull();

    // A later clear in a new session blocks again.
    markAppDataCleared();
    expect(settingsWriteBlockedReason()).toBe(APP_DATA_CLEARED_SETTINGS_ERROR);
  });

  it('does not expose delete/uninstall side effects — flag is memory only', () => {
    // Guard module has no FS / uninstall imports; mark is a boolean flip.
    markAppDataCleared();
    expect(isAppDataCleared()).toBe(true);
    resetAppDataClearedForTests();
    expect(isAppDataCleared()).toBe(false);
  });
});
