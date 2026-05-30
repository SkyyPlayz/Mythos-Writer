// SQLite persistence layer — suggestions, audit log, timeline entries.
// Opens and creates the DB at <vault>/.mythos/state.db on first call.
// All operations are synchronous (node:sqlite built-in).

import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';
import fs from 'fs';
import path from 'path';

// ─── Domain types ───

export type SuggestionStatus = 'proposed' | 'accepted' | 'rejected' | 'applied' | 'rolled_back';
export type SourceAgent = 'writing-assistant' | 'brainstorm' | 'archive';
export type AuditAction = 'accept' | 'apply' | 'reject' | 'rollback';
export type TimelineSource = 'explicit_marker' | 'prose';

export interface DbSuggestion {
  id: string;
  source_agent: string;
  confidence: number;
  rationale: string;
  target_kind: 'vault' | 'manuscript' | null;
  target_path: string | null;
  target_anchor: string | null;
  payload_json: string | null;
  status: SuggestionStatus;
  created_at: string;
  applied_at: string | null;
  applied_run_id: string | null;
  /** 1 if blocked by a budget cap; 0 otherwise */
  budget_exceeded: number;
}

export interface DbAuditLog {
  id: string;
  suggestion_id: string;
  action: AuditAction;
  snapshot_path: string | null;
  actor: string;
  created_at: string;
}

export interface DbTimelineEntry {
  id: string;
  scene_path: string;
  inferred_time: string;
  confidence: number;
  source: TimelineSource;
  notes_json: string | null;
  created_at: string;
}

export interface DbProvenance {
  id: string;
  entity_id: string;
  entity_kind: 'suggestion' | 'entity' | 'scene' | 'timeline_entry' | string;
  agent_id: string;
  agent_type: string;
  run_id: string | null;
  created_at: string;
}

export interface DbGenerationLog {
  id: string;
  agent: string;
  model: string;
  endpoint: string;
  request_id: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  latency_ms: number;
  error: string | null;
  created_at: string;
  payload_digest: string | null;
  prompt_text: string | null;
  response_text: string | null;
}

// ─── Module state ───

let _db: DatabaseSync | null = null;
let _dbPath: string | null = null;

// ─── Lifecycle ───

export function openDb(vaultRoot: string): DatabaseSync {
  const mythosDir = path.join(vaultRoot, '.mythos');
  const dbPath = path.join(mythosDir, 'state.db');

  if (_db && _dbPath === dbPath) {
    return _db;
  }
  if (_db) {
    _db.close();
    _db = null;
  }

  if (!fs.existsSync(mythosDir)) {
    fs.mkdirSync(mythosDir, { recursive: true });
  }

  _db = new DatabaseSync(dbPath);
  _dbPath = dbPath;
  _db.exec('PRAGMA journal_mode = WAL');
  runMigrations(_db);
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
    _dbPath = null;
  }
}

export function getDb(): DatabaseSync {
  if (!_db) throw new Error('DB not open — call openDb() first');
  return _db;
}

// ─── Migrations ───
// Uses SQLite PRAGMA user_version to track schema version.
// Each entry runs exactly once; new entries are appended for future versions.

