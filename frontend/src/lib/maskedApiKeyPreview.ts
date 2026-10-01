/**
 * Renderer-only shape check for a masked API-key preview (sk-ant-...XXXX).
 * Must NOT import electron-main isMaskedPreview — keep a local regex here.
 */
export const MASKED_API_KEY_PREVIEW_MESSAGE =
  'Paste your full API key; this looks like the masked preview.';

const MASKED_API_KEY_PREVIEW_RE = /^sk-ant-\.\.\..{1,4}$/;

export function looksLikeMaskedApiKeyPreview(value: string): boolean {
  return MASKED_API_KEY_PREVIEW_RE.test(value);
}
