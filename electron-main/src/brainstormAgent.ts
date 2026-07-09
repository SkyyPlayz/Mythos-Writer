// Brainstorm Agent — entity extraction and vault note writing.
// No Electron dependency; all side effects are injected for testability.

import crypto from 'crypto';
import type { DbSuggestion } from './db.js';

// ─── Public types ───

export type FactType = 'character' | 'location' | 'item' | 'faction' | 'scene_card' | 'inbox';

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

export type NoteProposalStatus = 'pending' | 'confirmed' | 'rejected' | 'edited_and_confirmed';

export interface NoteProposal {
  id: string;
  kind: FactType;
  title: string;
  destinationPath: string;
  body: string;
  frontmatter: Record<string, unknown>;
  sourceConversationTurnId: string;
  extractionConfidence: number;
  status: NoteProposalStatus;
}

export interface ExtractionCallDeps {
  /** Calls the LLM with a user prompt and returns raw response text. System prompt is internal. */
  callLlm: (userPrompt: string) => Promise<string>;
  /** Override UUID generation for deterministic tests. */
  generateId?: () => string;
}

// ─── Tag parser ───

const FACT_NAME_MAX_LEN = 200;

/**
 * Extracts [FACT:type|name|description] tags from Claude brainstorm output.
 * The system prompt instructs the model to emit one tag per named story fact.
 *
 * Names are validated: max 200 chars, no control characters (incl. newlines/null
 * bytes that could break YAML frontmatter or filesystem paths).
 */
export function parseFacts(text: string): ParsedFact[] {
  const pattern = /\[FACT:(character|location|item|faction|scene_card|inbox)\|([^|\]]+)\|([^\]]+)\]/g;
  const results: ParsedFact[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    const type = m[1] as FactType;
    const name = m[2].trim();
    const description = m[3].trim();
    if (!name || name.length > FACT_NAME_MAX_LEN || /[\x00-\x1f\x7f]/.test(name)) continue;
    results.push({ type, name, description });
  }
  return results;
}

// ─── Alias hint extraction (SKY-191) ───

export interface AliasHint {
  entityName: string;
  alias: string;
}

/**
 * Scans free-form text (user messages or agent output) for common English
 * alias-introduction patterns and returns (entityName, alias) pairs.
 *
 * Recognised patterns:
 *   "Name, also known as Alias"
 *   "Name (aka Alias)"
 *   "Name, called Alias"
 *   "Name, named Alias"
 *
 * Entity names must begin with a capital letter (proper nouns).
 * Results are deduplicated case-insensitively.
 */
