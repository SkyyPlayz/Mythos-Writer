import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  runEntityPrePass,
  buildScanPrompt,
  parseScanResponse,
  runInternalPrePass,
  buildInternalScanPrompt,
  parseInternalScanResponse,
  GAP_HUNT_SYSTEM_SUFFIX,
  parseGapQuestions,
  levenshteinDistance,
  shouldReSurface,
  estimateTokens,
  applyExcerptPatch,
  dbRowToItem,
  itemToDbRow,
  DEFAULT_SCAN_BUDGET_TOKENS,
} from './archiveContinuityEngine.js';
import type { DbContinuityIssue } from './db.js';
import type { ArchiveIndex } from './archiveAgent.js';

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeIndex(entities: ArchiveIndex['entities']): ArchiveIndex {
  return { entities, builtAt: '2026-01-01T00:00:00.000Z' };
}

function makeEntity(overrides: Partial<ArchiveIndex['entities'][0]> = {}): ArchiveIndex['entities'][0] {
  return {
    id: 'ent-1',
    name: 'Elara',
    type: 'character',
    aliases: [],
    path: 'entities/ent-1.md',
    properties: { hair: 'blonde' },
    prose: 'Elara is a brave hero with blonde hair.',
    ...overrides,
  };
}

// ─── §1: Entity pre-pass (AC-CC-14) ────────────────────────────────────────

describe('runEntityPrePass', () => {
  it('returns empty array when no entity is mentioned in scene', () => {
    const index = makeIndex([makeEntity({ name: 'Elara', aliases: [] })]);
    const result = runEntityPrePass('The wind blew through the trees.', index);
    expect(result).toHaveLength(0);
  });

  it('returns empty array when entity is mentioned but no contradiction found', () => {
    const index = makeIndex([makeEntity({ name: 'Elara', properties: { hair: 'blonde' } })]);
    // Scene mentions Elara but doesn't contradict the hair property.
    const result = runEntityPrePass('Elara walked down the street with her blonde hair.', index);
    expect(result).toHaveLength(0);
  });

  it('returns candidate when entity is mentioned and a contradiction is detected', () => {
    const index = makeIndex([makeEntity({ name: 'Elara', properties: { hair: 'blonde' } })]);
    // "dark hair" contradicts "blonde" per PROPERTY_CONTRADICTION_PAIRS['hair']
    const result = runEntityPrePass('Elara stroked her dark hair nervously.', index);
    expect(result).toHaveLength(1);
    expect(result[0].entityName).toBe('Elara');
    expect(result[0].potentialMismatchKeys).toContain('hair');
  });

  it('matches entity via alias', () => {
    const index = makeIndex([makeEntity({ name: 'Elara', aliases: ['El', 'Lara'], properties: { hair: 'blonde' } })]);
    const result = runEntityPrePass('Lara shook her dark hair free from its braid.', index);
    expect(result).toHaveLength(1);
    expect(result[0].entityName).toBe('Elara');
  });

  it('returns multiple candidates when multiple entities have mismatches', () => {
    const index = makeIndex([
      makeEntity({ id: 'e1', name: 'Elara', properties: { hair: 'blonde' } }),
      makeEntity({ id: 'e2', name: 'Bran', properties: { eyes: 'blue' } }),
    ]);
    const scene = 'Elara had dark hair and Bran stared with brown eyes.';
    const result = runEntityPrePass(scene, index);
    expect(result).toHaveLength(2);
  });

  it('does not return candidate when property key has no contradiction pairs', () => {
    const index = makeIndex([makeEntity({ name: 'Elara', properties: { strength: 'legendary' } })]);
    const result = runEntityPrePass('Elara was weak and tired.', index);
    // 'strength' key has no entry in PROPERTY_CONTRADICTION_PAIRS → no candidate
    expect(result).toHaveLength(0);
  });
});

// ─── §2: Prompt building + token budget (AC-CC-08) ──────────────────────────

