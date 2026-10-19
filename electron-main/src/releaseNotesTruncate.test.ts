import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const releasePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../.github/workflows/release.yml',
);

function extractRun(source: string, step: string): string {
  const idx = source.indexOf(`- name: ${step}`);
  if (idx < 0) throw new Error(`missing step ${step}`);
  const marker = '\n        run: |\n';
  const run = source.indexOf(marker, idx);
  if (run < 0) throw new Error(`missing run ${step}`);
  const lines: string[] = [];
  for (const line of source.slice(run + marker.length).split('\n')) {
    if (line.startsWith('      - ') || /^  \S/.test(line)) break;
    lines.push(line.startsWith('          ') ? line.slice(10) : line);
  }
  return lines.join('\n').replace(/\n+$/, '\n');
}

function runNotes(scriptText: string, subject: string): { status: number | null; notes: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'notes-trunc-'));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Proof',
    GIT_AUTHOR_EMAIL: 'proof@example.com',
    GIT_COMMITTER_NAME: 'Proof',
    GIT_COMMITTER_EMAIL: 'proof@example.com',
  };
  execFileSync('git', ['init'], { cwd: dir, env });
  writeFileSync(path.join(dir, 'file.txt'), `${subject}\n`);
  execFileSync('git', ['add', 'file.txt'], { cwd: dir, env });
  const messageFile = path.join(dir, 'COMMIT_MSG');
  writeFileSync(messageFile, subject.endsWith('\n') ? subject : `${subject}\n`);
  execFileSync('git', ['commit', '-F', messageFile], { cwd: dir, env });
  const runner = path.join(dir, 'runner');
  mkdirSync(runner);
  const script = path.join(dir, 'notes.sh');
  writeFileSync(script, scriptText);
  chmodSync(script, 0o755);
  const result = spawnSync('bash', [script], {
    cwd: dir,
    env: { ...env, TAG: 'v9.9.9', RUNNER_TEMP: runner, GITHUB_OUTPUT: path.join(dir, 'out.txt') },
    encoding: 'utf8',
  });
  const notesPath = path.join(runner, 'notes.md');
  const notes = result.status === 0 ? readFileSync(notesPath, 'utf8') : '';
  return { status: result.status, notes };
}

describe('publish-release notes truncation', () => {
  const release = readFileSync(releasePath, 'utf8');
  const notesRun = extractRun(release, 'Generate release notes');
  const editRun = extractRun(release, 'Update release with notes (keep as draft)');
  const subject = 'A'.repeat(200000);

  it('writes a 200k changelog through --notes-file without a head pipe', () => {
    expect(notesRun.includes('${{')).toBe(false);
    expect(notesRun.includes('| head -c')).toBe(false);
    expect(editRun.includes('--notes-file')).toBe(true);
    expect(editRun.includes('--draft')).toBe(true);
    const fixed = runNotes(notesRun, subject);
    expect(fixed.status).toBe(0);
    expect(fixed.notes.includes('more commits')).toBe(true);
    expect(fixed.notes.includes('A'.repeat(130000))).toBe(false);
  });

  it('the previous printf | head -c truncation exits 141 on that changelog', () => {
    const oldPipe = notesRun.replace(
      'TRUNCATED=${CHANGELOG:0:MAX_CHARS}',
      "TRUNCATED=$(printf '%s' \"$CHANGELOG\" | head -c \"$MAX_CHARS\")",
    );
    expect(oldPipe.includes('| head -c')).toBe(true);
    const before = runNotes(oldPipe, subject);
    expect(before.status).toBe(141);
  });
});
