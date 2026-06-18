// SKY-796: Timeline AI auto-population — proposal engine + persistence.
//
// Pure inference helpers run over plain scene text (frontmatter already
// stripped by the caller). They never call out to an LLM; they encode the
// rules an LLM-shaped agent would use so the rest of the pipeline — accept /
// reject UX, provenance, idempotency — can be wired and tested without a
// network dependency. A later issue swaps the engine for a real Brainstorm
// agent call without changing the wire shape (see [[brainstorm-agent]]).

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type {
  TimelineAIProposal,
  TimelineProposalKind,
  TimelineProposalStatus,
} from './ipc.js';

const PROPOSALS_FILENAME = 'timeline-proposals.json';

// ─── Input shapes ───

export interface ProposalEngineScene {
  sceneId: string;
  /** Raw scene prose, frontmatter already stripped. */
  text: string;
  /** Current scene state — engine never proposes to override these. */
  current: {
    dateIsUserSet: boolean;
    pov?: string;
    mood?: string;
    characterIds: string[];
  };
}

export interface ProposalEngineCharacter {
  id: string;
  name: string;
  aliases?: string[];
}

export interface ProposalEngineInput {
  scene: ProposalEngineScene;
  characters: ProposalEngineCharacter[];
}

// ─── Story-day extraction ───
//
// Day convention: Day 1 = the narrative anchor (the first scene that carries an
// explicit day cue). Per-scene inference extracts "Day N" markers only and
// returns the raw integer. Cross-scene relative ordering (converting ISO dates
// to day offsets from the anchor) is handled by the timeline aggregator.

const EXPLICIT_DAY_RE = /\bDay\s+(\d+)\b/i;

/**
 * Extract the story-day integer from an explicit "Day N" cue in prose.
 * Returns 0 when no day marker is present or when N is not a positive integer.
 */
