// One open for every no-follow call site.
// POSIX: add O_NOFOLLOW and open. Do not lstat first — a missing flag must stay visible.
// win32: O_NOFOLLOW is 0, so the open follows a symlink, junction, or other reparse point.
// lstat and refuse those before the open. After the open, fstat the handle and require
// the same dev/ino as that lstat. Anything else fails closed.
//
// A test marks the fs object with Symbol.for('mythos.noFollowPlatform') = 'win32'
// to exercise this path where the process itself is not win32.
// An explicit platform argument wins over that mark, so a save can stay on the POSIX open.

import fs from 'fs';

const FILE_ATTRIBUTE_REPARSE_POINT = 0x400;
const PLATFORM_MARK = Symbol.for('mythos.noFollowPlatform');

export const NOFOLLOW_MISMATCH = 'ERR_NOFOLLOW_MISMATCH';

function errno(code: string, message: string): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

function closeQuiet(fsImpl: typeof fs, fd: number): void {
  try {
    fsImpl.closeSync(fd);
  } catch {
    /* the open is already being refused */
  }
}

function rawOpen(fsImpl: typeof fs, filePath: string, flags: number, mode?: fs.Mode): number {
  return mode === undefined ? fsImpl.openSync(filePath, flags) : fsImpl.openSync(filePath, flags, mode);
}

/** Symlink, junction, or any other reparse point. A regular file does not call readlink. */
export function isSymlinkOrReparse(st: fs.Stats, filePath: string, fsImpl: Pick<typeof fs, 'readlinkSync'>): boolean {
  if (st.isSymbolicLink()) return true;
  const attrs = (st as { fileAttributes?: number }).fileAttributes;
  if (typeof attrs === 'number' && (attrs & FILE_ATTRIBUTE_REPARSE_POINT) !== 0) return true;
  if (st.isFile()) return false;
  try {
    fsImpl.readlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function idsMatch(opened: fs.Stats, listed: fs.Stats): boolean {
  return opened.dev === listed.dev && opened.ino === listed.ino;
}

function platformOf(fsImpl: object, explicit?: NodeJS.Platform): NodeJS.Platform {
  if (explicit) return explicit;
  const marked = (fsImpl as Record<symbol, NodeJS.Platform | undefined>)[PLATFORM_MARK];
  if (marked === 'win32' || marked === 'linux' || marked === 'darwin') return marked;
  return process.platform;
}

function openWin32(fsImpl: typeof fs, filePath: string, flags: number, mode?: fs.Mode): number {
  const creat = fsImpl.constants?.O_CREAT ?? 0;
  const creating = creat !== 0 && (flags & creat) !== 0;
  let listed: fs.Stats | undefined;
  try {
    listed = fsImpl.lstatSync(filePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if ((code === 'ENOENT' || code === 'ENOTDIR') && creating) {
      const fd = rawOpen(fsImpl, filePath, flags, mode);
      try {
        const opened = fsImpl.fstatSync(fd);
        const after = fsImpl.lstatSync(filePath);
        if (isSymlinkOrReparse(after, filePath, fsImpl)) {
          throw errno('ELOOP', 'open refused a reparse point');
        }
        if (!idsMatch(opened, after)) throw errno(NOFOLLOW_MISMATCH, 'open handle did not match lstat');
        return fd;
      } catch (inner) {
        closeQuiet(fsImpl, fd);
        throw inner;
      }
    }
    throw err;
  }
  if (isSymlinkOrReparse(listed, filePath, fsImpl)) {
    throw errno('ELOOP', 'open refused a reparse point');
  }
  const fd = rawOpen(fsImpl, filePath, flags, mode);
  try {
    const opened = fsImpl.fstatSync(fd);
    if (!idsMatch(opened, listed)) throw errno(NOFOLLOW_MISMATCH, 'open handle did not match lstat');
    return fd;
  } catch (err) {
    closeQuiet(fsImpl, fd);
    throw err;
  }
}

/**
 * Open `filePath` for a no-follow caller.
 * `platform` defaults to the fs mark, then `process.platform`.
 */
export function openNoFollow(
  fsImpl: typeof fs,
  filePath: string,
  flags: number,
  mode?: fs.Mode,
  platform?: NodeJS.Platform,
): number {
  if (platformOf(fsImpl, platform) === 'win32') return openWin32(fsImpl, filePath, flags, mode);
  const noFollow = fsImpl.constants?.O_NOFOLLOW ?? 0;
  return rawOpen(fsImpl, filePath, flags | noFollow, mode);
}
