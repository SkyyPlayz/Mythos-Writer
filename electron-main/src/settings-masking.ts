// Settings → renderer masking helpers (MYT-424).
//
// The Settings IPC handler must never hand the raw provider API keys back to
// the renderer process. A compromised renderer (XSS, malicious extension,
// leaked log) would otherwise be able to exfiltrate the secret via
// window.api.settingsGet(). Apply the existing sk-ant-...XXXX preview to
// every provider-key field on AppSettings before responding, and invert the
// masking on SETTINGS_SET so the renderer can echo the masked preview back
// without overwriting the stored secret.
//
// All consumers in the main process (e.g. voice.ts TTS call site) read
// AppSettings via loadAppSettings() directly and so continue to receive the
// raw key — masking only applies to values that cross the IPC boundary.

import type { AppSettings } from './ipc.js';

// Returns a masked preview (sk-ant-...XXXX) so the raw key never leaves the
// main process. Empty / undefined keys collapse to '' to match the historical
// behavior of the inline helper that previously lived in main.ts.
export function maskApiKey(key: string | undefined | null): string {
  return key ? `sk-ant-...${key.slice(-4)}` : '';
}

// Mask every API-key-shaped field on AppSettings before it crosses the IPC
// boundary to the renderer. Currently apiKey (legacy), provider.apiKey, and
// voice.openaiApiKey (OpenAI Whisper cloud fallback).
export function maskSettingsForRenderer(settings: AppSettings): AppSettings {
  const masked: AppSettings = { ...settings, apiKey: maskApiKey(settings.apiKey) };
  if (settings.provider?.apiKey) {
    masked.provider = { ...settings.provider, apiKey: maskApiKey(settings.provider.apiKey) };
  }
  if (settings.voice && settings.voice.openaiApiKey) {
    masked.voice = { ...settings.voice, openaiApiKey: maskApiKey(settings.voice.openaiApiKey) };
  }
  return masked;
}

// Inverse of maskSettingsForRenderer for the SETTINGS_SET path: when the
// renderer echoes back the masked preview unchanged, restore the stored raw
// key so the user does not have to re-enter it. Any other value is treated
// as a real new key from the renderer and saved verbatim.
export function reconcileSettingsFromRenderer(
  incoming: AppSettings,
  stored: AppSettings,
): AppSettings {
  const apiKey = incoming.apiKey === maskApiKey(stored.apiKey) ? stored.apiKey : incoming.apiKey;
  const reconciled: AppSettings = { ...incoming, apiKey };
  if (
    stored.voice?.openaiApiKey
    && incoming.voice
    && incoming.voice.openaiApiKey === maskApiKey(stored.voice.openaiApiKey)
  ) {
    reconciled.voice = { ...incoming.voice, openaiApiKey: stored.voice.openaiApiKey };
  }
  if (incoming.provider && stored.provider?.apiKey) {
    const incomingProviderKey = incoming.provider.apiKey;
    if (incomingProviderKey === maskApiKey(stored.provider.apiKey)) {
      reconciled.provider = { ...incoming.provider, apiKey: stored.provider.apiKey };
    }
  }
  return reconciled;
}
