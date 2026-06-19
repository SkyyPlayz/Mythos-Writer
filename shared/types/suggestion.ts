// Canonical suggestion types — single source of truth imported by both
// electron-main (IPC contract) and frontend (type-only, erased at build time).
//
// Rule: this file must have zero runtime imports. Types only.

// ─── Core status + category ─────────────────────────────────────────────────

export type SuggestionStatus =
  | 'proposed'
  | 'accepted'
  | 'applied'
  | 'rejected'
  | 'rolled_back'
  | 'ignored';

export type SuggestionCategory =
  | 'punctuation'
  | 'spelling'
  | 'grammar'
  | 'sentence-structure'
  | 'style-tone'
  | 'other';

// ─── Structured payload (content of SuggestionRow.payload_json) ─────────────

// Standard vault-file write: write content/prose to target_path.
export interface VaultContentPayload {
  kind?: 'vault-content';
  content?: string;
  prose?: string;
}

// Entity-relation apply: wire a typed relation between two entities in the manifest.
export interface TypedRelationPayload {
  kind: 'typed-relation';
  relationType: string;
  sourceEntityId: string;
  sourceEntityPath?: string | null;
  targetEntityId: string;
  targetEntityPath?: string | null;
}

// Archive-agent inconsistency finding on a manuscript scene.
export interface ManuscriptInconsistencyPayload {
  type: 'inconsistency';
  entityName: string;
  propKey: string;
  vaultValue: string;
  scenePhrase: string;
}

// Discriminated union of all payload kinds.
// Callers that store custom/unknown payloads should cast to this type.
export type SuggestionPayload =
  | VaultContentPayload
  | TypedRelationPayload
  | ManuscriptInconsistencyPayload;

// ─── Auto-apply policy ───────────────────────────────────────────────────────

// Canonical name for the per-agent auto-apply configuration.
// Mirrors AgentBudgetSettings in electron-main/src/budget.ts.
export interface AutoApplyPolicy {
  autoApply: boolean;
  confidenceThreshold: number;
  maxSuggestionsPerHour: number;
  maxTokensPerHour: number;
  maxTokensPerDay: number;
  // Per-category allow-list (SKY-908). Absent key = enabled (forward-compat).
  autoApplyCategories?: Partial<Record<SuggestionCategory, boolean>>;
}

// ─── Agent budget snapshot ───────────────────────────────────────────────────

// Rolling-window budget usage snapshot — mirrors AgentBudgetWindowUsage in ipc.ts.
// Renamed AgentBudgetUsage here to avoid collision with AgentBudget (limit config) in ipc.ts.
export interface AgentBudgetUsage {
  suggestionsLastHour: number;
  tokensLastHour: number;
  tokensLastDay: number;
}
