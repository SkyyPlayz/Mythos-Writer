/**
 * Single source of truth: KEY_FIELD_PATHS → SecretId (KEYS-B / v0.5.7).
 *
 * Migration, persist, hydrate, save-catch fallback, and backup redaction all
 * iterate this table. Keep existing ids; new roles use provider.<role>.apiKey.
 */

import { KEY_FIELD_PATHS, type KeyFieldPath } from '../settings-masking.js';
import type { SecretId } from './store.js';

/** Every KEY_FIELD_PATHS entry maps to exactly one SecretId. */
export const SECRET_ID_BY_KEY_PATH = {
  apiKey: 'anthropic.apiKey',
  'provider.apiKey': 'provider.apiKey',
  'voice.openaiApiKey': 'voice.openaiApiKey',
  'stt.cloudApiKey': 'stt.cloudApiKey',
  'tts.cloudApiKey': 'tts.cloudApiKey',
  'agents.writingAssistant.provider.apiKey': 'provider.writingAssistant.apiKey',
  'agents.brainstorm.provider.apiKey': 'provider.brainstorm.apiKey',
  'agents.archive.provider.apiKey': 'provider.archive.apiKey',
  'agents.betaReader.provider.apiKey': 'provider.betaReader.apiKey',
  'agents.alphaReader.provider.apiKey': 'provider.alphaReader.apiKey',
  'agents.storylineConsultant.provider.apiKey': 'provider.storylineConsultant.apiKey',
  'agents.lineEditor.provider.apiKey': 'provider.lineEditor.apiKey',
} as const satisfies Record<KeyFieldPath, SecretId>;

export type KeyPathSecretId = (typeof SECRET_ID_BY_KEY_PATH)[KeyFieldPath];

/** Ordered pairs — same order as KEY_FIELD_PATHS. */
export const KEY_PATH_SECRET_ENTRIES: readonly {
  path: KeyFieldPath;
  secretId: SecretId;
}[] = KEY_FIELD_PATHS.map((path) => ({
  path,
  secretId: SECRET_ID_BY_KEY_PATH[path],
}));

/** Compile-time + runtime: table covers every KEY_FIELD_PATHS entry. */
export function assertKeyPathSecretTableComplete(): void {
  for (const path of KEY_FIELD_PATHS) {
    if (!(path in SECRET_ID_BY_KEY_PATH)) {
      throw new Error(`SECRET_ID_BY_KEY_PATH missing path: ${path}`);
    }
  }
  if (KEY_PATH_SECRET_ENTRIES.length !== KEY_FIELD_PATHS.length) {
    throw new Error('KEY_PATH_SECRET_ENTRIES length mismatch vs KEY_FIELD_PATHS');
  }
}
