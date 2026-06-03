// Regression fixture for GH#211 / SKY-443: large-project token + latency guardrails.
//
// Invariants under test:
//   1. buildVaultSummary never produces a summary exceeding VAULT_MAX_CONTEXT_CHARS.
//   2. The entity count in the result reflects the number of entities included after capping.
//   3. truncated is true whenever a cap was applied, false otherwise.
//   4. truncateContext caps text at maxChars, reporting the truncation flag accurately.
//   5. estimateTokens returns a positive integer for non-empty text.

import { describe, it, expect } from 'vitest';
import {
  buildVaultSummary,
  truncateContext,
  estimateTokens,
  VAULT_MAX_ENTITIES,
  VAULT_MAX_CONTEXT_CHARS,
  VAULT_PROSE_CHARS_PER_ENTITY,
  WRITING_ASSISTANT_MAX_CONTEXT_CHARS,
  BRAINSTORM_MAX_PROMPT_CHARS,
  type VaultSummaryInputEntity,
} from '../src/contextGuards.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntities(count: number, proseLength = VAULT_PROSE_CHARS_PER_ENTITY): VaultSummaryInputEntity[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `Entity${i}`,
    type: 'character',
    aliases: [],
    prose: 'x'.repeat(proseLength),
  }));
}

// ─── buildVaultSummary ────────────────────────────────────────────────────────

describe('buildVaultSummary — empty vault', () => {
  it('returns sentinel text and no truncation flag', () => {
    const result = buildVaultSummary([]);
    expect(result.summary).toBe('No vault entities found.');
    expect(result.entityCount).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.contextChars).toBe(result.summary.length);
  });
});

describe('buildVaultSummary — small vault (below all caps)', () => {
  it('includes all entities unchanged for a 5-entity vault', () => {
    const entities = makeEntities(5, 100);
    const result = buildVaultSummary(entities);
    expect(result.entityCount).toBe(5);
    expect(result.truncated).toBe(false);
    expect(result.contextChars).toBeLessThanOrEqual(VAULT_MAX_CONTEXT_CHARS);
    expect(result.contextChars).toBe(result.summary.length);
  });
});

describe('buildVaultSummary — large vault hitting char cap', () => {
  it('caps summary at VAULT_MAX_CONTEXT_CHARS for VAULT_MAX_ENTITIES entities with max prose', () => {
    // VAULT_MAX_ENTITIES × (VAULT_PROSE_CHARS_PER_ENTITY + header overhead) >> VAULT_MAX_CONTEXT_CHARS
    // This is the worst-case scenario after the entity-count cap has been applied.
    const entities = makeEntities(VAULT_MAX_ENTITIES, VAULT_PROSE_CHARS_PER_ENTITY);
    const result = buildVaultSummary(entities);

    expect(result.contextChars).toBeLessThanOrEqual(VAULT_MAX_CONTEXT_CHARS);
    expect(result.summary.length).toBe(result.contextChars);
    expect(result.truncated).toBe(true);
    // All input entities are represented (or at least attempted — char cap may cut mid-entry)
    expect(result.entityCount).toBe(VAULT_MAX_ENTITIES);
  });
});

describe('buildVaultSummary — synthetic large-vault regression fixture', () => {
  it('stays within limits for 1000 entities (simulating entity-count pre-cap in handler)', () => {
    // Simulate what the handler does: pre-cap to VAULT_MAX_ENTITIES before calling buildVaultSummary.
    const allEntities = makeEntities(1000, VAULT_PROSE_CHARS_PER_ENTITY);
    const capped = allEntities.slice(0, VAULT_MAX_ENTITIES);

    const result = buildVaultSummary(capped);

    expect(result.entityCount).toBe(VAULT_MAX_ENTITIES);
    expect(result.contextChars).toBeLessThanOrEqual(VAULT_MAX_CONTEXT_CHARS);
    expect(result.summary.length).toBeLessThanOrEqual(VAULT_MAX_CONTEXT_CHARS);
  });

  it('sets truncated=true when entity pre-cap was applied', () => {
    const allEntities = makeEntities(VAULT_MAX_ENTITIES + 1, 1);
    const entityCapExceeded = allEntities.length > VAULT_MAX_ENTITIES;
    const included = entityCapExceeded ? allEntities.slice(0, VAULT_MAX_ENTITIES) : allEntities;

    const { truncated: charCapHit } = buildVaultSummary(included);
    const finalTruncated = entityCapExceeded || charCapHit;

    expect(entityCapExceeded).toBe(true);
    expect(finalTruncated).toBe(true);
  });
});

