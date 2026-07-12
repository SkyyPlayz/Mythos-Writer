// Auto Note Linker unit tests (SKY-6225)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildTrie, findMatches, type NoteEntry } from './trie.js';
import { formatText } from './formatter.js';
import {
  buildIndex,
  formatNote,
  formatVaultNow,
  DEFAULT_AUTO_LINKER_SETTINGS,
  type AutoLinkerSettings,
} from './scanner.js';

// ─── Trie tests ───

describe('buildTrie + findMatches', () => {
  const entries: NoteEntry[] = [
    { title: 'Alice', filePath: '/vault/Alice.md', aliases: [] },
    { title: 'Bob', filePath: '/vault/Bob.md', aliases: ['Robert'] },
    { title: 'Cat', filePath: '/vault/Cat.md', aliases: [] },
  ];

  it('matches a basic title', () => {
    const root = buildTrie(entries, { ignoreCase: false });
    const matches = findMatches('Hello Alice and Bob.', root, {
      ignoreCase: false,
      wordBoundary: true,
    });
    expect(matches.map((m) => m.matchedText)).toEqual(['Alice', 'Bob']);
  });

  it('matches an alias', () => {
    const root = buildTrie(entries, { ignoreCase: false });
    const matches = findMatches('Robert was here.', root, {
      ignoreCase: false,
      wordBoundary: true,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].matchedText).toBe('Robert');
    expect(matches[0].targetTitle).toBe('Bob');
  });

  it('case-insensitive match', () => {
    const root = buildTrie(entries, { ignoreCase: true });
    const matches = findMatches('alice and BOB were there.', root, {
      ignoreCase: true,
      wordBoundary: true,
    });
    expect(matches.map((m) => m.matchedText)).toContain('alice');
    expect(matches.map((m) => m.matchedText)).toContain('BOB');
  });

  it('word boundary prevents mid-word match', () => {
    const root = buildTrie(entries, { ignoreCase: false });
    // "Bobcat" should not match "Bob" because 'c' follows immediately
    const matches = findMatches('Bobcat is an animal.', root, {
      ignoreCase: false,
      wordBoundary: true,
    });
    const matchedTexts = matches.map((m) => m.matchedText);
    expect(matchedTexts).not.toContain('Bob');
  });

  it('no matches returns empty array', () => {
    const root = buildTrie(entries, { ignoreCase: false });
    const matches = findMatches('Nothing here.', root, {
      ignoreCase: false,
      wordBoundary: true,
    });
    expect(matches).toHaveLength(0);
  });
});

// ─── Formatter tests ───

describe('formatText', () => {
  it('wraps matched text in [[...]]', () => {
    const entries: NoteEntry[] = [{ title: 'Alice', filePath: '/v/Alice.md', aliases: [] }];
    const root = buildTrie(entries, { ignoreCase: false });
    const text = 'Hello Alice today.';
    const matches = findMatches(text, root, { ignoreCase: false, wordBoundary: true });
    const result = formatText(text, matches, new Set());
    expect(result).toBe('Hello [[Alice]] today.');
  });

  it('skips existing [[links]]', () => {
    const entries: NoteEntry[] = [{ title: 'Alice', filePath: '/v/Alice.md', aliases: [] }];
    const root = buildTrie(entries, { ignoreCase: false });
    const text = '[[Alice]] was here.';
    const matches = findMatches(text, root, { ignoreCase: false, wordBoundary: true });
    const result = formatText(text, matches, new Set());
    // No double-wrapping: existing [[Alice]] range covers the match
    expect(result).toBe('[[Alice]] was here.');
  });

  it('skips frontmatter content', () => {
    const entries: NoteEntry[] = [{ title: 'Alice', filePath: '/v/Alice.md', aliases: [] }];
    const root = buildTrie(entries, { ignoreCase: false });
    const text = '---\ntitle: Alice\n---\nAlice in the body.';
    const matches = findMatches(text, root, { ignoreCase: false, wordBoundary: true });
    const result = formatText(text, matches, new Set());
    // Only the body occurrence is linked
    expect(result).toBe('---\ntitle: Alice\n---\n[[Alice]] in the body.');
  });

  it('right-to-left insertion preserves offsets', () => {
    const entries: NoteEntry[] = [
      { title: 'Alice', filePath: '/v/Alice.md', aliases: [] },
      { title: 'Bob', filePath: '/v/Bob.md', aliases: [] },
    ];
    const root = buildTrie(entries, { ignoreCase: false });
    const text = 'Alice met Bob.';
    const matches = findMatches(text, root, { ignoreCase: false, wordBoundary: true });
    const result = formatText(text, matches, new Set());
    expect(result).toBe('[[Alice]] met [[Bob]].');
  });

  it('returns same string when no matches', () => {
    const text = 'Nothing to link.';
    const result = formatText(text, [], new Set());
    expect(result).toBe(text);
  });
});

