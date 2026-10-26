/** Owns the shell settings IPC seam and forwards window.api.settingsGet/settingsSet unchanged. Never adds a key and never touches vault, TipTap, or agent code. */

export function settingsGet(): Promise<AppSettings> {
  return window.api.settingsGet();
}

export function settingsGetIfPresent(): Promise<AppSettings> | undefined {
  return window.api?.settingsGet?.();
}

export function settingsGetOrNull(): Promise<AppSettings | null> {
  return (window.api.settingsGet?.() ?? Promise.resolve(null)).catch(() => null);
}

export function settingsSet(
  settings: AppSettings,
  tokens?: {
    sttBinaryToken?: string;
    sttModelToken?: string;
    ttsBinaryToken?: string;
    ttsModelToken?: string;
  },
): Promise<{ saved: boolean; error?: string }> {
  if (tokens === undefined) return window.api.settingsSet(settings);
  return window.api.settingsSet(settings, tokens);
}

export function settingsSetIfPresent(
  settings: AppSettings,
): Promise<{ saved: boolean; error?: string }> | undefined {
  return window.api?.settingsSet?.(settings);
}
