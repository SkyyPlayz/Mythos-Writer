// SKY-10405 — boot-time silent v0.4 → MythosVault migration engine.
//
// Covers the three verification paths the ticket names: happy path (copy,
// verify, repoint, marker cleared), verify-failure (no repoint, original
// stays, marker retained for retry), and kill-mid-run resume/retry (a stale
// partial target from an interrupted attempt is reclaimed, not stacked or
// fatally errored on). Plus the guard rails: v2/manifest-less vaults skip,
// foreign sibling folders are never touched, and a repoint crash reports
// failure without losing the built vault.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { runBootMythosMigration, type BootMigrationTarget } from './bootMigration.js';
import {
  MIGRATION_INCOMPLETE_MARKER,
  readIncompleteMigrationMarker,
} from './mythosVaultMigrator.js';
import { _clearDetectionCache, createMythosFile, writeMythosFile } from '../mythosFormat/mythosJson.js';

const PROSE = 'The gate had waited under the sea, and it recognized her.';
const NOTE = 'She counts bells.';

let tmp: string;
let bundle: string;
let storyVault: string;
let notesVault: string;
/** The first-choice silent-migration target for the fixture bundle. */
let target: string;

/** v0.4 twin-root fixture: one story, one chapter, one scene, one note. */
function seedV04Vault(): void {
  fs.mkdirSync(path.join(storyVault, 'Manuscript', 'the-deep', 'ch-1'), { recursive: true });
  fs.mkdirSync(notesVault, { recursive: true });
  const nowStr = '2026-06-01T00:00:00.000Z';
  const scenePath = 'Manuscript/the-deep/ch-1/the-gate.md';
  fs.writeFileSync(
    path.join(storyVault, scenePath),
    `---\nid: scene-bm-1\ntitle: The Gate\nupdatedAt: ${nowStr}\n---\n${PROSE}`,
  );
  const scene = {
    id: 'scene-bm-1', title: 'The Gate', path: scenePath, order: 0,
    chapterId: 'ch-bm-1', storyId: 'story-bm-1',
    blocks: [{ id: 'b1', type: 'prose', order: 0, content: PROSE, updatedAt: nowStr }],
    draftState: 'final', createdAt: nowStr, updatedAt: nowStr,
  };
  const manifest = {
    schemaVersion: 1, version: '2.0.0', vaultRoot: storyVault,
    stories: [{
      id: 'story-bm-1', title: 'The Deep', path: 'Manuscript/the-deep',
      chapters: [{
        id: 'ch-bm-1', title: 'Chapter One', path: 'Manuscript/the-deep/ch-1',
        order: 0, scenes: [scene], createdAt: nowStr, updatedAt: nowStr,
      }],
      createdAt: nowStr, updatedAt: nowStr,
    }],
    entities: [], suggestions: [], scenes: [], chapters: [],
    provenance: {}, boardReferences: [],
  };
  fs.writeFileSync(path.join(storyVault, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(notesVault, 'Mira.md'), NOTE);
}

/** Full recursive content snapshot: relPath → sha256 (for untouched asserts). */
function treeHashes(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else {
        out.set(
          rel,
          crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, entry.name))).digest('hex'),
        );
      }
    }
  };
  walk(root, '');
  return out;
}