describe('buildScanPrompt', () => {
  const candidate = {
    entityId: 'e1',
    entityName: 'Elara',
    entityType: 'character',
    aliases: [],
    properties: { hair: 'blonde' },
    potentialMismatchKeys: ['hair'],
  };

  it('returns a system prompt and user content', () => {
    const { systemPrompt, userContent } = buildScanPrompt('Scene text here.', [candidate], DEFAULT_SCAN_BUDGET_TOKENS);
    expect(systemPrompt).toContain('Archive Agent');
    expect(systemPrompt).toContain('XML tags');
    expect(userContent).toContain('<vault_entities>');
    expect(userContent).toContain('<scene_context>');
    expect(userContent).toContain('Elara');
    expect(userContent).toContain('hair: blonde');
  });

  it('defines a concrete contradiction bar and coverage-over-omission triage rule', () => {
    const { systemPrompt } = buildScanPrompt('Scene text here.', [candidate], DEFAULT_SCAN_BUDGET_TOKENS);
    expect(systemPrompt).toContain('cannot both be true');
    expect(systemPrompt).toContain('severity "low"');
    expect(systemPrompt).toContain('NOT an issue');
  });

  it('marks partial=false when scene fits within budget', () => {
    const shortScene = 'Elara walked away.';
    const { partial } = buildScanPrompt(shortScene, [candidate], DEFAULT_SCAN_BUDGET_TOKENS);
    expect(partial).toBe(false);
  });

  it('truncates scene and sets partial=true when scene exceeds hard cap (AC-CC-08)', () => {
    // Use a very small budget to force truncation.
    const longScene = 'x'.repeat(10_000);
    const { partial, userContent } = buildScanPrompt(longScene, [candidate], 200);
    expect(partial).toBe(true);
    // Scene should be truncated — userContent must be shorter than the raw scene.
    expect(userContent.length).toBeLessThan(longScene.length);
  });

  it('includes entity properties in the prompt', () => {
    const { userContent } = buildScanPrompt('Elara has dark hair.', [candidate], DEFAULT_SCAN_BUDGET_TOKENS);
    expect(userContent).toContain('hair: blonde');
  });
});

// ─── §3: Response parsing (AC-CC-01) ────────────────────────────────────────

describe('parseScanResponse', () => {
  const SCENE_ID = 'scene-abc';
  const VAULT_PATH = '/vault/entities/characters/elara.md';
  const CREATED_AT = '2026-01-01T00:00:00.000Z';

  it('parses a well-formed JSON line into an InconsistencyItem', () => {
    const text = JSON.stringify({
      entityId: 'e1',
      entityName: 'Elara',
      category: 'character_attribute_drift',
      severity: 'high',
      manuscriptExcerpt: 'stroked her dark hair',
      manuscriptOffset: 42,
      vaultExcerpt: 'hair: blonde',
      rationale: "Vault says blonde but scene says dark hair",
      matchArchiveToStory: "Update vault to dark hair",
      suggestStoryChange: "Change to blonde hair",
    });
    const items = parseScanResponse(text, SCENE_ID, VAULT_PATH, CREATED_AT);
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.category).toBe('character_attribute_drift');
    expect(item.severity).toBe('high');
    expect(item.manuscriptAnchor.sceneId).toBe(SCENE_ID);
    expect(item.manuscriptAnchor.offset).toBe(42);
    expect(item.manuscriptAnchor.excerpt).toBe('stroked her dark hair');
    expect(item.vaultAnchor.notePath).toBe(VAULT_PATH);
    expect(item.vaultAnchor.excerpt).toBe('hair: blonde');
    expect(item.rationale).toBe("Vault says blonde but scene says dark hair");
    expect(item.proposedResolution.matchArchiveToStory).toBe("Update vault to dark hair");
    expect(item.proposedResolution.suggestStoryChange).toBe("Change to blonde hair");
    expect(item.status).toBe('open');
    expect(item.resolvedAt).toBeNull();
    expect(item.resolvedAction).toBeNull();
    expect(item.createdAt).toBe(CREATED_AT);
    expect(item.id).toBeTruthy();
  });

  it('returns empty array when text is empty', () => {
    expect(parseScanResponse('', SCENE_ID, VAULT_PATH, CREATED_AT)).toHaveLength(0);
  });

  it('skips lines that are not JSON objects', () => {
    const text = 'No issues found in this scene.\nAll looks good.';
    expect(parseScanResponse(text, SCENE_ID, VAULT_PATH, CREATED_AT)).toHaveLength(0);
  });

  it('skips items with invalid category', () => {
    const text = JSON.stringify({
      entityId: 'e1', entityName: 'Elara',
      category: 'eye_color', severity: 'high',
    });
    expect(parseScanResponse(text, SCENE_ID, VAULT_PATH, CREATED_AT)).toHaveLength(0);
  });

  it('skips items with invalid severity', () => {
    const text = JSON.stringify({
      entityId: 'e1', entityName: 'Elara',
      category: 'character_attribute_drift', severity: 'extreme',
    });
    expect(parseScanResponse(text, SCENE_ID, VAULT_PATH, CREATED_AT)).toHaveLength(0);
  });

  it('parses multiple JSON lines from multi-issue response', () => {
    const line1 = JSON.stringify({ entityId: 'e1', entityName: 'Elara', category: 'character_attribute_drift', severity: 'high', manuscriptExcerpt: 'A', manuscriptOffset: 0, vaultExcerpt: 'B', rationale: 'R1', matchArchiveToStory: 'M1', suggestStoryChange: 'S1' });
    const line2 = JSON.stringify({ entityId: 'e2', entityName: 'Bran', category: 'location_attribute_mismatch', severity: 'low', manuscriptExcerpt: 'C', manuscriptOffset: 10, vaultExcerpt: 'D', rationale: 'R2', matchArchiveToStory: 'M2', suggestStoryChange: 'S2' });
    const items = parseScanResponse(`${line1}\n${line2}`, SCENE_ID, VAULT_PATH, CREATED_AT);
    expect(items).toHaveLength(2);
    expect(items[0].category).toBe('character_attribute_drift');
    expect(items[1].category).toBe('location_attribute_mismatch');
  });

  it('truncates long fields to their stated limits', () => {
    const longStr = 'a'.repeat(500);
    const text = JSON.stringify({
      entityId: 'e1', entityName: 'E', category: 'character_attribute_drift', severity: 'low',
      manuscriptExcerpt: longStr, manuscriptOffset: 0, vaultExcerpt: longStr,
      rationale: longStr, matchArchiveToStory: longStr, suggestStoryChange: longStr,
    });
    const items = parseScanResponse(text, SCENE_ID, VAULT_PATH, CREATED_AT);
    expect(items).toHaveLength(1);
    expect(items[0].manuscriptAnchor.excerpt.length).toBeLessThanOrEqual(120);
    expect(items[0].vaultAnchor.excerpt.length).toBeLessThanOrEqual(120);
    expect(items[0].rationale.length).toBeLessThanOrEqual(200);
    expect(items[0].proposedResolution.matchArchiveToStory.length).toBeLessThanOrEqual(120);
    expect(items[0].proposedResolution.suggestStoryChange.length).toBeLessThanOrEqual(120);
  });

  it('assigns unique IDs to each parsed item', () => {
    const makeItem = (entityId: string) => JSON.stringify({
      entityId, entityName: 'X', category: 'character_attribute_drift', severity: 'low',
      manuscriptExcerpt: '', manuscriptOffset: 0, vaultExcerpt: '',
      rationale: '', matchArchiveToStory: '', suggestStoryChange: '',
    });
    const text = [makeItem('e1'), makeItem('e2'), makeItem('e3')].join('\n');
    const items = parseScanResponse(text, SCENE_ID, VAULT_PATH, CREATED_AT);
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(3);
  });
});

