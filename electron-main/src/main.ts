// Main process entry — Electron app lifecycle + IPC handlers
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { createRequire } from 'node:module';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { autoUpdater } from 'electron-updater';
import Anthropic from '@anthropic-ai/sdk';
import {
  setupIpcMain,
  IPC_CHANNELS,
  type IpcHandlers,
  type VaultReadPayload,
  type VaultReadResponse,
  type VaultWritePayload,
  type VaultWriteResponse,
  type VaultListPayload,
  type VaultListResponse,
  type VaultDeletePayload,
  type VaultDeleteResponse,
  type Manifest,
  type ManifestWritePayload,
  type ManifestWriteResponse,
  type AppReadyResponse,
  type BrainstormerPayload,
  type BrainstormerResponse,
  type WritingAssistantPayload,
  type WritingAssistantResponse,
  type ArchivePayload,
  type ArchiveResponse,
  type SystemInfo,
  type VaultImportPayload,
  type SnapshotSavePayload,
  type SnapshotListPayload,
  type SnapshotGetPayload,
  type SnapshotRestorePayload,
  type EntityCreatePayload,
  type EntityReadPayload,
  type EntityUpdatePayload,
  type EntityDeletePayload,
  type EntityListPayload,
  type EntityBacklinksPayload,
  type AgentWritingAssistantPayload,
  type AgentBrainstormPayload,
  type VaultCheckPayload,
  type VaultIndexEntry,
  type VaultCheckInconsistency,
  type AppSettings,
  type SettingsSetPayload,
  type SuggestionsListPayload,
  type SuggestionsUpsertPayload,
  type SuggestionsAcceptPayload,
  type SuggestionsApplyPayload,
  type SuggestionsRejectPayload,
  type SuggestionsRollbackPayload,
  type AuditListPayload,
  type TimelineListPayload,
  type TimelineUpsertPayload,
  type GenerationLogRecentPayload,
  type ArchiveScanPayload,
} from './ipc.js';
import {
  openDb,
  closeDb,
  getDb,
  upsertSuggestion,
  updateSuggestionStatus,
  updateSuggestionBudgetExceeded,
  getSuggestion,
  listSuggestions,
  insertAuditLog,
  listAuditLog,
  upsertTimelineEntry,
  listTimelineEntries,
  insertGenerationLog,
  listGenerationLog,
  countGenerationLog,
  getGenerationLogEntry,
  truncateGenerationLogBody,
} from './db.js';
import { evaluateAutoApply } from './budget.js';
import { saveSnapshot, listSnapshots, getSnapshot } from './snapshots.js';
import {
  readVaultFile,
  writeVaultFile,
  listVaultFiles,
  deleteVaultFile,
  readManifest,
  writeManifest,
  defaultManifest,
  reindexVault,
  importObsidianVault,
  startVaultWatcher,
  stopVaultWatcher,
  parseFrontmatter,
  serializeFrontmatter,
  safePath,
} from './vault.js';
import { openManifest } from './manifest.js';
import {
  createEntity,
  readEntity,
  updateEntity,
  deleteEntity,
  listEntities,
  reindexEntities,
  getEntityBacklinks,
} from './entities.js';
import {
  buildArchiveIndex,
  getArchiveIndex,
  getArchiveStatus,
  runArchiveScan,
} from './archiveAgent.js';

const require = createRequire(import.meta.url);

// ─── State ───
let mainWindow: BrowserWindow | null = null;

// Maps requestId → AbortController for in-flight streaming agent calls.
// Populated on invoke, cleaned up in finally block or on cancel.
const agentControllers = new Map<string, AbortController>();

function registerAgentCancelHandlers(): void {
  for (const channel of [
    'agent:writing-assistant:stream-cancel',
    'agent:brainstorm:stream-cancel',
    'agent:vault-check:stream-cancel',
  ] as const) {
    ipcMain.on(channel, (_event, { requestId }: { requestId: string }) => {
      agentControllers.get(requestId)?.abort();
      agentControllers.delete(requestId);
    });
  }
}

// ─── Vault root ───
// User can open any local folder as their vault; the chosen path is persisted
// in userData/vault-settings.json so it survives restarts.
function getVaultSettingsPath(): string {
  return path.join(app.getPath('userData'), 'vault-settings.json');
}

