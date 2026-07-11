import { describe, it, expect } from 'vitest';
import { buildTrie, formatContent } from './formatter.js';
import type { NoteEntry } from './types.js';

function note(name: string, aliases: string[] = []): NoteEntry {
  return {
    name,
    vaultRelPath: `${name}.md`,
    absPath: `/vault/${name}.md`,
    aliases,
    linkerOff: false,
    linkerExclude: [],
    linkerScoped: false,
  };
}

const DEFAULT_TOGGLES = {
  ignoreCase: true,
  preventSelfLink: true,
};

describe('buildTrie + formatContent', () => {
  it('links a plain mention to its note', () => {
    const notes = [note('Aragorn')];
    const trie = buildTrie(notes, { includeAliases: true, ignoreCase: true });
    const result = formatContent('Aragorn is brave.', 'SomeFile', trie, DEFAULT_TOGGLES);
    expect(result).toBe('[[Aragorn]] is brave.');
  });

  it('does not reformat an existing [[wiki link]]', () => {
    const notes = [note('Aragorn')];
    const trie = buildTrie(notes, { includeAliases: true, ignoreCase: true });
    const result = formatContent('[[Aragorn]] is brave.', 'SomeFile', trie, DEFAULT_TOGGLES);
    expect(result).toBe('[[Aragorn]] is brave.');
  });

  it('prevents self-links', () => {
    const notes = [note('Aragorn')];
    const trie = buildTrie(notes, { includeAliases: true, ignoreCase: true });
    const result = formatContent('Aragorn is brave.', 'Aragorn', trie, DEFAULT_TOGGLES);
    expect(result).toBe('Aragorn is brave.');
  });

  it('allows self-links when preventSelfLink=false', () => {
    const notes = [note('Aragorn')];
    const trie = buildTrie(notes, { includeAliases: true, ignoreCase: true });
    const result = formatContent('Aragorn is brave.', 'Aragorn', trie, {
      ignoreCase: true,
      preventSelfLink: false,
    });
    expect(result).toBe('[[Aragorn]] is brave.');
  });

  it('links via alias when includeAliases=true', () => {
    const notes = [note('Gandalf', ['Mithrandir'])];
    const trie = buildTrie(notes, { includeAliases: true, ignoreCase: true });
    const result = formatContent('Mithrandir arrived.', 'SomeFile', trie, DEFAULT_TOGGLES);
    expect(result).toBe('[[Gandalf]] arrived.');
  });

  it('does not link via alias when includeAliases=false', () => {
    const notes = [note('Gandalf', ['Mithrandir'])];
    const trie = buildTrie(notes, { includeAliases: false, ignoreCase: true });
    const result = formatContent('Mithrandir arrived.', 'SomeFile', trie, DEFAULT_TOGGLES);
    expect(result).toBe('Mithrandir arrived.');
  });

  it('skips text inside inline code', () => {
    const notes = [note('Frodo')];
    const trie = buildTrie(notes, { includeAliases: true, ignoreCase: true });
    const result = formatContent('Use `Frodo` as a name.', 'SomeFile', trie, DEFAULT_TOGGLES);
    expect(result).toBe('Use `Frodo` as a name.');
  });

  it('skips text inside code fences', () => {
    const notes = [note('Frodo')];
    const trie = buildTrie(notes, { includeAliases: true, ignoreCase: true });
    const content = '```\nFrodo\n```';
    const result = formatContent(content, 'SomeFile', trie, DEFAULT_TOGGLES);
    expect(result).toBe(content);
  });

  it('does not link inside [text](url)', () => {
    const notes = [note('Frodo')];
    const trie = buildTrie(notes, { includeAliases: true, ignoreCase: true });
    const result = formatContent('[Frodo](http://example.com)', 'SomeFile', trie, DEFAULT_TOGGLES);
    expect(result).toBe('[Frodo](http://example.com)');
  });

  it('skips notes with linkerOff=true', () => {
    const n = note('Legolas');
    n.linkerOff = true;
    const trie = buildTrie([n], { includeAliases: true, ignoreCase: true });
    const result = formatContent('Legolas shoots.', 'SomeFile', trie, DEFAULT_TOGGLES);
    expect(result).toBe('Legolas shoots.');
  });

  it('respects linkerExclude terms', () => {
    const n = note('Sam', ['Samwise']);
    n.linkerExclude = ['Samwise'];
    const trie = buildTrie([n], { includeAliases: true, ignoreCase: true });
    // 'Sam' still links, 'Samwise' does not.
    const result = formatContent('Sam and Samwise are friends.', 'SomeFile', trie, DEFAULT_TOGGLES);
    expect(result).toBe('[[Sam]] and Samwise are friends.');
  });

  it('is case-insensitive when ignoreCase=true', () => {
    const notes = [note('Shire')];
    const trie = buildTrie(notes, { includeAliases: true, ignoreCase: true });
    const result = formatContent('the shire was peaceful.', 'SomeFile', trie, DEFAULT_TOGGLES);
    expect(result).toBe('the [[Shire]] was peaceful.');
  });

  it('handles multiple links in one line', () => {
    const notes = [note('Frodo'), note('Sam')];
    const trie = buildTrie(notes, { includeAliases: true, ignoreCase: true });
    const result = formatContent('Frodo and Sam.', 'SomeFile', trie, DEFAULT_TOGGLES);
    expect(result).toBe('[[Frodo]] and [[Sam]].');
  });

  it('preserves frontmatter unchanged', () => {
    const notes = [note('Aragorn')];
    const trie = buildTrie(notes, { includeAliases: true, ignoreCase: true });
    const content = '---\ntitle: Aragorn\n---\nAragorn is brave.';
    const result = formatContent(content, 'SomeFile', trie, DEFAULT_TOGGLES);
    // Line with --- is passed through untouched; prose line is linked.
    expect(result).toContain('---\ntitle: Aragorn\n---');
    expect(result).toContain('[[Aragorn]] is brave.');
  });
});
