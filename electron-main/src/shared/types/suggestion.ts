// Canonical suggestion types — single source of truth for electron-main.
// Frontend mirrors these in frontend/src/global.d.ts (cannot import directly
// since the renderer runs in a separate bundle with no electron-main access).

/** Lifecycle state of a suggestion in the inbox. */
export type SuggestionStatus =
  | 'proposed'
  | 'accepted'
  | 'rejected'
  | 'applied'
  | 'rolled_back'
  | 'ignored';

/** Parsed shape of `DbSuggestion.payload_json`. */
export interface SuggestionPayload {
  /** 'typed-relation' for entity-link suggestions; omit for plain-content edits. */
  kind?: 'typed-relation' | 'content';
  /** Replacement file content (plain-content apply path). */
  content?: string;
  /** Alias for `content` used by some agents. */
  prose?: string;
  /** Only present when kind='typed-relation'. */
  relationType?: string;
  sourceEntityId?: string;
  sourceEntityPath?: string;
  targetEntityId?: string;
  targetEntityPath?: string;
  sourceEntityName?: string;
  targetEntityName?: string;
}

/** Per-agent auto-apply policy stored in app-settings.json. */
export interface AutoApplyPolicy {
  autoApply: boolean;
  confidenceThreshold: number;
  maxSuggestionsPerHour: number;
  maxTokensPerHour: number;
  maxTokensPerDay: number;
  /** SKY-908: per-category allow-list; absent key → enabled. */
  autoApplyCategories?: Partial<Record<string, boolean>>;
}

/** Observed rolling-window budget counters for an agent. */
export interface AgentBudget {
  suggestionsLastHour: number;
  tokensLastHour: number;
  tokensLastDay: number;
}
