// Archive Agent — local vault indexer, inconsistency detector, wiki-link suggester.
// No LLM dependency; pure text analysis against vault entity data.
// All suggestions are proposed-only (status='proposed', never auto-applied here).

import crypto from 'crypto';
import type { Manifest, EntityEntry } from './ipc.js';
import { listEntities } from './entities.js';
import { readVaultFile } from './vault.js';
import type { DbSuggestion } from './db.js';

// ─── Types ───

export interface VaultEntityRecord {
  id: string;
  name: string;
  type: EntityEntry['type'];
  aliases: string[];
  /** Key/value properties extracted from frontmatter and structured prose lines. */
  properties: Record<string, string>;
  prose: string;
}

export interface ArchiveIndex {
  entities: VaultEntityRecord[];
  builtAt: string;
}

export interface ArchiveScanResult {
  suggestions: DbSuggestion[];
  inconsistenciesFound: number;
  wikiLinksFound: number;
}

export type ArchiveIndexStatus = 'idle' | 'indexing' | 'ready';

export interface ArchiveStatusInfo {
  status: ArchiveIndexStatus;
  count: number;
  total: number;
  builtAt: string | null;
}

// ─── Module state ───

let _index: ArchiveIndex | null = null;
let _indexProgress: { status: ArchiveIndexStatus; count: number; total: number } = {
  status: 'idle',
  count: 0,
  total: 0,
};

export function getArchiveStatus(): ArchiveStatusInfo {
  return {
    ..._indexProgress,
    builtAt: _index?.builtAt ?? null,
  };
}

export function getArchiveIndex(): ArchiveIndex | null {
  return _index;
}

// ─── Build index ───

export function buildArchiveIndex(vaultRoot: string, manifest: Manifest): ArchiveIndex {
  const entities = listEntities(vaultRoot, manifest, undefined);
  _indexProgress = { status: 'indexing', count: 0, total: entities.length };

  const records: VaultEntityRecord[] = [];

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    _indexProgress.count = i + 1;

    let prose = '';
    try {
      const { content } = readVaultFile(vaultRoot, e.path);
      const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
      prose = match ? match[1].trim() : content.trim();
    } catch { /* missing file — use metadata only */ }

    // Extract structured properties from prose lines: "Hair: brown", "Eyes: blue", etc.
    const properties: Record<string, string> = {};
    for (const line of prose.split('\n')) {
      const m = line.match(/^([A-Za-z][A-Za-z\s]{1,30}):\s*(.+)$/);
      if (m) properties[m[1].trim().toLowerCase()] = m[2].trim();
    }
    if (e.properties) {
      for (const [k, v] of Object.entries(e.properties)) {
        if (typeof v === 'string') properties[k.toLowerCase()] = v;
      }
    }

    records.push({
      id: e.id,
      name: e.name,
      type: e.type,
      aliases: e.aliases ?? [],
      properties,
      prose,
    });
  }

  _index = { entities: records, builtAt: new Date().toISOString() };
  _indexProgress = { status: 'ready', count: records.length, total: records.length };
  return _index;
}

// ─── Helpers ───

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function entityTerms(record: VaultEntityRecord): string[] {
  return [record.name, ...record.aliases].filter(Boolean);
}

function hasWikiLink(text: string, terms: string[]): boolean {
  return terms.some((t) =>
    new RegExp(`\\[\\[${escapeRegex(t)}(\\|[^\\]]*)?\\]\\]`, 'i').test(text),
  );
}

function findPlainMention(
  prose: string,
  terms: string[],
): { term: string; index: number } | null {
  // Blank out existing wiki-links so we don't double-match their inner text.
  const stripped = prose.replace(/\[\[[^\]]*\]\]/g, (m) => ' '.repeat(m.length));
  for (const term of terms) {
    const pattern = new RegExp(`(?<![\\w\\[])${escapeRegex(term)}(?![\\w\\]])`, 'i');
    const m = pattern.exec(stripped);
    if (m) return { term, index: m.index };
  }
  return null;
}

function buildSnippet(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + len + 40);
  let snippet = text.slice(start, end).replace(/\n/g, ' ').trim();
  if (start > 0) snippet = '…' + snippet;
  if (end < text.length) snippet += '…';
  return snippet;
}

// ─── Inconsistency detection ───
// Contradicting-phrase pairs keyed by vault property name.
// Each entry is [vault-value-substring, scene-contradiction-phrase].

