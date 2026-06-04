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

import type { AppSettings, ProviderSettings } from './ipc.js';

// Returns a masked preview (sk-ant-...XXXX) so the raw key never leaves the
// main process. Empty / undefined keys collapse to '' to match the historical
// behavior of the inline helper that previously lived in main.ts.
export function maskApiKey(key: string | undefined | null): string {
  return key ? `sk-ant-...${key.slice(-4)}` : '';
}

// Mask provider.apiKey in a single agent config object (SKY-738).
function maskAgentProvider<T extends { provider?: ProviderSettings }>(agent: T): T {
  if (!agent.provider?.apiKey) return agent;
  return { ...agent, provider: { ...agent.provider, apiKey: maskApiKey(agent.provider.apiKey) } } as T;
}

// Mask every API-key-shaped field on AppSettings before it crosses the IPC
// boundary to the renderer. Currently: apiKey (Anthropic legacy field),
// provider.apiKey (active provider), voice.openaiApiKey, stt.cloudApiKey, tts.cloudApiKey,
// and all three per-agent provider.apiKey overrides (SKY-738).
export function maskSettingsForRenderer(settings: AppSettings): AppSettings {
  const masked: AppSettings = { ...settings, apiKey: maskApiKey(settings.apiKey) };
  if (settings.provider?.apiKey) {
    masked.provider = { ...settings.provider, apiKey: maskApiKey(settings.provider.apiKey) };
  }
  if (settings.voice && settings.voice.openaiApiKey) {
    masked.voice = { ...settings.voice, openaiApiKey: maskApiKey(settings.voice.openaiApiKey) };
  }
  // STT cloud API key (SKY-816).
  if (settings.stt && settings.stt.cloudApiKey) {
    masked.stt = { ...settings.stt, cloudApiKey: maskApiKey(settings.stt.cloudApiKey) };
  }
  // TTS cloud API key (SKY-817).
  if (settings.tts && settings.tts.cloudApiKey) {
    masked.tts = { ...settings.tts, cloudApiKey: maskApiKey(settings.tts.cloudApiKey) };
  }
  // Mask per-agent provider.apiKey overrides (SKY-738).
  masked.agents = {
    writingAssistant: maskAgentProvider(settings.agents.writingAssistant),
    brainstorm: maskAgentProvider(settings.agents.brainstorm),
    archive: maskAgentProvider(settings.agents.archive),
  };
  return masked;
}

// Restore provider.apiKey in a single agent config object when the renderer
// echoes back the masked preview (SKY-738).
function reconcileAgentProvider<T extends { provider?: ProviderSettings }>(
  incoming: T,
  stored: T,
): T {
  if (incoming.provider && stored.provider?.apiKey) {
    if (incoming.provider.apiKey === maskApiKey(stored.provider.apiKey)) {
      return { ...incoming, provider: { ...incoming.provider, apiKey: stored.provider.apiKey } } as T;
    }
  }
  return incoming;
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
  // Reconcile provider.apiKey: if the renderer echoes back the masked preview, preserve the stored key.
  if (incoming.provider && stored.provider?.apiKey) {
    const incomingProviderKey = incoming.provider.apiKey;
    const rawStored = stored.provider.apiKey;
    if (incomingProviderKey === maskApiKey(rawStored)) {
      reconciled.provider = { ...incoming.provider, apiKey: rawStored };
    }
  }
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
  // Reconcile STT cloud API key (SKY-816).
  if (stored.stt?.cloudApiKey && incoming.stt && incoming.stt.cloudApiKey === maskApiKey(stored.stt.cloudApiKey)) {
    reconciled.stt = { ...incoming.stt, cloudApiKey: stored.stt.cloudApiKey };
  }
  // Reconcile TTS cloud API key (SKY-817).
  if (stored.tts?.cloudApiKey && incoming.tts && incoming.tts.cloudApiKey === maskApiKey(stored.tts.cloudApiKey)) {
    reconciled.tts = { ...incoming.tts, cloudApiKey: stored.tts.cloudApiKey };
  }
  // Reconcile per-agent provider.apiKey overrides (SKY-738).
  reconciled.agents = {
    writingAssistant: reconcileAgentProvider(incoming.agents.writingAssistant, stored.agents.writingAssistant),
    brainstorm: reconcileAgentProvider(incoming.agents.brainstorm, stored.agents.brainstorm),
    archive: reconcileAgentProvider(incoming.agents.archive, stored.agents.archive),
  };
  return reconciled;
}
