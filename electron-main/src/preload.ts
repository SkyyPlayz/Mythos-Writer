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

  // Two-vault paths (SKY-9 / MYT-608) — Story Vault + Notes Vault path
  // management surface used by the Settings panel. `vaultSetPaths` triggers
  // a re-seed on the main side, so the renderer can persist user edits in a
  // single round-trip.
  vaultGetPaths: () => ipcRenderer.invoke('vault:getPaths', undefined),
  // SKY-12.2: opts.seedMode = 'default' | 'blank' controls scaffold behavior.
  // Defaults to 'default' (full SKY-15 layout) when absent — backwards-compatible.
  vaultSetPaths: (storyVaultPath: string, notesVaultPath: string, opts?: { seedMode?: 'default' | 'blank' }) =>
    ipcRenderer.invoke('vault:setPaths', { storyVaultPath, notesVaultPath, seedMode: opts?.seedMode }),
  // SKY-12.2: pure filesystem check for the onboarding wizard path-picker.
  validatePath: (p: string) => ipcRenderer.invoke('vault:validate-path', { path: p }),
  // SKY-12.3: copy the bundled sample project into a two-vault layout.
  loadSampleTwoVault: (parentPath: string) =>
    ipcRenderer.invoke('vault:load-sample-twovault', { parentPath }),
  // SKY-12.4: mark onboarding as complete — persists flag without full settings roundtrip.
  onboardingComplete: () => ipcRenderer.invoke('onboarding:complete', undefined),
  // SKY-12.4: debug reset (MYTHOS_DEV=1 only) — clears vault paths so wizard re-appears.
  onboardingReset: () => ipcRenderer.invoke('onboarding:reset', undefined),

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
  // SKY-9: generic folder picker for the Settings panel (decoupled from the
  // Obsidian-import token flow). Returns { path, cancelled }.
  chooseVaultFolder: (title?: string, defaultPath?: string) =>
    ipcRenderer.invoke('vault:chooseFolder', { title, defaultPath }),
  importVault: (sourcePath: string, registrationToken: string) => ipcRenderer.invoke('vault:import', { sourcePath, registrationToken }),
  reindexVault: () => ipcRenderer.invoke('vault:reindex', undefined),
  pickFolder: () => ipcRenderer.invoke('vault:pick-folder', undefined),
  obsidianDryRun: (sourcePath: string, registrationToken: string) => ipcRenderer.invoke('vault:obsidian-dry-run', { sourcePath, registrationToken }),
  obsidianRegister: (sourcePath: string, registrationToken: string) => ipcRenderer.invoke('vault:obsidian-register', { sourcePath, registrationToken }),
  loadSampleProject: (targetPath?: string) => ipcRenderer.invoke('vault:load-sample', { targetPath }),
  createBlankVault: (targetPath: string) => ipcRenderer.invoke('vault:create-blank', { targetPath }),
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

  // Versioning — per-scene snapshots
  snapshotSave: (sceneId: string, content: string, label?: string) =>
    ipcRenderer.invoke('snapshot:save', { sceneId, content, label }),
  snapshotSaveSync: (sceneId: string, content: string) =>
    ipcRenderer.sendSync('snapshot:save-sync', { sceneId, content }),
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

  // SKY-10 — Per-scene versioned drafts (history pane + rollback)
  versionList: (sceneId: string) =>
    ipcRenderer.invoke('version:list', { sceneId }),
  versionGet: (sceneId: string, ts: string) =>
    ipcRenderer.invoke('version:get', { sceneId, ts }),
  versionRollback: (sceneId: string, ts: string) =>
    ipcRenderer.invoke('version:rollback', { sceneId, ts }),

  // SKY-10 — Legacy single-file-per-chapter migration
  migrationDryRun: (storyPath?: string) =>
    ipcRenderer.invoke('migration:dryRun', { storyPath }),
  migrationApply: (planId: string, storyPath: string) =>
    ipcRenderer.invoke('migration:apply', { planId, storyPath }),

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
  // MYT-788: optional `tokens` carries one-shot registration tokens from
  // voicePickBinary, required when changing the local STT/TTS path fields.
  settingsSet: (settings: unknown, tokens?: { sttBinaryToken?: string; ttsBinaryToken?: string; ttsModelToken?: string }) =>
    ipcRenderer.invoke('settings:set', { settings, ...(tokens ?? {}) }),
  // MYT-779: test connection to an AI provider.
  settingsTestConnection: (provider: unknown) => ipcRenderer.invoke('settings:testConnection', { provider }),
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
  suggestionsList: (status?: string, sourceAgent?: string) =>
    ipcRenderer.invoke('suggestions:list', { status, sourceAgent }),
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
  auditList: (suggestionId?: string) =>
    ipcRenderer.invoke('audit:list', { suggestionId }),
  provenanceUpsert: (entityId: string, entityKind: string, agentId: string, agentType: string, runId?: string | null) =>
    ipcRenderer.invoke('provenance:upsert', { entityId, entityKind, agentId, agentType, runId }),

  // Generalized token streaming — stream:* channels (MYT-156)
  streamStart: (payload: { messages: Array<{ role: 'user' | 'assistant'; content: string }>; system?: string; model?: string; maxTokens?: number }) =>
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
  searchVault: (query: string, scope: 'story' | 'notes' | 'both', limit?: number) =>
    ipcRenderer.invoke('search:query', { query, scope, limit }),

  // Writing Assistant scheduled scan (MYT-233)
  writingScan: (sceneId: string, prose: string, scenePath: string) =>
    ipcRenderer.invoke('writing:scan', { sceneId, prose, scenePath }),
  // Push: backend scheduler broadcasts completed scan results (MYT-236)
  onWritingScanResult: (cb: (data: { sceneId: string; scenePath: string; tips: string[]; scannedAt: string }) => void) => {
    const handler = (_: unknown, data: { sceneId: string; scenePath: string; tips: string[]; scannedAt: string }) => cb(data);
    ipcRenderer.on('writing:scan:result', handler);
    return () => ipcRenderer.removeListener('writing:scan:result', handler);
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
  voiceTranscribe: (audio: ArrayBuffer, mimeType?: string) =>
    ipcRenderer.invoke('voice:transcribe', { audio, mimeType }),

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
  onVoiceSpeakDone: (cb: (event: { speakId: string }) => void) => {
    const handler = (_: unknown, data: { speakId: string }) => cb(data);
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

  // EPUB export (MYT-342)
  exportEpub: (storyId: string, metadata?: { title?: string; author?: string; language?: string }, targetPath?: string) =>
    ipcRenderer.invoke('export:epub', { storyId, metadata, targetPath }),

  // DOCX export (MYT-252, extended SKY-153)
  exportDocx: (storyId: string | undefined, scope?: unknown) =>
    ipcRenderer.invoke('export:docx', scope ? { scope } : { storyId }),

  // Markdown export (SKY-153)
  exportMarkdown: (scope: unknown) =>
    ipcRenderer.invoke('export:markdown', { scope }),

  // Plain text export (SKY-153)
  exportPlaintext: (scope: unknown) =>
    ipcRenderer.invoke('export:plaintext', { scope }),

  // Vault Graph View (MYT-249)
  vaultGraphData: () => ipcRenderer.invoke('vault:graph-data', undefined),

  // Timeline (MYT-319) — Archive-inferred chronology
  timelineList: (scenePath?: string) =>
    ipcRenderer.invoke('timeline:list', { scenePath }),
  timelineUpsert: (entry: unknown) =>
    ipcRenderer.invoke('timeline:upsert', { entry }),
  timelineInfer: (storyId: string) =>
    ipcRenderer.invoke('timeline:infer', { storyId }),

  // Telemetry (MYT-344) — opt-in, off by default
  telemetryReport: (type: string, meta?: Record<string, string | number | boolean>) =>
    ipcRenderer.invoke('telemetry:report', { type, meta }),

  // Multi-project switcher (MYT-374)
  projectList: () => ipcRenderer.invoke('project:list', undefined),
  projectSwitch: (vaultRoot: string) => ipcRenderer.invoke('project:switch', { vaultRoot }),
  onProjectSwitched: (cb: (data: { vaultRoot: string }) => void) => {
    const handler = (_: unknown, data: { vaultRoot: string }) => cb(data);
    ipcRenderer.on('project:switched', handler);
    return () => ipcRenderer.removeListener('project:switched', handler);
  },

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
  backupAppData: (outputPath?: string) =>
    ipcRenderer.invoke('app:backupAppData', outputPath ? { outputPath } : {}),
  restoreAppData: (archivePath?: string, confirmed?: boolean) =>
    ipcRenderer.invoke('app:restoreAppData', { archivePath, confirmed }),

  // Agent persona files (MYT-816) — view/reset per-agent AGENTS/HEARTBEAT/SOUL/TOOLS files
  agentPersonaRead: (agentName: string, key: string) =>
    ipcRenderer.invoke('agent:persona:read', { agentName, key }),
  agentPersonaReset: (agentName: string, key: string) =>
    ipcRenderer.invoke('agent:persona:reset', { agentName, key }),

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

  // SKY-130: persist last-opened scene + cursor position for cross-restart restore.
  sessionSaveScene: (payload: { sceneId: string; scenePath: string; scrollTop: number; cursorLine: number }) =>
    ipcRenderer.invoke('session:saveScene', payload),
  // SKY-55: per-scene notes persisted to vault DB
  notesGet: (sceneId: string) =>
    ipcRenderer.invoke('notes:get', { sceneId }),
  notesSet: (sceneId: string, content: string) =>
    ipcRenderer.invoke('notes:set', { sceneId, content }),
  // SKY-156: Project Templates
  templateList: () => ipcRenderer.invoke('template:list', undefined),
  templateScaffold: (templateId: string, storyVaultPath: string, notesVaultPath: string) =>
    ipcRenderer.invoke('template:scaffold', { templateId, storyVaultPath, notesVaultPath }),
  templateSaveAs: (name: string) =>
    ipcRenderer.invoke('template:saveAs', { name }),

  // SKY-154: Writing Goals & Progress Dashboard
  goalsGetStats: () => ipcRenderer.invoke('goals:getStats', undefined),
  goalsLogWords: (date: string, wordsAdded: number) =>
    ipcRenderer.invoke('goals:logWords', { date, wordsAdded }),
  goalsSetGoal: (dailyGoal: number) =>
    ipcRenderer.invoke('goals:setGoal', { dailyGoal }),
  goalsResetStreak: () => ipcRenderer.invoke('goals:resetStreak', undefined),
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
