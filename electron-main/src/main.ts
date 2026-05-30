// Main process entry — Electron app lifecycle + IPC handlers
import { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, screen, Menu } from 'electron';
import { secureWebPreferences, createWindowOpenHandler } from './security.js';
import { loadWindowState, saveWindowState, isBoundsOnScreen } from './windowState.js';
import { readBgImageAsDataUrl } from './bgLoad.js';
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
  type VaultMovePayload,
  type VaultMoveResponse,
  type VaultMkdirPayload,
  type VaultMkdirResponse,
  type VaultChooseFolderPayload,
  type VaultChooseFolderResponse,
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
  type SnapshotDeletePayload,
  type SnapshotDeleteAllPayload,
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
  type SuggestionsGetPayload,
  type SuggestionsUpsertPayload,
  type SuggestionsAcceptPayload,
  type SuggestionsApplyPayload,
  type SuggestionsRejectPayload,
  type SuggestionsRollbackPayload,
  type AuditListPayload,
  type TimelineListPayload,
  type TimelineUpsertPayload,
  type ProvenanceUpsertPayload,
  type GenerationLogRecentPayload,
  type GenerationLogListPayload,
  type GenerationLogGetPayload,
  type ArchiveScanPayload,
  type ChapterCreatePayload,
  type SceneCreatePayload,
  type ChapterListPayload,
  type ChapterGetPayload,
  type ChapterSavePayload,
  type SceneListPayload,
  type SceneGetPayload,
  type SceneSavePayload,
  type VersionListPayload,
  type VersionGetPayload,
  type VersionRollbackPayload,
  type SearchQueryPayload,
  type WritingScanPayload,
  type BetaReadScanPayload,
  type VaultObsidianDryRunPayload,
  type VaultObsidianRegisterPayload,
  type VaultLoadSamplePayload,
  type VaultLoadSampleResponse,
  type VaultCreateBlankPayload,
  type VaultCreateBlankResponse,
  type VaultValidatePathPayload,
  type VaultValidatePathResponse,
  type VaultPickFolderByPathPayload,
  type ProjectEntry,
  type ProjectSwitchPayload,
  type ArchiveConfirmPayload,
  type BgLoadPayload,
  type VaultSetPathsPayload,
  type VaultLoadSampleTwoVaultPayload,
  type VaultLoadSampleTwoVaultResponse,
  type WritingModeSetPayload,
  type BackupAppDataPayload,
  type RestoreAppDataPayload,
  type AgentPersonaReadPayload,
  type AgentPersonaResetPayload,
  isFromTopFrame,
  UNTRUSTED_FRAME_REJECTION,
  type SettingsTestConnectionPayload,
  type SessionSaveScenePayload,
  type TagsUpsertPayload,
  type TagsDeletePayload,
  type TagsRenamePayload,
  type TagsForItemPayload,
  type TagsSetForItemPayload,
  type TagsItemsForTagPayload,
  type TagsBulkApplyPayload,
  type SceneSetTagsPayload,
  type NotesGetPayload,
  type NotesSetPayload,
  type TagEntry,
  type GoalsLogWordsPayload,
  type GoalsSetGoalPayload,
  type SceneEntityLinksListPayload,
  type SceneEntityLinksUpsertPayload,
  type SceneEntityLinksDeletePayload,
  type EntityLinkedScenesPayload,
} from './ipc.js';
import { wrapIpcHandler } from './ipcErrors.js';
import {
  buildAgentSystemPrompt,
  loadPersonaFile,
  resetPersonaFile,
  type AgentPersonaName,
  type PersonaKey,
} from './agentPersona.js';
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
  insertBetaReadComment,
  listBetaReadComments,
  dismissBetaReadComment,
  insertManifestMigrationLog,
  insertArchiveIgnore,
  listArchiveIgnores,
  countTokensInWindow,
  countSuggestionsInWindow,
  insertProvenance,
  getNoteBySceneId,
  upsertNote,
  listTags,
  upsertTag,
  deleteTag,
  renameTag,
  setItemTags,
  getItemTags,
  getItemsForTag,
  bulkApplyTags,
  type DbTag,
  upsertSceneEntityLink,
  deleteSceneEntityLink,
  listSceneEntityLinks,
  listLinkedSceneIds,
  deleteStaleSceneMentionLinks,
} from './db.js';
import { evaluateAutoApply, checkCallBudget } from './budget.js';
import { generateRegistrationToken, validateRegistrationToken } from './registrationToken.js';
import { checkSetPathsGate, checkProjectSwitchGate } from './vaultGate.js';
import {
  checkVoiceSettingsUpdate,
  seedTrustedBinariesFromSettings,
  validateSttShape,
  validateTtsShape,
} from './voiceGate.js';
import { saveSnapshot, listSnapshots, getSnapshot, deleteSnapshot, deleteAllSnapshotsForScene, deleteAllSnapshotsVault } from './snapshots.js';
import { saveVersion, listVersions, getVersion, rollbackVersion } from './versions.js';
import { buildMigrationPlans, applyMigrationPlan } from './migration.js';
import {
  readVaultFile,
  writeVaultFileAtomic,
  writeFileAtomic,
  listVaultFiles,
  deleteVaultFile,
  moveVaultFile,
  readManifest,
  writeManifest,
  defaultManifest,
  reindexVault,
  importObsidianVault,
  obsidianDryRun,
  startVaultWatcher,
  stopVaultWatcher,
  startNotesVaultWatcher,
  stopNotesVaultWatcher,
  scaffoldStoryVault,
  scaffoldNotesVault,
  isEmptyOrMissing,
  parseFrontmatter,
  serializeFrontmatter,
  safePath,
  safeVaultIpcJoin,
  safeVaultDirIpcJoin,
  resolveEpubExportPath,
  writeSceneFile,
  writeSceneFileAtomic,
  readSceneFile,
  chapterVaultPath,
  sceneVaultPath,
  mergeProvenanceFrontmatter,
} from './vault.js';
import { openManifest, ManifestMigrationError } from './manifest.js';
import { assertValidManifest } from './manifestValidate.js';
import {
  createEntity,
  readEntity,
  updateEntity,
  deleteEntity,
  listEntities,
  reindexEntities,
  migrateEntityAliases,
  getEntityBacklinks,
} from './entities.js';
import { getReciprocal } from './entityRelations.js';
import {
  buildArchiveIndex,
  getArchiveIndex,
  getArchiveStatus,
  runArchiveScan,
  type ArchiveIgnoreKey,
} from './archiveAgent.js';
import { registerVoiceHandlers } from './voice.js';
import { maskSettingsForRenderer, reconcileSettingsFromRenderer } from './settings-masking.js';
import { initSecretsStore, getSecretsStore } from './secrets/index.js';
import {
  hydrateSecretsIntoSettings,
  migrateSecretsFromSettingsFile,
  persistSecretsAndStripSettings,
} from './secrets/migration.js';
import { indexDocument, buildFullIndex, searchVault } from './search.js';
import { buildEpub } from './epub.js';
import { buildDocx } from './docx.js';
import {
  sceneToMarkdown, chapterToMarkdown, storyToMarkdown, vaultToMarkdown,
  sceneToPlaintext, chapterToPlaintext, storyToPlaintext, vaultToPlaintext,
  type ExportableScene, type ExportableChapter, type ExportableStory,
} from './exportFormatters.js';
import { registerStreamingHandlers, categorizeStreamError, streamErrorUserMessage } from './streaming.js';
import { streamFromProvider } from './provider.js';
import {
  configureTelemetry,
  generateSessionId,
  reportEvent,
  validateTelemetryPayload,
} from './telemetry.js';
import {
  parseScanTips,
  buildScanSuggestions,
  parseBetaReadLines,
  buildBetaReadComments,
} from './writingAssistant.js';
import { getWritingModeState, setWritingModeState } from './writingMode.js';
import { backupAppData, restoreAppData } from './backup.js';
import {
  loadBrainstormSettings,
  setCategoryRouting,
  resolveDestination,
  normalizeRoutingDestination,
  listNotesVaultFolders,
  BLANK_MODE_STAGING_DIR,
  selectContext,
  type ContextCandidate,
} from './brainstormRouting.js';
import { listTemplates, scaffoldFromTemplate, saveAsTemplate, listNoteTemplates } from './templates.js';
import { listNotesTags, renameNotesTag, mergeNotesTags } from './notesTagWrangler.js';
import { batchReadVaultIcons, listUserIconPacks, readUserPackSvg } from './iconPacks.js';
import { logWords, getWritingStats, setDailyGoal, resetStreak } from './goals.js';

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
    ipcMain.on(channel, (event, { requestId }: { requestId: string }) => {
      if (!isFromTopFrame(event)) return;
      agentControllers.get(requestId)?.abort();
      agentControllers.delete(requestId);
    });
  }
}

// ─── Vault root ───
// User can open any local folder as their vault; the chosen path is persisted
// in userData/vault-settings.json so it survives restarts.
interface VaultSettings {
  vaultRoot: string;
  notesVaultRoot?: string;
  // SKY-9 / SKY-15: which onboarding layout the user picked. Absent on
  // existing installs is treated as 'default' for back-compat. 'imported'
  // is set by the Obsidian importer once SKY-12 lands its picker — for
  // seeding purposes the main side maps it to 'blank' so we don't overwrite
  // imported content.
  layoutMode?: 'default' | 'blank' | 'imported';
  recentProjects?: ProjectEntry[];
}

const MAX_RECENT_PROJECTS = 5;

function addToRecentProjects(vaultRoot: string): void {
  const current = loadVaultSettings();
  const name = path.basename(vaultRoot);
  const entry: ProjectEntry = { name, vaultRoot, openedAt: new Date().toISOString() };
  const existing = (current.recentProjects ?? []).filter((p) => p.vaultRoot !== vaultRoot);
  const updated = [entry, ...existing].slice(0, MAX_RECENT_PROJECTS);
  saveVaultSettings({ recentProjects: updated });
}

function getRecentProjects(): ProjectEntry[] {
  return loadVaultSettings().recentProjects ?? [];
}

function getVaultSettingsPath(): string {
  return path.join(app.getPath('userData'), 'vault-settings.json');
}

// SKY-9 / SKY-15: first-run defaults sit side-by-side under ~/Mythos/ with
// each vault as its own folder, per the board-accepted SKY-15 plan. Existing
// installs keep whatever `vault-settings.json` already persisted — the
// defaults only fire when there is no persisted root, so this is a
// fresh-install-only change. No on-disk migration of user content.
function defaultVaultRoot(): string {
  return path.join(app.getPath('home'), 'Mythos', 'Story Vault');
}

function defaultNotesVaultRoot(): string {
  return path.join(app.getPath('home'), 'Mythos', 'Notes Vault');
}

// SKY-9: layoutMode resolution. 'imported' (set by the Obsidian importer) is
// treated as 'blank' here — the importer wrote its own content; we must not
// scaffold over it. Absent = 'default' for back-compat with installs that
// predate the field.
function getLayoutMode(): 'default' | 'blank' {
  const mode = loadVaultSettings().layoutMode ?? 'default';
  return mode === 'default' ? 'default' : 'blank';
}

function loadVaultSettings(): VaultSettings {
  const settingsPath = getVaultSettingsPath();
  if (fs.existsSync(settingsPath)) {
    try {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as VaultSettings;
    } catch {
      // fall through to default
    }
  }
  return { vaultRoot: defaultVaultRoot() };
}

// Merges `updates` into the persisted settings so partial writes don't clobber other fields.
function saveVaultSettings(updates: Partial<VaultSettings>): void {
  const current = loadVaultSettings();
  const merged: VaultSettings = { ...current, ...updates };
  fs.writeFileSync(getVaultSettingsPath(), JSON.stringify(merged, null, 2), 'utf-8');
}

const getVaultRoot = () => loadVaultSettings().vaultRoot;
const getManifestPath = () => path.join(getVaultRoot(), 'manifest.json');
const getNotesVaultRoot = () =>
  loadVaultSettings().notesVaultRoot ?? defaultNotesVaultRoot();

/**
 * SKY-10: locate a scene's chapter directory (relative path inside the vault)
 * by looking it up in the manifest. Returns null when the scene id is not
 * known so callers can degrade to an empty history rather than throw.
 */
function resolveSceneChapterDir(sceneId: string): string | null {
  try {
    const manifest = readManifest(getManifestPath());
    for (const story of manifest.stories) {
      for (const chapter of story.chapters) {
        if (chapter.scenes.find((s) => s.id === sceneId)) {
          return chapter.path;
        }
      }
    }
    const flat = manifest.scenes.find((s) => s.id === sceneId);
    if (flat) return path.posix.dirname(flat.path.split(path.sep).join('/'));
  } catch { /* missing manifest — treat as no history */ }
  return null;
}

// SKY-170: extract entity IDs from entity:// markdown links ([label](entity://ent_*))
function parseMentionEntityIds(prose: string): Set<string> {
  const ids = new Set<string>();
  const re = /\[[^\]]*\]\(entity:\/\/(ent_[^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prose)) !== null) {
    ids.add(m[1]);
  }
  return ids;
}

function ensureVaultDir() {
  const vaultRoot = getVaultRoot();
  // SKY-9: treat a missing OR empty directory as needing first-run seeding so
  // a user who pre-creates the folder still gets the canonical layout.
  // Scaffold itself is idempotent — never touches existing entries.
  if (!fs.existsSync(vaultRoot)) {
    fs.mkdirSync(vaultRoot, { recursive: true });
  }
  if (isEmptyOrMissing(vaultRoot)) {
    scaffoldStoryVault(vaultRoot, getLayoutMode());
  }
  // Open DB before manifest migration so the audit callback can log immediately.
  openDb(vaultRoot);
  const manifestPath = getManifestPath();
  if (!fs.existsSync(manifestPath)) {
    writeManifest(manifestPath, defaultManifest(vaultRoot));
  } else {
    // Migrate legacy manifests to current schema version on every vault open.
    try {
      openManifest(manifestPath, {
        vaultRoot,
        onMigrated: (entry) => {
          insertManifestMigrationLog({
            id: entry.id,
            manifest_path: manifestPath,
            from_version: entry.fromVersion,
            to_version: entry.toVersion,
            backup_path: entry.backupPath,
            created_at: entry.createdAt,
          });
        },
      });
    } catch (err) {
      if (err instanceof ManifestMigrationError) {
        dialog.showErrorBox(
          'Vault Migration Failed',
          `Could not migrate the vault manifest.\n\nA backup was saved to:\n${err.backupPath}\n\nThe application will continue, but the vault may be in an inconsistent state. ` +
            'You can restore from the backup manually.\n\nDetails: ' +
            err.message
        );
      } else {
        throw err;
      }
    }
  }
}

// SKY-20: helpers used by the brainstorm routing IPC handlers below. Kept
// near ensureNotesVaultDir so the staging-dir + frontmatter shape live in
// the same area of the file.
function joinNotesPath(...segments: string[]): string {
  return segments
    .map((s) => s.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
    .filter((s) => s.length > 0)
    .join('/');
}

function renderBrainstormNote(args: {
  category: 'character' | 'location' | 'item' | 'note';
  name: string;
  content: string;
  suggestionId: string;
  now: string;
}): string {
  return [
    '---',
    `agent: brainstorm`,
    `suggestionId: ${args.suggestionId}`,
    `type: ${args.category}`,
    `name: ${args.name}`,
    `createdAt: ${args.now}`,
    '---',
    '',
    `# ${args.name}`,
    '',
    args.content,
    '',
  ].join('\n');
}

function persistBrainstormSuggestion(
  suggestionId: string,
  relPath: string,
  payload: { category: string; name: string; content: string },
  now: string,
): void {
  try {
    upsertSuggestion({
      id: suggestionId,
      source_agent: 'brainstorm',
      confidence: 0.8,
      rationale: `${payload.category}: ${payload.name} — ${payload.content}`,
      target_kind: 'vault',
      target_path: relPath,
      target_anchor: null,
      payload_json: JSON.stringify({ type: payload.category, name: payload.name, description: payload.content }),
      status: 'proposed',
      created_at: now,
      applied_at: null,
      applied_run_id: null,
      budget_exceeded: 0,
    });
  } catch {
    // Logging is best-effort — a DB hiccup must not block the agent from
    // creating notes the user is watching land.
  }
}

function ensureNotesVaultDir() {
  const notesVaultRoot = getNotesVaultRoot();
  // SKY-9 / SKY-15: same empty-dir trigger as ensureVaultDir so a user who
  // pre-creates ~/Mythos/Notes Vault/ still gets the six-folder layout seeded.
  // Blank/imported modes skip scaffolding (the scaffold function is a no-op).
  if (!fs.existsSync(notesVaultRoot)) {
    fs.mkdirSync(notesVaultRoot, { recursive: true });
  }
  if (isEmptyOrMissing(notesVaultRoot)) {
    scaffoldNotesVault(notesVaultRoot, getLayoutMode());
  }
}

// Notify renderer when vault changes so it can refresh state
function notifyVaultChanged(filePath: string) {
  if (mainWindow) {
    // MYT-445/MYT-362 L-2: convert chokidar's absolute path to a vault-relative
    // path before sending to the renderer, and drop the event if the resolved
    // path escapes the vault (defense in depth against symlink-based leaks).
    const vaultRoot = getVaultRoot();
    let relativePath: string;
    try {
      relativePath = path.relative(vaultRoot, filePath);
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return;
      safePath(vaultRoot, relativePath);
    } catch {
      return;
    }
    mainWindow.webContents.send('vault:file-changed', { path: relativePath });
    // Debounced reindex — auto-sync markdown prose back to manifest
    scheduleReindex();
  }
}

// Notify renderer when the notes vault changes so it can refresh entity state.
// Fires on external edits (e.g. Obsidian) and schedules an FTS rebuild.
function notifyNotesVaultChanged(_filePath: string) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    scheduleReindex();
    mainWindow.webContents.send('vault:notes-updated', { count: 1 });
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
      // Rebuild FTS index after manifest reindex (incremental on file change)
      try { buildFullIndex(getDb(), vaultRoot, updated); } catch { /* non-fatal */ }
    } catch {
      // non-fatal — next open will reindex
    }
    reindexTimer = null;
  }, 1000);
}

// Registration token gate lives in ./registrationToken.ts (MYT-360 / MYT-367)
// so unit tests can exercise it without pulling in Electron.

/**
 * Validate a proposed vault path for vault:setPaths.
 * Throws a descriptive Error if the path is invalid so setupIpcMain
 * can convert it to { error: message } for the renderer.
 */
function validateVaultPath(p: string, field: string): void {
  if (!p || typeof p !== 'string') {
    throw new Error(`${field}: path must be a non-empty string`);
  }
  if (!path.isAbsolute(p)) {
    throw new Error(`${field}: path must be absolute (got: ${p})`);
  }
  // If it already exists, check it is a directory and writable.
  if (fs.existsSync(p)) {
    const stat = fs.statSync(p);
    if (!stat.isDirectory()) {
      throw new Error(`${field}: path exists but is not a directory: ${p}`);
    }
    try {
      fs.accessSync(p, fs.constants.W_OK);
    } catch {
      throw new Error(`${field}: directory is not writable: ${p}`);
    }
    return;
  }
  // Path does not exist — check that the first existing ancestor is writable
  // so we can create it on first use.
  let ancestor = path.dirname(p);
  while (ancestor !== path.dirname(ancestor)) {
    if (fs.existsSync(ancestor)) {
      try {
        fs.accessSync(ancestor, fs.constants.W_OK);
      } catch {
        throw new Error(`${field}: parent directory is not writable: ${ancestor}`);
      }
      return;
    }
    ancestor = path.dirname(ancestor);
  }
}

// ─── Export helpers (SKY-153) ───

function safeExportFilename(s: string): string {
  return s.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'export';
}

function readSceneProseForExport(sc: import('./ipc.js').SceneEntry): ExportableScene {
  let prose = '';
  try { prose = readSceneFile(getVaultRoot(), sc.path).prose; } catch { /* missing file */ }
  return { title: sc.title, prose };
}