function runMigrations(db: DatabaseSync): void {
  const pragmaRow = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  const currentVersion = pragmaRow?.user_version ?? 0;

  if (currentVersion < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS suggestions (
        id            TEXT PRIMARY KEY,
        source_agent  TEXT NOT NULL,
        confidence    REAL NOT NULL,
        rationale     TEXT NOT NULL,
        target_path   TEXT,
        target_anchor TEXT,
        payload_json  TEXT,
        status        TEXT NOT NULL DEFAULT 'proposed',
        created_at    TEXT NOT NULL,
        applied_at    TEXT,
        applied_run_id TEXT
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id             TEXT PRIMARY KEY,
        suggestion_id  TEXT NOT NULL,
        action         TEXT NOT NULL,
        snapshot_path  TEXT,
        actor          TEXT NOT NULL,
        created_at     TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS timeline_entries (
        id            TEXT PRIMARY KEY,
        scene_path    TEXT NOT NULL,
        inferred_time TEXT NOT NULL,
        confidence    REAL NOT NULL,
        source        TEXT NOT NULL,
        notes_json    TEXT,
        created_at    TEXT NOT NULL
      );
    `);
    db.exec('PRAGMA user_version = 1');
  }

  if (currentVersion < 2) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS generation_log (
        id             TEXT PRIMARY KEY,
        agent          TEXT NOT NULL,
        model          TEXT NOT NULL,
        endpoint       TEXT NOT NULL,
        request_id     TEXT,
        tokens_in      INTEGER,
        tokens_out     INTEGER,
        latency_ms     INTEGER NOT NULL,
        error          TEXT,
        created_at     TEXT NOT NULL,
        payload_digest TEXT
      );
    `);
    db.exec('PRAGMA user_version = 2');
  }

  if (currentVersion < 3) {
    db.exec(`ALTER TABLE suggestions ADD COLUMN target_kind TEXT;`);
    db.exec('PRAGMA user_version = 3');
  }

  if (currentVersion < 4) {
    db.exec(`ALTER TABLE suggestions ADD COLUMN budget_exceeded INTEGER NOT NULL DEFAULT 0;`);
    db.exec('PRAGMA user_version = 4');
  }

  if (currentVersion < 5) {
    db.exec(`
      ALTER TABLE generation_log ADD COLUMN prompt_text TEXT;
      ALTER TABLE generation_log ADD COLUMN response_text TEXT;
    `);
    db.exec('PRAGMA user_version = 5');
  }

  if (currentVersion < 6) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS provenance (
        id          TEXT PRIMARY KEY,
        entity_id   TEXT NOT NULL,
        entity_kind TEXT NOT NULL,
        agent_id    TEXT NOT NULL,
        agent_type  TEXT NOT NULL,
        run_id      TEXT,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_provenance_entity ON provenance (entity_id, entity_kind);
    `);
    db.exec('PRAGMA user_version = 6');
  }

  if (currentVersion < 7) {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS fts_index USING fts5(
        doc_id    UNINDEXED,
        vault     UNINDEXED,
        kind      UNINDEXED,
        title,
        body,
        tokenize = 'porter ascii'
      );
      CREATE TABLE IF NOT EXISTS fts_indexed_at (
        doc_id     TEXT PRIMARY KEY,
        indexed_at TEXT NOT NULL
      );
    `);
    db.exec('PRAGMA user_version = 7');
  }

  if (currentVersion < 8) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS beta_read_comments (
        id           TEXT PRIMARY KEY,
        scene_id     TEXT NOT NULL,
        anchor_text  TEXT NOT NULL,
        comment_text TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        dismissed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_beta_read_scene ON beta_read_comments (scene_id);
    `);
    db.exec('PRAGMA user_version = 8');
  }

  if (currentVersion < 9) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS manifest_migration_log (
        id            TEXT PRIMARY KEY,
        manifest_path TEXT NOT NULL,
        from_version  INTEGER NOT NULL,
        to_version    INTEGER NOT NULL,
        backup_path   TEXT NOT NULL,
        created_at    TEXT NOT NULL
      );
    `);
    db.exec('PRAGMA user_version = 9');
  }

  if (currentVersion < 10) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS archive_ignore_list (
        id          TEXT PRIMARY KEY,
        entity_id   TEXT NOT NULL,
        prop_key    TEXT NOT NULL,
        scene_path  TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_ignore_unique
        ON archive_ignore_list (entity_id, prop_key, scene_path);
    `);
    db.exec('PRAGMA user_version = 10');
  }

  if (currentVersion < 11) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    db.exec('PRAGMA user_version = 11');
  }

  if (currentVersion < 12) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id         INTEGER PRIMARY KEY,
        scene_id   TEXT UNIQUE NOT NULL,
        content    TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL DEFAULT 0
      );
    `);
    db.exec('PRAGMA user_version = 12');
  }
}

// ─── Project settings (key-value store for per-project state) ───

