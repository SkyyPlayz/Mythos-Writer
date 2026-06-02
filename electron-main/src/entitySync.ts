// Entity index sync — keeps entity_index and entity_fts in step with the vault filesystem.
// Called from main.ts IPC handlers after each entity mutation.
// Deliberately no Electron dependency so it is fully testable in Node.

import {
  upsertEntityIndex,
  upsertEntityFts,
  deleteEntityIndex,
  deleteEntityFts,
  getDb,
  type DbEntityIndex,
} from './db.js';
import type { EntityEntry } from './ipc.js';
import { readVaultFile, parseFrontmatter } from './vault.js';

// ─── Row builders ───

export function buildEntityIndexRow(entry: EntityEntry, notesText: string): DbEntityIndex {
  return {
    id: entry.id,
    type: entry.type,
    name: entry.name,
    aliases: entry.aliases?.length ? JSON.stringify(entry.aliases) : null,
    tags: entry.tags?.length ? JSON.stringify(entry.tags) : null,
    status: 'active',
    core_fields: null,
    custom_fields:
      entry.properties && Object.keys(entry.properties).length > 0
        ? JSON.stringify(entry.properties)
        : null,
    notes_text: notesText.trim() || null,
    file_path: entry.path,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  };
}

function buildCustomFieldsText(entry: EntityEntry): string | null {
  if (!entry.properties || Object.keys(entry.properties).length === 0) return null;
  return Object.entries(entry.properties)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n');
}

// ─── Sync operations ───

/** Upsert entity_index + entity_fts. Used for CREATE and UPDATE. */
export function syncEntityToIndex(entry: EntityEntry, notesText: string): void {
  upsertEntityIndex(buildEntityIndexRow(entry, notesText));
  upsertEntityFts(
    entry.id,
    entry.name,
    entry.aliases?.join(' ') ?? null,
    notesText.trim() || null,
    buildCustomFieldsText(entry),
  );
}

/** Remove entity from entity_fts and entity_index. Used for DELETE.
 *  FTS5 virtual tables don't participate in FK cascades, so we delete explicitly. */
export function removeEntityFromIndex(id: string): void {
  deleteEntityFts(id);
  deleteEntityIndex(id);
}

/** Read vault-relative prose string for an entity file. */
export function readEntityProse(vaultRoot: string, relPath: string): string {
  try {
    const { content } = readVaultFile(vaultRoot, relPath);
    return parseFrontmatter(content).prose;
  } catch {
    return '';
  }
}

/** Rebuild entity_index and entity_fts from the given entry list (VAULT_REINDEX path).
 *  Upserts all disk entries and removes any DB rows whose IDs are no longer on disk. */
export function syncAllEntitiesToIndex(vaultRoot: string, entries: EntityEntry[]): void {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM entity_index').all() as { id: string }[];
  const diskIds = new Set(entries.map((e) => e.id));

  // Remove stale rows
  for (const row of existing) {
    if (!diskIds.has(row.id)) {
      deleteEntityFts(row.id);
      deleteEntityIndex(row.id);
    }
  }

  // Upsert every entity currently on disk
  for (const entry of entries) {
    const prose = readEntityProse(vaultRoot, entry.path);
    syncEntityToIndex(entry, prose);
  }
}
