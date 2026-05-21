// Preload script — exposes IPC bridge to renderer with context isolation
import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, ipcCall, type IpcHandlers } from './ipc.js';

contextBridge.exposeInMainWorld('mythosIPC', {
  // Story generation
  generateStory: (payload: { prompt: string; genre?: string; length?: string }) =>
    ipcCall('story:generate', payload),
  abortStory: () => ipcCall('story:abort', undefined),
  getStoryStatus: () => ipcCall('story:status', undefined),

  // Vault / filesystem
  readVaultFile: (path: string) => ipcCall('vault:read', { path }),
  writeVaultFile: (path: string, content: string) => ipcCall('vault:write', { path, content }),
  listVaultFiles: (root?: string) => ipcCall('vault:list', { root }),
  deleteVaultFile: (path: string) => ipcCall('vault:delete', { path }),
  readManifest: () => ipcCall('vault:manifest:read', undefined),
  writeManifest: (manifest: unknown) => ipcCall('vault:manifest:write', { manifest }),

  // Database (stub)
  dbQuery: (sql: string, params?: unknown[]) => ipcCall('db:query', { sql, params }),
  dbWrite: (sql: string, params?: unknown[]) => ipcCall('db:write', { sql, params }),

  // AI agents (stubs)
  brainstormer: (topic: string, context?: string) =>
    ipcCall('ai:brainstormer', { topic, context }),
  writingAssistant: (manuscript: string, scenePath: string) =>
    ipcCall('ai:writing-assistant', { manuscript, scenePath }),
  archive: (manuscript: string, vaultPath: string) =>
    ipcCall('ai:archive', { manuscript, vaultPath }),

  // System
  getAppInfo: () => ipcCall('app:ready', undefined),
  getSystemInfo: () => ipcCall('system:info', undefined),
});
