// Preload script — exposes IPC bridge to renderer with context isolation.
// Uses ipcRenderer directly (no ipcMain import) — safe in preload context.
import { contextBridge, ipcRenderer } from 'electron';

// Primary API exposed as window.api
contextBridge.exposeInMainWorld('api', {
  // Vault / filesystem
  readVault: (filePath: string) => ipcRenderer.invoke('vault:read', { path: filePath }),
  writeVault: (filePath: string, content: string) =>
    ipcRenderer.invoke('vault:write', { path: filePath, content }),
  listVault: (root?: string) => ipcRenderer.invoke('vault:list', { root }),
  deleteVault: (filePath: string) => ipcRenderer.invoke('vault:delete', { path: filePath }),
  readManifest: () => ipcRenderer.invoke('vault:manifest:read', undefined),
  writeManifest: (manifest: unknown) => ipcRenderer.invoke('vault:manifest:write', { manifest }),

  // Vault folder management
  openVaultFolder: () => ipcRenderer.invoke('vault:open-folder', undefined),
  getVaultRoot: () => ipcRenderer.invoke('vault:get-root', undefined),
  importVault: (sourcePath: string) => ipcRenderer.invoke('vault:import', { sourcePath }),
  reindexVault: () => ipcRenderer.invoke('vault:reindex', undefined),
  startVaultWatch: () => ipcRenderer.invoke('vault:watch-start', undefined),
  stopVaultWatch: () => ipcRenderer.invoke('vault:watch-stop', undefined),

  // Push-notification from main when a markdown file changes
  onVaultFileChanged: (cb: (event: unknown, data: { path: string }) => void) => {
    ipcRenderer.on('vault:file-changed', cb);
    return () => ipcRenderer.removeListener('vault:file-changed', cb);
  },

  // Database (stub)
  dbQuery: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:query', { sql, params }),
  dbWrite: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:write', { sql, params }),

  // AI agents (stubs for Epic 5)
  brainstormer: (topic: string, context?: string) =>
    ipcRenderer.invoke('ai:brainstormer', { topic, context }),
  writingAssistant: (manuscript: string, scenePath: string) =>
    ipcRenderer.invoke('ai:writing-assistant', { manuscript, scenePath }),
  archive: (manuscript: string, vaultPath: string) =>
    ipcRenderer.invoke('ai:archive', { manuscript, vaultPath }),

  // Agent channels (Epic 5)
  agentWritingAssistant: (prompt: string, context?: string) =>
    ipcRenderer.invoke('agent:writing-assistant', { prompt, context }),
  onWritingAssistantChunk: (cb: (chunk: string) => void) => {
    const handler = (_: unknown, data: { chunk: string }) => cb(data.chunk);
    ipcRenderer.on('agent:writing-assistant:chunk', handler);
    return () => ipcRenderer.removeListener('agent:writing-assistant:chunk', handler);
  },
  agentBrainstorm: (prompt: string, history?: Array<{ role: 'user' | 'assistant'; content: string }>) =>
    ipcRenderer.invoke('agent:brainstorm', { prompt, history }),
  onBrainstormChunk: (cb: (chunk: string) => void) => {
    const handler = (_: unknown, data: { chunk: string }) => cb(data.chunk);
    ipcRenderer.on('agent:brainstorm:chunk', handler);
    return () => ipcRenderer.removeListener('agent:brainstorm:chunk', handler);
  },
  agentVaultIndex: () =>
    ipcRenderer.invoke('agent:vault-index', {}),
  agentVaultCheck: (sceneContent: string) =>
    ipcRenderer.invoke('agent:vault-check', { sceneContent }),
  onVaultCheckChunk: (cb: (chunk: string) => void) => {
    const handler = (_: unknown, data: { chunk: string }) => cb(data.chunk);
    ipcRenderer.on('agent:vault-check:chunk', handler);
    return () => ipcRenderer.removeListener('agent:vault-check:chunk', handler);
  },

  // System
  getAppInfo: () => ipcRenderer.invoke('app:ready', undefined),
  getSystemInfo: () => ipcRenderer.invoke('system:info', undefined),

  // Versioning — per-scene snapshots
  snapshotSave: (sceneId: string, content: string) =>
    ipcRenderer.invoke('snapshot:save', { sceneId, content }),
  snapshotList: (sceneId: string) =>
    ipcRenderer.invoke('snapshot:list', { sceneId }),
  snapshotGet: (sceneId: string, snapshotId: string) =>
    ipcRenderer.invoke('snapshot:get', { sceneId, snapshotId }),
  snapshotRestore: (sceneId: string, snapshotId: string, scenePath: string) =>
    ipcRenderer.invoke('snapshot:restore', { sceneId, snapshotId, scenePath }),

  // Entity CRUD
  entityCreate: (payload: { name: string; type: string; aliases?: string[]; tags?: string[]; prose?: string; properties?: Record<string, unknown> }) =>
    ipcRenderer.invoke('entity:create', payload),
  entityRead: (id: string) =>
    ipcRenderer.invoke('entity:read', { id }),
  entityUpdate: (payload: { id: string; name?: string; aliases?: string[]; tags?: string[]; prose?: string; properties?: Record<string, unknown> }) =>
    ipcRenderer.invoke('entity:update', payload),
  entityDelete: (id: string) =>
    ipcRenderer.invoke('entity:delete', { id }),
  entityList: (type?: string) =>
    ipcRenderer.invoke('entity:list', { type }),
  entityBacklinks: (entityId: string) =>
    ipcRenderer.invoke('entity:backlinks', { entityId }),
});

// Backward-compat alias — kept for legacy code that still references window.mythosIPC
contextBridge.exposeInMainWorld('mythosIPC', {
  readVaultFile: (filePath: string) => ipcRenderer.invoke('vault:read', { path: filePath }),
  writeVaultFile: (filePath: string, content: string) =>
    ipcRenderer.invoke('vault:write', { path: filePath, content }),
  listVaultFiles: (root?: string) => ipcRenderer.invoke('vault:list', { root }),
  deleteVaultFile: (filePath: string) => ipcRenderer.invoke('vault:delete', { path: filePath }),
  readManifest: () => ipcRenderer.invoke('vault:manifest:read', undefined),
  writeManifest: (manifest: unknown) => ipcRenderer.invoke('vault:manifest:write', { manifest }),
  dbQuery: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:query', { sql, params }),
  dbWrite: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:write', { sql, params }),
  brainstormer: (topic: string, context?: string) =>
    ipcRenderer.invoke('ai:brainstormer', { topic, context }),
  writingAssistant: (manuscript: string, scenePath: string) =>
    ipcRenderer.invoke('ai:writing-assistant', { manuscript, scenePath }),
  archive: (manuscript: string, vaultPath: string) =>
    ipcRenderer.invoke('ai:archive', { manuscript, vaultPath }),
  getAppInfo: () => ipcRenderer.invoke('app:ready', undefined),
  getSystemInfo: () => ipcRenderer.invoke('system:info', undefined),
});
