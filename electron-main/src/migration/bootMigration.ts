// Beta 4 SKY-10405 — boot-time silent v0.4 → MythosVault migration engine.
//
// Owner ruling SKY-10390: MythosVault is just the format. A v0.4 twin-root
// vault is upgraded automatically at boot — copy, verify, repoint — with no
// user decision. The safety model is EXACTLY the wizard's (see
// mythosVaultMigrator.ts): the source vault is opened strictly read-only and
// never modified; the injected `applyRepoint` callback is the ONLY step that
// changes which vault opens next, and it runs only after every file of the
// copy has verified (`report.ok`). Kill or crash at any earlier point and the
// next launch re-detects the v0.4 vault and retries into the same target
// folder (reclaimed via the incomplete-build marker).
//
// Pure Node — main.ts injects the settings repoint so this engine (and its
// unit tests) never touch Electron.

import fs from 'node:fs';
import path from 'node:path';
import {
  clearIncompleteMigrationMarker,
  detectVaultFormat,
  migrationTargetBase,
  readIncompleteMigrationMarker,
  runMythosVaultMigration,
  type MigrationReport,
} from './mythosVaultMigrator.js';
import { mythosRootForStoryVault } from '../mythosFormat/mythosJson.js';

export interface BootMigrationTarget {
  targetRoot: string;
  storyVaultPath: string;
  notesVaultPath: string;
}

export interface BootMigrationInput {
  storyVaultRoot: string;
  notesVaultRoot: string;
  layoutMode?: 'default' | 'blank';
  /**
   * Persists the migrated vault as the active one (settings write + recent
   * projects). This callback is the only step that changes what opens next;
   * everything before it leaves the source vault untouched.
   */
  applyRepoint: (target: BootMigrationTarget) => void | Promise<void>;
}

export type BootMigrationOutcome =
  | { action: 'skipped'; reason: 'not-v0.4' | 'no-manifest' | 'no-target' }
  | ({ action: 'migrated'; report: MigrationReport } & BootMigrationTarget)
  | { action: 'failed'; error: string; targetRoot?: string };

/**
 * Choose where the silent migration builds. Reuses the wizard's naming
 * (`<name> (MythosVault)`, then `… 2`, `… 3`) with retry hardening: a
 * candidate that still carries the incomplete marker FROM THIS SOURCE is a
 * stale partial left by an interrupted earlier attempt — wipe it and build
 * there again, instead of failing permanently or minting a fresh sibling on
 * every retry. Existing folders without a matching marker may be anyone's
 * data and are never touched — the next free name is used instead.
 */
function resolveBootMigrationTarget(storyVaultRoot: string, notesVaultRoot: string): string | null {
  const { anchor, base } = migrationTargetBase(storyVaultRoot, notesVaultRoot);
  let candidate = path.join(anchor, base);
  for (let i = 2; i < 1000; i++) {
    if (!fs.existsSync(candidate)) return candidate;
    const marker = readIncompleteMigrationMarker(candidate);
    if (marker && path.resolve(marker.sourceStoryVault) === path.resolve(storyVaultRoot)) {
      fs.rmSync(candidate, { recursive: true, force: true });
      return candidate;
    }
    candidate = path.join(anchor, `${base} ${i}`);
  }
  return null;
}

export async function runBootMythosMigration(
  input: BootMigrationInput,
): Promise<BootMigrationOutcome> {
  const format = detectVaultFormat(input.storyVaultRoot);
  if (format !== 'v0.4-twin-root') {
    if (format === 'mythos-v2') {
      // Crash window: killed after the settings repoint but before the marker
      // clear leaves a completed, now-ACTIVE vault still flagged incomplete.
      // Settings pointing into it prove the repoint landed — clear the flag.
      const mythosRoot = mythosRootForStoryVault(input.storyVaultRoot);
      if (mythosRoot !== null) clearIncompleteMigrationMarker(mythosRoot);
    }
    return { action: 'skipped', reason: 'not-v0.4' };
  }
  // detectVaultFormat also classifies any non-empty manifest-less folder as
  // v0.4 (adopted plain folders). There is nothing to migrate until the app
  // has adopted it (ensureVaultDir writes a manifest on open) — skip now; the
  // NEXT boot migrates the then-real v0.4 vault.
  if (!fs.existsSync(path.join(input.storyVaultRoot, 'manifest.json'))) {
    return { action: 'skipped', reason: 'no-manifest' };
  }
  const targetRoot = resolveBootMigrationTarget(input.storyVaultRoot, input.notesVaultRoot);
  if (targetRoot === null) return { action: 'skipped', reason: 'no-target' };

  const report = runMythosVaultMigration({
    sourceStoryVault: input.storyVaultRoot,
    sourceNotesVault: input.notesVaultRoot,
    targetRoot,
    ...(input.layoutMode ? { layoutMode: input.layoutMode } : {}),
  });
  if (!report.ok) {
    // The partial build keeps its incomplete marker so the next attempt can
    // reclaim the folder. The source vault is untouched by construction.
    return {
      action: 'failed',
      error: report.error ?? 'Migration verification failed.',
      targetRoot,
    };
  }
  const target: BootMigrationTarget = {
    targetRoot,
    storyVaultPath: report.storyVaultPath,
    notesVaultPath: report.notesVaultPath,
  };
  try {
    await input.applyRepoint(target);
  } catch (e) {
    return {
      action: 'failed',
      error: `The upgraded vault was built and verified, but switching to it failed: ${(e as Error).message}`,
      targetRoot,
    };
  }
  clearIncompleteMigrationMarker(targetRoot);
  return { action: 'migrated', report, ...target };
}
