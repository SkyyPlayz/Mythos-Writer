// Shield r4 F1 — cleanup containment, link skips, flag-off trash, and confirm-bound delete.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  appPrivateTrash,
  artifactUserDataDir,
  cleanupListHash,
  confirmCleanup,
  sweepArtifacts,
} from './artifactCleanup.js';

const dirs: string[] = [];
const VAULT_ID = '4a1b0c2d-e3f4-4123-8abc-1234567890c0';

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function world(): { vault: string; userData: string; dir: string } {
  const vault = tmp('mythos-clean-vault-');
  const userData = tmp('mythos-clean-user-');
  const dir = artifactUserDataDir(userData, VAULT_ID);
  if (!dir) throw new Error('vault id');
  fs.mkdirSync(dir, { recursive: true });
  return { vault, userData, dir };
}

afterEach(() => {
  vi.restoreAllMocks();
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('artifact cleanup (Shield r4 F1)', () => {
  it('refuses a vault id that is not a UUID', () => {
    const { vault, userData } = world();
    const report = sweepArtifacts({ vaultRoot: vault, userData, vaultId: '../x', flagOff: true });
    expect(report).toMatchObject({ ok: false, reason: 'bad_vault_id', deleted: [] });
  });

  it('refuses a path outside the artifact roots and deletes nothing', () => {
    const { vault, userData } = world();
    const outside = path.join(tmp('mythos-clean-out-'), 'secret.txt');
    fs.writeFileSync(outside, 'untouched');
    const report = confirmCleanup({
      paths: [outside],
      listHash: cleanupListHash([outside]),
      vaultRoot: vault,
      userData,
      vaultId: VAULT_ID,
      allowDelete: true,
    });
    expect(report).toMatchObject({ ok: false, reason: 'outside', deleted: [] });
    expect(fs.readFileSync(outside, 'utf8')).toBe('untouched');
  });

  it('does not follow a symlinked artifact root', () => {
    const { vault, userData } = world();
    const outside = tmp('mythos-clean-root-');
    const secret = path.join(outside, 'secret.txt');
    fs.writeFileSync(secret, 'untouched');
    const linked = path.join(userData, 'artifacts', VAULT_ID);
    fs.rmSync(linked, { recursive: true, force: true });
    fs.symlinkSync(outside, linked);
    const report = sweepArtifacts({ vaultRoot: vault, userData, vaultId: VAULT_ID, flagOff: true });
    expect(report.ok).toBe(false);
    expect(report.deleted).toEqual([]);
    expect(fs.readFileSync(secret, 'utf8')).toBe('untouched');
  });

  it('skips a symlink and a hardlink and still reports them', () => {
    const { vault, userData, dir } = world();
    const file = path.join(dir, 'note.json');
    const twin = path.join(dir, 'twin.json');
    const link = path.join(dir, 'link.json');
    fs.writeFileSync(file, 'keep');
    fs.writeFileSync(twin, 'also');
    fs.symlinkSync(file, link);
    fs.linkSync(file, path.join(dir, 'hard.json'));
    const hard = path.join(dir, 'hard.json');
    const paths = [link, hard, twin];
    const report = confirmCleanup({
      paths,
      listHash: cleanupListHash(paths),
      vaultRoot: vault,
      userData,
      vaultId: VAULT_ID,
      allowDelete: true,
    });
    expect(report.ok).toBe(true);
    expect(report.skipped.map((row) => row.reason).sort()).toEqual(['hardlink', 'symlink']);
    expect(fs.readFileSync(file, 'utf8')).toBe('keep');
    expect(fs.readFileSync(hard, 'utf8')).toBe('keep');
    expect(fs.existsSync(link)).toBe(true);
    expect(fs.existsSync(twin)).toBe(false);
  });

  it('moves files to the app-private trash when the flag is off and does not delete them', () => {
    const { vault, userData, dir } = world();
    const file = path.join(dir, 'note.json');
    fs.writeFileSync(file, 'keep');
    const report = sweepArtifacts({ vaultRoot: vault, userData, vaultId: VAULT_ID, flagOff: true });
    expect(report.deleted).toEqual([]);
    expect(report.trashed).toEqual([file]);
    expect(fs.existsSync(file)).toBe(false);
    const trash = fs.readdirSync(appPrivateTrash(userData));
    expect(trash).toHaveLength(1);
    expect(fs.readFileSync(path.join(appPrivateTrash(userData), trash[0]), 'utf8')).toBe('keep');
  });

  it('deletes only when the confirm hash matches the exact path list', () => {
    const { vault, userData, dir } = world();
    const file = path.join(dir, 'note.json');
    fs.writeFileSync(file, 'gone');
    const paths = [file];
    const report = confirmCleanup({
      paths,
      listHash: cleanupListHash(paths),
      vaultRoot: vault,
      userData,
      vaultId: VAULT_ID,
      allowDelete: true,
    });
    expect(report.deleted).toEqual([file]);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('refuses a changed list and leaves every file in place', () => {
    const { vault, userData, dir } = world();
    const a = path.join(dir, 'a.json');
    const b = path.join(dir, 'b.json');
    fs.writeFileSync(a, 'a');
    fs.writeFileSync(b, 'b');
    const report = confirmCleanup({
      paths: [a, b],
      listHash: cleanupListHash([a]),
      vaultRoot: vault,
      userData,
      vaultId: VAULT_ID,
      allowDelete: true,
    });
    expect(report).toMatchObject({ ok: false, reason: 'list_changed', deleted: [] });
    expect(fs.readFileSync(a, 'utf8')).toBe('a');
    expect(fs.readFileSync(b, 'utf8')).toBe('b');
  });

  it('deletes nothing when a rename throws', () => {
    const { vault, userData, dir } = world();
    const file = path.join(dir, 'note.json');
    fs.writeFileSync(file, 'stay');
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('disk');
    });
    const paths = [file];
    const report = confirmCleanup({
      paths,
      listHash: cleanupListHash(paths),
      vaultRoot: vault,
      userData,
      vaultId: VAULT_ID,
      allowDelete: true,
    });
    expect(report).toMatchObject({ ok: false, reason: 'error', deleted: [] });
    expect(fs.readFileSync(file, 'utf8')).toBe('stay');
  });
});
