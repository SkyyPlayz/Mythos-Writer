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
//
// Keys backstop (v0.5.7): any incoming value matching isMaskedPreview is
// treated as "unchanged" — keep stored, or '' when nothing is stored — so an
// older-key mask (or any sk-ant-...XXXX shape) can never be written as a real
// key. Heal-on-read clears already-stored masks in memory at loadAppSettings.

import type { AppSettings, ProviderSettings } from './ipc.js';

/** Shared prefix for every maskApiKey preview (and the isMaskedPreview matcher). */
export const MASK_PREFIX = 'sk-ant-...';

/**
 * Every AppSettings field that holds a provider/API secret. Used by
 * maskSettingsForRenderer, the SETTINGS_SET backstop, heal-on-read, and pins.
 */
export const KEY_FIELD_PATHS = [
  'apiKey',
  'provider.apiKey',
  'voice.openaiApiKey',
  'stt.cloudApiKey',
  'tts.cloudApiKey',
  'agents.writingAssistant.provider.apiKey',
  'agents.brainstorm.provider.apiKey',
  'agents.archive.provider.apiKey',
  'agents.betaReader.provider.apiKey',
  'agents.alphaReader.provider.apiKey',
  'agents.storylineConsultant.provider.apiKey',
  'agents.lineEditor.provider.apiKey',
] as const;

export type KeyFieldPath = (typeof KEY_FIELD_PATHS)[number];

const MASKED_PREVIEW_RE = new RegExp(
  `^${MASK_PREFIX.replace(/\./g, '\\.')}.{1,4}$`,
);

/**
 * True when `value` is a masked preview produced by maskApiKey (or any
 * sk-ant-... + 1–4 char suffix). Never matches '' / null / undefined.
 * Main-process only — the renderer must not import this.
 */
export function isMaskedPreview(value: string | undefined | null): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  return MASKED_PREVIEW_RE.test(value);
}

// Returns a masked preview (sk-ant-...XXXX) so the raw key never leaves the
// main process. Empty / undefined keys collapse to '' to match the historical
// behavior of the inline helper that previously lived in main.ts.
export function maskApiKey(key: string | undefined | null): string {
  return key ? `${MASK_PREFIX}${key.slice(-4)}` : '';
}

/** Read a key field by KEY_FIELD_PATHS entry. */
export function getKeyField(settings: AppSettings, path: KeyFieldPath): string | undefined {
  switch (path) {
    case 'apiKey':
      return settings.apiKey;
    case 'provider.apiKey':
      return settings.provider?.apiKey;
    case 'voice.openaiApiKey':
      return settings.voice?.openaiApiKey;
    case 'stt.cloudApiKey':
      return settings.stt?.cloudApiKey;
    case 'tts.cloudApiKey':
      return settings.tts?.cloudApiKey;
    case 'agents.writingAssistant.provider.apiKey':
      return settings.agents.writingAssistant.provider?.apiKey;
    case 'agents.brainstorm.provider.apiKey':
      return settings.agents.brainstorm.provider?.apiKey;
    case 'agents.archive.provider.apiKey':
      return settings.agents.archive.provider?.apiKey;
    case 'agents.betaReader.provider.apiKey':
      return settings.agents.betaReader?.provider?.apiKey;
    case 'agents.alphaReader.provider.apiKey':
      return settings.agents.alphaReader?.provider?.apiKey;
    case 'agents.storylineConsultant.provider.apiKey':
      return settings.agents.storylineConsultant?.provider?.apiKey;
    case 'agents.lineEditor.provider.apiKey':
      return settings.agents.lineEditor?.provider?.apiKey;
    default: {
      const _exhaustive: never = path;
      return _exhaustive;
    }
  }
}

