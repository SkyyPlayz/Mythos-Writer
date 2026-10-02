// One-shot migration from plaintext app-settings.json → encrypted secrets store.
//
// KEYS-B: every KEY_FIELD_PATHS entry maps through SECRET_ID_BY_KEY_PATH.
// Store-first + read-back before blanking JSON (B2). Masks are never migrated
// (B4 — left for heal-on-read). Failures leave plaintext for the next boot.

import fs from 'fs';
import type { AppSettings } from '../ipc.js';
import {
  getKeyField,
  isMaskedPreview,
  setKeyField,
  type KeyFieldPath,
} from '../settings-masking.js';
import { writeJsonAtomicSecure } from './atomicWrite.js';
import { KEY_PATH_SECRET_ENTRIES } from './keyFieldMap.js';
import type { SecretsStore } from './store.js';

export interface MigrationResult {
  migrated: boolean;
  /** Secret ids that were moved into the encrypted store. */
  movedIds: string[];
}

/** Non-empty, non-mask plaintext that should live in the secrets store. */
function isMigratablePlaintext(value: string | undefined | null): value is string {
  if (typeof value !== 'string') return false;
  if (value.trim().length === 0) return false;
  if (isMaskedPreview(value)) return false;
  return true;
}

/**
 * Runs the migration against an existing app-settings.json file. Returns
 * whether anything moved. Tests inject a synthetic settingsPath + store; in
 * production `main.ts` calls this with the real userData paths after
 * `initSecretsStore` completes.
 *
 * For each KEY_FIELD_PATHS entry with migratable plaintext:
 *   1. store.set(id, value)
 *   2. store.reload(); store.get(id) must equal value
 *   3. only then blank the JSON field
 * Failures leave plaintext in JSON for retry on the next boot.
 * JSON is rewritten once after the loop when at least one path verified.
 */
export function migrateSecretsFromSettingsFile(
  settingsPath: string,
  store: SecretsStore,
): MigrationResult {
  if (!fs.existsSync(settingsPath)) {
    return { migrated: false, movedIds: [] };
  }
  let parsed: AppSettings;
  try {
    parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as AppSettings;
  } catch {
    return { migrated: false, movedIds: [] };
  }

  const movedIds: string[] = [];
  let dirty = false;

  for (const { path, secretId } of KEY_PATH_SECRET_ENTRIES) {
    const value = getKeyField(parsed, path);
    if (!isMigratablePlaintext(value)) continue;

    try {
      store.set(secretId, value);
      store.reload();
      if (store.get(secretId) !== value) {
        // Read-back mismatch — leave plaintext for retry.
        continue;
      }
      parsed = setKeyField(parsed, path, '');
      movedIds.push(secretId);
      dirty = true;
    } catch {
      // Store write failed — leave plaintext for retry. Path names only in logs
      // (callers must not log the value).
      continue;
    }
  }

  if (!dirty) {
    return { migrated: false, movedIds: [] };
  }

  writeJsonAtomicSecure(settingsPath, parsed);
  return { migrated: true, movedIds };
}

/**
 * Hydrates secrets back onto an AppSettings object loaded from disk.
 * D1b: JSON non-empty non-mask beats a differing stored value (keep JSON;
 * migration will reconcile on next boot). Empty / mask JSON never touches the
 * store — overlay from store when present. Optional blocks stay optional:
 * voice / stt / tts / agent provider stubs are not invented solely to hydrate.
 */
export function hydrateSecretsIntoSettings(
  settings: AppSettings,
  store: SecretsStore,
): AppSettings {
  let out: AppSettings = { ...settings };

  for (const { path, secretId } of KEY_PATH_SECRET_ENTRIES) {
    const jsonVal = getKeyField(out, path);
    if (isMigratablePlaintext(jsonVal)) {
      // JSON wins over a differing stored value (D1b) — do not overlay store.
      continue;
    }
    const stored = store.get(secretId);
    if (!stored) continue;
    if (!keyPathPresentForHydrate(out, path)) continue;
    out = setKeyField(out, path, stored);
  }

  return out;
}

/**
 * Splits an AppSettings being saved into (a) the non-secret payload written
 * to app-settings.json, and (b) the side-effects on the secrets store. Used by
 * `saveAppSettings()` so the on-disk JSON never gains a fresh plaintext key.
 *
 * Iterates KEY_PATH_SECRET_ENTRIES. Optional agents stay optional: absent
 * provider blocks are skipped (no forced materialization on persist).
 */
