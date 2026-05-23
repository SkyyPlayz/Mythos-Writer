// SQLite persistence layer — suggestions, audit log, timeline entries.
// Opens and creates the DB at <vault>/.mythos/state.db on first call.
// All operations are synchronous (better-sqlite3).

import Database from 'better-sqlite3';
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

let _db: Database.Database | null = null;
let _dbPath: string | null = null;

// ─── Lifecycle ───

export function openDb(vaultRoot: string): Database.Database {
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

  _db = new Database(dbPath);
  _dbPath = dbPath;
  _db.pragma('journal_mode = WAL');
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

export function getDb(): Database.Database {
  if (!_db) throw new Error('DB not open — call openDb() first');
  return _db;
}

// ─── Migrations ───
// Uses SQLite PRAGMA user_version to track schema version.
// Each entry runs exactly once; new entries are appended for future versions.

function runMigrations(db: Database.Database): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number;

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
    db.pragma('user_version = 1');
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
    db.pragma('user_version = 2');
  }

  if (currentVersion < 3) {
    db.exec(`ALTER TABLE suggestions ADD COLUMN target_kind TEXT;`);
    db.pragma('user_version = 3');
  }

  if (currentVersion < 4) {
    db.exec(`ALTER TABLE suggestions ADD COLUMN budget_exceeded INTEGER NOT NULL DEFAULT 0;`);
    db.pragma('user_version = 4');
  }

  if (currentVersion < 5) {
    db.exec(`
      ALTER TABLE generation_log ADD COLUMN prompt_text TEXT;
      ALTER TABLE generation_log ADD COLUMN response_text TEXT;
    `);
    db.pragma('user_version = 5');
  }
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
    .run(s);
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
      .all(status, sourceAgent) as DbSuggestion[];
  }
  if (status) {
    return db
      .prepare('SELECT * FROM suggestions WHERE status = ? ORDER BY created_at DESC')
      .all(status) as DbSuggestion[];
  }
  if (sourceAgent) {
    return db
      .prepare('SELECT * FROM suggestions WHERE source_agent = ? ORDER BY created_at DESC')
      .all(sourceAgent) as DbSuggestion[];
  }
  return db.prepare('SELECT * FROM suggestions ORDER BY created_at DESC').all() as DbSuggestion[];
}

// ─── Audit log ───

export function insertAuditLog(entry: DbAuditLog): void {
  getDb()
    .prepare(
      `INSERT INTO audit_log (id, suggestion_id, action, snapshot_path, actor, created_at)
       VALUES (@id, @suggestion_id, @action, @snapshot_path, @actor, @created_at)`
    )
    .run(entry);
}

export function listAuditLog(suggestionId?: string): DbAuditLog[] {
  const db = getDb();
  if (suggestionId) {
    return db
      .prepare('SELECT * FROM audit_log WHERE suggestion_id = ? ORDER BY created_at DESC')
      .all(suggestionId) as DbAuditLog[];
  }
  return db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC').all() as DbAuditLog[];
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
    .run(entry);
}

export function listTimelineEntries(scenePath?: string): DbTimelineEntry[] {
  const db = getDb();
  if (scenePath) {
    return db
      .prepare('SELECT * FROM timeline_entries WHERE scene_path = ? ORDER BY inferred_time ASC')
      .all(scenePath) as DbTimelineEntry[];
  }
  return db.prepare('SELECT * FROM timeline_entries ORDER BY inferred_time ASC').all() as DbTimelineEntry[];
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

export function listGenerationLog(opts: { limit?: number; offset?: number; agent?: string } = {}): DbGenerationLog[] {
  const db = getDb();
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;
  if (opts.agent) {
    return db
      .prepare('SELECT * FROM generation_log WHERE agent = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(opts.agent, limit, offset) as DbGenerationLog[];
  }
  return db
    .prepare('SELECT * FROM generation_log ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as DbGenerationLog[];
}

export function countGenerationLog(agent?: string): number {
  const db = getDb();
  if (agent) {
    const row = db.prepare('SELECT COUNT(*) as cnt FROM generation_log WHERE agent = ?').get(agent) as { cnt: number };
    return row.cnt;
  }
  const row = db.prepare('SELECT COUNT(*) as cnt FROM generation_log').get() as { cnt: number };
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