/** Immutable set of a key field by KEY_FIELD_PATHS entry. Ensures '' (never undefined). */
export function setKeyField(settings: AppSettings, path: KeyFieldPath, value: string): AppSettings {
  switch (path) {
    case 'apiKey':
      return { ...settings, apiKey: value };
    case 'provider.apiKey':
      return {
        ...settings,
        provider: {
          ...(settings.provider ?? { kind: 'anthropic', model: '' }),
          apiKey: value,
        },
      };
    case 'voice.openaiApiKey':
      return {
        ...settings,
        voice: {
          ...(settings.voice ?? { enabled: false, cloudFallback: false }),
          openaiApiKey: value,
        },
      };
    case 'stt.cloudApiKey':
      return {
        ...settings,
        stt: {
          ...(settings.stt ?? { enabled: false, provider: 'local' as const }),
          cloudApiKey: value,
        },
      };
    case 'tts.cloudApiKey':
      return {
        ...settings,
        tts: {
          ...(settings.tts ?? { enabled: false, provider: 'local' as const }),
          cloudApiKey: value,
        },
      };
    case 'agents.writingAssistant.provider.apiKey':
      return {
        ...settings,
        agents: {
          ...settings.agents,
          writingAssistant: {
            ...settings.agents.writingAssistant,
            provider: {
              ...(settings.agents.writingAssistant.provider ?? { kind: 'anthropic', model: '' }),
              apiKey: value,
            },
          },
        },
      };
    case 'agents.brainstorm.provider.apiKey':
      return {
        ...settings,
        agents: {
          ...settings.agents,
          brainstorm: {
            ...settings.agents.brainstorm,
            provider: {
              ...(settings.agents.brainstorm.provider ?? { kind: 'anthropic', model: '' }),
              apiKey: value,
            },
          },
        },
      };
    case 'agents.archive.provider.apiKey':
      return {
        ...settings,
        agents: {
          ...settings.agents,
          archive: {
            ...settings.agents.archive,
            provider: {
              ...(settings.agents.archive.provider ?? { kind: 'anthropic', model: '' }),
              apiKey: value,
            },
          },
        },
      };
    case 'agents.betaReader.provider.apiKey':
      return {
        ...settings,
        agents: {
          ...settings.agents,
          betaReader: {
            ...(settings.agents.betaReader as NonNullable<AppSettings['agents']['betaReader']>),
            provider: {
              ...(settings.agents.betaReader?.provider ?? { kind: 'anthropic', model: '' }),
              apiKey: value,
            },
          },
        },
      };
    case 'agents.alphaReader.provider.apiKey':
      return {
        ...settings,
        agents: {
          ...settings.agents,
          alphaReader: {
            ...(settings.agents.alphaReader as NonNullable<AppSettings['agents']['alphaReader']>),
            provider: {
              ...(settings.agents.alphaReader?.provider ?? { kind: 'anthropic', model: '' }),
              apiKey: value,
            },
          },
        },
      };
    case 'agents.storylineConsultant.provider.apiKey':
      return {
        ...settings,
        agents: {
          ...settings.agents,
          storylineConsultant: {
            ...(settings.agents.storylineConsultant as NonNullable<AppSettings['agents']['storylineConsultant']>),
            provider: {
              ...(settings.agents.storylineConsultant?.provider ?? { kind: 'anthropic', model: '' }),
              apiKey: value,
            },
          },
        },
      };
    case 'agents.lineEditor.provider.apiKey':
      return {
        ...settings,
        agents: {
          ...settings.agents,
          lineEditor: {
            ...(settings.agents.lineEditor as NonNullable<AppSettings['agents']['lineEditor']>),
            provider: {
              ...(settings.agents.lineEditor?.provider ?? { kind: 'anthropic', model: '' }),
              apiKey: value,
            },
          },
        },
      };
    default: {
      const _exhaustive: never = path;
      return _exhaustive;
    }
  }
}

/**
 * Heal-on-read: any stored key matching isMaskedPreview becomes '' in memory
 * and the path is listed on ephemeral keyReentryPaths. Does not write disk.
 * Call from loadAppSettings after secrets hydration (decrypted object only).
 */
