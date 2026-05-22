// Main process entry — Electron app lifecycle + IPC handlers
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { createRequire } from 'node:module';
import path from 'path';
import fs from 'fs';
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
  type AgentWritingAssistantPayload,
  type AgentBrainstormPayload,
  type VaultCheckPayload,
  type VaultIndexEntry,
  type VaultCheckInconsistency,
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

// ─── Brainstorm Agent streaming handler ───
function registerBrainstormHandler() {
  ipcMain.handle(IPC_CHANNELS.AGENT_BRAINSTORM, async (event, payload: AgentBrainstormPayload) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set. Add it to your environment to enable AI features.');
    }
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

    let fullText = '';
    const stream = client.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        fullText += chunk.delta.text;
        event.sender.send('agent:brainstorm:chunk', { chunk: chunk.delta.text });
      }
    }

    return { text: fullText };
  });
}

// ─── Writing Assistant streaming handler ───
// Registered separately so we can push chunk events to the renderer mid-response.
function registerWritingAssistantHandler() {
  ipcMain.handle(IPC_CHANNELS.AGENT_WRITING_ASSISTANT, async (event, payload: AgentWritingAssistantPayload) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set. Add it to your environment to enable AI features.');
    }
    const client = new Anthropic({ apiKey });
    const userContent = payload.context
      ? `Scene context:\n${payload.context}\n\nWriter's prompt: ${payload.prompt}`
      : payload.prompt;

    let fullText = '';
    const stream = client.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: 'You are a Writing Assistant for fiction authors. Read the scene context carefully and give concise, specific advice on craft, pacing, character voice, and narrative clarity. Never rewrite the author\'s text without being asked. Suggestions only.',
      messages: [{ role: 'user', content: userContent }],
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        fullText += chunk.delta.text;
        event.sender.send('agent:writing-assistant:chunk', { chunk: chunk.delta.text });
      }
    }

    return { text: fullText };
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
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set. Add it to your environment to enable AI features.');
    }

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
    let fullText = '';

    const stream = client.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Scene to check:\n\n${payload.sceneContent}` }],
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        fullText += chunk.delta.text;
        event.sender.send('agent:vault-check:chunk', { chunk: chunk.delta.text });
      }
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

    return { text: fullText, inconsistencies };
  });
}

// ─── App lifecycle ───
app.whenReady().then(async () => {
  ensureVaultDir();
  setupIpcMain(handlers);
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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