function buildTextExport(
  manifest: import('./ipc.js').Manifest,
  scope: import('./ipc.js').ExportScope,
  format: 'markdown' | 'plaintext',
): { content: string; defaultFilename: string } {
  const toChapter = (ch: import('./ipc.js').ChapterEntry): ExportableChapter => ({
    title: ch.title,
    scenes: [...ch.scenes].sort((a, b) => a.order - b.order).map(readSceneProseForExport),
  });
  const toStory = (st: import('./ipc.js').StoryEntry): ExportableStory => ({
    title: st.title,
    chapters: [...st.chapters].sort((a, b) => a.order - b.order).map(toChapter),
  });
  const md = format === 'markdown';

  switch (scope.kind) {
    case 'scene': {
      let found: import('./ipc.js').SceneEntry | null = null;
      outer: for (const story of manifest.stories) {
        for (const ch of story.chapters) {
          const sc = ch.scenes.find((s) => s.id === scope.sceneId);
          if (sc) { found = sc; break outer; }
        }
      }
      if (!found) {
        found = (manifest.scenes ?? []).find(
          (s: import('./ipc.js').SceneEntry) => s.id === scope.sceneId,
        ) ?? null;
      }
      if (!found) throw new Error(`Scene not found: ${scope.sceneId}`);
      const exportScene = readSceneProseForExport(found);
      return {
        content: md ? sceneToMarkdown(exportScene) : sceneToPlaintext(exportScene),
        defaultFilename: safeExportFilename(found.title),
      };
    }
    case 'chapter': {
      const story = manifest.stories.find((s) => s.id === scope.storyId);
      if (!story) throw new Error(`Story not found: ${scope.storyId}`);
      const ch = story.chapters.find((c) => c.id === scope.chapterId);
      if (!ch) throw new Error(`Chapter not found: ${scope.chapterId}`);
      const scenes = [...ch.scenes].sort((a, b) => a.order - b.order).map(readSceneProseForExport);
      return {
        content: md ? chapterToMarkdown(ch.title, scenes) : chapterToPlaintext(ch.title, scenes),
        defaultFilename: safeExportFilename(ch.title),
      };
    }
    case 'story': {
      const story = manifest.stories.find((s) => s.id === scope.storyId);
      if (!story) throw new Error(`Story not found: ${scope.storyId}`);
      const exportStory = toStory(story);
      return {
        content: md ? storyToMarkdown(exportStory) : storyToPlaintext(exportStory),
        defaultFilename: safeExportFilename(story.title),
      };
    }
    case 'vault': {
      const exportStories = manifest.stories.map(toStory);
      return {
        content: md ? vaultToMarkdown(exportStories) : vaultToPlaintext(exportStories),
        defaultFilename: 'vault-export',
      };
    }
  }
}

// ─── Tag helper ───
function dbTagToEntry(t: DbTag): TagEntry {
  return { id: t.id, name: t.name, color: t.color, createdAt: t.created_at };
}

