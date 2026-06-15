// Wiki-link suggestion scanner (SKY-1613)
// Detects entity name mentions in scene prose and proposes [[wiki-link]] insertions.
// No LLM dependency — pure text analysis against vault entity data.
// All suggestions require author confirmation before any text is modified.

import crypto from 'crypto';
import type { EntityEntry } from './ipc.js';
import { readSceneFile, writeSceneFileAtomic } from './vault.js';
import {
  upsertWikiLinkSuggestion,
  getWikiLinkSuggestion,
  updateWikiLinkSuggestionStatus,
  listRejectedWikiLinks,
  clearWikiLinkRejection,
  type DbWikiLinkSuggestion,
} from './db.js';

// ─── Public types ───

export type WikiLinkStatus = 'proposed' | 'accepted' | 'rejected';

export interface WikiLinkSuggestion {
  id: string;
  sceneId: string;
  position: number;
  entityName: string;
  entityId: string;
  proposedLink: string;
  confidence: number;
  status: WikiLinkStatus;
}

// ─── Internal helpers ───

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Iterative Levenshtein distance (O(m*n)). */
export function levenshtein(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const row = Array.from({ length: bl + 1 }, (_, i) => i);
  for (let i = 1; i <= al; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= bl; j++) {
      const tmp = row[j];
      row[j] =
        a[i - 1] === b[j - 1]
          ? prev
          : 1 + Math.min(prev, row[j], row[j - 1]);
      prev = tmp;
    }
  }
  return row[bl];
}

/** SHA-256 hex of the scene text — used to lift rejection suppression when text changes. */
function hashText(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/** Return all terms for an entity: canonical name + aliases. */
function entityTerms(entity: EntityEntry): string[] {
  return [entity.name, ...(entity.aliases ?? [])].filter(Boolean);
}

/** True if any term for this entity is already wrapped in [[ ]] in the text. */
function isAlreadyLinked(text: string, terms: string[]): boolean {
  return terms.some((t) =>
    new RegExp(`\\[\\[${escapeRegex(t)}(?:\\|[^\\]]*)?\\]\\]`, 'i').test(text),
  );
}

/**
 * Strip existing wiki-links from text (blank them out to same length) so that
 * the inner text of a [[Name]] link doesn't trigger a second suggestion.
 */
function blankWikiLinks(text: string): string {
  return text.replace(/\[\[[^\]]*\]\]/g, (m) => ' '.repeat(m.length));
}

/**
 * Find the character offset of the first unlinked occurrence of `term`
 * in `strippedText` (wiki-links already blanked).
 * Returns -1 if not found.
 */
function findExactPosition(strippedText: string, term: string): number {
  const pattern = new RegExp(`(?<![\\w\\[])${escapeRegex(term)}(?![\\w\\]])`, 'i');
  const m = pattern.exec(strippedText);
  return m ? m.index : -1;
}

interface WordToken {
  word: string;
  index: number;
}

/** Tokenise `strippedText` into word tokens with their character offsets. */
function tokenize(strippedText: string): WordToken[] {
  const tokens: WordToken[] = [];
  // Match runs of word characters (letters, digits, apostrophes for contractions)
  const re = /[A-Za-z'À-ɏ]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(strippedText)) !== null) {
    tokens.push({ word: m[0], index: m.index });
  }
  return tokens;
}

interface FuzzyMatch {
  index: number;
  matchedWord: string;
  distance: number;
}

/**
 * Find the first word token within edit distance `maxDist` of any term.
 * Case-insensitive comparison against the lower-cased term.
 * Skips tokens shorter than 3 characters (too noisy at distance 1).
 */
function findFuzzyPosition(
  strippedText: string,
  terms: string[],
  maxDist: number,
): FuzzyMatch | null {
  const tokens = tokenize(strippedText);
  for (const { word, index } of tokens) {
    if (word.length < 3) continue;
    for (const term of terms) {
      if (term.length < 3) continue;
      const dist = levenshtein(word.toLowerCase(), term.toLowerCase());
      if (dist > 0 && dist <= maxDist) {
        return { index, matchedWord: word, distance: dist };
      }
    }
  }
  return null;
}

// ─── Core scanner ───

/**
 * Scan scene text for entity name mentions and return wiki-link suggestions.
 * Only the first unlinked occurrence per entity is returned (to avoid noise).
 * Entities already wrapped in [[...]] are skipped.
 * Rejected (sceneId, entityId) pairs are suppressed until the scene text changes.
 */
