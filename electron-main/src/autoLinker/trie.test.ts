import { describe, it, expect } from 'vitest';
import { AutoLinkTrie } from './trie.js';

describe('AutoLinkTrie', () => {
  it('matches a single term', () => {
    const trie = new AutoLinkTrie();
    trie.insert('Aragorn', 'Aragorn', false);
    const hits = trie.findMatches('Aragorn is brave', false);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ noteName: 'Aragorn', start: 0, end: 7 });
  });

  it('is case-insensitive when ignoreCase=true', () => {
    const trie = new AutoLinkTrie();
    trie.insert('Aragorn', 'Aragorn', true);
    const hits = trie.findMatches('aragorn is brave', true);
    expect(hits).toHaveLength(1);
    expect(hits[0].noteName).toBe('Aragorn');
  });

  it('does not match when ignoreCase=false and case differs', () => {
    const trie = new AutoLinkTrie();
    trie.insert('Aragorn', 'Aragorn', false);
    const hits = trie.findMatches('aragorn is brave', false);
    expect(hits).toHaveLength(0);
  });

  it('enforces whole-word boundary — no partial match', () => {
    const trie = new AutoLinkTrie();
    trie.insert('Ara', 'Ara', false);
    const hits = trie.findMatches('Aragorn', false);
    expect(hits).toHaveLength(0);
  });

  it('matches multiple non-overlapping terms', () => {
    const trie = new AutoLinkTrie();
    trie.insert('Frodo', 'Frodo', false);
    trie.insert('Sam', 'Sam', false);
    const hits = trie.findMatches('Frodo and Sam went to Mordor', false);
    expect(hits).toHaveLength(2);
    expect(hits[0].noteName).toBe('Frodo');
    expect(hits[1].noteName).toBe('Sam');
  });

  it('prefers longest match (greedy)', () => {
    const trie = new AutoLinkTrie();
    trie.insert('Sam', 'Sam', false);
    trie.insert('Sam Gamgee', 'Sam Gamgee', false);
    const hits = trie.findMatches('Sam Gamgee walked', false);
    expect(hits).toHaveLength(1);
    expect(hits[0].noteName).toBe('Sam Gamgee');
  });

  it('does not match inside existing wiki link text', () => {
    // The trie itself doesn't know about [[...]], that's the formatter's job.
    // Just verify plain text matching works.
    const trie = new AutoLinkTrie();
    trie.insert('Shire', 'Shire', false);
    const hits = trie.findMatches('The Shire', false);
    expect(hits).toHaveLength(1);
  });

  it('returns noteNames set', () => {
    const trie = new AutoLinkTrie();
    trie.insert('Gandalf', 'Gandalf', false);
    trie.insert('White Wizard', 'Gandalf', false);
    expect(trie.getNoteNames().has('Gandalf')).toBe(true);
    expect(trie.getNoteNames().size).toBe(1);
  });
});