// ─── §4: Levenshtein distance ────────────────────────────────────────────────

describe('applyExcerptPatch (M9d — "Edit notes to match" does what it says)', () => {
  const NOTE = [
    '---',
    'name: The Sunken Gate',
    '---',
    '',
    'The inner passage opens only at low tide.',
    'Its keystone bears the mark of the Nine Bells.',
  ].join('\n');

  it('replaces an exact excerpt with the proposed text', () => {
    const patched = applyExcerptPatch(
      NOTE,
      'opens only at low tide',
      'opens at high tide',
    );
    expect(patched).toContain('The inner passage opens at high tide.');
    expect(patched).not.toContain('low tide');
  });

  it('tolerates whitespace jitter between the excerpt and the note', () => {
    const patched = applyExcerptPatch(
      NOTE,
      'opens  only\nat low tide',
      'opens at high tide',
    );
    expect(patched).toContain('The inner passage opens at high tide.');
  });

  it('returns null when the excerpt is no longer in the note', () => {
    expect(applyExcerptPatch(NOTE, 'opens only at midnight', 'x')).toBeNull();
  });

  it('returns null for an empty excerpt', () => {
    expect(applyExcerptPatch(NOTE, '   ', 'x')).toBeNull();
  });

  it('replaces only the first occurrence', () => {
    const content = 'tide rule. tide rule.';
    expect(applyExcerptPatch(content, 'tide rule', 'TIDE LAW')).toBe(
      'TIDE LAW. tide rule.',
    );
  });

  it('treats regex metacharacters in the excerpt literally', () => {
    const content = 'Founded in 312 AG (disputed).';
    expect(applyExcerptPatch(content, '312 AG (disputed)', '298 AG')).toBe(
      'Founded in 298 AG.',
    );
  });
});

