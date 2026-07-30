// SKY-1756: Unit tests for Notes Vault graph data layer.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mapCategory, extractFrontmatterType, extractWikiLinkTargets, invalidateNoteGraphIndex, getGraphNodes, getGraphEdges, handleNoteFileChanged } from './vaultGraph.js';

// ─── Mock vault.js ───
// We provide a fake file system so tests run without touching the disk.

interface FakeFile {
  path: string;
  content: string;
}

let fakeFiles: FakeFile[] = [];

vi.mock('./vault.js', () => ({
  listVaultFiles: (_root: string) => ({
    items: fakeFiles.map((f) => ({ path: f.path, name: f.path.split('/').pop()!, isDirectory: false, modifiedAt: '' })),
  }),
  readVaultFile: (_root: string, filePath: string) => {
    const f = fakeFiles.find((x) => x.path === filePath);
    if (!f) throw new Error(`Not found: ${filePath}`);
    return { content: f.content, path: filePath };
  },
}));

// ─── Helpers ───

function resetFiles(files: FakeFile[]) {
  fakeFiles = files;
  invalidateNoteGraphIndex();
}

// ─── mapCategory ───

describe('mapCategory', () => {
  it('maps top-level files with no folder/frontmatter signal to misc', () => {
    expect(mapCategory('MyNote.md')).toBe('misc');
  });

  it('maps Characters/ prefix (case-insensitive)', () => {
    expect(mapCategory('Characters/Lyra.md')).toBe('characters');
    expect(mapCategory('CHARACTERS/Hero.md')).toBe('characters');
  });

  it('maps Locations/', () => {
    expect(mapCategory('Locations/Voss City.md')).toBe('locations');
  });

  it('maps Factions/', () => {
    expect(mapCategory('Factions/Guild.md')).toBe('factions');
  });

  it('maps History/', () => {
    expect(mapCategory('History/Great War.md')).toBe('history');
  });

  it('maps Systems/', () => {
    expect(mapCategory('Systems/Magic.md')).toBe('systems');
  });

  it('maps Items/', () => {
    expect(mapCategory('Items/Sword.md')).toBe('items');
  });

  it('maps Inbox/ to misc', () => {
    expect(mapCategory('Inbox/Scratch.md')).toBe('misc');
  });

  it('maps Research/ to misc', () => {
    expect(mapCategory('Research/Ideas.md')).toBe('misc');
  });

  it('maps Daily Notes/ to misc', () => {
    expect(mapCategory('Daily Notes/2026-06-16.md')).toBe('misc');
  });

  it('returns misc for unknown top-level folder', () => {
    expect(mapCategory('Universes/Arcadia/Lore.md')).toBe('misc');
  });

  it('any matching segment maps to the category (not just the first segment)', () => {
    // "Characters" appears as a deeper segment — still matches per §3.1 path-segment rule
    expect(mapCategory('Archive/Characters/Old.md')).toBe('characters');
  });

  it('returns misc when no segment matches', () => {
    expect(mapCategory('Universes/WorldA/Lore.md')).toBe('misc');
  });

  it('honors frontmatter type over folder', () => {
    expect(mapCategory('Universes/Ashford Village/Systems/Compact.md', 'system')).toBe('systems');
    expect(mapCategory('SomeFolder/Note.md', 'character')).toBe('characters');
    expect(mapCategory('SomeFolder/Note.md', 'location')).toBe('locations');
    expect(mapCategory('SomeFolder/Note.md', 'faction')).toBe('factions');
    expect(mapCategory('SomeFolder/Note.md', 'item')).toBe('items');
    expect(mapCategory('SomeFolder/Note.md', 'event')).toBe('history');
  });

  it('falls back to folder mapping when frontmatter type is unrecognized', () => {
    expect(mapCategory('Locations/City.md', 'story-notes')).toBe('locations');
  });

  it('falls back to misc when frontmatter type is unrecognized and folder does not match', () => {
    expect(mapCategory('Stories/Beats.md', 'story-beats')).toBe('misc');
  });
});

describe('extractFrontmatterType', () => {
  it('returns undefined when there is no frontmatter block', () => {
    expect(extractFrontmatterType('# Just a note\nNo frontmatter here.')).toBeUndefined();
  });

  it('extracts a simple type value', () => {
    expect(extractFrontmatterType('---\ntype: character\n---\n# Body')).toBe('character');
  });

  it('extracts type regardless of surrounding keys', () => {
    const content = '---\nsource: sample\nprovenance: bundled\ntype: system\n---\n# Body';
    expect(extractFrontmatterType(content)).toBe('system');
  });

  it('strips quotes around the value', () => {
    expect(extractFrontmatterType('---\ntype: "location"\n---\n')).toBe('location');
  });

  it('returns undefined when frontmatter has no type key', () => {
    expect(extractFrontmatterType('---\nsource: sample\n---\n# Body')).toBeUndefined();
  });
});

