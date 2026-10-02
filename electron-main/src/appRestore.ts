/**
 * App-data restore + post-restore settings reload (KEYS-B / PB9b).
 *
 * The IPC handler `app:restoreAppData` delegates here after the open-dialog
 * resolves. Restore itself only writes archive bytes (never the secret store).
 * The post-restore `loadAppSettingsFrom` may run the slice2 flag write — that
 * path is JSON-only under S-B11 so stored keys survive a pre-0.5.4 archive.
 *
 * Pre-KEYS-B main ran `try { restoreAppData(...) } finally { ensureVaultDir(); }`
 * so ensureVaultDir ran even when restore threw. afterExtract must stay in a
 * `finally` for the same parity (missing archive, bad header, schema mismatch,
 * zip-slip).
 */

import path from 'path';
import { loadAppSettingsFrom } from './appSettingsLoad.js';
import { restoreAppData, type RestoreOptions, type RestoreResult } from './backup.js';
import type { SecretsStore } from './secrets/store.js';

export interface RestoreAppDataAndReloadOptions extends RestoreOptions {
  /** Injected so tests and main share one path. */
  getStore: () => SecretsStore;
  /**
   * Optional settings path override (defaults to `<userDataPath>/app-settings.json`).
   * Main always uses the default.
   */
  settingsPath?: string;
  /**
   * Called after restore attempts extract — mirrors main's
   * `finally { ensureVaultDir() }` so it runs on throw too. Settings reload
   * stays gated on `result.restored` after a successful restore.
   */
  afterExtract?: () => void;
}

/**
 * Production restore body used by `app:restoreAppData`.
 * Rule: never writes to the secret store. Slice2 / heal side-effects of the
 * post-restore load are JSON-only (S-B11).
 *
 * K-B16: after this reload, calling saveAppSettingsTo with the on-disk
 * JSON (empty key fields from a redacted archive) must fail PB9b(a).
 */
export async function restoreAppDataAndReloadSettings(
  opts: RestoreAppDataAndReloadOptions,
): Promise<RestoreResult> {
  let result: RestoreResult | undefined;
  try {
    result = await restoreAppData({
      archivePath: opts.archivePath,
      userDataPath: opts.userDataPath,
      storyVaultRoot: opts.storyVaultRoot,
      notesVaultRoot: opts.notesVaultRoot,
      overwrite: opts.overwrite,
    });
  } finally {
    // Parity with pre-KEYS-B `finally { ensureVaultDir() }` — runs on throw too.
    try {
      opts.afterExtract?.();
    } catch {
      /* ensureVaultDir may throw when app data cleared; match main best-effort */
    }
  }

  // Restore threw → exception already rethrown after finally; result is set.
  if (result!.restored) {
    const settingsPath =
      opts.settingsPath ?? path.join(opts.userDataPath, 'app-settings.json');
    // S-B11: loadAppSettingsFrom writes the slice2 flag JSON-only when needed.
    // Do NOT re-save through the secret saver here — empty key fields from a
    // redacted archive would wipe the secret store (Probe wipe / K-B16).
    loadAppSettingsFrom(settingsPath, opts.getStore);
  }

  return result!;
}
