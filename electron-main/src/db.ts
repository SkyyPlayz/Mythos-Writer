// SQLite persistence layer — suggestions, audit log, timeline entries.
// Opens and creates the DB at <vault>/.mythos/state.db on first call.
// All operations are synchronous (node:sqlite built-in).

import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { SuggestionCategory } from './suggestionCategory.js';

// ─── Domain types ───

export type SuggestionStatus = 'proposed' | 'accepted' | 'rejected' | 'applied' | 'rolled_back';
export type SourceAgent = 'writing-assistant' | 'brainstorm' | 'archive';
export type AuditAction = 'accept' | 'apply' | 'reject' | 'rollback';
export type TimelineSource = 'explicit_marker' | 'prose';
export type { SuggestionCategory } from './suggestionCategory.js';

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
  /** SKY-908: high-level category for granular auto-apply gating.
   *  Nullable in the DB for back-compat with rows written before v18. */
  category: SuggestionCategory | null;
  // v19 — NoteProposal columns (null for pre-extraction suggestions)
  extraction_confidence?: number | null;
  source_turn_id?: string | null;
  destination_path?: string | null;
  /** JSON-serialised frontmatter Record<string, unknown> */
  frontmatter?: string | null;
  note_kind?: string | null;
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
  entity_count: number | null;
  context_chars: number | null;
  truncated: number | null;
}

export interface DbContinuityDriftLog {
  id: string;
  /** Groups all per-chapter rows from one multi-chapter check call. */
  session_id: string;
  scene_path: string;
  checked_count: number;
  mismatch_count: number;
  drift_score: number;
  mismatches_json: string | null;
  created_at: string;
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

  if (currentVersion < 13) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tags (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        color      TEXT,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name_nocase ON tags (lower(name));
      CREATE TABLE IF NOT EXISTS item_tags (
        item_id   TEXT NOT NULL,
        item_kind TEXT NOT NULL,
        tag_id    TEXT NOT NULL,
        PRIMARY KEY (item_id, item_kind, tag_id)
      );
      CREATE INDEX IF NOT EXISTS idx_item_tags_tag ON item_tags (tag_id);
      CREATE INDEX IF NOT EXISTS idx_item_tags_item ON item_tags (item_id);
    `);
    db.exec('PRAGMA user_version = 13');
  }

  if (currentVersion < 14) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS entity_index (
        id            TEXT PRIMARY KEY,
        type          TEXT NOT NULL,
        name          TEXT NOT NULL,
        aliases       TEXT,
        tags          TEXT,
        status        TEXT NOT NULL DEFAULT 'active',
        core_fields   TEXT,
        custom_fields TEXT,
        notes_text    TEXT,
        file_path     TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS entity_index_type   ON entity_index(type);
      CREATE INDEX IF NOT EXISTS entity_index_status ON entity_index(status);

      CREATE TABLE IF NOT EXISTS entity_relationships (
        id             TEXT PRIMARY KEY,
        from_entity_id TEXT NOT NULL REFERENCES entity_index(id) ON DELETE CASCADE,
        to_entity_id   TEXT NOT NULL REFERENCES entity_index(id) ON DELETE CASCADE,
        label          TEXT NOT NULL,
        created_at     TEXT NOT NULL,
        UNIQUE(from_entity_id, to_entity_id, label)
      );

      CREATE TABLE IF NOT EXISTS scene_entity_links (
        id         TEXT PRIMARY KEY,
        scene_id   TEXT NOT NULL,
        entity_id  TEXT NOT NULL REFERENCES entity_index(id) ON DELETE CASCADE,
        link_kind  TEXT NOT NULL DEFAULT 'mention',
        created_at TEXT NOT NULL,
        UNIQUE(scene_id, entity_id, link_kind)
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS entity_fts USING fts5(
        entity_id UNINDEXED,
        name,
        aliases,
        notes_text,
        custom_fields_text
      );
    `);
    db.exec('PRAGMA user_version = 14');
  }

  if (currentVersion < 15) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS writing_log (
        log_date     TEXT NOT NULL PRIMARY KEY,
        words_added  INTEGER NOT NULL DEFAULT 0
      );
    `);
    db.exec('PRAGMA user_version = 15');
  }

  if (currentVersion < 16) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS continuity_drift_log (
        id              TEXT PRIMARY KEY,
        session_id      TEXT NOT NULL,
        scene_path      TEXT NOT NULL,
        checked_count   INTEGER NOT NULL,
        mismatch_count  INTEGER NOT NULL,
        drift_score     REAL NOT NULL,
        mismatches_json TEXT,
        created_at      TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_continuity_session ON continuity_drift_log (session_id);
    `);
    db.exec('PRAGMA user_version = 16');
  }

  if (currentVersion < 17) {
    const hasGenLog = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='generation_log'"
    ).get();
    if (hasGenLog) {
      db.exec(`
        ALTER TABLE generation_log ADD COLUMN entity_count  INTEGER;
        ALTER TABLE generation_log ADD COLUMN context_chars INTEGER;
        ALTER TABLE generation_log ADD COLUMN truncated     INTEGER;
      `);
    } else {
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
          payload_digest TEXT,
          prompt_text    TEXT,
          response_text  TEXT,
          entity_count   INTEGER,
          context_chars  INTEGER,
          truncated      INTEGER
        );
      `);
    }
    db.exec('PRAGMA user_version = 17');
  }

  if (currentVersion < 18) {
    // SKY-908 — per-category auto-apply gating. Nullable so pre-v18 rows
    // continue to read; the gate coerces null → 'other' at evaluation time.
    const hasSuggestions = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='suggestions'"
    ).get();
    if (hasSuggestions) {
      db.exec(`ALTER TABLE suggestions ADD COLUMN category TEXT;`);
    }
    db.exec('PRAGMA user_version = 18');
  }

  if (currentVersion < 19) {
    db.exec(`
      ALTER TABLE suggestions ADD COLUMN extraction_confidence REAL;
      ALTER TABLE suggestions ADD COLUMN source_turn_id TEXT;
      ALTER TABLE suggestions ADD COLUMN destination_path TEXT;
      ALTER TABLE suggestions ADD COLUMN frontmatter TEXT;
      ALTER TABLE suggestions ADD COLUMN note_kind TEXT;
    `);
    db.exec('PRAGMA user_version = 19');
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
          payload_json, status, created_at, applied_at, applied_run_id, budget_exceeded, category,
          extraction_confidence, source_turn_id, destination_path, frontmatter, note_kind)
       VALUES
         (@id, @source_agent, @confidence, @rationale, @target_kind, @target_path, @target_anchor,
          @payload_json, @status, @created_at, @applied_at, @applied_run_id, @budget_exceeded, @category,
          @extraction_confidence, @source_turn_id, @destination_path, @frontmatter, @note_kind)`
    )
    .run({
      category: null,
      extraction_confidence: null,
      source_turn_id: null,
      destination_path: null,
      frontmatter: null,
      note_kind: null,
      ...s,
    } as unknown as Record<string, SQLInputValue>);
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