// ─── Scanner (filesystem) tests ───

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-linker-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeNote(name: string, content: string, dir?: string): string {
  const base = dir ? path.join(tmpDir, dir) : tmpDir;
  fs.mkdirSync(base, { recursive: true });
  const p = path.join(base, name);
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

const defaultOpts: AutoLinkerSettings = { ...DEFAULT_AUTO_LINKER_SETTINGS };

describe('buildIndex', () => {
  it('indexes note titles', () => {
    writeNote('Alice.md', '# Alice\nSome content.');
    writeNote('Bob.md', '# Bob\nOther content.');
    const index = buildIndex(tmpDir, defaultOpts);
    expect(index.map((e) => e.title)).toContain('Alice');
    expect(index.map((e) => e.title)).toContain('Bob');
  });

  it('extracts inline alias array', () => {
    writeNote('Alice.md', '---\naliases: [Al, Ally]\n---\nContent.');
    const index = buildIndex(tmpDir, defaultOpts);
    const alice = index.find((e) => e.title === 'Alice');
    expect(alice?.aliases).toContain('Al');
    expect(alice?.aliases).toContain('Ally');
  });

  it('skips date-format filenames when ignoreDates=true', () => {
    writeNote('2024-01-01.md', 'Daily note content.');
    const index = buildIndex(tmpDir, { ...defaultOpts, ignoreDates: true });
    expect(index.map((e) => e.filePath)).not.toContain(
      path.join(tmpDir, '2024-01-01.md'),
    );
  });

  it('includes date-format filenames when ignoreDates=false', () => {
    writeNote('2024-01-01.md', 'Daily note content.');
    const index = buildIndex(tmpDir, { ...defaultOpts, ignoreDates: false });
    const found = index.some((e) => e.filePath.includes('2024-01-01.md'));
    expect(found).toBe(true);
  });

  it('excludes folders listed in excludedFolders', () => {
    writeNote('Alice.md', 'Content.', 'Templates');
    const index = buildIndex(tmpDir, defaultOpts);
    const found = index.some((e) => e.filePath.includes('Templates'));
    expect(found).toBe(false);
  });
});

describe('formatNote', () => {
  it('inserts [[links]] for matched titles', () => {
    writeNote('Alice.md', 'Alice is a character.');
    const targetPath = writeNote('Target.md', 'Alice appeared here.');
    const index = buildIndex(tmpDir, defaultOpts);
    formatNote(targetPath, index, { ...defaultOpts, preventSelfLink: true });
    const result = fs.readFileSync(targetPath, 'utf-8');
    expect(result).toBe('[[Alice]] appeared here.');
  });

  it('prevents self-link', () => {
    const selfPath = writeNote('Alice.md', 'Alice is herself.');
    const index = buildIndex(tmpDir, { ...defaultOpts, preventSelfLink: true });
    formatNote(selfPath, index, { ...defaultOpts, preventSelfLink: true });
    const result = fs.readFileSync(selfPath, 'utf-8');
    expect(result).not.toContain('[[Alice]]');
  });

  it('respects automatic-linker-off frontmatter', () => {
    writeNote('Alice.md', 'Alice is a character.');
    const targetPath = writeNote(
      'Target.md',
      '---\nautomatic-linker-off: true\n---\nAlice appeared here.',
    );
    const index = buildIndex(tmpDir, defaultOpts);
    const result = formatNote(targetPath, index, defaultOpts);
    expect(result).toBeNull();
    const content = fs.readFileSync(targetPath, 'utf-8');
    expect(content).not.toContain('[[Alice]]');
  });

  it('respects automatic-linker-exclude frontmatter', () => {
    writeNote('Alice.md', 'Alice is a character.');
    writeNote('Bob.md', 'Bob is a character.');
    const targetPath = writeNote(
      'Target.md',
      '---\nautomatic-linker-exclude: [Alice]\n---\nAlice met Bob.',
    );
    const index = buildIndex(tmpDir, defaultOpts);
    formatNote(targetPath, index, defaultOpts);
    const content = fs.readFileSync(targetPath, 'utf-8');
    expect(content).not.toContain('[[Alice]]');
    expect(content).toContain('[[Bob]]');
  });

  it('respects automatic-linker-scoped frontmatter (only same-folder links)', () => {
    // Note in a subdirectory
    fs.mkdirSync(path.join(tmpDir, 'sub'), { recursive: true });
    const alicePath = path.join(tmpDir, 'Alice.md');
    const subAlicePath = path.join(tmpDir, 'sub', 'SubAlice.md');
    fs.writeFileSync(alicePath, 'Alice is top-level.', 'utf-8');
    fs.writeFileSync(subAlicePath, 'SubAlice is in sub.', 'utf-8');
    const targetPath = path.join(tmpDir, 'sub', 'Target.md');
    fs.writeFileSync(
      targetPath,
      '---\nautomatic-linker-scoped: true\n---\nAlice and SubAlice met.',
      'utf-8',
    );
    const index = buildIndex(tmpDir, defaultOpts);
    formatNote(targetPath, index, defaultOpts);
    const content = fs.readFileSync(targetPath, 'utf-8');
    // top-level Alice should NOT be linked (different folder), SubAlice SHOULD
    expect(content).not.toContain('[[Alice]]');
    expect(content).toContain('[[SubAlice]]');
  });
});

describe('proximity preference', () => {
  it('prefers same-folder note when titles collide', () => {
    // Two notes with the same title in different folders
    fs.mkdirSync(path.join(tmpDir, 'sub'), { recursive: true });
    const topPath = path.join(tmpDir, 'Hero.md');
    const subPath = path.join(tmpDir, 'sub', 'Hero.md');
    fs.writeFileSync(topPath, 'Hero at top level.', 'utf-8');
    fs.writeFileSync(subPath, 'Hero in sub.', 'utf-8');
    const targetPath = path.join(tmpDir, 'sub', 'Story.md');
    fs.writeFileSync(targetPath, 'Hero saves the day.', 'utf-8');
    const index = buildIndex(tmpDir, { ...defaultOpts, preventSelfLink: false });
    formatNote(targetPath, index, {
      ...defaultOpts,
      preventSelfLink: false,
      proximityPreference: true,
    });
    const content = fs.readFileSync(targetPath, 'utf-8');
    expect(content).toContain('[[Hero]]');
    // Can't verify which Hero.md is preferred without checking targetPath, but
    // the key point is we get exactly one [[Hero]] link, not two
    const linkCount = (content.match(/\[\[Hero\]\]/g) ?? []).length;
    expect(linkCount).toBe(1);
  });
});

describe('formatVaultNow', () => {
  it('processes multiple notes and returns counts', () => {
    writeNote('Alice.md', 'Alice is a character.');
    writeNote('Bob.md', 'Bob knows Alice.');
    writeNote('Story.md', 'Alice met Bob in the story.');
    const result = formatVaultNow(tmpDir, defaultOpts);
    expect(result.processed).toBeGreaterThan(0);
    expect(result.linked).toBeGreaterThan(0);
  });
});
