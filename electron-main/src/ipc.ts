// IPC Bridge — typed channels between main process and renderer
// All IPC calls go through this module for type safety.

import { ipcMain, ipcRenderer } from 'electron';

// ─── Channel names ───
export const IPC_CHANNELS = {
  // Story generation (Anthropic API)
  STORY_GENERATE: 'story:generate',
  STORY_ABORT: 'story:abort',
  STORY_STATUS: 'story:status',

  // Vault / filesystem operations
  VAULT_READ: 'vault:read',
  VAULT_WRITE: 'vault:write',
  VAULT_LIST: 'vault:list',
  VAULT_DELETE: 'vault:delete',
  VAULT_MANIFEST_READ: 'vault:manifest:read',
  VAULT_MANIFEST_WRITE: 'vault:manifest:write',

  // SQLite (stub for now)
  DB_QUERY: 'db:query',
  DB_WRITE: 'db:write',

  // App lifecycle
  APP_READY: 'app:ready',
  APP_QUIT: 'app:quit',

  // AI agents
  AI_BRAINSTORMER: 'ai:brainstormer',
  AI_WRITING_ASSISTANT: 'ai:writing-assistant',
  AI_ARCHIVE: 'ai:archive',

  // System
  SYSTEM_INFO: 'system:info',
} as const;

// ─── Main process handlers ───
// Each handler: receive request → process → send response via IPC

export function setupIpcMain(handlers: IpcHandlers) {
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_event, payload) => {
      try {
        return handler(payload);
      } catch (error) {
        return { error: (error as Error).message };
      }
    });
  }
}

// ─── Renderer-side IPC helper ───
// Call a channel and get the response

export async function ipcCall<TChannel extends keyof IpcHandlers, TPayload, TResponse>(
  channel: TChannel,
  payload: TPayload
): Promise<TResponse | { error: string }> {
  return ipcRenderer.invoke(channel, payload);
}

// ─── Type definitions ───

export interface IpcHandlers {
  [IPC_CHANNELS.STORY_GENERATE]: (payload: StoryGeneratePayload) => AsyncGenerator<StoryChunk>;
  [IPC_CHANNELS.STORY_ABORT]: (payload: never) => void;
  [IPC_CHANNELS.STORY_STATUS]: (payload: never) => StoryStatus;
  [IPC_CHANNELS.VAULT_READ]: (payload: VaultReadPayload) => VaultReadResponse;
  [IPC_CHANNELS.VAULT_WRITE]: (payload: VaultWritePayload) => VaultWriteResponse;
  [IPC_CHANNELS.VAULT_LIST]: (payload: VaultListPayload) => VaultListResponse;
  [IPC_CHANNELS.VAULT_DELETE]: (payload: VaultDeletePayload) => VaultDeleteResponse;
  [IPC_CHANNELS.VAULT_MANIFEST_READ]: (payload: never) => Manifest;
  [IPC_CHANNELS.VAULT_MANIFEST_WRITE]: (payload: ManifestWritePayload) => ManifestWriteResponse;
  [IPC_CHANNELS.DB_QUERY]: (payload: DbQueryPayload) => DbQueryResponse;
  [IPC_CHANNELS.DB_WRITE]: (payload: DbWritePayload) => DbWriteResponse;
  [IPC_CHANNELS.APP_READY]: (payload: never) => AppReadyResponse;
  [IPC_CHANNELS.APP_QUIT]: (payload: never) => void;
  [IPC_CHANNELS.AI_BRAINSTORMER]: (payload: BrainstormerPayload) => BrainstormerResponse;
  [IPC_CHANNELS.AI_WRITING_ASSISTANT]: (payload: WritingAssistantPayload) => WritingAssistantResponse;
  [IPC_CHANNELS.AI_ARCHIVE]: (payload: ArchivePayload) => ArchiveResponse;
  [IPC_CHANNELS.SYSTEM_INFO]: (payload: never) => SystemInfo;
}

// ─── Payload / Response types ───

export interface StoryGeneratePayload {
  prompt: string;
  genre?: string;
  length?: string;
}

export interface StoryChunk {
  chunk?: string;
  done?: boolean;
  error?: string;
}

export interface StoryStatus {
  state: 'idle' | 'streaming' | 'done' | 'error';
  story?: string;
  error?: string;
}

export interface VaultReadPayload {
  path: string;
}

export interface VaultReadResponse {
  content: string;
  path: string;
}

export interface VaultWritePayload {
  path: string;
  content: string;
}

export interface VaultWriteResponse {
  path: string;
  bytes: number;
}

export interface VaultListPayload {
  root?: string;
}

export interface VaultListItem {
  path: string;
  name: string;
  isDirectory: boolean;
  modifiedAt: string;
}

export interface VaultListResponse {
  items: VaultListItem[];
}

export interface VaultDeletePayload {
  path: string;
}

export interface VaultDeleteResponse {
  path: string;
  deleted: boolean;
}

export interface Manifest {
  version: string;
  vaultRoot: string;
  scenes: SceneEntry[];
  entities: EntityEntry[];
  chapters: ChapterEntry[];
}

export interface SceneEntry {
  id: string;
  title: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

export interface EntityEntry {
  id: string;
  name: string;
  type: string;
  path: string;
  createdAt: string;
}

export interface ChapterEntry {
  id: string;
  title: string;
  path: string;
  scenes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ManifestWritePayload {
  manifest: Manifest;
}

export interface ManifestWriteResponse {
  path: string;
  bytes: number;
}

export interface DbQueryPayload {
  sql: string;
  params?: unknown[];
}

export interface DbQueryResponse {
  rows: unknown[];
}

export interface DbWritePayload {
  sql: string;
  params?: unknown[];
}

export interface DbWriteResponse {
  changes: number;
}

export interface AppReadyResponse {
  platform: string;
  electronVersion: string;
  appVersion: string;
}

export interface BrainstormerPayload {
  topic: string;
  context?: string;
}

export interface BrainstormerResponse {
  suggestions: string[];
  confidence: number;
  provenance: string;
}

export interface WritingAssistantPayload {
  manuscript: string;
  scenePath: string;
}

export interface WritingAssistantResponse {
  tips: string[];
  suggestions: string[];
}

export interface ArchivePayload {
  manuscript: string;
  vaultPath: string;
}

export interface ArchiveResponse {
  links: string[];
  timelinePlacements: string[];
  inconsistencies: string[];
}

export interface SystemInfo {
  platform: string;
  electronVersion: string;
  nodeVersion: string;
}