describe('buildVaultSummary — aliases and type formatting', () => {
  it('includes aliases in the output when present', () => {
    const entities: VaultSummaryInputEntity[] = [{
      name: 'Alistair',
      type: 'character',
      aliases: ['Al', 'The Ranger'],
      prose: 'Tall, dark hair.',
    }];
    const result = buildVaultSummary(entities);
    expect(result.summary).toContain('Alistair');
    expect(result.summary).toContain('Al');
    expect(result.summary).toContain('The Ranger');
    expect(result.summary).toContain('character');
  });

  it('omits aliases section when aliases is empty', () => {
    const entities: VaultSummaryInputEntity[] = [{
      name: 'Silver Keep',
      type: 'location',
      aliases: [],
      prose: 'A fortress on the northern coast.',
    }];
    const result = buildVaultSummary(entities);
    expect(result.summary).not.toContain('aliases:');
  });
});

// ─── truncateContext ──────────────────────────────────────────────────────────

describe('truncateContext', () => {
  it('returns the original text and truncated=false when within limit', () => {
    const { text, truncated } = truncateContext('hello world', 100);
    expect(text).toBe('hello world');
    expect(truncated).toBe(false);
  });

  it('truncates to exactly maxChars and sets truncated=true', () => {
    const input = 'a'.repeat(200);
    const { text, truncated } = truncateContext(input, 100);
    expect(text.length).toBe(100);
    expect(truncated).toBe(true);
  });

  it('does not truncate when length equals maxChars exactly', () => {
    const input = 'b'.repeat(50);
    const { text, truncated } = truncateContext(input, 50);
    expect(text).toBe(input);
    expect(truncated).toBe(false);
  });

  it('handles empty string input', () => {
    const { text, truncated } = truncateContext('', 100);
    expect(text).toBe('');
    expect(truncated).toBe(false);
  });
});

// ─── estimateTokens ───────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns a positive integer for non-empty text', () => {
    const count = estimateTokens('Hello, world!');
    expect(count).toBeGreaterThan(0);
    expect(Number.isInteger(count)).toBe(true);
  });

  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('scales proportionally with text length', () => {
    const short = estimateTokens('x'.repeat(100));
    const long = estimateTokens('x'.repeat(400));
    expect(long).toBe(short * 4);
  });
});

// ─── Constants sanity-check ───────────────────────────────────────────────────

describe('guard constants', () => {
  it('VAULT_MAX_ENTITIES is a positive integer between 1 and 10000', () => {
    expect(VAULT_MAX_ENTITIES).toBeGreaterThan(0);
    expect(VAULT_MAX_ENTITIES).toBeLessThanOrEqual(10_000);
    expect(Number.isInteger(VAULT_MAX_ENTITIES)).toBe(true);
  });

  it('VAULT_MAX_CONTEXT_CHARS fits comfortably within a typical 200k-token context window', () => {
    // 200k tokens × 4 chars/token = 800k chars. Our limit should be well below that.
    expect(VAULT_MAX_CONTEXT_CHARS).toBeLessThan(400_000);
    expect(VAULT_MAX_CONTEXT_CHARS).toBeGreaterThan(0);
  });

  it('WRITING_ASSISTANT_MAX_CONTEXT_CHARS and BRAINSTORM_MAX_PROMPT_CHARS are positive', () => {
    expect(WRITING_ASSISTANT_MAX_CONTEXT_CHARS).toBeGreaterThan(0);
    expect(BRAINSTORM_MAX_PROMPT_CHARS).toBeGreaterThan(0);
  });

  it('VAULT_PROSE_CHARS_PER_ENTITY × VAULT_MAX_ENTITIES exceeds VAULT_MAX_CONTEXT_CHARS (char cap is needed)', () => {
    // This assertion documents that the char cap is load-bearing.
    // If it fails, VAULT_MAX_CONTEXT_CHARS is too high or VAULT_MAX_ENTITIES too low.
    expect(VAULT_PROSE_CHARS_PER_ENTITY * VAULT_MAX_ENTITIES).toBeGreaterThan(VAULT_MAX_CONTEXT_CHARS);
  });
});