function loadVaultSettings(): { vaultRoot: string } {
  const settingsPath = getVaultSettingsPath();
  if (fs.existsSync(settingsPath)) {
    try {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch {
      // fall through to default
    }
  }
  return { vaultRoot: path.join(app.getPath('userData'), 'vault') };
}

function saveVaultSettings(settings: { vaultRoot: string }): void {
  fs.writeFileSync(getVaultSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
}

const getVaultRoot = () => loadVaultSettings().vaultRoot;
const getManifestPath = () => path.join(getVaultRoot(), 'manifest.json');

function ensureVaultDir() {
  const vaultRoot = getVaultRoot();
  if (!fs.existsSync(vaultRoot)) {
    fs.mkdirSync(vaultRoot, { recursive: true });
  }
  const manifestPath = getManifestPath();
  if (!fs.existsSync(manifestPath)) {
    writeManifest(manifestPath, defaultManifest(vaultRoot));
  } else {
    // Migrate legacy manifests to current schema version on every vault open.
    openManifest(manifestPath);
  }
  openDb(vaultRoot);
}

// Notify renderer when vault changes so it can refresh state
function notifyVaultChanged(filePath: string) {
  if (mainWindow) {
    mainWindow.webContents.send('vault:file-changed', { path: filePath });
    // Debounced reindex — auto-sync markdown prose back to manifest
    scheduleReindex();
  }
}

let reindexTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleReindex() {
  if (reindexTimer) clearTimeout(reindexTimer);
  reindexTimer = setTimeout(() => {
    try {
      const vaultRoot = getVaultRoot();
      const manifestPath = getManifestPath();
      const manifest = readManifest(manifestPath);
      const { manifest: updated } = reindexVault(vaultRoot, manifest);
      writeManifest(manifestPath, updated);
    } catch {
      // non-fatal — next open will reindex
    }
    reindexTimer = null;
  }, 1000);
}

// ─── IPC Handlers ───
const handlers: IpcHandlers = {
  [IPC_CHANNELS.VAULT_READ]: (payload: VaultReadPayload): VaultReadResponse => {
    ensureVaultDir();
    return readVaultFile(getVaultRoot(), payload.path);
  },
  [IPC_CHANNELS.VAULT_WRITE]: (payload: VaultWritePayload): VaultWriteResponse => {
    ensureVaultDir();
    return writeVaultFile(getVaultRoot(), payload.path, payload.content);
  },
  [IPC_CHANNELS.VAULT_LIST]: (payload: VaultListPayload): VaultListResponse => {
    ensureVaultDir();
    return listVaultFiles(getVaultRoot(), payload.root);
  },
  [IPC_CHANNELS.VAULT_DELETE]: (payload: VaultDeletePayload): VaultDeleteResponse => {
    ensureVaultDir();
    return deleteVaultFile(getVaultRoot(), payload.path);
  },
  [IPC_CHANNELS.VAULT_MANIFEST_READ]: () => {
    ensureVaultDir();
    // Reindex on open so direct markdown edits sync back
    const manifest = readManifest(getManifestPath());
    const { manifest: synced } = reindexVault(getVaultRoot(), manifest);
    writeManifest(getManifestPath(), synced);
    return synced;
  },
  [IPC_CHANNELS.VAULT_MANIFEST_WRITE]: (payload: ManifestWritePayload): ManifestWriteResponse => {
    ensureVaultDir();
    writeManifest(getManifestPath(), payload.manifest);
    const bytes = Buffer.byteLength(JSON.stringify(payload.manifest, null, 2), 'utf-8');
    return { path: getManifestPath(), bytes };
  },
  [IPC_CHANNELS.VAULT_OPEN_FOLDER]: async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Open Vault Folder',
      buttonLabel: 'Open as Vault',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { vaultRoot: null, cancelled: true };
    }
    const newRoot = result.filePaths[0];
    saveVaultSettings({ vaultRoot: newRoot });
    ensureVaultDir();
    await stopVaultWatcher();
    await startVaultWatcher(newRoot, notifyVaultChanged);
    return { vaultRoot: newRoot, cancelled: false };
  },
  [IPC_CHANNELS.VAULT_GET_ROOT]: () => {
    ensureVaultDir();
    return { vaultRoot: getVaultRoot() };
  },
  [IPC_CHANNELS.VAULT_IMPORT]: async (payload: VaultImportPayload) => {
    ensureVaultDir();
    const manifest = readManifest(getManifestPath());
    const result = importObsidianVault(payload.sourcePath, getVaultRoot(), manifest);
    // Reindex after import
    const { manifest: updated } = reindexVault(getVaultRoot(), manifest);
    writeManifest(getManifestPath(), updated);
    return result;
  },
  [IPC_CHANNELS.VAULT_REINDEX]: () => {
    ensureVaultDir();
    const manifest = readManifest(getManifestPath());
    const { manifest: updated, scanned, updated: count } = reindexVault(getVaultRoot(), manifest);
    writeManifest(getManifestPath(), updated);
    return { scanned, updated: count };
  },
  [IPC_CHANNELS.VAULT_WATCH_START]: async () => {
    ensureVaultDir();
    await startVaultWatcher(getVaultRoot(), notifyVaultChanged);
    return { watching: true };
  },
  [IPC_CHANNELS.VAULT_WATCH_STOP]: async () => {
    await stopVaultWatcher();
    return { watching: false };
  },
  // ─── Suggestions ───
  [IPC_CHANNELS.SUGGESTIONS_LIST]: (payload: SuggestionsListPayload) => {
    ensureVaultDir();
    return { suggestions: listSuggestions(payload.status, payload.sourceAgent) };
  },
  [IPC_CHANNELS.SUGGESTIONS_UPSERT]: (payload: SuggestionsUpsertPayload) => {
    ensureVaultDir();
    upsertSuggestion(payload.suggestion);

    // Auto-apply policy: evaluate immediately after insert.
    const settingsKey = SOURCE_AGENT_TO_SETTINGS_KEY[payload.suggestion.source_agent];
    if (settingsKey) {
      const agentSettings = loadAppSettings().agents[settingsKey];
      const result = evaluateAutoApply(
        payload.suggestion.confidence,
        payload.suggestion.source_agent,
        agentSettings,
        getDb(),
      );
      if (result.shouldAutoApply) {
        const now = new Date().toISOString();
        const auditId = crypto.randomUUID();
        updateSuggestionStatus(payload.suggestion.id, 'accepted', now, 'auto-apply');
        insertAuditLog({
          id: auditId,
          suggestion_id: payload.suggestion.id,
          action: 'apply',
          snapshot_path: null,
          actor: 'auto_applied',
          created_at: now,
        });
      } else if (result.budgetExceeded) {
        updateSuggestionBudgetExceeded(payload.suggestion.id, true);
      }
    }

    return { id: payload.suggestion.id };
  },
  [IPC_CHANNELS.SUGGESTIONS_ACCEPT]: (payload: SuggestionsAcceptPayload) => {
    ensureVaultDir();
    const now = new Date().toISOString();
    const auditId = crypto.randomUUID();
    const suggestion = getSuggestion(payload.id);
    if (!suggestion) throw new Error(`Suggestion not found: ${payload.id}`);

    let finalStatus: 'accepted' | 'applied' = 'accepted';
    let snapshotPath: string | null = null;

    if (suggestion.target_kind === 'vault' && suggestion.target_path && suggestion.payload_json) {
      const snapshotDir = path.join(getVaultRoot(), '.mythos', 'suggestion-snapshots');
      if (!fs.existsSync(snapshotDir)) fs.mkdirSync(snapshotDir, { recursive: true });
      const relSnapshotPath = path.join('.mythos', 'suggestion-snapshots', `${payload.id}.json`);
      const fullSnapshotPath = path.join(getVaultRoot(), relSnapshotPath);

      let originalContent = '';
      try {
        const { content } = readVaultFile(getVaultRoot(), suggestion.target_path);
        originalContent = content;
      } catch { /* new file — empty original is fine */ }
      fs.writeFileSync(fullSnapshotPath, JSON.stringify({ originalContent, path: suggestion.target_path }), 'utf-8');
      snapshotPath = relSnapshotPath;

      const payloadData = JSON.parse(suggestion.payload_json) as { content?: string; prose?: string };
      const newContent = payloadData.content ?? payloadData.prose ?? originalContent;
      const { frontmatter, prose } = parseFrontmatter(newContent);
      frontmatter['provenance'] = payload.id;
      writeVaultFile(getVaultRoot(), suggestion.target_path, serializeFrontmatter(frontmatter, prose));
      finalStatus = 'applied';
    }

    updateSuggestionStatus(payload.id, finalStatus, now);
    insertAuditLog({
      id: auditId,
      suggestion_id: payload.id,
      action: finalStatus === 'applied' ? 'apply' : 'accept',
      snapshot_path: snapshotPath,
      actor: payload.actor ?? 'user',
      created_at: now,
    });
    return { id: payload.id, status: finalStatus, auditId };
  },
  [IPC_CHANNELS.SUGGESTIONS_APPLY]: (payload: SuggestionsApplyPayload) => {
    ensureVaultDir();
    if (payload.snapshotPath) {
      safePath(getVaultRoot(), payload.snapshotPath); // throws on path traversal
    }
    const now = new Date().toISOString();
    const auditId = crypto.randomUUID();
    updateSuggestionStatus(payload.id, 'accepted', now, payload.appliedRunId);
    insertAuditLog({
      id: auditId,
      suggestion_id: payload.id,
      action: 'apply',
      snapshot_path: payload.snapshotPath ?? null,
      actor: payload.actor ?? 'user',
      created_at: now,
    });
    return { id: payload.id, auditId };
  },
  [IPC_CHANNELS.SUGGESTIONS_REJECT]: (payload: SuggestionsRejectPayload) => {
    ensureVaultDir();
    const now = new Date().toISOString();
    const auditId = crypto.randomUUID();
    updateSuggestionStatus(payload.id, 'rejected');
    insertAuditLog({
      id: auditId,
      suggestion_id: payload.id,
      action: 'reject',
      snapshot_path: null,
      actor: payload.actor ?? 'user',
      created_at: now,
    });
    return { id: payload.id, auditId };
  },
  [IPC_CHANNELS.SUGGESTIONS_ROLLBACK]: (payload: SuggestionsRollbackPayload) => {
    ensureVaultDir();
    const now = new Date().toISOString();
    const auditId = crypto.randomUUID();
    const suggestion = getSuggestion(payload.id);
    if (!suggestion) throw new Error(`Suggestion not found: ${payload.id}`);
    if (suggestion.status !== 'applied') {
      throw new Error(`Suggestion ${payload.id} is not in 'applied' state (current: ${suggestion.status})`);
    }

    const applyEntry = listAuditLog(payload.id).find((e) => e.action === 'apply');
    let restoredPath: string | null = null;

    if (applyEntry?.snapshot_path && suggestion.target_path) {
      safePath(getVaultRoot(), applyEntry.snapshot_path); // throws on path traversal
      const fullSnapshotPath = path.join(getVaultRoot(), applyEntry.snapshot_path);
      if (fs.existsSync(fullSnapshotPath)) {
        const snapshot = JSON.parse(fs.readFileSync(fullSnapshotPath, 'utf-8')) as { originalContent: string; path: string };
        writeVaultFile(getVaultRoot(), snapshot.path, snapshot.originalContent);
        restoredPath = snapshot.path;
      }
    }

    updateSuggestionStatus(payload.id, 'rolled_back');
    insertAuditLog({
      id: auditId,
      suggestion_id: payload.id,
      action: 'rollback',
      snapshot_path: applyEntry?.snapshot_path ?? null,
      actor: payload.actor ?? 'user',
      created_at: now,
    });
    return { id: payload.id, auditId, restoredPath };
  },

  // ─── Audit log ───
  [IPC_CHANNELS.AUDIT_LIST]: (payload: AuditListPayload) => {
    ensureVaultDir();
    return { entries: listAuditLog(payload.suggestionId) };
  },

  // ─── Timeline ───
  [IPC_CHANNELS.TIMELINE_LIST]: (payload: TimelineListPayload) => {
    ensureVaultDir();
    return { entries: listTimelineEntries(payload.scenePath) };
  },
  [IPC_CHANNELS.TIMELINE_UPSERT]: (payload: TimelineUpsertPayload) => {
    ensureVaultDir();
    upsertTimelineEntry(payload.entry);
    return { id: payload.entry.id };
  },

  [IPC_CHANNELS.APP_READY]: (): AppReadyResponse => ({
    platform: process.platform,
    electronVersion: process.versions.electron,
    appVersion: require('../../package.json').version,
  }),
  [IPC_CHANNELS.APP_QUIT]: () => app.quit(),
  [IPC_CHANNELS.AI_BRAINSTORMER]: (payload: BrainstormerPayload): BrainstormerResponse => {
    // Legacy stub — new code uses AGENT_BRAINSTORM channel
    return {
      suggestions: [`Brainstormer: ideas for "${payload.topic}"`],
      confidence: 0.5,
      provenance: 'agent:brainstormer',
    };
  },
  [IPC_CHANNELS.AI_WRITING_ASSISTANT]: (payload: WritingAssistantPayload): WritingAssistantResponse => {
    // Stub — will be fully implemented in Epic 5
    return {
      tips: ['Writing Assistant: scanning manuscript (stub — full impl in Epic 5)'],
      suggestions: [],
    };
  },
  [IPC_CHANNELS.AI_ARCHIVE]: (payload: ArchivePayload): ArchiveResponse => {
    // Stub — will be fully implemented in Epic 5
    return {
      links: [],
      timelinePlacements: [],
      inconsistencies: [],
    };
  },
  [IPC_CHANNELS.SYSTEM_INFO]: (): SystemInfo => ({
    platform: process.platform,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
  }),
  [IPC_CHANNELS.SNAPSHOT_SAVE]: (payload: SnapshotSavePayload) => {
    ensureVaultDir();
    const { snapshots: retention } = loadAppSettings();
    return saveSnapshot(getVaultRoot(), payload.sceneId, payload.content, retention);
  },
  [IPC_CHANNELS.SNAPSHOT_LIST]: (payload: SnapshotListPayload) => {
    ensureVaultDir();
    return { snapshots: listSnapshots(getVaultRoot(), payload.sceneId) };
  },
  [IPC_CHANNELS.SNAPSHOT_GET]: (payload: SnapshotGetPayload) => {
    ensureVaultDir();
    return { snapshot: getSnapshot(getVaultRoot(), payload.sceneId, payload.snapshotId) };
  },
  [IPC_CHANNELS.SNAPSHOT_RESTORE]: (payload: SnapshotRestorePayload) => {
    ensureVaultDir();
    const target = getSnapshot(getVaultRoot(), payload.sceneId, payload.snapshotId);
    if (!target) throw new Error(`Snapshot not found: ${payload.snapshotId}`);
    // Read current content to snapshot it first
    let currentContent = '';
    try {
      const { content } = readVaultFile(getVaultRoot(), payload.scenePath);
      currentContent = content;
    } catch { /* new file */ }
    const { snapshots: retention } = loadAppSettings();
    const preRestoreSnapshot = saveSnapshot(getVaultRoot(), payload.sceneId, currentContent, retention);
    // Audit log: action=rollback, snapshot_path holds prior content hash for traceability
    insertAuditLog({
      id: crypto.randomUUID(),
      suggestion_id: payload.sceneId,
      action: 'rollback',
      snapshot_path: preRestoreSnapshot.contentHash,
      actor: 'user',
      created_at: new Date().toISOString(),
    });
    // Write the restored content to vault markdown
    writeVaultFile(getVaultRoot(), payload.scenePath, target.content);
    return { restored: target, preRestoreSnapshot };
  },

  // ─── Entity CRUD ───
  [IPC_CHANNELS.ENTITY_CREATE]: (payload: EntityCreatePayload) => {
    ensureVaultDir();
    const manifest = readManifest(getManifestPath());
    const entry = createEntity(getVaultRoot(), manifest, payload);
    writeManifest(getManifestPath(), manifest);
    return entry;
  },
  [IPC_CHANNELS.ENTITY_READ]: (payload: EntityReadPayload) => {
    ensureVaultDir();
    const manifest = readManifest(getManifestPath());
    return readEntity(getVaultRoot(), manifest, payload.id);
  },
  [IPC_CHANNELS.ENTITY_UPDATE]: (payload: EntityUpdatePayload) => {
    ensureVaultDir();
    const manifest = readManifest(getManifestPath());
    const entry = updateEntity(getVaultRoot(), manifest, payload.id, {
      name: payload.name,
      aliases: payload.aliases,
      tags: payload.tags,
      prose: payload.prose,
      properties: payload.properties,
    });
    writeManifest(getManifestPath(), manifest);
    return entry;
  },
  [IPC_CHANNELS.ENTITY_DELETE]: (payload: EntityDeletePayload) => {
    ensureVaultDir();
    const manifest = readManifest(getManifestPath());
    const result = deleteEntity(getVaultRoot(), manifest, payload.id);
    writeManifest(getManifestPath(), manifest);
    return result;
  },
  [IPC_CHANNELS.ENTITY_LIST]: (payload: EntityListPayload) => {
    ensureVaultDir();
    const manifest = readManifest(getManifestPath());
    reindexEntities(getVaultRoot(), manifest);
    writeManifest(getManifestPath(), manifest);
    return { entities: listEntities(getVaultRoot(), manifest, payload.type) };
  },
  [IPC_CHANNELS.ENTITY_BACKLINKS]: (payload: EntityBacklinksPayload) => {
    ensureVaultDir();
    const manifest = readManifest(getManifestPath());
    return getEntityBacklinks(getVaultRoot(), manifest, payload.entityId);
  },

  [IPC_CHANNELS.SETTINGS_GET]: (): AppSettings => {
    const s = loadAppSettings();
    return { ...s, apiKey: maskApiKey(s.apiKey) };
  },
  [IPC_CHANNELS.SETTINGS_SET]: (payload: SettingsSetPayload) => {
    const current = loadAppSettings();
    // Preserve the stored key when the renderer echoes back the masked preview unchanged.
    const apiKey = payload.settings.apiKey === maskApiKey(current.apiKey)
      ? current.apiKey
      : payload.settings.apiKey;
    saveAppSettings({ ...payload.settings, apiKey });
    return { saved: true };
  },

  [IPC_CHANNELS.GENERATION_LOG_RECENT]: (payload: GenerationLogRecentPayload) => {
    ensureVaultDir();
    return { entries: listGenerationLog({ limit: payload.limit, agent: payload.agent }).map(truncateGenerationLogBody) };
  },

  // ─── Vault graph (MYT-163) ───
  [IPC_CHANNELS.VAULT_GRAPH_DATA]: async () => {
    ensureVaultDir();
    const manifest = readManifest(getManifestPath());
    const nodes = manifest.entities.map((e) => ({
      id: e.id,
      label: e.name,
      type: e.type,
      path: e.path,
    }));
    return { nodes, edges: [] };
  },

  // ─── Archive Agent (MYT-157) ───
  [IPC_CHANNELS.ARCHIVE_STATUS]: () => {
    return getArchiveStatus();
  },

  [IPC_CHANNELS.ARCHIVE_SCAN]: (payload: ArchiveScanPayload) => {
    ensureVaultDir();
    let index = getArchiveIndex();
    if (!index) {
      const manifest = readManifest(getManifestPath());
      reindexEntities(getVaultRoot(), manifest);
      index = buildArchiveIndex(getVaultRoot(), manifest);
    }
    const result = runArchiveScan(payload.sceneText, index, payload.scenePath);
    for (const suggestion of result.suggestions) {
      upsertSuggestion(suggestion);
    }
    return {
      suggestions: result.suggestions,
      inconsistenciesFound: result.inconsistenciesFound,
      wikiLinksFound: result.wikiLinksFound,
    };
  },

};

