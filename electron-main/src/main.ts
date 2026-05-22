// Main process entry — Electron app lifecycle + IPC handlers
import { app, BrowserWindow, ipcMain } from 'electron';
import { createRequire } from 'node:module';
import path from 'path';
import fs from 'fs';
import { Anthropic } from '@anthropic-ai/sdk';
import {
  setupIpcMain,
  IPC_CHANNELS,
  type IpcHandlers,
  type StoryGeneratePayload,
  type StoryChunk,
  type StoryStatus,
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
} from './ipc.js';
import { readVaultFile, writeVaultFile, listVaultFiles, deleteVaultFile } from './vault.js';

const require = createRequire(import.meta.url);

// ─── State ───
let mainWindow: BrowserWindow | null = null;
let storyState: StoryStatus = { state: 'idle' };
let abortController: AbortController | null = null;

// ─── Anthropic client ───
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? '',
});

// ─── Vault root ───
const getVaultRoot = () => {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'vault');
};

// ─── Manifest path ───
const getManifestPath = () => path.join(getVaultRoot(), 'manifest.json');

// ─── Ensure vault directory exists ───
function ensureVaultDir() {
  const vaultRoot = getVaultRoot();
  if (!fs.existsSync(vaultRoot)) {
    fs.mkdirSync(vaultRoot, { recursive: true });
  }
  if (!fs.existsSync(getManifestPath())) {
    const defaultManifest: Manifest = {
      version: '1.0.0',
      vaultRoot,
      scenes: [],
      entities: [],
      chapters: [],
    };
    fs.writeFileSync(getManifestPath(), JSON.stringify(defaultManifest, null, 2));
  }
}

// ─── Story generation (SSE streaming via IPC) ───
async function* generateStory(payload: StoryGeneratePayload): AsyncGenerator<StoryChunk> {
  abortController = new AbortController();

  const systemPrompt = `You are a creative writing assistant for Mythos Writer. Generate stories based on the user's prompt. Respect genre and length constraints.`;

  const userMessage = `Prompt: ${payload.prompt}
Genre: ${payload.genre || 'no specific genre'}
Length: ${payload.length || 'medium'}`;

  try {
    const response = await anthropic.messages.stream(
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: payload.length === 'short' ? 500 : payload.length === 'long' ? 2000 : 1000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      },
      { signal: abortController.signal }
    );

    for await (const chunk of response) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        yield { chunk: chunk.delta.text };
      }
    }
    yield { done: true };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      yield { done: true };
    } else {
      yield { error: (error as Error).message };
    }
  }
}

// ─── IPC Handlers ───
const handlers: IpcHandlers = {
  [IPC_CHANNELS.STORY_GENERATE]: generateStory,
  [IPC_CHANNELS.STORY_ABORT]: () => {
    abortController?.abort();
    abortController = null;
    storyState = { state: 'idle' };
  },
  [IPC_CHANNELS.STORY_STATUS]: () => storyState,
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
    return JSON.parse(fs.readFileSync(getManifestPath(), 'utf-8')) as Manifest;
  },
  [IPC_CHANNELS.VAULT_MANIFEST_WRITE]: (payload: ManifestWritePayload): ManifestWriteResponse => {
    ensureVaultDir();
    const serialized = JSON.stringify(payload.manifest, null, 2);
    fs.writeFileSync(getManifestPath(), serialized, 'utf-8');
    return { path: getManifestPath(), bytes: serialized.length };
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
    mainWindow.loadFile(path.join(__dirname, '../../frontend/dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── App lifecycle ───
app.whenReady().then(() => {
  ensureVaultDir();
  setupIpcMain(handlers);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
