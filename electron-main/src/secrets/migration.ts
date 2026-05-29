// One-shot migration from plaintext app-settings.json → encrypted secrets store.
//
// Pre-MYT-777 the Anthropic key, the BYO provider key, and the Whisper key all
// lived as raw strings inside `<userData>/app-settings.json`. This migration:
//   1. Reads the existing settings JSON.
//   2. Moves every populated secret-shaped field into the SecretsStore.
//   3. Rewrites the settings file with those fields cleared.
//
// Safe to run on every boot: if the settings file already has empty secret
// fields the migration is a no-op. Idempotent.

import fs from 'fs';
import type { AppSettings } from '../ipc.js';
import type { SecretsStore } from './store.js';

export interface MigrationResult {
  migrated: boolean;
  /** Secret ids that were moved into the encrypted store. */
  movedIds: string[];
}

/**
 * Runs the migration against an existing app-settings.json file. Returns
 * whether anything moved. Tests inject a synthetic settingsPath + store; in
 * production `main.ts` calls this with the real userData paths after
 * `initSecretsStore` completes.
 */
export function migrateSecretsFromSettingsFile(
  settingsPath: string,
  store: SecretsStore,
): MigrationResult {
  if (!fs.existsSync(settingsPath)) {
    return { migrated: false, movedIds: [] };
  }
  let parsed: Partial<AppSettings>;
  try {
    parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Partial<AppSettings>;
  } catch {
    return { migrated: false, movedIds: [] };
  }

  const movedIds: string[] = [];

  if (typeof parsed.apiKey === 'string' && parsed.apiKey.length > 0) {
    store.set('anthropic.apiKey', parsed.apiKey);
    parsed.apiKey = '';
    movedIds.push('anthropic.apiKey');
  }
  if (parsed.provider && typeof parsed.provider.apiKey === 'string' && parsed.provider.apiKey.length > 0) {
    store.set('provider.apiKey', parsed.provider.apiKey);
    parsed.provider = { ...parsed.provider, apiKey: '' };
    movedIds.push('provider.apiKey');
  }
  if (parsed.voice && typeof parsed.voice.openaiApiKey === 'string' && parsed.voice.openaiApiKey.length > 0) {
    store.set('voice.openaiApiKey', parsed.voice.openaiApiKey);
    parsed.voice = { ...parsed.voice, openaiApiKey: '' };
    movedIds.push('voice.openaiApiKey');
  }

  if (movedIds.length === 0) {
    return { migrated: false, movedIds: [] };
  }

  fs.writeFileSync(settingsPath, JSON.stringify(parsed, null, 2), 'utf-8');
  return { migrated: true, movedIds };
}

/**
 * Hydrates secrets back onto an AppSettings object loaded from disk.
 * Called from `loadAppSettings()` so the rest of main-process code keeps
 * reading `settings.apiKey` / `settings.provider.apiKey` / `settings.voice.openaiApiKey`
 * unchanged.
 */
export function hydrateSecretsIntoSettings(
  settings: AppSettings,
  store: SecretsStore,
): AppSettings {
  const out: AppSettings = { ...settings };
  const anthropic = store.get('anthropic.apiKey');
  if (anthropic) out.apiKey = anthropic;
  const providerKey = store.get('provider.apiKey');
  if (providerKey) {
    out.provider = { ...(out.provider ?? { kind: 'anthropic', model: '' }), apiKey: providerKey };
  }
  const voiceKey = store.get('voice.openaiApiKey');
  if (voiceKey && out.voice) {
    out.voice = { ...out.voice, openaiApiKey: voiceKey };
  }
  return out;
}

/**
 * Splits an AppSettings being saved into (a) the non-secret payload written
 * to app-settings.json, and (b) the side-effects on the secrets store. Used by
 * `saveAppSettings()` so the on-disk JSON never gains a fresh plaintext key.
 */
export function persistSecretsAndStripSettings(
  incoming: AppSettings,
  store: SecretsStore,
): AppSettings {
  const stripped: AppSettings = { ...incoming };

  // Anthropic legacy field.
  if (typeof stripped.apiKey === 'string') {
    store.set('anthropic.apiKey', stripped.apiKey);
    stripped.apiKey = '';
  }
  // BYO provider key.
  if (stripped.provider) {
    const key = stripped.provider.apiKey ?? '';
    store.set('provider.apiKey', key);
    stripped.provider = { ...stripped.provider, apiKey: '' };
  }
  // Voice cloud-fallback key.
  if (stripped.voice && typeof stripped.voice.openaiApiKey === 'string') {
    store.set('voice.openaiApiKey', stripped.voice.openaiApiKey);
    stripped.voice = { ...stripped.voice, openaiApiKey: '' };
  }

  return stripped;
}