export function parseAliasHints(text: string): AliasHint[] {
  const results: AliasHint[] = [];
  const seen = new Set<string>();

  function add(rawEntity: string, rawAlias: string): void {
    const e = rawEntity.trim().replace(/^["']|["']$/g, '');
    const a = rawAlias.trim()
      .replace(/^["']|["']$/g, '')
      .replace(/[.,;!?]+$/, '');
    if (!e || !a) return;
    if (e.toLowerCase() === a.toLowerCase()) return;
    const key = `${e.toLowerCase()}|${a.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ entityName: e, alias: a });
    }
  }

  // Each pattern captures (entityName, alias).
  // Entity name: capitalized word + up to 3 additional words (lazy so the
  // engine prefers shorter names and doesn't swallow keywords like "also").
  // Alias: up to 7 words after the keyword.
  const NAME = String.raw`([A-Z][a-zA-Z]+(?:\s+[A-Za-z]+){0,3}?)`;
  const ALIAS = String.raw`((?:[A-Za-z]+\s+){0,6}[A-Za-z]+)`;

  const patterns = [
    new RegExp(`\\b${NAME},?\\s+(?:also\\s+)?known\\s+as\\s+${ALIAS}`, 'g'),
    new RegExp(`\\b${NAME},?\\s+\\(?aka\\.?\\s+${ALIAS}\\)?`, 'gi'),
    new RegExp(`\\b${NAME},?\\s+(?:also\\s+)?called\\s+${ALIAS}`, 'g'),
    new RegExp(`\\b${NAME},?\\s+(?:also\\s+)?named\\s+${ALIAS}`, 'g'),
  ];

  for (const pattern of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      add(m[1], m[2]);
    }
  }

  return results;
}

// ─── Entity type → FactType mapping ───

/**
 * Maps EntityType values (including 'concept' and 'other') to the brainstorm
 * FactType set, which only has character/location/item/faction/scene_card/inbox.
 * Used by the quick-enrich entry flow so that concept/other entries route to
 * the 'inbox' category in the Notes Vault.
 */
export function entityTypeToFactType(entityType: string): FactType {
  if (entityType === 'character' || entityType === 'location' || entityType === 'item') {
    return entityType;
  }
  return 'inbox';
}

/**
 * Builds the system prompt for the one-shot entry enrichment call.
 * The prompt instructs Claude to emit exactly one [FACT:...] tag so
 * parseFacts can extract the generated description reliably.
 */
export function buildEnrichmentSystemPrompt(name: string, factType: FactType): string {
  const typeLabel =
    factType === 'inbox' ? 'concept or worldbuilding element' : factType;
  return [
    `You are a creative writing assistant helping an author develop their story world.`,
    `The author has just added a new ${typeLabel} named "${name}".`,
    `Write a brief 2-3 sentence description that would help them develop this entry.`,
    `Focus on concrete, story-relevant details.`,
    ``,
    `End your response with exactly one structured fact tag:`,
    `[FACT:${factType}|${name}|your description here]`,
  ].join('\n');
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
      category: 'other',
    };

    deps.persistSuggestion(suggestion);
    written.push({ path: relativePath, name: fact.name, type: fact.type, suggestionId });
  }

  return written;
}

// ─── Extraction side-call ───

/**
 * System prompt for the extraction side-call (sent by the IPC handler in
 * main.ts). Keep the JSON shape on a single line — it nudges the model toward
 * compact output, which matters because the response is one all-or-nothing
 * JSON array parsed by parseExtractionResponse.
 *
 * The inclusion rule mirrors the extractionConfidence >= 0.6 filter in
 * runExtractionSideCall: borderline-but-real entities are kept with an honest
 * confidence score, while sub-threshold entities are omitted at the source so
 * they don't spend output budget on entries the filter would discard anyway.
 */
export const EXTRACTION_SYSTEM_PROMPT = `You are a structured entity extractor for creative writing sessions.
Extract named story entities from the conversation turn provided.

Return ONLY a valid JSON array. Each element must have this exact shape:
{"kind":"character"|"location"|"item"|"faction"|"scene_card"|"inbox","title":"<name>","destinationPath":"<suggested/path>","body":"<description>","frontmatter":{},"extractionConfidence":<0.0-1.0>}

Rules:
- character: named persons or beings. location: named places. item: named objects/artifacts.
- faction: organizations or groups. scene_card: a discrete scene or plot beat.
- inbox: general notes, themes, world-rules, or unclassified concepts.
- extractionConfidence: clarity with which the entity appears in the text (0.0–1.0).
- One entry per distinct named entity. No duplicates.
- destinationPath: suggest a vault-relative path using lowercase with hyphens, e.g. "characters/aria.md".
- Include every entity that appears with reasonable clarity — when torn, include it
  with an honest extractionConfidence rather than leaving it out. Omit only entities
  you would score below 0.6: those are discarded automatically, and spending output
  on them crowds out real entries.
- Return [] only when the turn names no story entities at all.
- Raw JSON array only — no markdown fences.`;

interface RawExtractionItem {
  kind: string;
  title: string;
  destinationPath: string;
  body: string;
  frontmatter: Record<string, unknown>;
  extractionConfidence: number;
}

const VALID_FACT_KINDS: Set<string> = new Set([
  'character', 'location', 'item', 'faction', 'scene_card', 'inbox',
]);

function parseExtractionResponse(raw: string): RawExtractionItem[] {
  const trimmed = raw.trim();
  // Strip markdown code fences if the model included them despite instructions
  const cleaned = trimmed.startsWith('```')
    ? trimmed.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim()
    : trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (item): item is RawExtractionItem =>
      item !== null &&
      typeof item === 'object' &&
      typeof (item as Record<string, unknown>).kind === 'string' &&
      typeof (item as Record<string, unknown>).title === 'string' &&
      typeof (item as Record<string, unknown>).extractionConfidence === 'number',
  );
}

/**
 * Fires an LLM extraction side-call after a brainstorm response turn.
 * Returns filtered NoteProposal[] for the renderer to display.
 *
 * Filtering rules (any match → suppress):
 *   - extractionConfidence < 0.6
 *   - title is already in existingEntityNames (manifest dedup)
 *   - title is in sessionRejectionLog (session rejection dedup)
 *   - kind is not a valid FactType
 *
 * Never throws — errors from callLlm are caught and return [].
 */
export async function runExtractionSideCall(
  turnText: string,
  existingEntityNames: Set<string>,
  sessionRejectionLog: Set<string>,
  turnId: string,
  deps: ExtractionCallDeps,
): Promise<NoteProposal[]> {
  const generateId = deps.generateId ?? (() => crypto.randomUUID());
  const userPrompt = `Extract entities from this brainstorm conversation turn:\n\n${turnText}`;

  let rawResponse: string;
  try {
    rawResponse = await deps.callLlm(userPrompt);
  } catch {
    return [];
  }

  const items = parseExtractionResponse(rawResponse);
  const proposals: NoteProposal[] = [];

  for (const item of items) {
    if (!VALID_FACT_KINDS.has(item.kind)) continue;
    if (item.extractionConfidence < 0.6) continue;
    const normalizedTitle = item.title.trim();
    if (!normalizedTitle) continue;
    if (existingEntityNames.has(normalizedTitle)) continue;
    if (sessionRejectionLog.has(normalizedTitle)) continue;

    proposals.push({
      id: generateId(),
      kind: item.kind as FactType,
      title: normalizedTitle,
      destinationPath: item.destinationPath ?? '',
      body: item.body ?? '',
      frontmatter: item.frontmatter && typeof item.frontmatter === 'object' ? item.frontmatter : {},
      sourceConversationTurnId: turnId,
      extractionConfidence: item.extractionConfidence,
      status: 'pending',
    });
  }

  return proposals;
}
