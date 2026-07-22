// Beta 4 M5 — create a NEW MythosVault (format v2).
//
// Used by the migration wizard's target scaffold and — from M29 (Welcome
// wizard) onward — by every new-vault flow. Seeding runs at creation time
// exactly once; the decision is recorded in mythos.json (`seed`), so no boot
// path can ever re-seed (W0.1 rule, marker migrated into mythos.json).
//
// Pure Node.

import fs from 'node:fs';
import path from 'node:path';
import { isSafeVaultName, pickUniqueMythosVaultName } from '../mythosVault.js';
import {
  MYTHOS_MACHINE_DIRNAME,
  createMythosFile,
  notesVaultRootFor,
  storyVaultRootFor,
  tryReadMythosFile,
  writeMythosFile,
  type MythosFile,
} from './mythosJson.js';
import { defaultVaultSettingsFile, writeVaultSettingsFile } from './vaultSettingsFile.js';
import { defaultTimelinesFile, writeTimelinesFile } from './timelinesFile.js';
import { VEYNN_SEED_LAYOUT, writeVeynnSeed } from './veynnSeed.js';

export interface CreateMythosVaultOptions {
  /** Vault display/folder name. Collision-suffixed unless `exactName`. */
  name?: string;
  /** Skip unique-name suffixing (target chosen explicitly by the caller). */
  exactName?: boolean;
  /** Seed "The Last City of Veynn" demo (default true). false = blank vault. */
  seedDemo?: boolean;
  defaultTheme?: string;
}

export type CreateMythosVaultResult =
  | {
      ok: true;
      mythosRoot: string;
      storyVaultPath: string;
      notesVaultPath: string;
      vaultName: string;
      seeded: boolean;
      /** First demo scene (seeded vaults only) — lets onboarding land the editor on prose. */
      firstSceneId?: string;
      /** Story-Vault-relative path of the first demo scene (posix). */
      firstScenePath?: string;
    }
  | { ok: false; error: string };

export const DEFAULT_MYTHOS_V2_NAME = 'My MythosVault';
export const BLANK_SEED_LAYOUT = 'blank@M5';

/**
 * Scaffold a complete v2 vault under `parentDir`:
 * mythos.json + settings.json + timelines.json + Story Vault/ + Notes Vault/
 * (+ the Veynn demo unless seedDemo=false). Refuses to write into an existing
 * non-empty folder — user data is never overwritten.
 */
export function createMythosVault(
  parentDir: string,
  opts: CreateMythosVaultOptions = {},
): CreateMythosVaultResult {
  if (!path.isAbsolute(parentDir)) {
    return { ok: false, error: 'parentDir: must be an absolute path' };
  }
  const rawName = (opts.name ?? '').trim();
  if (rawName && !isSafeVaultName(rawName)) {
    return { ok: false, error: 'name: must not contain path separators or parent references' };
  }
  try {
    fs.mkdirSync(parentDir, { recursive: true });
  } catch (e) {
    return { ok: false, error: `Could not create parent directory: ${(e as Error).message}` };
  }
  const baseName = rawName || DEFAULT_MYTHOS_V2_NAME;
  const vaultName = opts.exactName ? baseName : pickUniqueMythosVaultName(parentDir, baseName);
  const mythosRoot = path.join(parentDir, vaultName);
  if (fs.existsSync(mythosRoot) && fs.readdirSync(mythosRoot).length > 0) {
    return { ok: false, error: `Target folder is not empty: ${mythosRoot}` };
  }

  const storyVaultPath = storyVaultRootFor(mythosRoot);
  const notesVaultPath = notesVaultRootFor(mythosRoot);
  try {
    fs.mkdirSync(storyVaultPath, { recursive: true });
    fs.mkdirSync(notesVaultPath, { recursive: true });
    fs.mkdirSync(path.join(storyVaultPath, MYTHOS_MACHINE_DIRNAME), { recursive: true });

    const mythos: MythosFile = createMythosFile(vaultName, {
      ...(opts.defaultTheme ? { defaultTheme: opts.defaultTheme } : {}),
    });
    writeMythosFile(mythosRoot, mythos);
    writeVaultSettingsFile(
      mythosRoot,
      defaultVaultSettingsFile({
        ...(opts.defaultTheme ? { defaultTheme: opts.defaultTheme } : {}),
        layoutMode: opts.seedDemo === false ? 'blank' : 'default',
      }),
    );
    writeTimelinesFile(mythosRoot, defaultTimelinesFile());

    const seedDemo = opts.seedDemo !== false;
    const seedResult = seedDemo ? writeVeynnSeed(mythosRoot) : null;
    // Record the seed decision LAST — a crash mid-seed leaves no marker, and
    // the folder is non-empty so a retry lands in a fresh sibling folder
    // instead of double-seeding this one.
    recordSeedDecision(mythosRoot, seedDemo ? 'default' : 'blank');

    return {
      ok: true,
      mythosRoot,
      storyVaultPath,
      notesVaultPath,
      vaultName,
      seeded: seedDemo,
      ...(seedResult
        ? { firstSceneId: seedResult.firstSceneId, firstScenePath: seedResult.firstScenePath }
        : {}),
    };
  } catch (e) {
    return { ok: false, error: `Could not create MythosVault: ${(e as Error).message}` };
  }
}

function recordSeedDecision(mythosRoot: string, mode: 'default' | 'blank'): void {
  const mythos = tryReadMythosFile(mythosRoot);
  if (!mythos || mythos.seed) return;
  writeMythosFile(mythosRoot, {
    ...mythos,
    seed: {
      layout: mode === 'default' ? VEYNN_SEED_LAYOUT : BLANK_SEED_LAYOUT,
      mode,
      seededAt: new Date().toISOString(),
    },
  });
}

/**
 * Boot-time guard for v2 vaults (the W0.1 guarantees, mythos.json edition):
 *  - seed marker present → never seed again, even if the user emptied folders;
 *  - no marker but the vault has content (pre-marker/hand-built v2 vault) →
 *    ADOPT it as seeded, never scaffold into it;
 *  - never auto-seeds on open. Demo seeding happens at CREATION only.
 */
export function ensureMythosV2SeedMarker(mythosRoot: string): { adopted: boolean } {
  const mythos = tryReadMythosFile(mythosRoot);
  if (!mythos || mythos.seed) return { adopted: false };
  writeMythosFile(mythosRoot, {
    ...mythos,
    seed: {
      layout: 'adopted-preexisting@M5',
      mode: 'default',
      seededAt: new Date().toISOString(),
    },
  });
  return { adopted: true };
}
