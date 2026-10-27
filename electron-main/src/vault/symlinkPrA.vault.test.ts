// PR A proofs: symlink leaf refusal, no-follow writes, rule Z, secrets read,
// bulk skip-and-list, and the rename cascade standing in for vaultTransaction
// until #1746 is on main.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import childProcess, { execFileSync, spawnSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import JSZip from 'jszip';

import { assertAiWritable } from './aiWriteGuard.js';
import { safeVaultJoin } from './safeVaultJoin.js';
import * as joinMod from './safeVaultJoin.js';
import {
  NOFOLLOW_COPY_MAX_BYTES,
  VaultWriteRefusedError,
  appendNoFollow,
  copyNoFollowAtomic,
  defaultDeps,
  probeVolumeKind,
  resetVolumeProbeCache,
  writeNoFollowAtomic,
  type VolumeKind,
} from './noFollowWrite.js';
import { resetNoFollowHooksForTests, setNoFollowHooksForTests } from './noFollowWrite.testing.js';
import { MAX_VAULT_FILE_BYTES, VaultFileTooLargeError } from './limits.js';
import { MAX_IMPORT_FILE_BYTES } from '../obsidianImporter.js';
import {
  SETTINGS_LINK_TEXT,
  SYMLINK_SAVE_TEXT,
  exportFailureText,
  isNoFollowExportFailure,
  isSymlinkWriteRefusal,
  mapVaultWriteError,
  symlinkSkipLine,
} from './writeErrors.js';
import { volumeUnsupportedText } from './writeErrorText.js';
import { renameSyncWithRetry } from './renameSyncWithRetry.js';
import { writeManifestBytes, writeVaultFileNoFollow } from './vaultFileWrite.js';
import { ManifestMigrationError, openManifest } from '../manifest.js';
import {
  commitEpubTargetExport,
  listVaultFiles,
  writeExportFileAtomic,
  writeSceneFile,
  writeVaultFileAtomic,
  writeVaultFileUnsafe_testOnly,
  writeVaultOrSkip,
} from '../vault.js';
import { writeOrderMap } from '../vaultOrder.js';
import { writeIconMap } from '../vaultIcons.js';
import { deleteLeftoverAtomicTemps, writeFileAtomicSecure } from '../secrets/atomicWrite.js';
import { readUserDataFile } from '../secrets/userDataRead.js';
import { SecretsStore } from '../secrets/store.js';
import {
  loadAppSettingsFrom,
  settingsLoadUsedParseFallbackOnLastRead,
} from '../appSettingsLoad.js';
import { BACKUP_SCHEMA_VERSION, restoreAppData } from '../backup.js';
import {
  TIMELINES_BACKUP_SUFFIX,
  TIMELINES_FILENAME,
  createSeedTimelinesStore,
  readTimelinesStore,
  writeTimelinesStore,
} from '../timelines/store.js';
import {
  _resetRenameCascadeState,
  renameNoteWithCascade,
  undoLastRenameCascade,
} from '../renameCascade.js';
import { listNotesTags, renameNotesTag } from '../notesTagWrangler.js';
import { writeReIdFile } from '../mythosFormat/v2IdDedupe.js';
import { GENRE_SEED_NOTE_PATHS, writeGenreStarterNotes } from '../mythosFormat/genreSeed.js';
import { VEYNN_STORY_FOLDER, writeVeynnSeed } from '../mythosFormat/veynnSeed.js';
import { applySeedPackToNewVault } from '../mythosFormat/seedPackApply.js';
import { runMythosVaultMigration } from '../migration/mythosVaultMigrator.js';
import { scanMythosStoryVault, syncCanonicalFromManifest } from '../mythosFormat/v2Manifest.js';
import { createMythosVault } from '../mythosFormat/createVault.js';
import { _clearDetectionCache, notesVaultRootFor, storyVaultRootFor } from '../mythosFormat/mythosJson.js';
import { createBoardItem } from '../notesBoard.js';
import { SESSIONS_DIRNAME, createSession } from '../mythosFormat/agentSessions.js';

let symlinksWork = true;