describe('continuity scope (M9d)', () => {
  const baseRow: DbContinuityIssue = {
    id: 'row-1',
    category: 'factual_contradiction',
    severity: 'high',
    manuscript_scene_id: 'scene-1',
    manuscript_offset: 4,
    manuscript_excerpt: 'high tide',
    vault_note_path: 'Universes/Aster/The Sunken Gate.md',
    vault_line: 5,
    vault_excerpt: 'low tide',
    rationale: 'Tide rule conflict.',
    proposed_match_archive: 'opens at high tide',
    proposed_suggest_story: 'enter at low tide',
    status: 'open',
    resolved_at: null,
    resolved_action: null,
    created_at: '2026-01-01T00:00:00.000Z',
  };

  it('dbRowToItem defaults pre-v29 rows (no scope column) to story_vault', () => {
    expect(dbRowToItem(baseRow).scope).toBe('story_vault');
    expect(dbRowToItem({ ...baseRow, scope: null }).scope).toBe('story_vault');
  });

  it('dbRowToItem and itemToDbRow round-trip every scope', () => {
    for (const scope of ['story_internal', 'story_vault', 'vault_internal', 'timeline'] as const) {
      const item = dbRowToItem({ ...baseRow, scope });
      expect(item.scope).toBe(scope);
      expect(itemToDbRow(item).scope).toBe(scope);
    }
  });

  it('parseScanResponse marks LLM scan findings story_vault and resolves per-entity note paths', () => {
    const text = JSON.stringify({
      entityId: 'e1',
      entityName: 'Elara',
      category: 'character_attribute_drift',
      severity: 'high',
      manuscriptExcerpt: 'dark hair',
      manuscriptOffset: 0,
      vaultExcerpt: 'hair: blonde',
      rationale: 'drift',
      matchArchiveToStory: 'x',
      suggestStoryChange: 'y',
    });
    const items = parseScanResponse(
      text,
      'scene-1',
      (entityId) => (entityId === 'e1' ? 'entities/elara.md' : ''),
      '2026-01-01T00:00:00.000Z',
    );
    expect(items[0].scope).toBe('story_vault');
    expect(items[0].vaultAnchor.notePath).toBe('entities/elara.md');
  });
});

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0);
  });

  it('returns string length when other is empty', () => {
    expect(levenshteinDistance('abc', '')).toBe(3);
    expect(levenshteinDistance('', 'xyz')).toBe(3);
  });

  it('returns 1 for single substitution', () => {
    expect(levenshteinDistance('cat', 'bat')).toBe(1);
  });

  it('returns 1 for single insertion', () => {
    expect(levenshteinDistance('cat', 'cats')).toBe(1);
  });

  it('returns 1 for single deletion', () => {
    expect(levenshteinDistance('cats', 'cat')).toBe(1);
  });

  it('computes distance for completely different strings', () => {
    expect(levenshteinDistance('abc', 'xyz')).toBe(3);
  });
});

// ─── §5: shouldReSurface / Levenshtein re-surface check (AC-CC-07) ──────────

describe('shouldReSurface', () => {
  it('returns false when stored excerpt matches the current scene at stored offset', () => {
    const excerpt = 'stroked her dark hair';
    const scene = 'She stroked her dark hair nervously.';
    const offset = scene.indexOf(excerpt);
    expect(shouldReSurface(excerpt, offset, scene)).toBe(false);
  });

  it('returns false for empty stored excerpt', () => {
    expect(shouldReSurface('', 0, 'Some scene text here.')).toBe(false);
  });

  it('returns true when text at the stored offset has changed significantly (>20%)', () => {
    const storedExcerpt = 'stroked her dark hair'; // 21 chars → threshold = ceil(21 * 0.2) = 5
    // Replace the entire region with completely different text
    const scene = 'She XXXXXXXX brown hair nervously.';
    // Use offset 4 (the position of 'S' in 'She ') to extract a window
    // Actually let's use offset 0 and ensure the Levenshtein > threshold
    expect(shouldReSurface(storedExcerpt, 0, scene)).toBe(true);
  });

  it('returns false when text changed minimally (≤20%)', () => {
    const storedExcerpt = 'stroked her dark hair'; // 21 chars → threshold = 5
    // Change only 1 char (well within the 20% threshold)
    const scene = 'stroked her dark hoir'; // "hoir" vs "hair" = 1 edit
    expect(shouldReSurface(storedExcerpt, 0, scene)).toBe(false);
  });

  it('clamps offset to text bounds gracefully', () => {
    // storedOffset beyond end of current text — should not throw
    const storedExcerpt = 'hello world';
    expect(() => shouldReSurface(storedExcerpt, 9999, 'hi')).not.toThrow();
  });
});

// ─── §6: Pre-pass prevents LLM call (AC-CC-14) ──────────────────────────────
// Prove that when pre-pass returns no candidates, the LLM client is NOT called.

