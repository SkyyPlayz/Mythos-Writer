// Archive Agent — local vault indexer, inconsistency detector, wiki-link suggester,
// and typed-relation proposer.
// No LLM dependency; pure text analysis against vault entity data.
// All suggestions are proposed-only (status='proposed', never auto-applied here).

import crypto from 'crypto';
import type { Manifest, EntityEntry } from './ipc.js';
import { listEntities } from './entities.js';
import { readVaultFile } from './vault.js';
import type { DbSuggestion } from './db.js';
import { detectRelationSuggestions } from './entityRelations.js';

// ─── Types ───

export interface VaultEntityRecord {
  id: string;
  name: string;
  type: EntityEntry['type'];
  aliases: string[];
  /** Vault-relative path of the entity's note — continuity flags anchor their
   *  "Edit notes to match" patch here (M9d). */
  path: string;
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
  relationsFound: number;
  /** Check 2 side effect — proposed questions for Brainstorm (M12.B2), never flags. */
  questions: ArchiveProposedQuestion[];
  questionsFound: number;
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
      path: e.path,
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

export const PROPERTY_CONTRADICTION_PAIRS: Record<string, Array<[string, string]>> = {
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
  // M12.B1 (SKY-10736): owner's own Check 2 example — a location note's rule
  // ("opens only at low tide") vs a scene that enters at high tide.
  tide: [
    ['rises at dawn', 'tide is highest at dusk'],
    ['low tide', 'high tide'],
    ['high tide', 'low tide'],
  ],
};

export interface ArchiveIgnoreKey {
  entity_id: string;
  prop_key: string;
  scene_path: string;
}

export function detectInconsistencies(
  sceneText: string,
  index: ArchiveIndex,
  scenePath: string,
  ignoreList?: ArchiveIgnoreKey[],
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

      // Skip if user has ignored this entity+property+scene combination.
      if (ignoreList?.some(
        (ig) => ig.entity_id === record.id && ig.prop_key === propKey && ig.scene_path === scenePath
      )) continue;

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
              scope: 'story_vault',
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
            category: 'other',
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
      category: 'other',
    });
  }

  return suggestions;
}

// ─── Vault-gap questions (Check 2 side effect) ───
// Owner ruling (SKY-10528): "a flag is a defect, a question is an invitation"
// — a proposed question is a distinct artifact class from a `DbSuggestion`
// flag, so it does not reuse that shape or its resolve/ignore semantics.
// This function only *emits* questions found while running Check 2; the
// queue they land and get drained in is sibling ticket M12.B2's data model.

export interface ArchiveProposedQuestion {
  id: string;
  entityId: string;
  entityName: string;
  /** M12.B2: lets the question queue pick a note kind when authoring the answer. */
  entityType: EntityEntry['type'];
  question: string;
  scenePath: string;
  createdAt: string;
}

/**
 * Check 2 side effect — an entity mentioned in the scene whose vault record
 * has no tracked properties at all is a gap: the story references someone or
 * something the vault knows nothing about yet.
 */
export function detectVaultGapQuestions(
  sceneText: string,
  index: ArchiveIndex,
  scenePath: string,
): ArchiveProposedQuestion[] {
  const questions: ArchiveProposedQuestion[] = [];
  const now = new Date().toISOString();

  for (const record of index.entities) {
    const terms = entityTerms(record);
    if (!findPlainMention(sceneText, terms)) continue; // entity not referenced here
    if (Object.keys(record.properties).length > 0) continue; // vault already has details

    questions.push({
      id: crypto.randomUUID(),
      entityId: record.id,
      entityName: record.name,
      entityType: record.type,
      question: `"${record.name}" appears in the manuscript but the vault has no tracked details yet — what should be recorded?`,
      scenePath,
      createdAt: now,
    });
  }

  return questions;
}

// ─── Combined scan ───