// ─── Export helpers (SKY-153) ───
function safeEF(s: string): string { return s.replace(/[/\?%*:|"<>]/g, '-').trim() || 'export'; }
function readSEF(sc: import('./ipc.js').SceneEntry): ExportableScene { let p = ''; try { p = readSceneFile(getVaultRoot(), sc.path).prose; } catch { /* missing */ } return { title: sc.title, prose: p }; }
function buildTE(manifest: import('./ipc.js').Manifest, scope: import('./ipc.js').ExportScope, fmt: 'markdown'|'plaintext'): { content: string; defaultFilename: string } {
  const toC = (ch: import('./ipc.js').ChapterEntry): ExportableChapter => ({ title: ch.title, scenes: [...ch.scenes].sort((a,b)=>a.order-b.order).map(readSEF) });
  const toSt = (st: import('./ipc.js').StoryEntry): ExportableStory => ({ title: st.title, chapters: [...st.chapters].sort((a,b)=>a.order-b.order).map(toC) });
  const md = fmt === 'markdown';
  switch (scope.kind) {
    case 'scene': { let f2: import('./ipc.js').SceneEntry|null=null; outer: for (const st of manifest.stories) for (const ch of st.chapters) { const sc=ch.scenes.find((s)=>s.id===scope.sceneId); if(sc){f2=sc;break outer;} } if (!f2) f2=(manifest.scenes??[]).find((s: import('./ipc.js').SceneEntry)=>s.id===scope.sceneId)??null; if (!f2) throw new Error(`Scene not found: ${scope.sceneId}`); const es=readSEF(f2); return { content: md ? sceneToMarkdown(es) : sceneToPlaintext(es), defaultFilename: safeEF(f2.title) }; }
    case 'chapter': { const st=manifest.stories.find((s)=>s.id===scope.storyId); if(!st) throw new Error(`Story not found: ${scope.storyId}`); const ch=st.chapters.find((c)=>c.id===scope.chapterId); if(!ch) throw new Error(`Chapter not found: ${scope.chapterId}`); const scenes=[...ch.scenes].sort((a,b)=>a.order-b.order).map(readSEF); return { content: md ? chapterToMarkdown(ch.title,scenes) : chapterToPlaintext(ch.title,scenes), defaultFilename: safeEF(ch.title) }; }
    case 'story': { const st=manifest.stories.find((s)=>s.id===scope.storyId); if(!st) throw new Error(`Story not found: ${scope.storyId}`); const es=toSt(st); return { content: md ? storyToMarkdown(es) : storyToPlaintext(es), defaultFilename: safeEF(st.title) }; }
    case 'vault': return { content: md ? vaultToMarkdown(manifest.stories.map(toSt)) : vaultToPlaintext(manifest.stories.map(toSt)), defaultFilename: 'vault-export' };
  }
}

// ─── IPC Handlers ───
const handlers: IpcHandlers = {
  // MYT-774: renderer-facing vault channels enforce dotfile + extension policy
  // at the IPC boundary. The low-level helpers also re-check traversal, so a
  // bad path is rejected twice independently.
  [IPC_CHANNELS.VAULT_READ]: (payload: VaultReadPayload): VaultReadResponse => {
    ensureVaultDir();
    safeVaultIpcJoin(getVaultRoot(), payload.path, false);
    return readVaultFile(getVaultRoot(), payload.path);
  },
  [IPC_CHANNELS.VAULT_WRITE]: (payload: VaultWritePayload): VaultWriteResponse => {
    ensureVaultDir();
    safeVaultIpcJoin(getVaultRoot(), payload.path, true);
    return writeVaultFileAtomic(getVaultRoot(), payload.path, payload.content);
  },
  [IPC_CHANNELS.VAULT_LIST]: (payload: VaultListPayload): VaultListResponse => {
    ensureVaultDir();
    // LIST takes a directory — enforce traversal/symlink only, not the
    // file-extension allow-list.
    if (payload.root) safePath(getVaultRoot(), payload.root);
    return listVaultFiles(getVaultRoot(), payload.root);
  },
  [IPC_CHANNELS.VAULT_DELETE]: (payload: VaultDeletePayload): VaultDeleteResponse => {
    ensureVaultDir();
    safeVaultIpcJoin(getVaultRoot(), payload.path, true);
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
    // MYT-792: validate before touching disk. assertValidManifest throws
    // ManifestValidationError on the first invalid field; setupIpcMain's
    // try/catch converts it into { error } for the renderer.
    assertValidManifest(payload?.manifest);
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
    addToRecentProjects(newRoot);
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
    // MYT-360: Validate token — must come from a user-selected folder picker
    const validated = validateRegistrationToken(payload.registrationToken);
    if (!validated) {
      return { error: 'registrationToken required — use vault:pick-folder first' };
    }
    ensureVaultDir();
    const manifest = readManifest(getManifestPath());
    const result = importObsidianVault(validated.vaultRoot, getVaultRoot(), manifest);
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
  [IPC_CHANNELS.SUGGESTIONS_GET]: (payload: SuggestionsGetPayload) => {
    ensureVaultDir();
    return { suggestion: getSuggestion(payload.id) };
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
        const { finalStatus, snapshotPath } = autoApplyVaultWrite(payload.suggestion, now);
        updateSuggestionStatus(payload.suggestion.id, finalStatus, now, 'auto-apply');
        insertAuditLog({
          id: auditId,
          suggestion_id: payload.suggestion.id,
          action: finalStatus === 'applied' ? 'apply' : 'accept',
          snapshot_path: snapshotPath,
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

    const { finalStatus, snapshotPath } = autoApplyVaultWrite(suggestion, now);
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
        writeVaultFileAtomic(getVaultRoot(), snapshot.path, snapshot.originalContent);
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

  // ─── Provenance ───
  [IPC_CHANNELS.PROVENANCE_UPSERT]: (payload: ProvenanceUpsertPayload) => {
    ensureVaultDir();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    insertProvenance({
      id,
      entity_id: payload.entityId,
      entity_kind: payload.entityKind,
      agent_id: payload.agentId,
      agent_type: payload.agentType,
      run_id: payload.runId ?? null,
      created_at: now,
    });
    return { id };
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

  // MYT-319 — Archive Agent infers scene chronology without LLM calls
  [IPC_CHANNELS.TIMELINE_INFER]: (payload: { storyId: string }): import('./ipc.js').TimelineInferResponse => {
    ensureVaultDir();
    const manifest = readManifest(getVaultRoot());
    const story = manifest.stories.find(s => s.id === payload.storyId);
    if (!story) return { placements: [] };

    // Prose patterns that hint at a specific point in time
    const PROSE_PATTERNS: Array<{ re: RegExp; label: string }> = [
      { re: /\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December),?\s+\d{4})\b/i, label: 'date mention' },
      { re: /\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})\b/i, label: 'date mention' },
      { re: /\b(\d{4}-\d{2}-\d{2})\b/, label: 'ISO date' },
      { re: /\b(Year\s+\d+(?:\s+of\s+\w+)?)\b/i, label: 'in-world year' },
      { re: /\b(Day\s+\d+(?:\s+of\s+\w+)?)\b/i, label: 'in-world day' },
    ];

    const placements: import('./ipc.js').TimelineInferredScene[] = [];

    for (const chapter of story.chapters ?? []) {
      for (const scene of chapter.scenes ?? []) {
        let inferredTime: string | null = null;
        let confidence = 0;
        let source: 'explicit_marker' | 'prose' | null = null;
        let cue: string | null = null;

        try {
          const { content } = readVaultFile(getVaultRoot(), scene.path);
          const fm = parseFrontmatter(content);

          // Frontmatter date: field → highest confidence
          const fmDate = (fm as Record<string, unknown>)['date'];
          if (fmDate && typeof fmDate === 'string' && fmDate.trim()) {
            inferredTime = fmDate.trim();
            confidence = 0.95;
            source = 'explicit_marker';
            cue = 'frontmatter date:';
          } else {
            // Strip frontmatter block then scan prose
            const prose = content.replace(/^---[\s\S]*?---\n?/, '');
            for (const { re, label } of PROSE_PATTERNS) {
              const m = prose.match(re);
              if (m) {
                inferredTime = m[1] ?? m[0];
                confidence = 0.55;
                source = 'prose';
                cue = label;
                break;
              }
            }
          }
        } catch {
          // unreadable scene — leave nulls
        }

        placements.push({
          sceneId: scene.id,
          scenePath: scene.path,
          sceneTitle: scene.title,
          inferredTime,
          confidence,
          source,
          cue,
        });
      }
    }

    return { placements };
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
    return saveSnapshot(getVaultRoot(), payload.sceneId, payload.content, retention, payload.label);
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
    writeVaultFileAtomic(getVaultRoot(), payload.scenePath, target.content);
    return { restored: target, preRestoreSnapshot };
  },

  [IPC_CHANNELS.SNAPSHOT_DELETE]: (payload: SnapshotDeletePayload) => {
    ensureVaultDir();
    const deleted = deleteSnapshot(getVaultRoot(), payload.sceneId, payload.snapshotId);
    return { deleted };
  },
  [IPC_CHANNELS.SNAPSHOT_DELETE_ALL]: (payload: SnapshotDeleteAllPayload) => {
    ensureVaultDir();
    const deleted = payload.sceneId
      ? deleteAllSnapshotsForScene(getVaultRoot(), payload.sceneId)
      : deleteAllSnapshotsVault(getVaultRoot());
    return { deleted };
  },

  // ─── Versioned drafts (SKY-10 upgrade of MYT-198) ───
  [IPC_CHANNELS.VERSION_LIST]: (payload: VersionListPayload) => {
    ensureVaultDir();
    const chapterRelPath = resolveSceneChapterDir(payload.sceneId);
    if (!chapterRelPath) return { versions: [] };
    return { versions: listVersions(getVaultRoot(), payload.sceneId, { chapterRelPath }) };
  },
  [IPC_CHANNELS.VERSION_GET]: (payload: VersionGetPayload) => {
    ensureVaultDir();
    const chapterRelPath = resolveSceneChapterDir(payload.sceneId);
    if (!chapterRelPath) return { version: null };
    return {
      version: getVersion(getVaultRoot(), payload.sceneId, payload.ts, { chapterRelPath }),
    };
  },
  [IPC_CHANNELS.VERSION_ROLLBACK]: (payload: VersionRollbackPayload) => {
    ensureVaultDir();
    // Locate scene in manifest to get its vault path and current metadata
    const manifest = readManifest(getManifestPath());
    let found = null as import('./ipc.js').SceneEntry | null;
    outer: for (const story of manifest.stories) {
      for (const chapter of story.chapters) {
        const scene = chapter.scenes.find((s) => s.id === payload.sceneId);
        if (scene) { found = scene; break outer; }
      }
    }
    if (!found) found = manifest.scenes.find((s) => s.id === payload.sceneId) ?? null;
    if (!found) throw new Error(`Scene not found: ${payload.sceneId}`);

    safePath(getVaultRoot(), found.path);
    const chapterRelPath = path.posix.dirname(found.path.split(path.sep).join('/'));

    let currentProse = '';
    try {
      currentProse = readSceneFile(getVaultRoot(), found.path).prose;
    } catch { /* scene file may not exist yet */ }

    const { restoredVersion, preRollbackVersion } = rollbackVersion(
      getVaultRoot(),
      payload.sceneId,
      payload.ts,
      currentProse,
      { chapterRelPath },
    );

    // Write restored prose back into the scene file, preserving frontmatter
    writeSceneFileAtomic(getVaultRoot(), found.path, {
      id: found.id,
      title: found.title,
      chapterId: found.chapterId,
      storyId: found.storyId,
      order: found.order,
      prose: restoredVersion.content,
    });

    // Sync prose block in manifest
    const nowStr = new Date().toISOString();
    const proseBlock = found.blocks.find((b) => b.type === 'prose');
    if (proseBlock) {
      proseBlock.content = restoredVersion.content;
      proseBlock.updatedAt = nowStr;
    } else {
      found.blocks.push({ id: crypto.randomUUID(), type: 'prose', order: 0, content: restoredVersion.content, updatedAt: nowStr });
    }
    found.updatedAt = nowStr;
    writeManifest(getManifestPath(), manifest);

    if (mainWindow) mainWindow.webContents.send('vault:changed', { kind: 'scene', id: found.id, path: found.path });
    return { restoredVersion, preRollbackVersion };
  },

  // ─── SKY-10: Legacy single-file-per-chapter migration ───
  [IPC_CHANNELS.MIGRATION_DRY_RUN]: (payload: import('./ipc.js').MigrationDryRunPayload) => {
    ensureVaultDir();
    const plans = buildMigrationPlans(getVaultRoot(), payload.storyPath);
    return { plans };
  },
  [IPC_CHANNELS.MIGRATION_APPLY]: (payload: import('./ipc.js').MigrationApplyPayload) => {
    ensureVaultDir();
    const result = applyMigrationPlan(getVaultRoot(), payload.storyPath, payload.planId);
    return { result };
  },

  // ─── Entity CRUD ───
  [IPC_CHANNELS.ENTITY_CREATE]: (payload: EntityCreatePayload) => {
    ensureVaultDir();
    const manifest = readManifest(getManifestPath());
    const entry = createEntity(getVaultRoot(), manifest, payload);
    writeManifest(getManifestPath(), manifest);
    setItemTags(entry.id, 'entity', entry.tags ?? []);
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
      relations: payload.relations,
      prose: payload.prose,
      properties: payload.properties,
    });
    writeManifest(getManifestPath(), manifest);
    if (payload.tags !== undefined) setItemTags(payload.id, 'entity', payload.tags);
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
    migrateEntityAliases(getVaultRoot(), manifest);
    writeManifest(getManifestPath(), manifest);
    return { entities: listEntities(getVaultRoot(), manifest, payload.type) };
  },
  [IPC_CHANNELS.ENTITY_BACKLINKS]: (payload: EntityBacklinksPayload) => {
    ensureVaultDir();
    const manifest = readManifest(getManifestPath());
    return getEntityBacklinks(getVaultRoot(), manifest, payload.entityId);
  },

  // SKY-55: per-scene notes
  [IPC_CHANNELS.NOTES_GET]: (payload: NotesGetPayload) => {
    ensureVaultDir();
    const content = getNoteBySceneId(payload.sceneId);
    return { content };
  },
  [IPC_CHANNELS.NOTES_SET]: (payload: NotesSetPayload) => {
    ensureVaultDir();
    upsertNote(payload.sceneId, payload.content);
    return { saved: true };
  },

  // SKY-158: Tag system
  [IPC_CHANNELS.TAGS_LIST]: () => {
    const tags = listTags();
    return { tags: tags.map(dbTagToEntry) };
  },
  [IPC_CHANNELS.TAGS_UPSERT]: (payload: TagsUpsertPayload) => {
    const tag = upsertTag(payload.name, payload.color);
    return { tag: dbTagToEntry(tag) };
  },
  [IPC_CHANNELS.TAGS_DELETE]: (payload: TagsDeletePayload) => {
    deleteTag(payload.id);
    return { deleted: true };
  },
  [IPC_CHANNELS.TAGS_RENAME]: (payload: TagsRenamePayload) => {
    ensureVaultDir();
    const oldTag = listTags().find((t) => t.id === payload.id);
    const tag = renameTag(payload.id, payload.name);
    // Cascade rename through manifest entity/scene tags
    if (oldTag) {
      const manifest = readManifest(getManifestPath());
      let changed = false;
      for (const entity of manifest.entities) {
        if (entity.tags?.includes(oldTag.name)) {
          entity.tags = entity.tags.map((t) => (t === oldTag.name ? tag.name : t));
          changed = true;
        }
      }
      for (const story of manifest.stories) {
        for (const chapter of story.chapters) {
          for (const scene of chapter.scenes) {
            if (scene.card?.tags?.includes(oldTag.name)) {
              scene.card.tags = scene.card.tags.map((t) => (t === oldTag.name ? tag.name : t));
              changed = true;
            }
          }
        }
      }
      if (changed) {
        writeManifest(getManifestPath(), manifest);
        buildFullIndex(getDb(), getVaultRoot(), manifest);
      }
    }
    return { tag: dbTagToEntry(tag) };
  },
  [IPC_CHANNELS.TAGS_FOR_ITEM]: (payload: TagsForItemPayload) => {
    const tags = getItemTags(payload.itemId);
    return { tags };
  },
  [IPC_CHANNELS.TAGS_SET_FOR_ITEM]: (payload: TagsSetForItemPayload) => {
    setItemTags(payload.itemId, payload.itemKind, payload.tags);
    // Sync tags back to manifest for entities
    if (payload.itemKind === 'entity') {
      const manifest = readManifest(getManifestPath());
      const entity = manifest.entities.find((e) => e.id === payload.itemId);
      if (entity) {
        entity.tags = payload.tags;
        writeManifest(getManifestPath(), manifest);
      }
    } else if (payload.itemKind === 'scene') {
      const manifest = readManifest(getManifestPath());
      let found = null as import('./ipc.js').SceneEntry | null;
      outer: for (const story of manifest.stories) {
        for (const chapter of story.chapters) {
          const s = chapter.scenes.find((sc) => sc.id === payload.itemId);
          if (s) { found = s; break outer; }
        }
      }
      if (!found) found = manifest.scenes.find((s) => s.id === payload.itemId) ?? null;
      if (found) {
        if (!found.card) found.card = {};
        found.card.tags = payload.tags;
        writeManifest(getManifestPath(), manifest);
        // Re-index scene with updated tags
        let prose = '';
        try { prose = readSceneFile(getVaultRoot(), found.path).prose; } catch { /* ignore */ }
        indexDocument(getDb(), {
          docId: found.id, vault: 'story', kind: 'scene', title: found.title,
          body: [payload.tags.join(' '), prose].filter(Boolean).join('\n'),
        });
      }
    }
    return { tags: payload.tags };
  },
  [IPC_CHANNELS.TAGS_ITEMS_FOR_TAG]: (payload: TagsItemsForTagPayload) => {
    const items = getItemsForTag(payload.tagName);
    return { items: items.map((i) => ({ itemId: i.itemId, itemKind: i.itemKind as 'scene' | 'entity' })) };
  },
  [IPC_CHANNELS.TAGS_BULK_APPLY]: (payload: TagsBulkApplyPayload) => {
    const updated = bulkApplyTags(
      payload.itemIds,
      payload.itemKind,
      payload.addTags ?? [],
      payload.removeTags ?? [],
    );
    // Sync to manifest
    ensureVaultDir();
    const manifest = readManifest(getManifestPath());
    let manifestChanged = false;
    for (const itemId of payload.itemIds) {
      const newTags = getItemTags(itemId);
      if (payload.itemKind === 'entity') {
        const entity = manifest.entities.find((e) => e.id === itemId);
        if (entity) { entity.tags = newTags; manifestChanged = true; }
      } else {
        for (const story of manifest.stories) {
          for (const chapter of story.chapters) {
            const scene = chapter.scenes.find((s) => s.id === itemId);
            if (scene) {
              if (!scene.card) scene.card = {};
              scene.card.tags = newTags;
              manifestChanged = true;
            }
          }
        }
      }
    }
    if (manifestChanged) writeManifest(getManifestPath(), manifest);
    return { updated };
  },
  [IPC_CHANNELS.SCENE_SET_TAGS]: (payload: SceneSetTagsPayload) => {
    ensureVaultDir();
    const manifest = readManifest(getManifestPath());
    let found = null as import('./ipc.js').SceneEntry | null;
    outer: for (const story of manifest.stories) {
      for (const chapter of story.chapters) {
        const s = chapter.scenes.find((sc) => sc.id === payload.sceneId);
        if (s) { found = s; break outer; }
      }
    }
    if (!found) found = manifest.scenes.find((s) => s.id === payload.sceneId) ?? null;
    if (!found) throw new Error(`Scene not found: ${payload.sceneId}`);
    if (!found.card) found.card = {};
    found.card.tags = payload.tags;
    found.updatedAt = new Date().toISOString();
    writeManifest(getManifestPath(), manifest);
    setItemTags(payload.sceneId, 'scene', payload.tags);
    // Re-index scene
    let prose = '';
    try { prose = readSceneFile(getVaultRoot(), found.path).prose; } catch { /* ignore */ }
    indexDocument(getDb(), {
      docId: found.id, vault: 'story', kind: 'scene', title: found.title,
      body: [payload.tags.join(' '), prose].filter(Boolean).join('\n'),
    });
    return { scene: found };
  },

  [IPC_CHANNELS.SETTINGS_GET]: (): AppSettings => {
    const s = maskSettingsForRenderer(loadAppSettings());
    // SKY-12.4: if the configured vault roots don't exist on disk, force
    // onboardingComplete=false so the wizard re-appears on next boot. This
    // handles the case where the user moves or deletes the vault folder.
    const vaultSettings = loadVaultSettings();
    const storyMissing = !fs.existsSync(vaultSettings.vaultRoot);
    const notesMissing = !fs.existsSync(vaultSettings.notesVaultRoot ?? defaultNotesVaultRoot());
    if (storyMissing || notesMissing) {
      return { ...s, onboardingComplete: false };
    }
    return s;
  },
  [IPC_CHANNELS.SETTINGS_SET]: (payload: SettingsSetPayload) => {
    const current = loadAppSettings();
    // Reconcile masked API key fields (apiKey, voice.openaiApiKey) — when the
    // renderer echoes back the masked preview unchanged, preserve the stored
    // raw key. See settings-masking.ts (MYT-424).
    const reconciled = reconcileSettingsFromRenderer(payload.settings, current);
    // MYT-788: shape-validate stt/tts and gate any renderer-driven change to
    // the local binary / model paths. A failed gate aborts the whole write —
    // we deliberately do not persist a "mostly-OK" settings object, because
    // the rejected path field would survive next reload via reconciliation.
    const sttShape = validateSttShape(reconciled.stt);
    if (!sttShape.ok) return { saved: false, error: sttShape.error };
    const ttsShape = validateTtsShape(reconciled.tts);
    if (!ttsShape.ok) return { saved: false, error: ttsShape.error };
    const voiceGate = checkVoiceSettingsUpdate(
      reconciled.stt,
      current.stt,
      reconciled.tts,
      current.tts,
      {
        sttBinaryToken: payload.sttBinaryToken,
        ttsBinaryToken: payload.ttsBinaryToken,
        ttsModelToken: payload.ttsModelToken,
      },
    );
    if (!voiceGate.ok) return { saved: false, error: voiceGate.error };
    // Regenerate sessionId when telemetry is being disabled (privacy: unlink future sessions).
    let telemetry = reconciled.telemetry;
    if (telemetry && !telemetry.enabled && current.telemetry?.enabled) {
      telemetry = { enabled: false, sessionId: generateSessionId() };
    }
    const updated = { ...reconciled, ...(telemetry !== undefined ? { telemetry } : {}) };
    saveAppSettings(updated);
    // Re-configure telemetry in-process immediately.
    if (updated.telemetry) {
      configureTelemetry({ enabled: updated.telemetry.enabled, sessionId: updated.telemetry.sessionId });
    }
    // Restart writing scan scheduler when scanIntervalSeconds or enabled flag changes.
    const prevInterval = current.agents.writingAssistant.scanIntervalSeconds;
    const newInterval = updated.agents.writingAssistant.scanIntervalSeconds;
    const prevEnabled = current.agents.writingAssistant.enabled;
    const newEnabled = updated.agents.writingAssistant.enabled;
    if (prevInterval !== newInterval || prevEnabled !== newEnabled) {
      startWritingScanScheduler();
    }
    return { saved: true };
  },

  // SKY-12.4: mark onboarding as complete without sending back the full settings object.
  [IPC_CHANNELS.ONBOARDING_COMPLETE]: () => {
    const current = loadAppSettings();
    saveAppSettings({ ...current, onboardingComplete: true });
    return { ok: true as const };
  },

  // SKY-12.4: debug reset — clears vault paths and onboardingComplete so the
  // wizard re-appears on next boot. Only available when MYTHOS_DEV=1 is set.
  [IPC_CHANNELS.ONBOARDING_RESET]: () => {
    if (process.env.MYTHOS_DEV !== '1') {
      return { ok: true as const };
    }
    saveVaultSettings({ vaultRoot: defaultVaultRoot(), notesVaultRoot: undefined, layoutMode: undefined });
    const current = loadAppSettings();
    saveAppSettings({ ...current, onboardingComplete: false });
    return { ok: true as const };
  },

  // SKY-130: thin write that persists only the last-opened scene + cursor position.
  // Bypasses the full settings:set reconciliation path (API key masking, scan scheduler).
  [IPC_CHANNELS.SESSION_SCENE_SAVE]: (payload: SessionSaveScenePayload) => {
    const current = loadAppSettings();
    saveAppSettings({
      ...current,
      lastOpenedScene: {
        sceneId: payload.sceneId,
        scenePath: payload.scenePath,
        scrollTop: payload.scrollTop,
        cursorLine: payload.cursorLine,
      },
    });
    return { saved: true };
  },

  // SKY-154
  [IPC_CHANNELS.GOALS_LOG_WORDS]: (payload: GoalsLogWordsPayload) => { logWords(payload.date, payload.wordsAdded); return { ok: true as const }; },
  [IPC_CHANNELS.GOALS_GET_STATS]: () => { const today = new Date().toISOString().slice(0, 10); return getWritingStats(today); },
  [IPC_CHANNELS.GOALS_SET_GOAL]: (payload: GoalsSetGoalPayload) => { setDailyGoal(payload.dailyGoal); return { ok: true as const }; },
  [IPC_CHANNELS.GOALS_RESET_STREAK]: () => { const today = new Date().toISOString().slice(0, 10); resetStreak(today); return { ok: true as const }; },

  [IPC_CHANNELS.SETTINGS_TEST_CONNECTION]: async (payload: SettingsTestConnectionPayload) => {
    const t0 = Date.now();
    try {
      const ac = new AbortController();
      for await (const _ of streamFromProvider(
        { kind: payload.provider.kind, apiKey: payload.provider.apiKey, baseUrl: payload.provider.baseUrl, model: payload.provider.model },
        { messages: [{ role: 'user', content: 'Hi' }], maxTokens: 1, signal: ac.signal },
      )) {
        ac.abort();
        break;
      }
      return { ok: true, latencyMs: Date.now() - t0 };
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') {
        return { ok: true, latencyMs: Date.now() - t0 };
      }
      return { ok: false, latencyMs: Date.now() - t0, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  },

  // MYT-343: per-agent config get/set
  [IPC_CHANNELS.SETTINGS_GET_AGENT_CONFIG]: (): import('./ipc.js').AgentConfigMap => {
    const s = loadAppSettings();
    // Common shape across all three agents; toConfig only reads enabled/model/budget.
    const toConfig = (a: typeof s.agents.brainstorm): import('./ipc.js').AgentConfig => ({
      enabled: a.enabled,
      model: a.model,
      autoApplyThreshold: (a as { autoApplyThreshold?: number }).autoApplyThreshold ?? 0.85,
      budget: {
        tokensPerDay: a.maxTokensPerDay,
        requestsPerMinute: (a as { requestsPerMinute?: number }).requestsPerMinute ?? 60,
      },
    });
    return {
      writingAssistant: toConfig(s.agents.writingAssistant),
      brainstorm: toConfig(s.agents.brainstorm),
      archive: toConfig(s.agents.archive),
    };
  },
  [IPC_CHANNELS.SETTINGS_SET_AGENT_CONFIG]: (payload: import('./ipc.js').SetAgentConfigPayload) => {
    const current = loadAppSettings();
    const agentKey = payload.agent as keyof typeof current.agents;
    const existing = current.agents[agentKey];
    const patch = payload.config;
    const updated = {
      ...existing,
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.autoApplyThreshold !== undefined ? { autoApplyThreshold: patch.autoApplyThreshold } : {}),
      ...(patch.budget?.tokensPerDay !== undefined ? { maxTokensPerDay: patch.budget.tokensPerDay } : {}),
      ...(patch.budget?.requestsPerMinute !== undefined ? { requestsPerMinute: patch.budget.requestsPerMinute } : {}),
    };
    saveAppSettings({
      ...current,
      agents: { ...current.agents, [agentKey]: updated },
    });
    return { saved: true };
  },

  // MYT-722: rolling 1-hour token + suggestion usage per agent
  [IPC_CHANNELS.AGENT_BUDGET_USAGE]: (): import('./ipc.js').AgentBudgetUsageResponse => {
    ensureVaultDir();
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const usage = (agent: string) => ({
      tokensLastHour: countTokensInWindow(agent, ONE_HOUR_MS),
      suggestionsLastHour: countSuggestionsInWindow(agent, ONE_HOUR_MS),
    });
    return {
      writingAssistant: usage('writing-assistant'),
      brainstorm: usage('brainstorm'),
      archive: usage('archive'),
    };
  },

  [IPC_CHANNELS.GENERATION_LOG_RECENT]: (payload: GenerationLogRecentPayload) => {
    ensureVaultDir();
    const opts = {
      agent: payload.agent,
      dateFrom: payload.dateFrom,
      dateTo: payload.dateTo,
      search: payload.search,
    };
    const entries = listGenerationLog({ ...opts, limit: payload.limit, offset: payload.offset }).map(truncateGenerationLogBody);
    const total = countGenerationLog(opts);
    return { entries, total };
  },

  [IPC_CHANNELS.GENERATION_LOG_LIST]: (payload: GenerationLogListPayload) => {
    ensureVaultDir();
    const pageSize = payload.pageSize ?? 20;
    const page = payload.page ?? 0;
    const agent = payload.agent && payload.agent !== 'all' ? payload.agent : undefined;
    const entries = listGenerationLog({ limit: pageSize, offset: page * pageSize, agent }).map(truncateGenerationLogBody);
    const total = countGenerationLog({ agent });
    return { entries, total, page, pageSize };
  },

  [IPC_CHANNELS.GENERATION_LOG_GET]: (payload: GenerationLogGetPayload) => {
    ensureVaultDir();
    return { entry: getGenerationLogEntry(payload.id) };
  },

  // ─── Chapter / Scene creation (Phase 2 — MYT-195) ───
  [IPC_CHANNELS.CHAPTER_CREATE]: (payload: ChapterCreatePayload) => {
    ensureVaultDir();
    const manifest = readManifest(getManifestPath());
    const story = manifest.stories.find((s) => s.id === payload.storyId);
    if (!story) throw new Error(`Story not found: ${payload.storyId}`);

    const dirPath = chapterVaultPath(getVaultRoot(), story.title, payload.title);
    const fullDir = path.join(getVaultRoot(), dirPath);
    if (!fs.existsSync(fullDir)) fs.mkdirSync(fullDir, { recursive: true });

    const nowStr = new Date().toISOString();
    const chapter = {
      id: crypto.randomUUID(),
      title: payload.title,
      path: dirPath,
      order: payload.order ?? story.chapters.length,
      scenes: [],
      createdAt: nowStr,
      updatedAt: nowStr,
    };
    story.chapters.push(chapter);
    writeManifest(getManifestPath(), manifest);
    return chapter;
  },

  [IPC_CHANNELS.SCENE_CREATE]: (payload: SceneCreatePayload) => {
    ensureVaultDir();
    const manifest = readManifest(getManifestPath());
    const story = manifest.stories.find((s) => s.id === payload.storyId);
    if (!story) throw new Error(`Story not found: ${payload.storyId}`);
    const chapter = story.chapters.find((c) => c.id === payload.chapterId);
    if (!chapter) throw new Error(`Chapter not found: ${payload.chapterId}`);

    const filePath = sceneVaultPath(getVaultRoot(), chapter.path, payload.title);
    const nowStr = new Date().toISOString();
    const scene = {
      id: crypto.randomUUID(),
      title: payload.title,
      path: filePath,
      order: payload.order ?? chapter.scenes.length,
      chapterId: payload.chapterId,
      storyId: payload.storyId,
      blocks: [],
      draftState: 'in-progress' as const,
      createdAt: nowStr,
      updatedAt: nowStr,
    };
    writeSceneFile(getVaultRoot(), filePath, {
      id: scene.id,
      title: scene.title,
      chapterId: scene.chapterId,
      storyId: scene.storyId,
      order: scene.order,
      prose: '',
    });
    chapter.scenes.push(scene);
    writeManifest(getManifestPath(), manifest);
    return scene;
  },

  // ─── Chapter / Scene save+load (MYT-196) ───
  [IPC_CHANNELS.CHAPTER_LIST]: (payload: ChapterListPayload) => {
    ensureVaultDir();
    const manifest = readManifest(getManifestPath());
    const story = manifest.stories.find((s) => s.id === payload.storyId);
    if (!story) throw new Error(`Story not found: ${payload.storyId}`);
    return { chapters: story.chapters };
  },

  [IPC_CHANNELS.CHAPTER_GET]: (payload: ChapterGetPayload) => {
    ensureVaultDir();
    const manifest = readManifest(getManifestPath());
    for (const story of manifest.stories) {
      const chapter = story.chapters.find((c) => c.id === payload.chapterId);
      if (chapter) return { chapter };
    }
    return { chapter: null };
  },

  [IPC_CHANNELS.CHAPTER_SAVE]: (payload: ChapterSavePayload) => {
    ensureVaultDir();
    const manifest = readManifest(getManifestPath());
    let found = null as typeof manifest.stories[0]['chapters'][0] | null;
    for (const story of manifest.stories) {
      const chapter = story.chapters.find((c) => c.id === payload.chapterId);
      if (chapter) { found = chapter; break; }
    }
    if (!found) throw new Error(`Chapter not found: ${payload.chapterId}`);
    if (payload.title !== undefined) found.title = payload.title;
    if (payload.order !== undefined) found.order = payload.order;
    found.updatedAt = new Date().toISOString();
    writeManifest(getManifestPath(), manifest);
    if (mainWindow) mainWindow.webContents.send('vault:changed', { kind: 'chapter', id: found.id });
    return { chapter: found };
  },

  [IPC_CHANNELS.SCENE_LIST]: (payload: SceneListPayload) => {
    ensureVaultDir();
    const manifest = readManifest(getManifestPath());
    for (const story of manifest.stories) {
      const chapter = story.chapters.find((c) => c.id === payload.chapterId);
      if (chapter) return { scenes: chapter.scenes };
    }
    throw new Error(`Chapter not found: ${payload.chapterId}`);
  },

  [IPC_CHANNELS.SCENE_GET]: (payload: SceneGetPayload) => {
    ensureVaultDir();
    const manifest = readManifest(getManifestPath());
    // Search nested story→chapter→scene first
    for (const story of manifest.stories) {
      for (const chapter of story.chapters) {
        const scene = chapter.scenes.find((s) => s.id === payload.sceneId);
        if (scene) {
          let prose = '';
          try { prose = readSceneFile(getVaultRoot(), scene.path).prose; } catch { /* missing */ }
          return { scene, prose };
        }
      }
    }
    // Fallback: flat legacy scenes list
    const scene = manifest.scenes.find((s) => s.id === payload.sceneId) ?? null;
    if (scene) {
      let prose = '';
      try { prose = readSceneFile(getVaultRoot(), scene.path).prose; } catch { /* missing */ }
      return { scene, prose };
    }
    return { scene: null, prose: '' };
  },

  [IPC_CHANNELS.SCENE_SAVE]: (payload: SceneSavePayload) => {
    ensureVaultDir();
    const manifest = readManifest(getManifestPath());
    // Find scene in nested structure or legacy flat list
    let found = null as import('./ipc.js').SceneEntry | null;
    outer: for (const story of manifest.stories) {
      for (const chapter of story.chapters) {
        const scene = chapter.scenes.find((s) => s.id === payload.sceneId);
        if (scene) { found = scene; break outer; }
      }
    }
    if (!found) found = manifest.scenes.find((s) => s.id === payload.sceneId) ?? null;
    if (!found) throw new Error(`Scene not found: ${payload.sceneId}`);

    // Validate path before writing (rejects traversal)
    safePath(getVaultRoot(), found.path);

    const nowStr = new Date().toISOString();
    if (payload.title !== undefined) found.title = payload.title;
    if (payload.order !== undefined) found.order = payload.order;
    found.updatedAt = nowStr;

    // Sync prose block
    const proseBlock = found.blocks.find((b) => b.type === 'prose');
    if (proseBlock) {
      proseBlock.content = payload.prose;
      proseBlock.updatedAt = nowStr;
    } else {
      found.blocks.push({ id: crypto.randomUUID(), type: 'prose', order: 0, content: payload.prose, updatedAt: nowStr });
    }

    // SKY-10: pre-save snapshot — capture the on-disk state being replaced.
    // We snapshot the prior prose before overwriting so the timeline is
    // "what existed before this save."
    const chapterRelPath = path.posix.dirname(found.path.split(path.sep).join('/'));
    let priorProse: string | null = null;
    try {
      priorProse = readSceneFile(getVaultRoot(), found.path).prose;
    } catch { /* new file — nothing to snapshot */ }
    if (priorProse !== null) {
      try {
        saveVersion(getVaultRoot(), found.id, priorProse, {
          chapterRelPath,
          intent: payload.intent ?? 'save',
        });
      } catch { /* snapshot failure is non-fatal — save still proceeds */ }
    }

    // Atomic write: temp → fdatasync → rename
    writeSceneFileAtomic(getVaultRoot(), found.path, {
      id: found.id,
      title: found.title,
      chapterId: found.chapterId,
      storyId: found.storyId,
      order: found.order,
      prose: payload.prose,
    });

    writeManifest(getManifestPath(), manifest);

    // SKY-170: parse @mentions and sync scene_entity_links rows
    try {
      const mentionedIds = parseMentionEntityIds(payload.prose);
      const now2 = new Date().toISOString();
      for (const entityId of mentionedIds) {
        upsertSceneEntityLink({ id: crypto.randomUUID(), scene_id: found.id, entity_id: entityId, link_kind: 'mention', created_at: now2 });
      }
      deleteStaleSceneMentionLinks(found.id, [...mentionedIds]);
    } catch { /* non-fatal — scene save still succeeds */ }

    if (mainWindow) mainWindow.webContents.send('vault:changed', { kind: 'scene', id: found.id, path: found.path });
    return { scene: found };
  },

  // ─── Scene inline rename (SKY-115) ───
  [IPC_CHANNELS.SCENE_RENAME]: (payload: import('./ipc.js').SceneRenamePayload) => {
    ensureVaultDir();
    const trimmed = payload.title.trim();
    if (!trimmed) throw new Error('Scene title cannot be empty');
    const manifest = readManifest(getManifestPath());
    let renamedScene = null as import('./ipc.js').SceneEntry | null;
    outerRename: for (const story of manifest.stories) {
      for (const chapter of story.chapters) {
        const scene = chapter.scenes.find((s) => s.id === payload.sceneId);
        if (scene) { renamedScene = scene; break outerRename; }
      }
    }
    if (!renamedScene) renamedScene = manifest.scenes.find((s) => s.id === payload.sceneId) ?? null;
    if (!renamedScene) throw new Error(`Scene not found: ${payload.sceneId}`);
    renamedScene.title = trimmed;
    renamedScene.updatedAt = new Date().toISOString();
    writeManifest(getManifestPath(), manifest);
    if (mainWindow) mainWindow.webContents.send('vault:changed', { kind: 'scene', id: renamedScene.id, path: renamedScene.path });
    return { scene: renamedScene };
  },

  // ─── Beta-Read Mode (MYT-237) ───
  [IPC_CHANNELS.BETA_READ_CREATE]: (payload: { sceneId: string; anchorText: string; commentText: string }) => {
    ensureVaultDir();
    const id = crypto.randomUUID();
    const comment = {
      id,
      scene_id: payload.sceneId,
      anchor_text: payload.anchorText,
      comment_text: payload.commentText,
      created_at: new Date().toISOString(),
      dismissed_at: null,
    };
    insertBetaReadComment(comment);
    return { comment };
  },

  [IPC_CHANNELS.BETA_READ_LIST]: (payload: { sceneId: string }) => {
    ensureVaultDir();
    const comments = listBetaReadComments(payload.sceneId);
    return { comments };
  },

  [IPC_CHANNELS.BETA_READ_DISMISS]: (payload: { id: string }) => {
    ensureVaultDir();
    dismissBetaReadComment(payload.id);
    return { id: payload.id, dismissed: true };
  },

  // ─── Search (MYT-251) ───
  [IPC_CHANNELS.SEARCH_QUERY]: (payload: SearchQueryPayload) => {
    ensureVaultDir();
    const t0 = Date.now();
    const results = searchVault(getDb(), payload.query, payload.scope, payload.limit ?? 20, payload.filterTags);
    return { results, elapsed_ms: Date.now() - t0 };
  },

  // ─── Vault graph (MYT-163) ───
  [IPC_CHANNELS.VAULT_GRAPH_DATA]: async () => {
    ensureVaultDir();
    const vaultRoot = getVaultRoot();
    const WIKI_LINK_RE = /\[\[([^\]|#]+?)(?:[|#][^\]]*?)?\]\]/g;
    const MAX_NODES = 2000;

    // Collect all .md files
    const { items } = listVaultFiles(vaultRoot);
    const mdFiles = items.filter((f) => !f.isDirectory && f.path.endsWith('.md'));

    // Build node list and stem→id map for edge resolution
    const stemToId = new Map<string, string>();
    const nodeList: { id: string; label: string; path: string; folder?: string; tags?: string[] }[] = [];

    for (const file of mdFiles) {
      let content = '';
      try { content = readVaultFile(vaultRoot, file.path).content; } catch { continue; }
      const { frontmatter } = parseFrontmatter(content);
      const id = String(frontmatter.id ?? file.path);
      const label = String(frontmatter.title ?? path.basename(file.path, '.md'));
      const folder = path.dirname(file.path) === '.' ? undefined : path.dirname(file.path);
      const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : undefined;
      nodeList.push({ id, label, path: file.path, folder, tags });
      stemToId.set(path.basename(file.path, '.md').toLowerCase(), id);
    }

    // Sample if over budget
    const sampled = nodeList.length > MAX_NODES ? nodeList.slice(0, MAX_NODES) : nodeList;
    const sampledIds = new Set(sampled.map((n) => n.id));

    // Build edges from wiki-links
    const edgeSet = new Set<string>();
    const edges: { source: string; target: string }[] = [];

    for (const file of mdFiles) {
      let content = '';
      try { content = readVaultFile(vaultRoot, file.path).content; } catch { continue; }
      const { frontmatter } = parseFrontmatter(content);
      const sourceId = String(frontmatter.id ?? file.path);
      if (!sampledIds.has(sourceId)) continue;

      WIKI_LINK_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = WIKI_LINK_RE.exec(content)) !== null) {
        const target = match[1].trim();
        const targetStem = path.basename(target, '.md').toLowerCase();
        const targetId = stemToId.get(targetStem);
        if (targetId && targetId !== sourceId && sampledIds.has(targetId)) {
          const key = `${sourceId}→${targetId}`;
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            edges.push({ source: sourceId, target: targetId });
          }
        }
      }
    }

    return { nodes: sampled, edges };
  },

  // ─── Archive Agent (MYT-157) ───
  [IPC_CHANNELS.ARCHIVE_STATUS]: () => {
    return getArchiveStatus();
  },

  [IPC_CHANNELS.ARCHIVE_SCAN]: (payload: ArchiveScanPayload) => {
    if (!loadAppSettings().agents.archive.enabled) {
      return { suggestions: [], inconsistenciesFound: 0, wikiLinksFound: 0 };
    }
    ensureVaultDir();
    let index = getArchiveIndex();
    if (!index) {
      const manifest = readManifest(getManifestPath());
      reindexEntities(getVaultRoot(), manifest);
      index = buildArchiveIndex(getVaultRoot(), manifest);
    }
    const ignores = listArchiveIgnores().map<ArchiveIgnoreKey>((ig) => ({
      entity_id: ig.entity_id,
      prop_key: ig.prop_key,
      scene_path: ig.scene_path,
    }));
    const result = runArchiveScan(payload.sceneText, index, payload.scenePath, ignores);
    for (const suggestion of result.suggestions) {
      upsertSuggestion(suggestion);
    }
    return {
      suggestions: result.suggestions,
      inconsistenciesFound: result.inconsistenciesFound,
      wikiLinksFound: result.wikiLinksFound,
    };
  },

  // ─── Archive confirmation dialog (MYT-376) ───
  [IPC_CHANNELS.ARCHIVE_CONFIRM]: (payload: ArchiveConfirmPayload) => {
    ensureVaultDir();
    const now = new Date().toISOString();
    const auditId = crypto.randomUUID();

    const suggestion = getSuggestion(payload.suggestionId);
    if (!suggestion) throw new Error(`Suggestion not found: ${payload.suggestionId}`);

    if (suggestion.source_agent !== 'archive') {
      throw new Error('archive:confirm only handles archive suggestions');
    }

    let payloadData: {
      kind: string;
      entityId?: string;
      entityName?: string;
      propKey?: string;
      vaultValue?: string;
      scenePhrase?: string;
    } = { kind: '' };
    try {
      payloadData = JSON.parse(suggestion.payload_json ?? '{}');
    } catch { /* malformed payload — proceed with defaults */ }

    if (payloadData.kind !== 'inconsistency') {
      throw new Error('archive:confirm only resolves inconsistency suggestions');
    }

    const { entityId = '', propKey = '', scenePhrase = '' } = payloadData;
    const scenePath = suggestion.target_path ?? '';

    if (payload.action === 'match_archive') {
      // Update vault entity property to match manuscript value.
      if (entityId && propKey && scenePhrase) {
        try {
          const manifest = readManifest(getManifestPath());
          const entity = manifest.entities.find((e) => e.id === entityId);
          if (entity) {
            const updatedProperties = { ...(entity.properties ?? {}), [propKey]: scenePhrase };
            updateEntity(getVaultRoot(), manifest, entityId, { properties: updatedProperties });
          }
        } catch { /* non-fatal — still record the audit */ }
      }
      updateSuggestionStatus(payload.suggestionId, 'applied', now);
      insertAuditLog({
        id: auditId,
        suggestion_id: payload.suggestionId,
        action: 'apply',
        snapshot_path: null,
        actor: 'user:match_archive',
        created_at: now,
      });
      return { ok: true, auditId };

    } else if (payload.action === 'suggest_story_change') {
      // Create a counter-suggestion pointing at the manuscript.
      const newId = crypto.randomUUID();
      const counterSuggestion = {
        id: newId,
        source_agent: 'archive',
        confidence: 0.8,
        rationale: suggestion.rationale + ' — consider revising the manuscript to match the vault.',
        target_kind: 'manuscript' as const,
        target_path: scenePath,
        target_anchor: suggestion.target_anchor,
        payload_json: JSON.stringify({ ...payloadData, kind: 'story-change', originalSuggestionId: payload.suggestionId }),
        status: 'proposed' as const,
        created_at: now,
        applied_at: null,
        applied_run_id: null,
        budget_exceeded: 0,
      };
      upsertSuggestion(counterSuggestion);
      updateSuggestionStatus(payload.suggestionId, 'accepted', now);
      insertAuditLog({
        id: auditId,
        suggestion_id: payload.suggestionId,
        action: 'accept',
        snapshot_path: null,
        actor: 'user:suggest_story_change',
        created_at: now,
      });
      return { ok: true, auditId, newSuggestionId: newId };

    } else {
      // action === 'ignore'
      if (entityId && propKey && scenePath) {
        insertArchiveIgnore({
          id: crypto.randomUUID(),
          entity_id: entityId,
          prop_key: propKey,
          scene_path: scenePath,
          created_at: now,
        });
      }
      updateSuggestionStatus(payload.suggestionId, 'rejected');
      insertAuditLog({
        id: auditId,
        suggestion_id: payload.suggestionId,
        action: 'reject',
        snapshot_path: null,
        actor: 'user:ignore',
        created_at: now,
      });
      return { ok: true, auditId };
    }
  },

  [IPC_CHANNELS.ARCHIVE_IGNORE_LIST]: () => {
    ensureVaultDir();
    const rows = listArchiveIgnores();
    return {
      entries: rows.map((r) => ({
        id: r.id,
        entityId: r.entity_id,
        propKey: r.prop_key,
        scenePath: r.scene_path,
        createdAt: r.created_at,
      })),
    };
  },

  // ─── Liquid Neon background image (MYT-613) ────
  [IPC_CHANNELS.BG_PICK]: async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose App Background Image',
      buttonLabel: 'Set Background',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { filePath: null, cancelled: true };
    }
    return { filePath: result.filePaths[0], cancelled: false };
  },

  [IPC_CHANNELS.BG_LOAD]: async (payload: BgLoadPayload) => {
    return readBgImageAsDataUrl(payload.filePath);
  },

  // ─── EPUB export (MYT-342) ───
  [IPC_CHANNELS.EXPORT_EPUB]: async (payload: { storyId: string; metadata?: { title?: string; author?: string; language?: string }; targetPath?: string }) => {
    ensureVaultDir();
    const manifest = readManifest(getManifestPath());
    const story = manifest.stories.find((s) => s.id === payload.storyId);
    if (!story) throw new Error(`Story not found: ${payload.storyId}`);

    let filePath: string;
    if (payload.targetPath) {
      // MYT-675: the headless targetPath escape hatch must stay inside the vault.
      // resolveEpubExportPath rejects absolute paths, "../" traversal, symlink
      // escapes, and non-.epub targets before any bytes are written.
      filePath = resolveEpubExportPath(getVaultRoot(), payload.targetPath);
    } else {
      const result = await dialog.showSaveDialog({
        title: 'Export EPUB',
        defaultPath: `${story.title.replace(/[/\\?%*:|"<>]/g, '-')}.epub`,
        filters: [{ name: 'EPUB', extensions: ['epub'] }],
      });
      if (result.canceled || !result.filePath) return { path: null, cancelled: true };
      filePath = result.filePath;
    }

    // Build chapter/scene structure, reading prose from vault
    const chapters = story.chapters
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((ch) => ({
        id: ch.id,
        title: ch.title,
        scenes: ch.scenes
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((sc) => {
            let prose = '';
            try { prose = readSceneFile(getVaultRoot(), sc.path).prose; } catch { /* missing */ }
            return { id: sc.id, title: sc.title, prose };
          }),
      }));

    const buffer = await buildEpub({
      title: payload.metadata?.title ?? story.title,
      author: payload.metadata?.author,
      language: payload.metadata?.language,
      chapters,
    });
    // SKY-157: pre-export snapshot for every scene in the story
    const { snapshots: retention } = loadAppSettings();
    for (const ch of story.chapters) {
      for (const sc of ch.scenes) {
        try {
          const prose = readSceneFile(getVaultRoot(), sc.path).prose;
          saveSnapshot(getVaultRoot(), sc.id, prose, retention, 'Pre-export snapshot');
        } catch { /* missing scene — skip */ }
      }
    }
    writeFileAtomic(filePath, buffer);
    return { path: filePath, cancelled: false };
  },

  // ─── DOCX export (MYT-252, extended SKY-153) ───
  [IPC_CHANNELS.EXPORT_DOCX]: async (payload: { storyId?: string; scope?: import('./ipc.js').ExportScope }) => {
    ensureVaultDir();
    const manifest = readManifest(getManifestPath());

    // Resolve scope: new scope field takes precedence; fall back to legacy storyId.
    const scope: import('./ipc.js').ExportScope = payload.scope
      ? payload.scope
      : { kind: 'story', storyId: payload.storyId! };

    let docxTitle = 'Export';
    let docxChapters: Array<{ id: string; title: string; scenes: Array<{ id: string; title: string; prose: string }> }> = [];

    if (scope.kind === 'scene') {
      let found: import('./ipc.js').SceneEntry | null = null;
      outer: for (const st of manifest.stories) {
        for (const ch of st.chapters) {
          const sc = ch.scenes.find((s) => s.id === scope.sceneId);
          if (sc) { found = sc; break outer; }
        }
      }
      if (!found) throw new Error(`Scene not found: ${scope.sceneId}`);
      let prose = '';
      try { prose = readSceneFile(getVaultRoot(), found.path).prose; } catch { /* missing */ }
      docxTitle = found.title;
      docxChapters = [{ id: found.id, title: found.title, scenes: [{ id: found.id, title: found.title, prose }] }];
    } else if (scope.kind === 'chapter') {
      const st = manifest.stories.find((s) => s.id === scope.storyId);
      if (!st) throw new Error(`Story not found: ${scope.storyId}`);
      const ch = st.chapters.find((c) => c.id === scope.chapterId);
      if (!ch) throw new Error(`Chapter not found: ${scope.chapterId}`);
      docxTitle = ch.title;
      docxChapters = [{
        id: ch.id,
        title: ch.title,
        scenes: [...ch.scenes].sort((a, b) => a.order - b.order).map((sc) => {
          let prose = '';
          try { prose = readSceneFile(getVaultRoot(), sc.path).prose; } catch { /* missing */ }
          return { id: sc.id, title: sc.title, prose };
        }),
      }];
    } else if (scope.kind === 'story') {
      const st = manifest.stories.find((s) => s.id === scope.storyId);
      if (!st) throw new Error(`Story not found: ${scope.storyId}`);
      docxTitle = st.title;
      docxChapters = [...st.chapters].sort((a, b) => a.order - b.order).map((ch) => ({
        id: ch.id,
        title: ch.title,
        scenes: [...ch.scenes].sort((a, b) => a.order - b.order).map((sc) => {
          let prose = '';
          try { prose = readSceneFile(getVaultRoot(), sc.path).prose; } catch { /* missing */ }
          return { id: sc.id, title: sc.title, prose };
        }),
      }));
    } else {
      docxTitle = 'Vault Export';
      for (const st of manifest.stories) {
        for (const ch of [...st.chapters].sort((a, b) => a.order - b.order)) {
          docxChapters.push({
            id: ch.id,
            title: `${st.title} — ${ch.title}`,
            scenes: [...ch.scenes].sort((a, b) => a.order - b.order).map((sc) => {
              let prose = '';
              try { prose = readSceneFile(getVaultRoot(), sc.path).prose; } catch { /* missing */ }
              return { id: sc.id, title: sc.title, prose };
            }),
          });
        }
      }
    }

    const result = await dialog.showSaveDialog({
      title: 'Export DOCX',
      defaultPath: `${docxTitle.replace(/[/\\?%*:|"<>]/g, '-')}.docx`,
      filters: [{ name: 'Word Document', extensions: ['docx'] }],
    });
    if (result.canceled || !result.filePath) return { path: null, cancelled: true };

    const buffer = await buildDocx({ title: docxTitle, chapters: docxChapters });
    // SKY-157: pre-export snapshot for every scene being exported
    const { snapshots: retentionDocx } = loadAppSettings();
    for (const ch of docxChapters) {
      for (const sc of ch.scenes) {
        if (sc.prose) saveSnapshot(getVaultRoot(), sc.id, sc.prose, retentionDocx, 'Pre-export snapshot');
      }
    }
    writeFileAtomic(result.filePath, buffer);
    return { path: result.filePath, cancelled: false };
  },

  // ─── Markdown + plain-text export (SKY-153) ───

  [IPC_CHANNELS.EXPORT_MARKDOWN]: async (payload: { scope: import('./ipc.js').ExportScope }) => {
    ensureVaultDir();
    const manifest = readManifest(getManifestPath());
    const { content, defaultFilename } = buildTextExport(manifest, payload.scope, 'markdown');
    const result = await dialog.showSaveDialog({
      title: 'Export Markdown',
      defaultPath: `${defaultFilename}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) return { path: null, cancelled: true };
    writeFileAtomic(result.filePath, Buffer.from(content, 'utf-8'));
    return { path: result.filePath, cancelled: false };
  },

  [IPC_CHANNELS.EXPORT_PLAINTEXT]: async (payload: { scope: import('./ipc.js').ExportScope }) => {
    ensureVaultDir();
    const manifest = readManifest(getManifestPath());
    const { content, defaultFilename } = buildTextExport(manifest, payload.scope, 'plaintext');
    const result = await dialog.showSaveDialog({
      title: 'Export Plain Text',
      defaultPath: `${defaultFilename}.txt`,
      filters: [{ name: 'Plain Text', extensions: ['txt'] }],
    });
    if (result.canceled || !result.filePath) return { path: null, cancelled: true };
    writeFileAtomic(result.filePath, Buffer.from(content, 'utf-8'));
    return { path: result.filePath, cancelled: false };
  },

  // ─── Obsidian vault import wizard (MYT-244) ───
  [IPC_CHANNELS.VAULT_PICK_FOLDER]: async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Obsidian Vault Folder',
      buttonLabel: 'Select Folder',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { vaultRoot: null, cancelled: true, registrationToken: null };
    }
    const token = generateRegistrationToken(result.filePaths[0]);
    return { vaultRoot: result.filePaths[0], cancelled: false, registrationToken: token };
  },

  // ─── Voice binary/model picker (MYT-788) ───
  // Main-process file dialog → one-shot registration token bound to the chosen
  // path. settings:set requires this token to change stt.localBinaryPath,
  // tts.localBinaryPath, or tts.localModelPath, so a renderer can never
  // promote an arbitrary local executable into the spawn surface.
  [IPC_CHANNELS.VOICE_PICK_BINARY]: async (payload: { kind: 'stt-binary' | 'tts-binary' | 'tts-model' }) => {
    const title =
      payload?.kind === 'tts-model'
        ? 'Select Local TTS Voice Model (.onnx)'
        : payload?.kind === 'tts-binary'
          ? 'Select Local TTS Binary (Piper)'
          : 'Select Local STT Binary (whisper.cpp)';
    const filters =
      payload?.kind === 'tts-model'
        ? [{ name: 'Piper voice model', extensions: ['onnx'] }, { name: 'All files', extensions: ['*'] }]
        : [{ name: 'All files', extensions: ['*'] }];
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      title,
      buttonLabel: 'Select',
      filters,
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { path: null, cancelled: true, registrationToken: null };
    }
    const chosen = result.filePaths[0];
    const token = generateRegistrationToken(chosen);
    return { path: chosen, cancelled: false, registrationToken: token };
  },

  [IPC_CHANNELS.VAULT_OBSIDIAN_DRY_RUN]: async (_payload: VaultObsidianDryRunPayload) => {
    const { registrationToken } = _payload;
    // MYT-360 / MYT-367: token must come from vault:pick-folder. Peek (consume:false)
    // so the same token survives a subsequent register call.
    const validated = validateRegistrationToken(registrationToken, { consume: false });
    if (!validated) {
      return { error: 'registrationToken required — use vault:pick-folder first' };
    }
    // Load existing manifest to detect name collisions (may not exist yet)
    let existingManifest = null;
    try {
      if (fs.existsSync(getManifestPath())) {
        existingManifest = readManifest(getManifestPath());
      }
    } catch { /* non-fatal */ }
    return obsidianDryRun(validated.vaultRoot, existingManifest);
  },

  [IPC_CHANNELS.VAULT_OBSIDIAN_REGISTER]: async (_payload: VaultObsidianRegisterPayload) => {
    const { registrationToken } = _payload;
    // MYT-360 / MYT-367: token-validated path is the only acceptable source.
    // The renderer-supplied sourcePath field is deliberately ignored — the
    // token alone proves the folder was chosen via the main-process dialog.
    const validated = validateRegistrationToken(registrationToken);
    if (!validated) {
      return { error: 'registrationToken required — use vault:pick-folder first' };
    }
    // Point the vault root at the chosen Obsidian folder and rebuild the manifest
    saveVaultSettings({ vaultRoot: validated.vaultRoot });
    ensureVaultDir(); // creates manifest.json if absent, opens DB
    const manifest = readManifest(getManifestPath());
    const { manifest: synced, scanned } = reindexVault(validated.vaultRoot, manifest);
    writeManifest(getManifestPath(), synced);
    // Rebuild full-text search index
    try { buildFullIndex(getDb(), validated.vaultRoot, synced); } catch { /* non-fatal */ }
    // Start file watcher on the new root
    await stopVaultWatcher();
    await startVaultWatcher(validated.vaultRoot, notifyVaultChanged);
    return { vaultRoot: validated.vaultRoot, notesIndexed: scanned };
  },

  [IPC_CHANNELS.VAULT_LOAD_SAMPLE]: async (payload: VaultLoadSamplePayload): Promise<VaultLoadSampleResponse> => {
    const defaultRoot = path.join(app.getPath('documents'), 'Mythos Sample');
    const rawPath = payload?.targetPath ?? defaultRoot;
    const sampleRoot = rawPath.replace(/^~/, app.getPath('home'));
    if (!fs.existsSync(sampleRoot)) {
      fs.mkdirSync(sampleRoot, { recursive: true });

      // ── Manuscript ──────────────────────────────────────────────────────────
      const storySlug = 'the-lost-horizon';

      const ch1Dir = path.join(sampleRoot, 'Manuscript', storySlug, 'chapter-one');
      const ch2Dir = path.join(sampleRoot, 'Manuscript', storySlug, 'chapter-two');
      fs.mkdirSync(ch1Dir, { recursive: true });
      fs.mkdirSync(ch2Dir, { recursive: true });

      // Chapter 1 – Scene 1
      fs.writeFileSync(path.join(ch1Dir, 'the-departure.md'), [
        '---',
        'title: The Departure',
        'type: scene',
        '---',
        '',
        'The morning mist clung to the docks of [[Port Caelum]] as [[Elara Voss]] pulled her coat tighter.',
        'Somewhere beyond the grey horizon lay the answers she had spent three years seeking.',
        '',
        '"You don\'t have to do this," said [[Captain Renn]], not turning from the wheel of the _Meridian Star_.',
        '',
        '"I know," she replied. "That\'s exactly why I\'m going."',
        '',
        'The vessel groaned as it left the pier. Above the crow\'s nest a faded chart fluttered — marked with the sigil of the [[Tidecallers\' Compact]].',
        '',
        '> **Writing Assistant tip:** Select any paragraph and open the Writing Assistant panel to get tone suggestions or ask it to continue the scene.',
      ].join('\n'));

      // Chapter 1 – Scene 2
      fs.writeFileSync(path.join(ch1Dir, 'first-night-at-sea.md'), [
        '---',
        'title: First Night at Sea',
        'type: scene',
        '---',
        '',
        'The stars over the [[Sunken Expanse]] were nothing like those above [[Port Caelum]].',
        '[[Elara Voss]] spread her mentor\'s journal across the galley table, tracing the inked coastlines with one finger.',
        '',
        '"He was here," she murmured, tapping a circled inlet. "Before the storm took him."',
        '',
        '[[Captain Renn]] appeared in the doorway, holding two mugs of black tea.',
        '"Your mentor was a fool," he said, setting one mug down. "Brave — but a fool."',
        '',
        'Elara did not argue. [[Dr. Harlan Voss]] had been both.',
        '',
        '> **Archive tip:** The names [[Dr. Harlan Voss]] and [[Tidecallers\' Compact]] above are wiki-links.',
        '> Open the Archive panel to see suggested entity pages for them, or click a link to create a new entity.',
      ].join('\n'));

      // Chapter 2 – Scene 1
      fs.writeFileSync(path.join(ch2Dir, 'the-sunken-archive.md'), [
        '---',
        'title: The Sunken Archive',
        'type: scene',
        '---',
        '',
        'Three days out from [[Port Caelum]], the [[Meridian Star]] anchored above the submerged ruins of [[Aethon\'s Cradle]].',
        '',
        '[[Elara Voss]] descended alone, the pressure suit sealing with a hiss. The water was cold and black beyond her helmet lamp.',
        'Below her, columns rose from silt like broken teeth — and among them, a door still stood, engraved with the mark of the [[Tidecallers\' Compact]].',
        '',
        'She had found it.',
        '',
        '> **Brainstorm tip:** Open the Brainstorm panel and ask "What should Elara discover inside the archive?" to explore plot possibilities with the AI.',
      ].join('\n'));

      // Chapter 2 – Scene 2
      fs.writeFileSync(path.join(ch2Dir, 'the-archivist.md'), [
        '---',
        'title: The Archivist',
        'type: scene',
        '---',
        '',
        'Inside the chamber the air was stale but breathable — somehow, after all centuries, the [[Tidecallers\' Compact]] seals had held.',
        '',
        'A figure sat at the far end of the room, motionless, draped in a corroded robe.',
        'Then it turned.',
        '',
        '"I wondered," said [[The Archivist]], "when one of Harlan\'s kin would come."',
        '',
        '[[Elara Voss]] took a step back. "You knew my father?"',
        '',
        '"I taught him everything he knew about the [[Aethon\'s Cradle|Cradle]]." A pause. "And everything he should never have shared."',
        '',
        '> **Writing Assistant tip:** Highlight "A figure sat at the far end of the room" and ask the Writing Assistant to add sensory detail.',
      ].join('\n'));

      // ── Universes / worldbuilding vault ──────────────────────────────────────
      // Canonical Notes Vault structure: Universes/<World>/Characters, Locations, Lore
      const worldName = 'The Sunken Age';
      const charsDir = path.join(sampleRoot, 'Universes', worldName, 'Characters');
      const locsDir  = path.join(sampleRoot, 'Universes', worldName, 'Locations');
      const loreDir  = path.join(sampleRoot, 'Universes', worldName, 'Lore');
      fs.mkdirSync(charsDir, { recursive: true });
      fs.mkdirSync(locsDir,  { recursive: true });
      fs.mkdirSync(loreDir,  { recursive: true });

      // Characters
      fs.writeFileSync(path.join(charsDir, 'elara-voss.md'), [
        '---',
        'name: Elara Voss',
        'type: character',
        'tags: [protagonist]',
        '---',
        '',
        'Marine archaeologist turned deep-sea explorer. Driven by the disappearance of her mentor and father, [[Dr. Harlan Voss]].',
        '',
        '**Motivation:** Uncover the truth about her father\'s final expedition to [[Aethon\'s Cradle]].',
        '**Flaw:** Trusts evidence over people — often at the cost of the people around her.',
        '',
        'See also: [[Captain Renn]], [[The Archivist]]',
      ].join('\n'));

      fs.writeFileSync(path.join(charsDir, 'captain-renn.md'), [
        '---',
        'name: Captain Renn',
        'type: character',
        'tags: [supporting]',
        '---',
        '',
        'Weathered captain of the _Meridian Star_. Reluctant ally with a complicated past.',
        '',
        '**Secret:** He was on the original expedition with [[Dr. Harlan Voss]] and knows why it went wrong.',
        '**Arc:** Moves from self-protective silence to reluctant confession.',
        '',
        'See also: [[Elara Voss]], [[Tidecallers\' Compact]]',
      ].join('\n'));

      fs.writeFileSync(path.join(charsDir, 'dr-harlan-voss.md'), [
        '---',
        'name: Dr. Harlan Voss',
        'type: character',
        'tags: [absent, mentor]',
        '---',
        '',
        'Marine historian and founding scholar of the [[Tidecallers\' Compact]] research initiative.',
        'Vanished during his third dive to [[Aethon\'s Cradle]].',
        '',
        '**Role:** In absentia — referenced through journals, memories, and [[The Archivist]]\'s testimony.',
        '',
        'See also: [[Elara Voss]], [[Captain Renn]]',
      ].join('\n'));

      fs.writeFileSync(path.join(charsDir, 'the-archivist.md'), [
        '---',
        'name: The Archivist',
        'type: character',
        'tags: [antagonist, ancient]',
        '---',
        '',
        'An ancient guardian of [[Aethon\'s Cradle]], preserved by [[Tidecallers\' Compact]] technology for an unknown span of centuries.',
        '',
        '**Motivation:** Protect the knowledge within the Cradle from those who would misuse it.',
        '**Ambiguity:** Not evil — believes the secrets should stay buried. May be right.',
        '',
        'See also: [[Dr. Harlan Voss]], [[Aethon\'s Cradle]]',
      ].join('\n'));

      // Locations
      fs.writeFileSync(path.join(locsDir, 'port-caelum.md'), [
        '---',
        'name: Port Caelum',
        'type: location',
        'tags: [city, harbour]',
        '---',
        '',
        'A fog-shrouded harbour city built on the bones of an older settlement.',
        'The main departure point for expeditions into the [[Sunken Expanse]].',
        '',
        '**Atmosphere:** Perpetual mist, weathered stone, the smell of brine and coal smoke.',
        '**Key sites:** The Cartographers\' Guild, Renn\'s dry-dock, the archive at Voss University.',
      ].join('\n'));

      fs.writeFileSync(path.join(locsDir, 'aethons-cradle.md'), [
        '---',
        'name: Aethon\'s Cradle',
        'type: location',
        'tags: [ruin, underwater, ancient]',
        '---',
        '',
        'Submerged ruins of a pre-collapse city, resting 300 m below the surface of the [[Sunken Expanse]].',
        'Primary research site of the [[Tidecallers\' Compact]].',
        '',
        '**Lore:** Once the capital of the Aethon civilisation, swallowed by the sea in the Cataclysm of the Third Tide.',
        '**Hazards:** Extreme depth, structural instability, and [[The Archivist]].',
      ].join('\n'));

      // Lore / Concepts
      fs.writeFileSync(path.join(loreDir, 'tidecallers-compact.md'), [
        '---',
        'name: Tidecallers\' Compact',
        'type: concept',
        'tags: [organisation, lore]',
        '---',
        '',
        'A scholarly organisation dedicated to cataloguing and protecting the ruins of [[Aethon\'s Cradle]].',
        'Founded jointly by [[Dr. Harlan Voss]] and an unnamed patron known only as "the Benefactor."',
        '',
        '**Sigil:** A circle of nine waves, each cresting at a different height.',
        '**Current status:** Officially disbanded after the loss of Dr. Voss; unofficially active underground.',
        '',
        '> **Archive tip:** This note is linked from the manuscript scenes.',
        '> The Archive agent can suggest new entities whenever you write a new concept into a scene.',
      ].join('\n'));

      fs.writeFileSync(path.join(loreDir, 'the-three-tides.md'), [
        '---',
        'name: The Three Tides',
        'type: concept',
        'tags: [lore, history]',
        '---',
        '',
        '## The First Tide',
        'The founding of the Aethon civilisation, said to have been guided by oceanic spirits.',
        '',
        '## The Second Tide',
        'A century of expansion across the known seas; the era when [[Aethon\'s Cradle]] rose to its greatest power.',
        '',
        '## The Third Tide (the Cataclysm)',
        'A catastrophic event — cause unknown — that submerged the capital and ended the Aethon age overnight.',
        '[[The Archivist]] is one of the few entities old enough to have witnessed it.',
        '',
        '> **Brainstorm tip:** Ask the Brainstorm agent "What caused the Third Tide?" to develop a backstory.',
      ].join('\n'));

      // ── Story ideas vault ─────────────────────────────────────────────────────
      // Canonical Notes Vault structure: Story ideas/<Story>/synopsis.md + scene-crafter.md
      const storyDisplayName = 'The Lost Horizon';
      const storyIdeasDir = path.join(sampleRoot, 'Story ideas', storyDisplayName);
      fs.mkdirSync(storyIdeasDir, { recursive: true });

      // Synopsis note
      fs.writeFileSync(path.join(storyIdeasDir, 'synopsis.md'), [
        '---',
        'title: The Lost Horizon',
        'type: story-synopsis',
        'world: The Sunken Age',
        '---',
        '',
        '# The Lost Horizon',
        '',
        'A deep-sea mystery set in the world of [[The Sunken Age]].',
        '',
        '## Premise',
        '',
        '[[Elara Voss]], a marine archaeologist, charters [[Captain Renn]]\'s vessel to follow her',
        'father\'s last known route. Her father, [[Dr. Harlan Voss]], vanished three years ago during',
        'a dive to [[Aethon\'s Cradle]] — submerged ruins protected by the [[Tidecallers\' Compact]].',
        '',
        '## Themes',
        '',
        '- Knowledge versus safety: some truths are buried for good reason.',
        '- Trust earned in extremis.',
        '- The weight of inherited legacy.',
        '',
        '## Arc (three acts)',
        '',
        '1. **The Voyage** — Elara assembles allies and finds her father\'s trail.',
        '2. **The Descent** — The crew reaches [[Aethon\'s Cradle]] and discovers [[The Archivist]].',
        '3. **The Choice** — Elara must decide whether to bring the Cradle\'s secrets to the surface.',
        '',
        '> **Brainstorm tip:** Open the Brainstorm panel and ask "What should Elara discover in the Cradle?" to develop the plot.',
      ].join('\n'));

      // Scene Crafter board (Kanban — Obsidian-Kanban-plugin compatible)
      fs.writeFileSync(path.join(storyIdeasDir, 'scene-crafter.md'), [
        '---',
        'kanban-plugin: board',
        'mythos-board-version: 1',
        `story-id: ${storySlug}`,
        `last-modified: ${new Date().toISOString()}`,
        '---',
        '',
        '## Idea',
        '',
        '',
        '## Outline',
        '',
        `- [ ] [[Manuscript/${storySlug}/chapter-one/the-departure|The Departure]] #act1`,
        `- [ ] [[Manuscript/${storySlug}/chapter-one/first-night-at-sea|First Night at Sea]] #act1`,
        '',
        '## Draft',
        '',
        `- [x] [[Manuscript/${storySlug}/chapter-two/the-sunken-archive|The Sunken Archive]] #act2 #action`,
        `- [x] [[Manuscript/${storySlug}/chapter-two/the-archivist|The Archivist]] #act2 #reveal`,
        '',
        '## Revision',
        '',
        '',
        '## Done',
        '',
        '',
        '%% kanban:settings',
        '{"kanban-plugin":"board"}',
        '%%',
      ].join('\n'));

      // ── README ────────────────────────────────────────────────────────────────
      fs.writeFileSync(path.join(sampleRoot, 'README.md'), [
        '# The Lost Horizon — Sample Project',
        '',
        'Welcome to Mythos Writer! This sample project demonstrates the two-vault layout.',
        '',
        '## Vault layout',
        '',
        '```',
        'Mythos Writer Sample/',
        '├── Manuscript/the-lost-horizon/   ← Story Vault: chapters & scenes',
        '│   ├── chapter-one/',
        '│   └── chapter-two/',
        '├── Universes/The Sunken Age/      ← Notes Vault: worldbuilding',
        '│   ├── Characters/',
        '│   ├── Locations/',
        '│   └── Lore/',
        '└── Story ideas/The Lost Horizon/  ← Notes Vault: story planning',
        '    ├── synopsis.md',
        '    └── scene-crafter.md',
        '```',
        '',
        '## What\'s included',
        '',
        '- **Manuscript/** — Two chapters of _The Lost Horizon_, a deep-sea mystery.',
        '  Each scene includes tips for the Writing Assistant and Archive agents.',
        '- **Universes/The Sunken Age/** — Four characters, two locations, and two lore notes',
        '  with `[[wiki-links]]` between them, ready for the Archive agent\'s graph view.',
        '- **Story ideas/The Lost Horizon/** — A synopsis note and a Scene Crafter Kanban board',
        '  tracking scenes through Idea → Outline → Draft → Revision → Done.',
        '',
        '## Quick tour',
        '',
        '1. **Writing Assistant** — Open any scene under `Manuscript/`, select a sentence, and use the Writing Assistant panel.',
        '2. **Archive** — Click a `[[wiki-link]]` in a scene to jump to or create a note in `Universes/`.',
        '3. **Brainstorm** — Open the Brainstorm panel and ask a question about the story.',
        '4. **Scene Crafter** — Open `Story ideas/The Lost Horizon/scene-crafter.md` to see the Kanban board.',
      ].join('\n'));
    }
    saveVaultSettings({ vaultRoot: sampleRoot });
    ensureVaultDir();
    const manifest = readManifest(getManifestPath());
    const { manifest: synced } = reindexVault(sampleRoot, manifest);
    writeManifest(getManifestPath(), synced);
    try { buildFullIndex(getDb(), sampleRoot, synced); } catch { /* non-fatal */ }
    await stopVaultWatcher();
    await startVaultWatcher(sampleRoot, notifyVaultChanged);
    return { vaultRoot: sampleRoot };
  },

  // SKY-12.3: copy the bundled sample project into a two-vault layout.
  [IPC_CHANNELS.VAULT_LOAD_SAMPLE_TWO_VAULT]: async (
    payload: VaultLoadSampleTwoVaultPayload,
  ): Promise<VaultLoadSampleTwoVaultResponse> => {
    const { parentPath } = payload;
    if (!parentPath || typeof parentPath !== 'string') {
      return { storyVaultPath: '', notesVaultPath: '', error: 'parentPath must be a non-empty string' };
    }
    // Resolve the bundled sample-project dir: dev = <repo>/sample-project,
    // packaged = <app>/resources/sample-project.
    const sampleProjectDir = app.isPackaged
      ? path.join(process.resourcesPath, 'sample-project')
      : path.join(app.getAppPath(), '..', 'sample-project');

    if (!fs.existsSync(sampleProjectDir)) {
      return { storyVaultPath: '', notesVaultPath: '', error: `Sample project bundle not found at: ${sampleProjectDir}` };
    }

    const storyVaultPath = path.join(parentPath, 'Story Vault');
    const notesVaultPath = path.join(parentPath, 'Notes Vault');

    // Refuse to clobber non-empty targets.
    for (const [label, target] of [['Story Vault', storyVaultPath], ['Notes Vault', notesVaultPath]] as const) {
      if (fs.existsSync(target) && !isEmptyOrMissing(target)) {
        return { storyVaultPath: '', notesVaultPath: '', error: `Target for ${label} already exists and is not empty: ${target}` };
      }
    }

    // Copy story-vault/ → Story Vault/ and notes-vault/ → Notes Vault/.
    const cpR = (src: string, dst: string) => fs.cpSync(src, dst, { recursive: true, force: false });
    try {
      cpR(path.join(sampleProjectDir, 'story-vault'), storyVaultPath);
      cpR(path.join(sampleProjectDir, 'notes-vault'), notesVaultPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { storyVaultPath: '', notesVaultPath: '', error: `Failed to copy sample project: ${msg}` };
    }

    // Persist the new vault paths and index both vaults.
    saveVaultSettings({ vaultRoot: storyVaultPath, notesVaultRoot: notesVaultPath, layoutMode: 'default' });
    ensureVaultDir();
    ensureNotesVaultDir();
    const manifest = readManifest(getManifestPath());
    const { manifest: synced } = reindexVault(storyVaultPath, manifest);
    writeManifest(getManifestPath(), synced);
    try { buildFullIndex(getDb(), storyVaultPath, synced); } catch { /* non-fatal */ }
    await stopVaultWatcher();
    await startVaultWatcher(storyVaultPath, notifyVaultChanged);

    return { storyVaultPath, notesVaultPath };
  },

  // ─── First-run onboarding (MYT-820) ───

  [IPC_CHANNELS.VAULT_VALIDATE_PATH]: async (payload: VaultValidatePathPayload): Promise<VaultValidatePathResponse> => {
    const raw = payload?.path ?? '';
    const resolved = raw.replace(/^~/, app.getPath('home'));
    try {
      const exists = fs.existsSync(resolved);
      if (!exists) {
        // Check parent is writable so we can create it
        const parent = path.dirname(resolved);
        const parentExists = fs.existsSync(parent);
        if (!parentExists) return { exists: false, isEmpty: true, writable: false };
        const probe = path.join(parent, `.mythos-probe-${Date.now()}`);
        try {
          fs.writeFileSync(probe, '');
          fs.unlinkSync(probe);
          return { exists: false, isEmpty: true, writable: true };
        } catch {
          return { exists: false, isEmpty: true, writable: false };
        }
      }
      const entries = fs.readdirSync(resolved);
      const isEmpty = entries.length === 0;
      const probe = path.join(resolved, `.mythos-probe-${Date.now()}`);
      try {
        fs.writeFileSync(probe, '');
        fs.unlinkSync(probe);
        return { exists: true, isEmpty, writable: true };
      } catch {
        return { exists: true, isEmpty, writable: false };
      }
    } catch {
      return { exists: false, isEmpty: true, writable: false };
    }
  },

  [IPC_CHANNELS.VAULT_CREATE_BLANK]: async (payload: VaultCreateBlankPayload): Promise<VaultCreateBlankResponse> => {
    const raw = payload?.targetPath ?? '';
    const resolved = raw.replace(/^~/, app.getPath('home'));
    fs.mkdirSync(resolved, { recursive: true });
    saveVaultSettings({ vaultRoot: resolved });
    ensureVaultDir();
    await stopVaultWatcher();
    await startVaultWatcher(resolved, notifyVaultChanged);
    return { vaultRoot: resolved };
  },

  [IPC_CHANNELS.VAULT_PICK_FOLDER_BY_PATH]: async (payload: VaultPickFolderByPathPayload): Promise<import('./ipc.js').VaultPickFolderResponse> => {
    const { sourcePath } = payload;
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return { vaultRoot: null, cancelled: false, registrationToken: null };
    }
    const token = generateRegistrationToken(sourcePath);
    return { vaultRoot: sourcePath, cancelled: false, registrationToken: token };
  },

  // ─── Telemetry (MYT-344) ───
  [IPC_CHANNELS.TELEMETRY_REPORT]: (payload: import('./ipc.js').TelemetryReportPayload) => {
    // MYT-794: validate renderer-supplied payload before it reaches the event
    // store. Unknown event types and malformed meta are rejected with a typed
    // error instead of being silently coerced through.
    const result = validateTelemetryPayload(payload);
    if (!result.ok) {
      return { queued: false, error: result.error };
    }
    reportEvent(result.event);
    return { queued: true };
  },

  // ─── Multi-project switcher (MYT-374) ───
  [IPC_CHANNELS.PROJECT_LIST]: () => {
    return {
      projects: getRecentProjects(),
      activeVaultRoot: getVaultRoot(),
    };
  },

  [IPC_CHANNELS.PROJECT_SWITCH]: async (payload: ProjectSwitchPayload) => {
    // MYT-789: gate the switch behind the recent-projects allowlist. Without
    // this, a renderer could re-root the vault sandbox at any existing,
    // writable directory and then read or overwrite arbitrary files via the
    // rest of the vault:* IPC surface.
    const gate = checkProjectSwitchGate(
      payload?.vaultRoot,
      getRecentProjects().map((p) => p.vaultRoot),
    );
    if (!gate.ok) {
      return { vaultRoot: getVaultRoot(), switched: false, error: gate.error };
    }
    const newRoot = gate.vaultRoot;
    if (!fs.existsSync(newRoot)) {
      return { vaultRoot: getVaultRoot(), switched: false, error: `Path does not exist: ${newRoot}` };
    }
    // Stop watchers, scheduler, and close current DB before switching
    stopWritingScanScheduler();
    await stopVaultWatcher();
    await stopNotesVaultWatcher();
    closeDb();
    // Switch vault
    saveVaultSettings({ vaultRoot: newRoot });
    addToRecentProjects(newRoot);
    ensureVaultDir();
    // Rebuild FTS index for new vault
    try {
      const manifest = readManifest(getManifestPath());
      const { manifest: synced } = reindexVault(newRoot, manifest);
      writeManifest(getManifestPath(), synced);
      try { buildFullIndex(getDb(), newRoot, synced); } catch { /* non-fatal */ }
    } catch { /* non-fatal */ }
    // Restart file watchers and scheduler
    await startVaultWatcher(newRoot, notifyVaultChanged);
    await startNotesVaultWatcher(getNotesVaultRoot(), notifyNotesVaultChanged);
    startWritingScanScheduler();
    // Notify renderer to reload
    if (mainWindow) {
      mainWindow.webContents.send('project:switched', { vaultRoot: newRoot });
    }
    return { vaultRoot: newRoot, switched: true };
  },

  // ─── Two-vault paths (MYT-608) ───

  [IPC_CHANNELS.VAULT_GET_PATHS]: () => {
    return {
      storyVaultPath: getVaultRoot(),
      notesVaultPath: getNotesVaultRoot(),
    };
  },

  [IPC_CHANNELS.VAULT_SET_PATHS]: (payload: VaultSetPathsPayload) => {
    // MYT-789: gate the new vault roots behind either a registration token
    // (issued by vault:pick-folder) or membership in the recent-projects
    // allowlist. Without this, any absolute, writable directory passes
    // validateVaultPath and the renderer can re-root the vault sandbox at
    // $HOME or /, escaping every other vault:* sandbox check.
    const gate = checkSetPathsGate(
      payload,
      getRecentProjects().map((p) => p.vaultRoot),
    );
    if (!gate.ok) {
      return { storyVaultPath: getVaultRoot(), notesVaultPath: getNotesVaultRoot(), saved: false, error: gate.error };
    }
    validateVaultPath(gate.storyVaultPath, 'storyVaultPath');
    validateVaultPath(gate.notesVaultPath, 'notesVaultPath');
    // SKY-12.2: persist the layout mode chosen during onboarding. 'blank'
    // suppresses SKY-15 scaffold folders so the Brainstorm Agent learns the
    // user's own pattern instead of imposing one. 'default' is the prior
    // behavior (full SKY-15 seeding). Absent seedMode defaults to 'default'
    // for backwards compatibility with SKY-9 and Settings-panel callers.
    const layoutMode: 'default' | 'blank' = payload.seedMode === 'blank' ? 'blank' : 'default';
    saveVaultSettings({ vaultRoot: gate.storyVaultPath, notesVaultRoot: gate.notesVaultPath, layoutMode });
    // Seed the freshly-configured roots. The scaffold functions are idempotent
    // and respect the layoutMode persisted above, so 'blank' callers get
    // only the vault roots + manifest.json, while 'default' callers get the
    // full SKY-15 folder layout.
    ensureVaultDir();
    ensureNotesVaultDir();
    return { storyVaultPath: gate.storyVaultPath, notesVaultPath: gate.notesVaultPath, saved: true };
  },

  // SKY-9: Notes-Vault-scoped CRUD. Mirrors VAULT_* but rooted
  // at the separately-configured notes vault path. Uses the same `path`
  // helpers and case-sensitive resolution as the Story Vault handlers so
  // Linux CI behaves the same as macOS. Every endpoint goes through
  // safeVaultIpcJoin (`.md` / `.json` only, no dotfiles, no traversal).
  [IPC_CHANNELS.NOTES_VAULT_READ]: (payload: VaultReadPayload): VaultReadResponse => {
    ensureNotesVaultDir();
    const root = getNotesVaultRoot();
    safeVaultIpcJoin(root, payload.path, false);
    return readVaultFile(root, payload.path);
  },
  [IPC_CHANNELS.NOTES_VAULT_WRITE]: (payload: VaultWritePayload): VaultWriteResponse => {
    ensureNotesVaultDir();
    const root = getNotesVaultRoot();
    safeVaultIpcJoin(root, payload.path, true);
    return writeVaultFileAtomic(root, payload.path, payload.content);
  },
  [IPC_CHANNELS.NOTES_VAULT_LIST]: (payload: VaultListPayload): VaultListResponse => {
    ensureNotesVaultDir();
    const root = getNotesVaultRoot();
    if (payload.root) safePath(root, payload.root);
    return listVaultFiles(root, payload.root);
  },
  [IPC_CHANNELS.NOTES_VAULT_DELETE]: (payload: VaultDeletePayload): VaultDeleteResponse => {
    ensureNotesVaultDir();
    const root = getNotesVaultRoot();
    safeVaultIpcJoin(root, payload.path, true);
    return deleteVaultFile(root, payload.path);
  },
  [IPC_CHANNELS.NOTES_VAULT_MOVE]: (payload: VaultMovePayload): VaultMoveResponse => {
    ensureNotesVaultDir();
    const root = getNotesVaultRoot();
    safeVaultIpcJoin(root, payload.fromPath, true);
    safeVaultIpcJoin(root, payload.toPath, true);
    return moveVaultFile(root, payload.fromPath, payload.toPath);
  },

  // SKY-95: create a directory directly so handleNewFolder in VaultBrowser
  // doesn't need a .gitkeep placeholder (which safeVaultIpcJoin rejects).
  [IPC_CHANNELS.NOTES_VAULT_MKDIR]: (payload: VaultMkdirPayload): VaultMkdirResponse => {
    ensureNotesVaultDir();
    const root = getNotesVaultRoot();
    const absPath = safeVaultDirIpcJoin(root, payload.path);
    fs.mkdirSync(absPath, { recursive: true });
    return { path: payload.path, created: true };
  },

  // SKY-9: Story-Vault rename. Same shape as NOTES_VAULT_MOVE rooted at the
  // story vault. moveVaultFile() refuses to cross the vault boundary by
  // resolving both endpoints through realSafePath before fs.renameSync.
  [IPC_CHANNELS.VAULT_MOVE]: (payload: VaultMovePayload): VaultMoveResponse => {
    ensureVaultDir();
    const root = getVaultRoot();
    safeVaultIpcJoin(root, payload.fromPath, true);
    safeVaultIpcJoin(root, payload.toPath, true);
    return moveVaultFile(root, payload.fromPath, payload.toPath);
  },

  // SKY-9: generic folder picker for the Settings panel. Returns the chosen
  // absolute path with no side effects; the renderer then calls vaultSetPaths
  // to persist. Distinct from VAULT_PICK_FOLDER (Obsidian import — tags with
  // a registration token) so this surface stays decoupled.
  [IPC_CHANNELS.VAULT_CHOOSE_FOLDER]: async (
    payload: VaultChooseFolderPayload,
  ): Promise<VaultChooseFolderResponse> => {
    const result = await dialog.showOpenDialog({
      title: payload?.title ?? 'Choose Folder',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: payload?.defaultPath,
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { path: null, cancelled: true };
    }
    return { path: result.filePaths[0], cancelled: false };
  },

  // ─── Brainstorm Agent routing (SKY-20) ───
  // The Brainstorm Agent always writes into the Notes Vault (never the Story
  // Vault — that boundary is set by SKY-15). In Default mode the destination
  // is deterministic; in Blank/imported mode the agent asks once per category
  // and remembers the choice. Files are written to the Notes Vault root via
  // writeVaultFileAtomic + safeVaultIpcJoin, so all the same path-traversal
  // and dotfile guards as NOTES_VAULT_WRITE apply.
  [IPC_CHANNELS.BRAINSTORM_GET_SETTINGS]: () => {
    const settings = loadBrainstormSettings(app.getPath('userData'));
    return {
      layoutMode: loadVaultSettings().layoutMode ?? 'default',
      notesRouting: settings.notesRouting,
    };
  },
  [IPC_CHANNELS.BRAINSTORM_WRITE_NOTE]: (payload: import('./ipc.js').BrainstormWriteNotePayload) => {
    ensureNotesVaultDir();
    const userData = app.getPath('userData');
    const layoutMode = loadVaultSettings().layoutMode ?? 'default';
    const { notesRouting } = loadBrainstormSettings(userData);
    const resolution = resolveDestination(payload.category, layoutMode, notesRouting);

    const suggestionId = crypto.randomUUID();
    const now = new Date().toISOString();
    const safeName = payload.name.replace(/[/\\:*?"<>|]/g, '-').trim() || 'unnamed';
    const fileName = `${safeName}.md`;
    const body = renderBrainstormNote({
      category: payload.category,
      name: payload.name,
      content: payload.content,
      suggestionId,
      now,
    });

    const root = getNotesVaultRoot();
    if (resolution.kind === 'resolved') {
      const relPath = joinNotesPath(resolution.relativeDir, fileName);
      safeVaultIpcJoin(root, relPath, true);
      writeVaultFileAtomic(root, relPath, body);
      persistBrainstormSuggestion(suggestionId, relPath, payload, now);
      return {
        status: 'written' as const,
        path: relPath,
        suggestionId,
        reason: resolution.reason,
      };
    }
    // needs_user_choice → stage the file under the staging dir so it survives
    // a renderer crash. The renderer prompts the user and calls RESOLVE.
    const stagedRel = joinNotesPath(BLANK_MODE_STAGING_DIR, `${suggestionId}__${fileName}`);
    safeVaultIpcJoin(root, stagedRel, true);
    writeVaultFileAtomic(root, stagedRel, body);
    return {
      status: 'needs_routing' as const,
      stagedPath: stagedRel,
      category: payload.category,
      name: payload.name,
    };
  },
  [IPC_CHANNELS.BRAINSTORM_RESOLVE_ROUTING]: (
    payload: import('./ipc.js').BrainstormResolveRoutingPayload,
  ) => {
    ensureNotesVaultDir();
    const userData = app.getPath('userData');
    const root = getNotesVaultRoot();
    const destination = normalizeRoutingDestination(payload.destination);
    const fileName = path.posix.basename(payload.stagedPath);
    // Strip the `<suggestionId>__` prefix so the user sees a clean filename.
    const cleanFileName = fileName.replace(/^[0-9a-f-]{36}__/i, '');
    const targetRel = joinNotesPath(destination, cleanFileName);
    safeVaultIpcJoin(root, payload.stagedPath, true);
    safeVaultIpcJoin(root, targetRel, true);
    moveVaultFile(root, payload.stagedPath, targetRel);
    const settings = payload.remember
      ? setCategoryRouting(userData, payload.category, destination)
      : loadBrainstormSettings(userData);
    return {
      status: 'written' as const,
      path: targetRel,
      notesRouting: settings.notesRouting,
    };
  },
  [IPC_CHANNELS.BRAINSTORM_RESET_CATEGORY_ROUTING]: (
    payload: import('./ipc.js').BrainstormResetCategoryRoutingPayload,
  ) => {
    const userData = app.getPath('userData');
    const settings = setCategoryRouting(userData, payload.category, null);
    return { notesRouting: settings.notesRouting };
  },
  [IPC_CHANNELS.BRAINSTORM_LIST_NOTES_FOLDERS]: () => {
    ensureNotesVaultDir();
    const root = getNotesVaultRoot();
    return { folders: listNotesVaultFolders(root), notesVaultRoot: root };
  },
  // SKY-196: select vault notes that fit inside the token budget for context injection.
  // Reads up to 100 .md files from the Notes Vault, parses frontmatter for type/name,
  // then delegates scoring and budgeting to selectContext().
  [IPC_CHANNELS.BRAINSTORM_SELECT_CONTEXT]: (
    payload: import('./ipc.js').BrainstormSelectContextPayload,
  ) => {
    ensureNotesVaultDir();
    const root = getNotesVaultRoot();
    const { items } = listVaultFiles(root);
    const FACT_TYPES = new Set(['character', 'location', 'item', 'note']);
    const MAX_CANDIDATES = 100;
    const candidates: ContextCandidate[] = [];
    for (const item of items) {
      if (candidates.length >= MAX_CANDIDATES) break;
      if (item.isDirectory) continue;
      if (!item.name.endsWith('.md')) continue;
      // Skip hidden paths (staging dir, .git, etc.)
      if (item.path.split(path.sep).some((seg) => seg.startsWith('.'))) continue;
      try {
        const { content } = readVaultFile(root, item.path);
        const { frontmatter, prose } = parseFrontmatter(content);
        const rawType = frontmatter.type as string | undefined;
        const type = rawType && FACT_TYPES.has(rawType)
          ? (rawType as ContextCandidate['type'])
          : 'note';
        const name = (frontmatter.name as string | undefined) || item.name.replace(/\.md$/, '');
        candidates.push({ path: item.path, name, type, content: prose.trim() });
      } catch { /* skip unreadable or corrupt files */ }
    }
    return selectContext({ candidates, ...payload });
  },

  // ─── Writing modes (MYT-347) ───
  [IPC_CHANNELS.WRITING_MODE_GET]: () => {
    ensureVaultDir();
    return getWritingModeState();
  },

  [IPC_CHANNELS.WRITING_MODE_SET]: (payload: WritingModeSetPayload) => {
    ensureVaultDir();
    const state = setWritingModeState(payload);
    if (mainWindow) {
      mainWindow.webContents.send('writingMode:changed', state);
    }
    return state;
  },

  // ─── App data backup / restore (MYT-346) ───

  [IPC_CHANNELS.APP_BACKUP_APP_DATA]: async (payload: BackupAppDataPayload) => {
    let outputPath = payload?.outputPath;
    if (!outputPath) {
      const res = await dialog.showSaveDialog({
        title: 'Save App Data Backup',
        defaultPath: `mythos-backup-${new Date().toISOString().slice(0, 10)}.mwbackup`,
        filters: [{ name: 'Mythos Backup', extensions: ['mwbackup'] }],
      });
      if (res.canceled || !res.filePath) return { path: null, bytes: 0, cancelled: true };
      outputPath = res.filePath;
    }
    closeDb();
    try {
      const manifest = fs.existsSync(getManifestPath()) ? readManifest(getManifestPath()) : null;
      const result = await backupAppData({
        userDataPath: app.getPath('userData'),
        storyVaultRoot: getVaultRoot(),
        notesVaultRoot: getNotesVaultRoot(),
        appVersion: app.getVersion(),
        manifestSchemaVersion: manifest?.schemaVersion ?? 0,
        outputPath,
      });
      return { ...result, cancelled: false };
    } finally {
      ensureVaultDir();
    }
  },

  [IPC_CHANNELS.APP_RESTORE_APP_DATA]: async (payload: RestoreAppDataPayload) => {
    let archivePath = payload?.archivePath;
    if (!archivePath) {
      const res = await dialog.showOpenDialog({
        title: 'Restore App Data from Backup',
        filters: [{ name: 'Mythos Backup', extensions: ['mwbackup'] }],
        properties: ['openFile'],
      });
      if (res.canceled || !res.filePaths[0]) return { restored: false, cancelled: true, details: [] };
      archivePath = res.filePaths[0];
    }
    closeDb();
    try {
      const result = await restoreAppData({
        archivePath,
        userDataPath: app.getPath('userData'),
        storyVaultRoot: getVaultRoot(),
        notesVaultRoot: getNotesVaultRoot(),
        overwrite: payload?.confirmed ?? false,
      });
      return result;
    } finally {
      ensureVaultDir();
    }
  },
  // SKY-156: Project Templates
  [IPC_CHANNELS.TEMPLATE_LIST]: (): import('./ipc.js').TemplateListResponse => {
    return { templates: listTemplates(app.getPath('userData')) };
  },

  [IPC_CHANNELS.TEMPLATE_SCAFFOLD]: async (payload: import('./ipc.js').TemplateScaffoldPayload): Promise<import('./ipc.js').TemplateScaffoldResponse | { error: string }> => {
    const { templateId, storyVaultPath, notesVaultPath } = payload ?? {};
    if (!templateId || !storyVaultPath || !notesVaultPath) {
      return { error: 'templateId, storyVaultPath, and notesVaultPath are required' };
    }
    const templates = listTemplates(app.getPath('userData'));
    const template = templates.find((t) => t.id === templateId);
    if (!template) return { error: `Template not found: ${templateId}` };
    const resolvedStory = storyVaultPath.replace(/^~/, app.getPath('home'));
    const resolvedNotes = notesVaultPath.replace(/^~/, app.getPath('home'));
    for (const [label, target] of [['Story Vault', resolvedStory], ['Notes Vault', resolvedNotes]] as const) {
      if (
        fs.existsSync(target) &&
        fs.readdirSync(target).filter((e) => !e.startsWith('.')).length > 0
      ) {
        return { error: `${label} target is not empty: ${target}` };
      }
    }
    scaffoldFromTemplate(resolvedStory, resolvedNotes, template);
    return { ok: true as const, storyVaultPath: resolvedStory, notesVaultPath: resolvedNotes };
  },

  [IPC_CHANNELS.TEMPLATE_SAVE_AS]: (payload: import('./ipc.js').TemplateSaveAsPayload): import('./ipc.js').TemplateSaveAsResponse | { error: string } => {
    const name = (payload?.name ?? '').trim();
    if (!name) return { error: 'Template name is required' };
    const id = saveAsTemplate(getVaultRoot(), getNotesVaultRoot(), name, app.getPath('userData'));
    return { ok: true as const, id };
  },

  // SKY-190: Note Templates
  [IPC_CHANNELS.NOTE_TEMPLATE_LIST]: (payload: import('./ipc.js').NoteTemplateListPayload): import('./ipc.js').NoteTemplateListResponse => {
    return { templates: listNoteTemplates(payload?.kind) };
  },

  // SKY-193: Tag Wrangler
  [IPC_CHANNELS.NOTES_TAG_LIST]: (): import('./ipc.js').NotesTagListResponse => {
    const tags = listNotesTags(getNotesVaultRoot());
    return { tags };
  },
  [IPC_CHANNELS.NOTES_TAG_RENAME]: (payload: import('./ipc.js').NotesTagRenamePayload): import('./ipc.js').NotesTagRenameResponse => {
    const { oldTag, newTag } = payload ?? {};
    return renameNotesTag(getNotesVaultRoot(), oldTag, newTag);
  },
  [IPC_CHANNELS.NOTES_TAG_MERGE]: (payload: import('./ipc.js').NotesTagMergePayload): import('./ipc.js').NotesTagMergeResponse => {
    const { sourceTag, targetTag } = payload ?? {};
    return mergeNotesTags(getNotesVaultRoot(), sourceTag, targetTag);
  },
  // ─── SKY-170: Scene-to-entity links ───
  [IPC_CHANNELS.SCENE_ENTITY_LINKS_LIST]: (payload: SceneEntityLinksListPayload): import('./ipc.js').SceneEntityLinksListResponse => {
    ensureVaultDir();
    const rows = listSceneEntityLinks(payload.sceneId);
    return {
      links: rows.map((r) => ({
        sceneId: r.scene_id,
        entityId: r.entity_id,
        linkKind: r.link_kind as 'mention' | 'tag',
        createdAt: r.created_at,
      })),
    };
  },
  [IPC_CHANNELS.SCENE_ENTITY_LINKS_UPSERT]: (payload: SceneEntityLinksUpsertPayload): import('./ipc.js').SceneEntityLinksUpsertResponse => {
    ensureVaultDir();
    const now = new Date().toISOString();
    const row = { id: crypto.randomUUID(), scene_id: payload.sceneId, entity_id: payload.entityId, link_kind: payload.kind, created_at: now };
    upsertSceneEntityLink(row);
    return {
      link: {
        sceneId: row.scene_id,
        entityId: row.entity_id,
        linkKind: row.link_kind,
        createdAt: row.created_at,
      },
    };
  },
  [IPC_CHANNELS.SCENE_ENTITY_LINKS_DELETE]: (payload: SceneEntityLinksDeletePayload): void => {
    ensureVaultDir();
    deleteSceneEntityLink(payload.sceneId, payload.entityId, payload.kind);
  },
  [IPC_CHANNELS.ENTITY_LINKED_SCENES]: (payload: EntityLinkedScenesPayload): import('./ipc.js').EntityLinkedScenesResponse => {
    ensureVaultDir();
    const rows = listLinkedSceneIds(payload.entityId);
    if (rows.length === 0) return { scenes: [] };
    const manifest = readManifest(getManifestPath());
    const scenes: import('./ipc.js').LinkedScene[] = [];
    for (const row of rows) {
      for (const story of manifest.stories) {
        for (const chapter of story.chapters) {
          const scene = chapter.scenes.find((s) => s.id === row.scene_id);
          if (scene) {
            scenes.push({
              sceneId: scene.id,
              sceneTitle: scene.title,
              chapterId: chapter.id,
              chapterTitle: chapter.title,
              storyId: story.id,
              linkKind: row.link_kind as 'mention' | 'tag',
            });
          }
        }
      }
    }
    return { scenes };
  },
  // SKY-194: Iconize — per-node icon IPC
  [IPC_CHANNELS.NOTES_VAULT_READ_ICONS]: (): Record<string, string> => {
    return batchReadVaultIcons(getNotesVaultRoot());
  },
  [IPC_CHANNELS.VAULT_READ_ICONS]: (): Record<string, string> => {
    return batchReadVaultIcons(getVaultRoot());
  },
  [IPC_CHANNELS.ICONS_LIST_USER_PACKS]: (): import('./iconPacks.js').UserIconPack[] => {
    const iconsDir = path.join(app.getPath('home'), 'Mythos', '.icons');
    return listUserIconPacks(iconsDir);
  },
  [IPC_CHANNELS.ICONS_READ_SVG]: (payload: { packName: string; iconName: string }): { svg: string | null } => {
    const iconsDir = path.join(app.getPath('home'), 'Mythos', '.icons');
    const { packName, iconName } = payload ?? {};
    const svg = readUserPackSvg(iconsDir, packName, iconName);
    return { svg };
  },


};

// ─── Create BrowserWindow ───
function createWindow() {
  // electron-vite emits the preload to out/preload/preload.js, while this
  // file runs from out/main/. (The packaged app preserves the same layout.)
  const preloadPath = path.join(__dirname, '../preload/preload.js');

  const saved = loadWindowState(app.getPath('userData'));
  const displays = screen.getAllDisplays().map((d) => d.bounds);
  const restoreBounds = saved && isBoundsOnScreen(saved, displays)
    ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
    : { width: 1200, height: 800 };

  mainWindow = new BrowserWindow({
    ...restoreBounds,
    title: 'Mythos Writer',
    webPreferences: secureWebPreferences({ preloadPath }),
  });

  if (saved?.isMaximized) {
    mainWindow.maximize();
  }

  // MYT-776: deny renderer-initiated popups by default; route http(s) URLs to
  // the user's system browser via shell.openExternal instead of opening an
  // Electron window with unfettered privileges.
  mainWindow.webContents.setWindowOpenHandler(
    createWindowOpenHandler((url) => { shell.openExternal(url).catch(() => {}); }),
  );

  // Block in-place navigations to anything other than the loaded renderer —
  // protects against a compromised renderer redirecting to a remote origin
  // that would then inherit the preload bridge.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devServer = process.env.VITE_DEV_SERVER_URL;
    const isAllowed =
      (devServer && url.startsWith(devServer)) ||
      url.startsWith('file://');
    if (!isAllowed) event.preventDefault();
  });

  // SKY-114: use system locale for the spell checker, falling back to en-US.
  // setSpellCheckerLanguages accepts an array; Electron tries each in order.
  // Strip POSIX modifiers (@posix, @euro) and convert underscores to hyphens
  // to produce a valid BCP-47 code (e.g. "en-US@posix" → "en-US").
  const rawLocale = app.getSystemLocale() || 'en-US';
  const spellLang = rawLocale.split('@')[0].replace(/_/g, '-') || 'en-US';
  mainWindow.webContents.session.setSpellCheckerLanguages([spellLang, 'en-US']);

  // SKY-114: native context menu with spell-check suggestions.
  // Only shown when there is relevant content (misspelling or editable/selection).
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const menuItems: Electron.MenuItemConstructorOptions[] = [];

    if (params.misspelledWord) {
      if (params.dictionarySuggestions.length > 0) {
        for (const suggestion of params.dictionarySuggestions) {
          menuItems.push({
            label: suggestion,
            click: () => mainWindow?.webContents.replaceMisspelling(suggestion),
          });
        }
      } else {
        menuItems.push({ label: 'No suggestions', enabled: false });
      }
      menuItems.push({ type: 'separator' });
      menuItems.push({
        label: 'Add to Dictionary',
        click: () => mainWindow?.webContents.session
          .addWordToSpellCheckerDictionary(params.misspelledWord),
      });
      menuItems.push({ type: 'separator' });
    }

    if (params.isEditable) {
      menuItems.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' });
    } else if (params.selectionText) {
      menuItems.push({ role: 'copy' });
    }

    if (menuItems.length > 0) {
      Menu.buildFromTemplate(menuItems).popup({ window: mainWindow ?? undefined });
    }
  });

  // Load the Vite-built renderer
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    // electron-vite outputs renderer to out/renderer/ relative to out/main/
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('close', () => {
    if (mainWindow) {
      const isMaximized = mainWindow.isMaximized();
      // getNormalBounds returns the restored (non-maximized) size so we preserve
      // a sensible window size even when the user closes while maximized.
      const bounds = isMaximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
      saveWindowState(app.getPath('userData'), {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        isMaximized,
      });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── Auto-updater (MYT-245) ───
// Feature-flagged: only active when MYTHOS_AUTO_UPDATE=1 (set in production CI/release builds).
// Supports two channels: stable (GitHub releases) and beta (GitHub pre-releases).
// IPC handlers are always registered so renderer calls are safe no-ops in dev.
const AUTO_UPDATE_ENABLED = process.env.MYTHOS_AUTO_UPDATE === '1';

type UpdateState = 'checking' | 'available' | 'not-available' | 'downloading' | 'ready';

interface UpdateStatusPayload {
  state: UpdateState;
  version?: string;
  releaseNotes?: string | null;
}

// Last known available update — queried by renderer via UPDATE_GET_INFO
let lastUpdateInfo: { version: string; releaseNotes: string | null } | null = null;
// Set to true once the update-downloaded event fires (autoDownload=true handles the download).
let updateDownloaded = false;

function sendUpdateStatus(payload: UpdateStatusPayload) {
  if (mainWindow) {
    mainWindow.webContents.send('update:status', payload);
  }
}

function applyUpdateChannel() {
  const { updateChannel } = loadAppSettings();
  // electron-updater maps 'latest' → stable GitHub releases, 'beta' → pre-releases
  autoUpdater.channel = updateChannel === 'beta' ? 'beta' : 'latest';
}

function normalizeReleaseNotes(
  notes: string | Array<{ version: string; note: string | null }> | null | undefined,
): string | null {
  if (!notes) return null;
  if (typeof notes === 'string') return notes;
  return notes.map((n) => `### ${n.version}\n${n.note ?? ''}`).join('\n\n');
}

function initAutoUpdater() {
  // Always register IPC handlers — safe no-ops when flag is off or not packaged.
  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, (event) => {
    if (!isFromTopFrame(event)) return UNTRUSTED_FRAME_REJECTION;
    if (!AUTO_UPDATE_ENABLED || !app.isPackaged) return { queued: false, reason: 'disabled' };
    applyUpdateChannel();
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    return { queued: true };
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_INSTALL, (event, payload?: { quit: boolean }) => {
    if (!isFromTopFrame(event)) return UNTRUSTED_FRAME_REJECTION;
    if (!AUTO_UPDATE_ENABLED) return { ok: false, reason: 'disabled' };
    const quit = payload?.quit !== false; // default true = restart immediately
    autoUpdater.quitAndInstall(false, quit);
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_GET_INFO, (event) => {
    if (!isFromTopFrame(event)) return UNTRUSTED_FRAME_REJECTION;
    return lastUpdateInfo;
  });

  // MYT-337: app:checkForUpdate — async check that returns { available, version, releaseNotes }
  ipcMain.handle(IPC_CHANNELS.APP_CHECK_FOR_UPDATE, async (event) => {
    if (!isFromTopFrame(event)) return UNTRUSTED_FRAME_REJECTION;
    if (!AUTO_UPDATE_ENABLED || !app.isPackaged) {
      return { available: false, version: null, releaseNotes: null };
    }
    applyUpdateChannel();
    try {
      const result = await autoUpdater.checkForUpdates();
      if (!result) return { available: false, version: null, releaseNotes: null };
      const infoVersion = result.updateInfo.version;
      const available = infoVersion !== app.getVersion();
      const releaseNotes = available
        ? normalizeReleaseNotes(
            result.updateInfo.releaseNotes as
              | string
              | Array<{ version: string; note: string | null }>
              | null
              | undefined,
          )
        : null;
      if (available) lastUpdateInfo = { version: infoVersion, releaseNotes };
      return { available, version: available ? infoVersion : null, releaseNotes };
    } catch {
      return { available: false, version: null, releaseNotes: null };
    }
  });

  // MYT-337: app:installUpdate — schedules install on next quit (autoInstallOnAppQuit=true).
  // Does NOT trigger an immediate restart; the downloaded update is applied when the user quits normally.
  ipcMain.handle(IPC_CHANNELS.APP_INSTALL_UPDATE, (event) => {
    if (!isFromTopFrame(event)) return UNTRUSTED_FRAME_REJECTION;
    if (!AUTO_UPDATE_ENABLED) return { scheduled: false };
    return { scheduled: updateDownloaded };
  });

  if (!AUTO_UPDATE_ENABLED) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', () => { /* non-fatal — silenced to avoid noise on dev builds */ });
  autoUpdater.on('checking-for-update', () => sendUpdateStatus({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => sendUpdateStatus({ state: 'not-available' }));
  autoUpdater.on('download-progress', () => sendUpdateStatus({ state: 'downloading', version: lastUpdateInfo?.version, releaseNotes: lastUpdateInfo?.releaseNotes }));

  autoUpdater.on('update-available', (info) => {
    const releaseNotes = normalizeReleaseNotes(
      (info as { releaseNotes?: string | Array<{ version: string; note: string | null }> | null }).releaseNotes,
    );
    lastUpdateInfo = { version: (info as { version: string }).version, releaseNotes };
    sendUpdateStatus({ state: 'available', version: lastUpdateInfo.version, releaseNotes });
  });

  autoUpdater.on('update-downloaded', (info) => {
    updateDownloaded = true;
    const version = (info as { version: string }).version;
    const releaseNotes = lastUpdateInfo?.releaseNotes ?? normalizeReleaseNotes(
      (info as { releaseNotes?: string | Array<{ version: string; note: string | null }> | null }).releaseNotes,
    );
    if (!lastUpdateInfo) lastUpdateInfo = { version, releaseNotes };
    sendUpdateStatus({ state: 'ready', version, releaseNotes });
  });

  // Apply channel setting and poll on startup (packaged builds only).
  applyUpdateChannel();
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
  heartbeatIntervalMinutes: 5,
  maxTokensPerDay: 500_000,
  // MYT-343: per-agent config additions
  autoApplyThreshold: 0.85,
  requestsPerMinute: 60,
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
  updateChannel: 'stable',
};

/**
 * Shared vault-write logic for accepted/applied suggestions.
 * For vault suggestions (target_kind='vault' with a target_path and payload_json):
 *   - snapshots the original file content
 *   - writes the new content (from payload.content or payload.prose) with provenance frontmatter
 *   - returns finalStatus='applied' and the relative snapshot path
 * For all other suggestions (manuscript or advisory):
 *   - returns finalStatus='accepted' and snapshotPath=null
 *
 * Errors during vault write are silently swallowed so the suggestion DB state is always
 * consistent — the suggestion records the attempted apply; callers should not re-throw.
 */
function autoApplyVaultWrite(
  suggestion: import('./db.js').DbSuggestion,
  now: string,
): { finalStatus: 'accepted' | 'applied'; snapshotPath: string | null } {
  if (
    suggestion.target_kind === 'vault' &&
    suggestion.target_path &&
    suggestion.payload_json
  ) {
    try {
      const payloadData = JSON.parse(suggestion.payload_json) as {
        kind?: string;
        content?: string;
        prose?: string;
        relationType?: string;
        sourceEntityId?: string;
        sourceEntityPath?: string;
        targetEntityId?: string;
        targetEntityPath?: string;
      };

      // ─── Typed-relation apply ───
      if (payloadData.kind === 'typed-relation') {
        const {
          relationType,
          sourceEntityId,
          sourceEntityPath,
          targetEntityId,
          targetEntityPath,
        } = payloadData;
        if (!relationType || !sourceEntityId || !sourceEntityPath || !targetEntityId || !targetEntityPath) {
          return { finalStatus: 'accepted', snapshotPath: null };
        }
        const manifest = readManifest(getManifestPath());

        const sourceEntry = manifest.entities.find((e) => e.id === sourceEntityId);
        if (sourceEntry) {
          const existingRelations = sourceEntry.relations ?? [];
          const alreadyHas = existingRelations.some(
            (r) => r.type === relationType && r.target === targetEntityId,
          );
          if (!alreadyHas) {
            updateEntity(getVaultRoot(), manifest, sourceEntityId, {
              relations: [...existingRelations, { type: relationType, target: targetEntityId }],
            });
          }
        }

        const reciprocal = getReciprocal(relationType);
        const targetEntry = manifest.entities.find((e) => e.id === targetEntityId);
        if (targetEntry) {
          const existingRelations = targetEntry.relations ?? [];
          const alreadyHas = existingRelations.some(
            (r) => r.type === reciprocal && r.target === sourceEntityId,
          );
          if (!alreadyHas) {
            updateEntity(getVaultRoot(), manifest, targetEntityId, {
              relations: [...existingRelations, { type: reciprocal, target: sourceEntityId }],
            });
          }
        }

        writeManifest(getManifestPath(), manifest);
        return { finalStatus: 'applied', snapshotPath: null };
      }

      // ─── Standard vault-write apply ───
      const snapshotDir = path.join(getVaultRoot(), '.mythos', 'suggestion-snapshots');
      if (!fs.existsSync(snapshotDir)) fs.mkdirSync(snapshotDir, { recursive: true });
      const relSnapshotPath = path.join(
        '.mythos', 'suggestion-snapshots', `${suggestion.id}.json`,
      );
      const fullSnapshotPath = path.join(getVaultRoot(), relSnapshotPath);

      let originalContent = '';
      try {
        const { content: vc } = readVaultFile(getVaultRoot(), suggestion.target_path);
        originalContent = vc;
      } catch { /* new file — empty original */ }

      fs.writeFileSync(
        fullSnapshotPath,
        JSON.stringify({ originalContent, path: suggestion.target_path }),
        'utf-8',
      );

      const newContent = payloadData.content ?? payloadData.prose ?? originalContent;
      const { prose: newProse } = parseFrontmatter(newContent);
      mergeProvenanceFrontmatter(getVaultRoot(), suggestion.target_path, {
        source_agent: suggestion.source_agent,
        confidence: suggestion.confidence,
        rationale: suggestion.rationale,
        timestamp: now,
        run_id: suggestion.applied_run_id ?? undefined,
        suggestion_id: suggestion.id,
      }, newProse);

      return { finalStatus: 'applied', snapshotPath: relSnapshotPath };
    } catch {
      // Vault write failed — fall through to accepted without file write
    }
  }
  return { finalStatus: 'accepted', snapshotPath: null };
}

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
  let base: AppSettings;
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Partial<AppSettings> & { liquidGlass?: AppSettings['liquidNeon'] };
      type AgentsRaw = Partial<AppSettings['agents']>;
      const rawAgents: AgentsRaw = (raw.agents as AgentsRaw | undefined) ?? {};
      // One-shot migration: legacy key liquidGlass → liquidNeon (MYT-814)
      const liquidNeon = raw.liquidNeon ?? raw.liquidGlass;
      base = {
        ...SETTINGS_DEFAULTS,
        ...raw,
        ...(liquidNeon ? { liquidNeon } : {}),
        agents: {
          writingAssistant: { ...SETTINGS_DEFAULTS.agents.writingAssistant, ...(rawAgents.writingAssistant ?? {}) },
          brainstorm: { ...SETTINGS_DEFAULTS.agents.brainstorm, ...(rawAgents.brainstorm ?? {}) },
          archive: { ...SETTINGS_DEFAULTS.agents.archive, ...(rawAgents.archive ?? {}) },
        },
      };
    } catch {
      base = { ...SETTINGS_DEFAULTS, agents: { ...SETTINGS_DEFAULTS.agents } };
    }
  } else {
    base = { ...SETTINGS_DEFAULTS, agents: { ...SETTINGS_DEFAULTS.agents } };
  }
  // MYT-777: overlay decrypted credentials from the SecretsStore so the rest
  // of the main-process code keeps reading settings.apiKey / provider.apiKey /
  // voice.openaiApiKey unchanged. The on-disk JSON file holds empty strings
  // for those fields after the one-shot migration in app-ready.
  try {
    return hydrateSecretsIntoSettings(base, getSecretsStore());
  } catch {
    // Store not yet initialized (very early boot path). Caller will see the
    // post-migration empty key strings; the env-var fallback in
    // getValidatedApiKey still serves as a last resort for CLI/CI scenarios.
    return base;
  }
}

function saveAppSettings(settings: AppSettings): void {
  // MYT-777: never persist plaintext API keys to app-settings.json. Route
  // secret-shaped fields into the encrypted store and write the cleared
  // payload to disk. If the store is unavailable, still strip the fields so
  // we never regress to plaintext-at-rest.
  let toWrite: AppSettings = settings;
  try {
    toWrite = persistSecretsAndStripSettings(settings, getSecretsStore());
  } catch {
    toWrite = {
      ...settings,
      apiKey: '',
      ...(settings.provider ? { provider: { ...settings.provider, apiKey: '' } } : {}),
      ...(settings.voice ? { voice: { ...settings.voice, openaiApiKey: '' } } : {}),
    };
  }
  fs.writeFileSync(getAppSettingsPath(), JSON.stringify(toWrite, null, 2), 'utf-8');
}

// ─── Telemetry bootstrap ───────────────────────────────────────────────────
// Called once on app-ready and whenever settings change.
function initTelemetry(): void {
  const settings = loadAppSettings();
  const telemetry = settings.telemetry ?? { enabled: false, sessionId: '' };
  // Ensure there's always a sessionId stored, even when disabled (regenerated on each disable).
  if (!telemetry.sessionId) {
    const id = generateSessionId();
    saveAppSettings({ ...settings, telemetry: { ...telemetry, sessionId: id } });
    configureTelemetry({ enabled: telemetry.enabled, sessionId: id });
  } else {
    configureTelemetry({ enabled: telemetry.enabled, sessionId: telemetry.sessionId });
  }
}

// Settings masking helpers live in their own module so they can be unit-tested
// without booting electron. See settings-masking.ts.

// ─── Anthropic API key validation ───
// MYT-777: settings.apiKey is hydrated from the encrypted secrets store. The
// process.env.ANTHROPIC_API_KEY fallback is retained as a dev/CI escape hatch
// (and for headless CLI runs) and is intentionally NOT written into the store
// — that would silently persist a key the user did not explicitly opt into.
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
  ipcMain.handle(IPC_CHANNELS.AGENT_BRAINSTORM, wrapIpcHandler(IPC_CHANNELS.AGENT_BRAINSTORM, async (event, payload: AgentBrainstormPayload) => {
    if (!isFromTopFrame(event)) return UNTRUSTED_FRAME_REJECTION;
    const agentSettings = loadAppSettings().agents.brainstorm;
    if (!agentSettings.enabled) {
      throw new Error('Brainstorm agent is disabled in settings.');
    }
    const budgetCheck = checkCallBudget('brainstorm', agentSettings, getDb());
    if (!budgetCheck.allowed) {
      const capLabel = budgetCheck.reason === 'daily_token_cap' ? 'daily token cap' : 'hourly token cap';
      if (mainWindow) {
        mainWindow.webContents.send(IPC_CHANNELS.AGENT_BUDGET_CAP, {
          agent: 'brainstorm',
          agentLabel: 'Brainstorm Agent',
          reason: budgetCheck.reason,
        });
      }
      throw new Error(`Brainstorm Agent paused: ${capLabel} reached. Try again next window.`);
    }
    const apiKey = getValidatedApiKey();
    const client = new Anthropic({ apiKey });

    const systemPrompt = buildAgentSystemPrompt(app.getPath('userData'), 'brainstorm');

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
        const category = categorizeStreamError(err);
        const userMessage = streamErrorUserMessage(category);
        if (!event.sender.isDestroyed()) {
          event.sender.send('agent:brainstorm:error', { requestId, category, message: userMessage });
        }
        throw new Error(userMessage);
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
  }));
}

// ─── Writing Assistant streaming handler ───
// Registered separately so we can push chunk events to the renderer mid-response.
function registerWritingAssistantHandler() {
  ipcMain.handle(IPC_CHANNELS.AGENT_WRITING_ASSISTANT, wrapIpcHandler(IPC_CHANNELS.AGENT_WRITING_ASSISTANT, async (event, payload: AgentWritingAssistantPayload) => {
    if (!isFromTopFrame(event)) return UNTRUSTED_FRAME_REJECTION;
    const agentSettings = loadAppSettings().agents.writingAssistant;
    if (!agentSettings.enabled) {
      throw new Error('Writing Assistant is disabled in settings.');
    }
    const budgetCheck = checkCallBudget('writing-assistant', agentSettings, getDb());
    if (!budgetCheck.allowed) {
      const capLabel = budgetCheck.reason === 'daily_token_cap' ? 'daily token cap' : 'hourly token cap';
      if (mainWindow) {
        mainWindow.webContents.send(IPC_CHANNELS.AGENT_BUDGET_CAP, {
          agent: 'writing-assistant',
          agentLabel: 'Writing Assistant',
          reason: budgetCheck.reason,
        });
      }
      throw new Error(`Writing Assistant paused: ${capLabel} reached. Try again next window.`);
    }
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
        system: buildAgentSystemPrompt(app.getPath('userData'), 'writingAssistant'),
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
        const category = categorizeStreamError(err);
        const userMessage = streamErrorUserMessage(category);
        if (!event.sender.isDestroyed()) {
          event.sender.send('agent:writing-assistant:error', { requestId, category, message: userMessage });
        }
        throw new Error(userMessage);
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
  }));
}

// ─── Vault Agent handlers ───
function registerVaultAgentHandlers() {
  // agent:vault-index — builds in-memory index of all vault entities
  ipcMain.handle(IPC_CHANNELS.AGENT_VAULT_INDEX, wrapIpcHandler(IPC_CHANNELS.AGENT_VAULT_INDEX, (event) => {
    if (!isFromTopFrame(event)) return UNTRUSTED_FRAME_REJECTION;
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
  }));

  // agent:vault-check — streams Claude continuity analysis and returns parsed inconsistencies
  ipcMain.handle(IPC_CHANNELS.AGENT_VAULT_CHECK, wrapIpcHandler(IPC_CHANNELS.AGENT_VAULT_CHECK, async (event, payload: VaultCheckPayload) => {
    if (!isFromTopFrame(event)) return UNTRUSTED_FRAME_REJECTION;
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
        const category = categorizeStreamError(err);
        const userMessage = streamErrorUserMessage(category);
        if (!event.sender.isDestroyed()) {
          event.sender.send('agent:vault-check:error', { requestId, category, message: userMessage });
        }
        throw new Error(userMessage);
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
  }));
}

// ─── Writing Assistant scan core (MYT-711) ───
// Shared logic for both the WRITING_SCAN IPC handler and the scheduled heartbeat.
// Returns tips and upserts each as a suggestion row.
async function runWritingScan(
  prose: string,
  scenePath: string,
  sceneId: string,
  client: Anthropic,
  model: string,
): Promise<{ tips: string[]; suggestionsUpserted: number; scannedAt: string }> {
  const startedAt = Date.now();
  let tokensIn: number | null = null;
  let tokensOut: number | null = null;
  let genError: string | null = null;
  const scannedAt = new Date().toISOString();

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 512,
      system: 'You are a Writing Assistant doing a quick scene scan. Read the prose and identify 2–3 specific, actionable writing tips about craft, pacing, voice, or clarity. Return ONLY a JSON array of tip strings, for example: ["Tip one.", "Tip two."]. No other text.',
      messages: [{
        role: 'user',
        content: `Scene (${scenePath}):\n\n${prose.slice(0, 4000)}`,
      }],
    });

    tokensIn = response.usage.input_tokens;
    tokensOut = response.usage.output_tokens;

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const tips = parseScanTips(text);
    const rows = buildScanSuggestions(tips, sceneId, scenePath, scannedAt, crypto.randomUUID.bind(crypto));

    let suggestionsUpserted = 0;
    for (const row of rows) {
      try {
        upsertSuggestion(row);
        suggestionsUpserted++;
      } catch { /* non-fatal — continue with remaining tips */ }
    }

    return { tips, suggestionsUpserted, scannedAt };
  } catch (err: unknown) {
    genError = (err as Error).message ?? 'unknown error';
    throw err;
  } finally {
    const digest = crypto.createHash('sha256').update(prose.slice(0, 100)).digest('hex');
    try {
      insertGenerationLog({
        id: crypto.randomUUID(),
        agent: 'writing-assistant',
        model,
        endpoint: 'messages.create',
        request_id: null,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        latency_ms: Date.now() - startedAt,
        error: genError,
        created_at: new Date().toISOString(),
        payload_digest: digest,
      });
    } catch { /* non-fatal */ }
  }
}

