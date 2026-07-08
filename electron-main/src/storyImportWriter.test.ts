// Beta 3 M24: the settings "Import story" flow must write the same per-scene
// vault structure + manifest entries as the SKY-2971 onboarding docx import.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { writeImportedStoryToVault } from './storyImportWriter.js';
import { readManifest, writeManifest, defaultManifest } from './vault.js';
import { splitStoryMarkdown } from './storyImport.js';

let vaultRoot: string;
let manifestPath: string;

beforeEach(() => {
  vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'm24-story-writer-'));
  manifestPath = path.join(vaultRoot, 'manifest.json');
  writeManifest(manifestPath, defaultManifest(vaultRoot));
});
afterEach(() => {
  fs.rmSync(vaultRoot, { recursive: true, force: true });
});

describe('writeImportedStoryToVault', () => {
  it('writes scene files + manifest story with correct chapter/scene splits', () => {
    const md = [
      '# Part One',
      '## The Gate',
      '### Arrival',
      'Mira reached the gate.',
      '### The Toll',
      'The keeper demanded payment.',
      '# Part Two',
      '## The City',
      '### First Light',
      'The city woke slowly.',
    ].join('\n');
    const split = splitStoryMarkdown(md, 'The Last City');

    const written = writeImportedStoryToVault(vaultRoot, manifestPath, split);
    expect(written.storyTitle).toBe('The Last City');
    expect(written.chapterCount).toBe(2);
    expect(written.sceneCount).toBe(3);
    expect(written.firstScenePath).toBeTruthy();

    // Scene file exists on disk with the prose in it.
    const first = fs.readFileSync(path.join(vaultRoot, written.firstScenePath as string), 'utf-8');
    expect(first).toContain('Mira reached the gate.');

    // Manifest carries the story → chapters → scenes tree.
    const manifest = readManifest(manifestPath);
    const story = manifest.stories.find((s) => s.id === written.storyId);
    expect(story).toBeTruthy();
    expect(story?.chapters.map((c) => c.title)).toEqual([
      'Part One · The Gate',
      'Part Two · The City',
    ]);
    expect(story?.chapters[0].scenes.map((s) => s.title)).toEqual(['Arrival', 'The Toll']);
    expect(story?.chapters[0].scenes[0].path.endsWith('.md')).toBe(true);
  });

  it('handles a heading-less document as one chapter, one scene', () => {
    const split = splitStoryMarkdown('Only prose here.', 'Loose Pages');
    const written = writeImportedStoryToVault(vaultRoot, manifestPath, split);
    expect(written.chapterCount).toBe(1);
    expect(written.sceneCount).toBe(1);
    const manifest = readManifest(manifestPath);
    expect(manifest.stories.at(-1)?.title).toBe('Loose Pages');
  });
});
