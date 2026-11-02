// Fail-closed read of a file that must live inside the userData directory.
// realpath the file, require the resolved path to sit inside realpath(userData),
// open that path without following a link, and read the same fd.
// Any error denies the read.

import fs from 'fs';

import { openNoFollow } from '../vault/noFollowOpen.js';
import { isResolvedPathInsideRoot } from '../vault/safeVaultJoin.js';

function readFd(fsImpl: typeof fs, fd: number, size: number): Buffer {
  const buf = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const n = fsImpl.readSync(fd, buf, offset, size - offset, offset);
    if (n === 0) break;
    offset += n;
  }
  return buf.subarray(0, offset);
}

export type UserDataRead =
  | { status: 'absent' }
  | { status: 'denied' }
  | { status: 'ok'; data: Buffer };

export function readUserDataFile(
  absPath: string,
  userDataDir: string,
  fsImpl: typeof fs = fs,
): UserDataRead {
  try {
    fsImpl.lstatSync(absPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { status: 'absent' };
    return { status: 'denied' };
  }
  let fd: number | undefined;
  try {
    const resolved = fsImpl.realpathSync.native(absPath);
    const root = fsImpl.realpathSync.native(userDataDir);
    if (!isResolvedPathInsideRoot(root, resolved)) return { status: 'denied' };
    const listed = fsImpl.lstatSync(resolved);
    if (!listed.isFile()) return { status: 'denied' };
    fd = openNoFollow(fsImpl, resolved, fsImpl.constants.O_RDONLY);
    const opened = fsImpl.fstatSync(fd);
    if (!opened.isFile()) return { status: 'denied' };
    if (opened.dev !== listed.dev || opened.ino !== listed.ino) return { status: 'denied' };
    return { status: 'ok', data: readFd(fsImpl, fd, opened.size) };
  } catch {
    return { status: 'denied' };
  } finally {
    if (fd !== undefined) {
      try {
        fsImpl.closeSync(fd);
      } catch {
        /* the read result is already decided */
      }
    }
  }
}