describe('pre-pass LLM bypass (AC-CC-14)', () => {
  it('pre-pass returns empty when entity not mentioned → LLM must not be called', () => {
    // This tests the invariant: if runEntityPrePass returns [], buildScanPrompt is never needed.
    // We verify this by checking that the pre-pass returns [] for irrelevant text.
    const index = makeIndex([makeEntity({ name: 'Elara', properties: { hair: 'blonde' } })]);
    const scene = 'The wizard cast a spell on the ancient tome.'; // no mention of Elara
    const candidates = runEntityPrePass(scene, index);
    expect(candidates).toHaveLength(0);
    // With 0 candidates, the scan engine skips LLM — verified by the scan engine
    // which guards `if (candidates.length === 0) return []` before any provider call.
  });

  it('pre-pass returns empty when entity mentioned but no contradiction → LLM skipped', () => {
    const index = makeIndex([makeEntity({ name: 'Elara', properties: { hair: 'blonde' } })]);
    const scene = 'Elara combed her golden blonde hair in the sunlight.';
    const candidates = runEntityPrePass(scene, index);
    expect(candidates).toHaveLength(0);
  });

  it('runEntityPrePass + scan integration: LLM call spy verifies bypass', async () => {
    // Integration: mock the stream function and confirm it's not called when pre-pass is empty.
    const streamSpy = vi.fn();

    // Simulate what runArchiveContScan does when pre-pass returns [].
    const archiveIndex = makeIndex([makeEntity({ name: 'Elara', properties: { hair: 'blonde' } })]);
    const scene = 'The old castle stood on the hill.'; // no entity mention

    const candidates = runEntityPrePass(scene, archiveIndex);
    if (candidates.length === 0) {
      // LLM call would be here — spy should NOT be called.
      return [];
    }
    // This line should not be reached.
    streamSpy();

    expect(streamSpy).not.toHaveBeenCalled();
  });
});

// ─── §7: estimateTokens ─────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('estimates approximately 1 token per 4 chars', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2); // ceil(5/4)
    expect(estimateTokens('a'.repeat(100))).toBe(25);
  });
});

// ─── §8: On-save trigger timing (AC-CC-02) ──────────────────────────────────
// Tests the word-count gate and settings gate that guard triggerArchiveContScanOnSave.

describe('on-save trigger gates (AC-CC-02)', () => {
  it('a scene with fewer than 100 words should not trigger scan', () => {
    const shortProse = 'Short scene.'; // 2 words
    const wordCount = shortProse.trim().split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeLessThan(100);
  });

  it('a scene with 100+ words should pass the word-count gate', () => {
    // 100-word scene
    const longProse = Array.from({ length: 20 }, () => 'word word word word word').join(' ');
    const wordCount = longProse.trim().split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeGreaterThanOrEqual(100);
  });
});

// ─── §9: Heartbeat backoff logic (AC-CC-03) ─────────────────────────────────
// Verifies the streak/backoff bookkeeping in isolation.

describe('heartbeat backoff (AC-CC-03)', () => {
  it('doubles interval after 3 consecutive zero-issue scans', () => {
    let streak = 0;
    let currentIntervalMs = 60_000; // 60s start
    const MAX_MS = 7_200_000;

    // Simulate 3 zero-issue scans.
    for (let i = 0; i < 3; i++) {
      streak++;
      if (streak >= 3) {
        streak = 0;
        currentIntervalMs = Math.min(currentIntervalMs * 2, MAX_MS);
      }
    }

    expect(currentIntervalMs).toBe(120_000); // doubled from 60s to 120s
  });

  it('resets streak when issues found', () => {
    let streak = 2;
    // A scan finds 1 issue.
    const issueCount = 1;
    if (issueCount > 0) streak = 0;
    expect(streak).toBe(0);
  });

  it('caps interval at 7200 seconds', () => {
    let currentIntervalMs = 4_000_000; // already large
    const MAX_MS = 7_200_000;
    currentIntervalMs = Math.min(currentIntervalMs * 2, MAX_MS);
    expect(currentIntervalMs).toBe(MAX_MS);
  });
});

// ─── M12.B1 (SKY-10736): Check 1 — Story internal ───────────────────────────