// ─── Create BrowserWindow ───
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Mythos Writer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load the Vite-built renderer
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    // electron-vite outputs renderer to out/renderer/ relative to out/main/
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── Auto-updater (MYT-210) ───
// Feature-flagged: only active when MYTHOS_AUTO_UPDATE=1 (set in production CI/release builds).
// During development and staging builds this block is inert — the IPC handlers are still
// registered so the renderer can call them safely, but they no-op.
const AUTO_UPDATE_ENABLED = process.env.MYTHOS_AUTO_UPDATE === '1';

type UpdateState = 'checking' | 'available' | 'not-available' | 'downloading' | 'ready';

function sendUpdateStatus(state: UpdateState) {
  if (mainWindow) {
    mainWindow.webContents.send('update:status', { state });
  }
}

function initAutoUpdater() {
  // Register IPC handlers regardless of flag so renderer calls don't throw.
  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, () => {
    if (!AUTO_UPDATE_ENABLED || !app.isPackaged) return { queued: false, reason: 'disabled' };
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    return { queued: true };
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_INSTALL, () => {
    if (!AUTO_UPDATE_ENABLED) return { ok: false, reason: 'disabled' };
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  });

  if (!AUTO_UPDATE_ENABLED) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', () => { /* non-fatal — silenced to avoid noise on dev builds */ });
  autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking'));
  autoUpdater.on('update-available', () => sendUpdateStatus('available'));
  autoUpdater.on('update-not-available', () => sendUpdateStatus('not-available'));
  autoUpdater.on('download-progress', () => sendUpdateStatus('downloading'));
  autoUpdater.on('update-downloaded', () => sendUpdateStatus('ready'));

  // Only poll in packaged production builds to avoid hitting GitHub API during dev.
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch(() => { /* silenced */ });
  }
}