export function healMaskedKeyFields(settings: AppSettings): AppSettings {
  // Rebuild the set every load (Critic soft) — never trust a prior value.
  const { keyReentryPaths: _prior, ...withoutPrior } = settings;
  void _prior;
  let out: AppSettings = withoutPrior;
  const healed: string[] = [];
  for (const path of KEY_FIELD_PATHS) {
    const val = getKeyField(out, path);
    if (typeof val === 'string' && isMaskedPreview(val)) {
      out = setKeyField(out, path, '');
      healed.push(path);
    }
  }
  if (healed.length > 0) {
    return { ...out, keyReentryPaths: healed };
  }
  return out;
}

// Mask provider.apiKey in a single agent config object (SKY-738).
function maskAgentProvider<T extends { provider?: ProviderSettings }>(agent: T): T {
  if (!agent.provider?.apiKey) return agent;
  return { ...agent, provider: { ...agent.provider, apiKey: maskApiKey(agent.provider.apiKey) } } as T;
}

/** True when main sees a non-empty ANTHROPIC_API_KEY — boolean only, never the value. */
export function hasAnthropicEnvKeyPresent(): boolean {
  try {
    const key = process.env.ANTHROPIC_API_KEY;
    return typeof key === 'string' && key.trim().length > 0;
  } catch {
    return false;
  }
}

