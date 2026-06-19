import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { renameCollisionFiles, writeVaultImportLog, resolveVaultImportCollisions } from './vaultImportConflict.js';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-import-conflict-'));
}

describe('renameCollisionFiles', () => {
  it('renames collision note to <name> (Imported).md', () => {
    const vault = mkTmp();
    fs.writeFileSync(path.join(vault, 'Arthur.md'), '# Arthur');

    const results = renameCollisionFiles(vault, [{ name: 'Arthur', file: 'Arthur.md' }]);

    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    expect(results[0].from).toBe('Arthur.md');
    expect(results[0].to).toBe('Arthur (Imported).md');
    expect(fs.existsSync(path.join(vault, 'Arthur.md'))).toBe(false);
    expect(fs.existsSync(path.join(vault, 'Arthur (Imported).md'))).toBe(true);
  });

  it('renames collision in a subdirectory', () => {
    const vault = mkTmp();
    fs.mkdirSync(path.join(vault, 'Characters'));
    fs.writeFileSync(path.join(vault, 'Characters', 'Merlin.md'), '# Merlin');

    const results = renameCollisionFiles(vault, [{ name: 'Merlin', file: 'Characters/Merlin.md' }]);

    expect(results[0].ok).toBe(true);
    expect(fs.existsSync(path.join(vault, 'Characters', 'Merlin.md'))).toBe(false);
    expect(fs.existsSync(path.join(vault, 'Characters', 'Merlin (Imported).md'))).toBe(true);
  });

  it('skips rename when source file does not exist', () => {
    const vault = mkTmp();
    const results = renameCollisionFiles(vault, [{ name: 'Ghost', file: 'Ghost.md' }]);
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toMatch(/not found/);
  });

  it('skips rename when target already exists', () => {
    const vault = mkTmp();
    fs.writeFileSync(path.join(vault, 'Hero.md'), '# Hero');
    fs.writeFileSync(path.join(vault, 'Hero (Imported).md'), '# Already there');

    const results = renameCollisionFiles(vault, [{ name: 'Hero', file: 'Hero.md' }]);
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toMatch(/already exists/);
    // Original file untouched
    expect(fs.existsSync(path.join(vault, 'Hero.md'))).toBe(true);
  });

  it('rejects path traversal in relative path', () => {
    const vault = mkTmp();
    const results = renameCollisionFiles(vault, [{ name: 'Evil', file: '../outside.md' }]);
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toMatch(/traversal denied/);
  });

  it('rejects null-byte path', () => {
    const vault = mkTmp();
    const results = renameCollisionFiles(vault, [{ name: 'Bad', file: 'Bad\0.md' }]);
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toMatch(/traversal denied/);
  });

  it('handles multiple collisions in one call', () => {
    const vault = mkTmp();
    fs.writeFileSync(path.join(vault, 'Alpha.md'), '# Alpha');
    fs.writeFileSync(path.join(vault, 'Beta.md'), '# Beta');

    const results = renameCollisionFiles(vault, [
      { name: 'Alpha', file: 'Alpha.md' },
      { name: 'Beta', file: 'Beta.md' },
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(fs.existsSync(path.join(vault, 'Alpha (Imported).md'))).toBe(true);
    expect(fs.existsSync(path.join(vault, 'Beta (Imported).md'))).toBe(true);
  });

  it('returns empty array when nameCollisions is empty', () => {
    const vault = mkTmp();
    expect(renameCollisionFiles(vault, [])).toEqual([]);
  });
});

describe('writeVaultImportLog', () => {
  it('writes .vault-import-log.md at the vault root', () => {
    const vault = mkTmp();
    writeVaultImportLog({
      sourcePath: vault,
      renamedFiles: [{ from: 'Arthur.md', to: 'Arthur (Imported).md', ok: true }],
      brokenLinkCount: 2,
      importedAt: '2026-06-19T00:00:00.000Z',
    });

    const log = fs.readFileSync(path.join(vault, '.vault-import-log.md'), 'utf-8');
    expect(log).toContain('# Vault Import Log');
    expect(log).toContain('Arthur.md');
    expect(log).toContain('Arthur (Imported).md');
    expect(log).toContain('2 notes contain broken');
  });

  it('notes clean import when there are no conflicts or broken links', () => {
    const vault = mkTmp();
    writeVaultImportLog({
      sourcePath: vault,
      renamedFiles: [],
      brokenLinkCount: 0,
      importedAt: '2026-06-19T00:00:00.000Z',
    });

    const log = fs.readFileSync(path.join(vault, '.vault-import-log.md'), 'utf-8');
    expect(log).toContain('No conflicts or broken links');
  });

  it('includes rename errors section when renames failed', () => {
    const vault = mkTmp();
    writeVaultImportLog({
      sourcePath: vault,
      renamedFiles: [{ from: 'Bad.md', to: 'Bad (Imported).md', ok: false, error: 'source file not found' }],
      brokenLinkCount: 0,
      importedAt: '2026-06-19T00:00:00.000Z',
    });

    const log = fs.readFileSync(path.join(vault, '.vault-import-log.md'), 'utf-8');
    expect(log).toContain('Rename Errors');
    expect(log).toContain('source file not found');
  });
});

describe('resolveVaultImportCollisions', () => {
  it('renames collision files and writes the import log in one step', () => {
    const vault = mkTmp();
    fs.writeFileSync(path.join(vault, 'Dragon.md'), '# Dragon');

    const result = resolveVaultImportCollisions(
      vault,
      [{ name: 'Dragon', file: 'Dragon.md' }],
      3,
      '2026-06-19T00:00:00.000Z',
    );

    expect(result.renamedFiles).toHaveLength(1);
    expect(result.renamedFiles[0].ok).toBe(true);
    expect(result.logWritten).toBe(true);
    expect(fs.existsSync(path.join(vault, 'Dragon (Imported).md'))).toBe(true);
    expect(fs.existsSync(path.join(vault, '.vault-import-log.md'))).toBe(true);

    const log = fs.readFileSync(path.join(vault, '.vault-import-log.md'), 'utf-8');
    expect(log).toContain('Dragon.md');
    expect(log).toContain('3 notes contain broken');
  });

  it('handles zero collisions — still writes the log', () => {
    const vault = mkTmp();
    const result = resolveVaultImportCollisions(vault, [], 0, '2026-06-19T00:00:00.000Z');
    expect(result.renamedFiles).toEqual([]);
    expect(result.logWritten).toBe(true);
    expect(fs.existsSync(path.join(vault, '.vault-import-log.md'))).toBe(true);
  });
});
