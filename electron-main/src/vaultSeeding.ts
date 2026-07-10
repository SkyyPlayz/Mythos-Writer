// W0.1 (Beta 4 "Refine", GAP-REPORT-v2 P0 #1) — seed-once guarantee.
//
// The shipped beta re-ran the SKY-15 vault seeding because the only trigger
// was a stateless "directory is empty" heuristic (`isEmptyOrMissing`)
// re-evaluated on every boot and on every vault IPC call. Any event that made
// the resolved root look empty or new again — settings-path drift between
// releases (SKY-2157 moved the default roots), a user emptying the folder,
// or a re-run of the onboarding scaffold — re-created the seed layout, which
// is how the `Archive ×4 / Universes ×9` trees in the GAP report accrued.
//
// Fix (FULL-SPEC §2, last paragraph): seeding runs ONCE per vault root,
// recorded in a durable marker. The marker is double-booked:
//   1. a `.mythos-seeded` sentinel file inside the vault root — travels with
//      the vault (Dropbox, moves, backups). mythos.json arrives in M5 and can
//      migrate this sentinel into vault metadata.
//   2. a `seededVaultRoots` registry in vault-settings.json — survives the
//      user emptying the vault folder (which would delete the sentinel).
// Scaffolding itself stays idempotent-by-construction (seedDir/seedFile never
// touch existing entries); the marker is what stops the re-seed loop.
//
// Pure Node (no Electron imports) so unit tests can drive it with a tmpdir.

import fs from 'node:fs';
import path from 'node:path';
import { isEmptyOrMissing, type VaultLayoutMode } from './vault.js';

export const SEED_MARKER_FILENAME = '.mythos-seeded';

export const STORY_VAULT_SEED_LAYOUT = 'story-vault@SKY-15';
export const NOTES_VAULT_SEED_LAYOUT = 'notes-vault@SKY-15';

export interface SeedMarker {
  markerVersion: 1;
  /** Which layout was seeded (or deliberately skipped in blank mode). */
  layout: string;
  /** Layout mode that was in effect when the decision was recorded. */
  mode: VaultLayoutMode;
  seededAt: string;
}

/**
 * App-side durable record of which roots have been seeded, independent of the
 * vault folder's contents. main.ts backs this with vault-settings.json.
 */
export interface SeedRegistry {
  has(root: string): boolean;
  add(root: string): void;
}

export function seedMarkerPath(root: string): string {
  return path.join(root, SEED_MARKER_FILENAME);
}

export function hasSeedMarker(root: string): boolean {
  try {
    return fs.existsSync(seedMarkerPath(root));
  } catch {
    return false;
  }
}

/**
 * Best-effort marker write — a failure (read-only mount, network hiccup) must
 * never block vault access. The settings-registry half still records the seed.
 */
export function writeSeedMarker(
  root: string,
  info: { layout: string; mode: VaultLayoutMode },
): void {
  const marker: SeedMarker = {
    markerVersion: 1,
    layout: info.layout,
    mode: info.mode,
    seededAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(seedMarkerPath(root), `${JSON.stringify(marker, null, 2)}\n`, 'utf-8');
  } catch {
    /* non-fatal — registry half still guards the seed */
  }
}

export interface EnsureVaultSeededOptions {
  root: string;
  mode: VaultLayoutMode;
  /** Layout tag recorded in the marker, e.g. STORY_VAULT_SEED_LAYOUT. */
  layout: string;
  /** The idempotent scaffold to run at most once (scaffoldStoryVault / scaffoldNotesVault). */
  scaffold: (root: string, mode: VaultLayoutMode) => void;
  registry?: SeedRegistry;
}

/**
 * Create `root` if missing and run the seed scaffold exactly once per root.
 *
 * Decision order:
 *  1. Marker file or registry entry present → never scaffold again, even if
 *     the directory is empty (the user emptied it on purpose). Backfill the
 *     missing half of the record.
 *  2. Directory already has content but carries no marker → a pre-marker
 *     vault. Adopt it as seeded (write marker + registry) so the legacy
 *     empty-heuristic can never re-arm; do NOT scaffold into it.
 *  3. Genuinely fresh empty root → scaffold once, then record the marker.
 *     In 'blank' mode the scaffold is a no-op, but the decision is still
 *     recorded so a later layoutMode flip cannot seed into a vault the user
 *     chose to start blank.
 */
export function ensureVaultSeeded(opts: EnsureVaultSeededOptions): { seeded: boolean } {
  const { root, mode, layout, scaffold, registry } = opts;

  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }

  const marked = hasSeedMarker(root);
  const registered = registry?.has(root) ?? false;

  if (marked || registered) {
    if (!registered) registry?.add(root);
    // Re-write the sentinel only into a root that still has content — never
    // drop a file back into a folder the user deliberately emptied.
    if (!marked && !isEmptyOrMissing(root)) writeSeedMarker(root, { layout, mode });
    return { seeded: false };
  }

  if (!isEmptyOrMissing(root)) {
    writeSeedMarker(root, { layout, mode });
    registry?.add(root);
    return { seeded: false };
  }

  scaffold(root, mode);
  writeSeedMarker(root, { layout, mode });
  registry?.add(root);
  return { seeded: true };
}