export function persistSecretsAndStripSettings(
  incoming: AppSettings,
  store: SecretsStore,
): AppSettings {
  let stripped: AppSettings = { ...incoming };

  for (const { path, secretId } of KEY_PATH_SECRET_ENTRIES) {
    if (!keyPathPresentForPersist(stripped, path)) continue;
    const key = getKeyField(stripped, path) ?? '';
    store.set(secretId, key);
    stripped = setKeyField(stripped, path, '');
  }

  return stripped;
}

/**
 * Persist only walks fields that exist on the object (or top-level apiKey).
 * Optional agent / voice / stt / tts / provider blocks that are absent stay
 * absent — we do not invent empty provider stubs just to clear them.
 */
function keyPathPresentForPersist(settings: AppSettings, path: KeyFieldPath): boolean {
  switch (path) {
    case 'apiKey':
      return typeof settings.apiKey === 'string';
    case 'provider.apiKey':
      return !!settings.provider;
    case 'voice.openaiApiKey':
      return !!settings.voice && typeof settings.voice.openaiApiKey === 'string';
    case 'stt.cloudApiKey':
      return !!settings.stt && typeof settings.stt.cloudApiKey === 'string';
    case 'tts.cloudApiKey':
      return !!settings.tts && typeof settings.tts.cloudApiKey === 'string';
    case 'agents.writingAssistant.provider.apiKey':
      return !!settings.agents?.writingAssistant?.provider;
    case 'agents.brainstorm.provider.apiKey':
      return !!settings.agents?.brainstorm?.provider;
    case 'agents.archive.provider.apiKey':
      return !!settings.agents?.archive?.provider;
    case 'agents.betaReader.provider.apiKey':
      return !!settings.agents?.betaReader?.provider;
    case 'agents.alphaReader.provider.apiKey':
      return !!settings.agents?.alphaReader?.provider;
    case 'agents.storylineConsultant.provider.apiKey':
      return !!settings.agents?.storylineConsultant?.provider;
    case 'agents.lineEditor.provider.apiKey':
      return !!settings.agents?.lineEditor?.provider;
    default: {
      const _exhaustive: never = path;
      return _exhaustive;
    }
  }
}

/**
 * Hydrate overlays only when the parent block already exists (or always for
 * top-level apiKey / provider). Matches pre-KEYS-B optional voice/agent behavior.
 */
function keyPathPresentForHydrate(settings: AppSettings, path: KeyFieldPath): boolean {
  switch (path) {
    case 'apiKey':
      return true;
    case 'provider.apiKey':
      return true; // materialize provider stub when a stored key exists
    case 'voice.openaiApiKey':
      return !!settings.voice;
    case 'stt.cloudApiKey':
      return !!settings.stt;
    case 'tts.cloudApiKey':
      return !!settings.tts;
    case 'agents.writingAssistant.provider.apiKey':
      return !!settings.agents?.writingAssistant?.provider;
    case 'agents.brainstorm.provider.apiKey':
      return !!settings.agents?.brainstorm?.provider;
    case 'agents.archive.provider.apiKey':
      return !!settings.agents?.archive?.provider;
    case 'agents.betaReader.provider.apiKey':
      return !!settings.agents?.betaReader?.provider;
    case 'agents.alphaReader.provider.apiKey':
      return !!settings.agents?.alphaReader?.provider;
    case 'agents.storylineConsultant.provider.apiKey':
      return !!settings.agents?.storylineConsultant?.provider;
    case 'agents.lineEditor.provider.apiKey':
      return !!settings.agents?.lineEditor?.provider;
    default: {
      const _exhaustive: never = path;
      return _exhaustive;
    }
  }
}

/** Blank every present KEY_FIELD_PATHS entry (O1 / scope 7 — store cannot encrypt). */
export function blankAllKeyFields(settings: AppSettings): AppSettings {
  let out = settings;
  for (const { path } of KEY_PATH_SECRET_ENTRIES) {
    const cur = getKeyField(out, path);
    // Only blank fields that already exist as strings — do not materialize
    // optional agent / voice / stt / tts stubs just to clear them.
    if (typeof cur === 'string') {
      out = setKeyField(out, path, '');
    }
  }
  return out;
}