// ─── App settings persistence ───

const AGENT_BUDGET_DEFAULTS = {
  autoApply: false,
  confidenceThreshold: 0.85,
  maxTokensPerHour: 100_000,
  maxSuggestionsPerHour: 50,
};

const SETTINGS_DEFAULTS: AppSettings = {
  apiKey: '',
  agents: {
    writingAssistant: { enabled: true, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, ...AGENT_BUDGET_DEFAULTS },
    brainstorm: { enabled: true, model: 'claude-sonnet-4-6', ...AGENT_BUDGET_DEFAULTS },
    archive: { enabled: true, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, ...AGENT_BUDGET_DEFAULTS },
  },
  theme: 'dark',
  snapshots: { maxPerScene: 100, maxAgeDays: 30 },
};

/** Maps source_agent DB value → settings key. Unknown agents have no budget enforcement. */
const SOURCE_AGENT_TO_SETTINGS_KEY: Record<string, keyof AppSettings['agents']> = {
  'writing-assistant': 'writingAssistant',
  'brainstorm': 'brainstorm',
  'archive': 'archive',
};

function getAppSettingsPath(): string {
  return path.join(app.getPath('userData'), 'app-settings.json');
}

function loadAppSettings(): AppSettings {
  const settingsPath = getAppSettingsPath();
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Partial<AppSettings>;
      type AgentsRaw = Partial<AppSettings['agents']>;
      const rawAgents: AgentsRaw = (raw.agents as AgentsRaw | undefined) ?? {};
      return {
        ...SETTINGS_DEFAULTS,
        ...raw,
        agents: {
          writingAssistant: { ...SETTINGS_DEFAULTS.agents.writingAssistant, ...(rawAgents.writingAssistant ?? {}) },
          brainstorm: { ...SETTINGS_DEFAULTS.agents.brainstorm, ...(rawAgents.brainstorm ?? {}) },
          archive: { ...SETTINGS_DEFAULTS.agents.archive, ...(rawAgents.archive ?? {}) },
        },
      };
    } catch {
      // fall through to defaults
    }
  }
  return { ...SETTINGS_DEFAULTS, agents: { ...SETTINGS_DEFAULTS.agents } };
}

