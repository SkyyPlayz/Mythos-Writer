// S3.1 — a closed note whose bytes changed is a typed stale error, and pre-images keep the last five.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { sha256Text } from './artifactSchema.js';
import { restorePreimage, StaleNoteError, writeBack } from './artifactWriteBack.js';

const dirs: string[] = [];
const ARTIFACT = '4a1b0c2d-e3f4-4123-8abc-1234567890ab';

function vault(text: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-stale-'));
  dirs.push(root);
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ stories: [], scenes: [], entities: [] }));
  const noteDir = path.join(root, 'entities', 'characters');
  fs.mkdirSync(noteDir, { recursive: true });
  fs.writeFileSync(path.join(noteDir, 'Hero.md'), text);
  return root;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('artifact write-back stale note (S3.1)', () => {
  it('returns StaleNoteError and leaves the file unchanged', () => {
    const root = vault('original');
    const note = path.join(root, 'entities/characters/Hero.md');
    fs.writeFileSync(note, 'someone else edited');
    const result = writeBack({
      artifactId: ARTIFACT,
      vaultRoot: root,
      targetPath: 'entities/characters/Hero.md',
      kind: 'note',
      boundSha256: sha256Text('original'),
      content: 'artifact text',
      origin: 'user',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('stale_note');
    expect(result.error).toBeInstanceOf(StaleNoteError);
    expect(result.error?.message).toBe('note changed, re-bind');
    expect(fs.readFileSync(note, 'utf8')).toBe('someone else edited');
  });

  it('stores a restorable pre-image and keeps only the last five', () => {
    const root = vault('v0');
    let current = 'v0';
    let lastPreimage = '';
    for (let i = 1; i <= 6; i += 1) {
      const next = `v${i}`;
      const result = writeBack({
        artifactId: ARTIFACT,
        vaultRoot: root,
        targetPath: 'entities/characters/Hero.md',
        kind: 'note',
        boundSha256: sha256Text(current),
        content: next,
        origin: 'user',
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.via === 'file') {
        expect(restorePreimage(result.preimage)).toBe(current);
        lastPreimage = result.preimage;
      }
      current = next;
    }
    const dir = path.join(root, '.mythos', 'artifacts', 'preimage', ARTIFACT);
    expect(fs.readdirSync(dir)).toHaveLength(5);
    expect(fs.readFileSync(path.join(root, 'entities/characters/Hero.md'), 'utf8')).toBe('v6');
    expect(restorePreimage(lastPreimage)).toBe('v5');
  });

  it('does not write the file when the editor is open', () => {
    const root = vault('original');
    const result = writeBack({
      artifactId: ARTIFACT,
      vaultRoot: root,
      targetPath: 'entities/characters/Hero.md',
      kind: 'note',
      boundSha256: sha256Text('original'),
      content: 'from the artifact',
      origin: 'user',
      editorOpen: true,
    });
    expect(result).toEqual({ ok: true, via: 'editor', content: 'from the artifact' });
    expect(fs.readFileSync(path.join(root, 'entities/characters/Hero.md'), 'utf8')).toBe('original');
  });
});
