// Grep gate for PR A. Production code must not import the test hook module,
// must not call the old vault writer, and must not pass a custom `deps`
// object into the no-follow writers. Known raw-write leftovers stay on an
// allowlist so a new file that both uses the vault writer and writes raw fails.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const EXPORT_ALLOW = new Set([
  'main.ts',
  'vault.ts',
  'vault/vaultFileWrite.ts',
]);

/** Files that already import the vault writer and also raw-write. A new one fails. */
const RAW_WRITE_ALLOW = new Set([
  'main.ts',
  'vault.ts',
  'mythosFormat/v2IdDedupe.ts',
  'suggestionApply.ts',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && full.endsWith('.ts') && !full.endsWith('.test.ts') && !full.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

function rel(full: string): string {
  return path.relative(SRC, full).split(path.sep).join('/');
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('writeGuard', () => {
  const files = walk(SRC);

  it('no production file imports noFollowWrite.testing', () => {
    const hits = files.filter((file) => /noFollowWrite\.testing/.test(stripComments(fs.readFileSync(file, 'utf8'))));
    expect(hits.map(rel)).toEqual([]);
  });

  it('default no-follow hooks are empty no-ops', () => {
    const src = stripComments(fs.readFileSync(path.join(SRC, 'vault/noFollowWrite.ts'), 'utf8'));
    expect(src).toMatch(/const noopHooks: NoFollowHooks = \{\s*afterOpen\(\) \{\},\s*beforeRename\(\) \{\},\s*\}/);
    expect(src).toMatch(/hooks: noopHooks,/);
  });

  it('no production file calls writeFileAtomic(', () => {
    const hits = files.filter((file) => /\bwriteFileAtomic\s*\(/.test(stripComments(fs.readFileSync(file, 'utf8'))));
    expect(hits.map(rel)).toEqual([]);
  });

  it('writeExportFileAtomic stays on the export allowlist', () => {
    const hits = files
      .filter((file) => stripComments(fs.readFileSync(file, 'utf8')).includes('writeExportFileAtomic'))
      .map(rel);
    expect(hits.filter((name) => !EXPORT_ALLOW.has(name))).toEqual([]);
    expect(hits).toEqual(expect.arrayContaining(['main.ts', 'vault.ts', 'vault/vaultFileWrite.ts']));
  });

  it('the EPUB targetPath branch writes through the vault, not the export writer', () => {
    const main = fs.readFileSync(path.join(SRC, 'main.ts'), 'utf8');
    const start = main.indexOf('[IPC_CHANNELS.EXPORT_EPUB]');
    expect(start).toBeGreaterThan(-1);
    const end = main.indexOf('[IPC_CHANNELS.', start + 1);
    const body = main.slice(start, end === -1 ? undefined : end);
    expect(body).toContain('commitEpubTargetExport');
    expect(body).not.toContain('writeExportFileAtomic');
  });

  it('product no-follow calls do not pass a custom deps object', () => {
    const call = /(?:writeNoFollowAtomic|appendNoFollow|copyNoFollowAtomic)\s*\([\s\S]{0,500}?deps\s*:/;
    const hits = files
      .filter((file) => rel(file) !== 'vault/noFollowWrite.ts')
      .filter((file) => call.test(stripComments(fs.readFileSync(file, 'utf8'))))
      .map(rel);
    expect(hits).toEqual([]);
  });

  it('a file that imports the vault writer and raw-writes is on the allowlist', () => {
    const both = files.filter((file) => {
      const text = fs.readFileSync(file, 'utf8');
      return text.includes('writeVaultFileAtomic') && /\b(?:writeFileSync|appendFileSync)\s*\(/.test(text);
    }).map(rel);
    expect(both.filter((name) => !RAW_WRITE_ALLOW.has(name))).toEqual([]);
  });
});