const PROPERTY_CONTRADICTION_PAIRS: Record<string, Array<[string, string]>> = {
  hair: [
    ['blonde', 'dark hair'],
    ['blonde', 'black hair'],
    ['blonde', 'brown hair'],
    ['dark hair', 'blonde hair'],
    ['black hair', 'blonde hair'],
    ['brown hair', 'blonde hair'],
    ['red hair', 'brown hair'],
    ['brown hair', 'red hair'],
  ],
  eyes: [
    ['blue', 'brown eyes'],
    ['blue', 'green eyes'],
    ['brown', 'blue eyes'],
    ['brown', 'green eyes'],
    ['green', 'brown eyes'],
    ['green', 'blue eyes'],
  ],
  gender: [
    ['male', ' she '],
    ['male', ' her '],
    ['female', ' he '],
    ['female', ' his '],
  ],
};

export function detectInconsistencies(
  sceneText: string,
  index: ArchiveIndex,
  scenePath: string,
): DbSuggestion[] {
  const suggestions: DbSuggestion[] = [];
  const now = new Date().toISOString();
  const sceneTextLower = sceneText.toLowerCase();

  for (const record of index.entities) {
    const terms = entityTerms(record);
    const mention = findPlainMention(sceneText, terms);
    if (!mention) continue; // entity not referenced in this scene

    for (const [propKey, propVal] of Object.entries(record.properties)) {
      const propValLower = propVal.toLowerCase();
      const contradictions = PROPERTY_CONTRADICTION_PAIRS[propKey] ?? [];

      for (const [vaultPhrase, contradictingPhrase] of contradictions) {
        if (
          propValLower.includes(vaultPhrase) &&
          sceneTextLower.includes(contradictingPhrase)
        ) {
          const phraseIdx = sceneTextLower.indexOf(contradictingPhrase);
          const snippet = buildSnippet(sceneText, phraseIdx, contradictingPhrase.length);
          suggestions.push({
            id: crypto.randomUUID(),
            source_agent: 'archive',
            confidence: 0.75,
            rationale: `${record.name}'s vault entry states ${propKey}: "${propVal}" but scene contains "${contradictingPhrase.trim()}"`,
            target_kind: 'manuscript',
            target_path: scenePath,
            target_anchor: snippet,
            payload_json: JSON.stringify({
              kind: 'inconsistency',
              entityId: record.id,
              entityName: record.name,
              propKey,
              vaultValue: propVal,
              scenePhrase: contradictingPhrase.trim(),
            }),
            status: 'proposed',
            created_at: now,
            applied_at: null,
            applied_run_id: null,
            budget_exceeded: 0,
          });
        }
      }
    }
  }

  return suggestions;
}

// ─── Wiki-link suggestions ───
// Finds entity names/aliases mentioned as plain text (not already wrapped in [[...]]).

export function detectWikiLinkOpportunities(
  sceneText: string,
  index: ArchiveIndex,
  scenePath: string,
): DbSuggestion[] {
  const suggestions: DbSuggestion[] = [];
  const now = new Date().toISOString();

  for (const record of index.entities) {
    const terms = entityTerms(record);
    if (hasWikiLink(sceneText, terms)) continue;

    const mention = findPlainMention(sceneText, terms);
    if (!mention) continue;

    const snippet = buildSnippet(sceneText, mention.index, mention.term.length);
    suggestions.push({
      id: crypto.randomUUID(),
      source_agent: 'archive',
      confidence: 0.9,
      rationale: `"${mention.term}" references vault entity "${record.name}" but is not wiki-linked`,
      target_kind: 'manuscript',
      target_path: scenePath,
      target_anchor: snippet,
      payload_json: JSON.stringify({
        kind: 'wiki-link',
        entityId: record.id,
        entityName: record.name,
        anchorText: mention.term,
        link: `[[${record.name}]]`,
      }),
      status: 'proposed',
      created_at: now,
      applied_at: null,
      applied_run_id: null,
      budget_exceeded: 0,
    });
  }

  return suggestions;
}

// ─── Combined scan ───

export function runArchiveScan(
  sceneText: string,
  index: ArchiveIndex,
  scenePath: string,
): ArchiveScanResult {
  const inconsistencies = detectInconsistencies(sceneText, index, scenePath);
  const wikiLinks = detectWikiLinkOpportunities(sceneText, index, scenePath);
  return {
    suggestions: [...inconsistencies, ...wikiLinks],
    inconsistenciesFound: inconsistencies.length,
    wikiLinksFound: wikiLinks.length,
  };
}