function saveAppSettings(settings: AppSettings): void {
  fs.writeFileSync(getAppSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
}

// Returns a masked preview (sk-ant-...XXXX) so the raw key never leaves the main process.
function maskApiKey(key: string): string {
  return key ? `sk-ant-...${key.slice(-4)}` : '';
}

// ─── Anthropic API key validation ───
// Checks persisted settings first, then falls back to environment variable.
function getValidatedApiKey(): string {
  const settings = loadAppSettings();
  const apiKey = settings.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set. Add it in Settings or to your environment to enable AI features.');
  }
  if (!apiKey.startsWith('sk-ant-')) {
    throw new Error('ANTHROPIC_API_KEY appears invalid (expected format: sk-ant-…). Check Settings or your environment.');
  }
  return apiKey;
}

// ─── Brainstorm Agent streaming handler ───
function registerBrainstormHandler() {
  ipcMain.handle(IPC_CHANNELS.AGENT_BRAINSTORM, async (event, payload: AgentBrainstormPayload) => {
    const apiKey = getValidatedApiKey();
    const client = new Anthropic({ apiKey });

    const systemPrompt = `You are a Brainstorm Agent for fiction authors. Help the author develop their story world through conversation. You discuss story ideas, characters, locations, themes, plot arcs, world-building, and narrative goals.

When you identify or introduce a specific named story fact — a character, location, item, or worldbuilding note — include a structured tag so the app can extract it:

[FACT:character|Character Name|One-sentence description]
[FACT:location|Place Name|One-sentence description]
[FACT:item|Item Name|One-sentence description]
[FACT:note|Note Title|Key content of the note]

Be creative, ask clarifying questions, and help the author think deeper about their story. These FACT tags will appear in a "Detected Facts" panel so the author can save them to their vault.`;

    const messages = [
      ...(payload.history ?? []).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content: payload.prompt },
    ];

    const requestId = crypto.randomUUID();
    const model = 'claude-haiku-4-5-20251001';
    let fullText = '';
    let tokensIn: number | null = null;
    let tokensOut: number | null = null;
    let genError: string | null = null;
    const startedAt = Date.now();

    const controller = new AbortController();
    agentControllers.set(requestId, controller);
    const onDestroyed = () => controller.abort();
    event.sender.once('destroyed', onDestroyed);

    if (!event.sender.isDestroyed()) {
      event.sender.send('agent:brainstorm:stream-start', { requestId });
    }

    const stream = client.messages.stream(
      { model, max_tokens: 1024, system: systemPrompt, messages },
      { signal: controller.signal },
    );

    try {
      for await (const chunk of stream) {
        if (chunk.type === 'message_start') {
          tokensIn = chunk.message.usage.input_tokens;
        } else if (chunk.type === 'message_delta') {
          tokensOut = chunk.usage.output_tokens;
        } else if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          fullText += chunk.delta.text;
          if (!event.sender.isDestroyed()) {
            event.sender.send('agent:brainstorm:chunk', { chunk: chunk.delta.text });
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error)?.name !== 'AbortError') {
        genError = (err as Error).message ?? 'unknown error';
        throw err;
      }
    } finally {
      agentControllers.delete(requestId);
      event.sender.off('destroyed', onDestroyed);
      const promptText = payload.prompt;
      const payloadDigest = process.env.PERSIST_PROMPTS === '1'
        ? promptText
        : crypto.createHash('sha256').update(promptText).digest('hex');
      try {
        insertGenerationLog({
          id: crypto.randomUUID(),
          agent: 'brainstorm',
          model,
          endpoint: 'messages.stream',
          request_id: requestId,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          latency_ms: Date.now() - startedAt,
          error: genError,
          created_at: new Date().toISOString(),
          payload_digest: payloadDigest,
        });
      } catch { /* non-fatal — logging must not break agent response */ }
    }

    return { text: fullText, requestId };
  });
}