// ─── Writing Assistant scheduled scan handler (MYT-233 / MYT-711) ───
function registerWritingScanHandler(): void {
  ipcMain.handle(IPC_CHANNELS.WRITING_SCAN, wrapIpcHandler(IPC_CHANNELS.WRITING_SCAN, async (event, payload: WritingScanPayload) => {
    if (!isFromTopFrame(event)) return UNTRUSTED_FRAME_REJECTION;
    const settings = loadAppSettings();
    if (!settings.agents.writingAssistant.enabled) {
      return { tips: [], suggestionsUpserted: 0, scannedAt: new Date().toISOString() };
    }
    const budgetCheck = checkCallBudget('writing-assistant', settings.agents.writingAssistant, getDb());
    if (!budgetCheck.allowed) {
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.AGENT_BUDGET_CAP, {
            agent: 'writing-assistant',
            agentLabel: 'Writing Assistant',
            reason: budgetCheck.reason,
          });
        }
      });
      return { tips: [], suggestionsUpserted: 0, scannedAt: new Date().toISOString() };
    }
    const apiKey = getValidatedApiKey();
    const client = new Anthropic({ apiKey });
    const model = settings.agents.writingAssistant.model || 'claude-haiku-4-5-20251001';

    return runWritingScan(payload.prose, payload.scenePath, payload.sceneId, client, model);
  }));
}

