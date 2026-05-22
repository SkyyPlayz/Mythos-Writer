// IPC Bridge — typed channels between main process and renderer
// All IPC calls go through this module for type safety.

import { ipcMain, ipcRenderer } from 'electron';

// ─── Channel names ───
export const IPC_CHANNELS = {
  // Vault / filesystem operations
  VAULT_READ: 'vault:read',
  VAULT_WRITE: 'vault:write',
  VAULT_LIST: 'vault:list',
  VAULT_DELETE: 'vault:delete',
  VAULT_MANIFEST_READ: 'vault:manifest:read',
  VAULT_MANIFEST_WRITE: 'vault:manifest:write',

  // Vault folder management
  VAULT_OPEN_FOLDER: 'vault:open-folder',
  VAULT_GET_ROOT: 'vault:get-root',
  VAULT_IMPORT: 'vault:import',
  VAULT_REINDEX: 'vault:reindex',
  VAULT_WATCH_START: 'vault:watch-start',
  VAULT_WATCH_STOP: 'vault:watch-stop',

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

  // Agent channels (Epic 5)
  AGENT_WRITING_ASSISTANT: 'agent:writing-assistant',
  AGENT_BRAINSTORM: 'agent:brainstorm',
  AGENT_VAULT_INDEX: 'agent:vault-index',
  AGENT_VAULT_CHECK: 'agent:vault-check',

  // System
  SYSTEM_INFO: 'system:info',

  // Versioning — per-scene snapshots
  SNAPSHOT_SAVE: 'snapshot:save',
  SNAPSHOT_LIST: 'snapshot:list',
  SNAPSHOT_GET: 'snapshot:get',
  SNAPSHOT_RESTORE: 'snapshot:restore',

  // Entity CRUD
  ENTITY_CREATE: 'entity:create',
  ENTITY_READ: 'entity:read',
  ENTITY_UPDATE: 'entity:update',
  ENTITY_DELETE: 'entity:delete',
  ENTITY_LIST: 'entity:list',
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
  [IPC_CHANNELS.VAULT_READ]: (payload: VaultReadPayload) => VaultReadResponse;
  [IPC_CHANNELS.VAULT_WRITE]: (payload: VaultWritePayload) => VaultWriteResponse;
  [IPC_CHANNELS.VAULT_LIST]: (payload: VaultListPayload) => VaultListResponse;
  [IPC_CHANNELS.VAULT_DELETE]: (payload: VaultDeletePayload) => VaultDeleteResponse;
  [IPC_CHANNELS.VAULT_MANIFEST_READ]: (payload: never) => Manifest;
  [IPC_CHANNELS.VAULT_MANIFEST_WRITE]: (payload: ManifestWritePayload) => ManifestWriteResponse;
  [IPC_CHANNELS.VAULT_OPEN_FOLDER]: (payload: never) => Promise<VaultOpenFolderResponse>;
  [IPC_CHANNELS.VAULT_GET_ROOT]: (payload: never) => VaultGetRootResponse;
  [IPC_CHANNELS.VAULT_IMPORT]: (payload: VaultImportPayload) => Promise<VaultImportResponse>;
  [IPC_CHANNELS.VAULT_REINDEX]: (payload: never) => VaultReindexResponse;
  [IPC_CHANNELS.VAULT_WATCH_START]: (payload: never) => Promise<{ watching: boolean }>;
  [IPC_CHANNELS.VAULT_WATCH_STOP]: (payload: never) => Promise<{ watching: boolean }>;
  [IPC_CHANNELS.DB_QUERY]: (payload: DbQueryPayload) => DbQueryResponse;
  [IPC_CHANNELS.DB_WRITE]: (payload: DbWritePayload) => DbWriteResponse;
  [IPC_CHANNELS.APP_READY]: (payload: never) => AppReadyResponse;
  [IPC_CHANNELS.APP_QUIT]: (payload: never) => void;
  [IPC_CHANNELS.AI_BRAINSTORMER]: (payload: BrainstormerPayload) => BrainstormerResponse;
  [IPC_CHANNELS.AI_WRITING_ASSISTANT]: (payload: WritingAssistantPayload) => WritingAssistantResponse;
  [IPC_CHANNELS.AI_ARCHIVE]: (payload: ArchivePayload) => ArchiveResponse;
  // AGENT_WRITING_ASSISTANT is registered manually in main.ts (streaming handler — not via setupIpcMain)
  [IPC_CHANNELS.SYSTEM_INFO]: (payload: never) => SystemInfo;
  [IPC_CHANNELS.SNAPSHOT_SAVE]: (payload: SnapshotSavePayload) => SceneSnapshot;
  [IPC_CHANNELS.SNAPSHOT_LIST]: (payload: SnapshotListPayload) => SnapshotListResponse;
  [IPC_CHANNELS.SNAPSHOT_GET]: (payload: SnapshotGetPayload) => SnapshotGetResponse;
  [IPC_CHANNELS.SNAPSHOT_RESTORE]: (payload: SnapshotRestorePayload) => SnapshotRestoreResponse;
  [IPC_CHANNELS.ENTITY_CREATE]: (payload: EntityCreatePayload) => EntityEntry;
  [IPC_CHANNELS.ENTITY_READ]: (payload: EntityReadPayload) => EntityEntry | null;
  [IPC_CHANNELS.ENTITY_UPDATE]: (payload: EntityUpdatePayload) => EntityEntry;
  [IPC_CHANNELS.ENTITY_DELETE]: (payload: EntityDeletePayload) => EntityDeleteResponse;
  [IPC_CHANNELS.ENTITY_LIST]: (payload: EntityListPayload) => EntityListResponse;
}

