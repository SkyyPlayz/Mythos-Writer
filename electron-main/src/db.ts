// SQLite persistence layer — suggestions, audit log, timeline entries.
// Opens and creates the DB at <vault>/.mythos/state.db on first call.
// All operations are synchronous (node:sqlite built-in).

import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { SuggestionCategory } from './suggestionCategory.js';
export type { SuggestionStatus } from './shared/types/suggestion.js';
import type { SuggestionStatus } from './shared/types/suggestion.js';

// ─── Domain types ───
export type SourceAgent = 'writing-assistant' | 'brainstorm' | 'archive';
export type AuditAction = 'accept' | 'apply' | 'reject' | 'rollback' | 'ignore';
export type UnifiedSuggestionKind = 'suggestion' | 'continuity-issue' | 'wiki-link';
export type UnifiedSuggestionStatus = 'proposed' | 'accepted' | 'applied' | 'rejected' | 'ignored' | 'rolled_back';

export interface UnifiedSuggestion {
  id: string;
  kind: UnifiedSuggestionKind;
  sourceAgent: string;
  confidence: number;
  rationale: string;
  targetPath: string | null;
  targetAnchor: string | null;
  status: UnifiedSuggestionStatus;
  createdAt: string;
  appliedAt: string | null;
  budgetExceeded: boolean;
  category: string | null;
  payloadJson: string | null;
}

export interface UnifiedSuggestionFilters {
  status?: UnifiedSuggestionStatus;
  sourceAgent?: string;
  kind?: UnifiedSuggestionKind;
  confidenceMin?: number;
  confidenceMax?: number;
  limit?: number;
  offset?: number;
}

export interface UnifiedSuggestionResult {
  items: UnifiedSuggestion[];
  totalCount: number;
  countByAgent: Record<string, number>;
  countByKind: Record<string, number>;
}
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

export type WikiLinkStatus = 'proposed' | 'accepted' | 'rejected';

