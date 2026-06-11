// Context guardrails for large-vault / large-manuscript agent flows.
//
// These constants and helpers are the single source of truth for prompt-size
// and entity-count limits across Writing Assistant, Brainstorm, and Vault
// Check.  All numbers are conservative enough to leave ample room for the
// system prompt, the model's response budget, and the configured max_tokens.
//
// How to tune:
//   - VAULT_MAX_ENTITIES    — raises/lowers how many vault entries are packed
//                             into the Vault Check system prompt.
//   - VAULT_MAX_CONTEXT_CHARS — hard ceiling on total vault summary text.
//   - VAULT_PROSE_CHARS_PER_ENTITY — per-entity prose slice; reduce to fit
//                             more entities within the char budget.
//   - WRITING_ASSISTANT_MAX_CONTEXT_CHARS — caps the scene context passed to
//                             the Writing Assistant; the user's typed prompt
//                             is never truncated.
//   - BRAINSTORM_MAX_PROMPT_CHARS — caps the full user-message text sent to
//                             the Brainstorm agent; the most-recent message
//                             is preserved; older history is trimmed first.

export const VAULT_MAX_ENTITIES = 200;
export const VAULT_MAX_CONTEXT_CHARS = 60_000;
export const VAULT_PROSE_CHARS_PER_ENTITY = 400;
export const WRITING_ASSISTANT_MAX_CONTEXT_CHARS = 40_000;
export const BRAINSTORM_MAX_PROMPT_CHARS = 40_000;

export interface VaultSummaryInputEntity {
  name: string;
  type: string;
  aliases?: string[];
  prose: string;
}

export interface VaultContextResult {
  summary: string;
  entityCount: number;
  contextChars: number;
  truncated: boolean;
}

/**
 * Builds the vault summary string from a pre-capped list of entities.
 *
 * Callers should apply the entity-count cap (VAULT_MAX_ENTITIES) before
 * calling this function so that disk I/O for omitted entities is avoided.
 * This function applies the character-level cap (VAULT_MAX_CONTEXT_CHARS)
 * as a second safety net.
 */
export function buildVaultSummary(entities: VaultSummaryInputEntity[]): VaultContextResult {
  if (entities.length === 0) {
    const summary = 'No vault entities found.';
    return { summary, entityCount: 0, contextChars: summary.length, truncated: false };
  }

  const parts = entities.map((e) => {
    const facts = e.prose ? e.prose.slice(0, VAULT_PROSE_CHARS_PER_ENTITY) : '';
    const aliases = e.aliases?.length ? ` (aliases: ${e.aliases.join(', ')})` : '';
    return `## ${e.name}${aliases}\nType: ${e.type}\n${facts}`.trim();
  });

  let summary = parts.join('\n\n');
  let truncated = false;

  if (summary.length > VAULT_MAX_CONTEXT_CHARS) {
    summary = summary.slice(0, VAULT_MAX_CONTEXT_CHARS);
    truncated = true;
  }

  return {
    summary,
    entityCount: entities.length,
    contextChars: summary.length,
    truncated,
  };
}

/**
 * Truncates a context string to maxChars, returning whether truncation occurred.
 * Use for scene context (Writing Assistant) and long brainstorm history.
 */
export function truncateContext(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

/** Rough token count estimate: ~4 characters per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
