// Preload script — exposes IPC bridge to renderer with context isolation.
// Uses ipcRenderer directly (no ipcMain import) — safe in preload context.
import { contextBridge, ipcRenderer } from 'electron';
import { unwrapIpcEnvelope } from './ipcEnvelope.js';

// Primary API exposed as window.api

async function invokeEnvelope<T>(channel: string, payload: unknown): Promise<T | { error: string }> {
  return unwrapIpcEnvelope<T>(await ipcRenderer.invoke(channel, payload)) as T | { error: string };
}

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
  // SKY-5790: reveal the current Story Vault root in the OS file manager.
  revealVaultFolder: () => ipcRenderer.invoke('vault:revealFolder', undefined),

  // Two-vault paths (SKY-9 / MYT-608) — Story Vault + Notes Vault path
  // management surface used by the Settings panel. `vaultSetPaths` triggers
  // a re-seed on the main side, so the renderer can persist user edits in a
  // single round-trip.
  vaultGetPaths: () => ipcRenderer.invoke('vault:getPaths', undefined),
  vaultGetSystemPaths: () => ipcRenderer.invoke('vault:getSystemPaths', undefined),
  vaultDetectLegacy: () => ipcRenderer.invoke('vault:detectLegacyVaults', undefined),
  // SKY-12.2: opts.seedMode = 'default' | 'blank' controls scaffold behavior.
  // Defaults to 'default' (full SKY-15 layout) when absent — backwards-compatible.
  // SKY-270 / MYT-789: storyVaultToken / notesVaultToken come from vault:pick-folder.
  vaultSetPaths: (storyVaultPath: string, notesVaultPath: string, opts?: { seedMode?: 'default' | 'blank'; storyVaultToken?: string; notesVaultToken?: string }) =>
    ipcRenderer.invoke('vault:setPaths', { storyVaultPath, notesVaultPath, seedMode: opts?.seedMode, storyVaultToken: opts?.storyVaultToken, notesVaultToken: opts?.notesVaultToken }),
  // SKY-12.2: pure filesystem check for the onboarding wizard path-picker.
  validatePath: (p: string) => ipcRenderer.invoke('vault:validate-path', { path: p }),
  // SKY-12.3: copy the bundled sample project into a two-vault layout.
  loadSampleTwoVault: (parentPath: string) =>
    ipcRenderer.invoke('vault:load-sample-twovault', { parentPath }),
  // SKY-627: extended onboarding orchestration — creates vault + first scene.
  onboardingComplete: (payload?: { startMode: string; storyTitle?: string; authorName?: string; vaultParentPath?: string; templateId?: string; vaultName?: string; sampleGenre?: string; customTemplate?: 'recommended' | 'blank'; genre?: string; themeKey?: string }) =>
    ipcRenderer.invoke('onboarding:complete', payload ?? {}),
  // SKY-12.4 / SKY-7473: soft reset (default) re-arms the onboarding gate without
  // touching vault paths; `hard: true` (MYTHOS_DEV=1 only) also clears vault paths.
  onboardingReset: (payload?: { hard?: boolean }) => ipcRenderer.invoke('onboarding:reset', payload),
  // Beta 4 M29 (AC7): user-facing "Replay wizard" — every build, current vault untouched.
  onboardingReplay: () => ipcRenderer.invoke('onboarding:replay', undefined),
  // SKY-2971: Word (.docx) → Story Vault importer.
  importDocxToStoryVault: (filePaths: string[]) =>
    ipcRenderer.invoke('onboarding:importDocxToStoryVault', { filePaths }),
  // SKY-2993: Obsidian vault importer.
  importObsidianVault: (srcPath: string, targetVaultKind: 'notes' | 'story') =>
    ipcRenderer.invoke('onboarding:importObsidianVault', { srcPath, targetVaultKind }),
  dryRunObsidianImport: (srcPath: string, targetVaultKind: 'notes' | 'story') =>
    ipcRenderer.invoke('onboarding:dryRunObsidianImport', { srcPath, targetVaultKind }),
  // Beta 3 M24: Settings → Vault & Files import flows.
  vaultImportScan: (kind: 'obsidian' | 'notion' | 'scriv' | 'markdown', srcPath: string) =>
    ipcRenderer.invoke('vault:import-scan', { kind, srcPath }),
  vaultImportRun: (payload: { kind: 'obsidian' | 'notion' | 'scriv' | 'markdown'; srcPath: string; into: 'second' | 'new'; targetPath?: string }) =>
    ipcRenderer.invoke('vault:import-run', payload),
  storyImportPickFile: (format: 'docx' | 'gdoc' | 'md' | 'scriv' | 'epub') =>
    ipcRenderer.invoke('story:import-pick', { format }),
  storyImportRun: (format: 'docx' | 'gdoc' | 'md' | 'scriv' | 'epub', filePath: string) =>
    ipcRenderer.invoke('story:import-run', { format, filePath }),
  // SKY-2991: onboarding v2 path validation + vault discovery
  onboardingValidatePath: (p: string) =>
    ipcRenderer.invoke('onboarding:validatePath', { path: p }),
  onboardingGetSuggestedPaths: () =>
    ipcRenderer.invoke('onboarding:getSuggestedPaths', undefined),
  onboardingOpenExistingVault: (p: string) =>
    ipcRenderer.invoke('onboarding:openExistingVault', { path: p }),
  onboardingDetectMythosVault: (p: string) =>
    ipcRenderer.invoke('onboarding:detectMythosVault', { path: p }),

  // SKY-9: full Notes-Vault-scoped CRUD for VaultBrowser and the
  // Brainstorm / Writing-Assistant downstream slices. Mirrors the Story Vault
  // bridge; all calls route to the separately-configured notes vault root.
  readNotesVault: (filePath: string) => ipcRenderer.invoke('notesVault:read', { path: filePath }),
  writeNotesVault: (filePath: string, content: string) =>
    ipcRenderer.invoke('notesVault:write', { path: filePath, content }),
  listNotesVault: (root?: string) => ipcRenderer.invoke('notesVault:list', { root }),
  deleteNotesVault: (filePath: string) => ipcRenderer.invoke('notesVault:delete', { path: filePath }),
  moveNotesVault: (fromPath: string, toPath: string) =>
    ipcRenderer.invoke('notesVault:move', { fromPath, toPath }),
  // SKY-95: creates a directory without a .gitkeep placeholder, bypassing
  // the dotfile guard that blocked handleNewFolder from working.
  mkdirNotesVault: (dirPath: string) => ipcRenderer.invoke('notesVault:mkdir', { path: dirPath }),
  // SKY-9: intra-Story-Vault rename, symmetric with moveNotesVault.
  moveVault: (fromPath: string, toPath: string) =>
    ipcRenderer.invoke('vault:move', { fromPath, toPath }),
  vaultGuidedFolderMove: (payload: { targetPath: string; syncProvider: string; sessionToken: string }) =>
    ipcRenderer.invoke('vault:guidedFolderMove', payload),
  // SKY-9: generic folder picker for the Settings panel (decoupled from the
  // Obsidian-import token flow). Returns { path, cancelled }.
  chooseVaultFolder: (title?: string, defaultPath?: string) =>
    ipcRenderer.invoke('vault:chooseFolder', { title, defaultPath }),
  importVault: (sourcePath: string, registrationToken: string) => ipcRenderer.invoke('vault:import', { sourcePath, registrationToken }),
  reindexVault: () => ipcRenderer.invoke('vault:reindex', undefined),
  pickFolder: () => ipcRenderer.invoke('vault:pick-folder', undefined),
  obsidianDryRun: (sourcePath: string, registrationToken: string) => ipcRenderer.invoke('vault:obsidian-dry-run', { sourcePath, registrationToken }),
  obsidianRegister: (sourcePath: string, registrationToken: string) => ipcRenderer.invoke('vault:obsidian-register', { sourcePath, registrationToken }),
  // SKY-2638: Path 3 import vault channels (no registration token — onboarding context)
  importVaultDryRun: (sourcePath: string) => ipcRenderer.invoke('onboarding:import-vault:dry-run', { sourcePath }),
  importVaultCommit: (sourcePath: string) => ipcRenderer.invoke('onboarding:import-vault:commit', { sourcePath }),
  loadSampleProject: () => ipcRenderer.invoke('vault:load-sample', {}),
  createBlankVault: (targetPath: string, registrationToken?: string) => ipcRenderer.invoke('vault:create-blank', { targetPath, registrationToken }),
  obsidianPickFolderByPath: (sourcePath: string) => ipcRenderer.invoke('vault:pick-folder-by-path', { sourcePath }),
  onObsidianImportProgress: (cb: (data: { current: number; total: number; lastAction: string }) => void) => {
    const handler = (_: unknown, data: { current: number; total: number; lastAction: string }) => cb(data);
    ipcRenderer.on('vault:obsidian:import:progress', handler);
    return () => ipcRenderer.removeListener('vault:obsidian:import:progress', handler);
  },
  startVaultWatch: () => ipcRenderer.invoke('vault:watch-start', undefined),
  stopVaultWatch: () => ipcRenderer.invoke('vault:watch-stop', undefined),

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
  appQuit: () => ipcRenderer.invoke('app:quit', undefined),
  // SKY-2969: prompt user to keep or delete vaults before uninstalling
  cleanUninstall: () => ipcRenderer.invoke('app:cleanUninstall', undefined),

  // Versioning — per-scene snapshots
  snapshotSave: (sceneId: string, content: string, label?: string) =>
    ipcRenderer.invoke('snapshot:save', { sceneId, content, label }),
  snapshotList: (sceneId: string) =>
    ipcRenderer.invoke('snapshot:list', { sceneId }),
  snapshotGet: (sceneId: string, snapshotId: string) =>
    ipcRenderer.invoke('snapshot:get', { sceneId, snapshotId }),
  snapshotRestore: (sceneId: string, snapshotId: string, scenePath: string) =>
    ipcRenderer.invoke('snapshot:restore', { sceneId, snapshotId, scenePath }),
  snapshotDelete: (sceneId: string, snapshotId: string) =>
    ipcRenderer.invoke('snapshot:delete', { sceneId, snapshotId }),
  snapshotDeleteAll: (sceneId?: string) =>
    ipcRenderer.invoke('snapshot:delete-all', { sceneId }),

  // SKY-1611 — SQLite-backed versioned draft snapshots
  draftsCreate: (sceneId: string, content: string, label?: string) =>
    ipcRenderer.invoke('drafts:create', { sceneId, content, ...(label ? { label } : {}) }),
  draftsList: (sceneId: string) =>
    ipcRenderer.invoke('drafts:list', { sceneId }),
  draftsPreview: (snapshotId: string) =>
    ipcRenderer.invoke('drafts:preview', { snapshotId }),
  draftsRestore: (snapshotId: string, sceneId: string, currentContent: string) =>
    ipcRenderer.invoke('drafts:restore', { snapshotId, sceneId, currentContent }),
  draftsLabel: (snapshotId: string, label: string) =>
    ipcRenderer.invoke('drafts:label', { snapshotId, label }),
  draftsDelete: (snapshotId: string) =>
    ipcRenderer.invoke('drafts:delete', { snapshotId }),

  // SKY-10 — Per-scene versioned drafts (history pane + rollback)
  versionList: (sceneId: string) =>
    ipcRenderer.invoke('version:list', { sceneId }),
  versionGet: (sceneId: string, ts: string) =>
    ipcRenderer.invoke('version:get', { sceneId, ts }),
  versionRollback: (sceneId: string, ts: string) =>
    ipcRenderer.invoke('version:rollback', { sceneId, ts }),
  // Beta 4 M10: explicit snapshot into the SKY-10/M5 store
  versionSave: (sceneId: string, content: string, intent?: string) =>
    ipcRenderer.invoke('version:save', { sceneId, content, intent }),

  // SKY-10 — Legacy single-file-per-chapter migration
  migrationDryRun: (storyPath?: string) =>
    ipcRenderer.invoke('migration:dryRun', { storyPath }),
  migrationApply: (planId: string, storyPath: string) =>
    ipcRenderer.invoke('migration:apply', { planId, storyPath }),

  // Beta 4 M5 — MythosVault (v2) migration wizard. Copy-based; every path is
  // computed main-side from the active vault settings (no renderer paths).
  mythosMigrationStatus: () => ipcRenderer.invoke('mythosMigration:status', undefined),
  mythosMigrationPlan: () => ipcRenderer.invoke('mythosMigration:plan', undefined),
  mythosMigrationRun: () => ipcRenderer.invoke('mythosMigration:run', undefined),
  mythosMigrationConfirm: () => ipcRenderer.invoke('mythosMigration:confirm', undefined),
  mythosMigrationDismiss: () => ipcRenderer.invoke('mythosMigration:dismiss', undefined),

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
  entityLinkedScenes: (entityId: string) =>
    ipcRenderer.invoke('entity:linkedScenes', { entityId }),
  entityRelationshipsList: (entityId: string) =>
    ipcRenderer.invoke('entity:relationships:list', { entityId }),
  entityRelationshipsCreate: (fromEntityId: string, toEntityId: string, label: string) =>
    ipcRenderer.invoke('entity:relationships:create', { fromEntityId, toEntityId, label }),
  entityRelationshipsDelete: (relationshipId: string) =>
    ipcRenderer.invoke('entity:relationships:delete', { relationshipId }),

  // App settings
  settingsGet: () => invokeEnvelope('settings:get', undefined),
  // MYT-788: optional `tokens` carries one-shot registration tokens from
  // voicePickBinary, required when changing the local STT/TTS path fields.
  settingsSet: (settings: unknown, tokens?: { sttBinaryToken?: string; sttModelToken?: string; ttsBinaryToken?: string; ttsModelToken?: string }) =>
    invokeEnvelope('settings:set', { settings, ...(tokens ?? {}) }),
  // MYT-779: test connection to an AI provider.
  settingsTestConnection: (provider: unknown) => invokeEnvelope('settings:testConnection', { provider }),
  // SKY-1499/SKY-1501: list available models from a provider endpoint.
  providerListModels: (payload: unknown) => ipcRenderer.invoke('provider:listModels', payload),
  // MYT-788: main-process file picker for local voice binary / model selection.
  voicePickBinary: (kind: 'stt-binary' | 'tts-binary' | 'tts-model') =>
    ipcRenderer.invoke('voice:pickBinary', { kind }),
  // Per-agent config (MYT-343)
  getAgentConfig: () => ipcRenderer.invoke('settings:getAgentConfig', undefined),
  setAgentConfig: (agent: string, config: unknown) =>
    ipcRenderer.invoke('settings:setAgentConfig', { agent, config }),
  // Per-agent budget usage (MYT-722) — rolling 1-hour token + suggestion totals
  agentBudgetUsage: () => ipcRenderer.invoke('agent:budgetUsage', undefined),

  // Generation log (prompt history)
  generationLogRecent: (payload: { limit?: number; offset?: number; agent?: string; dateFrom?: string; dateTo?: string; search?: string }) =>
    ipcRenderer.invoke('generationLog:recent', payload),

  // Suggestions lifecycle
  suggestionsList: (status?: string, sourceAgent?: string, opts?: { confidenceMin?: number; confidenceMax?: number; limit?: number; offset?: number }) =>
    ipcRenderer.invoke('suggestions:list', { status, sourceAgent, ...opts }),
  suggestionsGet: (id: string) =>
    ipcRenderer.invoke('suggestions:get', { id }),
  suggestionsUpsert: (suggestion: unknown) =>
    ipcRenderer.invoke('suggestions:upsert', { suggestion }),
  suggestionsAccept: (id: string, actor?: string) =>
    ipcRenderer.invoke('suggestions:accept', { id, actor }),
  suggestionsReject: (id: string, reason?: string, actor?: string) =>
    ipcRenderer.invoke('suggestions:reject', { id, reason, actor }),
  suggestionsRollback: (id: string, actor?: string) =>
    ipcRenderer.invoke('suggestions:rollback', { id, actor }),
  suggestionsSearch: (payload: { query: string; sourceAgent?: string; status?: string; confidenceMin?: number; confidenceMax?: number; limit?: number }) =>
    ipcRenderer.invoke('suggestions:search', payload),
  suggestionsIgnore: (id: string, actor?: string) =>
    ipcRenderer.invoke('suggestions:ignore', { id, actor }),
  suggestionsBatchAction: (payload: { ids: string[]; action: 'accept' | 'reject' | 'ignore'; actor?: string }) =>
    ipcRenderer.invoke('suggestions:batch-action', payload),
  suggestionsUnifiedList: (payload: { status?: string; sourceAgent?: string; kind?: string; confidenceMin?: number; confidenceMax?: number; limit?: number; offset?: number }) =>
    ipcRenderer.invoke('suggestions:unified-list', payload),
  auditList: (suggestionId?: string) =>
    ipcRenderer.invoke('audit:list', { suggestionId }),
  provenanceUpsert: (entityId: string, entityKind: string, agentId: string, agentType: string, runId?: string | null) =>
    ipcRenderer.invoke('provenance:upsert', { entityId, entityKind, agentId, agentType, runId }),

  // Generalized token streaming — stream:* channels (MYT-156)
  streamStart: (payload: { messages: Array<{ role: 'user' | 'assistant'; content: string }>; system?: string; model?: string; maxTokens?: number; thinking?: 'adaptive' }) =>
    ipcRenderer.invoke('stream:start', payload),
  streamCancel: (streamId: string) =>
    ipcRenderer.invoke('stream:cancel', { streamId }),
  streamAck: (streamId: string, count: number) =>
    ipcRenderer.send('stream:ack', { streamId, count }),
  onStreamToken: (cb: (data: { streamId: string; token: string }) => void) => {
    const handler = (_: unknown, data: { streamId: string; token: string }) => cb(data);
    ipcRenderer.on('stream:token', handler);
    return () => ipcRenderer.removeListener('stream:token', handler);
  },
  onStreamEnd: (cb: (data: { streamId: string }) => void) => {
    const handler = (_: unknown, data: { streamId: string }) => cb(data);
    ipcRenderer.on('stream:end', handler);
    return () => ipcRenderer.removeListener('stream:end', handler);
  },
  onStreamError: (cb: (data: { streamId: string; category: string; message: string }) => void) => {
    const handler = (_: unknown, data: { streamId: string; category: string; message: string }) => cb(data);
    ipcRenderer.on('stream:error', handler);
    return () => ipcRenderer.removeListener('stream:error', handler);
  },

  // STT (MYT-156) — speech-to-text fill for the brainstorm composer
  sttStart: () => ipcRenderer.send('stt:start'),
  sttStop: () => ipcRenderer.send('stt:stop'),
  onSttResult: (cb: (text: string) => void) => {
    const handler = (_: unknown, data: { text: string }) => cb(data.text);
    ipcRenderer.on('stt:result', handler);
    return () => ipcRenderer.removeListener('stt:result', handler);
  },

  // Vault notes updated push event (MYT-156)
  onVaultNotesUpdated: (cb: (data: { count: number }) => void) => {
    const handler = (_: unknown, data: { count: number }) => cb(data);
    ipcRenderer.on('vault:notes-updated', handler);
    return () => ipcRenderer.removeListener('vault:notes-updated', handler);
  },

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

  // Agent error push events — fires when provider rejects before or during streaming
  onBrainstormError: (cb: (data: { requestId: string; category: string; message: string }) => void) => {
    const handler = (_: unknown, data: { requestId: string; category: string; message: string }) => cb(data);
    ipcRenderer.on('agent:brainstorm:error', handler);
    return () => ipcRenderer.removeListener('agent:brainstorm:error', handler);
  },
  onWritingAssistantError: (cb: (data: { requestId: string; category: string; message: string }) => void) => {
    const handler = (_: unknown, data: { requestId: string; category: string; message: string }) => cb(data);
    ipcRenderer.on('agent:writing-assistant:error', handler);
    return () => ipcRenderer.removeListener('agent:writing-assistant:error', handler);
  },
  onVaultCheckError: (cb: (data: { requestId: string; category: string; message: string }) => void) => {
    const handler = (_: unknown, data: { requestId: string; category: string; message: string }) => cb(data);
    ipcRenderer.on('agent:vault-check:error', handler);
    return () => ipcRenderer.removeListener('agent:vault-check:error', handler);
  },

  // Cancel channels — fire-and-forget, aborts the running stream for the given requestId
  cancelWritingAssistant: (requestId: string) =>
    ipcRenderer.send('agent:writing-assistant:stream-cancel', { requestId }),
  cancelBrainstorm: (requestId: string) =>
    ipcRenderer.send('agent:brainstorm:stream-cancel', { requestId }),
  cancelVaultCheck: (requestId: string) =>
    ipcRenderer.send('agent:vault-check:stream-cancel', { requestId }),

  // Generation log
  generationLogList: (page?: number, pageSize?: number, agent?: string) =>
    ipcRenderer.invoke('generationLog:list', { page, pageSize, agent }),
  generationLogGet: (id: string) =>
    ipcRenderer.invoke('generationLog:get', { id }),

  // Auto-update (MYT-245) — feature-flagged; calls are safe no-ops when MYTHOS_AUTO_UPDATE!=1
  onUpdateStatus: (cb: (data: { state: 'checking' | 'available' | 'not-available' | 'downloading' | 'ready'; version?: string; releaseNotes?: string | null }) => void) => {
    const handler = (_: unknown, data: { state: 'checking' | 'available' | 'not-available' | 'downloading' | 'ready'; version?: string; releaseNotes?: string | null }) => cb(data);
    ipcRenderer.on('update:status', handler);
    return () => ipcRenderer.removeListener('update:status', handler);
  },
  checkForUpdate: () => ipcRenderer.invoke('update:check', undefined),
  getUpdateInfo: () => ipcRenderer.invoke('update:get-info', undefined),
  installUpdate: (quit = true) => ipcRenderer.invoke('update:install', { quit }),
  // MYT-337: stable/beta channel support — returns { available, version, releaseNotes } directly
  appCheckForUpdate: () => ipcRenderer.invoke('app:checkForUpdate', undefined),
  // MYT-337: schedules install on next quit; does NOT trigger immediate restart
  appInstallUpdate: () => ipcRenderer.invoke('app:installUpdate', undefined),

  // Chapter / scene creation — enforces Manuscript/<book>/<chapter>/<scene>.md layout
  chapterCreate: (payload: { storyId: string; title: string; order?: number }) =>
    ipcRenderer.invoke('chapter:create', payload),
  sceneCreate: (payload: { storyId: string; chapterId: string; title: string; order?: number }) =>
    ipcRenderer.invoke('scene:create', payload),
  // SKY-115: inline scene rename (title-only, manifest update)
  sceneRename: (payload: { sceneId: string; title: string }) =>
    ipcRenderer.invoke('scene:rename', payload),
  sceneSave: (payload: { sceneId: string; prose: string; title?: string; order?: number; intent?: string }) =>
    ipcRenderer.invoke('scene:save', payload),

  // Search (MYT-251)
  searchVault: (query: string, scope: 'story' | 'notes' | 'both', limit?: number, filterTags?: string[]) =>
    ipcRenderer.invoke('search:query', { query, scope, limit, filterTags }),

  // Writing Assistant scheduled scan (MYT-233)
  writingScan: (sceneId: string, prose: string, scenePath: string) =>
    ipcRenderer.invoke('writing:scan', { sceneId, prose, scenePath }),
  writingAssistantCadenceChange: (payload: { waScanInterval: number | 'on-save' | 'manual' }) =>
    ipcRenderer.invoke('writing-assistant:cadence-change', payload),
  writingAssistantTipDecision: (payload: { tipId: string; decision: 'accepted' | 'session_suppressed' | 'reported'; sceneId?: string; scenePath?: string; sceneUpdatedAt?: string }) =>
    ipcRenderer.invoke('writing-assistant:tip-decision', payload),
  writingAssistantSuggestionList: (payload: { sceneId?: string; scenePath?: string; status?: string }) =>
    ipcRenderer.invoke('writing-assistant:suggestion:list', payload),
  writingAssistantScanNow: (payload: { sceneId: string; prose: string; scenePath: string }) =>
    ipcRenderer.invoke('writing-assistant:scan-now', payload),
  writingAssistantSetActiveScene: (payload: { sceneId: string | null; scenePath: string | null }) =>
    ipcRenderer.invoke('writing-assistant:set-active-scene', payload),
  // Push: backend scheduler broadcasts completed scan results (MYT-236)
  onWritingScanResult: (cb: (data: { sceneId: string; scenePath: string; tips: string[]; scannedAt: string }) => void) => {
    const handler = (_: unknown, data: { sceneId: string; scenePath: string; tips: string[]; scannedAt: string }) => cb(data);
    ipcRenderer.on('writing:scan:result', handler);
    return () => ipcRenderer.removeListener('writing:scan:result', handler);
  },
  onWritingAssistantScanStart: (cb: (data: { sceneId?: string; scenePath?: string; startedAt: string }) => void) => {
    const handler = (_: unknown, data: { sceneId?: string; scenePath?: string; startedAt: string }) => cb(data);
    ipcRenderer.on('writing-assistant:scan-start', handler);
    return () => ipcRenderer.removeListener('writing-assistant:scan-start', handler);
  },
  onWritingAssistantScanResult: (cb: (data: { sceneId: string; scenePath: string; tips: string[]; scannedAt: string }) => void) => {
    const handler = (_: unknown, data: { sceneId: string; scenePath: string; tips: string[]; scannedAt: string }) => cb(data);
    ipcRenderer.on('writing-assistant:scan-result', handler);
    return () => ipcRenderer.removeListener('writing-assistant:scan-result', handler);
  },
  onWritingAssistantScanError: (cb: (data: { sceneId?: string; scenePath?: string; error: string; occurredAt: string }) => void) => {
    const handler = (_: unknown, data: { sceneId?: string; scenePath?: string; error: string; occurredAt: string }) => cb(data);
    ipcRenderer.on('writing-assistant:scan-error', handler);
    return () => ipcRenderer.removeListener('writing-assistant:scan-error', handler);
  },

  // Archive continuity-check scheduled scan (MYT-234)
  archiveScan: (sceneText: string, scenePath: string) =>
    ipcRenderer.invoke('archive:scan', { sceneText, scenePath }),

  // Beta-Read Mode (MYT-237) — anchored inline comments
  betaReadCreate: (sceneId: string, anchorText: string, commentText: string) =>
    ipcRenderer.invoke('betaRead:create', { sceneId, anchorText, commentText }),
  betaReadList: (sceneId: string) =>
    ipcRenderer.invoke('betaRead:list', { sceneId }),
  betaReadDismiss: (id: string) =>
    ipcRenderer.invoke('betaRead:dismiss', { id }),
  betaReadScan: (sceneId: string, prose: string, scenePath: string) =>
    invokeEnvelope('betaRead:scan', { sceneId, prose, scenePath }),

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
  // voiceTranscribe (MYT-338) — single-shot transcription; returns { text, confidence } or { error }
  voiceTranscribe: (audio: ArrayBuffer, mimeType?: string, language?: string) =>
    ipcRenderer.invoke('voice:transcribe', { audio, mimeType, language }),

  // TTS (MYT-339) — text-to-speech for agent replies; disabled by default (tts.enabled = false)
  voiceSpeak: (text: string, voiceId?: string) =>
    ipcRenderer.invoke('voice:speak', { text, voiceId }),
  voiceSpeakCancel: (speakId: string) =>
    ipcRenderer.send('voice:speak:cancel', { speakId }),
  onVoiceSpeakChunk: (cb: (event: { speakId: string; chunk: Uint8Array }) => void) => {
    const handler = (_: unknown, data: { speakId: string; chunk: Uint8Array }) => cb(data);
    ipcRenderer.on('voice:speak:chunk', handler);
    return () => ipcRenderer.removeListener('voice:speak:chunk', handler);
  },
  onVoiceSpeakDone: (cb: (event: { speakId: string; format?: 'pcm' | 'mp3'; sampleRate?: number }) => void) => {
    const handler = (_: unknown, data: { speakId: string; format?: 'pcm' | 'mp3'; sampleRate?: number }) => cb(data);
    ipcRenderer.on('voice:speak:done', handler);
    return () => ipcRenderer.removeListener('voice:speak:done', handler);
  },
  onVoiceSpeakError: (cb: (event: { speakId: string; error: string }) => void) => {
    const handler = (_: unknown, data: { speakId: string; error: string }) => cb(data);
    ipcRenderer.on('voice:speak:error', handler);
    return () => ipcRenderer.removeListener('voice:speak:error', handler);
  },

  // Budget enforcement (MYT-207) — subscribe to agent:budget-cap push events from main
  onBudgetCapHit: (cb: (event: { agent: string; agentLabel: string; reason: 'hourly_token_cap' | 'daily_token_cap' }) => void) => {
    const handler = (_: unknown, data: { agent: string; agentLabel: string; reason: 'hourly_token_cap' | 'daily_token_cap' }) => cb(data);
    ipcRenderer.on('agent:budget-cap', handler);
    return () => ipcRenderer.removeListener('agent:budget-cap', handler);
  },

  // EPUB export (MYT-342; options Beta 4 M14)
  exportEpub: (storyId: string, metadata?: { title?: string; author?: string; language?: string }, targetPath?: string, options?: { includeSynopsis?: boolean; sceneSeparators?: boolean }) =>
    ipcRenderer.invoke('export:epub', { storyId, metadata, targetPath, options }),

  // DOCX export (MYT-252, extended SKY-153; options Beta 4 M14)
  exportDocx: (storyId: string | undefined, scope?: unknown, options?: { includeSynopsis?: boolean; sceneSeparators?: boolean }) =>
    ipcRenderer.invoke('export:docx', scope ? { scope, options } : { storyId, options }),

  // PDF export (Beta 4 M14, FULL-SPEC §5.5)
  exportPdf: (scope: unknown, options?: { includeSynopsis?: boolean; sceneSeparators?: boolean }) =>
    ipcRenderer.invoke('export:pdf', { scope, options }),

  // Reveal the last exported file in the OS file manager (Beta 4 M14).
  // The path lives in the main process — nothing is passed from here.
  exportRevealLast: () => ipcRenderer.invoke('export:reveal-last', undefined),

  // Markdown export (SKY-153)
  exportMarkdown: (scope: unknown) =>
    ipcRenderer.invoke('export:markdown', { scope }),

  // Plain text export (SKY-153)
  exportPlaintext: (scope: unknown) =>
    ipcRenderer.invoke('export:plaintext', { scope }),

  // Vault Graph View (MYT-249)
  vaultGraphData: () => ipcRenderer.invoke('vault:graph-data', undefined),

  // Notes Vault graph — in-memory link index with degree + category (SKY-1756 / SKY-1743)
  vaultGraphNodes: (scope?: 'notes' | 'story' | 'both') => ipcRenderer.invoke('vault:graph:nodes', scope),
  vaultGraphEdges: (scope?: 'notes' | 'story' | 'both') => ipcRenderer.invoke('vault:graph:edges', scope),

  // Timeline v0 (SKY-2438/SKY-2463) — manifest-backed timeline
  timelineList: () =>
    ipcRenderer.invoke('timeline:list', {}),
  timelineUpsert: (payload: { sceneId: string; day: number; time: string }) =>
    ipcRenderer.invoke('timeline:upsert', payload),
  timelineInfer: (storyId: string) =>
    ipcRenderer.invoke('timeline:infer', { storyId }),

  // SKY-791/SKY-794: Timeline data model + spreadsheet view
  timelineGetSettings: (storyId?: string) =>
    ipcRenderer.invoke('timeline:getSettings', { storyId }),
  timelineSaveSettings: (settings: unknown, storyId?: string) =>
    ipcRenderer.invoke('timeline:saveSettings', { settings, storyId }),
  timelineGetScenes: (storyId: string) =>
    ipcRenderer.invoke('timeline:getScenes', { storyId }),
  timelineUpdateScene: (payload: unknown) =>
    ipcRenderer.invoke('timeline:updateScene', payload),
  timelineUpdateArcColor: (arcId: string, color: string, colorIsCustom: boolean) =>
    ipcRenderer.invoke('timeline:updateArcColor', { arcId, color, colorIsCustom }),
  timelineListArcs: () =>
    ipcRenderer.invoke('timeline:listArcs', {}),

  // SKY-796: Timeline AI auto-population proposals
  timelineProposalsGenerate: (storyId: string) =>
    ipcRenderer.invoke('timeline:proposals:generate', { storyId }),
  timelineProposalsList: (storyId: string) =>
    ipcRenderer.invoke('timeline:proposals:list', { storyId }),
  timelineProposalResolve: (proposalId: string, decision: 'accept' | 'reject') =>
    ipcRenderer.invoke('timeline:proposal:resolve', { proposalId, decision }),

  // Telemetry (MYT-344) — opt-in, off by default
  telemetryReport: (type: string, meta?: Record<string, string | number | boolean>) =>
    ipcRenderer.invoke('telemetry:report', { type, meta }),

  // Multi-project switcher (MYT-374, extended SKY-320)
  projectList: () => ipcRenderer.invoke('project:list', undefined),
  // Beta 4 M2 — per-vault stats for the vault-switcher popover
  projectStats: () => ipcRenderer.invoke('project:stats', undefined),
  projectSwitch: (vaultRoot: string, notesVaultRoot?: string) =>
    ipcRenderer.invoke('project:switch', { vaultRoot, notesVaultRoot }),
  onProjectSwitched: (cb: (data: { vaultRoot: string; notesVaultRoot?: string }) => void) => {
    const handler = (_: unknown, data: { vaultRoot: string; notesVaultRoot?: string }) => cb(data);
    ipcRenderer.on('project:switched', handler);
    return () => ipcRenderer.removeListener('project:switched', handler);
  },

  // One-click Mythos Vault create (SKY-320). The default flow passes no
  // parentPath — main creates the bundle under ~/Mythos/Vaults/.
  vaultCreateDefaultMythos: (opts?: { parentPath?: string; vaultName?: string; seedMode?: 'default' | 'blank' }) =>
    ipcRenderer.invoke('vault:createDefaultMythos', opts ?? {}),

  // Archive confirmation dialog (MYT-376)
  archiveConfirm: (suggestionId: string, action: 'match_archive' | 'suggest_story_change' | 'ignore') =>
    ipcRenderer.invoke('archive:confirm', { suggestionId, action }),
  archiveIgnoreList: () => ipcRenderer.invoke('archive:ignore-list', undefined),

  // Liquid Neon background image (MYT-613)
  pickBgImage: () => ipcRenderer.invoke('bg:pick', undefined),
  loadBgImage: (filePath: string) => ipcRenderer.invoke('bg:load', { filePath }),

  // Writing modes (MYT-347) — Normal / Focus / Edit backend state
  writingModeGet: () => ipcRenderer.invoke('writingMode:get', undefined),
  writingModeSet: (payload: { mode?: string; focusFlags?: Record<string, boolean>; editConfig?: Record<string, boolean> }) =>
    ipcRenderer.invoke('writingMode:set', payload),
  onWritingModeChanged: (cb: (data: { mode: string; focusFlags: Record<string, boolean>; editConfig: Record<string, boolean> }) => void) => {
    const handler = (_: unknown, data: { mode: string; focusFlags: Record<string, boolean>; editConfig: Record<string, boolean> }) => cb(data);
    ipcRenderer.on('writingMode:changed', handler);
    return () => ipcRenderer.removeListener('writingMode:changed', handler);
  },

  // App data backup / restore (MYT-346)
  // SKY-699: outputPath removed — dialog is always required in main process.
  backupAppData: () =>
    ipcRenderer.invoke('app:backupAppData', {}),
  restoreAppData: (confirmed?: boolean) =>
    ipcRenderer.invoke('app:restoreAppData', { confirmed }),

  // Agent persona files (MYT-816; Beta 3 M22 adds write) — per-agent identity files
  agentPersonaRead: (agentName: string, key: string) =>
    ipcRenderer.invoke('agent:persona:read', { agentName, key }),
  agentPersonaReset: (agentName: string, key: string) =>
    ipcRenderer.invoke('agent:persona:reset', { agentName, key }),
  agentPersonaWrite: (agentName: string, key: string, content: string) =>
    ipcRenderer.invoke('agent:persona:write', { agentName, key, content }),

  // SKY-20: Brainstorm Agent routing
  brainstormGetSettings: () =>
    ipcRenderer.invoke('brainstorm:getSettings', undefined),
  brainstormWriteNote: (payload: { category: string; name: string; content: string }) =>
    ipcRenderer.invoke('brainstorm:writeNote', payload),
  brainstormResolveRouting: (payload: { stagedPath: string; category: string; destination: string; remember: boolean }) =>
    ipcRenderer.invoke('brainstorm:resolveRouting', payload),
  brainstormResetCategoryRouting: (category: string) =>
    ipcRenderer.invoke('brainstorm:resetCategoryRouting', { category }),
  brainstormListNotesFolders: () =>
    ipcRenderer.invoke('brainstorm:listNotesFolders', undefined),
  // SKY-196: token-budgeted vault context selection for Brainstorm AI requests
  brainstormSelectContext: (payload: { userMessage: string; conversationText: string; tokenBudget?: number }) =>
    ipcRenderer.invoke('brainstorm:selectContext', payload),
  // SKY-324: one-shot entry enrichment — generate + write a description for a
  // newly created entity without requiring the user to open the Brainstorm panel.
  brainstormEnrichEntry: (payload: { name: string; type: string }) =>
    ipcRenderer.invoke('brainstorm:enrichEntry', payload),

  // SKY-130: persist last-opened scene + cursor position for cross-restart restore.
  sessionSaveScene: (payload: { sceneId: string; scenePath: string; scrollTop: number; cursorLine: number }) =>
    ipcRenderer.invoke('session:saveScene', payload),
  // SKY-156: Project Templates
  templateList: () => ipcRenderer.invoke('template:list', undefined),
  // SKY-780: parentToken must come from a prior vault:pick-folder dialog call.
  templateScaffold: (templateId: string, parentToken: string) =>
    ipcRenderer.invoke('template:scaffold', { templateId, parentToken }),
  templateSaveAs: (name: string) =>
    ipcRenderer.invoke('template:saveAs', { name }),
  // SKY-190: Note Templates
  noteTemplateList: (kind?: string) =>
    ipcRenderer.invoke('note-template:list', { kind }),

  // SKY-204: Daily Notes
  dailyNoteOpenToday: () =>
    ipcRenderer.invoke('dailyNote:openToday', undefined),
  dailyNoteGetStreak: () =>
    ipcRenderer.invoke('dailyNote:getStreak', undefined),

  // SKY-193: Tag Wrangler
  notesTagList: () =>
    ipcRenderer.invoke('notesVault:tag:list', undefined),
  notesTagRename: (oldTag: string, newTag: string) =>
    ipcRenderer.invoke('notesVault:tag:rename', { oldTag, newTag }),
  notesTagMerge: (sourceTag: string, targetTag: string) =>
    ipcRenderer.invoke('notesVault:tag:merge', { sourceTag, targetTag }),

  // SKY-863: Cloud-sync conflict detection + lockfile
  checkVaultConflicts: () =>
    ipcRenderer.invoke('vault:check-conflicts', undefined),
  dismissSyncWarning: () =>
    ipcRenderer.invoke('vault:dismiss-sync-warning', undefined),
  // SKY-1399: manage custom templates
  templateRename: (id: string, name: string) =>
    ipcRenderer.invoke('template:rename', { id, name }),
  templateDelete: (id: string) =>
    ipcRenderer.invoke('template:delete', { id }),
  templateDuplicate: (id: string) =>
    ipcRenderer.invoke('template:duplicate', { id }),
  // SKY-1403: export / import .mythostemplate files
  templateExport: (id: string) =>
    ipcRenderer.invoke('template:export', { id }),
  templateImport: () =>
    ipcRenderer.invoke('template:import', undefined),
  // SKY-1405: drag-drop import — passes filePath to bypass the open-file dialog
  templateImportFromPath: (filePath: string) =>
    ipcRenderer.invoke('template:import', { filePath }),
  // SKY-154: Writing Goals & Progress Dashboard
  goalsGetStats: () => ipcRenderer.invoke('goals:getStats', undefined),
  goalsLogWords: (date: string, wordsAdded: number) =>
    ipcRenderer.invoke('goals:logWords', { date, wordsAdded }),
  goalsSetGoal: (dailyGoal: number) =>
    ipcRenderer.invoke('goals:setGoal', { dailyGoal }),
  goalsResetStreak: () => ipcRenderer.invoke('goals:resetStreak', undefined),


  // SKY-55: per-scene notes
  notesGet: (sceneId: string) => ipcRenderer.invoke('notes:get', { sceneId }),
  notesSet: (sceneId: string, content: string) => ipcRenderer.invoke('notes:set', { sceneId, content }),
  // SKY-1391/SKY-1393: brainstorm → writing-panel bridge
  sceneAppendBrainstormNote: (sceneId: string, content: string) =>
    ipcRenderer.invoke('scene:appendBrainstormNote', { sceneId, content }),

  // SKY-158: Tags
  tagsList: () => ipcRenderer.invoke('tags:list', undefined),
  tagsUpsert: (name: string, color?: string | null) => ipcRenderer.invoke('tags:upsert', { name, color }),
  tagsDelete: (id: string) => ipcRenderer.invoke('tags:delete', { id }),
  tagsRename: (id: string, name: string) => ipcRenderer.invoke('tags:rename', { id, name }),
  tagsForItem: (itemId: string, itemKind: 'scene' | 'entity') => ipcRenderer.invoke('tags:forItem', { itemId, itemKind }),
  tagsSetForItem: (itemId: string, itemKind: 'scene' | 'entity', tags: string[]) => ipcRenderer.invoke('tags:setForItem', { itemId, itemKind, tags }),
  tagsItemsForTag: (tagName: string) => ipcRenderer.invoke('tags:itemsForTag', { tagName }),
  tagsBulkApply: (itemIds: string[], itemKind: 'scene' | 'entity', addTags?: string[], removeTags?: string[]) =>
    ipcRenderer.invoke('tags:bulkApply', { itemIds, itemKind, addTags, removeTags }),
  sceneSetTags: (payload: { sceneId: string; tags: string[] }) => ipcRenderer.invoke('scene:setTags', payload),
  // SKY-203: Note-level backlinks
  noteBacklinks: (notePath: string) =>
    ipcRenderer.invoke('notesVault:backlinks', { notePath }),

  // SKY-194: Iconize — per-node icon IPC
  notesVaultReadIcons: () =>
    ipcRenderer.invoke('notesVault:readIcons', undefined) as unknown as Promise<Record<string, string>>,
  vaultReadIcons: () =>
    ipcRenderer.invoke('vault:readIcons', undefined) as unknown as Promise<Record<string, string>>,
  iconListUserPacks: () =>
    ipcRenderer.invoke('icons:listUserPacks', undefined) as unknown as Promise<{ packName: string; icons: string[] }[]>,
  iconReadSvg: (packName: string, iconName: string) =>
    ipcRenderer.invoke('icons:readSvg', { packName, iconName }) as unknown as Promise<{ svg: string | null }>,

  // SKY-205: Smart Folders — frontmatter-backed persistent queries
  smartFolderList: () =>
    ipcRenderer.invoke('smartFolder:list', undefined),
  smartFolderCreate: (name: string, query: string) =>
    ipcRenderer.invoke('smartFolder:create', { name, query }),
  smartFolderUpdate: (id: string, updates: { name?: string; query?: string }) =>
    ipcRenderer.invoke('smartFolder:update', { id, ...updates }),
  smartFolderDelete: (id: string) =>
    ipcRenderer.invoke('smartFolder:delete', { id }),
  smartFolderQuery: (query: string) =>
    ipcRenderer.invoke('smartFolder:query', { query }),

  // SKY-207: Per-scene custom frontmatter fields
  customFieldsList: () =>
    ipcRenderer.invoke('customFields:list', undefined),
  customFieldsSet: (fields: unknown[]) =>
    ipcRenderer.invoke('customFields:set', { fields }),
  scenePropsGet: (sceneId: string) =>
    ipcRenderer.invoke('scene:propsGet', { sceneId }),
  scenePropsSet: (sceneId: string, customFields: Record<string, unknown>) =>
    ipcRenderer.invoke('scene:propsSet', { sceneId, customFields }),

  // SKY-456: Creative quality controls — spec §5.2 IPC additions
  getPresets: () => ipcRenderer.invoke('preset:getAll', undefined),
  getQualityRubric: () => ipcRenderer.invoke('preset:getRubric', undefined),
  // getRefinementSuggestions wraps stream:start so callers can subscribe to
  // the same onStreamToken / onStreamEnd channels as regular chat streams.
  getRefinementSuggestions: (options: {
    original_text: string;
    refinement_action: string;
    active_preset_id: string;
    additional_instruction?: string;
  }) => {
    const system =
      'You are a creative writing refinement assistant. Apply the requested refinement to the suggestion below, maintaining prose quality. Return only the refined suggestion text — no preamble.';
    const content = [
      `Action: ${options.refinement_action}`,
      options.additional_instruction ? `Additional instruction: ${options.additional_instruction}` : null,
      `Active preset: ${options.active_preset_id}`,
      '',
      `Original suggestion:\n${options.original_text}`,
    ].filter(Boolean).join('\n');
    return ipcRenderer.invoke('stream:start', {
      messages: [{ role: 'user', content }],
      system,
    });
  },

  // SKY-1485: Wave 3.4 proposal queue
  brainstormProposalConfirm: (payload: {
    proposalId: string;
    kind: string;
    extractionConfidence: number;
    timeToDecideMs: number;
    decision: 'confirm' | 'edit_and_confirm';
  }) => ipcRenderer.invoke('brainstorm:proposals:confirm', payload),

  brainstormProposalReject: (payload: {
    proposalId: string;
    title: string;
    kind: string;
    extractionConfidence: number;
    timeToDecideMs: number;
  }) => ipcRenderer.invoke('brainstorm:proposals:reject', payload),

  brainstormExtractProposals: (payload: {
    turnText: string;
    turnId: string;
    existingEntityNames?: string[];
  }) => ipcRenderer.invoke('brainstorm:extractProposals', payload),

  onBrainstormProposalQueued: (cb: (data: { proposals: unknown[] }) => void) => {
    const handler = (_: unknown, data: { proposals: unknown[] }) => cb(data);
    ipcRenderer.on('brainstorm:proposalQueued', handler);
    return () => ipcRenderer.removeListener('brainstorm:proposalQueued', handler);
  },

  // SKY-1686: panel popout window
  panelPopout: (panelId: string, sceneId: string | null) =>
    ipcRenderer.invoke('panel:popout', { panelId, sceneId }),

  onPanelPopoutClosed: (cb: (panelId: string) => void) => {
    const handler = (_: unknown, data: { panelId: string }) => cb(data.panelId);
    ipcRenderer.on('panel:popout-closed', handler);
    return () => ipcRenderer.removeListener('panel:popout-closed', handler);
  },

  // SKY-1697: Wave 2c — free-floating panel windows
  panelFloat: (panelId: string, opts?: { sourceSidebar?: 'left' | 'right'; x?: number; y?: number; width?: number; height?: number }) =>
    ipcRenderer.invoke('panel:float', { panelId, ...opts }),

  panelFloatDockBack: (panelId: string) =>
    ipcRenderer.invoke('panel:float-dock-back', { panelId }),

  panelFloatSetPin: (panelId: string, alwaysOnTop: boolean) =>
    ipcRenderer.invoke('panel:float-set-pin', { panelId, alwaysOnTop }),

  onPanelFloatClosed: (cb: (data: { panelId: string; docked: boolean; bounds: { x: number; y: number; width: number; height: number } }) => void) => {
    const handler = (_: unknown, data: { panelId: string; docked: boolean; bounds: { x: number; y: number; width: number; height: number } }) => cb(data);
    ipcRenderer.on('panel:float-closed', handler);
    return () => ipcRenderer.removeListener('panel:float-closed', handler);
  },

  onPanelFloatBoundsChanged: (cb: (data: { panelId: string; x: number; y: number; width: number; height: number }) => void) => {
    const handler = (_: unknown, data: { panelId: string; x: number; y: number; width: number; height: number }) => cb(data);
    ipcRenderer.on('panel:float-bounds', handler);
    return () => ipcRenderer.removeListener('panel:float-bounds', handler);
  },

  onPanelFloatPinChanged: (cb: (data: { panelId: string; alwaysOnTop: boolean }) => void) => {
    const handler = (_: unknown, data: { panelId: string; alwaysOnTop: boolean }) => cb(data);
    ipcRenderer.on('panel:float-pin-changed', handler);
    return () => ipcRenderer.removeListener('panel:float-pin-changed', handler);
  },

  // SKY-2966: story navigator popout cross-window sync
  navigatorSelectScene: (sceneId: string) =>
    ipcRenderer.invoke('navigator:select-scene', { sceneId }),

  navigatorReportScene: (sceneId: string | null) =>
    ipcRenderer.invoke('navigator:report-scene', { sceneId }),

  navigatorReportManifest: () =>
    ipcRenderer.invoke('navigator:report-manifest', undefined),

  onNavigatorSceneChanged: (cb: (data: { sceneId: string }) => void) => {
    const handler = (_: unknown, data: { sceneId: string }) => cb(data);
    ipcRenderer.on('navigator:scene-changed', handler);
    return () => ipcRenderer.removeListener('navigator:scene-changed', handler);
  },

  onNavigatorSceneSynced: (cb: (data: { sceneId: string | null }) => void) => {
    const handler = (_: unknown, data: { sceneId: string | null }) => cb(data);
    ipcRenderer.on('navigator:scene-synced', handler);
    return () => ipcRenderer.removeListener('navigator:scene-synced', handler);
  },

  onNavigatorManifestChanged: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('navigator:manifest-changed', handler);
    return () => ipcRenderer.removeListener('navigator:manifest-changed', handler);
  },

  // SKY-1684: Archive Agent v1 — continuity scan
  archiveScanContinuity: (sceneId: string, text: string, scope?: string) =>
    ipcRenderer.invoke('archive:scan-continuity', { sceneId, text, scope }),

  archiveResolveContinuity: (itemId: string, action: string, note?: string) =>
    ipcRenderer.invoke('archive:resolve-continuity', { itemId, action, note }),

  archiveListContinuity: (options?: { sceneId?: string; filter?: { status?: string; category?: string } }) =>
    ipcRenderer.invoke('archive:list-continuity', options),

  onArchiveContScanStart: (cb: (data: { sceneId: string; scope: string }) => void) => {
    const handler = (_: unknown, data: { sceneId: string; scope: string }) => cb(data);
    ipcRenderer.on('archive:cont-scan-start', handler);
    return () => ipcRenderer.removeListener('archive:cont-scan-start', handler);
  },

  onArchiveContScanResult: (cb: (data: { sceneId: string; items: unknown[]; tokenUsed: number; partial: boolean }) => void) => {
    const handler = (_: unknown, data: { sceneId: string; items: unknown[]; tokenUsed: number; partial: boolean }) => cb(data);
    ipcRenderer.on('archive:cont-scan-result', handler);
    return () => ipcRenderer.removeListener('archive:cont-scan-result', handler);
  },

  onArchiveContScanError: (cb: (data: { sceneId: string; error: string }) => void) => {
    const handler = (_: unknown, data: { sceneId: string; error: string }) => cb(data);
    ipcRenderer.on('archive:cont-scan-error', handler);
    return () => ipcRenderer.removeListener('archive:cont-scan-error', handler);
  },

  // Beta 3 M23: a continuity item was resolved/ignored anywhere (panel or
  // manuscript comment) — lets the other surface drop the flag live.
  onArchiveContItemResolved: (cb: (data: { itemId: string; sceneId: string; status: string; action: string }) => void) => {
    const handler = (_: unknown, data: { itemId: string; sceneId: string; status: string; action: string }) => cb(data);
    ipcRenderer.on('archive:cont-item-resolved', handler);
    return () => ipcRenderer.removeListener('archive:cont-item-resolved', handler);
  },

  // SKY-1758: Scene Crafter board IPC
  sceneCrafterGetBoard: (storyId: string, storySlug: string) =>
    ipcRenderer.invoke('scene-crafter:get-board', { storyId, storySlug }),
  sceneCrafterCreateBoard: (storyId: string, storySlug: string) =>
    ipcRenderer.invoke('scene-crafter:create-board', { storyId, storySlug }),
  sceneCrafterAddCard: (payload: { storySlug: string; laneIndex: number; card: { wikilink: string; title: string; done?: boolean; tags?: string[] } }) =>
    ipcRenderer.invoke('scene-crafter:add-card', payload),
  sceneCrafterMoveCard: (payload: { storySlug: string; fromLane: number; fromIndex: number; toLane: number; toIndex: number }) =>
    ipcRenderer.invoke('scene-crafter:move-card', payload),
  sceneCrafterToggleCardDone: (payload: { storySlug: string; laneIndex: number; cardIndex: number }) =>
    ipcRenderer.invoke('scene-crafter:toggle-card-done', payload),
  sceneCrafterDeleteCard: (payload: { storySlug: string; laneIndex: number; cardIndex: number }) =>
    ipcRenderer.invoke('scene-crafter:delete-card', payload),
  sceneCrafterAddLane: (storySlug: string, name: string) =>
    ipcRenderer.invoke('scene-crafter:add-lane', { storySlug, name }),
  sceneCrafterRenameLane: (payload: { storySlug: string; laneIndex: number; name: string }) =>
    ipcRenderer.invoke('scene-crafter:rename-lane', payload),
  sceneCrafterDeleteLane: (payload: { storySlug: string; laneIndex: number; force?: boolean }) =>
    ipcRenderer.invoke('scene-crafter:delete-lane', payload),
  sceneCrafterReorderLanes: (payload: { storySlug: string; fromIndex: number; toIndex: number }) =>
    ipcRenderer.invoke('scene-crafter:reorder-lanes', payload),
  sceneCrafterSaveBoard: (payload: { storySlug: string; board: unknown }) =>
    ipcRenderer.invoke('scene-crafter:save-board', payload),

  // SKY-1759: Scene Crafter file-watcher conflict detection
  sceneCrafterClose: (storySlug: string) =>
    ipcRenderer.invoke('scene-crafter:close', { storySlug }),

  onSceneCrafterExternalEdit: (cb: (storySlug: string) => void) => {
    const handler = (_: unknown, data: { storySlug: string }) => cb(data.storySlug);
    ipcRenderer.on('scene-crafter:external-edit', handler);
    return () => ipcRenderer.removeListener('scene-crafter:external-edit', handler);
  },

  // SKY-1764: Brainstorm → Scene Crafter suggestion accept/reject
  sceneCrafterSuggestionAccept: (suggestionId: string, actor?: string) =>
    ipcRenderer.invoke('scene-crafter:suggestion-accept', { suggestionId, actor }),
  sceneCrafterSuggestionReject: (suggestionId: string, actor?: string) =>
    ipcRenderer.invoke('scene-crafter:suggestion-reject', { suggestionId, actor }),

  // SKY-2011: Continuity Peek
  continuityMatchSelection: (selectedText: string, notesVaultRoot: string) =>
    ipcRenderer.invoke('continuity:matchSelection', { selectedText, notesVaultRoot }),

  continuitySearch: (query: string, notesVaultRoot: string) =>
    ipcRenderer.invoke('continuity:search', { query, notesVaultRoot }),

  continuityReadEntity: (path: string) =>
    ipcRenderer.invoke('continuity:readEntity', { path }),

  // SKY-2308: Vault integrity check + manifest rebuild
  checkVaultIntegrity: () =>
    ipcRenderer.invoke('vault:check-integrity', undefined),
  rebuildVaultManifest: () =>
    ipcRenderer.invoke('vault:rebuild-manifest', undefined),

  // SKY-3026: Outline planning surface
  outline: {
    load: (storyVaultPath: string) =>
      ipcRenderer.invoke('outline:load', { storyVaultPath }),
    save: (storyVaultPath: string, data: unknown) =>
      ipcRenderer.invoke('outline:save', { storyVaultPath, data }),
  },

  // SKY-3033: Window chrome controls (frameless main window)
  windowMinimize: () => ipcRenderer.invoke('window:minimize', undefined),
  windowMaximize: () => ipcRenderer.invoke('window:maximize', undefined),
  windowClose: () => ipcRenderer.invoke('window:close', undefined),

  // SKY-6225: Built-in Auto Note Linker
  autoLinkerGetSettings: () => ipcRenderer.invoke('auto-linker:get-settings', undefined),
  autoLinkerSetSettings: (settings: unknown) => ipcRenderer.invoke('auto-linker:set-settings', settings),
  autoLinkerFormatVaultNow: () => ipcRenderer.invoke('auto-linker:format-vault-now', undefined),
  autoLinkerRebuildIndex: () => ipcRenderer.invoke('auto-linker:rebuild-index', undefined),
  // SKY-6306 M21: Multi-timeline store
  timelinesGetStore: () => ipcRenderer.invoke('timelines:getStore', {}),
  timelinesUpsert: (payload: { id?: string; name: string; kind: string; calendar?: Record<string, unknown> }) =>
    ipcRenderer.invoke('timelines:upsert', payload),
  timelinesSetActive: (timelineId: string) =>
    ipcRenderer.invoke('timelines:setActive', { timelineId }),
  // Beta 4 M22: Axis engine — era/span/event/row item persistence
  timelinesUpsertItem: (payload: { type: string; item: Record<string, unknown> }) =>
    ipcRenderer.invoke('timelines:upsertItem', payload),
  timelinesDeleteItem: (payload: { type: string; id: string }) =>
    ipcRenderer.invoke('timelines:deleteItem', payload),

  // SKY-6228: M15 — agent chat sessions
  agentSessions: {
    list: (agent?: string) => ipcRenderer.invoke('agentSession:list', { agent }),
    read: (sessionId: string) => ipcRenderer.invoke('agentSession:read', { sessionId }),
    create: (agent: string, title?: string, greeting?: string) =>
      ipcRenderer.invoke('agentSession:create', { agent, title, greeting }),
    rename: (sessionId: string, title: string) =>
      ipcRenderer.invoke('agentSession:rename', { sessionId, title }),
    duplicate: (sessionId: string) =>
      ipcRenderer.invoke('agentSession:duplicate', { sessionId }),
    delete: (sessionId: string) =>
      ipcRenderer.invoke('agentSession:delete', { sessionId }),
    appendTurns: (sessionId: string, turns: Array<{ role: 'user' | 'agent'; text: string; at: string }>) =>
      ipcRenderer.invoke('agentSession:appendTurns', { sessionId, turns }),
  },

  // SKY-3189 (G3): true when running in a packaged Electron build.
  // Web Speech API does not function in packaged builds (requires Google's servers, absent in shipped app).
  isPackaged: process.env.MYTHOS_IS_PACKAGED === '1',

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