// ─── Writing Assistant streaming handler ───
// Registered separately so we can push chunk events to the renderer mid-response.
function registerWritingAssistantHandler() {
  ipcMain.handle(IPC_CHANNELS.AGENT_WRITING_ASSISTANT, async (event, payload: AgentWritingAssistantPayload) => {
    const apiKey = getValidatedApiKey();
    const client = new Anthropic({ apiKey });
    const userContent = payload.context
      ? `Scene context:\n${payload.context}\n\nWriter's prompt: ${payload.prompt}`
      : payload.prompt;

    const requestId = crypto.randomUUID();
    const model = 'claude-haiku-4-5-20251001';
    let fullText = '';
    let tokensIn: number | null = null;
    let tokensOut: number | null = null;
    let genError: string | null = null;
    const startedAt = Date.now();

    const controller = new AbortController();
    agentControllers.set(requestId, controller);
    const onDestroyed = () => controller.abort();
    event.sender.once('destroyed', onDestroyed);

    if (!event.sender.isDestroyed()) {
      event.sender.send('agent:writing-assistant:stream-start', { requestId });
    }

    const stream = client.messages.stream(
      {
        model,
        max_tokens: 1024,
        system: 'You are a Writing Assistant for fiction authors. Read the scene context carefully and give concise, specific advice on craft, pacing, character voice, and narrative clarity. Never rewrite the author\'s text without being asked. Suggestions only.',
        messages: [{ role: 'user', content: userContent }],
      },
      { signal: controller.signal },
    );

    try {
      for await (const chunk of stream) {
        if (chunk.type === 'message_start') {
          tokensIn = chunk.message.usage.input_tokens;
        } else if (chunk.type === 'message_delta') {
          tokensOut = chunk.usage.output_tokens;
        } else if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          fullText += chunk.delta.text;
          if (!event.sender.isDestroyed()) {
            event.sender.send('agent:writing-assistant:chunk', { chunk: chunk.delta.text });
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error)?.name !== 'AbortError') {
        genError = (err as Error).message ?? 'unknown error';
        throw err;
      }
    } finally {
      agentControllers.delete(requestId);
      event.sender.off('destroyed', onDestroyed);
      const payloadDigest = process.env.PERSIST_PROMPTS === '1'
        ? userContent
        : crypto.createHash('sha256').update(userContent).digest('hex');
      try {
        insertGenerationLog({
          id: crypto.randomUUID(),
          agent: 'writing-assistant',
          model,
          endpoint: 'messages.stream',
          request_id: requestId,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          latency_ms: Date.now() - startedAt,
          error: genError,
          created_at: new Date().toISOString(),
          payload_digest: payloadDigest,
        });
      } catch { /* non-fatal */ }
    }

    return { text: fullText, requestId };
  });
}

