// M16: unit tests for the line-preserving frontmatter editor.
import { describe, it, expect } from 'vitest';
import {
  parseNoteFrontmatter,
  setFrontmatterField,
  removeFrontmatterField,
  setFrontmatterTags,
  quoteFrontmatterValue,
} from './noteFrontmatter';

const TEMPLATE_NOTE = `---
title: "Mira Veynn"
type: character
createdAt: 2026-07-01T00:00:00.000Z
---

# Mira Veynn

## Bio
`;

describe('parseNoteFrontmatter', () => {
  it('returns hasFrontmatter=false for a plain note', () => {
    const fm = parseNoteFrontmatter('# Just a note\n\nBody.');
    expect(fm.hasFrontmatter).toBe(false);
    expect(fm.fields).toEqual([]);
    expect(fm.tags).toEqual([]);
  });

  it('parses the M15 template scalars in file order and unquotes values', () => {
    const fm = parseNoteFrontmatter(TEMPLATE_NOTE);
    expect(fm.hasFrontmatter).toBe(true);
    expect(fm.fields).toEqual([
      { key: 'title', value: 'Mira Veynn' },
      { key: 'type', value: 'character' },
      { key: 'createdAt', value: '2026-07-01T00:00:00.000Z' },
    ]);
  });

  it('parses inline tag lists, stripping quotes and leading #', () => {
    const fm = parseNoteFrontmatter('---\ntags: [location, "#underworld", \'ruins\']\n---\nBody');
    expect(fm.tags).toEqual(['location', 'underworld', 'ruins']);
  });

  it('parses block tag lists', () => {
    const fm = parseNoteFrontmatter('---\ntags:\n  - location\n  - ancient\ntype: location\n---\nBody');
    expect(fm.tags).toEqual(['location', 'ancient']);
    expect(fm.fields).toEqual([{ key: 'type', value: 'location' }]);
  });

  it('skips nested block values but keeps surrounding scalars', () => {
    const fm = parseNoteFrontmatter('---\ntype: location\nposition:\n  x: 1\n  y: 2\ndanger: high\n---\nBody');
    expect(fm.fields).toEqual([
      { key: 'type', value: 'location' },
      { key: 'danger', value: 'high' },
    ]);
  });
});

describe('setFrontmatterField', () => {
  it('replaces an existing scalar in place, preserving other lines', () => {
    const next = setFrontmatterField(TEMPLATE_NOTE, 'type', 'faction');
    expect(next).toContain('type: faction');
    expect(next).toContain('title: "Mira Veynn"');
    expect(next).toContain('# Mira Veynn');
    expect(parseNoteFrontmatter(next).fields.map((f) => f.key)).toEqual(['title', 'type', 'createdAt']);
  });

  it('appends a new field at the end of the block', () => {
    const next = setFrontmatterField(TEMPLATE_NOTE, 'danger', 'high');
    const fm = parseNoteFrontmatter(next);
    expect(fm.fields[fm.fields.length - 1]).toEqual({ key: 'danger', value: 'high' });
  });

  it('creates a frontmatter block when the note has none', () => {
    const next = setFrontmatterField('# Bare note\n', 'type', 'location');
    expect(next.startsWith('---\ntype: location\n---\n')).toBe(true);
    expect(next).toContain('# Bare note');
  });

  it('quotes values containing YAML-significant characters', () => {
    const next = setFrontmatterField(TEMPLATE_NOTE, 'note', 'a: b #x');
    expect(next).toContain('note: "a: b #x"');
    expect(parseNoteFrontmatter(next).fields.find((f) => f.key === 'note')?.value).toBe('a: b #x');
  });

  it('matches keys case-insensitively without duplicating', () => {
    const next = setFrontmatterField(TEMPLATE_NOTE, 'Type', 'item');
    const fm = parseNoteFrontmatter(next);
    expect(fm.fields.filter((f) => f.key.toLowerCase() === 'type')).toHaveLength(1);
  });
});

describe('removeFrontmatterField', () => {
  it('removes the field line only', () => {
    const next = removeFrontmatterField(TEMPLATE_NOTE, 'type');
    expect(next).not.toContain('type: character');
    expect(next).toContain('title: "Mira Veynn"');
  });

  it('is a no-op when the field is absent or there is no frontmatter', () => {
    expect(removeFrontmatterField(TEMPLATE_NOTE, 'ghost')).toBe(TEMPLATE_NOTE);
    expect(removeFrontmatterField('plain body', 'type')).toBe('plain body');
  });
});

describe('setFrontmatterTags', () => {
  it('adds an inline tags list to existing frontmatter', () => {
    const next = setFrontmatterTags(TEMPLATE_NOTE, ['character', 'pov']);
    expect(next).toContain('tags: [character, pov]');
    expect(parseNoteFrontmatter(next).tags).toEqual(['character', 'pov']);
  });

  it('replaces a block tags list with the inline form', () => {
    const src = '---\ntags:\n  - old\n  - stale\ntype: location\n---\nBody';
    const next = setFrontmatterTags(src, ['fresh']);
    expect(next).toContain('tags: [fresh]');
    expect(next).not.toContain('- old');
    expect(parseNoteFrontmatter(next).fields).toEqual([{ key: 'type', value: 'location' }]);
  });

  it('creates frontmatter for a bare note', () => {
    const next = setFrontmatterTags('Body only', ['ruins']);
    expect(next.startsWith('---\ntags: [ruins]\n---\n')).toBe(true);
  });

  it('strips leading # and blanks; removes the entry when the list empties', () => {
    const withTags = setFrontmatterTags(TEMPLATE_NOTE, ['#underworld', ' ', '']);
    expect(parseNoteFrontmatter(withTags).tags).toEqual(['underworld']);
    const cleared = setFrontmatterTags(withTags, []);
    expect(cleared).not.toContain('tags:');
    expect(cleared).toContain('title: "Mira Veynn"');
  });
});

describe('quoteFrontmatterValue', () => {
  it('leaves simple scalars unquoted and quotes risky ones', () => {
    expect(quoteFrontmatterValue('high')).toBe('high');
    expect(quoteFrontmatterValue('a: b')).toBe('"a: b"');
    expect(quoteFrontmatterValue('')).toBe('""');
    expect(quoteFrontmatterValue('has "quotes"')).toBe(`"has 'quotes'"`);
  });
});
