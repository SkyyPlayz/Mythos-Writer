import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { planUninstallRecovery } from './uninstallRecoveryPlan.js';
import { cleanUninstall } from './uninstallHelper.js';

describe('planUninstallRecovery', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-uninstall-recovery-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reports fullyCleared when both roots are gone', () => {
    const story = path.join(tmp, 'story');
    const notes = path.join(tmp, 'notes');

    const plan = planUninstallRecovery(story, notes);

    expect(plan).toEqual({
      storyVaultSurvived: false,
      notesVaultSurvived: false,
      fullyCleared: true,
    });
  });

  it('reports both survived when neither root was removed', () => {
    const story = path.join(tmp, 'story');
    const notes = path.join(tmp, 'notes');
    fs.mkdirSync(story);
    fs.mkdirSync(notes);

    const plan = planUninstallRecovery(story, notes);

    expect(plan).toEqual({
      storyVaultSurvived: true,
      notesVaultSurvived: true,
      fullyCleared: false,
    });
  });

  // SKY-9730: story-vault-survives + notes-vault-gone must recover ONLY the
  // story side — recovering notes too would re-scaffold a vault that was
  // just successfully deleted.
  it('reports only the story side survived when notes vault was deleted', () => {
    const story = path.join(tmp, 'story');
    const notes = path.join(tmp, 'notes');
    fs.mkdirSync(story); // survives (simulated failed delete)
    // notes never created / already removed

    const plan = planUninstallRecovery(story, notes);

    expect(plan).toEqual({
      storyVaultSurvived: true,
      notesVaultSurvived: false,
      fullyCleared: false,
    });
  });

  // Symmetric case: notes survives, story is gone.
  it('reports only the notes side survived when story vault was deleted', () => {
    const story = path.join(tmp, 'story');
    const notes = path.join(tmp, 'notes');
    fs.mkdirSync(notes);

    const plan = planUninstallRecovery(story, notes);

    expect(plan).toEqual({
      storyVaultSurvived: false,
      notesVaultSurvived: true,
      fullyCleared: false,
    });
  });

  // Integration-style: drive the real cleanUninstall() against split custom
  // vault locations (outside the default <userData>/vaults/ parent, so each
  // root is deleted independently — see uninstallHelper.ts resolveDeletePaths)
  // with one delete forced to fail, mirroring the SKY-9730 repro: story vault
  // delete fails (still exists), notes vault delete succeeds (gone).
  it('plans recovery for only the surviving side after a real split-custom-path partial delete', () => {
    const customStory = path.join(tmp, 'custom-story');
    const customNotes = path.join(tmp, 'custom-notes');
    fs.mkdirSync(customStory, { recursive: true });
    fs.writeFileSync(path.join(customStory, 'scene.md'), '# Scene');
    fs.mkdirSync(customNotes, { recursive: true });
    fs.writeFileSync(path.join(customNotes, 'note.md'), '# Note');

    const originalRmSync = fs.rmSync.bind(fs);
    const rmSpy = vi.spyOn(fs, 'rmSync').mockImplementation((p, opts) => {
      if (p === customStory) return undefined; // simulate a locked file: rm is a silent no-op
      return originalRmSync(p as fs.PathLike, opts as fs.RmOptions);
    });

    try {
      const result = cleanUninstall({
        storyVaultRoot: customStory,
        notesVaultRoot: customNotes,
        userDataPath: tmp,
      });

      expect(result.errors.some((e) => e.startsWith(customStory))).toBe(true);
      expect(result.deleted).toContain(customNotes);
      expect(fs.existsSync(customStory)).toBe(true);
      expect(fs.existsSync(customNotes)).toBe(false);

      const plan = planUninstallRecovery(customStory, customNotes);
      expect(plan.storyVaultSurvived).toBe(true);
      expect(plan.notesVaultSurvived).toBe(false);
      expect(plan.fullyCleared).toBe(false);

      // The notes side must NOT be re-scaffolded: no file should reappear
      // under the deleted root just from planning the recovery.
      expect(fs.existsSync(customNotes)).toBe(false);
    } finally {
      rmSpy.mockRestore();
    }
  });
});