export function getProjectSetting(key: string): string | null {
  const row = getDb()
    .prepare('SELECT value FROM project_settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setProjectSetting(key: string, value: string): void {
  getDb()
    .prepare('INSERT OR REPLACE INTO project_settings (key, value) VALUES (?, ?)')
    .run(key, value);
}

// ─── Suggestions ───

export function upsertSuggestion(s: DbSuggestion): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO suggestions
         (id, source_agent, confidence, rationale, target_kind, target_path, target_anchor,
          payload_json, status, created_at, applied_at, applied_run_id, budget_exceeded)
       VALUES
         (@id, @source_agent, @confidence, @rationale, @target_kind, @target_path, @target_anchor,
          @payload_json, @status, @created_at, @applied_at, @applied_run_id, @budget_exceeded)`
    )
    .run(s as unknown as Record<string, SQLInputValue>);
}

export function updateSuggestionBudgetExceeded(id: string, exceeded: boolean): void {
  getDb()
    .prepare(`UPDATE suggestions SET budget_exceeded = @exceeded WHERE id = @id`)
    .run({ id, exceeded: exceeded ? 1 : 0 });
}

export function updateSuggestionStatus(
  id: string,
  status: SuggestionStatus,
  appliedAt?: string,
  appliedRunId?: string
): void {
  getDb()
    .prepare(
      `UPDATE suggestions
          SET status = @status, applied_at = @applied_at, applied_run_id = @applied_run_id
        WHERE id = @id`
    )
    .run({ id, status, applied_at: appliedAt ?? null, applied_run_id: appliedRunId ?? null });
}

export function getSuggestion(id: string): DbSuggestion | null {
  return (
    (getDb()
      .prepare('SELECT * FROM suggestions WHERE id = ?')
      .get(id) as DbSuggestion | undefined) ?? null
  );
}

export function listSuggestions(status?: SuggestionStatus, sourceAgent?: string): DbSuggestion[] {
  const db = getDb();
  if (status && sourceAgent) {
    return db
      .prepare('SELECT * FROM suggestions WHERE status = ? AND source_agent = ? ORDER BY created_at DESC')
      .all(status, sourceAgent) as unknown as DbSuggestion[];
  }
  if (status) {
    return db
      .prepare('SELECT * FROM suggestions WHERE status = ? ORDER BY created_at DESC')
      .all(status) as unknown as DbSuggestion[];
  }
  if (sourceAgent) {
    return db
      .prepare('SELECT * FROM suggestions WHERE source_agent = ? ORDER BY created_at DESC')
      .all(sourceAgent) as unknown as DbSuggestion[];
  }
  return db.prepare('SELECT * FROM suggestions ORDER BY created_at DESC').all() as unknown as DbSuggestion[];
}

// ─── Audit log ───

export function insertAuditLog(entry: DbAuditLog): void {
  getDb()
    .prepare(
      `INSERT INTO audit_log (id, suggestion_id, action, snapshot_path, actor, created_at)
       VALUES (@id, @suggestion_id, @action, @snapshot_path, @actor, @created_at)`
    )
    .run(entry as unknown as Record<string, SQLInputValue>);
}

export function listAuditLog(suggestionId?: string): DbAuditLog[] {
  const db = getDb();
  if (suggestionId) {
    return db
      .prepare('SELECT * FROM audit_log WHERE suggestion_id = ? ORDER BY created_at DESC')
      .all(suggestionId) as unknown as DbAuditLog[];
  }
  return db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC').all() as unknown as DbAuditLog[];
}

// ─── Timeline entries ───

export function upsertTimelineEntry(entry: DbTimelineEntry): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO timeline_entries
         (id, scene_path, inferred_time, confidence, source, notes_json, created_at)
       VALUES
         (@id, @scene_path, @inferred_time, @confidence, @source, @notes_json, @created_at)`
    )
    .run(entry as unknown as Record<string, SQLInputValue>);
}

export function listTimelineEntries(scenePath?: string): DbTimelineEntry[] {
  const db = getDb();
  if (scenePath) {
    return db
      .prepare('SELECT * FROM timeline_entries WHERE scene_path = ? ORDER BY inferred_time ASC')
      .all(scenePath) as unknown as DbTimelineEntry[];
  }
  return db.prepare('SELECT * FROM timeline_entries ORDER BY inferred_time ASC').all() as unknown as DbTimelineEntry[];
}

// ─── Generation log ───

export function insertGenerationLog(entry: Omit<DbGenerationLog, 'prompt_text' | 'response_text'> & { prompt_text?: string | null; response_text?: string | null }): void {
  getDb()
    .prepare(
      `INSERT INTO generation_log
         (id, agent, model, endpoint, request_id, tokens_in, tokens_out,
          latency_ms, error, created_at, payload_digest, prompt_text, response_text)
       VALUES
         (@id, @agent, @model, @endpoint, @request_id, @tokens_in, @tokens_out,
          @latency_ms, @error, @created_at, @payload_digest, @prompt_text, @response_text)`
    )
    .run({ prompt_text: null, response_text: null, ...entry });
}

