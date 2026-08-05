import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  collectNotesVaultNoteNames,
  findExplicitMentions,
  renderRelationshipsBlock,
  sanitizeWikilinks,
  type KnownNoteNames,
} from './noteRelationships.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-noterel-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function known(...names: string[]): KnownNoteNames {
  return new Map(names.map((n) => [n.toLowerCase(), n]));
}

describe('collectNotesVaultNoteNames', () => {
  it('collects .md stems recursively, keyed by lowercased stem', () => {
    fs.mkdirSync(path.join(tmpDir, 'Universes', 'U1', 'Characters'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'Universes', 'U1', 'Characters', 'Wren Ashby.md'), '# Wren');
    fs.writeFileSync(path.join(tmpDir, 'Top Note.md'), '# Top');

    const names = collectNotesVaultNoteNames(tmpDir);
    expect(names.get('wren ashby')).toBe('Wren Ashby');
    expect(names.get('top note')).toBe('Top Note');
    expect(names.size).toBe(2);
  });

  it('skips hidden directories, the Sessions dir, and non-md files', () => {
    fs.mkdirSync(path.join(tmpDir, '.mythos'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.mythos', 'Hidden.md'), 'x');
    fs.mkdirSync(path.join(tmpDir, 'Sessions'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'Sessions', 'Chat.md'), 'x');
    fs.writeFileSync(path.join(tmpDir, 'image.png'), 'x');
    // A nested (non-top-level) folder that happens to be called Sessions is a
    // regular user folder and IS collected.
    fs.mkdirSync(path.join(tmpDir, 'Lore', 'Sessions'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'Lore', 'Sessions', 'Council Meeting.md'), 'x');

    const names = collectNotesVaultNoteNames(tmpDir);
    expect(names.has('hidden')).toBe(false);
    expect(names.has('chat')).toBe(false);
    expect(names.get('council meeting')).toBe('Council Meeting');
    expect(names.size).toBe(1);
  });

  it('returns an empty map for a missing root', () => {
    expect(collectNotesVaultNoteNames(path.join(tmpDir, 'nope')).size).toBe(0);
  });
});

describe('findExplicitMentions', () => {
  it('finds whole-word, case-insensitive mentions ordered by first occurrence', () => {
    const result = findExplicitMentions(
      'She fled DARK CAVE with the Magic Staff.',
      known('Magic Staff', 'Dark Cave', 'Ravenspire'),
    );
    expect(result).toEqual(['Dark Cave', 'Magic Staff']);
  });

  it('does not match substrings inside larger words', () => {
    expect(findExplicitMentions('The Pipeline runs north.', known('Pip'))).toEqual([]);
  });

  it('excludes the note\'s own name', () => {
    expect(findExplicitMentions('Aria met Aria.', known('Aria'), 'Aria')).toEqual([]);
  });

  it('matches a name already written as a [[wikilink]]', () => {
    expect(findExplicitMentions('Ally of [[Dark Cave]].', known('Dark Cave'))).toEqual(['Dark Cave']);
  });

  it('escapes regex metacharacters in note names', () => {
    expect(
      findExplicitMentions('Met Arya Stark (Notes) today.', known('Arya Stark (Notes)')),
    ).toEqual(['Arya Stark (Notes)']);
  });
});

describe('sanitizeWikilinks', () => {
  it('keeps links whose targets exist', () => {
    expect(sanitizeWikilinks('Ally of [[Dark Cave]].', known('Dark Cave'))).toBe(
      'Ally of [[Dark Cave]].',
    );
  });

  it('unwraps links to non-existent targets to plain text', () => {
    expect(sanitizeWikilinks('Rules [[Ghost Keep]].', known('Dark Cave'))).toBe(
      'Rules Ghost Keep.',
    );
  });

  it('unwraps unknown [[target|alias]] to the alias', () => {
    expect(sanitizeWikilinks('Met [[Ghost Keep|the keep]].', known())).toBe('Met the keep.');
  });

  it('resolves [[folder/stem]] and [[stem#heading]] forms by stem', () => {
    expect(sanitizeWikilinks('See [[Places/Dark Cave]] and [[Dark Cave#History]].', known('Dark Cave')))
      .toBe('See [[Places/Dark Cave]] and [[Dark Cave#History]].');
    expect(sanitizeWikilinks('See [[Places/Ghost Keep]].', known('Dark Cave'))).toBe(
      'See Places/Ghost Keep.',
    );
  });

  it('is case-insensitive on the target stem', () => {
    expect(sanitizeWikilinks('At [[dark cave]].', known('Dark Cave'))).toBe('At [[dark cave]].');
  });
});

describe('renderRelationshipsBlock', () => {
  it('renders the SKY-8943-style block', () => {
    expect(renderRelationshipsBlock(['Dark Cave', 'Magic Staff'])).toBe(
      '**Relationships:**\n- References [[Dark Cave]]\n- References [[Magic Staff]]',
    );
  });

  it('returns empty string for no names', () => {
    expect(renderRelationshipsBlock([])).toBe('');
  });
});
