import { describe, it, expect } from 'vitest';
import {
  getReciprocal,
  serializeRelations,
  parseRelationsBlock,
  stripRelationsBlock,
  detectRelationSuggestions,
} from './entityRelations.js';
import type { EntityRelation } from './entityRelations.js';
import type { ArchiveIndex } from './archiveAgent.js';

// ─── getReciprocal ───

describe('getReciprocal', () => {
  it('returns the symmetric reciprocal for symmetric relations', () => {
    expect(getReciprocal('married to')).toBe('married to');
    expect(getReciprocal('sibling of')).toBe('sibling of');
    expect(getReciprocal('ally of')).toBe('ally of');
    expect(getReciprocal('enemy of')).toBe('enemy of');
  });

  it('returns the inverse for asymmetric relations', () => {
    expect(getReciprocal('parent of')).toBe('child of');
    expect(getReciprocal('child of')).toBe('parent of');
    expect(getReciprocal('mentor of')).toBe('student of');
    expect(getReciprocal('student of')).toBe('mentor of');
    expect(getReciprocal('rules over')).toBe('ruled by');
    expect(getReciprocal('ruled by')).toBe('rules over');
    expect(getReciprocal('creator of')).toBe('created by');
    expect(getReciprocal('created by')).toBe('creator of');
    expect(getReciprocal('serves')).toBe('served by');
    expect(getReciprocal('served by')).toBe('serves');
  });

  it('returns the input unchanged for unknown relation types', () => {
    expect(getReciprocal('knows of')).toBe('knows of');
    expect(getReciprocal('loves')).toBe('loves');
  });

  it('is case-insensitive for lookup', () => {
    expect(getReciprocal('Parent Of')).toBe('child of');
    expect(getReciprocal('MARRIED TO')).toBe('married to');
  });
});

// ─── serializeRelations / parseRelationsBlock ───

describe('serializeRelations', () => {
  it('returns empty string for empty array', () => {
    expect(serializeRelations([])).toBe('');
  });

  it('serializes a single relation as YAML block', () => {
    const rels: EntityRelation[] = [{ type: 'married to', target: 'ent-abc' }];
    const out = serializeRelations(rels);
    expect(out).toContain('relations:');
    expect(out).toContain('  - type: married to');
    expect(out).toContain('    target: ent-abc');
  });

  it('serializes multiple relations', () => {
    const rels: EntityRelation[] = [
      { type: 'parent of', target: 'ent-child' },
      { type: 'sibling of', target: 'ent-sib' },
    ];
    const out = serializeRelations(rels);
    expect(out).toContain('  - type: parent of');
    expect(out).toContain('    target: ent-child');
    expect(out).toContain('  - type: sibling of');
    expect(out).toContain('    target: ent-sib');
  });
});

describe('parseRelationsBlock', () => {
  it('returns empty array for frontmatter with no relations block', () => {
    const fm = 'id: abc\nname: Elara\ntype: character\n';
    expect(parseRelationsBlock(fm)).toHaveLength(0);
  });

  it('parses a single relation', () => {
    const fm = 'id: abc\nname: Elara\ntype: character\nrelations:\n  - type: married to\n    target: ent-xyz\n';
    const rels = parseRelationsBlock(fm);
    expect(rels).toHaveLength(1);
    expect(rels[0].type).toBe('married to');
    expect(rels[0].target).toBe('ent-xyz');
  });

  it('parses multiple relations', () => {
    const fm = [
      'id: abc',
      'name: Elara',
      'relations:',
      '  - type: parent of',
      '    target: ent-child1',
      '  - type: sibling of',
      '    target: ent-sib',
    ].join('\n') + '\n';
    const rels = parseRelationsBlock(fm);
    expect(rels).toHaveLength(2);
    expect(rels[0]).toEqual({ type: 'parent of', target: 'ent-child1' });
    expect(rels[1]).toEqual({ type: 'sibling of', target: 'ent-sib' });
  });

  it('round-trips serialize then parse correctly', () => {
    const original: EntityRelation[] = [
      { type: 'mentor of', target: 'ent-student' },
      { type: 'ally of', target: 'ent-ally' },
    ];
    const serialized = serializeRelations(original);
    const parsed = parseRelationsBlock(serialized);
    expect(parsed).toEqual(original);
  });
});

describe('stripRelationsBlock', () => {
  it('removes the relations block from frontmatter text', () => {
    const fm = 'id: abc\nname: Elara\nrelations:\n  - type: married to\n    target: ent-x\ncreatedAt: 2024\n';
    const stripped = stripRelationsBlock(fm);
    expect(stripped).not.toContain('relations:');
    expect(stripped).toContain('id: abc');
    expect(stripped).toContain('createdAt: 2024');
  });

  it('leaves text unchanged when no relations block', () => {
    const fm = 'id: abc\nname: Elara\ntype: character\n';
    expect(stripRelationsBlock(fm)).toBe(fm);
  });
});

// ─── detectRelationSuggestions ───

function makeIndex(entities: Array<{ id: string; name: string; type: string; aliases?: string[] }>): ArchiveIndex {
  return {
    entities: entities.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type as 'character' | 'location' | 'item' | 'concept' | 'other',
      aliases: e.aliases ?? [],
      properties: {},
      prose: '',
    })),
    builtAt: '2024-01-01T00:00:00.000Z',
  };
}