export function inferInferredDay(text: string): number {
  const m = text.match(EXPLICIT_DAY_RE);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// ─── Date estimation ───

const DATE_PATTERNS: Array<{ re: RegExp; reasonPrefix: string; confidence: number }> = [
  // ISO 8601 — very high confidence
  { re: /\b(\d{4}-\d{2}-\d{2})\b/, reasonPrefix: 'ISO date in prose', confidence: 0.85 },
  // English long-form
  { re: /\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})\b/i, reasonPrefix: 'date phrase', confidence: 0.8 },
  { re: /\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December),?\s+\d{4})\b/i, reasonPrefix: 'date phrase', confidence: 0.8 },
  // In-world calendar markers — these are what the spec calls "Year 42" style
  { re: /\b(Year\s+\d+(?:\s+of\s+[A-Z][\w'-]+)?)\b/, reasonPrefix: 'in-world year', confidence: 0.7 },
  { re: /\b(Day\s+\d+(?:\s+of\s+[A-Z][\w'-]+)?)\b/, reasonPrefix: 'in-world day', confidence: 0.65 },
];

export interface DateEstimate {
  value: string;
  reason: string;
  confidence: number;
}

export function estimateDate(text: string): DateEstimate | null {
  for (const { re, reasonPrefix, confidence } of DATE_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const value = (m[1] ?? m[0]).trim();
      return {
        value,
        reason: `${reasonPrefix}: “${value}”`,
        confidence,
      };
    }
  }
  return null;
}

// ─── Character mention detection ───

export interface CharacterMention {
  id: string;
  /** Number of matches; higher count → POV candidate. */
  count: number;
  /** First matched surface form, for the tooltip. */
  matchedAs: string;
}

/**
 * Detect every character entity whose name or alias appears at least once in
 * the prose. Word-boundary matched, case-sensitive on the first letter so
 * "Aria" matches "Aria" but not "aria-label" attributes pasted into a note.
 */
export function detectCharacters(
  text: string,
  characters: ProposalEngineCharacter[],
): CharacterMention[] {
  const out: CharacterMention[] = [];
  for (const c of characters) {
    const aliases = [c.name, ...(c.aliases ?? [])].filter(a => a && a.trim().length > 1);
    let count = 0;
    let matchedAs = '';
    for (const alias of aliases) {
      // Escape regex metacharacters in the alias.
      const escaped = alias.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      // Require word boundary on both sides — "Eira" must not match "Beira".
      const re = new RegExp(`\\b${escaped}\\b`, 'g');
      const matches = text.match(re);
      if (matches && matches.length > 0) {
        count += matches.length;
        if (!matchedAs) matchedAs = alias;
      }
    }
    if (count > 0) out.push({ id: c.id, count, matchedAs });
  }
  // Most-mentioned first — UI uses ordering to pick a POV candidate.
  return out.sort((a, b) => b.count - a.count);
}

// ─── Mood inference ───

// Lexicons are intentionally small and easy to reason about — the
// productive surface for an LLM swap-in is the same returned shape.
const MOOD_LEXICONS: Array<{ mood: string; keywords: string[] }> = [
  { mood: 'tense',       keywords: ['gun', 'knife', 'blade', 'sword', 'scream', 'screamed', 'whisper', 'whispered', 'shadow', 'breath', 'heart pounded', 'pulse', 'silence', 'dread', 'fear', 'trembled', 'gritted'] },
  { mood: 'revelatory',  keywords: ['realized', 'truth', 'revealed', 'discover', 'discovered', 'uncovered', 'understood', 'remembered', 'suddenly', 'recognition'] },
  { mood: 'melancholic', keywords: ['tear', 'tears', 'wept', 'mourn', 'mourned', 'lonely', 'alone', 'empty', 'lost', 'gone', 'farewell', 'goodbye', 'grief', 'sorrow', 'ache'] },
];

export interface MoodEstimate {
  mood: string;
  reason: string;
  confidence: number;
}

export function estimateMood(text: string): MoodEstimate | null {
  const lower = text.toLowerCase();
  let best: { mood: string; hits: number; cue: string } | null = null;
  for (const { mood, keywords } of MOOD_LEXICONS) {
    let hits = 0;
    let cue = '';
    for (const kw of keywords) {
      const re = new RegExp(`\\b${kw.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'g');
      const m = lower.match(re);
      if (m && m.length > 0) {
        hits += m.length;
        if (!cue) cue = kw;
      }
    }
    if (hits > 0 && (!best || hits > best.hits)) {
      best = { mood, hits, cue };
    }
  }
  if (!best) return null;
  // 1 hit → 0.4, 2 → 0.55, 3+ → 0.7 (capped) — keeps proposals modest unless
  // multiple cues line up.
  const confidence = Math.min(0.7, 0.25 + best.hits * 0.15);
  return {
    mood: best.mood,
    reason: `${best.hits} ${best.mood} cue${best.hits > 1 ? 's' : ''} (e.g. “${best.cue}”)`,
    confidence,
  };
}

// ─── Proposal assembly ───

function stableId(sceneId: string, kind: TimelineProposalKind, value: string): string {
  return crypto
    .createHash('sha1')
    .update(`${sceneId}::${kind}::${value}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Build the full proposal set for a single scene. Pure — the caller passes
 * `now` so tests stay deterministic.
 */
export function buildProposalsForScene(
  input: ProposalEngineInput,
  now: string,
): TimelineAIProposal[] {
  const { scene, characters } = input;
  const proposals: TimelineAIProposal[] = [];

  // 1) Date estimation — skipped if the user already set a date.
  if (!scene.current.dateIsUserSet) {
    const d = estimateDate(scene.text);
    if (d) {
      proposals.push({
        id: stableId(scene.sceneId, 'date', d.value),
        sceneId: scene.sceneId,
        kind: 'date',
        value: d.value,
        reason: d.reason,
        confidence: d.confidence,
        source: 'ai',
        isEstimated: true,
        status: 'pending',
        createdAt: now,
      });
    }
  }

  // 2) Characters — propose top hits the scene doesn't already credit.
  const mentions = detectCharacters(scene.text, characters);
  const known = new Set(scene.current.characterIds ?? []);
  const fresh = mentions.filter(m => !known.has(m.id));
  if (fresh.length > 0) {
    const top = fresh.slice(0, 4);
    const value = top.map(m => m.id).join(',');
    const reason = `mentioned: ${top.map(m => `${m.matchedAs}×${m.count}`).join(', ')}`;
    // Confidence scales with the lead mention's hit count.
    const confidence = Math.min(0.85, 0.4 + top[0].count * 0.1);
    proposals.push({
      id: stableId(scene.sceneId, 'characters', value),
      sceneId: scene.sceneId,
      kind: 'characters',
      value,
      reason,
      confidence,
      source: 'ai',
      isEstimated: true,
      status: 'pending',
      createdAt: now,
    });

    // POV — only when there's a clear front-runner (≥2× runner-up) and the
    // user hasn't already set a POV.
    if (!scene.current.pov && fresh.length === 1) {
      // Single mention — propose as POV with modest confidence.
      proposals.push(buildPovProposal(scene.sceneId, fresh[0], now, 0.5));
    } else if (!scene.current.pov && fresh.length >= 2 && fresh[0].count >= fresh[1].count * 2) {
      proposals.push(buildPovProposal(scene.sceneId, fresh[0], now, 0.65));
    }
  }

  // 3) Mood — skipped if user-set.
  if (!scene.current.mood) {
    const m = estimateMood(scene.text);
    if (m && m.confidence >= 0.4) {
      proposals.push({
        id: stableId(scene.sceneId, 'mood', m.mood),
        sceneId: scene.sceneId,
        kind: 'mood',
        value: m.mood,
        reason: m.reason,
        confidence: m.confidence,
        source: 'ai',
        isEstimated: true,
        status: 'pending',
        createdAt: now,
      });
    }
  }

  return proposals;
}

function buildPovProposal(
  sceneId: string,
  mention: CharacterMention,
  now: string,
  confidence: number,
): TimelineAIProposal {
  // POV is encoded as a mood-kind-like character proposal: kind `characters`
  // with a single id is the canonical POV proposal; richer POV inference
  // (named-entity-tagged dialogue analysis) lands in a Phase 2 issue.
  return {
    id: stableId(sceneId, 'characters', `pov:${mention.id}`),
    sceneId,
    kind: 'characters',
    value: `pov:${mention.id}`,
    reason: `POV candidate — ${mention.matchedAs} mentioned ${mention.count}×`,
    confidence,
    source: 'ai',
    isEstimated: true,
    status: 'pending',
    createdAt: now,
  };
}

// ─── Persistence ───

export interface ProposalStore {
  proposals: TimelineAIProposal[];
}

function proposalsPath(vaultRoot: string): string {
  return path.join(vaultRoot, PROPOSALS_FILENAME);
}

export function readProposalStore(vaultRoot: string): ProposalStore {
  const p = proposalsPath(vaultRoot);
  if (!fs.existsSync(p)) return { proposals: [] };
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ProposalStore>;
    return { proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [] };
  } catch {
    return { proposals: [] };
  }
}

export function writeProposalStore(vaultRoot: string, store: ProposalStore): void {
  const p = proposalsPath(vaultRoot);
  fs.writeFileSync(p, JSON.stringify(store, null, 2), 'utf-8');
}

/**
 * Merge a fresh batch of engine-derived proposals into the on-disk store,
 * preserving any previously-resolved (accepted / rejected) records so the
 * UI never re-surfaces something the user already dismissed.
 */
export function mergeProposals(
  existing: TimelineAIProposal[],
  fresh: TimelineAIProposal[],
): TimelineAIProposal[] {
  const byId = new Map<string, TimelineAIProposal>();
  for (const p of existing) byId.set(p.id, p);
  for (const p of fresh) {
    const prior = byId.get(p.id);
    // Keep prior status — re-running the engine must never resurrect a
    // rejected suggestion or re-flag an accepted one.
    if (prior && prior.status !== 'pending') continue;
    byId.set(p.id, p);
  }
  return Array.from(byId.values());
}

/**
 * Filter to a single story's pending proposals, sorted by scene then kind for
 * stable rendering.
 */
export function pendingForScenes(
  proposals: TimelineAIProposal[],
  sceneIds: Set<string>,
): TimelineAIProposal[] {
  return proposals
    .filter(p => p.status === 'pending' && sceneIds.has(p.sceneId))
    .sort((a, b) => {
      if (a.sceneId !== b.sceneId) return a.sceneId.localeCompare(b.sceneId);
      return a.kind.localeCompare(b.kind);
    });
}

/**
 * Apply a status transition to a single proposal in-place. Returns the
 * updated proposal record; returns null when the id is unknown.
 */
export function resolveProposalInStore(
  store: ProposalStore,
  proposalId: string,
  status: Exclude<TimelineProposalStatus, 'pending'>,
  now: string,
): TimelineAIProposal | null {
  const idx = store.proposals.findIndex(p => p.id === proposalId);
  if (idx === -1) return null;
  const updated: TimelineAIProposal = {
    ...store.proposals[idx],
    status,
    resolvedAt: now,
  };
  store.proposals[idx] = updated;
  return updated;
}
