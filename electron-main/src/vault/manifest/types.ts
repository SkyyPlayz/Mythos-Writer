// Manifest v1 canonical on-disk types.
// These are the source-of-truth type definitions for manifest.json.
// The IPC layer (ipc.ts) uses a broader Manifest type for backward compat;
// new code should use these types via the vault/manifest module.

export const SCHEMA_VERSION = 1 as const;
export type ManifestSchemaVersion = typeof SCHEMA_VERSION;

// ── Scene sub-types ──────────────────────────────────────────────────────────

export interface SceneTimestamps {
  storyTime?: string;
  realTime?: string;
  duration?: string;
}

export interface SceneCardRef {
  goal?: string;
  conflict?: string;
  outcome?: string;
  pov?: string;
  tags?: string[];
}

// Lightweight scene index entry — path, title, position, and display fields only.
// Full prose lives in the scene's markdown file; blocks are not stored here.
export interface ManifestSceneEntry {
  id: string;
  path: string;
  title: string;
  chapter?: string;
  order: number;
  timestamps?: SceneTimestamps;
  sceneCardRefs?: SceneCardRef;
  createdAt: string;
  updatedAt: string;
}

// ── Entity ───────────────────────────────────────────────────────────────────

export interface ManifestEntityEntry {
  id: string;
  name: string;
  type: 'character' | 'location' | 'item' | 'concept' | 'other';
  path: string;
  aliases?: string[];
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

// ── Suggestion ref ───────────────────────────────────────────────────────────
// The manifest stores only a lightweight ref; full suggestion data is in SQLite.

export interface SuggestionRef {
  id: string;
  status: 'proposed' | 'accepted' | 'dismissed' | 'applied' | 'rolled_back';
  targetPath?: string;
}

// ── Provenance ───────────────────────────────────────────────────────────────
// Links a vault file back to the agent action that created or last modified it.

export interface ProvenanceEntry {
  vaultPath: string;
  suggestionId?: string;
  runId?: string;
  agentType?: string;
  createdAt: string;
}

// ── Board ref ────────────────────────────────────────────────────────────────
// Points to a Scene Crafter board file in the Notes Vault.

export interface BoardRef {
  id: string;
  path: string;
  storyId?: string;
  title?: string;
  updatedAt: string;
}

// ── Manifest v1 ──────────────────────────────────────────────────────────────

export interface ManifestV1 {
  schemaVersion: 1;
  version: string;
  vaultRoot: string;
  scenes: ManifestSceneEntry[];
  entities: ManifestEntityEntry[];
  /** Refs to SQLite suggestion rows — full data is in the DB, not here. */
  suggestions: SuggestionRef[];
  /** Frontmatter provenance links: vault file → originating suggestion/run. */
  provenance: ProvenanceEntry[];
  /** Scene Crafter board file references. */
  boards: BoardRef[];
  /** Preserved from pre-v1 manifests; may be absent on fresh vaults. */
  stories?: unknown[];
  chapters?: unknown[];
}
