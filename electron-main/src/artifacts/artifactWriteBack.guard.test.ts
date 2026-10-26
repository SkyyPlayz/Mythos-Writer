// S3.1 — write-back allowlist, link refusal, fail-closed, and the flag-off zero-write gate.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { clearArtifactAudit, listArtifactAudit } from './artifactAudit.js';
import { ARTIFACTS_ENGINE, ARTIFACTS_WRITE_BACK_EXTENDED, sha256Text } from './artifactSchema.js';
import { handleArtifactRefresh, handleArtifactSave, handleArtifactSharePrompt, handleArtifactWriteBack } from './artifactStore.js';
import { writeBack } from './artifactWriteBack.js';

const dirs: string[] = [];
const ARTIFACT = '4a1b0c2d-e3f4-4123-8abc-1234567890ab';
const VAULT_ID = '4a1b0c2d-e3f4-4123-8abc-1234567890c0';

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function vault(): string {
  const root = tmp('mythos-wb-');
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ stories: [], scenes: [], entities: [] }));
  const noteDir = path.join(root, 'entities', 'characters');
  fs.mkdirSync(noteDir, { recursive: true });
  fs.writeFileSync(path.join(noteDir, 'Hero.md'), 'original');
  return root;
}

function input(root: string, over: Partial<Parameters<typeof writeBack>[0]> = {}) {
  return {
    artifactId: ARTIFACT,
    vaultRoot: root,
    targetPath: 'entities/characters/Hero.md',
    kind: 'note' as const,
    boundSha256: sha256Text('original'),
    content: 'updated',
    origin: 'user' as const,
    ...over,
  };
}

