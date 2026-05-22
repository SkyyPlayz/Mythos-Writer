/// <reference types="vite/client" />

interface Window {
  /** Primary IPC bridge — use this in new code. */
  api: {
    readVault: (path: string) => Promise<{ content: string; path: string }>;
    writeVault: (path: string, content: string) => Promise<{ path: string; bytes: number }>;
    listVault: (root?: string) => Promise<{ items: Array<{ path: string; name: string; isDirectory: boolean; modifiedAt: string }> }>;
    deleteVault: (path: string) => Promise<{ path: string; deleted: boolean }>;
    readManifest: () => Promise<unknown>;
    writeManifest: (manifest: unknown) => Promise<unknown>;
    dbQuery: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    dbWrite: (sql: string, params?: unknown[]) => Promise<{ changes: number }>;
    generateStory: (payload: { prompt: string; genre?: string; length?: string }) => Promise<unknown>;
    abortStory: () => Promise<void>;
    brainstormer: (topic: string, context?: string) => Promise<unknown>;
    writingAssistant: (manuscript: string, scenePath: string) => Promise<unknown>;
    archive: (manuscript: string, vaultPath: string) => Promise<unknown>;
    getAppInfo: () => Promise<{ platform: string; electronVersion: string; appVersion: string }>;
    getSystemInfo: () => Promise<{ platform: string; electronVersion: string; nodeVersion: string }>;
  };
  /** Legacy IPC bridge — kept for backward compat, prefer window.api. */
  mythosIPC: {
    generateStory: (payload: { prompt: string; genre?: string; length?: string }) => Promise<unknown>;
    abortStory: () => Promise<unknown>;
    getStoryStatus: () => Promise<unknown>;
    readVaultFile: (path: string) => Promise<unknown>;
    writeVaultFile: (path: string, content: string) => Promise<unknown>;
    listVaultFiles: (root?: string) => Promise<unknown>;
    deleteVaultFile: (path: string) => Promise<unknown>;
    readManifest: () => Promise<unknown>;
    writeManifest: (manifest: unknown) => Promise<unknown>;
    getAppInfo: () => Promise<unknown>;
    getSystemInfo: () => Promise<unknown>;
  };
}