// ─── Writing Assistant scheduled heartbeat (MYT-711) ───
// Periodically scans the most recently updated scene in the vault and pushes
// WRITING_SCAN_RESULT to all active renderers. Interval keyed to
// agents.writingAssistant.scanIntervalSeconds; restarts when settings change.

let writingScanTimer: ReturnType<typeof setInterval> | null = null;

function stopWritingScanScheduler(): void {
  if (writingScanTimer !== null) {
    clearInterval(writingScanTimer);
    writingScanTimer = null;
  }
}

function startWritingScanScheduler(): void {
  stopWritingScanScheduler();
  const settings = loadAppSettings();
  if (!settings.agents.writingAssistant.enabled) return;

  const intervalMs = (settings.agents.writingAssistant.scanIntervalSeconds ?? 30) * 1000;

  writingScanTimer = setInterval(async () => {
    try {
      const currentSettings = loadAppSettings();
      if (!currentSettings.agents.writingAssistant.enabled) return;
      const budgetCheck = checkCallBudget('writing-assistant', currentSettings.agents.writingAssistant, getDb());
      if (!budgetCheck.allowed) {
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed()) {
            win.webContents.send(IPC_CHANNELS.AGENT_BUDGET_CAP, {
              agent: 'writing-assistant',
              agentLabel: 'Writing Assistant',
              reason: budgetCheck.reason,
            });
          }
        });
        return;
      }

      // Find the most recently updated scene in the vault.
      let latestScene: import('./ipc.js').SceneEntry | null = null;
      try {
        const manifest = readManifest(getManifestPath());
        for (const story of manifest.stories) {
          for (const chapter of story.chapters) {
            for (const scene of chapter.scenes) {
              if (!latestScene || scene.updatedAt > latestScene.updatedAt) {
                latestScene = scene;
              }
            }
          }
        }
        // Fallback to legacy flat scenes list
        if (!latestScene) {
          for (const scene of manifest.scenes) {
            if (!latestScene || scene.updatedAt > latestScene.updatedAt) {
              latestScene = scene;
            }
          }
        }
      } catch { /* non-fatal — no vault open yet */ }

      if (!latestScene) return;

      let prose = '';
      try {
        prose = readSceneFile(getVaultRoot(), latestScene.path).prose;
      } catch { return; }
      if (!prose.trim()) return;

      const apiKey = getValidatedApiKey();
      const client = new Anthropic({ apiKey });
      const model = currentSettings.agents.writingAssistant.model || 'claude-haiku-4-5-20251001';

      const result = await runWritingScan(prose, latestScene.path, latestScene.id, client, model);

      const pushPayload: import('./ipc.js').WritingScanResultPayload = {
        sceneId: latestScene.id,
        scenePath: latestScene.path,
        tips: result.tips,
        scannedAt: result.scannedAt,
      };
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.WRITING_SCAN_RESULT, pushPayload);
        }
      });
    } catch { /* non-fatal — scheduler must not crash the main process */ }
  }, intervalMs);
}

