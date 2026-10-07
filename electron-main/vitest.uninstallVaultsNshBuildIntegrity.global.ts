import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function canonicalBuildPath(): string {
  return resolve(process.cwd(), '../build/uninstall-vaults.nsh');
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

export default function setup(): () => void {
  const buildPath = canonicalBuildPath();
  if (!existsSync(buildPath)) {
    return () => {};
  }

  const before = sha256File(buildPath);

  return () => {
    const after = sha256File(buildPath);
    if (after !== before) {
      throw new Error(
        'build/uninstall-vaults.nsh was mutated during the electron-main test run (integrity guard). ' +
          'On-disk mutant tests must use MYTHOS_UNINSTALL_VAULTS_NSH_PATH with a temp copy only.',
      );
    }
  };
}