export function runArchiveScan(
  sceneText: string,
  index: ArchiveIndex,
  scenePath: string,
  ignoreList?: ArchiveIgnoreKey[],
): ArchiveScanResult {
  const inconsistencies = detectInconsistencies(sceneText, index, scenePath, ignoreList);
  const wikiLinks = detectWikiLinkOpportunities(sceneText, index, scenePath);
  const relations = detectRelationSuggestions(sceneText, index);
  const questions = detectVaultGapQuestions(sceneText, index, scenePath);
  return {
    suggestions: [...inconsistencies, ...wikiLinks, ...relations],
    inconsistenciesFound: inconsistencies.length,
    wikiLinksFound: wikiLinks.length,
    relationsFound: relations.length,
    questions,
    questionsFound: questions.length,
  };
}

// ─── Check 1: Story internal (manuscript vs itself) ───
// Owner ruling (SKY-10528, 2026-08-19): Check 1 verifies the manuscript stays
// consistent with itself — wrong hair/eye colour, a world/magic rule broken
// that the book previously established, time/location drift between scenes.
// This never reads the vault; it only compares scenes against earlier scenes
// in the same manuscript. Kept as a distinct entry point from Check 2
// (`detectInconsistencies`) per the owner's "two checks" ruling — do not fold
// them into one pass or share their scope tag.

export interface ManuscriptScene {
  path: string;
  text: string;
}

// Descriptive phrases as they actually appear in narrative prose (not the
// vault-property substrings `PROPERTY_CONTRADICTION_PAIRS` matches against —
// scene-vs-scene comparison has no vault ground truth to anchor a bare word
// like "blonde" to, so each family lists full phrases instead).
const HAIR_PHRASE_FAMILY = ['blonde hair', 'dark hair', 'black hair', 'brown hair', 'red hair'];
const EYE_PHRASE_FAMILY = ['blue eyes', 'brown eyes', 'green eyes'];

const CHARACTER_PHRASE_FAMILIES: Array<{ propKey: string; phrases: string[] }> = [
  { propKey: 'hair', phrases: HAIR_PHRASE_FAMILY },
  { propKey: 'eyes', phrases: EYE_PHRASE_FAMILY },
];

// Entity-agnostic world-rule families: each family names mutually-exclusive
// canonical values, and each canonical value lists its spelling variants.
// "oil-lit" and "oil lit" are variants of the same value — they do NOT
// contradict each other. Only two *different* canonicals from the same family
// appearing across scenes are flagged as drift.
//
// Extend this table with new families as the story world requires. For an
// LLM-driven general-purpose world-rule engine see SKY-11018 (M12.2).
export const WORLD_RULE_PHRASE_FAMILIES: Array<{
  label: string;
  canonicals: Array<{ name: string; phrases: string[] }>;
}> = [
  {
    label: 'light-source fuel type',
    canonicals: [
      { name: 'oil-lit',     phrases: ['oil-lit', 'oil lit', 'oil lamp', 'oil lantern'] },
      { name: 'crystal-lit', phrases: ['crystal-lit', 'crystal lit', 'crystal lamp', 'crystal lantern'] },
      { name: 'candle-lit',  phrases: ['candle-lit', 'candlelit', 'candle lit'] },
      { name: 'gas-lit',     phrases: ['gas-lit', 'gaslit', 'gas lit'] },
    ],
  },
];

function internalSuggestion(
  rationale: string,
  laterScene: ManuscriptScene,
  laterPhrase: string,
  extra: Record<string, unknown>,
  now: string,
): DbSuggestion {
  const lower = laterScene.text.toLowerCase();
  const idx = lower.indexOf(laterPhrase);
  const snippet = buildSnippet(laterScene.text, idx, laterPhrase.length);
  return {
    id: crypto.randomUUID(),
    source_agent: 'archive',
    confidence: 0.7,
    rationale,
    target_kind: 'manuscript',
    target_path: laterScene.path,
    target_anchor: snippet,
    payload_json: JSON.stringify({
      kind: 'internal-inconsistency',
      scope: 'story_internal',
      laterPhrase,
      ...extra,
    }),
    status: 'proposed',
    created_at: now,
    applied_at: null,
    applied_run_id: null,
    budget_exceeded: 0,
    category: 'other',
  };
}