// ─── Beta-Read Mode on-demand scan handler (MYT-711) ───
// Runs an LLM analysis of a scene and auto-generates anchored BetaReadComments.
function registerBetaReadScanHandler(): void {
  ipcMain.handle(IPC_CHANNELS.BETA_READ_SCAN, wrapIpcHandler(IPC_CHANNELS.BETA_READ_SCAN, async (event, payload: BetaReadScanPayload) => {
    if (!isFromTopFrame(event)) return UNTRUSTED_FRAME_REJECTION;
    const settings = loadAppSettings();
    if (!settings.agents.writingAssistant.enabled) {
      return { comments: [], scannedAt: new Date().toISOString() };
    }
    const budgetCheck = checkCallBudget('writing-assistant', settings.agents.writingAssistant, getDb());
    if (!budgetCheck.allowed) {
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.AGENT_BUDGET_CAP, {
            agent: 'writing-assistant',
            agentLabel: 'Writing Assistant',
            reason: budgetCheck.reason,
          });
        }
      });
      return { comments: [], scannedAt: new Date().toISOString() };
    }

    const apiKey = getValidatedApiKey();
    const client = new Anthropic({ apiKey });
    const model = settings.agents.writingAssistant.model || 'claude-haiku-4-5-20251001';
    const scannedAt = new Date().toISOString();
    const startedAt = Date.now();
    let tokensIn: number | null = null;
    let tokensOut: number | null = null;
    let genError: string | null = null;

    try {
      const response = await client.messages.create({
        model,
        max_tokens: 1024,
        system: `You are a Beta Reader reviewing a fiction scene. Identify specific passages that need improvement in pacing, clarity, characterisation, or narrative tension. For each issue, output a JSON object on its own line:
{"anchor":"exact quote from the text (max 80 chars)","comment":"your specific feedback"}
Output ONLY these JSON objects, one per line. Identify 2–5 issues. No other text.`,
        messages: [{
          role: 'user',
          content: `Scene (${payload.scenePath}):\n\n${payload.prose.slice(0, 5000)}`,
        }],
      });

      tokensIn = response.usage.input_tokens;
      tokensOut = response.usage.output_tokens;

      const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const parsed = parseBetaReadLines(text);
      const comments = buildBetaReadComments(parsed, payload.sceneId, scannedAt, crypto.randomUUID.bind(crypto));

      for (const comment of comments) {
        insertBetaReadComment({
          id: comment.id,
          scene_id: comment.scene_id,
          anchor_text: comment.anchor_text,
          comment_text: comment.comment_text,
          created_at: comment.created_at,
          dismissed_at: comment.dismissed_at,
        });
      }

      return { comments, scannedAt };
    } catch (err: unknown) {
      genError = (err as Error).message ?? 'unknown error';
      throw err;
    } finally {
      const digest = crypto.createHash('sha256').update(payload.prose.slice(0, 100)).digest('hex');
      try {
        insertGenerationLog({
          id: crypto.randomUUID(),
          agent: 'writing-assistant',
          model,
          endpoint: 'messages.create',
          request_id: null,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          latency_ms: Date.now() - startedAt,
          error: genError,
          created_at: new Date().toISOString(),
          payload_digest: digest,
        });
      } catch { /* non-fatal */ }
    }
  }));
}

