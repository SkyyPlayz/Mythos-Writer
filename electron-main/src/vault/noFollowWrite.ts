// owns no-follow, handle-checked file writes; never resolves or containment-checks vault paths.

import crypto from 'crypto';
import { execFileSync as nodeExecFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { VaultFileTooLargeError, MAX_VAULT_FILE_BYTES } from './limits.js';
import { renameSyncWithRetry } from './renameSyncWithRetry.js';
import { fileDisplayName, volumeUnsupportedText } from './writeErrorText.js';

export type VolumeKind = 'fat' | 'network' | 'local' | 'unknown';

export type WriteRefusalCode =
  | 'LEAF_LINK'
  | 'HANDLE_MISMATCH'
  | 'SWAP'
  | 'VOLUME_UNSUPPORTED'
  | 'HARD_LINK';

const FAT_MAGIC = new Set<number>([0x4d44, 0x2011bab0]);
const NETWORK_MAGIC = new Set<number>([0x6969, 0x517b, 0xff534d42, 0xfe534d42]);

/** Same cap as MAX_IMPORT_FILE_BYTES. Enforced here so callers cannot skip it. */
export const NOFOLLOW_COPY_MAX_BYTES = MAX_VAULT_FILE_BYTES;

export interface NoFollowHooks {
  afterOpen(openedPath: string): void;
  beforeRename(targetPath: string): void;
}

export interface NoFollowDeps {
  platform: NodeJS.Platform;
  fs: typeof fs;
  probeVolume: (dir: string) => VolumeKind;
  hooks: NoFollowHooks;
}

export interface VolumeProbeInject {
  platform?: NodeJS.Platform;
  fs?: Pick<typeof fs, 'statSync' | 'statfsSync'>;
  execFileSync?: (
    file: string,
    args: readonly string[],
    options: {
      timeout: number;
      killSignal: NodeJS.Signals;
      windowsHide: boolean;
      encoding: 'utf8';
    },
  ) => string;
}

const volumeCache = new Map<string, VolumeKind>();

export function resetVolumeProbeCache(): void {
  volumeCache.clear();
}

function logRefusal(code: string, rel: string): void {
  console.error(`vault-write-refused ${JSON.stringify({ code, rel: fileDisplayName(rel) })}`);
}

export class VaultWriteRefusedError extends Error {
  readonly code: WriteRefusalCode;
  readonly rel: string;
  readonly syscallCode?: string;

  constructor(code: WriteRefusalCode, rel: string, message?: string, syscallCode?: string) {
    const name = fileDisplayName(rel);
    const text =
      message ??
      (code === 'VOLUME_UNSUPPORTED' ? volumeUnsupportedText(name) : `vault write refused: ${code}`);
    super(text);
    this.name = 'VaultWriteRefusedError';
    this.code = code;
    this.rel = name;
    this.syscallCode = syscallCode;
    logRefusal(code, rel);
  }
}

const noopHooks: NoFollowHooks = {
  afterOpen() {},
  beforeRename() {},
};

let testHooks: NoFollowHooks | null = null;

/** @internal Installed only through noFollowWrite.testing.ts. */
export function installNoFollowTestHooks(hooks: NoFollowHooks | null): void {
  testHooks = hooks;
}

function hooksFor(deps: NoFollowDeps): NoFollowHooks {
  return testHooks ?? deps.hooks;
}

/**
 * `lstatResult` must come from `lstat`, not `stat` or `fstat`.
 * `stat` of a symlink-to-file reports `isFile()` and would hide the link.
 * Callers pass `lstatSync` only: the pre-write target, the temp file, the
 * post-write target, append's leaf, and `assertFixedTmpNotLink`.
 * A regular file skips `readlinkSync`. A directory reparse point is not a
 * file, so the junction fallback still calls `readlinkSync`.
 */
function isLinkStats(lstatResult: fs.Stats | fs.BigIntStats, p: string, fsImpl: typeof fs): boolean {
  if (lstatResult.isSymbolicLink()) return true;
  if (lstatResult.isFile()) return false;
  try {
    fsImpl.readlinkSync(p);
    return true;
  } catch {
    return false;
  }
}

export function probeVolumeKind(dir: string, injected: VolumeProbeInject = {}): VolumeKind {
  const platform = injected.platform ?? process.platform;
  const fsImpl = injected.fs ?? fs;
  const exec = injected.execFileSync ?? nodeExecFileSync;

  if (platform === 'win32') {
    const unc = uncShareKey(dir);
    if (unc) {
      const key = `unc:${unc}`;
      const cached = volumeCache.get(key);
      if (cached) return cached;
      volumeCache.set(key, 'network');
      return 'network';
    }
    const drive = driveLetterKey(dir);
    if (!drive) return 'unknown';
    const key = `drive:${drive}`;
    const cached = volumeCache.get(key);
    if (cached) return cached;
    const kind = probeWin32Drive(drive, exec);
    volumeCache.set(key, kind);
    return kind;
  }

  let dev: bigint;
  try {
    dev = fsImpl.statSync(dir, { bigint: true }).dev;
  } catch {
    return 'unknown';
  }
  const key = `dev:${dev}`;
  const cached = volumeCache.get(key);
  if (cached) return cached;
  const kind = probePosix(dir, fsImpl);
  volumeCache.set(key, kind);
  return kind;
}

function uncShareKey(p: string): string | null {
  let s = p;
  if (s.startsWith('\\\\?\\UNC\\')) s = `\\\\${s.slice('\\\\?\\UNC\\'.length)}`;
  else if (s.startsWith('\\\\?\\')) s = s.slice(4);
  const match = /^\\\\([^\\]+)\\([^\\]+)/.exec(s);
  if (!match) return null;
  return `${match[1]}\\${match[2]}`;
}

function driveLetterKey(p: string): string | null {
  let s = p;
  if (s.startsWith('\\\\?\\')) s = s.slice(4);
  const match = /^([A-Za-z]):/.exec(s);
  return match ? `${match[1].toLowerCase()}:` : null;
}

const EXEC_OPTS = {
  timeout: 2000,
  killSignal: 'SIGKILL' as const,
  windowsHide: true,
  encoding: 'utf8' as const,
};

function probeWin32Drive(
  drive: string,
  exec: NonNullable<VolumeProbeInject['execFileSync']>,
): VolumeKind {
  try {
    const driveType = String(exec('fsutil', ['fsinfo', 'drivetype', drive], EXEC_OPTS));
    if (/Remote|Network/i.test(driveType)) return 'network';
    const info = String(exec('fsutil', ['fsinfo', 'volumeinfo', drive], EXEC_OPTS));
    if (/\b(FAT32|FAT|exFAT)\b/i.test(info)) return 'fat';
    return 'local';
  } catch {
    return 'unknown';
  }
}

function probePosix(dir: string, fsImpl: Pick<typeof fs, 'statfsSync'>): VolumeKind {
  try {
    const st = fsImpl.statfsSync(dir) as { type?: number };
    const type = st?.type;
    if (typeof type !== 'number' || type === 0) return 'unknown';
    if (FAT_MAGIC.has(type)) return 'fat';
    if (NETWORK_MAGIC.has(type)) return 'network';
    return 'local';
  } catch {
    return 'unknown';
  }
}

export const defaultDeps: NoFollowDeps = {
  platform: process.platform,
  fs,
  probeVolume: (dir) => probeVolumeKind(dir),
  hooks: noopHooks,
};

export interface WriteNoFollowOptions {
  durable?: boolean | 'fsync';
  mode?: number;
  zeroIndex?: 'enforce' | 'exempt';
  mkdir?: boolean;
  rel?: string;
  deps?: NoFollowDeps;
}

function depsOf(options: { deps?: NoFollowDeps } | undefined): NoFollowDeps {
  return options?.deps ?? defaultDeps;
}

function tempPathFor(absPath: string): string {
  const rand = crypto.randomBytes(6).toString('hex');
  return `${absPath}.${process.pid}-${rand}.tmp`;
}

function openFlags(deps: NoFollowDeps, extra: number): number {
  const follow = deps.platform === 'win32' ? 0 : (deps.fs.constants.O_NOFOLLOW ?? 0);
  return extra | follow;
}

function cleanupTemp(fsImpl: typeof fs, fd: number | undefined, tmp: string | undefined): void {
  if (fd !== undefined) {
    try {
      fsImpl.closeSync(fd);
    } catch {
      /* ignore */
    }
  }
  if (tmp !== undefined) {
    try {
      fsImpl.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

type ZeroPolicy = 'skip' | 'network' | 'unsupported';

function zeroIndexPolicy(dir: string, deps: NoFollowDeps, exempt: boolean): ZeroPolicy {
  if (exempt) return 'skip';
  const kind = deps.probeVolume(dir);
  if (kind === 'fat') return 'skip';
  if (kind === 'network') return 'network';
  return 'unsupported';
}

/**
 * Atomic replace of `absPath`. Refuses a symlink leaf, a swapped inode, and
 * (unless exempt) a zero file-index on a volume that is not FAT or a network
 * share that passes the 4-step bar.
 */
export function writeNoFollowAtomic(
  absPath: string,
  data: Buffer | string,
  options: WriteNoFollowOptions = {},
): void {
  const deps = depsOf(options);
  const rel = options.rel ?? path.basename(absPath);
  const fsImpl = deps.fs;
  if (options.mkdir) {
    const dir = path.dirname(absPath);
    if (!fsImpl.existsSync(dir)) fsImpl.mkdirSync(dir, { recursive: true });
  }

  let pre: fs.BigIntStats | null = null;
  try {
    const st = fsImpl.lstatSync(absPath, { bigint: true });
    if (isLinkStats(st, absPath, fsImpl)) {
      throw new VaultWriteRefusedError('LEAF_LINK', rel);
    }
    pre = st;
  } catch (err) {
    if (err instanceof VaultWriteRefusedError) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      logRefusal(code ?? 'LSTAT', rel);
      throw err;
    }
  }

  const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
  const tmp = tempPathFor(absPath);
  const flags = openFlags(
    deps,
    fsImpl.constants.O_WRONLY | fsImpl.constants.O_CREAT | fsImpl.constants.O_EXCL,
  );
  let fd: number | undefined;
  try {
    fd = options.mode !== undefined ? fsImpl.openSync(tmp, flags, options.mode) : fsImpl.openSync(tmp, flags);
    hooksFor(deps).afterOpen(tmp);

    const lst = fsImpl.lstatSync(tmp, { bigint: true });
    const fst = fsImpl.fstatSync(fd, { bigint: true });
    if (isLinkStats(lst, tmp, fsImpl)) {
      throw new VaultWriteRefusedError('LEAF_LINK', rel);
    }

    let skipId = false;
    let network = false;
    if (fst.ino === 0n || lst.ino === 0n) {
      const policy = zeroIndexPolicy(path.dirname(absPath), deps, options.zeroIndex === 'exempt');
      if (policy === 'unsupported') {
        throw new VaultWriteRefusedError('VOLUME_UNSUPPORTED', rel, volumeUnsupportedText(fileDisplayName(rel)));
      }
      skipId = true;
      network = policy === 'network';
    } else if (fst.dev !== lst.dev || fst.ino !== lst.ino) {
      throw new VaultWriteRefusedError('HANDLE_MISMATCH', rel);
    }

    fsImpl.writeSync(fd, buf);
    if (options.durable === true) fsImpl.fdatasyncSync(fd);
    else if (options.durable === 'fsync') fsImpl.fsyncSync(fd);

    hooksFor(deps).beforeRename(absPath);

    if (!skipId) {
      const again = fsImpl.lstatSync(tmp, { bigint: true });
      if (isLinkStats(again, tmp, fsImpl)) {
        throw new VaultWriteRefusedError('LEAF_LINK', rel);
      }
      if (fst.dev !== again.dev || fst.ino !== again.ino) {
        throw new VaultWriteRefusedError('HANDLE_MISMATCH', rel);
      }
    } else if (network) {
      const listed = fsImpl.lstatSync(tmp);
      if (isLinkStats(listed, tmp, fsImpl)) {
        throw new VaultWriteRefusedError('LEAF_LINK', rel);
      }
      const sized = fsImpl.fstatSync(fd);
      if (listed.size !== sized.size) {
        throw new VaultWriteRefusedError('HANDLE_MISMATCH', rel);
      }
    }

    let post: fs.BigIntStats | null = null;
    try {
      post = fsImpl.lstatSync(absPath, { bigint: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw err;
    }
    if (post && isLinkStats(post, absPath, fsImpl)) {
      throw new VaultWriteRefusedError('SWAP', rel);
    }
    if (!skipId && pre && post && (pre.dev !== post.dev || pre.ino !== post.ino)) {
      throw new VaultWriteRefusedError('SWAP', rel);
    }
    if (!skipId && !pre && post) {
      throw new VaultWriteRefusedError('SWAP', rel);
    }

    fsImpl.closeSync(fd);
    fd = undefined;
    renameSyncWithRetry(tmp, absPath);
  } catch (err) {
    cleanupTemp(fsImpl, fd, tmp);
    throw err;
  }
}

/**
 * Append `line` to `absPath`. An existing name is opened without O_CREAT so
 * O_NOFOLLOW stays the POSIX guard (do not lstat-refuse before that open —
 * removing O_NOFOLLOW must stay visible). A missing name is created with
 * O_EXCL, which does not follow a dangling link.
 */
function openAppendFd(absPath: string, rel: string, deps: NoFollowDeps): number {
  const fsImpl = deps.fs;
  const existing = openFlags(deps, fsImpl.constants.O_WRONLY | fsImpl.constants.O_APPEND);
  try {
    return fsImpl.openSync(absPath, existing);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ELOOP') {
      throw new VaultWriteRefusedError('LEAF_LINK', rel, undefined, 'ELOOP');
    }
    if (code !== 'ENOENT') throw err;
  }
  const created = openFlags(
    deps,
    fsImpl.constants.O_WRONLY | fsImpl.constants.O_APPEND | fsImpl.constants.O_CREAT | fsImpl.constants.O_EXCL,
  );
  try {
    return fsImpl.openSync(absPath, created);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ELOOP' || code === 'EEXIST') {
      throw new VaultWriteRefusedError('LEAF_LINK', rel, undefined, code);
    }
    throw err;
  }
}

export function appendNoFollow(
  absPath: string,
  line: string,
  options: { rel?: string; deps?: NoFollowDeps } = {},
): void {
  const deps = depsOf(options);
  const rel = options.rel ?? path.basename(absPath);
  const fsImpl = deps.fs;
  const fd = openAppendFd(absPath, rel, deps);
  try {
    hooksFor(deps).afterOpen(absPath);
    const fst = fsImpl.fstatSync(fd, { bigint: true });
    const lst = fsImpl.lstatSync(absPath, { bigint: true });
    if (isLinkStats(lst, absPath, fsImpl)) {
      throw new VaultWriteRefusedError('LEAF_LINK', rel);
    }
    if (fst.ino === 0n || lst.ino === 0n) {
      const policy = zeroIndexPolicy(path.dirname(absPath), deps, false);
      if (policy === 'unsupported') {
        throw new VaultWriteRefusedError('VOLUME_UNSUPPORTED', rel, volumeUnsupportedText(fileDisplayName(rel)));
      }
      if (policy === 'network' && fst.size !== lst.size) {
        throw new VaultWriteRefusedError('HANDLE_MISMATCH', rel);
      }
    } else if (fst.dev !== lst.dev || fst.ino !== lst.ino) {
      throw new VaultWriteRefusedError('HANDLE_MISMATCH', rel);
    }
    if (fst.nlink > 1n) {
      throw new VaultWriteRefusedError('HARD_LINK', rel);
    }
    fsImpl.writeSync(fd, Buffer.from(line, 'utf-8'));
  } catch (err) {
    try {
      fsImpl.closeSync(fd);
    } catch {
      /* ignore */
    }
    throw err;
  }
  fsImpl.closeSync(fd);
}

/**
 * Copy `src` onto `absDst` without following a destination symlink.
 * Refuses an oversize source before reading it into memory.
 */
export function copyNoFollowAtomic(
  src: string,
  absDst: string,
  options: { durable?: boolean; rel?: string; deps?: NoFollowDeps; mkdir?: boolean } = {},
): void {
  const deps = depsOf(options);
  const fsImpl = deps.fs;
  const fd = fsImpl.openSync(src, 'r');
  try {
    const st = fsImpl.fstatSync(fd);
    if (st.size > NOFOLLOW_COPY_MAX_BYTES) {
      throw new VaultFileTooLargeError(st.size, NOFOLLOW_COPY_MAX_BYTES);
    }
    const buf = readExact(fsImpl, fd, st.size);
    writeNoFollowAtomic(absDst, buf, {
      durable: options.durable ?? false,
      mkdir: options.mkdir ?? true,
      rel: options.rel ?? path.basename(absDst),
      deps,
    });
  } finally {
    try {
      fsImpl.closeSync(fd);
    } catch {
      /* ignore */
    }
  }
}

function readExact(fsImpl: typeof fs, fd: number, size: number): Buffer {
  const buf = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const n = fsImpl.readSync(fd, buf, offset, size - offset, offset);
    if (n === 0) {
      throw new Error(`premature EOF: expected ${size} bytes, got ${offset}`);
    }
    offset += n;
  }
  return buf;
}

/** A pre-placed `<manifest>.tmp` symlink is refused. A regular leftover is not. */
export function assertFixedTmpNotLink(tmpPath: string, rel: string, fsImpl: typeof fs = fs): void {
  let st: fs.Stats;
  try {
    st = fsImpl.lstatSync(tmpPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return;
    throw err;
  }
  if (isLinkStats(st, tmpPath, fsImpl)) {
    throw new VaultWriteRefusedError('LEAF_LINK', rel);
  }
}
