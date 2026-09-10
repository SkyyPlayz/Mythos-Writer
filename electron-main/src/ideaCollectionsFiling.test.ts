// SKY-11192/SKY-11674 §3: unit coverage for Idea Collections filing — the
// fixed category→folder mapping, idempotent already-filed detection scoped
// to the target folder, silent folder creation, and undo. Real filesystem
// via fs.mkdtempSync, matching notesBoard.test.ts's pattern.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileIdea, unfileIdea, findFiledNote, IDEA_COLLECTION_FOLDER } from './ideaCollectionsFiling.js';

describe('ideaCollectionsFiling', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-ideacoll-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('maps every category to its fixed folder (§3 table)', () => {
    expect(IDEA_COLLECTION_FOLDER).toEqual({
      beats: 'Plot & Story',
      theme: 'Plot & Story',
      trope: 'Plot & Story',
      loose: 'Plot & Story',
      rel: 'Characters',
      world: 'Worldbuilding',
    });
  });

  it('files a new idea as a real note in the mapped folder', () => {
    const result = fileIdea({ notesVaultRoot: root, category: 'rel', title: 'Rivals to Allies', desc: 'They hate each other at first.' });
    expect(result).toEqual({ status: 'filed', folderPath: 'Characters', itemPath: 'Rivals to Allies.md' });
    const written = fs.readFileSync(path.join(root, 'Characters', 'Rivals to Allies.md'), 'utf-8');
    expect(written).toContain('# Rivals to Allies');
    expect(written).toContain('They hate each other at first.');
  });

  it('creates the target folder silently when it does not exist', () => {
    expect(fs.existsSync(path.join(root, 'Worldbuilding'))).toBe(false);
    fileIdea({ notesVaultRoot: root, category: 'world', title: 'A Sky Made of Glass', desc: '' });
    expect(fs.statSync(path.join(root, 'Worldbuilding')).isDirectory()).toBe(true);
  });

  it('is idempotent: filing the same title twice returns already-filed, does not overwrite', () => {
    fileIdea({ notesVaultRoot: root, category: 'beats', title: 'Midpoint Reversal', desc: 'original' });
    const second = fileIdea({ notesVaultRoot: root, category: 'beats', title: 'Midpoint Reversal', desc: 'different text' });
    expect(second).toEqual({ status: 'already-filed', folderPath: 'Plot & Story', itemPath: 'Midpoint Reversal.md' });
    const content = fs.readFileSync(path.join(root, 'Plot & Story', 'Midpoint Reversal.md'), 'utf-8');
    expect(content).toContain('original');
    expect(content).not.toContain('different text');
  });

  it('detects a hand-created note with a matching name as already-filed (§3)', () => {
    fs.mkdirSync(path.join(root, 'Plot & Story'), { recursive: true });
    fs.writeFileSync(path.join(root, 'Plot & Story', 'The Ticking Clock.md'), '# hand-written\n', 'utf-8');
    const result = fileIdea({ notesVaultRoot: root, category: 'theme', title: 'The Ticking Clock', desc: 'agent suggestion' });
    expect(result.status).toBe('already-filed');
  });

  it('matching is scoped to the target folder only, not the whole vault', () => {
    fs.mkdirSync(path.join(root, 'Characters'), { recursive: true });
    fs.writeFileSync(path.join(root, 'Characters', 'Enemies to Allies.md'), '# elsewhere\n', 'utf-8');
    // Same title, different category → different folder (Plot & Story) — must NOT be blocked.
    const result = fileIdea({ notesVaultRoot: root, category: 'trope', title: 'Enemies to Allies', desc: '' });
    expect(result.status).toBe('filed');
  });

  it('a rename away from the matching name un-blocks the idea (re-runs on every call, no cache)', () => {
    fileIdea({ notesVaultRoot: root, category: 'loose', title: 'A letter delivered 20 years late', desc: '' });
    fs.renameSync(
      path.join(root, 'Plot & Story', 'A letter delivered 20 years late.md'),
      path.join(root, 'Plot & Story', 'renamed.md'),
    );
    const found = findFiledNote(root, 'Plot & Story', 'A letter delivered 20 years late');
    expect(found).toBeNull();
  });

  it('unfileIdea deletes the just-filed note', () => {
    const filed = fileIdea({ notesVaultRoot: root, category: 'rel', title: 'A Trusted Ally Turns', desc: '' });
    expect(filed.status).toBe('filed');
    const abs = path.join(root, 'Characters', 'A Trusted Ally Turns.md');
    expect(fs.existsSync(abs)).toBe(true);
    const undone = unfileIdea(root, 'rel', 'A Trusted Ally Turns.md');
    expect(undone).toEqual({ deleted: true });
    expect(fs.existsSync(abs)).toBe(false);
  });

  it('sanitizes a title into a filesystem-safe filename', () => {
    const result = fileIdea({ notesVaultRoot: root, category: 'world', title: 'Who: what? / really', desc: '' });
    expect(result.status).toBe('filed');
    if (result.status === 'filed') {
      expect(result.itemPath).not.toMatch(/[/:*?"<>|]/);
    }
  });
});
