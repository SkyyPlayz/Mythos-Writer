// SKY-3026: Unit tests for outline:load and outline:save handler logic.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadOutline, saveOutline } from './outline.js';
import type { OutlineData } from './outline.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-outline-'));
}

function cleanDir(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

const sampleData: OutlineData = {
  storyId: 'story-1',
  schemaVersion: 1,
  nodes: [
    {
      id: 'node-1',
      title: 'Act I',
      notes: 'Setup and inciting incident',
      children: [
        { id: 'node-2', title: 'Opening Scene', children: [] },
      ],
    },
  ],
};

// ─── loadOutline ──────────────────────────────────────────────────────────────

describe('loadOutline', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { cleanDir(tmpDir); });

  it('returns null when outline-nodes.json is absent (AC-OPL-BE-01)', () => {
    expect(loadOutline(tmpDir)).toBeNull();
  });

  it('returns null for a directory that does not exist', () => {
    const nonexistent = path.join(tmpDir, 'no-such-story');
    expect(loadOutline(nonexistent)).toBeNull();
  });

  it('returns null when outline-nodes.json contains malformed JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'outline-nodes.json'), '{bad json', 'utf-8');
    expect(loadOutline(tmpDir)).toBeNull();
  });
});

// ─── saveOutline + loadOutline round-trip ────────────────────────────────────

describe('saveOutline + loadOutline', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { cleanDir(tmpDir); });

  it('persists and restores data exactly (AC-OPL-BE-02)', () => {
    saveOutline(tmpDir, sampleData);
    const loaded = loadOutline(tmpDir);
    expect(loaded).toEqual(sampleData);
  });

  it('writes valid JSON to outline-nodes.json', () => {
    saveOutline(tmpDir, sampleData);
    const raw = fs.readFileSync(path.join(tmpDir, 'outline-nodes.json'), 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(JSON.parse(raw)).toEqual(sampleData);
  });

  it('overwrites existing data on a second save', () => {
    saveOutline(tmpDir, sampleData);
    const updated: OutlineData = { storyId: 'story-1', schemaVersion: 1, nodes: [] };
    saveOutline(tmpDir, updated);
    expect(loadOutline(tmpDir)).toEqual(updated);
  });

  it('handles deeply nested OutlineNode children', () => {
    const deep: OutlineData = {
      storyId: 'story-deep',
      schemaVersion: 1,
      nodes: [{
        id: 'l1', title: 'Level 1', children: [{
          id: 'l2', title: 'Level 2', children: [{
            id: 'l3', title: 'Level 3', children: [],
          }],
        }],
      }],
    };
    saveOutline(tmpDir, deep);
    expect(loadOutline(tmpDir)).toEqual(deep);
  });

  it('round-trips optional fields: notes and linkedSceneId', () => {
    const withOptional: OutlineData = {
      storyId: 'story-opts',
      schemaVersion: 1,
      nodes: [{
        id: 'n1',
        title: 'Chapter One',
        notes: 'Detailed planning notes',
        linkedSceneId: 'scene-abc-123',
        children: [],
      }],
    };
    saveOutline(tmpDir, withOptional);
    const result = loadOutline(tmpDir);
    expect(result?.nodes[0].notes).toBe('Detailed planning notes');
    expect(result?.nodes[0].linkedSceneId).toBe('scene-abc-123');
  });

  it('leaves no .tmp file after a successful save', () => {
    saveOutline(tmpDir, sampleData);
    const tmpFile = path.join(tmpDir, 'outline-nodes.json.tmp');
    expect(fs.existsSync(tmpFile)).toBe(false);
  });
});