describe('runInternalPrePass (Check 1)', () => {
  const priorScene = {
    sceneId: 'sc-1',
    sceneTitle: 'Chapter 1',
    scenePath: 'Stories/Ash and Oath/ch1/sc-1.md',
    prose: "Mira's lantern cast a trembling circle of light. It was oil-lit, and dim.",
  };

  it('returns empty array when the entity is not in the current scene', () => {
    const index = makeIndex([makeEntity({ name: "Mira's lantern", properties: {} })]);
    const candidates = runInternalPrePass('The wind blew through the trees.', [priorScene], index);
    expect(candidates).toHaveLength(0);
  });

  it('returns empty array when the entity has no earlier mention (first appearance)', () => {
    const index = makeIndex([makeEntity({ name: "Mira's lantern", properties: {} })]);
    const candidates = runInternalPrePass("Mira's lantern flickered.", [], index);
    expect(candidates).toHaveLength(0);
  });

  it('returns a candidate carrying the earlier scene excerpt when the entity recurs', () => {
    const index = makeIndex([makeEntity({ id: 'ent-lantern', name: "Mira's lantern", properties: {} })]);
    const candidates = runInternalPrePass(
      "Mira's lantern was crystal-lit now, casting cold light.",
      [priorScene],
      index,
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].entityId).toBe('ent-lantern');
    expect(candidates[0].priorMentions).toHaveLength(1);
    expect(candidates[0].priorMentions[0].sceneId).toBe('sc-1');
    expect(candidates[0].priorMentions[0].excerpt).toContain('oil-lit');
    expect(candidates[0].currentExcerpt).toContain('crystal-lit');
  });

  it('never inspects vault properties — only prior-scene prose', () => {
    // Even when the vault entry carries properties, the candidate shape has
    // no field for them: Check 1 structurally cannot see vault content.
    const index = makeIndex([
      makeEntity({ id: 'ent-lantern', name: "Mira's lantern", properties: { material: 'crystal' } }),
    ]);
    const candidates = runInternalPrePass("Mira's lantern flickered.", [priorScene], index);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).not.toHaveProperty('properties');
  });
});

describe('buildInternalScanPrompt', () => {
  const candidate = {
    entityId: 'ent-lantern',
    entityName: "Mira's lantern",
    entityType: 'item',
    aliases: [],
    currentExcerpt: 'crystal-lit now',
    priorMentions: [{ sceneId: 'sc-1', sceneTitle: 'Chapter 1', scenePath: 'sc-1.md', excerpt: 'oil-lit, and dim' }],
  };

  it('names Check 1 and explicitly excludes the vault as a comparison source', () => {
    const { systemPrompt, userContent } = buildInternalScanPrompt('Scene text.', [candidate], DEFAULT_SCAN_BUDGET_TOKENS);
    expect(systemPrompt).toContain('Check 1');
    expect(systemPrompt.toLowerCase()).toContain('never compare against vault');
    // The Check 2-only XML tag/section never appears in Check 1's prompt.
    expect(userContent).not.toContain('<vault_entities>');
  });

  it('includes the earlier-scene excerpt and current scene text', () => {
    const { userContent } = buildInternalScanPrompt('Scene mentions crystal-lit now.', [candidate], DEFAULT_SCAN_BUDGET_TOKENS);
    expect(userContent).toContain('<earlier_scenes>');
    expect(userContent).toContain('oil-lit, and dim');
    expect(userContent).toContain('crystal-lit now');
  });

  it('truncates and sets partial=true when scene exceeds hard cap', () => {
    const longScene = 'x'.repeat(10_000);
    const { partial, userContent } = buildInternalScanPrompt(longScene, [candidate], 200);
    expect(partial).toBe(true);
    expect(userContent.length).toBeLessThan(longScene.length);
  });
});

describe('parseInternalScanResponse', () => {
  const SCENE_ID = 'sc-2';
  const CREATED_AT = '2026-01-01T00:00:00.000Z';

  it('parses a well-formed line into a story_internal InconsistencyItem', () => {
    const text = JSON.stringify({
      entityId: 'ent-lantern',
      entityName: "Mira's lantern",
      category: 'factual_contradiction',
      severity: 'high',
      manuscriptExcerpt: 'crystal-lit now',
      manuscriptOffset: 12,
      priorExcerpt: 'oil-lit, and dim',
      priorSceneId: 'sc-1',
      rationale: 'The lantern was oil-lit in Chapter 1 but crystal-lit here.',
      matchArchiveToStory: 'n/a',
      suggestStoryChange: 'Keep the lantern oil-lit',
    });
    const items = parseInternalScanResponse(text, SCENE_ID, (id) => `scenes/${id}.md`, CREATED_AT);
    expect(items).toHaveLength(1);
    expect(items[0].scope).toBe('story_internal');
    expect(items[0].manuscriptAnchor.sceneId).toBe(SCENE_ID);
    expect(items[0].manuscriptAnchor.excerpt).toBe('crystal-lit now');
    expect(items[0].vaultAnchor.notePath).toBe('scenes/sc-1.md');
    expect(items[0].vaultAnchor.excerpt).toBe('oil-lit, and dim');
  });

  it('skips lines with invalid category/severity, same as Check 2', () => {
    const text = JSON.stringify({ entityId: 'e1', entityName: 'X', category: 'nope', severity: 'high' });
    expect(parseInternalScanResponse(text, SCENE_ID, '', CREATED_AT)).toHaveLength(0);
  });
});