export function insertGenerationLog(
  entry: Omit<DbGenerationLog, 'prompt_text' | 'response_text' | 'entity_count' | 'context_chars' | 'truncated'> & {
    prompt_text?: string | null;
    response_text?: string | null;
    entity_count?: number | null;
    context_chars?: number | null;
    truncated?: boolean | null;
  }
): void {
  const { truncated, ...rest } = entry;
  getDb()
    .prepare(
      `INSERT INTO generation_log
         (id, agent, model, endpoint, request_id, tokens_in, tokens_out,
          latency_ms, error, created_at, payload_digest, prompt_text, response_text,
          entity_count, context_chars, truncated)
       VALUES
         (@id, @agent, @model, @endpoint, @request_id, @tokens_in, @tokens_out,
          @latency_ms, @error, @created_at, @payload_digest, @prompt_text, @response_text,
          @entity_count, @context_chars, @truncated)`
    )
    .run({
      prompt_text: null,
      response_text: null,
      entity_count: null,
      context_chars: null,
      truncated: truncated == null ? null : truncated ? 1 : 0,
      ...rest,
    });
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

// ─── Continuity drift log ───

export function insertContinuityDriftLog(entry: DbContinuityDriftLog): void {
  getDb()
    .prepare(
      `INSERT INTO continuity_drift_log
         (id, session_id, scene_path, checked_count, mismatch_count, drift_score, mismatches_json, created_at)
       VALUES
         (@id, @session_id, @scene_path, @checked_count, @mismatch_count, @drift_score, @mismatches_json, @created_at)`
    )
    .run(entry as unknown as Record<string, SQLInputValue>);
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

// ─── Tags (SKY-158) ───

export interface DbTag {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
}

/** Returns existing tag (case-insensitive) or creates a new one. */
export function upsertTag(name: string, color?: string | null): DbTag {
  const db = getDb();
  const trimmed = name.trim();
  const existing = db.prepare('SELECT * FROM tags WHERE lower(name) = lower(?)').get(trimmed) as DbTag | undefined;
  if (existing) return existing;
  const tag: DbTag = { id: randomUUID(), name: trimmed, color: color ?? null, created_at: new Date().toISOString() };
  db.prepare('INSERT OR IGNORE INTO tags (id, name, color, created_at) VALUES (@id, @name, @color, @created_at)').run(tag as unknown as Record<string, SQLInputValue>);
  return (db.prepare('SELECT * FROM tags WHERE lower(name) = lower(?)').get(trimmed) as unknown as DbTag) ?? tag;
}

export function getTagByName(name: string): DbTag | null {
  return (getDb().prepare('SELECT * FROM tags WHERE lower(name) = lower(?)').get(name.trim()) as DbTag | undefined) ?? null;
}

export function listTags(): DbTag[] {
  return getDb().prepare('SELECT * FROM tags ORDER BY name COLLATE NOCASE ASC').all() as unknown as DbTag[];
}

export function deleteTag(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM item_tags WHERE tag_id = ?').run(id);
  db.prepare('DELETE FROM tags WHERE id = ?').run(id);
}

export function renameTag(id: string, newName: string): DbTag {
  const db = getDb();
  db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(newName.trim(), id);
  return db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as unknown as DbTag;
}

/** Replaces the full tag set for an item in SQLite junction table. */
export function setItemTags(itemId: string, itemKind: string, tagNames: string[]): void {
  const db = getDb();
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM item_tags WHERE item_id = ? AND item_kind = ?').run(itemId, itemKind);
    for (const name of tagNames) {
      const tag = upsertTag(name);
      db.prepare('INSERT OR IGNORE INTO item_tags (item_id, item_kind, tag_id) VALUES (?, ?, ?)').run(itemId, itemKind, tag.id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getItemTags(itemId: string): string[] {
  const rows = getDb().prepare(
    'SELECT t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = ? ORDER BY t.name COLLATE NOCASE'
  ).all(itemId) as { name: string }[];
  return rows.map((r) => r.name);
}

export function getItemsForTag(tagName: string): Array<{ itemId: string; itemKind: string }> {
  const rows = getDb().prepare(
    'SELECT it.item_id, it.item_kind FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE lower(t.name) = lower(?)'
  ).all(tagName.trim()) as Array<{ item_id: string; item_kind: string }>;
  return rows.map((r) => ({ itemId: r.item_id, itemKind: r.item_kind }));
}

/** Apply/remove tags for multiple items atomically. Returns count of updated items. */
export function bulkApplyTags(
  itemIds: string[],
  itemKind: string,
  addTags: string[],
  removeTags: string[],
): number {
  const db = getDb();
  db.exec('BEGIN');
  try {
    for (const itemId of itemIds) {
      for (const name of removeTags) {
        const tag = getTagByName(name);
        if (tag) {
          db.prepare('DELETE FROM item_tags WHERE item_id = ? AND item_kind = ? AND tag_id = ?').run(itemId, itemKind, tag.id);
        }
      }
      for (const name of addTags) {
        const t = upsertTag(name);
        db.prepare('INSERT OR IGNORE INTO item_tags (item_id, item_kind, tag_id) VALUES (?, ?, ?)').run(itemId, itemKind, t.id);
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return itemIds.length;
}

// ─── Entity index (SKY-164) ───

export type EntityStatus = 'active' | 'archived' | 'deleted';

export interface DbEntityIndex {
  id: string;
  type: string;
  name: string;
  aliases: string | null;
  tags: string | null;
  status: EntityStatus;
  core_fields: string | null;
  custom_fields: string | null;
  notes_text: string | null;
  file_path: string;
  created_at: string;
  updated_at: string;
}

export function upsertEntityIndex(e: DbEntityIndex): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO entity_index
         (id, type, name, aliases, tags, status, core_fields, custom_fields,
          notes_text, file_path, created_at, updated_at)
       VALUES
         (@id, @type, @name, @aliases, @tags, @status, @core_fields, @custom_fields,
          @notes_text, @file_path, @created_at, @updated_at)`
    )
    .run(e as unknown as Record<string, SQLInputValue>);
}

export function getEntityIndex(id: string): DbEntityIndex | null {
  return (
    (getDb()
      .prepare('SELECT * FROM entity_index WHERE id = ?')
      .get(id) as DbEntityIndex | undefined) ?? null
  );
}

export function listEntityIndex(type?: string): DbEntityIndex[] {
  const db = getDb();
  if (type) {
    return db
      .prepare('SELECT * FROM entity_index WHERE type = ? ORDER BY name ASC')
      .all(type) as unknown as DbEntityIndex[];
  }
  return db.prepare('SELECT * FROM entity_index ORDER BY name ASC').all() as unknown as DbEntityIndex[];
}

export function deleteEntityIndex(id: string): void {
  getDb().prepare('DELETE FROM entity_index WHERE id = ?').run(id);
}

// ─── Entity relationships ───

export interface DbEntityRelationship {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  label: string;
  created_at: string;
}

export function insertEntityRelationship(r: DbEntityRelationship): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO entity_relationships
         (id, from_entity_id, to_entity_id, label, created_at)
       VALUES (@id, @from_entity_id, @to_entity_id, @label, @created_at)`
    )
    .run(r as unknown as Record<string, SQLInputValue>);
}

export function listEntityRelationships(fromEntityId: string): DbEntityRelationship[] {
  return getDb()
    .prepare('SELECT * FROM entity_relationships WHERE from_entity_id = ? ORDER BY created_at ASC')
    .all(fromEntityId) as unknown as DbEntityRelationship[];
}

export function deleteEntityRelationship(id: string): void {
  getDb().prepare('DELETE FROM entity_relationships WHERE id = ?').run(id);
}

// ─── Scene entity links (SKY-170) ───

export interface DbSceneEntityLink {
  id: string;
  scene_id: string;
  entity_id: string;
  link_kind: 'mention' | 'tag';
  created_at: string;
}

/** Upsert a scene→entity link. Generates a UUID for `id` when not supplied. */
export function upsertSceneEntityLink(link: Omit<DbSceneEntityLink, 'id'> & { id?: string }): void {
  const id = link.id ?? randomUUID();
  getDb()
    .prepare(
      `INSERT INTO scene_entity_links (id, scene_id, entity_id, link_kind, created_at)
       VALUES (@id, @scene_id, @entity_id, @link_kind, @created_at)
       ON CONFLICT(scene_id, entity_id, link_kind) DO UPDATE SET created_at = excluded.created_at`
    )
    .run({ id, scene_id: link.scene_id, entity_id: link.entity_id, link_kind: link.link_kind, created_at: link.created_at });
}

export function deleteSceneEntityLink(sceneId: string, entityId: string, linkKind: 'mention' | 'tag'): void {
  getDb()
    .prepare(`DELETE FROM scene_entity_links WHERE scene_id = ? AND entity_id = ? AND link_kind = ?`)
    .run(sceneId, entityId, linkKind);
}

export function listSceneEntityLinks(sceneId: string): DbSceneEntityLink[] {
  return getDb()
    .prepare(`SELECT * FROM scene_entity_links WHERE scene_id = ? ORDER BY entity_id ASC`)
    .all(sceneId) as unknown as DbSceneEntityLink[];
}

export function listLinkedSceneIds(entityId: string): DbSceneEntityLink[] {
  return getDb()
    .prepare(`SELECT * FROM scene_entity_links WHERE entity_id = ? ORDER BY scene_id ASC`)
    .all(entityId) as unknown as DbSceneEntityLink[];
}

/** Alias for upsertSceneEntityLink — backward compat for callers using the original name. */
export const insertSceneEntityLink = upsertSceneEntityLink;

/** Delete all scene_entity_links rows for a scene — backward compat with original bulk-delete signature. */
export function deleteSceneEntityLinks(sceneId: string): void {
  getDb().prepare('DELETE FROM scene_entity_links WHERE scene_id = ?').run(sceneId);
}

/** Remove mention rows for a scene whose entityIds are NOT in keepIds. */
export function deleteStaleSceneMentionLinks(sceneId: string, keepIds: string[]): void {
  if (keepIds.length === 0) {
    getDb()
      .prepare(`DELETE FROM scene_entity_links WHERE scene_id = ? AND link_kind = 'mention'`)
      .run(sceneId);
    return;
  }
  const placeholders = keepIds.map(() => '?').join(',');
  getDb()
    .prepare(
      `DELETE FROM scene_entity_links WHERE scene_id = ? AND link_kind = 'mention' AND entity_id NOT IN (${placeholders})`
    )
    .run(sceneId, ...keepIds);
}

// ─── Entity FTS ───

export function upsertEntityFts(
  entityId: string,
  name: string,
  aliases: string | null,
  notesText: string | null,
  customFieldsText: string | null
): void {
  const db = getDb();
  db.prepare('DELETE FROM entity_fts WHERE entity_id = ?').run(entityId);
  db
    .prepare(
      `INSERT INTO entity_fts (entity_id, name, aliases, notes_text, custom_fields_text)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(entityId, name, aliases ?? '', notesText ?? '', customFieldsText ?? '');
}

export function deleteEntityFts(entityId: string): void {
  getDb().prepare('DELETE FROM entity_fts WHERE entity_id = ?').run(entityId);
}

export function searchEntityFts(query: string): Array<{ entity_id: string }> {
  return getDb()
    .prepare('SELECT entity_id FROM entity_fts WHERE entity_fts MATCH ? ORDER BY rank')
    .all(query) as unknown as Array<{ entity_id: string }>;
}
