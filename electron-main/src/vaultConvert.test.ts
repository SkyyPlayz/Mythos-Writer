// Beta 3 M24: unit tests for the "Import another vault" converters
// (Obsidian/Markdown reuse the Beta-2 importer; Notion + Scrivener convert).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  stripNotionSuffix,
  notionTargetRel,
  rewriteNotionLinks,
  scanVaultSource,
  convertVaultSource,
  secondVaultDestination,
} from './vaultConvert.js';

const HEX = '0123456789abcdef0123456789abcdef';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm24-vaultconvert-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── Notion helpers ─────────────────────────────────────────────────────────────

describe('stripNotionSuffix / notionTargetRel', () => {
  it('strips the 32-hex export id from names, preserving extensions', () => {
    expect(stripNotionSuffix(`Characters ${HEX}.md`)).toBe('Characters.md');
    expect(stripNotionSuffix(`Characters ${HEX}`)).toBe('Characters');
    expect(stripNotionSuffix('Plain note.md')).toBe('Plain note.md');
  });

  it('strips every path segment', () => {
    expect(notionTargetRel(`World ${HEX}/Places ${HEX}/The Gate ${HEX}.md`))
      .toBe('World/Places/The Gate.md');
  });
});

describe('rewriteNotionLinks', () => {
  it('rewrites internal .md links to wiki links', () => {
    const input = `See [The Gate](The%20Gate%20${HEX}.md) for details.`;
    expect(rewriteNotionLinks(input)).toBe('See [[The Gate]] for details.');
  });

  it('keeps the label as an alias when it differs from the target', () => {
    const input = `See [the gate](World%20${HEX}/The%20Gate%20${HEX}.md).`;
    expect(rewriteNotionLinks(input)).toBe('See [[The Gate|the gate]].');
  });

  it('leaves external and non-md links untouched', () => {
    const input = '[site](https://example.com) and [img](pic%20one.png)';
    expect(rewriteNotionLinks(input)).toBe(input);
  });
});

// ── scan + convert: Notion ─────────────────────────────────────────────────────

function makeNotionExport(): string {
  const src = path.join(tmp, 'notion-export');
  fs.mkdirSync(path.join(src, `World ${HEX}`), { recursive: true });
  fs.writeFileSync(
    path.join(src, `World ${HEX}`, `The Gate ${HEX}.md`),
    `# The Gate\n\nLinks to [Mira](Mira%20${HEX}.md).\n`,
  );
  fs.writeFileSync(path.join(src, `Mira ${HEX}.md`), '# Mira\n\nA character.\n');
  fs.writeFileSync(path.join(src, `Database ${HEX}.csv`), 'a,b\n1,2\n');
  return src;
}

describe('scanVaultSource (notion)', () => {
  it('counts notes and warns about CSV databases', () => {
    const src = makeNotionExport();
    const scan = scanVaultSource('notion', src);
    if ('error' in scan) throw new Error(scan.error);
    expect(scan.noteCount).toBe(2);
    expect(scan.warnings.some((w) => w.includes('CSV'))).toBe(true);
    expect(scan.sampleFiles.every((f) => !f.includes(HEX))).toBe(true);
  });

  it('errors on a missing path', () => {
    const scan = scanVaultSource('notion', path.join(tmp, 'nope'));
    expect('error' in scan).toBe(true);
  });
});

describe('convertVaultSource (notion)', () => {
  it('renames files, rewrites links, and skips CSVs', () => {
    const src = makeNotionExport();
    const dst = path.join(tmp, 'dst');
    const res = convertVaultSource('notion', src, dst);
    expect(res.ok).toBe(true);
    expect(res.imported).toBe(2);
    const gate = fs.readFileSync(path.join(dst, 'World', 'The Gate.md'), 'utf-8');
    expect(gate).toContain('[[Mira]]');
    expect(fs.existsSync(path.join(dst, 'Mira.md'))).toBe(true);
    expect(fs.readdirSync(dst).some((f) => f.endsWith('.csv'))).toBe(false);
  });
});

// ── scan + convert: Markdown (Beta-2 Obsidian importer reuse) ─────────────────