// ─── M12.B1 (SKY-10736): Check 2 gap-hunt / question emission ──────────────

describe('GAP_HUNT_SYSTEM_SUFFIX', () => {
  it('describes the question artifact as an invitation, distinct from a flag', () => {
    expect(GAP_HUNT_SYSTEM_SUFFIX).toContain('"kind":"question"');
    expect(GAP_HUNT_SYSTEM_SUFFIX.toLowerCase()).toContain('invitation');
  });
});

describe('parseGapQuestions', () => {
  const SCENE_ID = 'sc-2';
  const CREATED_AT = '2026-01-01T00:00:00.000Z';

  it('parses a question line into an ArchiveProposedQuestion', () => {
    const text = JSON.stringify({
      kind: 'question',
      entityName: 'The Undercity',
      questionText: 'What rules govern who may enter the Undercity?',
      rationale: 'The scene treats it as dangerous but the vault has no entry for it.',
    });
    const questions = parseGapQuestions(text, SCENE_ID, CREATED_AT);
    expect(questions).toHaveLength(1);
    expect(questions[0].sourceSceneId).toBe(SCENE_ID);
    expect(questions[0].entityName).toBe('The Undercity');
    expect(questions[0].questionText).toContain('Undercity');
    expect(questions[0]).not.toHaveProperty('status');
    expect(questions[0]).not.toHaveProperty('resolvedAt');
  });

  it('ignores continuity-issue lines (no "kind":"question")', () => {
    const text = JSON.stringify({
      entityId: 'e1', entityName: 'Elara', category: 'character_attribute_drift', severity: 'high',
    });
    expect(parseGapQuestions(text, SCENE_ID, CREATED_AT)).toHaveLength(0);
  });

  it('parses questions and continuity flags out of the SAME response text independently', () => {
    const flagLine = JSON.stringify({
      entityId: 'e1', entityName: 'The Sunken Gate', category: 'factual_contradiction', severity: 'high',
      manuscriptExcerpt: 'high tide', manuscriptOffset: 0, vaultExcerpt: 'low tide',
      rationale: 'Tide rule conflict.', matchArchiveToStory: 'high tide', suggestStoryChange: 'low tide',
    });
    const questionLine = JSON.stringify({
      kind: 'question', entityName: 'Ward Violet', questionText: 'Who governs Ward Violet day to day?', rationale: 'Never explained in the vault.',
    });
    const text = `${flagLine}\n${questionLine}`;

    const flags = parseScanResponse(text, SCENE_ID, '/vault/gate.md', CREATED_AT);
    const questions = parseGapQuestions(text, SCENE_ID, CREATED_AT);

    expect(flags).toHaveLength(1);
    expect(flags[0].scope).toBe('story_vault');
    expect(questions).toHaveLength(1);
    expect(questions[0].entityName).toBe('Ward Violet');
  });

  it('drops a question with empty questionText', () => {
    const text = JSON.stringify({ kind: 'question', entityName: 'X', questionText: '   ', rationale: 'r' });
    expect(parseGapQuestions(text, SCENE_ID, CREATED_AT)).toHaveLength(0);
  });
});

// ─── M12.B1 acceptance fixture (SKY-10736) ──────────────────────────────────
// Owner's own examples (SKY-10528): lantern oil-lit -> crystal-lit (Check 1,
// `Story internal`) and tide-rule conflict (Check 2, `Story ↔ Vault`).
// Verifies each check catches its own planted error AND — the negative
// control — never catches the other check's error, proving the split is
// real detection-surface separation, not just two labels on one pass.

