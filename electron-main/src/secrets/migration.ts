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
  // Archive per-agent key (SKY-740) — was never stripped before this fix, so may be plaintext on disk.
  const archiveProvider = parsed.agents?.archive?.provider;
  if (archiveProvider && typeof archiveProvider.apiKey === 'string' && archiveProvider.apiKey.length > 0) {
    store.set('provider.archive.apiKey', archiveProvider.apiKey);
    parsed.agents = {
      ...parsed.agents!,
      archive: {
        ...parsed.agents!.archive,
        provider: { ...archiveProvider, apiKey: '' },
      },
    };
    movedIds.push('provider.archive.apiKey');
  }
  // STT cloud API key (SKY-816) — was never stripped before this fix, so may be plaintext on disk.
  if (parsed.stt && typeof parsed.stt.cloudApiKey === 'string' && parsed.stt.cloudApiKey.length > 0) {
    store.set('stt.cloudApiKey', parsed.stt.cloudApiKey);
    parsed.stt = { ...parsed.stt, cloudApiKey: '' };
    movedIds.push('stt.cloudApiKey');
  }
  // TTS cloud API key (SKY-817) — was never stripped before this fix, so may be plaintext on disk.
  if (parsed.tts && typeof parsed.tts.cloudApiKey === 'string' && parsed.tts.cloudApiKey.length > 0) {
    store.set('tts.cloudApiKey', parsed.tts.cloudApiKey);
    parsed.tts = { ...parsed.tts, cloudApiKey: '' };
    movedIds.push('tts.cloudApiKey');
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
 * unchanged. Per-agent provider API keys (SKY-683) are also hydrated here.
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
  // Per-agent provider keys (SKY-683)
  const brainstormKey = store.get('provider.brainstorm.apiKey');
  if (brainstormKey && out.agents.brainstorm.provider) {
    out.agents = {
      ...out.agents,
      brainstorm: {
        ...out.agents.brainstorm,
        provider: { ...out.agents.brainstorm.provider, apiKey: brainstormKey },
      },
    };
  }
  const writingAssistantKey = store.get('provider.writingAssistant.apiKey');
  if (writingAssistantKey && out.agents.writingAssistant.provider) {
    out.agents = {
      ...out.agents,
      writingAssistant: {
        ...out.agents.writingAssistant,
        provider: { ...out.agents.writingAssistant.provider, apiKey: writingAssistantKey },
      },
    };
  }
  // Archive per-agent key (SKY-740).
  const archiveKey = store.get('provider.archive.apiKey');
  if (archiveKey && out.agents.archive.provider) {
    out.agents = {
      ...out.agents,
      archive: {
        ...out.agents.archive,
        provider: { ...out.agents.archive.provider, apiKey: archiveKey },
      },
    };
  }
  // Beta Reader per-agent key (Beta 3 M22).
  const betaReaderKey = store.get('provider.betaReader.apiKey');
  if (betaReaderKey && out.agents.betaReader?.provider) {
    out.agents = {
      ...out.agents,
      betaReader: {
        ...out.agents.betaReader,
        provider: { ...out.agents.betaReader.provider, apiKey: betaReaderKey },
      },
    };
  }
  // STT cloud API key (SKY-816).
  const sttKey = store.get('stt.cloudApiKey');
  if (sttKey && out.stt) {
    out.stt = { ...out.stt, cloudApiKey: sttKey };
  }
  // TTS cloud API key (SKY-817).
  const ttsKey = store.get('tts.cloudApiKey');
  if (ttsKey && out.tts) {
    out.tts = { ...out.tts, cloudApiKey: ttsKey };
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
  // Per-agent provider keys (SKY-683).
  if (stripped.agents.brainstorm.provider) {
    const key = stripped.agents.brainstorm.provider.apiKey ?? '';
    store.set('provider.brainstorm.apiKey', key);
    stripped.agents = {
      ...stripped.agents,
      brainstorm: {
        ...stripped.agents.brainstorm,
        provider: { ...stripped.agents.brainstorm.provider, apiKey: '' },
      },
    };
  }
  if (stripped.agents.writingAssistant.provider) {
    const key = stripped.agents.writingAssistant.provider.apiKey ?? '';
    store.set('provider.writingAssistant.apiKey', key);
    stripped.agents = {
      ...stripped.agents,
      writingAssistant: {
        ...stripped.agents.writingAssistant,
        provider: { ...stripped.agents.writingAssistant.provider, apiKey: '' },
      },
    };
  }
  // Archive per-agent key (SKY-740).
  if (stripped.agents.archive.provider) {
    const key = stripped.agents.archive.provider.apiKey ?? '';
    store.set('provider.archive.apiKey', key);
    stripped.agents = {
      ...stripped.agents,
      archive: {
        ...stripped.agents.archive,
        provider: { ...stripped.agents.archive.provider, apiKey: '' },
      },
    };
  }
  // Beta Reader per-agent key (Beta 3 M22) — never plaintext-at-rest.
  if (stripped.agents.betaReader?.provider) {
    const key = stripped.agents.betaReader.provider.apiKey ?? '';
    store.set('provider.betaReader.apiKey', key);
    stripped.agents = {
      ...stripped.agents,
      betaReader: {
        ...stripped.agents.betaReader,
        provider: { ...stripped.agents.betaReader.provider, apiKey: '' },
      },
    };
  }
  // STT cloud API key (SKY-816).
  if (stripped.stt && typeof stripped.stt.cloudApiKey === 'string') {
    store.set('stt.cloudApiKey', stripped.stt.cloudApiKey);
    stripped.stt = { ...stripped.stt, cloudApiKey: '' };
  }
  // TTS cloud API key (SKY-817).
  if (stripped.tts && typeof stripped.tts.cloudApiKey === 'string') {
    store.set('tts.cloudApiKey', stripped.tts.cloudApiKey);
    stripped.tts = { ...stripped.tts, cloudApiKey: '' };
  }

  return stripped;
}
