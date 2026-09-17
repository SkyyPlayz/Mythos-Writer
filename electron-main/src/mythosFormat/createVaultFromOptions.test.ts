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
import { Document, Packer, Paragraph, HeadingLevel } from 'docx';
import { parseV2SceneFile } from './sceneFiles.js';

/** A real, minimal .docx — two Heading-1 chapters, each with one body
 *  paragraph, no title page (mirrors a plain manuscript export, and matches
 *  the SKY-11814 fixture: "2 headings + 2 paragraphs"). */
async function buildMinimalManuscriptDocx(): Promise<Buffer> {
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: 'Chapter One', heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ text: 'First body text.' }),
        new Paragraph({ text: 'Chapter Two', heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ text: 'Second body text.' }),
      ],
    }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

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
  it('rejects a non-absolute destination parent', async () => {
    const r = await createVaultFromOptions({ destinationParent: 'rel/path', mode: 'blank' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/absolute path/);
  });

  it('rejects an unknown mode', async () => {
    const r = await createVaultFromOptions({ destinationParent: tmp, mode: 'nope' as never });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Unknown creation mode/);
  });

  it('rejects import mode with no usable sources', async () => {
    const r = await createVaultFromOptions({ destinationParent: tmp, mode: 'import', importSources: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/at least one source/);
  });

  it('never overwrites a non-empty target folder', async () => {
    const first = await createVaultFromOptions({ destinationParent: tmp, name: 'Dup', exactName: true, mode: 'blank' });
    expect(first.ok).toBe(true);
    const second = await createVaultFromOptions({ destinationParent: tmp, name: 'Dup', exactName: true, mode: 'blank' });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/not empty/);
  });
});

