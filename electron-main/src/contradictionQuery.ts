// Global contradiction query (M12.3, SKY-10770).
//
// SKY-10666 binding: extraction cost scales with scan scope, but contradiction
// DETECTION is a cheap, global DB query — it always reads the full ledger
// regardless of what was last scanned, and never re-extracts. Today the
// ledger substrate is continuity_issues (scene-anchored flags) enriched from
// vault_index_cache (the persistent entity index, M12.2); when the
// manuscript-side fact ledger lands (SKY-11035) the fact-vs-fact join plugs
// in here without touching callers.
//
// Cost envelope: single indexed SELECT (idx_continuity_issues_status) with a
// primary-key join — <500ms on a 1000-entity ledger is asserted by
// contradictionQuery.test.ts with a measured median, not eyeballed.

import { getDb } from './db.js';

export interface GlobalContradiction {
  id: string;
  category: string;
  severity: string;
  sceneId: string;
  offset: number;
  excerpt: string;
  vaultNotePath: string;
  vaultExcerpt: string;
  rationale: string;
  createdAt: string;
  /** Entity-index enrichment — null when the flagged note has no index row. */
  entityName: string | null;
  entityType: string | null;
}

interface RawRow {
  id: string;
  category: string;
  severity: string;
  manuscript_scene_id: string;
  manuscript_offset: number;
  manuscript_excerpt: string;
  vault_note_path: string;
  vault_excerpt: string;
  rationale: string;
  created_at: string;
  entity_name: string | null;
  entity_type: string | null;
}

const DEFAULT_LIMIT = 200;

/**
 * Every open contradiction across the WHOLE manuscript, most severe first.
 * Deliberately takes no scope parameter — scan scope must not narrow this.
 */
export function queryGlobalContradictions(opts?: { limit?: number }): GlobalContradiction[] {
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const rows = getDb()
    .prepare(
      `SELECT ci.id, ci.category, ci.severity, ci.manuscript_scene_id,
              ci.manuscript_offset, ci.manuscript_excerpt, ci.vault_note_path,
              ci.vault_excerpt, ci.rationale, ci.created_at,
              vic.name AS entity_name, vic.type AS entity_type
         FROM continuity_issues ci
         LEFT JOIN vault_index_cache vic ON vic.file_path = ci.vault_note_path
        WHERE ci.status = 'open' AND ci.category = 'factual_contradiction'
        ORDER BY CASE ci.severity
                   WHEN 'critical' THEN 0
                   WHEN 'high' THEN 1
                   WHEN 'medium' THEN 2
                   ELSE 3
                 END,
                 ci.created_at DESC
        LIMIT ?`
    )
    .all(limit) as unknown as RawRow[];

  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    severity: r.severity,
    sceneId: r.manuscript_scene_id,
    offset: r.manuscript_offset,
    excerpt: r.manuscript_excerpt,
    vaultNotePath: r.vault_note_path,
    vaultExcerpt: r.vault_excerpt,
    rationale: r.rationale,
    createdAt: r.created_at,
    entityName: r.entity_name,
    entityType: r.entity_type,
  }));
}
