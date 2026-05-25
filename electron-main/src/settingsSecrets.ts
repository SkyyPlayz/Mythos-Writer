import type { AppSettings } from './ipc.js';

const ANTHROPIC_API_KEY_MASK_PREFIX = 'sk-ant-...';
const VOICE_API_KEY_MASK_PREFIX = '••••';

export function maskApiKey(key?: string, prefix = ANTHROPIC_API_KEY_MASK_PREFIX): string {
  return key ? `${prefix}${key.slice(-4)}` : '';
}

export function maskSettingsForRenderer(settings: AppSettings): AppSettings {
  return {
    ...settings,
    apiKey: maskApiKey(settings.apiKey),
    ...(settings.voice
      ? {
          voice: {
            ...settings.voice,
            ...(settings.voice.openaiApiKey !== undefined
              ? { openaiApiKey: maskApiKey(settings.voice.openaiApiKey, VOICE_API_KEY_MASK_PREFIX) }
              : {}),
          },
        }
      : {}),
  };
}

export function preserveMaskedSettingsSecrets(current: AppSettings, next: AppSettings): AppSettings {
  const shouldPreserveVoiceApiKey = next.voice?.openaiApiKey !== undefined
    && current.voice?.openaiApiKey !== undefined
    && next.voice.openaiApiKey === maskApiKey(current.voice.openaiApiKey, VOICE_API_KEY_MASK_PREFIX);

  return {
    ...next,
    apiKey: next.apiKey === maskApiKey(current.apiKey) ? current.apiKey : next.apiKey,
    ...(next.voice
      ? {
          voice: {
            ...next.voice,
            ...(shouldPreserveVoiceApiKey ? { openaiApiKey: current.voice?.openaiApiKey } : {}),
          },
        }
      : {}),
  };
}
