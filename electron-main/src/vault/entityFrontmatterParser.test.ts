import { describe, it, expect } from 'vitest';
import { parseEntityFrontmatter } from './entityFrontmatterParser.js';

describe('parseEntityFrontmatter', () => {
  it('extracts array aliases', () => {
    const content = '---\naliases: [Lady Margot, Margot]\ntype: Character\n---\nSome prose.';
    const { aliases, type } = parseEntityFrontmatter(content);
    expect(aliases).toEqual(['Lady Margot', 'Margot']);
    expect(type).toBe('Character');
  });

  it('handles no frontmatter', () => {
    const content = 'Just prose, no frontmatter.';
    const { aliases, type } = parseEntityFrontmatter(content);
    expect(aliases).toEqual([]);
    expect(type).toBeNull();
  });

  it('handles empty aliases array', () => {
    const content = '---\naliases: []\ntype: Location\n---\n';
    const { aliases, type } = parseEntityFrontmatter(content);
    expect(aliases).toEqual([]);
    expect(type).toBe('Location');
  });

  it('handles single-element aliases as string', () => {
    const content = '---\naliases: The Keep\n---\n';
    const { aliases } = parseEntityFrontmatter(content);
    expect(aliases).toEqual(['The Keep']);
  });

  it('returns null type when absent', () => {
    const content = '---\naliases: [foo]\n---\n';
    const { type } = parseEntityFrontmatter(content);
    expect(type).toBeNull();
  });

  it('returns null type when blank', () => {
    const content = '---\ntype: \n---\n';
    const { type } = parseEntityFrontmatter(content);
    expect(type).toBeNull();
  });

  it('trims whitespace from aliases', () => {
    const content = '---\naliases: [ foo , bar ]\n---\n';
    const { aliases } = parseEntityFrontmatter(content);
    expect(aliases).toEqual(['foo', 'bar']);
  });
});