beforeAll(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-symlink-probe-'));
  try {
    fs.symlinkSync('target', path.join(dir, 'link'));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EPERM') {
      console.error(`file symlink EPERM — skipping symlink proofs (${(err as Error).message})`);
      symlinksWork = false;
      return;
    }
    throw err;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const PRE_PR_NULL_BYTE_RE = /\u0000/;
const PRE_PR_WINDOWS_DRIVE_RE = /^[A-Za-z]:[\\/]/;
const PRE_PR_UNC_RE = /^\\\\/;
const PRE_PR_ENCODED_DOTDOT_RE = /(?:%2e){2}|(?:%252e){2}/i;

/**
 * `writeFileAtomic` as it stood on main 5b4c93d1 (temp, fdatasync, rename).
 * The perf test runs this beside the current writer in one process.
 */
function prePrWriteFileAtomic(absPath: string, data: Buffer | string): void {
  const dir = path.dirname(absPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${absPath}.${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`;
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, buf);
    fs.fdatasyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    renameSyncWithRetry(tmp, absPath);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore cleanup errors */
    }
    throw err;
  }
}

function prePrIsWithinVault(realVaultRoot: string, candidate: string): boolean {
  return candidate === realVaultRoot || candidate.startsWith(realVaultRoot + path.sep);
}

/**
 * Write-mode `safeVaultJoin` as it stood on main 5b4c93d1.
 * Missing parents walk with existsSync only; the leaf is not lstat'd.
 */
function prePrSafeVaultJoin(vaultRoot: string, relPath: string): string {
  if (typeof relPath !== 'string') {
    throw new Error('Path traversal denied: path must be a string');
  }
  if (PRE_PR_NULL_BYTE_RE.test(relPath)) {
    throw new Error(`Path traversal denied: ${JSON.stringify(relPath)} (null byte in path)`);
  }
  if (PRE_PR_WINDOWS_DRIVE_RE.test(relPath) || PRE_PR_UNC_RE.test(relPath)) {
    throw new Error(`Path traversal denied: ${relPath} (absolute Windows path)`);
  }
  if (PRE_PR_ENCODED_DOTDOT_RE.test(relPath)) {
    throw new Error(`Path traversal denied: ${relPath} (encoded traversal sequence)`);
  }

  const realVaultRoot = fs.realpathSync.native(vaultRoot);
  const resolved = path.resolve(vaultRoot, relPath);
  let ancestor = resolved;
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  if (!fs.existsSync(ancestor)) throw new Error(`Path traversal denied: ${relPath}`);

  const realAncestor = fs.realpathSync.native(ancestor);
  if (!prePrIsWithinVault(realVaultRoot, realAncestor)) {
    const msg =
      ancestor === resolved
        ? `Path traversal denied: ${relPath} (symlink escape detected)`
        : `Path traversal denied: ${relPath} (parent symlink escapes vault)`;
    throw new Error(msg);
  }

  const remainder = path.relative(ancestor, resolved);
  const realTarget = path.resolve(realAncestor, remainder);
  if (!prePrIsWithinVault(realVaultRoot, realTarget)) {
    throw new Error(`Path traversal denied: ${relPath}`);
  }
  return realTarget;
}

interface PerfStats {
  p50: number;
  p95: number;
  min: number;
  max: number;
}

function perfStats(values: number[]): PerfStats {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1))] ?? 0;
  return {
    p50: at(0.5),
    p95: at(0.95),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

function perfPct(oldMs: number, newMs: number): number {
  if (oldMs === 0) return newMs === 0 ? 0 : Number.POSITIVE_INFINITY;
  return ((newMs - oldMs) / oldMs) * 100;
}

function perfMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
}

const PROFILE_FS_METHODS = [
  'lstatSync',
  'existsSync',
  'openSync',
  'writeSync',
  'fdatasyncSync',
  'fsyncSync',
  'fstatSync',
  'closeSync',
  'renameSync',
  'mkdirSync',
  'readlinkSync',
  'statSync',
  'statfsSync',
  'unlinkSync',
] as const;

interface ProfileBucket {
  calls: number;
  ms: number;
}

function profileFsCalls(samples: number, run: () => void): Map<string, ProfileBucket> {
  const buckets = new Map<string, ProfileBucket>();
  const add = (name: string, ms: number): void => {
    const bucket = buckets.get(name) ?? { calls: 0, ms: 0 };
    bucket.calls += 1;
    bucket.ms += ms;
    buckets.set(name, bucket);
  };
  const timeFn = <T extends (...args: never[]) => unknown>(name: string, orig: T): T =>
    ((...args: never[]) => {
      const start = performance.now();
      try {
        return orig(...args);
      } finally {
        add(name, performance.now() - start);
      }
    }) as T;

  const fsMutable = fs as unknown as Record<string, (...args: never[]) => unknown>;
  const saved: Array<[string, (...args: never[]) => unknown]> = [];
  for (const name of PROFILE_FS_METHODS) {
    const orig = fsMutable[name];
    if (typeof orig !== 'function') continue;
    saved.push([name, orig]);
    fsMutable[name] = timeFn(name, orig);
  }
  const origNative = fs.realpathSync.native;
  fs.realpathSync.native = timeFn('realpathSync.native', origNative);

  const origExec = childProcess.execFileSync;
  let execWrapped = false;
  try {
    childProcess.execFileSync = timeFn('execFileSync', origExec);
    execWrapped = true;
  } catch {
    execWrapped = false;
  }

  try {
    for (let i = 0; i < samples; i++) run();
    if (!execWrapped) add('execFileSync-wrap-failed', 0);
    return buckets;
  } finally {
    for (const [name, orig] of saved) fsMutable[name] = orig;
    fs.realpathSync.native = origNative;
    if (execWrapped) childProcess.execFileSync = origExec;
  }
}

describe('PR A symlink writes', () => {
  let tmp: string;
  let root: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-symlink-a-'));
    root = path.join(tmp, 'vault');
    fs.mkdirSync(root);
    resetNoFollowHooksForTests();
    resetVolumeProbeCache();
    _resetRenameCascadeState();
    _clearDetectionCache();
  });

  afterEach(() => {
    resetNoFollowHooksForTests();
    resetVolumeProbeCache();
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function skipSymlink(): boolean {
    return !symlinksWork;
  }

  function pathKey(p: fs.PathLike): string {
    const resolved = path.resolve(String(p));
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  function zeroInoFs(): typeof fs {
    return new Proxy(fs, {
      get(target, prop, receiver) {
        if (prop === 'fstatSync' || prop === 'lstatSync') {
          const real = target[prop] as (p: never, opts?: { bigint?: boolean }) => fs.Stats | fs.BigIntStats;
          return (p: never, opts?: { bigint?: boolean }) => {
            const st = real.call(target, p, opts);
            if (!opts?.bigint) return st;
            return new Proxy(st, {
              get(stats, key, statsReceiver) {
                if (key === 'ino') return 0n;
                const value = Reflect.get(stats, key, statsReceiver);
                return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(stats) : value;
              },
            });
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
  }

  function withProbe(kind: VolumeKind) {
    return { ...defaultDeps, fs: zeroInoFs(), probeVolume: () => kind };
  }

  function readSyncFs(mode: 'short' | 'eof'): typeof fs {
    const real = fs.readSync.bind(fs);
    return new Proxy(fs, {
      get(target, prop, receiver) {
        if (prop === 'readSync') {
          return (fd: number, buf: NodeJS.ArrayBufferView, offset: number, length: number, position: number) => {
            if (mode === 'eof') return 0;
            return real(fd, buf, offset, Math.min(2, length), position);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
  }

  it('A1 refuses a dangling outside leaf on read and write', () => {
    if (skipSymlink()) return;
    const outside = path.join(tmp, 'missing-outside');
    fs.symlinkSync(outside, path.join(root, 'dang.md'));
    expect(() => safeVaultJoin(root, 'dang.md')).toThrow(/Path traversal denied: dang\.md$/);
    expect(() => safeVaultJoin(root, 'dang.md', { writeMode: true })).toThrow(/symlink leaf not allowed on write/);
    expect(fs.existsSync(outside)).toBe(false);
  });

  it('A2 refuses a dangling in-vault leaf on write', () => {
    if (skipSymlink()) return;
    fs.symlinkSync('missing-inside.md', path.join(root, 'dang.md'));
    expect(() => writeVaultFileAtomic(root, 'dang.md', 'x')).toThrow(/symlink leaf|LEAF_LINK/);
    expect(fs.lstatSync(path.join(root, 'dang.md')).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(root, 'missing-inside.md'))).toBe(false);
  });

  it('refuses a file symlink leaf from lstat when readlink is unavailable', () => {
    if (skipSymlink()) return;
    const outside = path.join(tmp, 'outside-file.txt');
    fs.writeFileSync(outside, 'KEEP');
    const link = path.join(root, 'leaf.md');
    fs.symlinkSync(outside, link);
    const st = fs.lstatSync(link);
    expect(st.isSymbolicLink()).toBe(true);
    expect(st.isFile()).toBe(false);
    const readlink = vi.spyOn(fs, 'readlinkSync').mockImplementation(() => {
      throw Object.assign(new Error('readlink disabled'), { code: 'EINVAL' });
    });
    try {
      expect(() => safeVaultJoin(root, 'leaf.md', { writeMode: true })).toThrow(/symlink leaf not allowed on write/);
      expect(() => writeNoFollowAtomic(link, 'nope', { rel: 'leaf.md' })).toThrow(/LEAF_LINK/);
    } finally {
      readlink.mockRestore();
    }
    expect(fs.readFileSync(outside, 'utf8')).toBe('KEEP');
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it('mkdirs a missing parent and skips mkdir when the parent exists', () => {
    writeVaultFileAtomic(root, 'nested/note.md', 'body');
    expect(fs.readFileSync(path.join(root, 'nested', 'note.md'), 'utf8')).toBe('body');
    const mkdir = vi.spyOn(fs, 'mkdirSync');
    writeVaultFileAtomic(root, 'nested/note.md', 'next');
    expect(mkdir).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(root, 'nested', 'note.md'), 'utf8')).toBe('next');
  });

  it('A3 reads an in-vault leaf link and refuses the write', () => {
    if (skipSymlink()) return;
    fs.writeFileSync(path.join(root, 'inner.md'), 'ok');
    fs.symlinkSync(path.join(root, 'inner.md'), path.join(root, 'inner-link.md'));
    expect(safeVaultJoin(root, 'inner-link.md')).toBe(path.join(root, 'inner-link.md'));
    expect(fs.readFileSync(path.join(root, 'inner-link.md'), 'utf8')).toBe('ok');
    expect(() => writeVaultFileAtomic(root, 'inner-link.md', 'changed')).toThrow(/symlink leaf|LEAF_LINK/);
    expect(fs.readFileSync(path.join(root, 'inner.md'), 'utf8')).toBe('ok');
  });

  it('A4 refuses links to <root>2 and <root>-evil', () => {
    if (skipSymlink()) return;
    for (const suffix of ['2', '-evil']) {
      const outside = `${root}${suffix}`;
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, 'secret.txt'), 'nope');
      const name = `link${suffix}.md`;
      fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, name));
      expect(() => safeVaultJoin(root, name)).toThrow(/symlink escape detected/);
      expect(() => safeVaultJoin(root, name, { writeMode: true })).toThrow(/symlink/);
      expect(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8')).toBe('nope');
    }
  });

  it('A5 read-mode lexical check denies a missing sibling prefix', () => {
    const rel = `../${path.basename(root)}-evil/a/b.md`;
    expect(() => safeVaultJoin(root, rel)).toThrow(`Path traversal denied: ${rel}`);
    expect(() => safeVaultJoin(root, rel, { writeMode: true })).toThrow(/Path traversal denied/);
  });

  it('A6 reports symlink loops', () => {
    if (skipSymlink()) return;
    fs.symlinkSync('loop', path.join(root, 'loop'));
    expect(() => safeVaultJoin(root, 'loop')).toThrow(/symlink loop/);
    fs.symlinkSync('d', path.join(root, 'd'));
    expect(() => safeVaultJoin(root, 'd/x.md', { writeMode: true })).toThrow(/symlink loop/);
  });

  it('refuses a write through a dangling parent symlink that points outside', () => {
    if (skipSymlink()) return;
    const outside = path.join(tmp, 'dangling-outside');
    fs.symlinkSync(outside, path.join(root, 'd'));
    expect(() => safeVaultJoin(root, 'd/x.md', { writeMode: true })).toThrow(/Path traversal denied/);
    expect(fs.existsSync(outside)).toBe(false);
  });

  it('refuses a write through a file-symlink-loop parent', () => {
    if (skipSymlink()) return;
    const link = path.join(root, 'd');
    try {
      fs.symlinkSync('d', link, 'file');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP' || code === 'EINVAL') return;
      throw err;
    }
    expect(() => safeVaultJoin(root, 'd/x.md', { writeMode: true })).toThrow(/symlink loop|Path traversal denied/);
  });

  it('read-mode refuses a looping folder in front of a missing leaf', () => {
    if (skipSymlink()) return;
    fs.symlinkSync('d', path.join(root, 'd'));
    expect(() => safeVaultJoin(root, 'd/x.md')).toThrow(/symlink loop/);
  });

  it('read-mode refuses a looping ancestor when the leaf lstat is a miss', () => {
    if (skipSymlink()) return;
    fs.symlinkSync('a', path.join(root, 'a'));
    const orig = fs.lstatSync.bind(fs);
    const miss = new Set([path.resolve(root, 'a/b/x.md'), path.resolve(root, 'a/b')].map(pathKey));
    vi.spyOn(fs, 'lstatSync').mockImplementation(((p: fs.PathLike) => {
      if (miss.has(pathKey(p))) {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return orig(p);
    }) as typeof fs.lstatSync);
    expect(() => safeVaultJoin(root, 'a/b/x.md')).toThrow(/symlink loop/);
  });

  it('read-mode refuses a leaf ELOOP when the parent directory is real', () => {
    fs.mkdirSync(path.join(root, 'd'));
    const orig = fs.lstatSync.bind(fs);
    const leaf = pathKey(path.resolve(root, 'd/x.md'));
    vi.spyOn(fs, 'lstatSync').mockImplementation(((p: fs.PathLike) => {
      if (pathKey(p) === leaf) {
        const err = new Error('ELOOP') as NodeJS.ErrnoException;
        err.code = 'ELOOP';
        throw err;
      }
      return orig(p);
    }) as typeof fs.lstatSync);
    expect(() => safeVaultJoin(root, 'd/x.md')).toThrow(/symlink loop/);
  });

  it('A7 allows a symlinked vault root and an in-vault parent link', () => {
    if (skipSymlink()) return;
    const real = path.join(tmp, 'real');
    fs.mkdirSync(real);
    const linkRoot = path.join(tmp, 'linkroot');
    fs.symlinkSync(real, linkRoot);
    writeVaultFileAtomic(linkRoot, 'note.md', 'hello');
    expect(fs.readFileSync(path.join(real, 'note.md'), 'utf8')).toBe('hello');
    expect(safeVaultJoin(linkRoot, 'note.md')).toBe(path.join(linkRoot, 'note.md'));

    fs.mkdirSync(path.join(root, 'realdir'));
    fs.symlinkSync(path.join(root, 'realdir'), path.join(root, 'alias'));
    writeVaultFileAtomic(root, 'alias/note.md', 'inside');
    expect(fs.readFileSync(path.join(root, 'realdir', 'note.md'), 'utf8')).toBe('inside');
  });

  it('A16 refuses a folder linked outside the vault', () => {
    if (skipSymlink()) return;
    const outside = path.join(tmp, 'outside-dir');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(root, 'out'));
    expect(() => writeVaultFileAtomic(root, 'out/note.md', 'x')).toThrow(/symlink|Path traversal denied/);
    expect(() => safeVaultJoin(root, 'out/note.md')).toThrow(/symlink|Path traversal denied/);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('A8 refuses a swapped handle and a target replaced before rename', () => {
    if (skipSymlink()) return;
    const outside = path.join(tmp, 'outside.txt');
    fs.writeFileSync(outside, 'KEEP');
    const leaf = path.join(root, 'leaf.md');
    fs.symlinkSync(outside, leaf);
    expect(() => writeNoFollowAtomic(leaf, 'x', { rel: 'leaf.md' })).toThrow(VaultWriteRefusedError);
    expect(fs.readFileSync(outside, 'utf8')).toBe('KEEP');

    const target = path.join(root, 'swapped.md');
    const sentinel = path.join(root, 'sentinel.txt');
    setNoFollowHooksForTests({
      afterOpen(opened) {
        fs.writeFileSync(sentinel, 'SENTINEL');
        fs.unlinkSync(opened);
        fs.linkSync(sentinel, opened);
      },
      beforeRename() {},
    });
    expect(() => writeNoFollowAtomic(target, 'payload', { durable: false, rel: 'swapped.md' })).toThrow(VaultWriteRefusedError);
    expect(fs.readFileSync(sentinel, 'utf8')).toBe('SENTINEL');
    expect(fs.existsSync(target)).toBe(false);
    resetNoFollowHooksForTests();

    const swapTarget = path.join(root, 'rename-swap.md');
    setNoFollowHooksForTests({
      afterOpen() {},
      beforeRename(absPath) {
        fs.symlinkSync(outside, absPath);
      },
    });
    expect(() => writeNoFollowAtomic(swapTarget, 'payload', { durable: false, rel: 'rename-swap.md' })).toThrow(VaultWriteRefusedError);
    expect(fs.readFileSync(outside, 'utf8')).toBe('KEEP');
    expect(fs.readdirSync(root).filter((name) => name.includes('.tmp'))).toEqual([]);
    expect(fs.lstatSync(swapTarget).isSymbolicLink()).toBe(true);
  });

  it('A17 append refuses a symlink with ELOOP and leaves the target', () => {
    if (skipSymlink()) return;
    const outside = path.join(tmp, 'append-out.txt');
    fs.writeFileSync(outside, 'KEEP');
    const link = path.join(root, 'append.md');
    fs.symlinkSync(outside, link);
    try {
      appendNoFollow(link, 'more', { rel: 'append.md' });
      throw new Error('append should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(VaultWriteRefusedError);
      const refused = err as VaultWriteRefusedError;
      if (process.platform === 'win32') {
        // O_NOFOLLOW is 0 on win32. The post-open lstat still refuses the leaf.
        expect(refused.code).toBe('LEAF_LINK');
      } else {
        expect(refused.syscallCode).toBe('ELOOP');
      }
    }
    expect(fs.readFileSync(outside, 'utf8')).toBe('KEEP');
  });

  it('A21 append refuses a hard link', () => {
    const a = path.join(root, 'a.txt');
    const b = path.join(root, 'b.txt');
    fs.writeFileSync(a, 'KEEP');
    fs.linkSync(a, b);
    expect(() => appendNoFollow(b, 'more', { rel: 'b.txt' })).toThrow(VaultWriteRefusedError);
    try {
      appendNoFollow(b, 'more', { rel: 'b.txt' });
    } catch (err) {
      expect((err as VaultWriteRefusedError).code).toBe('HARD_LINK');
    }
    expect(fs.readFileSync(a, 'utf8')).toBe('KEEP');
  });

  it('A22 caps copy size and kills a volume probe that ignores its timeout', () => {
    expect(NOFOLLOW_COPY_MAX_BYTES).toBe(MAX_IMPORT_FILE_BYTES);
    expect(NOFOLLOW_COPY_MAX_BYTES).toBe(MAX_VAULT_FILE_BYTES);
    const src = path.join(root, 'sparse');
    const fd = fs.openSync(src, 'w');
    fs.ftruncateSync(fd, NOFOLLOW_COPY_MAX_BYTES + 1);
    fs.closeSync(fd);
    const dst = path.join(root, 'copied');
    expect(() => copyNoFollowAtomic(src, dst, { durable: false })).toThrow(VaultFileTooLargeError);
    expect(fs.existsSync(dst)).toBe(false);

    const started = Date.now();
    const kind = probeVolumeKind('C:\\vault', {
      platform: 'win32',
      execFileSync: (_file, _args, options) => {
        execFileSync('sleep', ['30'], { timeout: options.timeout, killSignal: options.killSignal });
        return '';
      },
    });
    expect(kind).toBe('unknown');
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('A15 saves on fat and network zero-index and refuses local, unknown, and a swapped network file', () => {
    const fat = path.join(root, 'fat.md');
    writeNoFollowAtomic(fat, 'fat', { durable: false, deps: withProbe('fat'), rel: 'fat.md' });
    expect(fs.readFileSync(fat, 'utf8')).toBe('fat');

    const network = path.join(root, 'net.md');
    writeNoFollowAtomic(network, 'net', { durable: false, deps: withProbe('network'), rel: 'net.md' });
    expect(fs.readFileSync(network, 'utf8')).toBe('net');

    const outside = path.join(tmp, 'net-outside.txt');
    fs.writeFileSync(outside, 'KEEP');
    const swapped = path.join(root, 'net-swap.md');
    setNoFollowHooksForTests({
      afterOpen(opened) {
        fs.unlinkSync(opened);
        fs.symlinkSync(outside, opened);
      },
      beforeRename() {},
    });
    expect(() => writeNoFollowAtomic(swapped, 'payload-bytes', { durable: false, deps: withProbe('network'), rel: 'net-swap.md' })).toThrow(VaultWriteRefusedError);
    expect(fs.readFileSync(outside, 'utf8')).toBe('KEEP');
    resetNoFollowHooksForTests();

    const sized = path.join(root, 'net-size.md');
    setNoFollowHooksForTests({
      afterOpen() {},
      beforeRename(absPath) {
        const dir = path.dirname(absPath);
        const tmpName = fs.readdirSync(dir).find((name) => name.startsWith(`${path.basename(absPath)}.`) && name.endsWith('.tmp'));
        expect(tmpName).toBeTruthy();
        const full = path.join(dir, tmpName as string);
        fs.unlinkSync(full);
        fs.writeFileSync(full, 'x');
      },
    });
    expect(() => writeNoFollowAtomic(sized, 'payload-bytes', { durable: false, deps: withProbe('network'), rel: 'net-size.md' })).toThrow(VaultWriteRefusedError);
    expect(fs.existsSync(sized)).toBe(false);
    resetNoFollowHooksForTests();

    const linked = path.join(root, 'net-link.md');
    setNoFollowHooksForTests({
      afterOpen() {},
      beforeRename(absPath) {
        const dir = path.dirname(absPath);
        const tmpName = fs.readdirSync(dir).find((name) => name.startsWith(`${path.basename(absPath)}.`) && name.endsWith('.tmp'));
        const full = path.join(dir, tmpName as string);
        fs.unlinkSync(full);
        fs.symlinkSync(outside, full);
      },
    });
    expect(() => writeNoFollowAtomic(linked, 'payload-bytes', { durable: false, deps: withProbe('network'), rel: 'net-link.md' })).toThrow(VaultWriteRefusedError);
    expect(fs.readFileSync(outside, 'utf8')).toBe('KEEP');

    for (const kind of ['unknown', 'local'] as const) {
      const dest = path.join(root, `${kind}.md`);
      expect(() => writeNoFollowAtomic(dest, 'nope', { durable: false, deps: withProbe(kind), rel: `${kind}.md` })).toThrow(volumeUnsupportedText(`${kind}.md`));
      expect(fs.existsSync(dest)).toBe(false);
    }
  });

  it('rechecks a same-size temp swap made in beforeRename', () => {
    const payload = 'payload-bytes';
    const target = path.join(root, 'late-swap.md');
    const decoy = path.join(root, 'late-decoy.md');
    fs.writeFileSync(decoy, payload);
    setNoFollowHooksForTests({
      afterOpen() {},
      beforeRename(absPath) {
        const dir = path.dirname(absPath);
        const tmpName = fs.readdirSync(dir).find((name) => name.startsWith(`${path.basename(absPath)}.`) && name.endsWith('.tmp'));
        expect(tmpName).toBeTruthy();
        const full = path.join(dir, tmpName as string);
        fs.unlinkSync(full);
        fs.linkSync(decoy, full);
      },
    });
    try {
      expect(() => writeNoFollowAtomic(target, payload, { durable: false, rel: 'late-swap.md' })).toThrow(VaultWriteRefusedError);
      try {
        writeNoFollowAtomic(target, payload, { durable: false, rel: 'late-swap.md' });
      } catch (err) {
        expect((err as VaultWriteRefusedError).code).toBe('HANDLE_MISMATCH');
      }
      expect(fs.existsSync(target)).toBe(false);
      expect(fs.readFileSync(decoy, 'utf8')).toBe(payload);
    } finally {
      resetNoFollowHooksForTests();
    }
  });

  it('append does not create through a dangling link when O_NOFOLLOW is absent', () => {
    if (skipSymlink()) return;
    const outside = path.join(tmp, 'append-dangling-out.txt');
    const link = path.join(root, 'dangling-append.md');
    fs.symlinkSync(outside, link);
    const win = { ...defaultDeps, platform: 'win32' as const };
    expect(() => appendNoFollow(link, 'more', { rel: 'dangling-append.md', deps: win })).toThrow(VaultWriteRefusedError);
    expect(fs.existsSync(outside)).toBe(false);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);

    const created = path.join(root, 'append-new.md');
    appendNoFollow(created, 'hello', { rel: 'append-new.md' });
    expect(fs.readFileSync(created, 'utf8')).toBe('hello');
    appendNoFollow(created, '!', { rel: 'append-new.md' });
    expect(fs.readFileSync(created, 'utf8')).toBe('hello!');
  });

  it('append refuses a zero-index volume the atomic writer rejects', () => {
    const dest = path.join(root, 'append-zero.md');
    fs.writeFileSync(dest, 'KEEP');
    expect(() => appendNoFollow(dest, 'X', { rel: 'append-zero.md', deps: withProbe('local') })).toThrow(VaultWriteRefusedError);
    try {
      appendNoFollow(dest, 'X', { rel: 'append-zero.md', deps: withProbe('local') });
    } catch (err) {
      expect((err as VaultWriteRefusedError).code).toBe('VOLUME_UNSUPPORTED');
    }
    expect(fs.readFileSync(dest, 'utf8')).toBe('KEEP');

    const fat = path.join(root, 'append-fat.md');
    fs.writeFileSync(fat, 'KEEP');
    appendNoFollow(fat, 'Y', { rel: 'append-fat.md', deps: withProbe('fat') });
    expect(fs.readFileSync(fat, 'utf8')).toBe('KEEPY');
  });

  function shortWriteFs(): typeof fs {
    const real = fs.writeSync.bind(fs);
    return new Proxy(fs, {
      get(target, prop, receiver) {
        if (prop === 'writeSync') {
          return (fd: number, buf: Buffer, offset?: number, length?: number, position?: number) => {
            const start = offset ?? 0;
            const len = length ?? buf.length - start;
            const n = Math.min(3, len);
            if (position === undefined || position === null) return real(fd, buf, start, n);
            return real(fd, buf, start, n, position);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
  }

  it('writes every byte when writeSync returns a short count', () => {
    const dest = path.join(root, 'short-write.md');
    const payload = 'abcdefghij';
    writeNoFollowAtomic(dest, payload, {
      durable: false,
      rel: 'short-write.md',
      deps: { ...defaultDeps, fs: shortWriteFs() },
    });
    expect(fs.readFileSync(dest, 'utf8')).toBe(payload);
    console.log('short-write complete', payload.length);
  });

  it('appends every byte when writeSync returns a short count', () => {
    const dest = path.join(root, 'append-short.md');
    fs.writeFileSync(dest, 'HEAD');
    const payload = 'abcdefghij';
    const fsync = vi.spyOn(fs, 'fsyncSync');
    appendNoFollow(dest, payload, {
      rel: 'append-short.md',
      deps: { ...defaultDeps, fs: shortWriteFs() },
    });
    expect(fs.readFileSync(dest, 'utf8')).toBe(`HEAD${payload}`);
    expect(fsync).toHaveBeenCalled();
    fsync.mockRestore();
    console.log('append-short complete', payload.length);
  });

  function raceReadFs(file: string, swap: () => void): { fsImpl: typeof fs; flags: () => number } {
    let phase: 'init' | 'realpath-done' | 'checked' = 'init';
    let seen = 0;
    const fsImpl = new Proxy(fs, {
      get(target, prop, receiver) {
        if (prop === 'realpathSync') {
          const native = (p: fs.PathLike) => {
            const resolved = fs.realpathSync.native(p);
            if (String(p) === file) phase = 'realpath-done';
            return resolved;
          };
          return Object.assign((p: fs.PathLike) => fs.realpathSync(p), { native });
        }
        if (prop === 'lstatSync') {
          return (p: fs.PathLike) => {
            const st = fs.lstatSync(p);
            if (String(p) === file && phase === 'realpath-done') phase = 'checked';
            return st;
          };
        }
        if (prop === 'readFileSync') {
          return (...args: Parameters<typeof fs.readFileSync>) => {
            if (String(args[0]) === file && phase === 'realpath-done') swap();
            return fs.readFileSync(...args);
          };
        }
        if (prop === 'openSync') {
          return (p: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
            if (String(p) === file && typeof flags === 'number') seen = flags;
            if (String(p) === file && phase === 'checked') swap();
            return mode === undefined ? fs.openSync(p, flags) : fs.openSync(p, flags, mode);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    }) as typeof fs;
    return { fsImpl, flags: () => seen };
  }

  // win32 open does not implement the POSIX no-follow flag, so this swap cannot be proved there.
  it.skipIf(process.platform === 'win32')(
    'refuses a settings file swapped for a symlink between the check and the read (skipped on win32: POSIX open does not follow a file link)',
    () => {
      const userData = path.join(tmp, 'swap-userdata');
      fs.mkdirSync(userData);
      const file = path.join(userData, 'settings.json');
      const outside = path.join(tmp, 'swap-outside.json');
      fs.writeFileSync(file, 'INSIDE');
      fs.writeFileSync(outside, 'OUTSIDE-BYTES');
      const raced = raceReadFs(file, () => {
        fs.rmSync(file);
        fs.symlinkSync(outside, file);
      });
      const result = readUserDataFile(file, userData, raced.fsImpl);
      expect(result).toEqual({ status: 'denied' });
      expect(raced.flags() & fs.constants.O_NOFOLLOW).toBe(fs.constants.O_NOFOLLOW);
      expect(fs.readFileSync(outside, 'utf8')).toBe('OUTSIDE-BYTES');
      console.log('userdata swap denied');
    },
  );

  const NOFOLLOW_PLATFORM = Symbol.for('mythos.noFollowPlatform');

  function emptyManifestJson(): string {
    return JSON.stringify({ schemaVersion: 1, stories: [], scenes: [], entities: [] });
  }

  /** Ask the shared guard to use the win32 path, and open the way win32 does when the flag is zero. */
  function forceWin32NoFollow(): () => void {
    const marked = fs as unknown as Record<symbol, NodeJS.Platform>;
    marked[NOFOLLOW_PLATFORM] = 'win32';
    const realOpen = fs.openSync.bind(fs);
    const spy = vi.spyOn(fs, 'openSync').mockImplementation((p, flags, mode) => {
      const next = typeof flags === 'number' ? flags & ~fs.constants.O_NOFOLLOW : flags;
      return mode == null ? realOpen(p, next) : realOpen(p, next, mode);
    });
    return () => {
      spy.mockRestore();
      delete marked[NOFOLLOW_PLATFORM];
    };
  }

  function proxyStat(st: fs.Stats, patch: { symlink?: boolean; file?: boolean; attrs?: number }): fs.Stats {
    return new Proxy(st, {
      get(target, prop, receiver) {
        if (prop === 'isSymbolicLink' && patch.symlink !== undefined) return () => patch.symlink;
        if (prop === 'isFile' && patch.file !== undefined) return () => patch.file;
        if (prop === 'fileAttributes') return patch.attrs;
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
  }

  it('refuses a file symlink when the no-follow flag is zero (runs on win32)', () => {
    const release = forceWin32NoFollow();
    try {
      const vault = path.join(tmp, 'sym-vault');
      fs.mkdirSync(vault);
      const manifest = path.join(vault, 'manifest.json');
      fs.writeFileSync(manifest, emptyManifestJson());
      const orig = fs.lstatSync.bind(fs);
      const lstat = vi.spyOn(fs, 'lstatSync').mockImplementation(((p: fs.PathLike, opts?: { bigint?: boolean }) => {
        const st = opts === undefined ? orig(p) : orig(p, opts as { bigint: true });
        if (pathKey(p) === pathKey(manifest)) return proxyStat(st as fs.Stats, { symlink: true, file: true });
        return st;
      }) as typeof fs.lstatSync);
      try {
        expect(assertAiWritable(vault, 'entities/characters/a.md')).toEqual({ ok: false, reason: 'no_manifest' });
      } finally {
        lstat.mockRestore();
      }
      if (!skipSymlink()) {
        const vault2 = path.join(tmp, 'sym-real');
        const outside = path.join(tmp, 'sym-outside.json');
        fs.mkdirSync(vault2);
        fs.writeFileSync(outside, emptyManifestJson());
        fs.symlinkSync(outside, path.join(vault2, 'manifest.json'));
        expect(assertAiWritable(vault2, 'entities/characters/a.md')).toEqual({ ok: false, reason: 'no_manifest' });
        expect(fs.readFileSync(outside, 'utf8')).toContain('"schemaVersion":1');
      }
      console.log('win32 symlink refused');
    } finally {
      release();
    }
  });

  it('refuses a junction or reparse point when the no-follow flag is zero (runs on win32)', () => {
    const release = forceWin32NoFollow();
    try {
      const vault = path.join(tmp, 'reparse-vault');
      fs.mkdirSync(vault);
      const manifest = path.join(vault, 'manifest.json');
      fs.writeFileSync(manifest, emptyManifestJson());
      const orig = fs.lstatSync.bind(fs);
      const lstat = vi.spyOn(fs, 'lstatSync').mockImplementation(((p: fs.PathLike, opts?: { bigint?: boolean }) => {
        const st = opts === undefined ? orig(p) : orig(p, opts as { bigint: true });
        if (pathKey(p) === pathKey(manifest)) return proxyStat(st as fs.Stats, { symlink: false, file: true, attrs: 0x400 });
        return st;
      }) as typeof fs.lstatSync);
      try {
        expect(assertAiWritable(vault, 'entities/characters/a.md')).toEqual({ ok: false, reason: 'no_manifest' });
      } finally {
        lstat.mockRestore();
      }
      if (process.platform === 'win32') {
        const vault2 = path.join(tmp, 'junc-vault');
        const target = path.join(tmp, 'junc-target');
        fs.mkdirSync(vault2);
        fs.mkdirSync(target);
        fs.symlinkSync(target, path.join(vault2, 'manifest.json'), 'junction');
        expect(assertAiWritable(vault2, 'entities/characters/a.md')).toEqual({ ok: false, reason: 'no_manifest' });
      }
      console.log('win32 junction refused');
    } finally {
      release();
    }
  });

  it('refuses a file swapped after lstat when the no-follow flag is zero (runs on win32)', () => {
    const release = forceWin32NoFollow();
    try {
      const vault = path.join(tmp, 'swap-after-lstat');
      fs.mkdirSync(vault);
      const manifest = path.join(vault, 'manifest.json');
      const replacement = path.join(vault, 'replacement.json');
      fs.writeFileSync(manifest, emptyManifestJson());
      fs.writeFileSync(replacement, JSON.stringify({ schemaVersion: 1, stories: [], scenes: [], entities: [], swapped: true }));
      let swapped = false;
      const orig = fs.lstatSync.bind(fs);
      vi.spyOn(fs, 'lstatSync').mockImplementation(((p: fs.PathLike, opts?: { bigint?: boolean }) => {
        const st = opts === undefined ? orig(p) : orig(p, opts as { bigint: true });
        if (!swapped && pathKey(p) === pathKey(manifest)) {
          swapped = true;
          fs.renameSync(replacement, manifest);
        }
        return st;
      }) as typeof fs.lstatSync);
      expect(assertAiWritable(vault, 'entities/characters/a.md')).toEqual({ ok: false, reason: 'no_manifest' });
      expect(swapped).toBe(true);
      console.log('win32 swap denied');
    } finally {
      release();
    }
  });

  // A replaced regular file keeps the path and is a file, so only dev/ino can see it.
  it.skipIf(process.platform === 'win32')(
    'refuses a settings file replaced with a different file between the check and the read (skipped on win32: dev/ino is not a stable file identity)',
    () => {
      const userData = path.join(tmp, 'inode-userdata');
      fs.mkdirSync(userData);
      const file = path.join(userData, 'settings.json');
      const replacement = path.join(userData, 'replacement.json');
      fs.writeFileSync(file, 'INSIDE');
      fs.writeFileSync(replacement, 'SWAPPED-BYTES');
      const raced = raceReadFs(file, () => {
        fs.renameSync(replacement, file);
      });
      const result = readUserDataFile(file, userData, raced.fsImpl);
      expect(result).toEqual({ status: 'denied' });
      console.log('userdata inode denied');
    },
  );

  // win32 has no POSIX mkfifo, so this hang cannot be set up there.
  it.skipIf(process.platform === 'win32')(
    'refuses a FIFO leaf without hanging (skipped on win32: no POSIX mkfifo)',
    () => {
      const fifo = path.join(root, 'pipe.md');
      execFileSync('mkfifo', [fifo]);
      const entry = path.join(tmp, 'fifo-entry.mjs');
      const outfile = path.join(tmp, 'fifo-child.cjs');
      const joinSrc = path.join(path.dirname(fileURLToPath(new URL('./safeVaultJoin.ts', import.meta.url))));
      fs.writeFileSync(
        entry,
        `import { safeVaultJoin } from ${JSON.stringify(path.join(joinSrc, 'safeVaultJoin.ts'))};\n` +
          `try {\n` +
          `  safeVaultJoin(process.argv[2], 'pipe.md', { writeMode: true });\n` +
          `  console.log('RESULT allowed');\n` +
          `} catch (err) {\n` +
          `  console.log('RESULT ' + (err && err.message ? err.message : err));\n` +
          `}\n`,
      );
      const esbuild = createRequire(import.meta.url)('esbuild') as {
        buildSync: (opts: { entryPoints: string[]; bundle: boolean; platform: string; format: string; outfile: string; logLevel: string }) => void;
      };
      esbuild.buildSync({
        entryPoints: [entry],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile,
        logLevel: 'silent',
      });
      const started = Date.now();
      const result = spawnSync(process.execPath, [outfile, root], {
        encoding: 'utf8',
        timeout: 3000,
        killSignal: 'SIGKILL',
      });
      const elapsed = Date.now() - started;
      expect(elapsed).toBeLessThan(2500);
      expect(result.status).toBe(0);
      expect(result.stdout ?? '').toMatch(/not a regular file/);
      expect(fs.lstatSync(fifo).isFIFO()).toBe(true);
      console.log('fifo refused', elapsed);
    },
  );

  it('keeps a manifest backup that is over the vault size cap', () => {
    const manifestPath = path.join(root, 'manifest.json');
    const raw = '{ not json ' + 'x'.repeat(MAX_VAULT_FILE_BYTES);
    fs.writeFileSync(manifestPath, raw);
    let caught: unknown;
    try {
      openManifest(manifestPath, { vaultRoot: root });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ManifestMigrationError);
    const backupDir = path.join(root, '.mythos', 'backups');
    const backups = fs.readdirSync(backupDir).filter((name) => name.startsWith('manifest-'));
    expect(backups).toHaveLength(1);
    expect(fs.statSync(path.join(backupDir, backups[0]!)).size).toBeGreaterThan(MAX_VAULT_FILE_BYTES);
    const readerSrc = fs.readFileSync(new URL('./manifest/reader.ts', import.meta.url), 'utf8');
    expect(readerSrc).toContain('writeManifestBackup');
    console.log('manifest-backup over cap');
  });

  it('copy loops a short read and refuses a premature end', () => {
    const src = path.join(root, 'short-src.txt');
    const dst = path.join(root, 'short-dst.txt');
    fs.writeFileSync(src, 'abcdef');
    copyNoFollowAtomic(src, dst, { durable: false, deps: { ...defaultDeps, fs: readSyncFs('short') } });
    expect(fs.readFileSync(dst, 'utf8')).toBe('abcdef');

    const eofSrc = path.join(root, 'eof-src.txt');
    const eofDst = path.join(root, 'eof-dst.txt');
    fs.writeFileSync(eofSrc, 'abcdef');
    expect(() => copyNoFollowAtomic(eofSrc, eofDst, { durable: false, deps: { ...defaultDeps, fs: readSyncFs('eof') } })).toThrow(/premature EOF/);
    expect(fs.existsSync(eofDst)).toBe(false);
  });

  it('A15c refuses a same-size temp swap that only the identity re-check can see', () => {
    const payload = 'hello';
    const sameSize = path.join(root, 'same-size.md');
    const decoy = path.join(root, 'decoy-same.md');
    fs.writeFileSync(decoy, payload);
    let openedPath = '';
    let kept = '';
    setNoFollowHooksForTests({
      afterOpen(opened) {
        openedPath = opened;
        kept = `${opened}.keep`;
        fs.linkSync(opened, kept);
        fs.writeFileSync(opened, payload);
        fs.unlinkSync(opened);
        fs.linkSync(decoy, opened);
      },
      beforeRename() {
        // Put the opened inode back so a later recheck cannot see this swap.
        fs.unlinkSync(openedPath);
        fs.linkSync(kept, openedPath);
      },
    });
    try {
      expect(() => writeNoFollowAtomic(sameSize, payload, { durable: false, rel: 'same-size.md' })).toThrow(VaultWriteRefusedError);
      try {
        writeNoFollowAtomic(sameSize, payload, { durable: false, rel: 'same-size.md' });
      } catch (err) {
        expect((err as VaultWriteRefusedError).code).toBe('HANDLE_MISMATCH');
      }
      expect(fs.existsSync(sameSize)).toBe(false);
      expect(fs.readFileSync(decoy, 'utf8')).toBe(payload);
    } finally {
      resetNoFollowHooksForTests();
    }
  });

  it('A15f caches a volume probe by device', () => {
    resetVolumeProbeCache();
    let calls = 0;
    const injected = {
      statSync: (p: fs.PathLike) => ({ dev: String(p).includes('vol-b') ? 2n : 1n }) as fs.BigIntStats,
      statfsSync: (p: fs.PathLike) => {
        calls += 1;
        return { type: String(p).includes('vol-b') ? 0xef53 : 0x4d44 } as fs.StatsFs;
      },
    } as Pick<typeof fs, 'statSync' | 'statfsSync'>;
    const posix = { platform: 'linux' as const, fs: injected };
    expect(probeVolumeKind('/vol-a', posix)).toBe('fat');
    expect(probeVolumeKind('/vol-a', posix)).toBe('fat');
    expect(probeVolumeKind('/vol-b', posix)).toBe('local');
    expect(probeVolumeKind('/vol-b', posix)).toBe('local');
    expect(calls).toBe(2);
  });

  it('A10 refuses a pre-placed manifest.json.tmp symlink and allows a regular leftover', () => {
    if (skipSymlink()) return;
    const manifest = path.join(root, 'manifest.json');
    const outside = path.join(tmp, 'tmp-outside');
    fs.writeFileSync(outside, 'KEEP');
    fs.symlinkSync(outside, `${manifest}.tmp`);
    expect(() => writeManifestBytes(manifest, '{"ok":true}\n', root)).toThrow(VaultWriteRefusedError);
    expect(fs.readFileSync(outside, 'utf8')).toBe('KEEP');
    expect(fs.existsSync(manifest)).toBe(false);

    fs.unlinkSync(`${manifest}.tmp`);
    fs.writeFileSync(`${manifest}.tmp`, 'leftover');
    writeManifestBytes(manifest, '{"ok":true}\n', root);
    expect(fs.readFileSync(manifest, 'utf8')).toContain('"ok":true');
  });

  it('A18 export follows a symlinked parent, refuses a symlinked leaf, and requires an absolute path', () => {
    if (skipSymlink()) return;
    const realDir = path.join(tmp, 'export-real');
    fs.mkdirSync(realDir);
    const parentLink = path.join(tmp, 'export-link');
    fs.symlinkSync(realDir, parentLink);
    writeExportFileAtomic(path.join(parentLink, 'book.epub'), 'EPUB');
    expect(fs.readFileSync(path.join(realDir, 'book.epub'), 'utf8')).toBe('EPUB');

    const outside = path.join(tmp, 'export-outside.epub');
    fs.writeFileSync(outside, 'KEEP');
    const leaf = path.join(realDir, 'leaf.epub');
    fs.symlinkSync(outside, leaf);
    expect(() => writeExportFileAtomic(leaf, 'nope')).toThrow(VaultWriteRefusedError);
    expect(isNoFollowExportFailure(new VaultWriteRefusedError('LEAF_LINK', 'leaf.epub'))).toBe(true);
    expect(exportFailureText(leaf)).toBe("Couldn't export to leaf.epub.");
    expect(fs.readFileSync(outside, 'utf8')).toBe('KEEP');
    expect(() => writeExportFileAtomic('relative.epub', 'x')).toThrow(/requires an absolute path/);
  });

  it('A9 writes through the guard and refuses escape paths', () => {
    writeSceneFile(root, 'Scene.md', { id: 's', title: 'Scene', prose: 'prose' });
    expect(fs.readFileSync(path.join(root, 'Scene.md'), 'utf8')).toContain('prose');
    writeVaultFileUnsafe_testOnly(root, 'unsafe.md', 'u');
    expect(fs.readFileSync(path.join(root, 'unsafe.md'), 'utf8')).toBe('u');
    writeOrderMap(root, { '.': ['Scene.md'] });
    expect(fs.existsSync(path.join(root, '.vb-order.json'))).toBe(true);
    writeIconMap(root, {});
    expect(fs.existsSync(path.join(root, '.mythos', 'icons.json'))).toBe(true);

    const outsideDir = path.join(tmp, 'board-out');
    fs.mkdirSync(outsideDir);
    expect(() => writeVaultFileAtomic(root, '../x.md', 'nope')).toThrow(/Path traversal denied/);
    expect(() => writeVaultFileAtomic(root, path.join(tmp, 'abs.md'), 'nope')).toThrow(/Path traversal denied/);
    expect(fs.existsSync(path.join(tmp, 'x.md'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'abs.md'))).toBe(false);

    if (symlinksWork) {
      fs.symlinkSync(outsideDir, path.join(root, 'linked'));
      expect(() => writeVaultFileAtomic(root, 'linked/note.md', 'nope')).toThrow(/symlink/);
      expect(() => createBoardItem(root, 'linked', 'note')).toThrow();
      expect(fs.readdirSync(outsideDir)).toEqual([]);
      fs.symlinkSync(outsideDir, path.join(root, SESSIONS_DIRNAME));
      expect(() => createSession(root, { agent: 'coach', id: 's1' })).toThrow(/symlink/);
      expect(fs.readdirSync(outsideDir)).toEqual([]);
    }
    expect(() => createBoardItem(root, '..', 'note')).toThrow(/Path traversal denied/);
  });

  it('A9c always joins in write mode', () => {
    const spy = vi.spyOn(joinMod, 'safeVaultJoin');
    writeVaultFileAtomic(root, 'joined.md', 'ok');
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls.some((call) => call[2]?.writeMode === true)).toBe(true);
    if (!symlinksWork) return;
    fs.writeFileSync(path.join(root, 'inner.md'), 'ok');
    fs.symlinkSync(path.join(root, 'inner.md'), path.join(root, 'inner-link.md'));
    expect(() => writeVaultFileNoFollow(root, 'inner-link.md', 'x')).toThrow(/symlink leaf/);
  });

  it('A13 maps the approved sentence and leaves generic traversal to the sanitizer', () => {
    const mapped = mapVaultWriteError(new VaultWriteRefusedError('LEAF_LINK', 'Notes/A.md'), 'Notes/A.md');
    expect(mapped).toEqual({ error: SYMLINK_SAVE_TEXT('Notes/A.md'), code: 'LEAF_LINK' });
    expect(mapVaultWriteError(new Error('Path traversal denied: foo'), 'foo')).toBeNull();
    const volume = mapVaultWriteError(new VaultWriteRefusedError('VOLUME_UNSUPPORTED', 'Notes/A.md'), 'Notes/A.md');
    expect(volume?.error).toBe(volumeUnsupportedText('Notes/A.md'));
    expect(mapVaultWriteError(new Error('Path traversal denied: Notes/A.md (symlink loop)'), 'Notes/A.md')).toBeNull();
    expect(isSymlinkWriteRefusal(new VaultWriteRefusedError('VOLUME_UNSUPPORTED', 'a.md'))).toBe(false);
    expect(isSymlinkWriteRefusal(new VaultWriteRefusedError('HARD_LINK', 'a.md'))).toBe(false);
    expect(isSymlinkWriteRefusal(new Error('Path traversal denied: ../x.md'))).toBe(false);
    const skipped: string[] = [];
    expect(() => writeVaultOrSkip(root, '%2e%2e/x.md', 'x', skipped)).toThrow(/encoded traversal/);
    expect(skipped).toEqual([]);
  });

  it('logs a refusal with a relative name', () => {
    if (skipSymlink()) return;
    const logs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      logs.push(String(message));
    });
    fs.writeFileSync(path.join(root, 'inner.md'), 'ok');
    fs.symlinkSync(path.join(root, 'inner.md'), path.join(root, 'inner-link.md'));
    expect(() => writeVaultFileAtomic(root, 'inner-link.md', 'x')).toThrow();
    const line = logs.find((entry) => entry.includes('vault-write-refused'));
    expect(line).toBeTruthy();
    expect(line).toContain('LEAF_LINK');
    expect(line).not.toContain(root);
  });

  it('lists symlink leaves only when asked', () => {
    if (skipSymlink()) return;
    fs.writeFileSync(path.join(root, 'real.md'), 'r');
    fs.symlinkSync(path.join(root, 'real.md'), path.join(root, 'link.md'));
    const plain = listVaultFiles(root).items.map((item) => item.path);
    const withLinks = listVaultFiles(root, undefined, { includeSymlinkLeaves: true }).items.map((item) => item.path);
    expect(plain).not.toContain('link.md');
    expect(withLinks).toContain('link.md');
  });

  it('A11 refuses an inside link before any write and an outside link before the move', () => {
    if (skipSymlink()) return;
    fs.writeFileSync(path.join(root, 'Old.md'), '# Old\n');
    fs.writeFileSync(path.join(root, 'a.md'), 'See [[Old]]\n');
    fs.writeFileSync(path.join(root, 'z.md'), 'Also [[Old]]\n');
    fs.writeFileSync(path.join(root, 'in-target.md'), 'Link [[Old]]\n');
    fs.symlinkSync(path.join(root, 'in-target.md'), path.join(root, 'm-link.md'));
    const writeSync = vi.spyOn(fs, 'writeSync');
    expect(() => renameNoteWithCascade({ notesRoot: root, fromPath: 'Old.md', toPath: 'New.md' })).toThrow(/shortcut \(symbolic link\)|symlink/);
    expect(writeSync).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(root, 'Old.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'New.md'))).toBe(false);
    expect(fs.readFileSync(path.join(root, 'a.md'), 'utf8')).toContain('[[Old]]');

    const outside = path.join(tmp, 'outside-note.md');
    fs.writeFileSync(outside, 'See [[Old]]\n');
    fs.symlinkSync(outside, path.join(root, 'out-link.md'));
    expect(() => renameNoteWithCascade({ notesRoot: root, fromPath: 'Old.md', toPath: 'Newer.md' })).toThrow(/Path traversal denied|symlink/);
    expect(fs.existsSync(path.join(root, 'Old.md'))).toBe(true);
    expect(fs.readFileSync(outside, 'utf8')).toBe('See [[Old]]\n');
  });

  it('A12 refuses a dangling destination before the note moves', () => {
    if (skipSymlink()) return;
    fs.writeFileSync(path.join(root, 'Old.md'), '# Old\n');
    const outside = path.join(tmp, 'missing-dest');
    fs.symlinkSync(outside, path.join(root, 'Dest.md'));
    expect(() => renameNoteWithCascade({ notesRoot: root, fromPath: 'Old.md', toPath: 'Dest.md' })).toThrow(/symlink/);
    expect(fs.existsSync(path.join(root, 'Old.md'))).toBe(true);
    expect(fs.lstatSync(path.join(root, 'Dest.md')).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(path.join(root, 'Dest.md'))).toBe(outside);
    expect(fs.existsSync(outside)).toBe(false);
  });

  it('undo lists a symlink instead of following it', () => {
    if (skipSymlink()) return;
    fs.writeFileSync(path.join(root, 'Old.md'), '# Old\n');
    fs.writeFileSync(path.join(root, 'a.md'), 'See [[Old]]\n');
    renameNoteWithCascade({ notesRoot: root, fromPath: 'Old.md', toPath: 'New.md' });
    expect(fs.readFileSync(path.join(root, 'a.md'), 'utf8')).toContain('[[New]]');

    const inside = path.join(root, 'inside-undo.md');
    fs.writeFileSync(inside, fs.readFileSync(path.join(root, 'a.md')));
    fs.rmSync(path.join(root, 'a.md'));
    fs.symlinkSync(inside, path.join(root, 'a.md'));
    const undone = undoLastRenameCascade({ notesRoot: root });
    expect(undone.skippedSymlinks).toContain(symlinkSkipLine('a.md'));
    expect(fs.readFileSync(inside, 'utf8')).toContain('[[New]]');
    expect(fs.existsSync(path.join(root, 'Old.md'))).toBe(true);
  });

  it('A23 keeps an EPUB target inside the vault', () => {
    if (skipSymlink()) return;
    const written = commitEpubTargetExport(root, 'exports/book.epub', 'EPUB');
    expect(written.path).toBe('exports/book.epub');
    expect(fs.readFileSync(written.absPath, 'utf8')).toBe('EPUB');

    const outside = path.join(tmp, 'escape.epub');
    expect(() => commitEpubTargetExport(root, '../escape.epub', 'NO')).toThrow();
    expect(fs.existsSync(outside)).toBe(false);

    const outDir = path.join(tmp, 'out-dir');
    fs.mkdirSync(outDir);
    fs.symlinkSync(outDir, path.join(root, 'sub'));
    expect(() => commitEpubTargetExport(root, 'sub/x.epub', 'NO')).toThrow();
    expect(fs.existsSync(path.join(outDir, 'x.epub'))).toBe(false);

    fs.writeFileSync(path.join(root, 'leaf-target.epub'), 'KEEP');
    const leafOutside = path.join(tmp, 'leaf-outside.epub');
    fs.writeFileSync(leafOutside, 'KEEP');
    fs.rmSync(path.join(root, 'Book.epub'), { force: true });
    fs.symlinkSync(leafOutside, path.join(root, 'Book.epub'));
    expect(() => commitEpubTargetExport(root, 'Book.epub', 'NO')).toThrow();
    expect(fs.readFileSync(leafOutside, 'utf8')).toBe('KEEP');
    expect(fs.lstatSync(path.join(root, 'Book.epub')).isSymbolicLink()).toBe(true);
  });

  it('A19 settings writes are mode 0600, fsync, exempt, and refuse a link', async () => {
    const settings = path.join(root, 'app-settings.json');
    const payload = '{"theme":"dark","secret":"settings-secret-payload-9f3a"}\n';
    const errors: string[] = [];
    const errSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      errors.push(String(message));
    });
    const fsync = vi.spyOn(fs, 'fsyncSync');
    writeFileAtomicSecure(settings, payload);
    expect(fsync).toHaveBeenCalled();
    expect(errors.join('\n')).not.toContain('settings-secret-payload-9f3a');
    errSpy.mockRestore();
    if (process.platform !== 'win32') {
      expect(fs.statSync(settings).mode & 0o777).toBe(0o600);
    }
    const leftover = `${settings}.${process.pid}-abcdabcdabcd.tmp`;
    fs.writeFileSync(leftover, 'tmp');
    deleteLeftoverAtomicTemps([settings]);
    expect(fs.existsSync(leftover)).toBe(false);

    if (symlinksWork) {
      const outside = path.join(tmp, 'settings-out.json');
      fs.writeFileSync(outside, 'KEEP');
      const linked = path.join(root, 'linked-settings.json');
      fs.symlinkSync(outside, linked);
      expect(() => writeFileAtomicSecure(linked, 'nope')).toThrow(SETTINGS_LINK_TEXT);
      expect(fs.readFileSync(outside, 'utf8')).toBe('KEEP');
    }

    const zeroTarget = path.join(root, 'zero-settings.json');
    const realFstat = fs.fstatSync.bind(fs);
    const realLstat = fs.lstatSync.bind(fs);
    const wrap = <T extends (...args: never[]) => fs.Stats | fs.BigIntStats>(real: T): T =>
      ((...args: never[]) => {
        const opts = args[1] as { bigint?: boolean } | undefined;
        const st = real(...args);
        if (!opts?.bigint) return st;
        return new Proxy(st, {
          get(stats, key, receiver) {
            if (key === 'ino') return 0n;
            const value = Reflect.get(stats, key, receiver);
            return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(stats) : value;
          },
        });
      }) as T;
    const fstatSpy = vi.spyOn(fs, 'fstatSync').mockImplementation(wrap(realFstat as typeof fs.fstatSync));
    const lstatSpy = vi.spyOn(fs, 'lstatSync').mockImplementation(wrap(realLstat as typeof fs.lstatSync));
    writeFileAtomicSecure(zeroTarget, '{"theme":"dark"}\n');
    expect(fs.readFileSync(zeroTarget, 'utf8')).toContain('dark');
    fstatSpy.mockRestore();
    lstatSpy.mockRestore();

    const userData = path.join(tmp, 'user-data');
    const story = path.join(tmp, 'story');
    const notes = path.join(tmp, 'notes');
    fs.mkdirSync(userData);
    fs.mkdirSync(story);
    fs.mkdirSync(notes);
    const zip = new JSZip();
    zip.file('header.json', JSON.stringify({ schemaVersion: BACKUP_SCHEMA_VERSION, appVersion: '0', manifestSchemaVersion: 1, createdAt: '2020-01-01T00:00:00.000Z' }));
    zip.file('userData/app-settings.json', '{"theme":"light"}\n');
    const archive = path.join(tmp, 'backup.zip');
    fs.writeFileSync(archive, await zip.generateAsync({ type: 'nodebuffer' }));
    const restored = await restoreAppData({
      archivePath: archive,
      userDataPath: userData,
      storyVaultRoot: story,
      notesVaultRoot: notes,
      overwrite: true,
    });
    expect(restored.restored).toBe(true);
    const restoredSettings = path.join(userData, 'app-settings.json');
    expect(fs.readFileSync(restoredSettings, 'utf8')).toContain('light');
    if (process.platform !== 'win32') {
      expect(fs.statSync(restoredSettings).mode & 0o777).toBe(0o600);
    }
  });

  it('A25 denies a settings read that leaves userData and still reads an inside link', () => {
    const userData = path.join(tmp, 'userdata');
    fs.mkdirSync(userData);
    const real = path.join(userData, 'real-settings.json');
    fs.writeFileSync(real, JSON.stringify({ theme: 'light', onboardingComplete: true }));
    const settings = path.join(userData, 'app-settings.json');
    if (symlinksWork) {
      fs.symlinkSync(real, settings);
      const loaded = loadAppSettingsFrom(settings, () => {
        throw new Error('no store');
      });
      expect(loaded.theme).toBe('light');
      expect(settingsLoadUsedParseFallbackOnLastRead()).toBe(false);

      fs.rmSync(settings);
      const outside = path.join(tmp, 'outside-settings.json');
      fs.writeFileSync(outside, JSON.stringify({ theme: 'light', onboardingComplete: true }));
      fs.symlinkSync(outside, settings);
      const denied = loadAppSettingsFrom(settings, () => {
        throw new Error('no store');
      });
      expect(denied.theme).toBe('dark');
      expect(settingsLoadUsedParseFallbackOnLastRead()).toBe(true);
      expect(fs.readFileSync(outside, 'utf8')).toContain('"theme":"light"');

      const secretsOutside = path.join(tmp, 'secrets-outside.json');
      fs.writeFileSync(secretsOutside, 'SECRET-BYTES');
      const secretsPath = path.join(userData, 'secrets.json');
      fs.symlinkSync(secretsOutside, secretsPath);
      expect(readUserDataFile(secretsPath, userData).status).toBe('denied');
      const store = new SecretsStore({
        filePath: secretsPath,
        safeStorage: {
          isEncryptionAvailable: () => true,
          encryptString: (plain: string) => Buffer.from(plain),
          decryptString: (buf: Buffer) => buf.toString(),
        },
      });
      expect(store.get('apiKey')).toBeNull();
      expect(fs.readFileSync(secretsOutside, 'utf8')).toBe('SECRET-BYTES');

      fs.rmSync(settings);
      fs.symlinkSync(path.join(userData, 'missing-settings.json'), settings);
      expect(readUserDataFile(settings, userData).status).toBe('denied');
      fs.rmSync(settings);
      fs.symlinkSync('app-settings.json', settings);
      expect(readUserDataFile(settings, userData).status).toBe('denied');
    }
    const injected = {
      lstatSync() {
        const error = new Error('eacces') as NodeJS.ErrnoException;
        error.code = 'EACCES';
        throw error;
      },
      realpathSync: fs.realpathSync,
      readFileSync: fs.readFileSync,
    } as unknown as typeof fs;
    expect(readUserDataFile(settings, userData, injected).status).toBe('denied');
    expect(readUserDataFile(path.join(userData, 'absent.json'), userData).status).toBe('absent');
  });

  it('A20 refuses to preserve a corrupt timelines file through a symlink', () => {
    if (skipSymlink()) return;
    const store = createSeedTimelinesStore('2020-01-01T00:00:00.000Z');
    writeTimelinesStore(root, store);
    writeTimelinesStore(root, store);
    expect(fs.existsSync(path.join(root, `${TIMELINES_FILENAME}${TIMELINES_BACKUP_SUFFIX}`))).toBe(true);
    fs.writeFileSync(path.join(root, TIMELINES_FILENAME), '{not json');
    const iso = '2020-06-01T00:00:00.000Z';
    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue(iso);
    const outside = path.join(tmp, 'corrupt-outside');
    fs.writeFileSync(outside, 'KEEP');
    const stamp = iso.replace(/[:.]/g, '-');
    fs.symlinkSync(outside, path.join(root, `${TIMELINES_FILENAME}.corrupt-${stamp}`));
    expect(() => readTimelinesStore(root)).toThrow();
    expect(fs.readFileSync(outside, 'utf8')).toBe('KEEP');
  });

  it('tag listing ignores an outside note symlink and rename does not back it up', () => {
    if (skipSymlink()) return;
    const outsideBody = '---\ntags: [secret-leak]\n---\nSECRET\n';
    const localBody = '---\ntags: [local]\n---\nlocal\n';
    fs.writeFileSync(path.join(root, 'a.md'), localBody);
    const outside = path.join(tmp, 'tagged-secret.md');
    fs.writeFileSync(outside, outsideBody);
    fs.symlinkSync(outside, path.join(root, 'link.md'));

    const names = listNotesTags(root).map((entry) => entry.fullName);
    expect(names).toContain('local');
    expect(names).not.toContain('secret-leak');

    const before = fs.statSync(outside).mtimeMs;
    const result = renameNotesTag(root, 'local', 'renamed');
    expect(result.skipped).toContain('link.md: skipped (symlink)');
    expect(result.affectedFiles).toBe(1);
    expect(fs.readFileSync(outside, 'utf8')).toBe(outsideBody);
    expect(fs.statSync(outside).mtimeMs).toBe(before);
    const backupDir = path.join(root, '.tag-wrangler', 'backups');
    const backups = fs.readdirSync(backupDir).filter((name) => name.endsWith('.json'));
    expect(backups).toHaveLength(1);
    const backup = JSON.parse(fs.readFileSync(path.join(backupDir, backups[0]), 'utf8')) as {
      files: Array<{ relPath: string; content: string }>;
    };
    expect(backup.files.map((file) => file.relPath)).toEqual(['a.md']);
    expect(JSON.stringify(backup)).not.toContain('SECRET');
  });

  it('A24 tag rewrite lists one symlink and writes the other notes', () => {
    if (skipSymlink()) return;
    const body = '---\ntags: [keepme]\n---\nbody\n';
    fs.writeFileSync(path.join(root, 'a.md'), body);
    fs.writeFileSync(path.join(root, 'z.md'), body);
    const outside = path.join(tmp, 'tagged-outside.md');
    fs.writeFileSync(outside, body);
    fs.symlinkSync(outside, path.join(root, 'link.md'));
    const before = fs.statSync(outside).mtimeMs;
    const result = renameNotesTag(root, 'keepme', 'other');
    expect(result.skipped).toContain('link.md: skipped (symlink)');
    expect(result.affectedFiles).toBe(2);
    expect(fs.readFileSync(outside, 'utf8')).toBe(body);
    expect(fs.statSync(outside).mtimeMs).toBe(before);
    expect(fs.readFileSync(path.join(root, 'a.md'), 'utf8')).toContain('other');
    expect(fs.readFileSync(path.join(root, 'z.md'), 'utf8')).toContain('other');
  });

  it('A24 dedupe lists the middle symlink and writes the neighbours', () => {
    if (skipSymlink()) return;
    fs.writeFileSync(path.join(root, 'a.md'), 'a');
    fs.writeFileSync(path.join(root, 'z.md'), 'z');
    const outside = path.join(tmp, 'dedupe-outside.md');
    fs.writeFileSync(outside, 'KEEP');
    fs.symlinkSync(outside, path.join(root, 'mid.md'));
    const skipped: string[] = [];
    expect(writeReIdFile(root, path.join(root, 'a.md'), 'A2', skipped)).toBe(true);
    expect(writeReIdFile(root, path.join(root, 'mid.md'), 'M2', skipped)).toBe(false);
    expect(writeReIdFile(root, path.join(root, 'z.md'), 'Z2', skipped)).toBe(true);
    expect(skipped).toContain('mid.md: skipped (symlink)');
    expect(fs.readFileSync(outside, 'utf8')).toBe('KEEP');
    expect(fs.readFileSync(path.join(root, 'a.md'), 'utf8')).toBe('A2');
    expect(fs.readFileSync(path.join(root, 'z.md'), 'utf8')).toBe('Z2');
  });

  it('A24 genre seed lists a dangling beat sheet and writes the other notes', () => {
    if (skipSymlink()) return;
    const created = createMythosVault(tmp, { name: 'Genre', seedDemo: false, exactName: true });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const notes = notesVaultRootFor(created.mythosRoot);
    const beat = path.join(notes, ...GENRE_SEED_NOTE_PATHS.beatSheet.split('/'));
    fs.mkdirSync(path.dirname(beat), { recursive: true });
    const outside = path.join(tmp, 'missing-beat');
    fs.symlinkSync(outside, beat);
    const result = writeGenreStarterNotes(created.mythosRoot, 'Epic Fantasy');
    expect(result.skipped).toContain(`${GENRE_SEED_NOTE_PATHS.beatSheet}: skipped (symlink)`);
    expect(result.written).toContain(GENRE_SEED_NOTE_PATHS.templates);
    expect(result.written).toContain(GENRE_SEED_NOTE_PATHS.personas);
    expect(fs.lstatSync(beat).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(outside)).toBe(false);
  });

  it('A24 veynn seed lists a scene planted as a symlink', () => {
    if (skipSymlink()) return;
    const created = createMythosVault(tmp, { name: 'Veynn', seedDemo: false, exactName: true });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const outside = path.join(tmp, 'veynn-outside.md');
    fs.writeFileSync(outside, 'KEEP');
    const orig = fs.mkdirSync.bind(fs);
    const spy = vi.spyOn(fs, 'mkdirSync').mockImplementation(((dir: fs.PathLike, opts?: fs.MakeDirectoryOptions) => {
      const result = orig(dir, opts);
      const text = String(dir);
      if (text.endsWith(`${path.sep}Chapter 01`)) {
        const link = path.join(text, 'Scene 02.md');
        try {
          fs.lstatSync(link);
        } catch {
          fs.symlinkSync(outside, link);
        }
      }
      return result;
    }) as typeof fs.mkdirSync);
    try {
      const seeded = writeVeynnSeed(created.mythosRoot);
      expect(seeded.skippedSymlinks.some((line) => line.includes('Scene 02.md: skipped (symlink)'))).toBe(true);
      expect(seeded.sceneCount).toBeGreaterThan(1);
    } finally {
      spy.mockRestore();
    }
    expect(fs.readFileSync(outside, 'utf8')).toBe('KEEP');
  });

  it('A24 seed pack lists the middle note', () => {
    if (skipSymlink()) return;
    const seedPath = path.join(tmp, 'seed.json');
    fs.writeFileSync(seedPath, JSON.stringify({
      packs: {
        mythos: {
          vault: [{ id: 'f', label: 'SymlinkFolder', files: [{ id: 'a', label: 'Alpha' }, { id: 'm', label: 'Middle' }, { id: 'z', label: 'Zulu' }] }],
          notes: { a: { title: 'Alpha', md: '# Alpha\n' }, m: { title: 'Middle', md: '# Middle\n' }, z: { title: 'Zulu', md: '# Zulu\n' } },
        },
        aether: { vault: [], notes: {} },
      },
    }));
    const outside = path.join(tmp, 'middle-outside.md');
    fs.writeFileSync(outside, 'KEEP');
    const orig = fs.mkdirSync.bind(fs);
    const spy = vi.spyOn(fs, 'mkdirSync').mockImplementation(((dir: fs.PathLike, opts?: fs.MakeDirectoryOptions) => {
      const result = orig(dir, opts);
      if (path.basename(String(dir)) === 'SymlinkFolder') {
        const link = path.join(String(dir), 'Middle.md');
        try {
          fs.lstatSync(link);
        } catch {
          fs.symlinkSync(outside, link);
        }
      }
      return result;
    }) as typeof fs.mkdirSync);
    try {
      const applied = applySeedPackToNewVault(tmp, 'mythos', { seedPath, exactName: true });
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      expect(applied.skippedSymlinks.some((line) => line.includes('Middle.md: skipped (symlink)'))).toBe(true);
    } finally {
      spy.mockRestore();
    }
    expect(fs.readFileSync(outside, 'utf8')).toBe('KEEP');
  });

  it('A24 migrator lists a scene planted when its chapter directory is created', () => {
    if (skipSymlink()) return;
    const sourceStory = path.join(tmp, 'source-story');
    const sourceNotes = path.join(tmp, 'source-notes');
    const target = path.join(tmp, 'migrated');
    fs.mkdirSync(sourceStory);
    fs.mkdirSync(sourceNotes);
    const now = '2026-06-01T00:00:00.000Z';
    const scene = (id: string, title: string, order: number) => ({
      id,
      title,
      path: `missing/${id}.md`,
      order,
      chapterId: 'ch',
      storyId: 'st',
      blocks: [{ id: `b-${id}`, type: 'prose', order: 0, content: `prose ${id}`, updatedAt: now }],
      createdAt: now,
      updatedAt: now,
    });
    fs.writeFileSync(path.join(sourceStory, 'manifest.json'), JSON.stringify({
      schemaVersion: 1,
      version: '2.0.0',
      vaultRoot: sourceStory,
      stories: [{
        id: 'st',
        title: 'Alpha',
        path: 'Manuscript/alpha',
        chapters: [{
          id: 'ch',
          title: 'One',
          path: 'Manuscript/alpha/ch',
          order: 0,
          scenes: [scene('s1', 'One', 0), scene('s2', 'Two', 1), scene('s3', 'Three', 2)],
          createdAt: now,
          updatedAt: now,
        }],
        createdAt: now,
        updatedAt: now,
      }],
      entities: [],
      suggestions: [],
      scenes: [],
      chapters: [],
    }));
    const outside = path.join(tmp, 'migrate-outside.md');
    fs.writeFileSync(outside, 'KEEP');
    const orig = fs.mkdirSync.bind(fs);
    const spy = vi.spyOn(fs, 'mkdirSync').mockImplementation(((dir: fs.PathLike, opts?: fs.MakeDirectoryOptions) => {
      const result = orig(dir, opts);
      const text = String(dir);
      if (text.includes(`${path.sep}Alpha${path.sep}`) && text.endsWith(`${path.sep}Chapter 01`)) {
        const link = path.join(text, 'Scene 02.md');
        try {
          fs.lstatSync(link);
        } catch {
          fs.symlinkSync(outside, link);
        }
      }
      return result;
    }) as typeof fs.mkdirSync);
    try {
      const report = runMythosVaultMigration({
        sourceStoryVault: sourceStory,
        sourceNotesVault: sourceNotes,
        targetRoot: target,
      });
      expect(report.skippedSymlinks ?? [], report.error).toEqual(
        expect.arrayContaining([expect.stringContaining('Scene 02.md: skipped (symlink)')]),
      );
      const story = storyVaultRootFor(target);
      expect(fs.existsSync(path.join(story, 'Alpha', 'Part 1', 'Chapter 01', 'Scene 01.md'))).toBe(true);
      expect(fs.existsSync(path.join(story, 'Alpha', 'Part 1', 'Chapter 01', 'Scene 03.md'))).toBe(true);
      expect(fs.lstatSync(path.join(story, 'Alpha', 'Part 1', 'Chapter 01', 'Scene 02.md')).isSymbolicLink()).toBe(true);
    } finally {
      spy.mockRestore();
    }
    expect(fs.readFileSync(outside, 'utf8')).toBe('KEEP');
  });

  it('A24 canonical sync lists a symlinked book and writes the others', () => {
    if (skipSymlink()) return;
    const created = createMythosVault(tmp, { name: 'Books', seedDemo: false, exactName: true });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const storyRoot = created.storyVaultPath;
    for (const folder of ['Alpha', 'Middle', 'Zulu']) {
      const dir = path.join(storyRoot, folder);
      fs.mkdirSync(dir);
      fs.writeFileSync(
        path.join(dir, 'book.md'),
        `---\nid: ${folder}\ntitle: ${folder}\ncreatedAt: 2026-01-01T00:00:00.000Z\nupdatedAt: 2026-01-01T00:00:00.000Z\n---\n# ${folder}\n`,
      );
    }
    const manifest = scanMythosStoryVault(created.mythosRoot);
    const outside = path.join(tmp, 'book-outside.md');
    fs.writeFileSync(outside, 'KEEP');
    const middleBook = path.join(storyRoot, 'Middle', 'book.md');
    fs.rmSync(middleBook);
    fs.symlinkSync(outside, middleBook);
    for (const story of manifest.stories) {
      story.updatedAt = '2099-01-01T00:00:00.000Z';
      if (story.path !== 'Middle' && story.title) story.title = `${story.title} edited`;
    }
    const skipped: string[] = [];
    syncCanonicalFromManifest(created.mythosRoot, manifest, skipped);
    expect(skipped.some((line) => line.includes('book.md: skipped (symlink)'))).toBe(true);
    expect(fs.readFileSync(outside, 'utf8')).toBe('KEEP');
    expect(fs.readFileSync(path.join(storyRoot, 'Alpha', 'book.md'), 'utf8')).toContain('edited');
    expect(fs.readFileSync(path.join(storyRoot, 'Zulu', 'book.md'), 'utf8')).toContain('edited');
  });

  it('refuses a leaf swapped for an in-vault symlink between lstat and realpath', () => {
    if (skipSymlink()) return;
    const other = path.join(root, 'other.md');
    const leaf = path.join(root, 'leaf.md');
    fs.writeFileSync(other, 'OTHER');
    fs.writeFileSync(leaf, 'ORIGINAL');
    let swapped = false;
    const orig = fs.lstatSync.bind(fs);
    vi.spyOn(fs, 'lstatSync').mockImplementation(((p: fs.PathLike, opts?: { bigint?: boolean }) => {
      const st = opts === undefined ? orig(p) : orig(p, opts as { bigint: true });
      if (!swapped && pathKey(p) === pathKey(leaf)) {
        swapped = true;
        fs.unlinkSync(leaf);
        fs.symlinkSync(other, leaf);
      }
      return st;
    }) as typeof fs.lstatSync);
    expect(swapped).toBe(false);
    expect(() => writeVaultFileAtomic(root, 'leaf.md', 'NEW')).toThrow(/symlink leaf not allowed on write/);
    expect(fs.readFileSync(other, 'utf8')).toBe('OTHER');
    expect(fs.lstatSync(leaf).isSymbolicLink()).toBe(true);
  });

  it('lstats a missing write leaf once and does not existsSync it', () => {
    const rel = 'missing-leaf.md';
    const leafPath = path.resolve(root, rel);
    const lstat = vi.spyOn(fs, 'lstatSync');
    const exists = vi.spyOn(fs, 'existsSync');
    try {
      const result = safeVaultJoin(root, rel, { writeMode: true });
      expect(path.basename(result)).toBe('missing-leaf.md');
      expect(result.startsWith(fs.realpathSync.native(root))).toBe(true);
      expect(lstat.mock.calls.filter((call) => call[0] === leafPath)).toHaveLength(1);
      expect(exists.mock.calls.filter((call) => call[0] === leafPath)).toHaveLength(0);
    } finally {
      lstat.mockRestore();
      exists.mockRestore();
    }
  });

  it('measures the added save cost', () => {
    const time = (run: () => void): number => {
      const start = performance.now();
      run();
      return performance.now() - start;
    };
    const fmt = (n: number): string => (Number.isFinite(n) ? n.toFixed(3) : 'inf');
    const payload = Buffer.from('hello');

    resetVolumeProbeCache();
    const probeCold = time(() => {
      probeVolumeKind(root);
    });
    const probeWarm = time(() => {
      probeVolumeKind(root);
    });

    const oldFile = path.join(root, 'old-save.md');
    prePrWriteFileAtomic(oldFile, payload);
    writeVaultFileAtomic(root, 'new-save.md', payload);
    for (let i = 0; i < 4; i++) {
      prePrWriteFileAtomic(oldFile, payload);
      writeVaultFileAtomic(root, 'new-save.md', payload);
    }

    const saveN = 60;
    const repeats = 3;
    const repeatRows: Array<{
      oldSaveP50: number;
      oldSaveP95: number;
      newSaveP50: number;
      newSaveP95: number;
      oldJoinP50: number;
      oldJoinP95: number;
      newJoinP50: number;
      newJoinP95: number;
    }> = [];
    for (let repeat = 0; repeat < repeats; repeat++) {
      const oldSaveSamples: number[] = [];
      const newSaveSamples: number[] = [];
      for (let i = 0; i < saveN; i++) {
        oldSaveSamples.push(time(() => prePrWriteFileAtomic(oldFile, payload)));
        newSaveSamples.push(time(() => writeVaultFileAtomic(root, 'new-save.md', payload)));
      }
      const oldSave = perfStats(oldSaveSamples);
      const newSave = perfStats(newSaveSamples);
      const oldJoinSamples: number[] = [];
      const newJoinSamples: number[] = [];
      for (let i = 0; i < 5000; i++) {
        const rel = `n${i}.md`;
        oldJoinSamples.push(time(() => prePrSafeVaultJoin(root, rel)));
        newJoinSamples.push(
          time(() => {
            safeVaultJoin(root, rel, { writeMode: true });
          }),
        );
      }
      const oldJoin = perfStats(oldJoinSamples);
      const newJoin = perfStats(newJoinSamples);
      repeatRows.push({
        oldSaveP50: oldSave.p50,
        oldSaveP95: oldSave.p95,
        newSaveP50: newSave.p50,
        newSaveP95: newSave.p95,
        oldJoinP50: oldJoin.p50,
        oldJoinP95: oldJoin.p95,
        newJoinP50: newJoin.p50,
        newJoinP95: newJoin.p95,
      });
    }
    const med = {
      oldSaveP50: perfMedian(repeatRows.map((row) => row.oldSaveP50)),
      oldSaveP95: perfMedian(repeatRows.map((row) => row.oldSaveP95)),
      newSaveP50: perfMedian(repeatRows.map((row) => row.newSaveP50)),
      newSaveP95: perfMedian(repeatRows.map((row) => row.newSaveP95)),
      oldJoinP50: perfMedian(repeatRows.map((row) => row.oldJoinP50)),
      oldJoinP95: perfMedian(repeatRows.map((row) => row.oldJoinP95)),
      newJoinP50: perfMedian(repeatRows.map((row) => row.newJoinP50)),
      newJoinP95: perfMedian(repeatRows.map((row) => row.newJoinP95)),
    };

    const profileN = 20;
    const oldProfile = profileFsCalls(profileN, () => prePrWriteFileAtomic(oldFile, payload));
    const newProfile = profileFsCalls(profileN, () => writeVaultFileAtomic(root, 'new-save.md', payload));
    const bucketLine = (label: string, buckets: Map<string, ProfileBucket>): string => {
      const rows = [...buckets.entries()].sort((a, b) => b[1].ms - a[1].ms);
      return rows
        .map(
          ([name, bucket]) =>
            `${label} ${name} calls=${bucket.calls} total_ms=${bucket.ms.toFixed(3)} per_save_ms=${(bucket.ms / profileN).toFixed(3)}`,
        )
        .join('\n');
    };

    const saveP50Delta = med.newSaveP50 - med.oldSaveP50;
    const saveP95Delta = med.newSaveP95 - med.oldSaveP95;
    const joinP50Delta = med.newJoinP50 - med.oldJoinP50;
    const repeatLog = repeatRows
      .map(
        (row, index) =>
          `PERF-REPEAT ${index + 1} save old_p50=${fmt(row.oldSaveP50)} old_p95=${fmt(row.oldSaveP95)} new_p50=${fmt(row.newSaveP50)} new_p95=${fmt(row.newSaveP95)} join old_p50=${fmt(row.oldJoinP50)} old_p95=${fmt(row.oldJoinP95)} new_p50=${fmt(row.newJoinP50)} new_p95=${fmt(row.newJoinP95)}`,
      )
      .join('\n');
    console.log(
      [
        repeatLog,
        'PERF-TABLE-BEGIN',
        `| measure | old p50 ms | old p95 ms | new p50 ms | new p95 ms | % p50 | % p95 |`,
        `| --- | ---: | ---: | ---: | ---: | ---: | ---: |`,
        `| per-save overwrite | ${fmt(med.oldSaveP50)} | ${fmt(med.oldSaveP95)} | ${fmt(med.newSaveP50)} | ${fmt(med.newSaveP95)} | ${fmt(perfPct(med.oldSaveP50, med.newSaveP50))} | ${fmt(perfPct(med.oldSaveP95, med.newSaveP95))} |`,
        `| 5k join per call | ${fmt(med.oldJoinP50)} | ${fmt(med.oldJoinP95)} | ${fmt(med.newJoinP50)} | ${fmt(med.newJoinP95)} | ${fmt(perfPct(med.oldJoinP50, med.newJoinP50))} | ${fmt(perfPct(med.oldJoinP95, med.newJoinP95))} |`,
        'PERF-TABLE-END',
        `PERF-DELTAS save_p50=${fmt(saveP50Delta)} save_p95=${fmt(saveP95Delta)} join_p50=${fmt(joinP50Delta)}`,
        `PERF-PROBE cold_ms=${fmt(probeCold)} warm_ms=${fmt(probeWarm)}`,
        'PERF-BREAKDOWN-BEGIN',
        bucketLine('old', oldProfile),
        bucketLine('new', newProfile),
        'PERF-BREAKDOWN-END',
      ].join('\n'),
    );

    expect(fs.readFileSync(oldFile).equals(payload)).toBe(true);
    expect(fs.readFileSync(path.join(root, 'new-save.md')).equals(payload)).toBe(true);
    const realRoot = fs.realpathSync.native(root);
    expect(prePrSafeVaultJoin(root, 'n0.md').startsWith(realRoot)).toBe(true);
    expect(safeVaultJoin(root, 'n0.md', { writeMode: true }).startsWith(realRoot)).toBe(true);

    // Owner ruling. Median of 3 repeats. Both platforms.
    // per-save p50(new) - p50(old) <= 1 ms.
    // p95(new) - p95(old) <= 3 ms on Linux, <= 8 ms on win32.
    // join p50(new) - p50(old) <= 0.05 ms per call.
    const saveP95Ceiling = process.platform === 'win32' ? 8 : 3;
    expect(saveP50Delta).toBeLessThanOrEqual(1);
    expect(saveP95Delta).toBeLessThanOrEqual(saveP95Ceiling);
    expect(joinP50Delta).toBeLessThanOrEqual(0.05);
  }, 60000);
});