describe('detectRelationSuggestions', () => {
  it('detects "are siblings" pattern', () => {
    const index = makeIndex([
      { id: 'ent-a', name: 'Elara', type: 'character' },
      { id: 'ent-b', name: 'Marcus', type: 'character' },
    ]);
    const text = 'Elara and Marcus are siblings, raised together in the keep.';
    const results = detectRelationSuggestions(text, index);
    expect(results.length).toBeGreaterThan(0);
    const r = results[0];
    expect(r.source_agent).toBe('archive');
    expect(r.status).toBe('proposed');
    const payload = JSON.parse(r.payload_json!);
    expect(payload.kind).toBe('typed-relation');
    expect(payload.relationType).toBe('sibling of');
  });

  it('detects "married to" pattern', () => {
    const index = makeIndex([
      { id: 'ent-a', name: 'Elara', type: 'character' },
      { id: 'ent-b', name: 'Dorian', type: 'character' },
    ]);
    const text = 'Elara is married to Dorian since the war ended.';
    const results = detectRelationSuggestions(text, index);
    expect(results.length).toBeGreaterThan(0);
    const payload = JSON.parse(results[0].payload_json!);
    expect(payload.relationType).toBe('married to');
    expect(payload.sourceEntityId).toBe('ent-a');
    expect(payload.targetEntityId).toBe('ent-b');
  });

  it('detects "parent of" pattern', () => {
    const index = makeIndex([
      { id: 'ent-king', name: 'Aldric', type: 'character' },
      { id: 'ent-prince', name: 'Riven', type: 'character' },
    ]);
    const text = 'Aldric is the parent of Riven.';
    const results = detectRelationSuggestions(text, index);
    const payload = JSON.parse(results[0].payload_json!);
    expect(payload.relationType).toBe('parent of');
  });

  it('detects "are allies" pattern', () => {
    const index = makeIndex([
      { id: 'ent-a', name: 'Vara', type: 'character' },
      { id: 'ent-b', name: 'Kess', type: 'character' },
    ]);
    const text = 'Vara and Kess are allies against the empire.';
    const results = detectRelationSuggestions(text, index);
    const payload = JSON.parse(results[0].payload_json!);
    expect(payload.relationType).toBe('ally of');
  });

  it('returns empty array when no entities match', () => {
    const index = makeIndex([
      { id: 'ent-a', name: 'Elara', type: 'character' },
    ]);
    const text = 'Elara and UnknownPerson are siblings.';
    const results = detectRelationSuggestions(text, index);
    expect(results).toHaveLength(0);
  });

  it('deduplicates matching the same relation pair twice', () => {
    const index = makeIndex([
      { id: 'ent-a', name: 'Elara', type: 'character' },
      { id: 'ent-b', name: 'Marcus', type: 'character' },
    ]);
    const text = 'Elara and Marcus are siblings. Marcus and Elara are siblings.';
    const results = detectRelationSuggestions(text, index);
    const siblingResults = results.filter((r) => {
      const p = JSON.parse(r.payload_json!);
      return p.relationType === 'sibling of';
    });
    expect(siblingResults).toHaveLength(1);
  });

  it('does not match when entity names are not in index', () => {
    const index = makeIndex([]);
    const text = 'Elara is married to Dorian.';
    expect(detectRelationSuggestions(text, index)).toHaveLength(0);
  });

  it('sets correct payload fields', () => {
    const index = makeIndex([
      { id: 'ent-a', name: 'Elara', type: 'character' },
      { id: 'ent-b', name: 'Dorian', type: 'character' },
    ]);
    const text = 'Elara is married to Dorian.';
    const [r] = detectRelationSuggestions(text, index);
    const p = JSON.parse(r.payload_json!);
    expect(p.kind).toBe('typed-relation');
    expect(p.sourceEntityId).toBe('ent-a');
    expect(p.sourceEntityName).toBe('Elara');
    expect(p.targetEntityId).toBe('ent-b');
    expect(p.targetEntityName).toBe('Dorian');
    expect(p.sourceEntityPath).toContain('ent-a');
    expect(p.targetEntityPath).toContain('ent-b');
  });

  it('matches via aliases', () => {
    const index = makeIndex([
      { id: 'ent-a', name: 'Elara Voss', type: 'character', aliases: ['Elara'] },
      { id: 'ent-b', name: 'Marcus Drenn', type: 'character', aliases: ['Marcus'] },
    ]);
    const text = 'Elara and Marcus are siblings.';
    const results = detectRelationSuggestions(text, index);
    expect(results.length).toBeGreaterThan(0);
  });

  it('golden prompt test: extracts relation type from complex transcript', () => {
    const index = makeIndex([
      { id: 'ent-queen', name: 'Seraphine', type: 'character' },
      { id: 'ent-knight', name: 'Aldren', type: 'character' },
    ]);
    const transcript = `
      Let me think about these characters more deeply.
      Seraphine is the ruler of the eastern provinces.
      Aldren is a mentor to Seraphine since childhood.
      They have a complex dynamic.
    `;
    const results = detectRelationSuggestions(transcript, index);
    const types = results.map((r) => JSON.parse(r.payload_json!).relationType);
    expect(types).toContain('mentor of');
  });
});
