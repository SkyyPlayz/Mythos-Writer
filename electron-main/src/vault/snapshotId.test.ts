// S3.0 L2 — suggestion snapshot ids are UUID v4 and the snapshot write is atomic.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { applyVaultWrite } from '../suggestionApply.js';
import type { DbSuggestion } from '../db.js';

const dirs: string[] = [];

function vault(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-snap-'));
  dirs.push(root);
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ stories: [], scenes: [], entities: [] }));
  const note = path.join(root, 'entities', 'characters');
  fs.mkdirSync(note, { recursive: true });
  fs.writeFileSync(path.join(note, 'Hero.md'), 'original');
  return root;
}

function row(id: string): DbSuggestion {
  return {
    id,
    source_agent: 'writing-assistant',
    confidence: 0.9,
    rationale: 'snapshot id',
    target_kind: 'vault',
    target_path: 'entities/characters/Hero.md',
    target_anchor: null,
    payload_json: JSON.stringify({ content: 'updated\n' }),
    status: 'proposed',
    created_at: new Date().toISOString(),
    applied_at: null,
    applied_run_id: null,
    budget_exceeded: 0,
    category: null,
  };
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('snapshotId (S3.0 L2)', () => {
  it.each(['../x', 'a/b', '', '4a1b0c2d-e3f4-4123-8abc-1234567890abX', '4A1B0C2D-E3F4-4123-8ABC-1234567890AB'])(
    'rejects %j',
    (id) => {
      const root = vault();
      const before = fs.readFileSync(path.join(root, 'entities/characters/Hero.md'), 'utf8');
      const result = applyVaultWrite(row(id), root, new Date().toISOString());
      expect(result.ok).toBe(false);
      expect(fs.readFileSync(path.join(root, 'entities/characters/Hero.md'), 'utf8')).toBe(before);
      expect(fs.existsSync(path.join(root, '.mythos', 'suggestion-snapshots'))).toBe(false);
    },
  );

  it('writes a valid id atomically', () => {
    const root = vault();
    const id = '4a1b0c2d-e3f4-4123-8abc-1234567890ab';
    const result = applyVaultWrite(row(id), root, new Date().toISOString());
    if (!result.ok) throw new Error(result.reason);
    const snap = path.join(root, result.snapshotPath!);
    expect(fs.existsSync(snap)).toBe(true);
    expect(JSON.parse(fs.readFileSync(snap, 'utf8')).originalContent).toBe('original');
    const leftovers = fs.readdirSync(path.dirname(snap)).filter((name) => name.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });
});