export interface DbWikiLinkSuggestion {
  id: string;
  scene_id: string;
  position: number;
  /** Exact matched text in scene at suggestion time (for accept replace). */
  anchor_text: string;
  entity_name: string;
  entity_id: string;
  proposed_link: string;
  confidence: number;
  status: WikiLinkStatus;
  /** SHA-256 of scene text at rejection time — used to lift suppression when text changes. */
  scene_text_hash: string | null;
  created_at: string;
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
    const hasSuggestions19 = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='suggestions'"
    ).get();
    if (hasSuggestions19) {
      db.exec(`
        ALTER TABLE suggestions ADD COLUMN extraction_confidence REAL;
        ALTER TABLE suggestions ADD COLUMN source_turn_id TEXT;
        ALTER TABLE suggestions ADD COLUMN destination_path TEXT;
        ALTER TABLE suggestions ADD COLUMN frontmatter TEXT;
        ALTER TABLE suggestions ADD COLUMN note_kind TEXT;
      `);
    }
    db.exec('PRAGMA user_version = 19');
  }

  if (currentVersion < 20) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS proposal_telemetry (
        id                   TEXT PRIMARY KEY,
        proposal_id          TEXT NOT NULL,
        kind                 TEXT NOT NULL,
        extraction_confidence REAL NOT NULL,
        decision             TEXT NOT NULL,
        time_to_decide_ms    INTEGER NOT NULL,
        created_at           TEXT NOT NULL
      );
    `);
    db.exec('PRAGMA user_version = 20');
  }

  if (currentVersion < 21) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS wiki_link_suggestions (
        id              TEXT PRIMARY KEY,
        scene_id        TEXT NOT NULL,
        position        INTEGER NOT NULL,
        anchor_text     TEXT NOT NULL,
        entity_name     TEXT NOT NULL,
        entity_id       TEXT NOT NULL,
        proposed_link   TEXT NOT NULL,
        confidence      REAL NOT NULL,
        status          TEXT NOT NULL DEFAULT 'proposed',
        scene_text_hash TEXT,
        created_at      TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_wiki_link_scene ON wiki_link_suggestions (scene_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_wiki_link_scene_entity
        ON wiki_link_suggestions (scene_id, entity_id);
    `);
    db.exec('PRAGMA user_version = 21');
  }

  if (currentVersion < 22) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS scene_snapshots (
        id         TEXT NOT NULL PRIMARY KEY,
        scene_id   TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        label      TEXT,
        content    TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_scene_snapshots_scene ON scene_snapshots (scene_id, created_at DESC);
    `);
    db.exec('PRAGMA user_version = 22');
  }

  if (currentVersion < 23) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS continuity_issues (
        id                       TEXT PRIMARY KEY,
        category                 TEXT NOT NULL,
        severity                 TEXT NOT NULL,
        manuscript_scene_id      TEXT NOT NULL,
        manuscript_offset        INTEGER NOT NULL,
        manuscript_excerpt       TEXT NOT NULL,
        vault_note_path          TEXT NOT NULL,
        vault_line               INTEGER NOT NULL,
        vault_excerpt            TEXT NOT NULL,
        rationale                TEXT NOT NULL,
        proposed_match_archive   TEXT NOT NULL,
        proposed_suggest_story   TEXT NOT NULL,
        status                   TEXT NOT NULL DEFAULT 'open',
        resolved_at              TEXT,
        resolved_action          TEXT,
        created_at               TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_continuity_issues_status ON continuity_issues (status);
      CREATE INDEX IF NOT EXISTS idx_continuity_issues_scene ON continuity_issues (manuscript_scene_id);

      CREATE TABLE IF NOT EXISTS archive_audit_log (
        id           TEXT PRIMARY KEY,
        action       TEXT NOT NULL,
        source       TEXT NOT NULL DEFAULT 'archive_agent',
        item_id      TEXT NOT NULL,
        target_path  TEXT,
        changed_from TEXT,
        changed_to   TEXT,
        scene_id     TEXT,
        reason       TEXT,
        created_at   TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_archive_audit_item ON archive_audit_log (item_id);
    `);
    db.exec('PRAGMA user_version = 23');
  }

  if (currentVersion < 24) {
    // SKY-1745: Archive Agent query perf audit + index pass.
    // Eliminates filesorts on the three hot read paths:
    //  1. ContinuityPanel list (status filter + recency sort)
    //  2. reSurfaceIgnoredItems (scene + status filter)
    //  3. archive_audit_log per-item fetch
    // Also covers suggestion budget-window counters and status-filtered list.
    // Guards match v17 pattern — tables may be absent on artificial test DBs seeded at an
    // intermediate version that skipped early migrations.
    const hasContinuity24 = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='continuity_issues'"
    ).get();
    if (hasContinuity24) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_ci_status_created
          ON continuity_issues (status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_ci_scene_status
          ON continuity_issues (manuscript_scene_id, status, created_at DESC);
      `);
    }
    const hasArchiveAudit24 = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='archive_audit_log'"
    ).get();
    if (hasArchiveAudit24) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_archive_audit_item_created
          ON archive_audit_log (item_id, created_at DESC);
      `);
    }
    const hasSuggestions24 = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='suggestions'"
    ).get();
    if (hasSuggestions24) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_suggestions_agent_created
          ON suggestions (source_agent, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_suggestions_status_created
          ON suggestions (status, created_at DESC);
      `);
    }
    db.exec('PRAGMA user_version = 24');
  }

  if (currentVersion < 25) {
    // SKY-2455: FTS5 virtual table for keyword search across suggestions.
    // suggestions_fts_sync tracks which suggestions are in the FTS index so
    // upsertSuggestion can delete+reinsert atomically on every write.
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS suggestions_fts USING fts5(
        suggestion_id UNINDEXED,
        rationale,
        target_path,
        tokenize = 'porter ascii'
      );
      CREATE TABLE IF NOT EXISTS suggestions_fts_sync (
        suggestion_id TEXT PRIMARY KEY,
        synced_at     TEXT NOT NULL
      );
    `);
    // Back-fill existing suggestions into the FTS index.
    const hasSuggestions25 = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='suggestions'"
    ).get();
    if (hasSuggestions25) {
      const rows = db.prepare('SELECT id, rationale, target_path FROM suggestions').all() as Array<{
        id: string;
        rationale: string;
        target_path: string | null;
      }>;
      const insertFts = db.prepare(
        'INSERT INTO suggestions_fts(suggestion_id, rationale, target_path) VALUES (?, ?, ?)'
      );
      const insertSync = db.prepare(
        'INSERT OR REPLACE INTO suggestions_fts_sync(suggestion_id, synced_at) VALUES (?, ?)'
      );
      const now = new Date().toISOString();
      for (const row of rows) {
        insertFts.run(row.id, row.rationale, row.target_path ?? '');
        insertSync.run(row.id, now);
      }
    }
    db.exec('PRAGMA user_version = 25');
  }

  if (currentVersion < 26) {
    // SKY-2475/SKY-2472: Suggestion snapshots table — stores pre-apply state so
    // suggestions can be rolled back. Two kinds:
    //   'file'     — vault file content captured before a vault-write apply
    //   'manifest' — full manifest JSON captured before a structural (typed-relation) apply
    // The snapshot is referenced by suggestion_id and looked up during rollback when
    // the file-based snapshot path is absent (typed-relation path).
    db.exec(`
      CREATE TABLE IF NOT EXISTS suggestion_snapshots (
        id             TEXT PRIMARY KEY,
        suggestion_id  TEXT NOT NULL,
        snapshot_kind  TEXT NOT NULL DEFAULT 'file',
        payload_json   TEXT NOT NULL,
        created_at     TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_suggestion_snapshots_sug
        ON suggestion_snapshots (suggestion_id);
    `);
    db.exec('PRAGMA user_version = 26');
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
  const db = getDb();
  db
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
      extraction_confidence: null,
      source_turn_id: null,
      destination_path: null,
      frontmatter: null,
      note_kind: null,
      ...s,
    } as unknown as Record<string, SQLInputValue>);

  // Keep FTS index in sync (delete + reinsert atomically).
  const ftsSyncExists = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='suggestions_fts'"
  ).get();
  if (ftsSyncExists) {
    db.prepare('DELETE FROM suggestions_fts WHERE suggestion_id = ?').run(s.id);
    db.prepare(
      'INSERT INTO suggestions_fts(suggestion_id, rationale, target_path) VALUES (?, ?, ?)'
    ).run(s.id, s.rationale, s.target_path ?? '');
    db.prepare(
      'INSERT OR REPLACE INTO suggestions_fts_sync(suggestion_id, synced_at) VALUES (?, ?)'
    ).run(s.id, new Date().toISOString());
  }
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