// Mask every API-key-shaped field on AppSettings before it crosses the IPC
// boundary to the renderer. Walks KEY_FIELD_PATHS (legacy apiKey, provider,
// voice/stt/tts, and all seven per-agent provider.apiKey overrides).
// Also stamps anthropicEnvKeyPresent (boolean only) so the renderer can mirror
// main's env-key fallback without reading process.env (sandbox / contextIsolation).
// Passes through ephemeral keyReentryPaths (path names only — never values).
export function maskSettingsForRenderer(settings: AppSettings): AppSettings {
  let masked: AppSettings = {
    ...settings,
    apiKey: maskApiKey(settings.apiKey),
    anthropicEnvKeyPresent: hasAnthropicEnvKeyPresent(),
  };
  // Preserve optional-agent absence while masking every KEY_FIELD_PATHS entry
  // that currently holds a non-empty secret.
  masked.agents = {
    writingAssistant: maskAgentProvider(settings.agents.writingAssistant),
    brainstorm: maskAgentProvider(settings.agents.brainstorm),
    archive: maskAgentProvider(settings.agents.archive),
    ...(settings.agents.betaReader
      ? { betaReader: maskAgentProvider(settings.agents.betaReader) }
      : {}),
    ...(settings.agents.alphaReader
      ? { alphaReader: maskAgentProvider(settings.agents.alphaReader) }
      : {}),
    ...(settings.agents.storylineConsultant
      ? { storylineConsultant: maskAgentProvider(settings.agents.storylineConsultant) }
      : {}),
    ...(settings.agents.lineEditor
      ? { lineEditor: maskAgentProvider(settings.agents.lineEditor) }
      : {}),
  };
  for (const path of KEY_FIELD_PATHS) {
    if (path === 'apiKey' || path.startsWith('agents.')) continue;
    const raw = getKeyField(settings, path);
    if (typeof raw === 'string' && raw.length > 0) {
      masked = setKeyField(masked, path, maskApiKey(raw));
    }
  }
  if (Array.isArray(settings.keyReentryPaths)) {
    masked = { ...masked, keyReentryPaths: [...settings.keyReentryPaths] };
  } else {
    const { keyReentryPaths: _drop, ...rest } = masked;
    void _drop;
    masked = rest;
  }
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

/**
 * Backstop pass: any remaining isMaskedPreview value on the reconciled object
 * is treated as "unchanged" — keep a real stored key, else force ''.
 * Covers stored-absent branches (optional agents, provider/voice/stt/tts).
 */
function applyMaskedPreviewBackstop(
  reconciled: AppSettings,
  stored: AppSettings,
): AppSettings {
  let out = reconciled;
  for (const path of KEY_FIELD_PATHS) {
    const incomingVal = getKeyField(out, path);
    if (!isMaskedPreview(incomingVal ?? null)) continue;
    const storedVal = getKeyField(stored, path);
    if (typeof storedVal === 'string' && storedVal.length > 0 && !isMaskedPreview(storedVal)) {
      out = setKeyField(out, path, storedVal);
    } else {
      // Nothing stored (or stored is itself a mask) → '' never undefined/deleted.
      out = setKeyField(out, path, '');
    }
  }
  return out;
}

// Inverse of maskSettingsForRenderer for the SETTINGS_SET path: when the
// renderer echoes back the masked preview unchanged, restore the stored raw
// key so the user does not have to re-enter it. Any other value is treated
// as a real new key from the renderer and saved verbatim.
// Ephemeral keyReentryPaths is always stripped before save (path names only).
export function reconcileSettingsFromRenderer(
  incoming: AppSettings,
  stored: AppSettings,
): AppSettings {
  const apiKey = incoming.apiKey === maskApiKey(stored.apiKey) ? stored.apiKey : incoming.apiKey;
  // Ephemeral IPC flags — never persist to disk.
  const {
    anthropicEnvKeyPresent: _envFlag,
    keyReentryPaths: _reentry,
    ...incomingSansEphemeral
  } = incoming;
  void _envFlag;
  void _reentry;
  let reconciled: AppSettings = { ...incomingSansEphemeral, apiKey };
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
  // Reconcile per-agent provider.apiKey overrides (SKY-738; Beta 3 M22 adds betaReader;
  // SKY-11412 adds the three production-team roles). Rebuilding `agents` here
  // must list every optional agent key — omitting one means every settings:set
  // call silently discards that agent's config, including the mere act of
  // toggling it on from Settings > AI Agents (the object save clobbers it back
  // to whatever main.ts's back-fill default is on the next load).
  reconciled.agents = {
    writingAssistant: reconcileAgentProvider(incoming.agents.writingAssistant, stored.agents.writingAssistant),
    brainstorm: reconcileAgentProvider(incoming.agents.brainstorm, stored.agents.brainstorm),
    archive: reconcileAgentProvider(incoming.agents.archive, stored.agents.archive),
    ...(incoming.agents.betaReader
      ? {
          betaReader: stored.agents.betaReader
            ? reconcileAgentProvider(incoming.agents.betaReader, stored.agents.betaReader)
            : incoming.agents.betaReader,
        }
      : {}),
    ...(incoming.agents.alphaReader
      ? {
          alphaReader: stored.agents.alphaReader
            ? reconcileAgentProvider(incoming.agents.alphaReader, stored.agents.alphaReader)
            : incoming.agents.alphaReader,
        }
      : {}),
    ...(incoming.agents.storylineConsultant
      ? {
          storylineConsultant: stored.agents.storylineConsultant
            ? reconcileAgentProvider(incoming.agents.storylineConsultant, stored.agents.storylineConsultant)
            : incoming.agents.storylineConsultant,
        }
      : {}),
    ...(incoming.agents.lineEditor
      ? {
          lineEditor: stored.agents.lineEditor
            ? reconcileAgentProvider(incoming.agents.lineEditor, stored.agents.lineEditor)
            : incoming.agents.lineEditor,
        }
      : {}),
  };
  // Final backstop: walk every KEY_FIELD_PATHS entry on the reconciled result
  // (including stored-absent optional agents + provider/voice/stt/tts).
  reconciled = applyMaskedPreviewBackstop(reconciled, stored);
  // Belt-and-suspenders: never let keyReentryPaths reach disk.
  if ('keyReentryPaths' in reconciled) {
    const { keyReentryPaths: _strip, ...rest } = reconciled;
    void _strip;
    reconciled = rest;
  }
  return reconciled;
}
