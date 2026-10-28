// S3.1 — the artifacts tree may not call filesystem write APIs. Cleanup is the only rename/delete.
import { execFileSync } from 'node:child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ARTIFACTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const LINT = path.resolve(ARTIFACTS, '../../../scripts/lint-artifacts-fs.mjs');

function run(dir: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [LINT, dir], { encoding: 'utf8' });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const error = err as { status?: number; stdout?: string; stderr?: string };
    return { status: error.status ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

describe('artifacts filesystem lint (S3.1)', () => {
  it('passes on electron-main/src/artifacts', () => {
    expect(run(ARTIFACTS).status).toBe(0);
  });

  it('fails a file that calls fs.writeFileSync', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-fs-lint-'));
    try {
      fs.writeFileSync(path.join(dir, 'bad.ts'), "import fs from 'fs';\nfs.writeFileSync('x', 'y');\n");
      const result = run(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('writeFileSync');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
