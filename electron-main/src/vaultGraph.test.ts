import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildVaultGraphIndex,
  didVaultGraphTopologyChange,
  extractVaultGraphWikiLinks,
  vaultGraphCategoryForPath,
} from './vaultGraph.js';

let tmpDir: string;

function writeNote(relPath: string, body: string): void {
  const fullPath = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, body, 'utf-8');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-graph-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('extractVaultGraphWikiLinks', () => {
  it('extracts wikilink targets from plain, alias, heading, and block-reference links', () => {
    expect(
      extractVaultGraphWikiLinks(
        'See [[Mira Halloway]], [[Locations/The Glass Library|the library]], [[The Ink Compact#Terms]], and [[Custodian Bell#^bell-block]].',
      ),
    ).toEqual(['Mira Halloway', 'Locations/The Glass Library', 'The Ink Compact', 'Custodian Bell']);
  });
});

describe('vaultGraphCategoryForPath', () => {
  it('maps the first matching path segment to the UX spec category', () => {
    expect(vaultGraphCategoryForPath('Universes/Argent/Characters/Mira.md')).toBe('characters');
    expect(vaultGraphCategoryForPath('Research/Factions/Old Guild.md')).toBe('misc');
    expect(vaultGraphCategoryForPath('Daily Notes/2026-06-16.md')).toBe('misc');
    expect(vaultGraphCategoryForPath('Loose Note.md')).toBe('default');
  });
});

describe('buildVaultGraphIndex', () => {
  it('builds nodes, weighted edges, degree counts, and includes orphan notes', () => {
    writeNote(
      'Universes/Argent/Characters/Mira Halloway.md',
      '---\nid: mira-id\ntitle: Mira Halloway\ntags: [protagonist]\n---\nMira visits [[The Glass Library]] twice: [[Locations/The Glass Library|library]].',
    );
    writeNote('Universes/Argent/Locations/The Glass Library.md', 'The library knows [[Mira Halloway]].');
    writeNote('Inbox/Orphan.md', 'No links here.');

    const graph = buildVaultGraphIndex(tmpDir);

    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'mira-id',
        label: 'Mira Halloway',
        path: 'Universes/Argent/Characters/Mira Halloway.md',
        category: 'characters',
        degree: 3,
        tags: ['protagonist'],
      }),
      expect.objectContaining({
        label: 'The Glass Library',
        path: 'Universes/Argent/Locations/The Glass Library.md',
        category: 'locations',
        degree: 3,
      }),
      expect.objectContaining({
        label: 'Orphan',
        path: 'Inbox/Orphan.md',
        category: 'misc',
        degree: 0,
      }),
    ]));
    expect(graph.edges).toEqual([
      { source: 'mira-id', target: 'Universes/Argent/Locations/The Glass Library.md', weight: 2 },
      { source: 'Universes/Argent/Locations/The Glass Library.md', target: 'mira-id', weight: 1 },
    ]);
  });
});

describe('didVaultGraphTopologyChange', () => {
  it('returns false for content-only saves and true when wikilink topology changes', () => {
    expect(didVaultGraphTopologyChange('Mira wrote a sentence.', 'Mira wrote another sentence.')).toBe(false);
    expect(didVaultGraphTopologyChange('Mira wrote a sentence.', 'Mira wrote about [[The Glass Library]].')).toBe(true);
  });
});