// ─── extractWikiLinkTargets ───

describe('extractWikiLinkTargets', () => {
  it('returns empty array for no wikilinks', () => {
    expect(extractWikiLinkTargets('Plain text, no links here.')).toEqual([]);
  });

  it('extracts simple [[target]]', () => {
    expect(extractWikiLinkTargets('See [[Lyra]] for details.')).toEqual(['lyra']);
  });

  it('extracts [[target|alias]]', () => {
    expect(extractWikiLinkTargets('[[Lyra Voss|the protagonist]] arrived.')).toEqual(['lyra voss']);
  });

  it('extracts [[target#heading]]', () => {
    expect(extractWikiLinkTargets('Read [[Lore#Origins]] for context.')).toEqual(['lore']);
  });

  it('extracts [[folder/target]]', () => {
    expect(extractWikiLinkTargets('[[Characters/Lyra]] is the hero.')).toEqual(['characters/lyra']);
  });

  it('extracts multiple links from one block', () => {
    const targets = extractWikiLinkTargets('[[Alpha]] and [[Beta]] are linked. [[Gamma]] too.');
    expect(targets).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('handles duplicate links', () => {
    const targets = extractWikiLinkTargets('[[Alpha]] then [[Alpha]] again.');
    expect(targets).toEqual(['alpha', 'alpha']);
  });

  it('lowercases targets', () => {
    expect(extractWikiLinkTargets('[[UPPERCASE]]')).toEqual(['uppercase']);
  });
});

// ─── getGraphNodes / getGraphEdges — degree computation ───

describe('getGraphNodes and getGraphEdges', () => {
  beforeEach(() => {
    resetFiles([
      { path: 'A.md', content: '[[B]] [[C]]' },
      { path: 'B.md', content: '[[C]]' },
      { path: 'C.md', content: '' },
      { path: 'Orphan.md', content: 'No links here.' },
    ]);
  });

  it('includes all notes including orphans', () => {
    const nodes = getGraphNodes('/vault');
    const ids = nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['A.md', 'B.md', 'C.md', 'Orphan.md'].sort());
  });

  it('orphan has degree 0', () => {
    const nodes = getGraphNodes('/vault');
    const orphan = nodes.find((n) => n.id === 'Orphan.md')!;
    expect(orphan.degree).toBe(0);
  });

  it('computes correct degree for hub (C has 2 in-links)', () => {
    const nodes = getGraphNodes('/vault');
    const c = nodes.find((n) => n.id === 'C.md')!;
    // A→C and B→C → C has in-degree 2, out-degree 0 → degree 2
    expect(c.degree).toBe(2);
  });

  it('computes correct degree for A (2 out-links)', () => {
    const nodes = getGraphNodes('/vault');
    const a = nodes.find((n) => n.id === 'A.md')!;
    // A→B and A→C → out-degree 2, in-degree 0 → degree 2
    expect(a.degree).toBe(2);
  });

  it('computes correct degree for B (1 in-link, 1 out-link)', () => {
    const nodes = getGraphNodes('/vault');
    const b = nodes.find((n) => n.id === 'B.md')!;
    // A→B (in=1), B→C (out=1) → degree 2
    expect(b.degree).toBe(2);
  });

  it('returns correct edges', () => {
    const edges = getGraphEdges('/vault');
    const pairs = edges.map((e) => `${e.source}→${e.target}`).sort();
    expect(pairs).toEqual(['A.md→B.md', 'A.md→C.md', 'B.md→C.md'].sort());
  });

  it('edge weight counts multiple links to same target', () => {
    resetFiles([
      { path: 'X.md', content: '[[Y]] and [[Y]] again' },
      { path: 'Y.md', content: '' },
    ]);
    const edges = getGraphEdges('/vault');
    const edge = edges.find((e) => e.source === 'X.md' && e.target === 'Y.md')!;
    expect(edge).toBeDefined();
    expect(edge.weight).toBe(2);
  });
});

// ─── SKY-6930: agent chat sessions must not appear as graph nodes ───
// A passive Brainstorm-panel mount (frontend/src/BrainstormPage.tsx) silently
// persists a Sessions/*.md transcript on first render — without this
// exclusion, that turns an otherwise-empty vault into a 1-node graph.

describe('getGraphNodes excludes Sessions/', () => {
  it('drops top-level Sessions/*.md files from nodes', () => {
    resetFiles([
      { path: 'Sessions/2026-07-17 brainstorm f037fe39.md', content: '# brainstorm session' },
    ]);
    expect(getGraphNodes('/vault')).toEqual([]);
  });

  it('drops nested Sessions/ files but keeps sibling user notes', () => {
    resetFiles([
      { path: 'Sessions/2026-07-17 coach ab12cd34.md', content: '[[Real Note]]' },
      { path: 'Real Note.md', content: 'No links here.' },
    ]);
    const ids = getGraphNodes('/vault').map((n) => n.id);
    expect(ids).toEqual(['Real Note.md']);
  });

  it('does not treat a session transcript link as a real edge', () => {
    resetFiles([
      { path: 'Sessions/2026-07-17 brainstorm f037fe39.md', content: '[[Real Note]]' },
      { path: 'Real Note.md', content: '' },
    ]);
    expect(getGraphEdges('/vault')).toEqual([]);
  });

  it('does not exclude a genuine note merely named "Sessions.md"', () => {
    resetFiles([{ path: 'Sessions.md', content: '' }]);
    expect(getGraphNodes('/vault').map((n) => n.id)).toEqual(['Sessions.md']);
  });
});

// ─── Category on nodes ───

describe('node categories', () => {
  it('assigns correct categories from path segments', () => {
    resetFiles([
      { path: 'Characters/Hero.md', content: '' },
      { path: 'Locations/City.md', content: '' },
      { path: 'TopLevel.md', content: '' },
    ]);
    const nodes = getGraphNodes('/vault');
    const hero = nodes.find((n) => n.id === 'Characters/Hero.md')!;
    expect(hero.category).toBe('characters');
    const city = nodes.find((n) => n.id === 'Locations/City.md')!;
    expect(city.category).toBe('locations');
    const top = nodes.find((n) => n.id === 'TopLevel.md')!;
    expect(top.category).toBe('misc');
  });

  it('honors frontmatter type over folder name when building nodes', () => {
    resetFiles([
      // Folder says "Stories", but frontmatter type says "system" — frontmatter wins.
      { path: 'Stories/Compact.md', content: '---\ntype: system\n---\n# The Compact' },
    ]);
    const nodes = getGraphNodes('/vault');
    expect(nodes.find((n) => n.id === 'Stories/Compact.md')!.category).toBe('systems');
  });
});

// ─── handleNoteFileChanged — topology vs content-only ───

describe('handleNoteFileChanged', () => {
  const ROOT = '/vault';

  beforeEach(() => {
    resetFiles([
      { path: 'A.md', content: '[[B]]' },
      { path: 'B.md', content: '' },
    ]);
    // Prime the cache
    getGraphNodes(ROOT);
  });

  it('returns false (no invalidation) for content-only change (same links)', () => {
    // Update content but keep the same wikilink
    fakeFiles[0].content = 'New prose but still links to [[B]] here.';
    const changed = handleNoteFileChanged(ROOT, '/vault/A.md');
    expect(changed).toBe(false);
    // Cache should still be populated
    const nodes = getGraphNodes(ROOT);
    expect(nodes.length).toBe(2);
  });

  it('returns true and invalidates when a link is added', () => {
    // Add a new wikilink
    fakeFiles[0].content = '[[B]] and now [[C]]';
    fakeFiles.push({ path: 'C.md', content: '' });
    const changed = handleNoteFileChanged(ROOT, '/vault/A.md');
    expect(changed).toBe(true);
    // Cache rebuilt on next query
    const nodes = getGraphNodes(ROOT);
    expect(nodes.length).toBe(3);
  });

  it('returns true and invalidates when a link is removed', () => {
    fakeFiles[0].content = 'No links anymore.';
    const changed = handleNoteFileChanged(ROOT, '/vault/A.md');
    expect(changed).toBe(true);
    const edges = getGraphEdges(ROOT);
    expect(edges.length).toBe(0);
  });

  it('returns true when a file is deleted (readVaultFile throws)', () => {
    // Simulate deletion by removing from fakeFiles
    fakeFiles = fakeFiles.filter((f) => f.path !== 'A.md');
    const changed = handleNoteFileChanged(ROOT, '/vault/A.md');
    expect(changed).toBe(true);
  });

  it('returns false when cache is null (no-op, will rebuild on next get)', () => {
    invalidateNoteGraphIndex(); // clear cache
    const changed = handleNoteFileChanged(ROOT, '/vault/A.md');
    expect(changed).toBe(false);
  });
});
