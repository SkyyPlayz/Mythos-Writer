// Main process entry — Electron app lifecycle + IPC handlers
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { createRequire } from 'node:module';
import path from 'path';
import fs from 'fs';
import { autoUpdater } from 'electron-updater';
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
  type DbQueryPayload,
  type DbQueryResponse,
  type DbWritePayload,
  type DbWriteResponse,
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
} from './ipc.js';
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
} from './vault.js';
import {
  createEntity,
  readEntity,
  updateEntity,
  deleteEntity,
  listEntities,
  reindexEntities,
} from './entities.js';

const require = createRequire(import.meta.url);

// ─── State ───
let mainWindow: BrowserWindow | null = null;

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
  if (!fs.existsSync(getManifestPath())) {
    writeManifest(getManifestPath(), defaultManifest(vaultRoot));
  }
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
  [IPC_CHANNELS.DB_QUERY]: (payload: DbQueryPayload): DbQueryResponse => {
    // SQLite stub — placeholder for future implementation
    return { rows: [] };
  },
  [IPC_CHANNELS.DB_WRITE]: (payload: DbWritePayload): DbWriteResponse => {
    // SQLite stub — placeholder for future implementation
    return { changes: 0 };
  },
  [IPC_CHANNELS.APP_READY]: (): AppReadyResponse => ({
    platform: process.platform,
    electronVersion: process.versions.electron,
    appVersion: require('../../package.json').version,
  }),
  [IPC_CHANNELS.APP_QUIT]: () => app.quit(),
  [IPC_CHANNELS.AI_BRAINSTORMER]: (payload: BrainstormerPayload): BrainstormerResponse => {
    // Stub — will be fully implemented in Epic 5
    return {
      suggestions: [`Brainstormer: ideas for "${payload.topic}" (stub — full impl in Epic 5)`],
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
    return saveSnapshot(getVaultRoot(), payload.sceneId, payload.content);
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
    const preRestoreSnapshot = saveSnapshot(getVaultRoot(), payload.sceneId, currentContent);
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

// ─── Auto-updater (stubbed — no live update server configured) ───
function initAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  // Suppress errors when no update server is reachable (stub mode)
  autoUpdater.on('error', () => { /* intentionally silent in stub mode */ });
}

// ─── App lifecycle ───
app.whenReady().then(async () => {
  ensureVaultDir();
  setupIpcMain(handlers);
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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
