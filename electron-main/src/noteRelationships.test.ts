import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  collectNotesVaultNoteNames,
  collectNotesVaultNoteNamesAsync,
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
  vi.restoreAllMocks();
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

describe('collectNotesVaultNoteNamesAsync', () => {
  function write(rel: string): void {
    const abs = path.join(tmpDir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'x');
  }

  it('matches the sync walk entry for entry, in the same order', async () => {
    write('Top Note.md');
    write('.mythos/Hidden.md');
    write('Lore/.drafts/Secret.md');
    write('Lore/.Dotfile.md');
    write('Sessions/Chat.md');
    write('Lore/Sessions/Council Meeting.md');
    write('Universes/U1/Characters/Wren Ashby.md');
    write('Universes/U1/Characters/portrait.png');
    write('a/b/c/d/e/f/g/h/i/j/k/l/Deep Note.md');
    // Stem collision across folders: last writer wins, so walk order matters.
    write('Alpha/Wren ashby.md');
    write('Zeta/WREN ASHBY.md');

    const sync = collectNotesVaultNoteNames(tmpDir);
    const asyncNames = await collectNotesVaultNoteNamesAsync(tmpDir);
    expect([...asyncNames]).toEqual([...sync]);
    expect(asyncNames.has('hidden')).toBe(false);
    expect(asyncNames.has('secret')).toBe(false);
    expect(asyncNames.has('.dotfile')).toBe(false);
    expect(asyncNames.has('chat')).toBe(false);
    expect(asyncNames.get('council meeting')).toBe('Council Meeting');
    expect(asyncNames.get('deep note')).toBe('Deep Note');
    expect(asyncNames.get('top note')).toBe('Top Note');
    expect(asyncNames.has('portrait')).toBe(false);
    expect(asyncNames.get('wren ashby')).toBe(sync.get('wren ashby'));
    expect(asyncNames.size).toBe(4);
  });

  it('resolves to an empty map for a missing root or a file root', async () => {
    await expect(collectNotesVaultNoteNamesAsync(path.join(tmpDir, 'nope'))).resolves.toEqual(new Map());
    write('file.md');
    await expect(collectNotesVaultNoteNamesAsync(path.join(tmpDir, 'file.md'))).resolves.toEqual(new Map());
  });

  it('yields to the event loop while walking a 2k-file tree', async () => {
    for (let d = 0; d < 20; d++) {
      const dir = path.join(tmpDir, `Folder ${d}`);
      fs.mkdirSync(dir);
      for (let f = 0; f < 100; f++) fs.writeFileSync(path.join(dir, `Note ${d}-${f}.md`), 'x');
    }
    let immediateRan = false;
    let immediateRanBeforeResolve = false;
    setImmediate(() => {
      immediateRan = true;
    });
    const names = await collectNotesVaultNoteNamesAsync(tmpDir).then((n) => {
      immediateRanBeforeResolve = immediateRan;
      return n;
    });
    expect(names.size).toBe(2000);
    expect(immediateRanBeforeResolve).toBe(true);
  });

  it('shares one follow-up walk among callers that arrive mid-walk', async () => {
    write('Top Note.md');
    const readdir = vi.spyOn(fs.promises, 'readdir');
    const first = collectNotesVaultNoteNamesAsync(tmpDir);
    const rest = [1, 2, 3, 4].map(() => collectNotesVaultNoteNamesAsync(tmpDir));
    for (const p of rest) expect(p).toBe(rest[0]);
    expect(rest[0]).not.toBe(first);
    await Promise.all([first, ...rest]);
    const rootReads = readdir.mock.calls.filter(([dir]) => dir === tmpDir).length;
    expect(rootReads).toBe(2);
  });

  it('a call made after a note lands sees it, even while an older walk is running', async () => {
    write('Old Note.md');
    const realReaddir = fs.promises.readdir.bind(fs.promises);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstRead = true;
    vi.spyOn(fs.promises, 'readdir').mockImplementation((async (...args: Parameters<typeof realReaddir>) => {
      const entries = await realReaddir(...args);
      if (firstRead) {
        firstRead = false;
        // The first walk has read the root; hold it there while a note lands.
        await gate;
      }
      return entries;
    }) as typeof fs.promises.readdir);

    const before = collectNotesVaultNoteNamesAsync(tmpDir);
    await vi.waitFor(() => expect(firstRead).toBe(false));
    write('Just Filed.md');
    const after = collectNotesVaultNoteNamesAsync(tmpDir);
    release();

    expect((await before).has('just filed')).toBe(false);
    const fresh = await after;
    expect(fresh.get('just filed')).toBe('Just Filed');
    expect(fresh.get('old note')).toBe('Old Note');
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
