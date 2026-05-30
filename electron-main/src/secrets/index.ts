// Public entry point for the encrypted credential store (MYT-777).
//
// `main.ts` calls `initSecretsStore()` once on app-ready (after Electron's
// `safeStorage` becomes available) and then every callsite uses
// `getSecretsStore()` to read/write. Tests bypass the singleton and construct
// `SecretsStore` directly with an injected `SafeStorageLike` stub.

import path from 'path';
import { SecretsStore, type SafeStorageLike, type SecretId } from './store.js';

export { SecretsStore, KNOWN_SECRET_IDS } from './store.js';
export type { SafeStorageLike, SecretId, SecretsStoreOptions } from './store.js';

let singleton: SecretsStore | null = null;

export interface InitSecretsStoreOptions {
  /** Absolute path to the Electron `userData` directory. */
  userDataDir: string;
  /** Electron's `safeStorage` (injected so tests can stub). */
  safeStorage: SafeStorageLike;
}

/** Wires the process-wide singleton. Must run once before getSecretsStore(). */
export function initSecretsStore(opts: InitSecretsStoreOptions): SecretsStore {
  singleton = new SecretsStore({
    filePath: path.join(opts.userDataDir, 'secrets.json'),
    safeStorage: opts.safeStorage,
  });
  return singleton;
}

/** Returns the active store. Throws if `initSecretsStore` has not run yet. */
export function getSecretsStore(): SecretsStore {
  if (!singleton) {
    throw new Error('SecretsStore not initialized. Call initSecretsStore() during app-ready.');
  }
  return singleton;
}

/** Test-only — clears the singleton between tests so init can re-run. */
export function _resetSecretsStoreForTest(): void {
  singleton = null;
}

/** Sugar for callsites that want a no-throw read on optional fields. */
export function readSecret(id: SecretId): string {
  return getSecretsStore().get(id) ?? '';
}
