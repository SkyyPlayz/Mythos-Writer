/**
 * Session-only "Delete Everything" drain flag (SKY-8882 / Ivy appDataCleared).
 *
 * Set once APP_CLEAN_UNINSTALL fully clears vaults. Lives in process memory
 * only — a relaunch or fresh setup starts with the flag clear so settings
 * writes work again. Never touches uninstall helpers (#1633).
 */

let appDataCleared = false;

export const APP_DATA_CLEARED_SETTINGS_ERROR =
  'App data was cleared — restart Mythos Writer to continue.';

export function markAppDataCleared(): void {
  appDataCleared = true;
}

export function isAppDataCleared(): boolean {
  return appDataCleared;
}

/** Simulate process relaunch / module re-init (unit tests only). */
export function resetAppDataClearedForTests(): void {
  appDataCleared = false;
}

/**
 * Settings write-path gate. Returns null when writes are allowed; otherwise
 * the plain-text error SETTINGS_SET should return to the renderer.
 */
export function settingsWriteBlockedReason(): string | null {
  return appDataCleared ? APP_DATA_CLEARED_SETTINGS_ERROR : null;
}