// ─── Agent persona IPC handlers (MYT-816) ────────────────────────────────────
function registerAgentPersonaHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.AGENT_PERSONA_READ, (_event, payload: AgentPersonaReadPayload) => {
    const { agentName, key } = payload;
    const file = loadPersonaFile(app.getPath('userData'), agentName as AgentPersonaName, key as PersonaKey);
    return { content: file.content, isCustom: file.isCustom };
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_PERSONA_RESET, (_event, payload: AgentPersonaResetPayload) => {
    const { agentName, key } = payload;
    resetPersonaFile(app.getPath('userData'), agentName as AgentPersonaName, key as PersonaKey);
    return { success: true };
  });
}

// ─── App lifecycle ───
// Use software rendering. Mythos Writer is a text app with no GPU-bound UI, and
// GPU init fails in headless/virtualized environments (CI under Xvfb, some VMs),
// where a failed GPU process otherwise blocks the window from ever appearing.
// Must be called before the app 'ready' event.
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  performance.mark('app:ready-start');
  const appReadyT0 = performance.now();

  ensureVaultDir();
  ensureNotesVaultDir();
  // Track current vault in recent projects list on every launch
  addToRecentProjects(getVaultRoot());
  performance.mark('app:vault-init-end');
  // MYT-777: initialise the encrypted credential store, then run the one-shot
  // migration that lifts any plaintext API keys out of app-settings.json into
  // safeStorage. Must precede initTelemetry — that path can rewrite settings.
  initSecretsStore({ userDataDir: app.getPath('userData'), safeStorage });
  try {
    migrateSecretsFromSettingsFile(getAppSettingsPath(), getSecretsStore());
  } catch (e) {
    // On hosts without a usable OS keychain, safeStorage.encryptString throws
    // and the migration would re-throw. Leave the file untouched so existing
    // env-var workflows keep working; settings UI will surface the error.
    console.warn('[secrets] migration skipped: safeStorage unavailable —', (e as Error).message);
  }
  // Initialize telemetry from persisted settings (off by default)
  initTelemetry();
  // MYT-788: seed the voice-binary trusted set from persisted settings — those
  // paths got there through a previous gated write (or pre-existed before the
  // gate was introduced and remain trustable as user-controlled state).
  seedTrustedBinariesFromSettings(loadAppSettings());
  performance.mark('app:secrets-end');
  setupIpcMain(handlers);
  // Synchronous IPC for beforeunload flush — ensures content is persisted before window closes.
  ipcMain.on(IPC_CHANNELS.SNAPSHOT_SAVE_SYNC, (event, payload: SnapshotSavePayload) => {
    if (isFromTopFrame(event)) {
      try {
        ensureVaultDir();
        const { snapshots: retention } = loadAppSettings();
        saveSnapshot(getVaultRoot(), payload.sceneId, payload.content, retention);
      } catch { /* non-fatal — don't block close */ }
    }
    event.returnValue = null;
  });
  registerAgentCancelHandlers();
  registerBrainstormHandler();
  registerWritingAssistantHandler();
  registerAgentPersonaHandlers();
  registerVaultAgentHandlers();
  registerWritingScanHandler();
  registerBetaReadScanHandler();
  registerStreamingHandlers(getValidatedApiKey);
  startWritingScanScheduler();
  registerVoiceHandlers(
    () => mainWindow?.webContents ?? null,
    loadAppSettings,
  );
  performance.mark('app:ipc-ready');
  createWindow();
  performance.mark('app:window-created');
  console.log(`[perf] app:startup → window: ${(performance.now() - appReadyT0).toFixed(0)} ms`);
  initAutoUpdater();

  // Start watching both vaults for external markdown changes.
  // Watchers run before FTS so their async dynamic-import yields the event
  // loop, giving the renderer's first IPC calls (e.g. settingsGet) a window
  // to be processed before indexing starts.
  await startVaultWatcher(getVaultRoot(), notifyVaultChanged);
  await startNotesVaultWatcher(getNotesVaultRoot(), notifyNotesVaultChanged);

  // Defer FTS index build to the next event-loop tick so any IPC messages
  // queued during watcher init (typically the renderer's settingsGet) are
  // processed first. Safe because the watcher re-indexes on every vault change.
  setImmediate(() => {
    performance.mark('app:fts-build-start');
    const ftsBuildT0 = performance.now();
    try {
      const manifest = readManifest(getManifestPath());
      buildFullIndex(getDb(), getVaultRoot(), manifest);
    } catch { /* non-fatal — index rebuilt on next watcher event */ }
    performance.mark('app:fts-build-end');
    console.log(`[perf] app:fts-build: ${(performance.now() - ftsBuildT0).toFixed(0)} ms`);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  stopWritingScanScheduler();
  await stopVaultWatcher();
  await stopNotesVaultWatcher();
  closeDb();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
