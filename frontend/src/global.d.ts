/// <reference types="vite/client" />

interface SceneSnapshot {
  id: string;
  sceneId: string;
  content: string;
  wordCount: number;
  createdAt: string;
}

interface EntityEntry {
  id: string;
  name: string;
  type: 'character' | 'location' | 'item' | 'concept' | 'other';
  path: string;
  aliases?: string[];
  tags?: string[];
  properties?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface Window {
  /** Primary IPC bridge — use this in new code. */
  api: {
    readVault: (path: string) => Promise<{ content: string; path: string }>;
    writeVault: (path: string, content: string) => Promise<{ path: string; bytes: number }>;
    listVault: (root?: string) => Promise<{ items: Array<{ path: string; name: string; isDirectory: boolean; modifiedAt: string }> }>;
    deleteVault: (path: string) => Promise<{ path: string; deleted: boolean }>;
    readManifest: () => Promise<unknown>;
    writeManifest: (manifest: unknown) => Promise<unknown>;
    openVaultFolder: () => Promise<{ vaultRoot: string | null; cancelled: boolean }>;
    getVaultRoot: () => Promise<{ vaultRoot: string }>;
    importVault: (sourcePath: string) => Promise<{ imported: number; skipped: number; errors: string[] }>;
    reindexVault: () => Promise<{ scanned: number; updated: number }>;
    startVaultWatch: () => Promise<{ watching: boolean }>;
    stopVaultWatch: () => Promise<{ watching: boolean }>;
    dbQuery: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    dbWrite: (sql: string, params?: unknown[]) => Promise<{ changes: number }>;
    generateStory: (payload: { prompt: string; genre?: string; length?: string }) => Promise<unknown>;
    abortStory: () => Promise<void>;
    brainstormer: (topic: string, context?: string) => Promise<unknown>;
    writingAssistant: (manuscript: string, scenePath: string) => Promise<unknown>;
    archive: (manuscript: string, vaultPath: string) => Promise<unknown>;
    getAppInfo: () => Promise<{ platform: string; electronVersion: string; appVersion: string }>;
    getSystemInfo: () => Promise<{ platform: string; electronVersion: string; nodeVersion: string }>;
    onVaultFileChanged: (cb: (event: unknown, data: { path: string }) => void) => () => void;

    // Versioning — per-scene snapshots
    snapshotSave: (sceneId: string, content: string) => Promise<SceneSnapshot>;
    snapshotList: (sceneId: string) => Promise<{ snapshots: SceneSnapshot[] }>;
    snapshotGet: (sceneId: string, snapshotId: string) => Promise<{ snapshot: SceneSnapshot | null }>;
    snapshotRestore: (sceneId: string, snapshotId: string, scenePath: string) => Promise<{ restored: SceneSnapshot; preRestoreSnapshot: SceneSnapshot }>;

    // Entity CRUD
    entityCreate: (payload: { name: string; type: string; aliases?: string[]; tags?: string[]; prose?: string; properties?: Record<string, unknown> }) => Promise<EntityEntry>;
    entityRead: (id: string) => Promise<EntityEntry | null>;
    entityUpdate: (payload: { id: string; name?: string; aliases?: string[]; tags?: string[]; prose?: string; properties?: Record<string, unknown> }) => Promise<EntityEntry>;
    entityDelete: (id: string) => Promise<{ id: string; deleted: boolean }>;
    entityList: (type?: string) => Promise<{ entities: EntityEntry[] }>;
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