describe('markdown tree import', () => {
  it('scans and imports a plain markdown folder', () => {
    const src = path.join(tmp, 'md-vault');
    fs.mkdirSync(path.join(src, 'Lore'), { recursive: true });
    fs.writeFileSync(path.join(src, 'Lore', 'Tides.md'), '# Tides\n\nSee [[Moon]].\n');
    fs.writeFileSync(path.join(src, 'Moon.md'), '# Moon\n');

    const scan = scanVaultSource('markdown', src);
    if ('error' in scan) throw new Error(scan.error);
    expect(scan.noteCount).toBe(2);

    const dst = path.join(tmp, 'md-dst');
    const res = convertVaultSource('markdown', src, dst);
    expect(res.ok).toBe(true);
    expect(res.imported).toBe(2);
    expect(fs.existsSync(path.join(dst, 'Lore', 'Tides.md'))).toBe(true);
  });

  // SKY-8151: convertVaultSource used to discard importObsidianToVaultDir's
  // sourceCount/dropWarning entirely, so the live VAULT_IMPORT_RUN path (the
  // one Settings → Vault & Files → "Import another vault" actually calls)
  // could never surface a silent-drop warning to the user. Assert these
  // fields now flow through convertVaultSource's return value.
  it('propagates sourceCount and dropWarning from the underlying Obsidian importer', () => {
    const src = path.join(tmp, 'md-vault-2');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'One.md'), '# One\n');
    fs.writeFileSync(path.join(src, 'Two.md'), '# Two\n');

    const dst = path.join(tmp, 'md-dst-2');
    const res = convertVaultSource('markdown', src, dst);
    expect(res.sourceCount).toBe(2);
    expect(res.dropWarning).toBeUndefined();
  });
});

// ── scan + convert: Scrivener ─────────────────────────────────────────────────

function makeScrivProject(): string {
  const proj = path.join(tmp, 'World Bible.scriv');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'World Bible.scrivx'), `<?xml version="1.0"?>
<ScrivenerProject><Binder>
  <BinderItem UUID="R" Type="ResearchFolder"><Title>Research</Title><Children>
    <BinderItem UUID="N1" Type="Text"><Title>Tide Mechanics</Title></BinderItem>
  </Children></BinderItem>
</Binder></ScrivenerProject>`);
  fs.mkdirSync(path.join(proj, 'Files', 'Data', 'N1'), { recursive: true });
  fs.writeFileSync(
    path.join(proj, 'Files', 'Data', 'N1', 'content.rtf'),
    String.raw`{\rtf1\ansi The tide rises twice.\par}`,
  );
  return proj;
}

describe('scrivener vault import', () => {
  it('scans binder text documents', () => {
    const proj = makeScrivProject();
    const scan = scanVaultSource('scriv', path.join(proj, 'World Bible.scrivx'));
    if ('error' in scan) throw new Error(scan.error);
    expect(scan.noteCount).toBe(1);
    expect(scan.sampleFiles).toContain('Tide Mechanics');
  });

  it('converts binder texts into folder-structured markdown notes', () => {
    const proj = makeScrivProject();
    const dst = path.join(tmp, 'scriv-dst');
    const res = convertVaultSource('scriv', path.join(proj, 'World Bible.scrivx'), dst);
    expect(res.ok).toBe(true);
    expect(res.imported).toBe(1);
    const note = fs.readFileSync(path.join(dst, 'Research', 'Tide Mechanics.md'), 'utf-8');
    expect(note).toContain('# Tide Mechanics');
    expect(note).toContain('The tide rises twice.');
  });
});

// ── secondVaultDestination ─────────────────────────────────────────────────────

describe('secondVaultDestination', () => {
  it('nests under Imported/ and avoids clobbering non-empty folders', () => {
    const notesRoot = path.join(tmp, 'notes');
    const first = secondVaultDestination(notesRoot, '/somewhere/My Vault');
    expect(first).toBe(path.join(notesRoot, 'Imported', 'My Vault'));

    fs.mkdirSync(first, { recursive: true });
    fs.writeFileSync(path.join(first, 'x.md'), 'x');
    const second = secondVaultDestination(notesRoot, '/somewhere/My Vault');
    expect(second).toBe(path.join(notesRoot, 'Imported', 'My Vault 2'));
  });

  it('drops .scriv extensions from the folder name', () => {
    const dest = secondVaultDestination(path.join(tmp, 'notes'), '/x/World Bible.scriv');
    expect(path.basename(dest)).toBe('World Bible');
  });
});