export function scanWikiLinks(
  sceneId: string,
  text: string,
  entities: EntityEntry[],
): WikiLinkSuggestion[] {
  const now = new Date().toISOString();
  const currentHash = hashText(text);
  const strippedText = blankWikiLinks(text);

  // Load rejection list once; lift suppression for entities whose text has changed.
  // If hash is null or differs from current hash, the text has changed → re-propose.
  const rejectedMap = new Set<string>();
  for (const row of listRejectedWikiLinks(sceneId)) {
    if (row.scene_text_hash === null || row.scene_text_hash !== currentHash) {
      clearWikiLinkRejection(sceneId, row.entity_id);
    } else {
      rejectedMap.add(row.entity_id);
    }
  }

  const suggestions: WikiLinkSuggestion[] = [];

  for (const entity of entities) {
    // Skip if already suppressed for this scene+text (same hash)
    if (rejectedMap.has(entity.id)) continue;

    const terms = entityTerms(entity);
    if (terms.length === 0) continue;

    // Skip if entity is already wiki-linked in scene
    if (isAlreadyLinked(text, terms)) continue;

    // Try exact match first (confidence 0.9)
    let position = -1;
    let anchorText = '';
    let confidence = 0;

    for (const term of terms) {
      const pos = findExactPosition(strippedText, term);
      if (pos !== -1) {
        position = pos;
        // Recover original casing from source text
        anchorText = text.slice(pos, pos + term.length);
        confidence = 0.9;
        break;
      }
    }

    // Fall back to fuzzy match (Levenshtein ≤ 1, confidence 0.7)
    if (position === -1) {
      const fuzzy = findFuzzyPosition(strippedText, terms, 1);
      if (fuzzy) {
        position = fuzzy.index;
        anchorText = fuzzy.matchedWord;
        confidence = 0.7;
      }
    }

    if (position === -1) continue;

    const id = crypto.randomUUID();
    const row: DbWikiLinkSuggestion = {
      id,
      scene_id: sceneId,
      position,
      anchor_text: anchorText,
      entity_name: entity.name,
      entity_id: entity.id,
      proposed_link: `[[${entity.name}]]`,
      confidence,
      status: 'proposed',
      scene_text_hash: null,
      created_at: now,
    };
    upsertWikiLinkSuggestion(row);

    suggestions.push({
      id,
      sceneId,
      position,
      entityName: entity.name,
      entityId: entity.id,
      proposedLink: `[[${entity.name}]]`,
      confidence,
      status: 'proposed',
    });
  }

  return suggestions;
}

// ─── Accept ───

/**
 * Accept a wiki-link suggestion: insert `[[entityName]]` at the stored position
 * in the scene markdown via the existing vault file-write path, then mark accepted.
 *
 * @param suggestionId  UUID of the suggestion to accept
 * @param vaultRoot     Story vault root directory
 * @param resolveScenePath  Function that resolves a sceneId to its relative path
 */
export function acceptWikiLink(
  suggestionId: string,
  vaultRoot: string,
  resolveScenePath: (sceneId: string) => string | null,
): void {
  const sug = getWikiLinkSuggestion(suggestionId);
  if (!sug) throw new Error(`WikiLinkSuggestion not found: ${suggestionId}`);
  if (sug.status !== 'proposed') {
    throw new Error(`Suggestion ${suggestionId} is already ${sug.status}`);
  }

  const scenePath = resolveScenePath(sug.scene_id);
  if (!scenePath) throw new Error(`Scene not found for id: ${sug.scene_id}`);

  const sceneData = readSceneFile(vaultRoot, scenePath);
  const prose = sceneData.prose ?? '';

  const { position, anchor_text: anchorText, proposed_link: proposedLink } = sug;

  // Validate position before writing: confirm anchor text still matches.
  const actualSlice = prose.slice(position, position + anchorText.length);
  if (actualSlice.toLowerCase() !== anchorText.toLowerCase()) {
    throw new Error(
      `Position mismatch: expected "${anchorText}" at offset ${position}, found "${actualSlice}". ` +
      `Scene may have changed since suggestion was created.`,
    );
  }

  const newProse =
    prose.slice(0, position) + proposedLink + prose.slice(position + anchorText.length);

  writeSceneFileAtomic(vaultRoot, scenePath, { ...sceneData, prose: newProse });
  updateWikiLinkSuggestionStatus(suggestionId, 'accepted', null);
}

// ─── Reject ───

/**
 * Reject a wiki-link suggestion: suppress the (sceneId, entityId) pair until the
 * scene text changes. The current text hash is stored so the scanner can lift the
 * suppression automatically on the next scan when content has changed.
 *
 * @param suggestionId  UUID of the suggestion to reject
 * @param sceneText     Current scene text at the time of rejection (for hash)
 */
export function rejectWikiLink(
  suggestionId: string,
  sceneText: string,
): void {
  const sug = getWikiLinkSuggestion(suggestionId);
  if (!sug) throw new Error(`WikiLinkSuggestion not found: ${suggestionId}`);
  if (sug.status !== 'proposed') {
    throw new Error(`Suggestion ${suggestionId} is already ${sug.status}`);
  }
  const hash = hashText(sceneText);
  updateWikiLinkSuggestionStatus(suggestionId, 'rejected', hash);
}
