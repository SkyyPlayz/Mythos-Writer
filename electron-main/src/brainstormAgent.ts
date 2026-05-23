// Brainstorm Agent — entity extraction and vault note writing.
// No Electron dependency; all side effects are injected for testability.

import crypto from 'crypto';
import type { DbSuggestion } from './db.js';

// ─── Public types ───

export type FactType = 'character' | 'location' | 'item' | 'note';

export interface ParsedFact {
  type: FactType;
  name: string;
  description: string;
}

export interface WrittenEntity {
  path: string;
  name: string;
  type: FactType;
  suggestionId: string;
}

export interface BrainstormAgentDeps {
  writeVaultNote: (relativePath: string, content: string) => void;
  persistSuggestion: (s: DbSuggestion) => void;
}

// ─── Tag parser ───

/**
 * Extracts [FACT:type|name|description] tags from Claude brainstorm output.
 * The system prompt instructs the model to emit one tag per named story fact.
 */
export function parseFacts(text: string): ParsedFact[] {
  const pattern = /\[FACT:(character|location|item|note)\|([^|\]]+)\|([^\]]+)\]/g;
  const results: ParsedFact[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    const type = m[1] as FactType;
    const name = m[2].trim();
    const description = m[3].trim();
    if (name) results.push({ type, name, description });
  }
  return results;
}

// ─── vaultPath validator (MYT-185 / F10) ───

const VAULT_PATH_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const DEFAULT_VAULT_SUB_PATH = 'brainstorm';

/**
 * Validates a renderer- or agent-supplied vault subdirectory.
 * Throws on rejection. Empty/undefined returns the default `brainstorm` folder.
 *
 * Allowed: single-segment alphanumeric (plus `_` / `-`), 1–64 chars.
 * Rejected: `/`, `..`, anything starting with `.mythos` (reserved for
 * snapshots / SQLite WAL), or any value outside the regex.
 *
 * Apply this at every IPC boundary that accepts a user-supplied vault subdir
 * before passing it to `writeFacts` or any future vault writer (Archive Agent).
 */
export function validateVaultPath(vaultPath: string | null | undefined): string {
  if (vaultPath === undefined || vaultPath === null || vaultPath === '') {
    return DEFAULT_VAULT_SUB_PATH;
  }
  if (typeof vaultPath !== 'string') {
    throw new Error('Invalid vaultPath: must be a string');
  }
  if (vaultPath.includes('/') || vaultPath.includes('\\') || vaultPath.includes('..')) {
    throw new Error('Invalid vaultPath: must not contain "/", "\\" or ".."');
  }
  if (vaultPath.toLowerCase().startsWith('.mythos')) {
    throw new Error('Invalid vaultPath: ".mythos" prefix is reserved');
  }
  if (!VAULT_PATH_REGEX.test(vaultPath)) {
    throw new Error('Invalid vaultPath: must match /^[a-z0-9][a-z0-9_-]{0,63}$/i');
  }
  return vaultPath;
}

// ─── Vault writer ───

/**
 * Writes one vault markdown file per fact with provenance frontmatter,
 * and persists a suggestion row for each write.
 * Returns the list of written entities.
 *
 * Throws `Invalid vaultPath` (and writes nothing) if `vaultSubPath` fails
 * {@link validateVaultPath}.
 */
export function writeFacts(
  facts: ParsedFact[],
  vaultSubPath: string,
  runId: string,
  deps: BrainstormAgentDeps,
): WrittenEntity[] {
  const subPath = validateVaultPath(vaultSubPath);
  if (facts.length === 0) return [];

  const now = new Date().toISOString();
  const written: WrittenEntity[] = [];

  for (const fact of facts) {
    const suggestionId = crypto.randomUUID();
    const safeName = fact.name.replace(/[/\\:*?"<>|]/g, '-').trim() || 'unnamed';
    const relativePath = `${subPath}/${safeName}.md`;

    const content = [
      '---',
      `agent: brainstorm`,
      `runId: ${runId}`,
      `timestamp: ${now}`,
      `suggestionId: ${suggestionId}`,
      `type: ${fact.type}`,
      `name: ${fact.name}`,
      '---',
      '',
      `# ${fact.name}`,
      '',
      fact.description,
      '',
    ].join('\n');

    deps.writeVaultNote(relativePath, content);

    const suggestion: DbSuggestion = {
      id: suggestionId,
      source_agent: 'brainstorm',
      confidence: 0.8,
      rationale: `${fact.type}: ${fact.name} — ${fact.description}`,
      target_kind: 'vault',
      target_path: relativePath,
      target_anchor: null,
      payload_json: JSON.stringify({ type: fact.type, name: fact.name, description: fact.description }),
      status: 'proposed',
      created_at: now,
      applied_at: null,
      applied_run_id: runId,
      budget_exceeded: 0,
    };

    deps.persistSuggestion(suggestion);
    written.push({ path: relativePath, name: fact.name, type: fact.type, suggestionId });
  }

  return written;
}