describe('createVaultFromOptions — blank (Obsidian-parity)', () => {
  it('creates only machinery + empty roots — no visible content folders', async () => {
    const r = await createVaultFromOptions({ destinationParent: tmp, name: 'Empty One', mode: 'blank' });
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

  it('is re-seed-proof: the boot seed-marker guard refuses to seed a blank vault', async () => {
    const r = await createVaultFromOptions({ destinationParent: tmp, name: 'Stays Empty', mode: 'blank' });
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
  it('creates the empty skeleton folders in the Notes Vault and zero note files', async () => {
    const r = await createVaultFromOptions({ destinationParent: tmp, name: 'Shaped', mode: 'template' });
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
  it('copies source content into a NEW vault and never mutates the source', async () => {
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

    const r = await createVaultFromOptions({
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

// SKY-11814: a Story-source folder holding a .docx (the ticket's repro — a
// plain folder with no .md alongside it) must land as real chapters/scenes,
// not a silently empty vault.
describe('createVaultFromOptions — import (SKY-11814: .docx story source)', () => {
  it('converts a .docx into a v2 story folder with real chapters/scenes', async () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-src-'));
    const buffer = await buildMinimalManuscriptDocx();
    fs.writeFileSync(path.join(src, 'Manuscript.docx'), buffer);

    const r = await createVaultFromOptions({
      destinationParent: tmp,
      name: 'Docx Imported',
      mode: 'import',
      importSources: [{ kind: 'story', srcPath: src }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.importTally?.imported).toBe(1);
    expect((r.importTally?.warnings ?? []).join(' ')).not.toContain('Manuscript.docx');

    const storyFolders = fs.readdirSync(r.storyVaultPath).filter((n) =>
      !n.startsWith('.') && fs.statSync(path.join(r.storyVaultPath, n)).isDirectory(),
    );
    expect(storyFolders).toHaveLength(1);
    const storyDir = path.join(r.storyVaultPath, storyFolders[0]);
    expect(fs.existsSync(path.join(storyDir, 'book.md'))).toBe(true);

    const scene1 = path.join(storyDir, 'Part 1', 'Chapter 01', 'Scene 01.md');
    const scene2 = path.join(storyDir, 'Part 1', 'Chapter 02', 'Scene 01.md');
    expect(parseV2SceneFile(fs.readFileSync(scene1, 'utf-8')).prose).toContain('First body text.');
    expect(parseV2SceneFile(fs.readFileSync(scene2, 'utf-8')).prose).toContain('Second body text.');

    fs.rmSync(src, { recursive: true, force: true });
  });

  it('names a docx alongside notes-kind source as skipped (docx conversion is story-only)', async () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-notes-src-'));
    fs.writeFileSync(path.join(src, 'Manuscript.docx'), 'fake docx bytes');

    const r = await createVaultFromOptions({
      destinationParent: tmp,
      name: 'Notes Docx Skip',
      mode: 'import',
      importSources: [{ kind: 'notes', srcPath: src }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.importTally?.imported).toBe(0);
    expect(r.importTally?.warnings.join(' ')).toContain('Manuscript.docx');
    expect(r.importTally?.warnings.join(' ')).toMatch(/nothing was imported/i);

    fs.rmSync(src, { recursive: true, force: true });
  });

  it('reports "nothing was imported" for a Story source with no supported files (AC3)', async () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-empty-src-'));
    fs.writeFileSync(path.join(src, 'notes.rtf'), 'unsupported format');

    const r = await createVaultFromOptions({
      destinationParent: tmp,
      name: 'Nothing Importable',
      mode: 'import',
      importSources: [{ kind: 'story', srcPath: src }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.importTally?.imported).toBe(0);
    const warningsText = (r.importTally?.warnings ?? []).join(' ');
    expect(warningsText).toContain('notes.rtf');
    expect(warningsText).toMatch(/nothing was imported/i);

    fs.rmSync(src, { recursive: true, force: true });
  });
});

describe('createVaultFromOptions — import fidelity (Obsidian vault with wiki-links, attachments, folders)', () => {
  it('preserves folder structure, note bodies, wiki-links and attachments byte-for-byte', async () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-fidelity-'));
    fs.mkdirSync(path.join(src, '.obsidian'));
    fs.mkdirSync(path.join(src, 'Characters'));
    fs.mkdirSync(path.join(src, 'Worldbuilding'));
    fs.mkdirSync(path.join(src, 'Worldbuilding', 'Magic'));
    const note1 = '# Aria\n\nA [[Mage]] of the [[High Tower]].\n\n## Backstory\n\nShe grew up in [[Worldbuilding/Magic/Arcane Arts|the Arcane tradition]].\n';
    const note2 = '# Mage\n\nPractitioners of the arcane.\n\nSee also: [[Aria]], [[Worldbuilding/Magic/Arcane Arts]].\n';
    const note3 = '# Arcane Arts\n\nThe oldest branch of magic.\n';
    fs.writeFileSync(path.join(src, 'Characters', 'Aria.md'), note1);
    fs.writeFileSync(path.join(src, 'Characters', 'Mage.md'), note2);
    fs.writeFileSync(path.join(src, 'Worldbuilding', 'Magic', 'Arcane Arts.md'), note3);
    fs.writeFileSync(path.join(src, 'index.md'), '# World Index\n\n- [[Characters/Aria]]\n- [[Characters/Mage]]\n');
    const pngData = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    fs.writeFileSync(path.join(src, 'Characters', 'aria-portrait.png'), pngData);

    const r = await createVaultFromOptions({
      destinationParent: tmp,
      name: 'Heptiverse',
      mode: 'import',
      importSources: [{ kind: 'notes', srcPath: src }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.importTally?.imported).toBe(5);

    expect(fs.readFileSync(path.join(r.notesVaultPath!, 'Characters', 'Aria.md'), 'utf-8')).toBe(note1);
    expect(fs.readFileSync(path.join(r.notesVaultPath!, 'Characters', 'Mage.md'), 'utf-8')).toBe(note2);
    expect(fs.readFileSync(path.join(r.notesVaultPath!, 'Worldbuilding', 'Magic', 'Arcane Arts.md'), 'utf-8')).toBe(note3);
    expect(fs.readFileSync(path.join(r.notesVaultPath!, 'index.md'), 'utf-8')).toContain('[[Characters/Aria]]');
    expect(Buffer.compare(
      fs.readFileSync(path.join(r.notesVaultPath!, 'Characters', 'aria-portrait.png')),
      pngData,
    )).toBe(0);

    expect(fs.existsSync(path.join(r.notesVaultPath!, '.obsidian'))).toBe(false);
    expect(fs.existsSync(path.join(r.notesVaultPath!, 'Characters'))).toBe(true);
    expect(fs.existsSync(path.join(r.notesVaultPath!, 'Worldbuilding', 'Magic'))).toBe(true);

    fs.rmSync(src, { recursive: true, force: true });
  });

  it('imported notes vault is reachable at notesVaultRootFor(mythosRoot)', async () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-reach-'));
    fs.mkdirSync(path.join(src, '.obsidian'));
    fs.writeFileSync(path.join(src, 'hello.md'), '# Hello\n\n[[World]].\n');
    fs.writeFileSync(path.join(src, 'World.md'), '# World\n');

    const r = await createVaultFromOptions({
      destinationParent: tmp,
      name: 'ReachTest',
      mode: 'import',
      importSources: [{ kind: 'notes', srcPath: src }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const notesRoot = r.notesVaultPath!;
    expect(fs.existsSync(notesRoot)).toBe(true);
    const entries = fs.readdirSync(notesRoot).filter(n => !n.startsWith('.'));
    expect(entries).toContain('hello.md');
    expect(entries).toContain('World.md');
    expect(fs.readFileSync(path.join(notesRoot, 'hello.md'), 'utf-8')).toContain('[[World]]');

    const mythosRoot = r.mythosRoot!;
    const resolvedNotesRoot = notesVaultRootFor(mythosRoot);
    expect(resolvedNotesRoot).toBe(notesRoot);

    fs.rmSync(src, { recursive: true, force: true });
  });
});