interface GenerationLogOpts {
  limit?: number;
  offset?: number;
  agent?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

function buildGenerationLogWhere(opts: Omit<GenerationLogOpts, 'limit' | 'offset'>): { where: string; params: SQLInputValue[] } {
  const conditions: string[] = [];
  const params: SQLInputValue[] = [];
  if (opts.agent) { conditions.push('agent = ?'); params.push(opts.agent); }
  if (opts.dateFrom) { conditions.push('created_at >= ?'); params.push(opts.dateFrom); }
  if (opts.dateTo) { conditions.push('created_at <= ?'); params.push(opts.dateTo); }
  if (opts.search) {
    conditions.push('(prompt_text LIKE ? OR response_text LIKE ?)');
    params.push(`%${opts.search}%`, `%${opts.search}%`);
  }
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

export function listGenerationLog(opts: GenerationLogOpts = {}): DbGenerationLog[] {
  const db = getDb();
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;
  const { where, params } = buildGenerationLogWhere(opts);
  return db
    .prepare(`SELECT * FROM generation_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as unknown as DbGenerationLog[];
}

export function countGenerationLog(opts: Omit<GenerationLogOpts, 'limit' | 'offset'> = {}): number {
  const db = getDb();
  const { where, params } = buildGenerationLogWhere(opts);
  const row = db.prepare(`SELECT COUNT(*) as cnt FROM generation_log ${where}`).get(...params) as { cnt: number };
  return row.cnt;
}

export function getGenerationLogEntry(id: string): DbGenerationLog | null {
  return (getDb().prepare('SELECT * FROM generation_log WHERE id = ?').get(id) as DbGenerationLog | undefined) ?? null;
}

const BODY_TRUNCATE_BYTES = 10 * 1024; // 10 KB

/** Truncate prompt_text / response_text for IPC list efficiency. GET returns full rows. */
export function truncateGenerationLogBody(row: DbGenerationLog): DbGenerationLog {
  const truncate = (s: string | null) =>
    s !== null && Buffer.byteLength(s, 'utf8') > BODY_TRUNCATE_BYTES
      ? s.slice(0, BODY_TRUNCATE_BYTES) + '…'
      : s;
  return { ...row, prompt_text: truncate(row.prompt_text), response_text: truncate(row.response_text) };
}

// ─── Provenance ───

export function insertProvenance(entry: DbProvenance): void {
  getDb()
    .prepare(
      `INSERT INTO provenance (id, entity_id, entity_kind, agent_id, agent_type, run_id, created_at)
       VALUES (@id, @entity_id, @entity_kind, @agent_id, @agent_type, @run_id, @created_at)`
    )
    .run(entry as unknown as Record<string, SQLInputValue>);
}

export function getProvenance(id: string): DbProvenance | null {
  return (
    (getDb()
      .prepare('SELECT * FROM provenance WHERE id = ?')
      .get(id) as DbProvenance | undefined) ?? null
  );
}

export function listProvenanceForEntity(entityId: string, entityKind?: string): DbProvenance[] {
  const db = getDb();
  if (entityKind) {
    return db
      .prepare('SELECT * FROM provenance WHERE entity_id = ? AND entity_kind = ? ORDER BY created_at DESC')
      .all(entityId, entityKind) as unknown as DbProvenance[];
  }
  return db
    .prepare('SELECT * FROM provenance WHERE entity_id = ? ORDER BY created_at DESC')
    .all(entityId) as unknown as DbProvenance[];
}

export function listProvenance(opts: { agentId?: string; entityKind?: string; limit?: number } = {}): DbProvenance[] {
  const db = getDb();
  const limit = opts.limit ?? 100;
  if (opts.agentId && opts.entityKind) {
    return db
      .prepare('SELECT * FROM provenance WHERE agent_id = ? AND entity_kind = ? ORDER BY created_at DESC LIMIT ?')
      .all(opts.agentId, opts.entityKind, limit) as unknown as DbProvenance[];
  }
  if (opts.agentId) {
    return db
      .prepare('SELECT * FROM provenance WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(opts.agentId, limit) as unknown as DbProvenance[];
  }
  if (opts.entityKind) {
    return db
      .prepare('SELECT * FROM provenance WHERE entity_kind = ? ORDER BY created_at DESC LIMIT ?')
      .all(opts.entityKind, limit) as unknown as DbProvenance[];
  }
  return db
    .prepare('SELECT * FROM provenance ORDER BY created_at DESC LIMIT ?')
    .all(limit) as unknown as DbProvenance[];
}

// ─── Beta-Read Comments ───

export interface DbBetaReadComment {
  id: string;
  scene_id: string;
  anchor_text: string;
  comment_text: string;
  created_at: string;
  dismissed_at: string | null;
}

export function insertBetaReadComment(c: DbBetaReadComment): void {
  getDb()
    .prepare(
      `INSERT INTO beta_read_comments (id, scene_id, anchor_text, comment_text, created_at, dismissed_at)
       VALUES (@id, @scene_id, @anchor_text, @comment_text, @created_at, @dismissed_at)`
    )
    .run(c as unknown as Record<string, SQLInputValue>);
}

export function listBetaReadComments(sceneId: string): DbBetaReadComment[] {
  return getDb()
    .prepare(
      `SELECT * FROM beta_read_comments
        WHERE scene_id = ? AND dismissed_at IS NULL
        ORDER BY created_at ASC`
    )
    .all(sceneId) as unknown as DbBetaReadComment[];
}

export function dismissBetaReadComment(id: string): void {
  getDb()
    .prepare(`UPDATE beta_read_comments SET dismissed_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), id);
}

// ─── Manifest migration log ───

export interface DbManifestMigrationLog {
  id: string;
  manifest_path: string;
  from_version: number;
  to_version: number;
  backup_path: string;
  created_at: string;
}

export function insertManifestMigrationLog(entry: DbManifestMigrationLog): void {
  getDb()
    .prepare(
      `INSERT INTO manifest_migration_log
         (id, manifest_path, from_version, to_version, backup_path, created_at)
       VALUES
         (@id, @manifest_path, @from_version, @to_version, @backup_path, @created_at)`
    )
    .run(entry as unknown as Record<string, SQLInputValue>);
}

// ─── Budget window counters ───

/**
 * Count suggestions from a source agent created within a rolling window.
 * Used by auto-apply enforcement to check suggestion rate budgets.
 */
export function countSuggestionsInWindow(sourceAgent: string, windowMs: number): number {
  const windowStart = new Date(Date.now() - windowMs).toISOString();
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as cnt FROM suggestions WHERE source_agent = ? AND created_at >= ?`
    )
    .get(sourceAgent, windowStart) as { cnt: number };
  return row.cnt;
}

// ─── Archive ignore list (MYT-376) ───

export interface DbArchiveIgnore {
  id: string;
  entity_id: string;
  prop_key: string;
  scene_path: string;
  created_at: string;
}

export function insertArchiveIgnore(entry: DbArchiveIgnore): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO archive_ignore_list (id, entity_id, prop_key, scene_path, created_at)
       VALUES (@id, @entity_id, @prop_key, @scene_path, @created_at)`
    )
    .run(entry as unknown as Record<string, SQLInputValue>);
}

