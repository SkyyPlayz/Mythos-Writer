// SKY-6596 (PR #932 review) — block-aware structure-only persistence,
// end-to-end at the vault layer. The review-blocking corruption: writing a
// multi-block scene's manifest blanked EVERY block's content, and reading it
// back dumped the whole raw `.md` body (markers included) into the first
// prose block. These tests pin the fix: stripSceneProse records per-block
// segment boundaries (`bodySegLen`), and readManifest slices the body back
// across all N blocks — content, types, ids, and order intact — falling back
// to whole-body-in-first-prose (with one console.warn, never a throw) on any
// inconsistency.
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openManifest } from './manifest.js';
import {
  defaultManifest,
  ensureSceneFilesForManifestScenes,
  readManifest,
  readSceneFile,
  writeManifest,
  writeSceneFile,
} from './vault.js';
import { blocksToMarkdownBody } from './sceneBody.js';
import type { Manifest, SceneEntry, BlockEntry } from './ipc.js';

const NOW = '2026-07-15T00:00:00.000Z';

function block(id: string, type: BlockEntry['type'], order: number, content: string): BlockEntry {
  return { id, type, order, content, updatedAt: NOW };
}

function scene(id: string, relPath: string, blocks: BlockEntry[]): SceneEntry {
  return {
    id,
    title: `Scene ${id}`,
    path: relPath,
    order: 0,
    blocks,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/** Write the scene the way the real save path does: the `.md` body is the
 * frontend serializer's output over the blocks (scene:save writes it
 * verbatim), and the manifest carries the hydrated block objects. */
function writeSceneAndManifest(vaultRoot: string, sc: SceneEntry): string {
  writeSceneFile(vaultRoot, sc.path, {
    id: sc.id,
    title: sc.title,
    prose: blocksToMarkdownBody(sc.blocks),
  });
  const manifestPath = path.join(vaultRoot, 'manifest.json');
  const manifest: Manifest = { ...defaultManifest(vaultRoot), scenes: [sc] };
  writeManifest(manifestPath, manifest);
  return manifestPath;
}

function bumpMtime(filePath: string): void {
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(filePath, future, future);
}

describe('multi-block scene round-trip (PR #932 review blocker)', () => {
  let tmpDir: string;
  let warnSpy: MockInstance;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-blockrt-'));
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('[heading, prose, dialogue] → writeManifest → readManifest: all three blocks intact (content, type, id, order)', () => {
    const blocks = [
      block('b-h', 'heading', 0, '## The Old Mill'),
      block('b-p', 'prose', 1, 'Rain fell on the tin roof.'),
      block('b-d', 'dialogue', 2, 'We should not be here.'),
    ];
    const manifestPath = writeSceneAndManifest(tmpDir, scene('sc-multi', 'multi.md', blocks));

    const read = readManifest(manifestPath);
    const got = read.scenes[0].blocks;
    expect(got).toHaveLength(3);
    expect(got.map((b) => b.id)).toEqual(['b-h', 'b-p', 'b-d']);
    expect(got.map((b) => b.type)).toEqual(['heading', 'prose', 'dialogue']);
    expect(got.map((b) => b.order)).toEqual([0, 1, 2]);
    expect(got.map((b) => b.content)).toEqual([
      '## The Old Mill',
      'Rain fell on the tin roof.',
      'We should not be here.',
    ]);
    // Hydration must be quiet on the happy path…
    expect(warnSpy).not.toHaveBeenCalled();
    // …and the persistence metadata must never leak onto the IPC shape.
    expect(got.every((b) => !('bodySegLen' in b))).toBe(true);
  });

  it('the on-disk manifest stays structure-only: blanked content + per-block boundary metadata', () => {
    const blocks = [
      block('b-h', 'heading', 0, '## The Old Mill'),
      block('b-p', 'prose', 1, 'Rain fell on the tin roof.'),
      block('b-d', 'dialogue', 2, 'We should not be here.'),
    ];
    const manifestPath = writeSceneAndManifest(tmpDir, scene('sc-disk', 'disk.md', blocks));

    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Manifest;
    const onDisk = raw.scenes[0].blocks;
    expect(onDisk.map((b) => b.content)).toEqual(['', '', '']);
    // '## The Old Mill' (15), 'Rain fell on the tin roof.' (26),
    // '> We should not be here.' (2 + 22).
    expect(onDisk.map((b) => b.bodySegLen)).toEqual([15, 26, 24]);
  });

  it('SKY-6196: a manifest arriving with content already blanked (renderer-computed bodySegLen) round-trips exactly like a full-content write', () => {
    // Simulates frontend/src/manifestIpc.ts stripManifestContentForIpc: the
    // renderer now blanks blocks[].content and computes bodySegLen itself
    // before the manifest crosses vault:manifest:write. stripSceneProse must
    // trust that pre-computed bodySegLen rather than recomputing from (now
    // blank) content, which would erase it and corrupt hydration.
    const fullBlocks = [
      block('b-h', 'heading', 0, '## The Old Mill'),
      block('b-p', 'prose', 1, 'Rain fell on the tin roof.'),
      block('b-d', 'dialogue', 2, 'We should not be here.'),
    ];
    writeSceneFile(tmpDir, 'pre-stripped.md', {
      id: 'sc-pre',
      title: 'Scene sc-pre',
      prose: blocksToMarkdownBody(fullBlocks),
    });
    // Pre-stripped as the renderer would send it: content blanked, bodySegLen
    // set from the same segment-length values the sibling test asserts on.
    const preStrippedBlocks: BlockEntry[] = [
      { ...fullBlocks[0], content: '', bodySegLen: 15 },
      { ...fullBlocks[1], content: '', bodySegLen: 26 },
      { ...fullBlocks[2], content: '', bodySegLen: 24 },
    ];
    const manifestPath = path.join(tmpDir, 'manifest.json');
    const manifest: Manifest = {
      ...defaultManifest(tmpDir),
      scenes: [scene('sc-pre', 'pre-stripped.md', preStrippedBlocks)],
    };
    writeManifest(manifestPath, manifest);

    const onDisk = (JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Manifest).scenes[0].blocks;
    expect(onDisk.map((b) => b.content)).toEqual(['', '', '']);
    expect(onDisk.map((b) => b.bodySegLen)).toEqual([15, 26, 24]);

    const got = readManifest(manifestPath).scenes[0].blocks;
    expect(got.map((b) => b.content)).toEqual(fullBlocks.map((b) => b.content));
    expect(got.map((b) => b.type)).toEqual(['heading', 'prose', 'dialogue']);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('all block types in one scene round-trip, including marker-like characters inside content', () => {
    const blocks = [
      block('b1', 'heading', 0, '### Act III'),
      block('b2', 'prose', 1, 'A paragraph.\n\nStill the same prose block.'),
      block('b3', 'dialogue', 2, '> she quoted someone else'),
      block('b4', 'action', 3, 'ends with a star*'),
      block('b5', 'description', 4, '*already emphatic*'),
      block('b6', 'note', 5, 'contains --> inside'),
    ];
    const manifestPath = writeSceneAndManifest(tmpDir, scene('sc-all', 'all-types.md', blocks));

    const got = readManifest(manifestPath).scenes[0].blocks;
    expect(got.map((b) => b.content)).toEqual(blocks.map((b) => b.content));
    expect(got.map((b) => b.type)).toEqual(blocks.map((b) => b.type));
    expect(got.map((b) => b.id)).toEqual(blocks.map((b) => b.id));
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('M8 shape: N consecutive prose blocks (paragraph splits) round-trip without collapsing', () => {
    const blocks = [
      block('p1', 'prose', 0, 'First paragraph.'),
      block('p2', 'prose', 1, 'Second paragraph, first line.\n\nSecond paragraph, hard-split line.'),
      block('p3', 'prose', 2, 'Third paragraph.'),
      block('p4', 'prose', 3, 'Fourth paragraph.'),
    ];
    const manifestPath = writeSceneAndManifest(tmpDir, scene('sc-m8', 'paragraphs.md', blocks));

    const got = readManifest(manifestPath).scenes[0].blocks;
    expect(got).toHaveLength(4);
    // The interior blank line inside p2 is exactly what blank-line splitting
    // would mis-split into a fifth block; boundary metadata must not.
    expect(got.map((b) => b.content)).toEqual(blocks.map((b) => b.content));
    expect(got.map((b) => b.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('round-trip is stable across repeated write→read cycles (no drift, no warns)', () => {
    const blocks = [
      block('b-h', 'heading', 0, '# One'),
      block('b-p', 'prose', 1, 'Two.'),
      block('b-n', 'note', 2, 'three'),
    ];
    const manifestPath = writeSceneAndManifest(tmpDir, scene('sc-stable', 'stable.md', blocks));

    let manifest = readManifest(manifestPath);
    for (let i = 0; i < 3; i++) {
      writeManifest(manifestPath, manifest);
      manifest = readManifest(manifestPath);
    }
    expect(manifest.scenes[0].blocks.map((b) => b.content)).toEqual(['# One', 'Two.', 'three']);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('external .md edit: hydration falls back to whole-body-in-first-prose, warns once, never throws, invents nothing', () => {
    const blocks = [
      block('b-h', 'heading', 0, '## The Old Mill'),
      block('b-p', 'prose', 1, 'Rain fell on the tin roof.'),
      block('b-d', 'dialogue', 2, 'We should not be here.'),
    ];
    const manifestPath = writeSceneAndManifest(tmpDir, scene('sc-ext', 'external.md', blocks));

    // Obsidian-style external edit: append a paragraph straight to the file.
    const sceneAbs = path.join(tmpDir, 'external.md');
    const editedRaw = fs.readFileSync(sceneAbs, 'utf-8') + '\n\nA paragraph typed outside the app.';
    fs.writeFileSync(sceneAbs, editedRaw, 'utf-8');
    bumpMtime(sceneAbs);
    const editedBody = readSceneFile(tmpDir, 'external.md').prose;

    const got = readManifest(manifestPath).scenes[0].blocks;
    // The FULL edited body — nothing lost, nothing invented — lands in the
    // first prose block; the other blocks hold no stale or fabricated text.
    expect(got.map((b) => b.id)).toEqual(['b-h', 'b-p', 'b-d']);
    expect(got.map((b) => b.content)).toEqual(['', editedBody, '']);
    expect(editedBody).toContain('We should not be here.');
    expect(editedBody).toContain('A paragraph typed outside the app.');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('sc-ext');

    // Same scene, same on-disk version: the warn is not repeated on the
    // dozens of readManifest calls a session makes.
    readManifest(manifestPath);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('legacy structure-only manifest WITHOUT boundary metadata hydrates via the fallback (whole body, warn, no throw)', () => {
    const body = '## The Old Mill\n\nRain fell on the tin roof.\n\n> We should not be here.';
    writeSceneFile(tmpDir, 'legacy.md', { id: 'sc-legacy', title: 'Legacy', prose: body });
    // Hand-build what the pre-#932 writer persisted: all contents blanked,
    // no bodySegLen anywhere.
    const legacy: Manifest = {
      ...defaultManifest(tmpDir),
      scenes: [
        scene('sc-legacy', 'legacy.md', [
          block('b-h', 'heading', 0, ''),
          block('b-p', 'prose', 1, ''),
          block('b-d', 'dialogue', 2, ''),
        ]),
      ],
    };
    const manifestPath = path.join(tmpDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(legacy), 'utf-8');

    const got = readManifest(manifestPath).scenes[0].blocks;
    expect(got.map((b) => b.content)).toEqual(['', body, '']);
    expect(got.map((b) => b.type)).toEqual(['heading', 'prose', 'dialogue']);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('sc-legacy');
  });

  it('single-prose scenes (the overwhelming common case) stay quiet with or without metadata', () => {
    // Without metadata (legacy) …
    writeSceneFile(tmpDir, 'simple.md', { id: 'sc-simple', title: 'Simple', prose: 'Just prose.' });
    const legacy: Manifest = {
      ...defaultManifest(tmpDir),
      scenes: [scene('sc-simple', 'simple.md', [block('b-p', 'prose', 0, '')])],
    };
    const manifestPath = path.join(tmpDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(legacy), 'utf-8');
    expect(readManifest(manifestPath).scenes[0].blocks[0].content).toBe('Just prose.');

    // … and with (current writer).
    writeManifest(manifestPath, readManifest(manifestPath));
    expect(readManifest(manifestPath).scenes[0].blocks[0].content).toBe('Just prose.');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('orphaned manifest entry (no .md on disk) hydrates to empty content without warning', () => {
    const m: Manifest = {
      ...defaultManifest(tmpDir),
      scenes: [
        scene('sc-orphan', 'gone.md', [
          block('b-h', 'heading', 0, ''),
          block('b-p', 'prose', 1, ''),
        ]),
      ],
    };
    const manifestPath = path.join(tmpDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(m), 'utf-8');

    const got = readManifest(manifestPath).scenes[0].blocks;
    expect(got.map((b) => b.content)).toEqual(['', '']);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('v1→v2 migration of a multi-block scene with NO .md backing preserves every block through the recovery hook', () => {
    // The highest-risk migration case, multi-block edition: embedded prose is
    // the only copy. ensureSceneFilesForManifestScenes must write the FULL
    // serialized body (not just the prose block), and because the migration
    // write derives its boundary metadata from the same blocks with the same
    // serializer, the very next readManifest restores all blocks exactly.
    const blocks = [
      block('b-h', 'heading', 0, '## Recovered'),
      block('b-p', 'prose', 1, 'Embedded-only paragraph.'),
      block('b-d', 'dialogue', 2, 'Save me too.'),
    ];
    const legacy = {
      ...defaultManifest(tmpDir),
      schemaVersion: 1,
      scenes: [scene('sc-mig', 'recovered.md', blocks)],
    };
    const manifestPath = path.join(tmpDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(legacy), 'utf-8');
    expect(fs.existsSync(path.join(tmpDir, 'recovered.md'))).toBe(false);

    openManifest(manifestPath, {
      vaultRoot: tmpDir,
      beforeMigrationWrite: (manifest, vaultRoot) => ensureSceneFilesForManifestScenes(manifest, vaultRoot),
    });

    // The .md now holds the full serialized body, dialogue marker included.
    expect(readSceneFile(tmpDir, 'recovered.md').prose).toBe(
      '## Recovered\n\nEmbedded-only paragraph.\n\n> Save me too.'
    );
    // And hydration restores the original per-block content, not a collapsed body.
    const got = readManifest(manifestPath).scenes[0].blocks;
    expect(got.map((b) => b.content)).toEqual([
      '## Recovered',
      'Embedded-only paragraph.',
      'Save me too.',
    ]);
    expect(got.map((b) => b.id)).toEqual(['b-h', 'b-p', 'b-d']);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('M9 regression: a v2 manifest cache under .mythos/ hydrates against the Story Vault root, not the machine dir', () => {
    // MythosVault v2 keeps the manifest as a regenerable cache at
    // `<Story Vault>/.mythos/manifest-cache.json`; scene paths stay relative
    // to the Story Vault root. Hydrating against dirname(manifestPath) (the
    // `.mythos/` dir) resolved every scene body to a missing file — every v2
    // manifest consumer (the heading-zoom manuscript, comment anchoring) saw
    // empty block content. Found by the M9 comments vault-copy round-trip.
    const sc = scene('sc-v2', 'The Deep/Part 1/Chapter 01/Scene 01.md', [
      block('b-p', 'prose', 0, 'The lantern cast a trembling circle of light.'),
    ]);
    writeSceneFile(tmpDir, sc.path, {
      id: sc.id,
      title: sc.title,
      prose: blocksToMarkdownBody(sc.blocks),
    });
    const machineDir = path.join(tmpDir, '.mythos');
    fs.mkdirSync(machineDir, { recursive: true });
    const cachePath = path.join(machineDir, 'manifest-cache.json');
    writeManifest(cachePath, { ...defaultManifest(tmpDir), scenes: [sc] });

    const got = readManifest(cachePath).scenes[0].blocks;
    expect(got[0].content).toBe('The lantern cast a trembling circle of light.');
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
