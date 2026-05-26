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
  vaultGraphData: () => ipcRenderer.invoke('vault:graph-data', undefined),

  // Push-notification from main when a markdown file changes
  onVaultFileChanged: (cb: (event: unknown, data: { path: string }) => void) => {
    ipcRenderer.on('vault:file-changed', cb);
    return () => ipcRenderer.removeListener('vault:file-changed', cb);
  },

  // AI agents (stubs for Epic 5)
  brainstormer: (topic: string, context?: string) =>
    ipcRenderer.invoke('ai:brainstormer', { topic, context }),
  writingAssistant: (manuscript: string, scenePath: string) =>
    ipcRenderer.invoke('ai:writing-assistant', { manuscript, scenePath }),
  archive: (manuscript: string, vaultPath: string) =>
    ipcRenderer.invoke('ai:archive', { manuscript, vaultPath }),

  // Agent channels (Epic 5)
  agentWritingAssistant: (prompt: string, context?: string, scenePath?: string) =>
    ipcRenderer.invoke('agent:writing-assistant', { prompt, context, scenePath }),
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

  // App settings
  settingsGet: () => ipcRenderer.invoke('settings:get', undefined),
  settingsSet: (settings: unknown) => ipcRenderer.invoke('settings:set', { settings }),

  // Generation log (prompt history)
  generationLogRecent: (payload: { limit?: number; offset?: number; agent?: string; dateFrom?: string; dateTo?: string; search?: string }) =>
    ipcRenderer.invoke('generationLog:recent', payload),

  // Suggestions lifecycle
  suggestionsList: (status?: string, sourceAgent?: string) =>
    ipcRenderer.invoke('suggestions:list', { status, sourceAgent }),
  suggestionsUpsert: (suggestion: unknown) =>
    ipcRenderer.invoke('suggestions:upsert', { suggestion }),
  suggestionsAccept: (id: string, actor?: string) =>
    ipcRenderer.invoke('suggestions:accept', { id, actor }),
  suggestionsReject: (id: string, reason?: string, actor?: string) =>
    ipcRenderer.invoke('suggestions:reject', { id, reason, actor }),
  suggestionsRollback: (id: string, actor?: string) =>
    ipcRenderer.invoke('suggestions:rollback', { id, actor }),
  auditList: (suggestionId?: string) =>
    ipcRenderer.invoke('audit:list', { suggestionId }),

  // Stream-start push events — renderer receives requestId before first chunk
  onWritingAssistantStreamStart: (cb: (requestId: string) => void) => {
    const handler = (_: unknown, data: { requestId: string }) => cb(data.requestId);
    ipcRenderer.on('agent:writing-assistant:stream-start', handler);
    return () => ipcRenderer.removeListener('agent:writing-assistant:stream-start', handler);
  },
  onBrainstormStreamStart: (cb: (requestId: string) => void) => {
    const handler = (_: unknown, data: { requestId: string }) => cb(data.requestId);
    ipcRenderer.on('agent:brainstorm:stream-start', handler);
    return () => ipcRenderer.removeListener('agent:brainstorm:stream-start', handler);
  },
  onVaultCheckStreamStart: (cb: (requestId: string) => void) => {
    const handler = (_: unknown, data: { requestId: string }) => cb(data.requestId);
    ipcRenderer.on('agent:vault-check:stream-start', handler);
    return () => ipcRenderer.removeListener('agent:vault-check:stream-start', handler);
  },

  // Cancel channels — fire-and-forget, aborts the running stream for the given requestId
  cancelWritingAssistant: (requestId: string) =>
    ipcRenderer.send('agent:writing-assistant:stream-cancel', { requestId }),
  cancelBrainstorm: (requestId: string) =>
    ipcRenderer.send('agent:brainstorm:stream-cancel', { requestId }),
  cancelVaultCheck: (requestId: string) =>
    ipcRenderer.send('agent:vault-check:stream-cancel', { requestId }),

  // Auto-update status (MYT-210) — feature-flagged; calls are safe no-ops when MYTHOS_AUTO_UPDATE!=1
  onUpdateStatus: (cb: (state: 'checking' | 'available' | 'not-available' | 'downloading' | 'ready') => void) => {
    const handler = (_: unknown, data: { state: 'checking' | 'available' | 'not-available' | 'downloading' | 'ready' }) => cb(data.state);
    ipcRenderer.on('update:status', handler);
    return () => ipcRenderer.removeListener('update:status', handler);
  },
  checkForUpdate: () => ipcRenderer.invoke('update:check', undefined),
  installUpdate: () => ipcRenderer.invoke('update:install', undefined),

  // Voice IO (MYT-205) — local-first STT
  // voiceStart → starts a session; returns { sessionId }
  voiceStart: (micDeviceId?: string) =>
    ipcRenderer.invoke('voice:start', { micDeviceId }),
  // voiceStop → ends the session; triggers cloud transcription when enabled
  voiceStop: (sessionId: string) =>
    ipcRenderer.invoke('voice:stop', { sessionId }),
  // voiceLocalTranscript — fire-and-forget; relay Web Speech API text to main for broadcast
  voiceLocalTranscript: (sessionId: string, text: string, isFinal: boolean) =>
    ipcRenderer.send('voice:local-transcript', { sessionId, text, isFinal }),
  // voiceAudioChunk — fire-and-forget; send raw audio chunk for cloud STT accumulation
  voiceAudioChunk: (sessionId: string, chunk: ArrayBuffer) =>
    ipcRenderer.send('voice:audio-chunk', { sessionId, chunk }),
  // onVoiceTranscript — subscribe to transcript push events from main
  onVoiceTranscript: (cb: (event: { sessionId: string; text: string; isFinal: boolean }) => void) => {
    const handler = (_: unknown, data: { sessionId: string; text: string; isFinal: boolean }) => cb(data);
    ipcRenderer.on('voice:transcript', handler);
    return () => ipcRenderer.removeListener('voice:transcript', handler);
  },
  // onVoiceError — subscribe to voice error push events from main
  onVoiceError: (cb: (event: { sessionId: string; error: string }) => void) => {
    const handler = (_: unknown, data: { sessionId: string; error: string }) => cb(data);
    ipcRenderer.on('voice:error', handler);
    return () => ipcRenderer.removeListener('voice:error', handler);
  },

  // Timeline entries (MYT-216)
  timelineList: (scenePath?: string) => ipcRenderer.invoke('timeline:list', { scenePath }),
  timelineUpsert: (entry: unknown) => ipcRenderer.invoke('timeline:upsert', { entry }),
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
  brainstormer: (topic: string, context?: string) =>
    ipcRenderer.invoke('ai:brainstormer', { topic, context }),
  writingAssistant: (manuscript: string, scenePath: string) =>
    ipcRenderer.invoke('ai:writing-assistant', { manuscript, scenePath }),
  archive: (manuscript: string, vaultPath: string) =>
    ipcRenderer.invoke('ai:archive', { manuscript, vaultPath }),
  getAppInfo: () => ipcRenderer.invoke('app:ready', undefined),
  getSystemInfo: () => ipcRenderer.invoke('system:info', undefined),
});