export function isArchiveIgnored(entityId: string, propKey: string, scenePath: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM archive_ignore_list WHERE entity_id = ? AND prop_key = ? AND scene_path = ? LIMIT 1`
    )
    .get(entityId, propKey, scenePath);
  return row !== undefined;
}

export function listArchiveIgnores(): DbArchiveIgnore[] {
  return getDb()
    .prepare('SELECT * FROM archive_ignore_list ORDER BY created_at DESC')
    .all() as unknown as DbArchiveIgnore[];
}

// ─── Scene notes (SKY-55) ───

export function getNoteBySceneId(sceneId: string): string {
  const row = getDb()
    .prepare('SELECT content FROM notes WHERE scene_id = ?')
    .get(sceneId) as { content: string } | undefined;
  return row?.content ?? '';
}

export function upsertNote(sceneId: string, content: string): void {
  getDb()
    .prepare(
      `INSERT INTO notes (scene_id, content, updated_at)
       VALUES (?, ?, strftime('%s', 'now'))
       ON CONFLICT(scene_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`
    )
    .run(sceneId, content);
}

/**
 * Count total tokens (in + out) from an agent in the rolling window.
 * Returns 0 when no generation_log rows exist for the agent.
 */
export function countTokensInWindow(agent: string, windowMs: number): number {
  const windowStart = new Date(Date.now() - windowMs).toISOString();
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0)), 0) as total
         FROM generation_log WHERE agent = ? AND created_at >= ?`
    )
    .get(agent, windowStart) as { total: number };
  return row.total;
}
