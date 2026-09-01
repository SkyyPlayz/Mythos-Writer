// SKY-11151 — the shared creation primitive: template / blank / import.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createVaultFromOptions,
  TEMPLATE_NOTES_SKELETON,
  TEMPLATE_SEED_LAYOUT,
  IMPORT_SEED_LAYOUT,
} from './createVaultFromOptions.js';
import { ensureMythosV2SeedMarker } from './createVault.js';
import {
  _clearDetectionCache,
  notesVaultRootFor,
  readMythosFile,
} from './mythosJson.js';
import { BLANK_SEED_LAYOUT } from './createVault.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-primitive-'));
  _clearDetectionCache();
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Recursive, sorted, relative file+dir list under root. */
function entryList(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      out.push(entry.isDirectory() ? `${rel}/` : rel);
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
    }
  };
  walk(root, '');
  return out;
}

describe('createVaultFromOptions — validation', () => {
  it('rejects a non-absolute destination parent', () => {
    const r = createVaultFromOptions({ destinationParent: 'rel/path', mode: 'blank' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/absolute path/);
  });

  it('rejects an unknown mode', () => {
    const r = createVaultFromOptions({ destinationParent: tmp, mode: 'nope' as never });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Unknown creation mode/);
  });

  it('rejects import mode with no usable sources', () => {
    const r = createVaultFromOptions({ destinationParent: tmp, mode: 'import', importSources: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/at least one source/);
  });

  it('never overwrites a non-empty target folder', () => {
    const first = createVaultFromOptions({ destinationParent: tmp, name: 'Dup', exactName: true, mode: 'blank' });
    expect(first.ok).toBe(true);
    const second = createVaultFromOptions({ destinationParent: tmp, name: 'Dup', exactName: true, mode: 'blank' });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/not empty/);
  });
});

describe('createVaultFromOptions — blank (Obsidian-parity)', () => {
  it('creates only machinery + empty roots — no visible content folders', () => {
    const r = createVaultFromOptions({ destinationParent: tmp, name: 'Empty One', mode: 'blank' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // The forbidden §3a seeded names must never appear anywhere in the tree.
    const entries = entryList(r.mythosRoot);
    for (const forbidden of ['Universes/', 'Inbox/', 'Research/', 'Daily Notes/', 'Archive/', 'Templates.md', 'My First Story/']) {
      expect(entries).not.toContain(forbidden);
    }
    // Notes Vault + Story Vault roots exist but hold no user-visible entries.
    expect(fs.readdirSync(notesVaultRootFor(r.mythosRoot))).toHaveLength(0);

    // The choice is PERSISTED in mythos.json.
    const mythos = readMythosFile(r.mythosRoot);
    expect(mythos.seed?.mode).toBe('blank');
    expect(mythos.seed?.layout).toBe(BLANK_SEED_LAYOUT);
  });

  it('is re-seed-proof: the boot seed-marker guard refuses to seed a blank vault', () => {
    const r = createVaultFromOptions({ destinationParent: tmp, name: 'Stays Empty', mode: 'blank' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const before = entryList(r.mythosRoot);
    // Simulate a later start / index-rebuild / health-repair calling the guard.
    const guard = ensureMythosV2SeedMarker(r.mythosRoot);
    expect(guard.adopted).toBe(false); // seed record present → never seed again
    const after = entryList(r.mythosRoot);
    expect(after).toEqual(before); // no folders re-appeared
    expect(fs.readdirSync(notesVaultRootFor(r.mythosRoot))).toHaveLength(0);
  });
});

describe('createVaultFromOptions — template (ready shape, no notes)', () => {
  it('creates the empty skeleton folders in the Notes Vault and zero note files', () => {
    const r = createVaultFromOptions({ destinationParent: tmp, name: 'Shaped', mode: 'template' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const notesRoot = notesVaultRootFor(r.mythosRoot);
    for (const dir of TEMPLATE_NOTES_SKELETON) {
      expect(fs.existsSync(path.join(notesRoot, dir))).toBe(true);
      expect(fs.statSync(path.join(notesRoot, dir)).isDirectory()).toBe(true);
      // Each skeleton folder is empty — a shape, not seeded notes.
      expect(fs.readdirSync(path.join(notesRoot, dir))).toHaveLength(0);
    }
    // No stray markdown note anywhere in the notes vault.
    const mdFiles = entryList(notesRoot).filter((e) => e.endsWith('.md'));
    expect(mdFiles).toHaveLength(0);

    // Provenance recorded; still re-seed-proof (mode stays 'blank').
    const mythos = readMythosFile(r.mythosRoot);
    expect(mythos.seed?.layout).toBe(TEMPLATE_SEED_LAYOUT);
    expect(mythos.seed?.mode).toBe('blank');
  });
});

describe('createVaultFromOptions — import (new vault, source untouched)', () => {
  it('copies source content into a NEW vault and never mutates the source', () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-src-'));
    fs.mkdirSync(path.join(src, '.obsidian'));
    fs.mkdirSync(path.join(src, 'Ideas'));
    fs.writeFileSync(path.join(src, 'note1.md'), '# Note One\n\nLinks to [[Note Two]].\n');
    fs.writeFileSync(path.join(src, 'Ideas', 'Note Two.md'), '# Note Two\n');
    const srcSnapshot = () =>
      JSON.stringify({
        n1: fs.readFileSync(path.join(src, 'note1.md'), 'utf8'),
        n2: fs.readFileSync(path.join(src, 'Ideas', 'Note Two.md'), 'utf8'),
        entries: fs.readdirSync(src).sort(),
      });
    const before = srcSnapshot();

    const r = createVaultFromOptions({
      destinationParent: tmp,
      name: 'Imported',
      mode: 'import',
      importSources: [{ kind: 'notes', srcPath: src }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Content copied byte-for-byte, links NOT rewritten (SKY-10383).
    const imported = fs.readFileSync(path.join(r.notesVaultPath, 'note1.md'), 'utf8');
    expect(imported).toBe('# Note One\n\nLinks to [[Note Two]].\n');
    expect(fs.existsSync(path.join(r.notesVaultPath, 'Ideas', 'Note Two.md'))).toBe(true);
    expect(r.importTally?.imported).toBeGreaterThan(0);

    // A NEW vault under the chosen parent — the source folder is untouched.
    expect(path.dirname(r.mythosRoot)).toBe(tmp);
    expect(srcSnapshot()).toBe(before);

    const mythos = readMythosFile(r.mythosRoot);
    expect(mythos.seed?.layout).toBe(IMPORT_SEED_LAYOUT);

    fs.rmSync(src, { recursive: true, force: true });
  });
});