/**
 * Check 1 — flags the manuscript contradicting itself across scenes, with no
 * vault involved. `scenes` must be in manuscript reading order; the first
 * scene to state a phrase establishes it, and a later scene stating a
 * conflicting phrase from the same family is flagged as drift.
 */
export function detectInternalContinuity(
  scenes: ManuscriptScene[],
  index: ArchiveIndex,
): DbSuggestion[] {
  const suggestions: DbSuggestion[] = [];
  const now = new Date().toISOString();

  // Character property drift: same entity, contradicting phrase from the
  // same family (hair/eyes) established in an earlier scene vs a later one.
  for (const record of index.entities) {
    const terms = entityTerms(record);
    for (const { phrases } of CHARACTER_PHRASE_FAMILIES) {
      let established: { phrase: string; path: string } | null = null;
      // A recurring scene that repeats an already-flagged phrase (e.g. the
      // character stays "dark hair" for the rest of the book after drifting
      // from "blonde hair") must not re-flag on every occurrence — only the
      // first scene stating each distinct drifted phrase is surfaced.
      const flaggedPhrases = new Set<string>();
      for (const scene of scenes) {
        if (!findPlainMention(scene.text, terms)) continue; // entity not mentioned here
        const lower = scene.text.toLowerCase();
        const found = phrases.find((p) => lower.includes(p));
        if (!found) continue;
        if (!established) {
          established = { phrase: found, path: scene.path };
        } else if (found !== established.phrase && !flaggedPhrases.has(found)) {
          flaggedPhrases.add(found);
          suggestions.push(
            internalSuggestion(
              `${record.name} is described as "${established.phrase}" in an earlier scene but "${found}" here`,
              scene,
              found,
              {
                entityId: record.id,
                entityName: record.name,
                earlierPhrase: established.phrase,
                earlierScenePath: established.path,
              },
              now,
            ),
          );
          // Don't let the drift itself become the new baseline — later scenes
          // are compared against the originally-established phrase, matching
          // "the book previously established" rather than the latest scene.
        }
      }
    }
  }

  // World-rule / object drift: canonical-value families.
  // The first canonical value established in reading order sets the rule;
  // any later scene introducing a *different* canonical from the same family
  // is flagged. Spelling variants of the same canonical are not contradictions.
  for (const family of WORLD_RULE_PHRASE_FAMILIES) {
    let established: { canonicalName: string; path: string } | null = null;
    // Once a drift to a given canonical has been flagged, a recurring scene
    // (e.g. the lantern stays "crystal-lit" for the rest of the book) must
    // not re-flag the same contradiction again on every later occurrence.
    const flaggedNames = new Set<string>();
    for (const scene of scenes) {
      const lower = scene.text.toLowerCase();
      let foundName: string | null = null;
      let foundPhrase: string | null = null;
      for (const canonical of family.canonicals) {
        const hit = canonical.phrases.find((p) => lower.includes(p));
        if (hit) { foundName = canonical.name; foundPhrase = hit; break; }
      }
      if (!foundName || !foundPhrase) continue;
      if (!established) {
        established = { canonicalName: foundName, path: scene.path };
      } else if (foundName !== established.canonicalName && !flaggedNames.has(foundName)) {
        flaggedNames.add(foundName);
        suggestions.push(
          internalSuggestion(
            `Established "${established.canonicalName}" (${family.label}) in an earlier scene but "${foundName}" appears here`,
            scene,
            foundPhrase,
            {
              worldRuleLabel: family.label,
              earlierPhrase: established.canonicalName,
              earlierScenePath: established.path,
            },
            now,
          ),
        );
      }
    }
  }

  return suggestions;
}