afterEach(() => {
  clearArtifactAudit();
  vi.restoreAllMocks();
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('artifact write-back guard (S3.1)', () => {
  it('keeps both 0.5.9 flags off', () => {
    expect(ARTIFACTS_ENGINE).toBe(false);
    expect(ARTIFACTS_WRITE_BACK_EXTENDED).toBe(false);
  });

  it.each(['scene', 'manuscript', 'unknown'] as const)('refuses kind %s', (kind) => {
    const root = vault();
    const result = writeBack(input(root, { kind }));
    expect(result).toMatchObject({ ok: false, reason: 'kind' });
    expect(fs.readFileSync(path.join(root, 'entities/characters/Hero.md'), 'utf8')).toBe('original');
  });

  it('writes a note and refuses codex and metric until the extended flag is on', () => {
    const root = vault();
    const note = writeBack(input(root));
    expect(note.ok).toBe(true);
    expect(fs.readFileSync(path.join(root, 'entities/characters/Hero.md'), 'utf8')).toBe('updated');

    const codexRoot = vault();
    expect(writeBack(input(codexRoot, { kind: 'codex' }))).toMatchObject({ ok: false, reason: 'kind' });
    expect(writeBack(input(codexRoot, { kind: 'metric' }))).toMatchObject({ ok: false, reason: 'kind' });
    expect(fs.readFileSync(path.join(codexRoot, 'entities/characters/Hero.md'), 'utf8')).toBe('original');

    const extended = vault();
    const codex = writeBack(input(extended, { kind: 'codex', extended: true }));
    expect(codex.ok).toBe(true);
  });

  it('refuses a path that climbs out of the vault', () => {
    const root = vault();
    const outside = tmp('mythos-wb-out-');
    const secret = path.join(outside, 'secret.txt');
    fs.writeFileSync(secret, 'untouched');
    const result = writeBack(input(root, { targetPath: '../secret.txt', content: 'pwned' }));
    expect(result).toMatchObject({ ok: false, reason: 'path' });
    expect(fs.readFileSync(secret, 'utf8')).toBe('untouched');
  });

  it('refuses a symlink and leaves the outside file unchanged', () => {
    const root = vault();
    const outside = tmp('mythos-wb-sym-');
    const secret = path.join(outside, 'secret.txt');
    fs.writeFileSync(secret, 'untouched');
    const note = path.join(root, 'entities/characters/Hero.md');
    fs.unlinkSync(note);
    fs.symlinkSync(secret, note);
    const result = writeBack(input(root, { content: 'pwned' }));
    expect(result.ok).toBe(false);
    expect(fs.readFileSync(secret, 'utf8')).toBe('untouched');
  });

  it('refuses a hardlink', () => {
    const root = vault();
    const note = path.join(root, 'entities/characters/Hero.md');
    const alias = path.join(root, 'entities/characters/Alias.md');
    fs.linkSync(note, alias);
    const result = writeBack(input(root, { content: 'pwned' }));
    expect(result.ok).toBe(false);
    expect(fs.readFileSync(note, 'utf8')).toBe('original');
    expect(fs.readFileSync(alias, 'utf8')).toBe('original');
  });

  it('fails closed when the note read throws and records no content or raw path', () => {
    const root = vault();
    const note = path.join(root, 'entities/characters/Hero.md');
    const real = fs.readFileSync;
    vi.spyOn(fs, 'readFileSync').mockImplementation(((p: fs.PathOrFileDescriptor, ...args: unknown[]) => {
      if (String(p) === note) {
        const err = new Error('EIO') as NodeJS.ErrnoException;
        err.code = 'EIO';
        throw err;
      }
      return real.call(fs, p, ...(args as [BufferEncoding?]));
    }) as typeof fs.readFileSync);
    const result = writeBack(input(root, { content: 'pwned-secret' }));
    vi.restoreAllMocks();
    expect(result).toMatchObject({ ok: false, reason: 'fail_closed' });
    expect(fs.readFileSync(note, 'utf8')).toBe('original');
    const audit = JSON.stringify(listArtifactAudit());
    expect(audit).not.toContain('pwned-secret');
    expect(audit).not.toContain('original');
    expect(audit).not.toContain('entities/characters/Hero.md');
    expect(audit).not.toContain(note);
    expect(listArtifactAudit().some((row) => row.reason === 'fail_closed' && row.pathHash === sha256Text('entities/characters/Hero.md'))).toBe(true);
  });

  it('makes zero writes when the engine flag and the owner gate are off', () => {
    const root = vault();
    const userData = tmp('mythos-wb-user-');
    fs.writeFileSync(path.join(userData, 'app-settings.json'), '{}');
    fs.writeFileSync(path.join(userData, 'layoutV3.json'), '{}');
    const edit = { type: 'edit', artifactId: ARTIFACT, origin: 'user', text: 'nope' };
    expect(handleArtifactSave({
      artifactId: ARTIFACT,
      origin: 'user',
      body: 'nope',
      vaultRoot: root,
      userData,
      vaultId: VAULT_ID,
    })).toMatchObject({ ok: false, reason: 'flag_off' });
    expect(handleArtifactWriteBack({
      ...edit,
      kind: 'note',
      vaultRoot: root,
      targetPath: 'entities/characters/Hero.md',
      boundSha256: sha256Text('original'),
    })).toMatchObject({ ok: false, reason: 'flag_off' });
    expect(handleArtifactRefresh({ artifactId: ARTIFACT, outputTokens: 1, usage: { used: 0, cap: 10 }, proposal: 'x' })).toMatchObject({ ok: false, error: 'flag_off' });
    expect(handleArtifactSharePrompt({ body: 'hello', dataSchema: {} })).toMatchObject({ ok: false, error: 'flag_off' });
    expect(fs.existsSync(path.join(root, '.mythos', 'artifacts'))).toBe(false);
    expect(fs.existsSync(path.join(userData, 'artifacts'))).toBe(false);
    expect(fs.readFileSync(path.join(userData, 'app-settings.json'), 'utf8')).toBe('{}');
    expect(fs.readFileSync(path.join(userData, 'layoutV3.json'), 'utf8')).toBe('{}');
    expect(fs.readFileSync(path.join(root, 'entities/characters/Hero.md'), 'utf8')).toBe('original');
  });
});