/** Extended list with confidence range + pagination. */
export interface SuggestionsFilterOptions {
  status?: SuggestionStatus;
  sourceAgent?: string;
  confidenceMin?: number;
  confidenceMax?: number;
  limit?: number;
  offset?: number;
}

export function listSuggestionsFiltered(opts: SuggestionsFilterOptions): DbSuggestion[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: SQLInputValue[] = [];

  if (opts.status !== undefined) {
    clauses.push('status = ?');
    params.push(opts.status);
  }
  if (opts.sourceAgent !== undefined) {
    clauses.push('source_agent = ?');
    params.push(opts.sourceAgent);
  }
  if (opts.confidenceMin !== undefined) {
    clauses.push('confidence >= ?');
    params.push(opts.confidenceMin);
  }
  if (opts.confidenceMax !== undefined) {
    clauses.push('confidence <= ?');
    params.push(opts.confidenceMax);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(opts.limit ?? 200, 1000);
  const offset = opts.offset ?? 0;

  return db
    .prepare(`SELECT * FROM suggestions ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as unknown as DbSuggestion[];
}

/** FTS5 full-text search across rationale + target_path. */
export function searchSuggestionsFts(
  query: string,
  opts: { sourceAgent?: string; status?: SuggestionStatus; confidenceMin?: number; confidenceMax?: number; limit?: number }
): { suggestions: DbSuggestion[]; totalCount: number } {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 50, 1000);

  // Collect suggestion_ids from FTS, preserving relevance order.
  const ftsRows = db
    .prepare(
      `SELECT suggestion_id FROM suggestions_fts WHERE suggestions_fts MATCH ? ORDER BY rank LIMIT 1000`
    )
    .all(query) as Array<{ suggestion_id: string }>;

  if (ftsRows.length === 0) return { suggestions: [], totalCount: 0 };

  // Fetch matching rows from suggestions table with optional extra filters.
  const placeholders = ftsRows.map(() => '?').join(',');
  const ids = ftsRows.map((r) => r.suggestion_id);

  const clauses: string[] = [`id IN (${placeholders})`];
  const params: SQLInputValue[] = [...ids];

  if (opts.sourceAgent !== undefined) {
    clauses.push('source_agent = ?');
    params.push(opts.sourceAgent);
  }
  if (opts.status !== undefined) {
    clauses.push('status = ?');
    params.push(opts.status);
  }
  if (opts.confidenceMin !== undefined) {
    clauses.push('confidence >= ?');
    params.push(opts.confidenceMin);
  }
  if (opts.confidenceMax !== undefined) {
    clauses.push('confidence <= ?');
    params.push(opts.confidenceMax);
  }

  const where = `WHERE ${clauses.join(' AND ')}`;
  const allMatching = db
    .prepare(`SELECT * FROM suggestions ${where}`)
    .all(...params) as unknown as DbSuggestion[];

  // Re-sort by FTS rank (order of ftsRows), then apply limit.
  const idOrder = new Map(ftsRows.map((r, i) => [r.suggestion_id, i]));
  allMatching.sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));

  return { suggestions: allMatching.slice(0, limit), totalCount: allMatching.length };
}

/** UNION list across suggestions + continuity_issues + wiki_link_suggestions. */
export function listUnifiedSuggestions(opts: UnifiedSuggestionFilters): UnifiedSuggestionResult {
  const db = getDb();

  // Build the UNION CTE with status normalization.
  const unionSql = `
    WITH unified AS (
      SELECT
        id,
        'suggestion'    AS kind,
        source_agent,
        confidence,
        rationale,
        target_path,
        target_anchor,
        CASE status
          WHEN 'proposed'    THEN 'proposed'
          WHEN 'accepted'    THEN 'accepted'
          WHEN 'applied'     THEN 'applied'
          WHEN 'rejected'    THEN 'rejected'
          WHEN 'ignored'     THEN 'ignored'
          WHEN 'rolled_back' THEN 'rolled_back'
          ELSE status
        END AS unified_status,
        created_at,
        applied_at,
        budget_exceeded,
        category,
        payload_json
      FROM suggestions

      UNION ALL

      SELECT
        id,
        'continuity-issue' AS kind,
        'archive'          AS source_agent,
        CASE severity
          WHEN 'critical' THEN 1.0
          WHEN 'high'     THEN 0.75
          WHEN 'medium'   THEN 0.5
          WHEN 'low'      THEN 0.25
          ELSE 0.5
        END AS confidence,
        rationale,
        vault_note_path    AS target_path,
        manuscript_excerpt AS target_anchor,
        CASE status
          WHEN 'open'     THEN 'proposed'
          WHEN 'resolved' THEN 'accepted'
          WHEN 'ignored'  THEN 'ignored'
          ELSE 'proposed'
        END AS unified_status,
        created_at,
        resolved_at AS applied_at,
        0           AS budget_exceeded,
        severity    AS category,
        NULL        AS payload_json
      FROM continuity_issues

      UNION ALL

      SELECT
        id,
        'wiki-link' AS kind,
        'archive'   AS source_agent,
        confidence,
        (entity_name || ' → ' || proposed_link) AS rationale,
        scene_id    AS target_path,
        anchor_text AS target_anchor,
        CASE status
          WHEN 'proposed'  THEN 'proposed'
          WHEN 'accepted'  THEN 'accepted'
          WHEN 'rejected'  THEN 'rejected'
          ELSE 'proposed'
        END AS unified_status,
        created_at,
        NULL AS applied_at,
        0    AS budget_exceeded,
        NULL AS category,
        NULL AS payload_json
      FROM wiki_link_suggestions
    )
  `;

  const filterClauses: string[] = [];
  const filterParams: SQLInputValue[] = [];

  if (opts.status !== undefined) {
    filterClauses.push('unified_status = ?');
    filterParams.push(opts.status);
  }
  if (opts.sourceAgent !== undefined) {
    filterClauses.push('source_agent = ?');
    filterParams.push(opts.sourceAgent);
  }
  if (opts.kind !== undefined) {
    filterClauses.push('kind = ?');
    filterParams.push(opts.kind);
  }
  if (opts.confidenceMin !== undefined) {
    filterClauses.push('confidence >= ?');
    filterParams.push(opts.confidenceMin);
  }
  if (opts.confidenceMax !== undefined) {
    filterClauses.push('confidence <= ?');
    filterParams.push(opts.confidenceMax);
  }

  const filterWhere = filterClauses.length > 0 ? `WHERE ${filterClauses.join(' AND ')}` : '';
  const limit = Math.min(opts.limit ?? 200, 1000);
  const offset = opts.offset ?? 0;

  // Count query — totals + breakdowns (no limit/offset).
  const countRows = db
    .prepare(`${unionSql} SELECT kind, source_agent FROM unified ${filterWhere}`)
    .all(...filterParams) as Array<{ kind: string; source_agent: string }>;

  const totalCount = countRows.length;
  const countByAgent: Record<string, number> = {};
  const countByKind: Record<string, number> = {};
  for (const row of countRows) {
    countByAgent[row.source_agent] = (countByAgent[row.source_agent] ?? 0) + 1;
    countByKind[row.kind] = (countByKind[row.kind] ?? 0) + 1;
  }

  // Data query — paginated.
  const rawRows = db
    .prepare(
      `${unionSql} SELECT * FROM unified ${filterWhere} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...filterParams, limit, offset) as Array<{
      id: string;
      kind: string;
      source_agent: string;
      confidence: number;
      rationale: string;
      target_path: string | null;
      target_anchor: string | null;
      unified_status: string;
      created_at: string;
      applied_at: string | null;
      budget_exceeded: number;
      category: string | null;
      payload_json: string | null;
    }>;

  const items: UnifiedSuggestion[] = rawRows.map((r) => ({
    id: r.id,
    kind: r.kind as UnifiedSuggestionKind,
    sourceAgent: r.source_agent,
    confidence: r.confidence,
    rationale: r.rationale,
    targetPath: r.target_path,
    targetAnchor: r.target_anchor,
    status: r.unified_status as UnifiedSuggestionStatus,
    createdAt: r.created_at,
    appliedAt: r.applied_at,
    budgetExceeded: r.budget_exceeded === 1,
    category: r.category,
    payloadJson: r.payload_json,
  }));

  return { items, totalCount, countByAgent, countByKind };
}

// ─── Suggestion snapshots (SKY-2475/SKY-2472) ───

export type SuggestionSnapshotKind = 'file' | 'manifest';

export interface DbSuggestionSnapshot {
  id: string;
  suggestion_id: string;
  snapshot_kind: SuggestionSnapshotKind;
  /** JSON-serialized snapshot payload.
   *  kind='file': { path: string, originalContent: string }
   *  kind='manifest': serialized vault Manifest object */
  payload_json: string;
  created_at: string;
}

export function insertSuggestionSnapshot(snap: DbSuggestionSnapshot): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO suggestion_snapshots
         (id, suggestion_id, snapshot_kind, payload_json, created_at)
       VALUES (@id, @suggestion_id, @snapshot_kind, @payload_json, @created_at)`
    )
    .run(snap as unknown as Record<string, import('node:sqlite').SQLInputValue>);
}

export function getSuggestionSnapshot(
  suggestionId: string,
  kind?: SuggestionSnapshotKind,
): DbSuggestionSnapshot | null {
  const db = getDb();
  if (kind !== undefined) {
    return (
      (db
        .prepare(
          'SELECT * FROM suggestion_snapshots WHERE suggestion_id = ? AND snapshot_kind = ? ORDER BY created_at DESC LIMIT 1',
        )
        .get(suggestionId, kind) as DbSuggestionSnapshot | undefined) ?? null
    );
  }
  return (
    (db
      .prepare(
        'SELECT * FROM suggestion_snapshots WHERE suggestion_id = ? ORDER BY created_at DESC LIMIT 1',
      )
      .get(suggestionId) as DbSuggestionSnapshot | undefined) ?? null
  );
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

// ─── Proposal telemetry (SKY-1483 v13) ───

export type ProposalDecision = 'confirm' | 'edit_and_confirm' | 'reject';

export interface DbProposalTelemetry {
  id: string;
  proposal_id: string;
  kind: string;
  extraction_confidence: number;
  decision: ProposalDecision;
  time_to_decide_ms: number;
  created_at: string;
}

export function insertProposalTelemetry(entry: DbProposalTelemetry): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO proposal_telemetry
         (id, proposal_id, kind, extraction_confidence, decision, time_to_decide_ms, created_at)
       VALUES
         (@id, @proposal_id, @kind, @extraction_confidence, @decision, @time_to_decide_ms, @created_at)`
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

// ─── Wiki-link suggestions (SKY-1613) ───

export function upsertWikiLinkSuggestion(s: DbWikiLinkSuggestion): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO wiki_link_suggestions
         (id, scene_id, position, anchor_text, entity_name, entity_id,
          proposed_link, confidence, status, scene_text_hash, created_at)
       VALUES
         (@id, @scene_id, @position, @anchor_text, @entity_name, @entity_id,
          @proposed_link, @confidence, @status, @scene_text_hash, @created_at)`
    )
    .run(s as unknown as Record<string, SQLInputValue>);
}

export function getWikiLinkSuggestion(id: string): DbWikiLinkSuggestion | null {
  return (getDb()
    .prepare('SELECT * FROM wiki_link_suggestions WHERE id = ?')
    .get(id) as DbWikiLinkSuggestion | undefined) ?? null;
}

export function listWikiLinkSuggestionsForScene(sceneId: string): DbWikiLinkSuggestion[] {
  return getDb()
    .prepare('SELECT * FROM wiki_link_suggestions WHERE scene_id = ? ORDER BY position ASC')
    .all(sceneId) as unknown as DbWikiLinkSuggestion[];
}

export function updateWikiLinkSuggestionStatus(
  id: string,
  status: WikiLinkStatus,
  sceneTextHash?: string | null,
): void {
  getDb()
    .prepare(
      `UPDATE wiki_link_suggestions SET status = ?, scene_text_hash = ? WHERE id = ?`
    )
    .run(status, sceneTextHash ?? null, id);
}

/** Returns (entityId, sceneTextHash) for all rejected entries in this scene. */
export function listRejectedWikiLinks(
  sceneId: string,
): Array<{ entity_id: string; scene_text_hash: string | null }> {
  return getDb()
    .prepare(
      `SELECT entity_id, scene_text_hash FROM wiki_link_suggestions
       WHERE scene_id = ? AND status = 'rejected'`
    )
    .all(sceneId) as unknown as Array<{ entity_id: string; scene_text_hash: string | null }>;
}

/** Clear rejection (revert to proposed) when scene text has changed. */
export function clearWikiLinkRejection(sceneId: string, entityId: string): void {
  getDb()
    .prepare(
      `UPDATE wiki_link_suggestions SET status = 'proposed', scene_text_hash = NULL
       WHERE scene_id = ? AND entity_id = ? AND status = 'rejected'`
    )
    .run(sceneId, entityId);
}

// ─── Scene draft snapshots (SKY-1611) ───

export interface DbSceneSnapshot {
  id: string;
  scene_id: string;
  created_at: number;
  label: string | null;
  content: string;
}

const DRAFT_SNAPSHOTS_MAX = 50;

export function createDraftSnapshot(sceneId: string, content: string, label?: string): DbSceneSnapshot {
  const db = getDb();
  const id = randomUUID();
  const created_at = Date.now();
  const row: DbSceneSnapshot = { id, scene_id: sceneId, created_at, label: label ?? null, content };
  db
    .prepare(
      `INSERT INTO scene_snapshots (id, scene_id, created_at, label, content)
       VALUES (@id, @scene_id, @created_at, @label, @content)`
    )
    .run(row as unknown as Record<string, SQLInputValue>);
  const countRow = db
    .prepare('SELECT COUNT(*) as cnt FROM scene_snapshots WHERE scene_id = ?')
    .get(sceneId) as { cnt: number };
  if (countRow.cnt > DRAFT_SNAPSHOTS_MAX) {
    db
      .prepare(
        `DELETE FROM scene_snapshots WHERE scene_id = ? AND rowid NOT IN (
           SELECT rowid FROM scene_snapshots WHERE scene_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?
         )`
      )
      .run(sceneId, sceneId, DRAFT_SNAPSHOTS_MAX);
  }
  return row;
}

export function listDraftSnapshots(sceneId: string): Omit<DbSceneSnapshot, 'content'>[] {
  return getDb()
    .prepare(
      'SELECT id, scene_id, created_at, label FROM scene_snapshots WHERE scene_id = ? ORDER BY created_at DESC, rowid DESC'
    )
    .all(sceneId) as unknown as Omit<DbSceneSnapshot, 'content'>[];
}

export function getDraftSnapshotContent(snapshotId: string): string | null {
  const row = getDb()
    .prepare('SELECT content FROM scene_snapshots WHERE id = ?')
    .get(snapshotId) as { content: string } | undefined;
  return row?.content ?? null;
}

export function updateDraftSnapshotLabel(snapshotId: string, label: string): void {
  getDb().prepare('UPDATE scene_snapshots SET label = ? WHERE id = ?').run(label, snapshotId);
}

export function deleteDraftSnapshot(snapshotId: string): void {
  getDb().prepare('DELETE FROM scene_snapshots WHERE id = ?').run(snapshotId);
}

// ─── Continuity Issues (SKY-1683 / Archive Agent v1) ───

export type ContinuityCategory =
  | 'character_attribute_drift'
  | 'location_attribute_mismatch'
  | 'factual_contradiction';

export type ContinuitySeverity = 'critical' | 'high' | 'medium' | 'low';
export type ContinuityIssueStatus = 'open' | 'resolved' | 'ignored';

export interface DbContinuityIssue {
  id: string;
  category: ContinuityCategory;
  severity: ContinuitySeverity;
  manuscript_scene_id: string;
  manuscript_offset: number;
  manuscript_excerpt: string;
  vault_note_path: string;
  vault_line: number;
  vault_excerpt: string;
  rationale: string;
  proposed_match_archive: string;
  proposed_suggest_story: string;
  status: ContinuityIssueStatus;
  resolved_at: string | null;
  resolved_action: string | null;
  created_at: string;
}

export function insertContinuityIssue(issue: DbContinuityIssue): void {
  getDb()
    .prepare(
      `INSERT INTO continuity_issues
         (id, category, severity, manuscript_scene_id, manuscript_offset, manuscript_excerpt,
          vault_note_path, vault_line, vault_excerpt, rationale, proposed_match_archive,
          proposed_suggest_story, status, resolved_at, resolved_action, created_at)
       VALUES
         (@id, @category, @severity, @manuscript_scene_id, @manuscript_offset, @manuscript_excerpt,
          @vault_note_path, @vault_line, @vault_excerpt, @rationale, @proposed_match_archive,
          @proposed_suggest_story, @status, @resolved_at, @resolved_action, @created_at)`
    )
    .run(issue as unknown as Record<string, SQLInputValue>);
}

export function listContinuityIssues(status?: ContinuityIssueStatus): DbContinuityIssue[] {
  if (status) {
    return getDb()
      .prepare('SELECT * FROM continuity_issues WHERE status = ? ORDER BY created_at DESC')
      .all(status) as unknown as DbContinuityIssue[];
  }
  return getDb()
    .prepare('SELECT * FROM continuity_issues ORDER BY created_at DESC')
    .all() as unknown as DbContinuityIssue[];
}

/** Scene-scoped fetch — hits idx_ci_scene_status covering index. */
export function listContinuityIssuesByScene(
  sceneId: string,
  status?: ContinuityIssueStatus,
): DbContinuityIssue[] {
  if (status) {
    return getDb()
      .prepare(
        'SELECT * FROM continuity_issues WHERE manuscript_scene_id = ? AND status = ? ORDER BY created_at DESC'
      )
      .all(sceneId, status) as unknown as DbContinuityIssue[];
  }
  return getDb()
    .prepare(
      'SELECT * FROM continuity_issues WHERE manuscript_scene_id = ? ORDER BY created_at DESC'
    )
    .all(sceneId) as unknown as DbContinuityIssue[];
}

export function getContinuityIssue(id: string): DbContinuityIssue | null {
  return (
    (getDb()
      .prepare('SELECT * FROM continuity_issues WHERE id = ?')
      .get(id) as DbContinuityIssue | undefined) ?? null
  );
}

export function updateContinuityIssueStatus(
  id: string,
  status: ContinuityIssueStatus,
  resolvedAt?: string,
  resolvedAction?: string,
): void {
  getDb()
    .prepare(
      `UPDATE continuity_issues
          SET status = @status, resolved_at = @resolved_at, resolved_action = @resolved_action
        WHERE id = @id`
    )
    .run({
      id,
      status,
      resolved_at: resolvedAt ?? null,
      resolved_action: resolvedAction ?? null,
    });
}

export function deleteContinuityIssue(id: string): void {
  getDb().prepare('DELETE FROM continuity_issues WHERE id = ?').run(id);
}

// ─── Archive Audit Log (SKY-1683 / Archive Agent v1) ───

export type ArchiveAuditAction = 'match_archive_to_story' | 'suggest_story_change' | 'ignore';

export interface DbArchiveAuditLog {
  id: string;
  action: ArchiveAuditAction;
  source: string;
  item_id: string;
  target_path: string | null;
  changed_from: string | null;
  changed_to: string | null;
  scene_id: string | null;
  reason: string | null;
  created_at: string;
}

export function insertArchiveAuditLog(entry: DbArchiveAuditLog): void {
  getDb()
    .prepare(
      `INSERT INTO archive_audit_log
         (id, action, source, item_id, target_path, changed_from, changed_to, scene_id, reason, created_at)
       VALUES
         (@id, @action, @source, @item_id, @target_path, @changed_from, @changed_to, @scene_id, @reason, @created_at)`
    )
    .run(entry as unknown as Record<string, SQLInputValue>);
}

export function listArchiveAuditLog(itemId?: string): DbArchiveAuditLog[] {
  if (itemId) {
    return getDb()
      .prepare('SELECT * FROM archive_audit_log WHERE item_id = ? ORDER BY created_at DESC')
      .all(itemId) as unknown as DbArchiveAuditLog[];
  }
  return getDb()
    .prepare('SELECT * FROM archive_audit_log ORDER BY created_at DESC')
    .all() as unknown as DbArchiveAuditLog[];
}
