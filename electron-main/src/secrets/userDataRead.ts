// Fail-closed read of a file that must live inside the userData directory.
// realpath the file, require the resolved path to sit inside realpath(userData),
// then read only that resolved path. Any error denies the read.

import fs from 'fs';

import { isResolvedPathInsideRoot } from '../vault/safeVaultJoin.js';

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
  try {
    const resolved = fsImpl.realpathSync.native(absPath);
    const root = fsImpl.realpathSync.native(userDataDir);
    if (!isResolvedPathInsideRoot(root, resolved)) return { status: 'denied' };
    return { status: 'ok', data: fsImpl.readFileSync(resolved) };
  } catch {
    return { status: 'denied' };
  }
}