// ─── Vault Agent handlers ───
function registerVaultAgentHandlers() {
  // agent:vault-index — builds in-memory index of all vault entities
  ipcMain.handle(IPC_CHANNELS.AGENT_VAULT_INDEX, () => {
    ensureVaultDir();
    const manifest = readManifest(getManifestPath());
    reindexEntities(getVaultRoot(), manifest);
    const entities = listEntities(getVaultRoot(), manifest, undefined);

    const indexed: VaultIndexEntry[] = entities.map((e) => {
      let prose = '';
      try {
        const { content } = readVaultFile(getVaultRoot(), e.path);
        // Strip YAML frontmatter to get prose body
        const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
        prose = match ? match[1].trim() : content.trim();
      } catch { /* entity file missing — use metadata only */ }

      const keyFacts = prose
        ? prose.slice(0, 500)
        : [
            e.aliases?.length ? `Aliases: ${e.aliases.join(', ')}` : '',
            e.tags?.length ? `Tags: ${e.tags.join(', ')}` : '',
          ].filter(Boolean).join('. ') || `${e.type} named ${e.name}`;

      return {
        id: e.id,
        name: e.name,
        type: e.type,
        aliases: e.aliases,
        tags: e.tags,
        keyFacts,
      };
    });

    return { entities: indexed };
  });

  // agent:vault-check — streams Claude continuity analysis and returns parsed inconsistencies
  ipcMain.handle(IPC_CHANNELS.AGENT_VAULT_CHECK, async (event, payload: VaultCheckPayload) => {
    const apiKey = getValidatedApiKey();

    ensureVaultDir();
    const manifest = readManifest(getManifestPath());
    reindexEntities(getVaultRoot(), manifest);
    const entities = listEntities(getVaultRoot(), manifest, undefined);

    const vaultSummary = entities.length === 0
      ? 'No vault entities found.'
      : entities.map((e) => {
          let prose = '';
          try {
            const { content } = readVaultFile(getVaultRoot(), e.path);
            const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
            prose = match ? match[1].trim() : content.trim();
          } catch { /* ignore */ }
          const facts = prose ? prose.slice(0, 400) : '';
          const aliases = e.aliases?.length ? ` (aliases: ${e.aliases.join(', ')})` : '';
          return `## ${e.name}${aliases}\nType: ${e.type}\n${facts}`.trim();
        }).join('\n\n');

    const systemPrompt = `You are a Vault Agent for a fiction author. Your job is to check the current scene for continuity errors against stored vault facts.

Vault contents:
${vaultSummary}

Check the scene for contradictions with the vault facts: character traits, physical descriptions, location details, item properties, timeline issues.

For every inconsistency you find, output a tag on its own line:
[ISSUE:entity-name|Brief description of the contradiction]

Then write a short summary paragraph. If no issues are found, say so and output no ISSUE tags.`;

    const client = new Anthropic({ apiKey });
    const vaultCheckModel = 'claude-haiku-4-5-20251001';
    const vaultCheckContent = `Scene to check:\n\n${payload.sceneContent}`;
    const requestId = crypto.randomUUID();
    let fullText = '';
    let vaultTokensIn: number | null = null;
    let vaultTokensOut: number | null = null;
    let vaultGenError: string | null = null;
    const vaultStartedAt = Date.now();

    const controller = new AbortController();
    agentControllers.set(requestId, controller);
    const onDestroyed = () => controller.abort();
    event.sender.once('destroyed', onDestroyed);

    if (!event.sender.isDestroyed()) {
      event.sender.send('agent:vault-check:stream-start', { requestId });
    }

    const stream = client.messages.stream(
      {
        model: vaultCheckModel,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: vaultCheckContent }],
      },
      { signal: controller.signal },
    );

    try {
      for await (const chunk of stream) {
        if (chunk.type === 'message_start') {
          vaultTokensIn = chunk.message.usage.input_tokens;
        } else if (chunk.type === 'message_delta') {
          vaultTokensOut = chunk.usage.output_tokens;
        } else if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          fullText += chunk.delta.text;
          if (!event.sender.isDestroyed()) {
            event.sender.send('agent:vault-check:chunk', { chunk: chunk.delta.text });
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error)?.name !== 'AbortError') {
        vaultGenError = (err as Error).message ?? 'unknown error';
        throw err;
      }
    } finally {
      agentControllers.delete(requestId);
      event.sender.off('destroyed', onDestroyed);
      const vaultPayloadDigest = process.env.PERSIST_PROMPTS === '1'
        ? vaultCheckContent
        : crypto.createHash('sha256').update(vaultCheckContent).digest('hex');
      try {
        insertGenerationLog({
          id: crypto.randomUUID(),
          agent: 'vault-agent',
          model: vaultCheckModel,
          endpoint: 'messages.stream',
          request_id: requestId,
          tokens_in: vaultTokensIn,
          tokens_out: vaultTokensOut,
          latency_ms: Date.now() - vaultStartedAt,
          error: vaultGenError,
          created_at: new Date().toISOString(),
          payload_digest: vaultPayloadDigest,
        });
      } catch { /* non-fatal */ }
    }

    // Parse [ISSUE:entity-name|description] tags
    const issuePattern = /\[ISSUE:([^\|]+)\|([^\]]+)\]/g;
    const inconsistencies: VaultCheckInconsistency[] = [];
    let match;
    while ((match = issuePattern.exec(fullText)) !== null) {
      inconsistencies.push({
        id: `vault-${Date.now()}-${inconsistencies.length}`,
        entityName: match[1].trim(),
        text: match[2].trim(),
        rationale: match[2].trim(),
        timestamp: new Date().toISOString(),
        source_agent: 'vault-agent',
        status: 'proposed',
      });
    }

    return { text: fullText, inconsistencies, requestId };
  });
}

// ─── App lifecycle ───
app.whenReady().then(async () => {
  ensureVaultDir();
  setupIpcMain(handlers);
  registerAgentCancelHandlers();
  registerBrainstormHandler();
  registerWritingAssistantHandler();
  registerVaultAgentHandlers();
  createWindow();
  initAutoUpdater();
  // Start watching vault for external markdown changes
  await startVaultWatcher(getVaultRoot(), notifyVaultChanged);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  await stopVaultWatcher();
  closeDb();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
