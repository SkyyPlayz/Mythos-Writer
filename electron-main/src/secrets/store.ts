// Encrypted-at-rest credential store for BYO-provider API keys (MYT-777).
//
// Wraps Electron `safeStorage` to keep raw API keys out of `app-settings.json`.
// Every secret is encrypted individually with safeStorage.encryptString and
// stored as base64 ciphertext in `<userData>/secrets.json`. The renderer can
// only retrieve a masked preview via the IPC settings handler — the plaintext
// never leaves the main process.
//
// The store is intentionally decoupled from `electron` so it can be unit
// tested without booting an Electron app. The wiring in `index.ts` injects
// the real safeStorage at runtime; tests inject a stub.

import fs from 'fs';
import path from 'path';

// Known secret identifiers. Adding a new key here makes the store aware of it
// for `listKnownIds()` and the migration walker — values for unknown IDs are
// still accepted, but won't be surfaced to those helpers.
export type SecretId =
  | 'anthropic.apiKey' // legacy AppSettings.apiKey field
  | 'provider.apiKey' // MYT-324 multi-provider AppSettings.provider.apiKey
  | 'voice.openaiApiKey'; // MYT-424 Whisper cloud fallback

export const KNOWN_SECRET_IDS: readonly SecretId[] = [
  'anthropic.apiKey',
  'provider.apiKey',
  'voice.openaiApiKey',
];

/** Minimal slice of Electron.safeStorage the store relies on. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plaintext: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** On-disk shape of `<userData>/secrets.json`. v1 = a flat id→ciphertext map. */
interface SecretsFile {
  /** Schema version. Bumped whenever the on-disk layout changes. */
  v: 1;
  /** id → base64-encoded ciphertext produced by safeStorage.encryptString. */
  values: Record<string, string>;
}

const FILE_VERSION = 1;

export interface SecretsStoreOptions {
  /** Absolute path to the on-disk ciphertext file. Usually `<userData>/secrets.json`. */
  filePath: string;
  /** Electron safeStorage (or test stub). */
  safeStorage: SafeStorageLike;
}

/**
 * File-backed credential store. Reads/writes are write-through to disk; the
 * in-memory cache is invalidated only by `reload()`. Throws if safeStorage
 * encryption is unavailable on the host — callers should surface that as
 * "keys cannot be persisted" rather than silently writing plaintext.
 */
export class SecretsStore {
  private readonly filePath: string;
  private readonly safeStorage: SafeStorageLike;
  private cache: Map<string, string> | null = null;

  constructor(opts: SecretsStoreOptions) {
    this.filePath = opts.filePath;
    this.safeStorage = opts.safeStorage;
  }

  /** True iff safeStorage can encrypt on this host. */
  isAvailable(): boolean {
    return this.safeStorage.isEncryptionAvailable();
  }

  /** Returns the plaintext secret, or null when no value is stored. */
  get(id: SecretId | string): string | null {
    const cache = this.ensureCache();
    return cache.get(id) ?? null;
  }

  /**
   * Writes a secret. Passing an empty string or null removes the entry, so
   * "clear this key" maps to a normal settings-save with a cleared input.
   */
  set(id: SecretId | string, value: string | null): void {
    if (!value) {
      this.delete(id);
      return;
    }
    if (!this.isAvailable()) {
      throw new Error(
        'safeStorage encryption is not available on this host — refusing to write plaintext secret.',
      );
    }
    const cache = this.ensureCache();
    cache.set(id, value);
    this.persist();
  }

  /** Removes a secret. No-op if the id is not stored. */
  delete(id: SecretId | string): void {
    const cache = this.ensureCache();
    if (cache.delete(id)) {
      this.persist();
    }
  }

  /** Stored secret ids, in insertion order. Useful for diagnostics + migration tests. */
  listIds(): string[] {
    return [...this.ensureCache().keys()];
  }

  /** Drops the in-memory cache so the next get() re-reads + re-decrypts from disk. */
  reload(): void {
    this.cache = null;
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  private ensureCache(): Map<string, string> {
    if (this.cache) return this.cache;
    this.cache = this.readFromDisk();
    return this.cache;
  }

  private readFromDisk(): Map<string, string> {
    const out = new Map<string, string>();
    if (!fs.existsSync(this.filePath)) return out;
    let parsed: SecretsFile;
    try {
      parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as SecretsFile;
    } catch {
      // Corrupt file: treat as empty rather than crash the app. The user can
      // re-enter keys; a corrupt secrets file should not deny them launch.
      return out;
    }
    if (parsed?.v !== FILE_VERSION || !parsed.values) return out;
    for (const [id, ciphertextB64] of Object.entries(parsed.values)) {
      if (typeof ciphertextB64 !== 'string') continue;
      try {
        const plaintext = this.safeStorage.decryptString(Buffer.from(ciphertextB64, 'base64'));
        out.set(id, plaintext);
      } catch {
        // Decryption can fail when the OS keychain rolls credentials (e.g.
        // after a fresh OS install copying ~/.config wholesale). Drop the
        // unreadable entry rather than throwing — the user will be prompted
        // to re-enter the key.
      }
    }
    return out;
  }

  private persist(): void {
    const cache = this.cache;
    if (!cache) return;
    const values: Record<string, string> = {};
    for (const [id, plaintext] of cache.entries()) {
      const ciphertext = this.safeStorage.encryptString(plaintext);
      values[id] = ciphertext.toString('base64');
    }
    const file: SecretsFile = { v: FILE_VERSION, values };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(file, null, 2), 'utf-8');
  }
}