function migrate(applyRepoint: (t: BootMigrationTarget) => void | Promise<void> = () => {}) {
  return runBootMythosMigration({
    storyVaultRoot: storyVault,
    notesVaultRoot: notesVault,
    applyRepoint,
  });
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-boot-migrate-'));
  bundle = path.join(tmp, 'My Vault');
  storyVault = path.join(bundle, 'Story Vault');
  notesVault = path.join(bundle, 'Notes Vault');
  target = path.join(tmp, 'My Vault (MythosVault)');
  _clearDetectionCache();
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('runBootMythosMigration — skip guards', () => {
  it('skips a MythosVault v2 vault and clears a stale post-repoint marker', async () => {
    fs.mkdirSync(storyVault, { recursive: true });
    fs.mkdirSync(notesVault, { recursive: true });
    writeMythosFile(bundle, createMythosFile('My Vault'));
    // Simulate a kill between the settings repoint and the marker clear.
    fs.writeFileSync(
      path.join(bundle, MIGRATION_INCOMPLETE_MARKER),
      JSON.stringify({ sourceStoryVault: '/somewhere/old' }),
    );
    const repoints: BootMigrationTarget[] = [];
    const outcome = await migrate((t) => { repoints.push(t); });
    expect(outcome).toEqual({ action: 'skipped', reason: 'not-v0.4' });
    expect(repoints).toHaveLength(0);
    expect(fs.existsSync(path.join(bundle, MIGRATION_INCOMPLETE_MARKER))).toBe(false);
  });

  it('skips a non-empty folder that has no manifest (not yet a v0.4 vault)', async () => {
    fs.mkdirSync(storyVault, { recursive: true });
    fs.mkdirSync(notesVault, { recursive: true });
    fs.writeFileSync(path.join(storyVault, 'loose-note.md'), 'plain folder');
    const outcome = await migrate();
    expect(outcome).toEqual({ action: 'skipped', reason: 'no-manifest' });
    expect(fs.existsSync(target)).toBe(false);
  });
});

describe('runBootMythosMigration — happy path', () => {
  it('copies, verifies, repoints, clears the marker; source untouched', async () => {
    seedV04Vault();
    const storyBefore = treeHashes(storyVault);
    const notesBefore = treeHashes(notesVault);
    const repoints: BootMigrationTarget[] = [];

    const outcome = await migrate((t) => { repoints.push(t); });

    expect(outcome.action).toBe('migrated');
    if (outcome.action !== 'migrated') return;
    expect(outcome.targetRoot).toBe(target);
    expect(outcome.report.ok).toBe(true);
    expect(outcome.report.verified.mismatches).toEqual([]);

    // Repoint received exactly the verified build's paths.
    expect(repoints).toEqual([{
      targetRoot: target,
      storyVaultPath: path.join(target, 'Story Vault'),
      notesVaultPath: path.join(target, 'Notes Vault'),
    }]);

    // Content survives in the new layout; the in-flight marker is gone.
    expect(
      fs.readFileSync(
        path.join(target, 'Story Vault', 'The Deep', 'Part 1', 'Chapter 01', 'Scene 01.md'),
        'utf-8',
      ),
    ).toContain(PROSE);
    expect(fs.readFileSync(path.join(target, 'Notes Vault', 'Mira.md'), 'utf-8')).toBe(NOTE);
    expect(fs.existsSync(path.join(target, MIGRATION_INCOMPLETE_MARKER))).toBe(false);

    // The source vault is byte-for-byte untouched.
    expect(treeHashes(storyVault)).toEqual(storyBefore);
    expect(treeHashes(notesVault)).toEqual(notesBefore);
  });
});

describe('runBootMythosMigration — verify failure', () => {
  it('does not repoint, keeps the source intact, retains the retry marker', async () => {
    seedV04Vault();
    // A comments sidecar that EXISTS but is a directory (EISDIR) hard-fails
    // the copy — the migrator refuses to silently drop comments.
    fs.mkdirSync(path.join(storyVault, 'Manuscript', 'the-deep', 'comments.json'));
    const storyBefore = treeHashes(storyVault);
    const repoints: BootMigrationTarget[] = [];

    const outcome = await migrate((t) => { repoints.push(t); });

    expect(outcome.action).toBe('failed');
    if (outcome.action !== 'failed') return;
    expect(outcome.error).toContain('comments.json');
    expect(repoints).toHaveLength(0);
    expect(treeHashes(storyVault)).toEqual(storyBefore);
    // The partial build stays flagged so the next boot reclaims it.
    expect(readIncompleteMigrationMarker(target)?.sourceStoryVault).toBe(storyVault);
  });

  it('reports failure (and keeps the marker) when the repoint itself throws', async () => {
    seedV04Vault();
    const outcome = await migrate(() => {
      throw new Error('settings disk full');
    });
    expect(outcome.action).toBe('failed');
    if (outcome.action !== 'failed') return;
    expect(outcome.error).toContain('settings disk full');
    expect(readIncompleteMigrationMarker(target)?.sourceStoryVault).toBe(storyVault);
  });
});

describe('runBootMythosMigration — kill-mid-run resume/retry', () => {
  it('reclaims a stale partial target from an interrupted attempt', async () => {
    seedV04Vault();
    // What a SIGKILL mid-copy leaves behind: marker + half-written files.
    fs.mkdirSync(path.join(target, 'Story Vault', 'The Deep'), { recursive: true });
    fs.writeFileSync(
      path.join(target, MIGRATION_INCOMPLETE_MARKER),
      JSON.stringify({ sourceStoryVault: storyVault }),
    );
    fs.writeFileSync(path.join(target, 'Story Vault', 'The Deep', 'garbage.md'), 'partial');

    const outcome = await migrate();

    expect(outcome.action).toBe('migrated');
    if (outcome.action !== 'migrated') return;
    // Same folder reused — no "My Vault (MythosVault) 2" minted…
    expect(outcome.targetRoot).toBe(target);
    expect(fs.existsSync(`${target} 2`)).toBe(false);
    // …and the corrupt partial content was wiped, not silently reused.
    expect(fs.existsSync(path.join(target, 'Story Vault', 'The Deep', 'garbage.md'))).toBe(false);
    expect(outcome.report.verified.mismatches).toEqual([]);
  });

  it('never touches an existing sibling folder that is not a flagged partial', async () => {
    seedV04Vault();
    // A folder squatting on the preferred name WITHOUT the marker — could be
    // the user's own data. Must be left alone.
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'precious.txt'), 'user data');

    const outcome = await migrate();

    expect(outcome.action).toBe('migrated');
    if (outcome.action !== 'migrated') return;
    expect(outcome.targetRoot).toBe(`${target} 2`);
    expect(fs.readFileSync(path.join(target, 'precious.txt'), 'utf-8')).toBe('user data');
  });
});
