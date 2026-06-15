// Unit tests for the entry quick-enrich helpers (SKY-324).
// No Electron, no network, no filesystem — pure logic only.

import { describe, it, expect } from 'vitest';
import { entityTypeToFactType, buildEnrichmentSystemPrompt, parseFacts } from './brainstormAgent.js';

// ─── entityTypeToFactType ───

describe('entityTypeToFactType', () => {
  it('maps "character" → "character"', () => {
    expect(entityTypeToFactType('character')).toBe('character');
  });

  it('maps "location" → "location"', () => {
    expect(entityTypeToFactType('location')).toBe('location');
  });

  it('maps "item" → "item"', () => {
    expect(entityTypeToFactType('item')).toBe('item');
  });

  it('maps "concept" → "inbox"', () => {
    expect(entityTypeToFactType('concept')).toBe('inbox');
  });

  it('maps "other" → "inbox"', () => {
    expect(entityTypeToFactType('other')).toBe('inbox');
  });

  it('maps unknown types → "inbox"', () => {
    expect(entityTypeToFactType('organization')).toBe('inbox');
    expect(entityTypeToFactType('')).toBe('inbox');
  });
});

// ─── buildEnrichmentSystemPrompt ───

describe('buildEnrichmentSystemPrompt', () => {
  it('includes the entity name in the prompt', () => {
    const prompt = buildEnrichmentSystemPrompt('Aria Voss', 'character');
    expect(prompt).toContain('Aria Voss');
  });

  it('includes the fact type in the FACT tag template', () => {
    const prompt = buildEnrichmentSystemPrompt('The Iron Gate', 'location');
    expect(prompt).toContain('[FACT:location|The Iron Gate|');
  });

  it('uses "concept or worldbuilding element" label for inbox type', () => {
    const prompt = buildEnrichmentSystemPrompt('Magic System', 'inbox');
    expect(prompt).toContain('concept or worldbuilding element');
  });

  it('uses the fact type as the label for character/location/item', () => {
    expect(buildEnrichmentSystemPrompt('Sword', 'item')).toContain('item');
    expect(buildEnrichmentSystemPrompt('Cave', 'location')).toContain('location');
    expect(buildEnrichmentSystemPrompt('Hero', 'character')).toContain('character');
  });

  it('instructs exactly one FACT tag', () => {
    const prompt = buildEnrichmentSystemPrompt('Lyra', 'character');
    expect(prompt).toContain('exactly one structured fact tag');
  });

  it('returns a non-empty string', () => {
    const prompt = buildEnrichmentSystemPrompt('Lyra', 'character');
    expect(prompt.trim().length).toBeGreaterThan(0);
  });
});

// ─── round-trip: prompt → parseFacts ───
// Verify that a response following the prompt template is correctly parsed.

describe('enrichment prompt → parseFacts round-trip', () => {
  it('extracts the fact from a well-formed enrichment response', () => {
    const simulatedResponse = [
      'Aria Voss is a skilled street thief operating in the shadow markets of Velorum.',
      'She has a hidden talent for arcane detection that she keeps secret from her guild.',
      '',
      '[FACT:character|Aria Voss|A cunning rogue with latent magical ability]',
    ].join('\n');
    const facts = parseFacts(simulatedResponse);
    expect(facts).toHaveLength(1);
    expect(facts[0].type).toBe('character');
    expect(facts[0].name).toBe('Aria Voss');
    expect(facts[0].description).toBe('A cunning rogue with latent magical ability');
  });

  it('returns empty array when model omits the FACT tag', () => {
    const simulatedResponse = 'Aria Voss is a brave character with many adventures ahead.';
    const facts = parseFacts(simulatedResponse);
    expect(facts).toHaveLength(0);
  });

  it('handles the inbox fact type from a concept entity', () => {
    const simulatedResponse = 'The magic system works by channelling life force.\n[FACT:inbox|Magic System|Spells require sacrifice of vitality]';
    const facts = parseFacts(simulatedResponse);
    expect(facts).toHaveLength(1);
    expect(facts[0].type).toBe('inbox');
    expect(facts[0].name).toBe('Magic System');
  });
});