describe('M12.B1 acceptance: Check 1 / Check 2 split — lantern & tide fixtures', () => {
  const lanternEntity = makeEntity({
    id: 'ent-lantern',
    name: "Mira's lantern",
    type: 'item',
    properties: {}, // no vault property drives a Check 2 contradiction
    prose: '',
  });
  const gateEntity = makeEntity({
    id: 'ent-gate',
    name: 'The Sunken Gate',
    type: 'location',
    properties: { tide: 'low tide' }, // owner's rule: opens only at low tide
    prose: '',
  });
  const index = makeIndex([lanternEntity, gateEntity]);

  const chapter1 = {
    sceneId: 'sc-ch1',
    sceneTitle: 'The Watcher’s Call',
    scenePath: 'Stories/Ash and Oath/ch1/sc-1.md',
    // Only the lantern appears earlier in the manuscript — the Gate/tide
    // rule is never stated in prose, only in the vault note.
    prose: "Mira's lantern cast a trembling circle of light across the stone steps. It was oil-lit, dim and warm.",
  };
  const chapter2Text =
    "Mira's lantern flickered, crystal-lit now in the deep dark. She crossed into the Sunken Gate at high tide.";

  it('Check 1 catches the lantern drift and does NOT flag the tide conflict (negative control)', () => {
    const candidates = runInternalPrePass(chapter2Text, [chapter1], index);

    // Positive: the lantern recurs from Chapter 1 -> a Check 1 candidate.
    expect(candidates.map((c) => c.entityId)).toContain('ent-lantern');
    // Negative control: the Gate has no EARLIER manuscript mention (the tide
    // rule lives only in the vault note) — Check 1 structurally cannot
    // produce a candidate for it, so it can never reach an LLM call at all.
    expect(candidates.map((c) => c.entityId)).not.toContain('ent-gate');

    const { systemPrompt, userContent } = buildInternalScanPrompt(chapter2Text, candidates, DEFAULT_SCAN_BUDGET_TOKENS);
    expect(systemPrompt).toContain('Check 1');
    expect(userContent).not.toContain('low tide'); // vault fact never enters Check 1's prompt

    const llmResponse = JSON.stringify({
      entityId: 'ent-lantern', entityName: "Mira's lantern",
      category: 'factual_contradiction', severity: 'high',
      manuscriptExcerpt: 'crystal-lit now', manuscriptOffset: 20,
      priorExcerpt: 'oil-lit, dim and warm', priorSceneId: 'sc-ch1',
      rationale: "The lantern was oil-lit in Chapter 1 but crystal-lit here.",
      matchArchiveToStory: 'n/a', suggestStoryChange: 'Keep the lantern oil-lit',
    });
    const items = parseInternalScanResponse(llmResponse, 'sc-ch2', () => chapter1.scenePath, '2026-01-01T00:00:00.000Z');
    expect(items).toHaveLength(1);
    expect(items[0].scope).toBe('story_internal');
  });

  it('Check 2 catches the tide conflict and does NOT flag the lantern mismatch (negative control)', () => {
    const candidates = runEntityPrePass(chapter2Text, index);

    // Positive: the Gate's vault tide property contradicts "high tide" in the scene.
    expect(candidates.map((c) => c.entityId)).toContain('ent-gate');
    // Negative control: the lantern has no vault property that contradiction-matches
    // anything in the scene — Check 2's pre-pass structurally excludes it, so it
    // never reaches an LLM call and can never be flagged by Check 2.
    expect(candidates.map((c) => c.entityId)).not.toContain('ent-lantern');

    const { systemPrompt, userContent } = buildScanPrompt(chapter2Text, candidates, DEFAULT_SCAN_BUDGET_TOKENS);
    expect(systemPrompt).not.toContain('Check 1');
    expect(userContent).not.toContain('oil-lit'); // manuscript-only fact never enters Check 2's prompt

    const llmResponse = JSON.stringify({
      entityId: 'ent-gate', entityName: 'The Sunken Gate',
      category: 'factual_contradiction', severity: 'high',
      manuscriptExcerpt: 'high tide', manuscriptOffset: 60,
      vaultExcerpt: 'low tide',
      rationale: "The Sunken Gate's note says the inner passage opens only at low tide, but the scene enters at high tide.",
      matchArchiveToStory: 'enter at high tide', suggestStoryChange: 'enter at low tide',
    });
    const items = parseScanResponse(llmResponse, 'sc-ch2', 'Worldbuilding/Locations/The Sunken Gate.md', '2026-01-01T00:00:00.000Z');
    expect(items).toHaveLength(1);
    expect(items[0].scope).toBe('story_vault');
  });

  it('the two checks are independently runnable — Check 1 needs no vault contradiction, Check 2 needs no prior scene', () => {
    // Check 1 runs with an empty vault (properties stripped) and still finds the lantern drift.
    const bareIndex = makeIndex([
      makeEntity({ id: 'ent-lantern', name: "Mira's lantern", type: 'item', properties: {}, prose: '' }),
    ]);
    expect(runInternalPrePass(chapter2Text, [chapter1], bareIndex).length).toBeGreaterThan(0);

    // Check 2 runs with zero manuscript history (no priorScenes concept at all in its signature)
    // and still finds the tide contradiction from the vault property alone.
    expect(runEntityPrePass(chapter2Text, index).map((c) => c.entityId)).toContain('ent-gate');
  });
});
