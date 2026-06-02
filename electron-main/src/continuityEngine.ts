// Continuity engine — cross-chapter lore drift detection for long-form generation.
// Pure text analysis (no LLM). Reuses PROPERTY_CONTRADICTION_PAIRS from the archive
// agent and extends the check across multiple chapters with aggregate drift metrics.
//
// Strategy: structured lore retrieval from the vault archive index, then property-
// contradiction scanning across all supplied chapters.  Chosen over LLM-based
// approaches because:
//   - deterministic and fully reproducible (regression-test safe)
//   - no API key / network dependency (metric is always runnable, even offline)
//   - integrates directly with the existing ArchiveIndex data structure
//   - cheap to run after every chapter generation

import type { ArchiveIndex } from './archiveAgent.js';
import { PROPERTY_CONTRADICTION_PAIRS } from './archiveAgent.js';

// ─── Public types ───

export interface LoreFact {
  entityId: string;
  entityName: string;
  entityType: 'character' | 'location' | 'faction' | 'item' | 'event' | 'concept' | 'other';
  aliases: string[];
  /** Canonical property key → value pairs from the vault (e.g. hair → blonde). */
  properties: Record<string, string>;
}

export interface LoreFixture {
  facts: LoreFact[];
}

export interface ContinuityMismatch {
  entityName: string;
  propKey: string;
  canonicalValue: string;
  contradictingPhrase: string;
  snippet: string;
}

export interface ChapterContinuityResult {
  scenePath: string;
  entitiesReferenced: string[];
  checkedCount: number;
  mismatchCount: number;
  mismatches: ContinuityMismatch[];
}

export interface ContinuityDriftMetrics {
  chapters: ChapterContinuityResult[];
  totalCheckedCount: number;
  totalMismatchCount: number;
  /** mismatchCount / checkedCount; 0 when no fact-checks were performed. */
  driftScore: number;
}

// ─── Helpers ───

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isEntityMentioned(text: string, name: string, aliases: string[]): boolean {
  const terms = [name, ...aliases].filter(Boolean);
  return terms.some((t) =>
    new RegExp(`(?<![\\w])${escapeRegex(t)}(?![\\w])`, 'i').test(text),
  );
}

/**
 * Check that the vault phrase appears as a whole word/phrase in the entity's
 * property value. Using word-boundary regex prevents 'female'.includes('male')
 * false-positive matching — a known footgun in the archive agent's substr check.
 */
function propValContainsPhrase(propVal: string, vaultPhrase: string): boolean {
  return new RegExp(`(?<![\\w])${escapeRegex(vaultPhrase)}(?![\\w])`, 'i').test(propVal);
}

/**
 * Check that the contradicting phrase appears as a whole word/phrase in the
 * chapter text. Word-boundary regex also catches pronoun occurrences at
 * sentence start (after '\n') that space-padded includes() would miss.
 */
function textContainsPhrase(text: string, contradictingPhrase: string): boolean {
  const trimmed = contradictingPhrase.trim();
  return new RegExp(`(?<![\\w])${escapeRegex(trimmed)}(?![\\w])`, 'i').test(text);
}

function buildSnippet(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + len + 40);
  let snippet = text.slice(start, end).replace(/\n/g, ' ').trim();
  if (start > 0) snippet = '…' + snippet;
  if (end < text.length) snippet += '…';
  return snippet;
}

// ─── Build fixture from archive index ───

export function buildLoreFixture(archiveIndex: ArchiveIndex): LoreFixture {
  const facts: LoreFact[] = archiveIndex.entities.map((record) => ({
    entityId: record.id,
    entityName: record.name,
    entityType: record.type,
    aliases: record.aliases,
    properties: { ...record.properties },
  }));
  return { facts };
}

// ─── Single chapter check ───

export function checkChapterContinuity(
  chapterText: string,
  fixture: LoreFixture,
  scenePath: string,
): ChapterContinuityResult {
  const mismatches: ContinuityMismatch[] = [];
  const entitiesReferenced: string[] = [];
  let checkedCount = 0;

  for (const fact of fixture.facts) {
    if (!isEntityMentioned(chapterText, fact.entityName, fact.aliases)) continue;
    entitiesReferenced.push(fact.entityName);

    for (const [propKey, propVal] of Object.entries(fact.properties)) {
      const contradictions = PROPERTY_CONTRADICTION_PAIRS[propKey] ?? [];
      for (const [vaultPhrase, contradictingPhrase] of contradictions) {
        if (!propValContainsPhrase(propVal, vaultPhrase)) continue;
        checkedCount++;
        if (textContainsPhrase(chapterText, contradictingPhrase)) {
          const trimmed = contradictingPhrase.trim();
          const phraseIdx = chapterText.toLowerCase().indexOf(trimmed.toLowerCase());
          mismatches.push({
            entityName: fact.entityName,
            propKey,
            canonicalValue: propVal,
            contradictingPhrase: trimmed,
            snippet: phraseIdx >= 0 ? buildSnippet(chapterText, phraseIdx, trimmed.length) : trimmed,
          });
        }
      }
    }
  }

  return {
    scenePath,
    entitiesReferenced,
    checkedCount,
    mismatchCount: mismatches.length,
    mismatches,
  };
}

// ─── Multi-chapter check with aggregate metrics ───

export function checkMultiChapterContinuity(
  chapters: Array<{ text: string; scenePath: string }>,
  fixture: LoreFixture,
): ContinuityDriftMetrics {
  const chapterResults = chapters.map((c) =>
    checkChapterContinuity(c.text, fixture, c.scenePath),
  );

  const totalCheckedCount = chapterResults.reduce((sum, r) => sum + r.checkedCount, 0);
  const totalMismatchCount = chapterResults.reduce((sum, r) => sum + r.mismatchCount, 0);

  return {
    chapters: chapterResults,
    totalCheckedCount,
    totalMismatchCount,
    driftScore: totalCheckedCount > 0 ? totalMismatchCount / totalCheckedCount : 0,
  };
}
