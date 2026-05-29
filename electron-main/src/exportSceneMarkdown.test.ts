// Unit tests for SCENE_EXPORT_MARKDOWN handler logic (SKY-138)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { defaultManifest, writeManifest, writeSceneFile, writeFileAtomic, readSceneFile } from './vault.js';
import type { Manifest, SceneEntry } from './ipc.js';

function makeManifest(tmpDir: string): { manifest: Manifest; scene: SceneEntry } {
  const manifest = defaultManifest(tmpDir);
  const now = new Date().toISOString();
  const scene: SceneEntry = {
    id: 'scene-export-001', title: 'The Dark Forest',
    path: 'Manuscript/story-one/chapter-one/dark-forest.md',
    order: 0, chapterId: 'ch-001', storyId: 'story-001', blocks: [], createdAt: now, updatedAt: now,
  };
  manifest.stories.push({
    id: 'story-001', title: 'My Story', path: 'Manuscript/story-one',
    chapters: [{ id: 'ch-001', title: 'Chapter One', path: 'Manuscript/story-one/chapter-one', order: 0, scenes: [scene], createdAt: now, updatedAt: now }],
    createdAt: now, updatedAt: now,
  });
  fs.mkdirSync(path.join(tmpDir, 'Manuscript/story-one/chapter-one'), { recursive: true });
  writeSceneFile(tmpDir, scene.path, { id: scene.id, title: scene.title, chapterId: scene.chapterId, storyId: scene.storyId, order: scene.order, prose: 'Once upon a time in a dark forest.' });
  return { manifest, scene };
}

function exportLogic(vaultRoot: string, manifest: Manifest, sceneId: string, exportPath: string) {
  let found: SceneEntry | null = null;
  outer: for (const story of manifest.stories) {
    for (const chapter of story.chapters) {
      const scene = chapter.scenes.find((s) => s.id === sceneId);
      if (scene) { found = scene; break outer; }
    }
  }
  if (!found) found = manifest.scenes.find((s) => s.id === sceneId) ?? null;
  if (!found) throw new Error(`Scene not found: ${sceneId}`);
  let prose = '';
  try { prose = readSceneFile(vaultRoot, found.path).prose; } catch { /* missing */ }
  writeFileAtomic(exportPath, prose);
  return { path: exportPath, cancelled: false };
}

describe('SCENE_EXPORT_MARKDOWN handler logic', () => {
  let tmpDir: string; let manifest: Manifest; let scene: SceneEntry;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-export-scene-'));
    ({ manifest, scene } = makeManifest(tmpDir));
    writeManifest(path.join(tmpDir, 'manifest.json'), manifest);
  });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('exports prose to the target path', () => {
    const r = exportLogic(tmpDir, manifest, scene.id, path.join(tmpDir, 'out.md'));
    expect(r.cancelled).toBe(false);
    expect(fs.readFileSync(r.path!, 'utf-8')).toBe('Once upon a time in a dark forest.');
  });

  it('exports only prose — no YAML frontmatter', () => {
    const r = exportLogic(tmpDir, manifest, scene.id, path.join(tmpDir, 'out.md'));
    const txt = fs.readFileSync(r.path!, 'utf-8');
    expect(txt).not.toContain('---');
    expect(txt).not.toContain('id:');
  });

  it('throws for unknown scene id', () => {
    expect(() => exportLogic(tmpDir, manifest, 'bad-id', path.join(tmpDir, 'x.md')))
      .toThrow('Scene not found: bad-id');
  });

  it('exports empty string when scene file missing', () => {
    fs.unlinkSync(path.join(tmpDir, scene.path));
    const r = exportLogic(tmpDir, manifest, scene.id, path.join(tmpDir, 'out.md'));
    expect(fs.readFileSync(r.path!, 'utf-8')).toBe('');
  });

  it('finds scene in legacy flat scenes list', () => {
    const flat: Manifest = { ...manifest, stories: [] };
    flat.scenes = [scene];
    const r = exportLogic(tmpDir, flat, scene.id, path.join(tmpDir, 'out.md'));
    expect(fs.readFileSync(r.path!, 'utf-8')).toBe('Once upon a time in a dark forest.');
  });
});