// ─── Payload / Response types ───

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

// ─── Full manifest schema ───

export interface Manifest {
  version: string;
  vaultRoot: string;
  stories: StoryEntry[];
  entities: EntityEntry[];
  suggestions: SuggestionEntry[];
  // Legacy flat lists kept for backward compat — prefer stories[].chapters[].scenes[]
  scenes: SceneEntry[];
  chapters: ChapterEntry[];
}

export interface StoryEntry {
  id: string;
  title: string;
  synopsis?: string;
  path: string;
  chapters: ChapterEntry[];
  createdAt: string;
  updatedAt: string;
  provenance?: AgentProvenance;
}

export interface ChapterEntry {
  id: string;
  title: string;
  path: string;
  order: number;
  scenes: SceneEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface SceneEntry {
  id: string;
  title: string;
  path: string;
  order: number;
  chapterId?: string;
  storyId?: string;
  blocks: BlockEntry[];
  draftState?: 'in-progress' | 'review' | 'final';
  card?: SceneCard;
  timestamp?: SceneTimestamp;
  createdAt: string;
  updatedAt: string;
  provenance?: AgentProvenance;
}

export interface BlockEntry {
  id: string;
  type: 'prose' | 'heading' | 'dialogue' | 'action' | 'description' | 'note';
  order: number;
  content: string;
  updatedAt: string;
}

export interface SceneCard {
  goal?: string;
  conflict?: string;
  outcome?: string;
  pov?: string;
  tags?: string[];
}

export interface SceneTimestamp {
  storyTime?: string;
  realTime?: string;
  duration?: string;
}

export interface EntityEntry {
  id: string;
  name: string;
  type: 'character' | 'location' | 'item' | 'concept' | 'other';
  path: string;
  aliases?: string[];
  tags?: string[];
  properties?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  provenance?: AgentProvenance;
}

export interface SuggestionEntry {
  id: string;
  source: string;
  confidence: number;
  rationale: string;
  timestamp: string;
  targetPath?: string;
  targetId?: string;
  payload?: unknown;
  provenance?: AgentProvenance;
}

export interface AgentProvenance {
  agentId: string;
  agentType: string;
  runId?: string;
  timestamp: string;
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

export interface VaultOpenFolderResponse {
  vaultRoot: string | null;
  cancelled: boolean;
}

export interface VaultGetRootResponse {
  vaultRoot: string;
}

export interface VaultImportPayload {
  sourcePath: string;
}

export interface VaultImportResponse {
  imported: number;
  skipped: number;
  errors: string[];
}

export interface VaultReindexResponse {
  scanned: number;
  updated: number;
}

// ─── Snapshot types ───

export interface SceneSnapshot {
  id: string;
  sceneId: string;
  content: string;
  wordCount: number;
  createdAt: string;
}

export interface SnapshotSavePayload {
  sceneId: string;
  content: string;
}

export interface SnapshotListPayload {
  sceneId: string;
}

export interface SnapshotListResponse {
  snapshots: SceneSnapshot[];
}

export interface SnapshotGetPayload {
  sceneId: string;
  snapshotId: string;
}

export interface SnapshotGetResponse {
  snapshot: SceneSnapshot | null;
}

export interface SnapshotRestorePayload {
  sceneId: string;
  snapshotId: string;
  scenePath: string;
}

export interface SnapshotRestoreResponse {
  restored: SceneSnapshot;
  preRestoreSnapshot: SceneSnapshot;
}

// ─── Entity IPC payload / response types ───

export interface EntityCreatePayload {
  name: string;
  type: EntityEntry['type'];
  aliases?: string[];
  tags?: string[];
  prose?: string;
  properties?: Record<string, unknown>;
}

export interface EntityReadPayload {
  id: string;
}

export interface EntityUpdatePayload {
  id: string;
  name?: string;
  aliases?: string[];
  tags?: string[];
  prose?: string;
  properties?: Record<string, unknown>;
}

export interface EntityDeletePayload {
  id: string;
}

export interface EntityDeleteResponse {
  id: string;
  deleted: boolean;
}

export interface EntityListPayload {
  type?: EntityEntry['type'];
}

export interface EntityListResponse {
  entities: EntityEntry[];
}

// ─── Brainstorm Agent types (Epic 5 — separate chat page, writes to vault) ───

export interface AgentBrainstormPayload {
  prompt: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface AgentBrainstormResponse {
  text: string;
}

// ─── Writing Assistant agent types (Epic 5) ───

export interface AgentWritingAssistantPayload {
  prompt: string;
  context?: string;
}

export interface AgentWritingAssistantResponse {
  text: string;
}

// ─── Vault Agent types (Epic 5 — MYT-110) ───

export interface VaultIndexEntry {
  id: string;
  name: string;
  type: EntityEntry['type'];
  aliases?: string[];
  tags?: string[];
  keyFacts: string;
}

export interface VaultIndexResponse {
  entities: VaultIndexEntry[];
}

export interface VaultCheckPayload {
  sceneContent: string;
}

export interface VaultCheckInconsistency {
  id: string;
  entityName: string;
  text: string;
  rationale: string;
  timestamp: string;
  source_agent: 'vault-agent';
  status: 'proposed' | 'dismissed';
}

export interface VaultCheckResponse {
  text: string;
  inconsistencies: VaultCheckInconsistency[];
}
