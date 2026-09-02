// SKY-11151 — THE shared vault-creation primitive.
//
// One option set — `template` (RECOMMENDED) / `blank` / `import` — used by
// first run, `New Mythos vault…`, and Settings `Add vault…`. The surrounding
// chrome differs per caller; the creation LOGIC lives here once (parent spec
// SKY-11141 §3). Callers pass a resolved absolute destination + name + mode;
// this module owns destination materialisation, template seeding, blank-vault
// Obsidian-parity creation, and import wiring.
//
// Design decisions (documented so the next engineer inherits intent, not
// folklore — see docs/vault-creation-primitive.md):
//
//  • Every mode scaffolds via createMythosVault({ seedDemo: false }). The
//    generated Veynn *demo* seed is deliberately NOT used by any of the three
//    options — §3 removes the "generated sample-story path" from first run.
//    `template` is a ready *shape* (empty folders, no notes); `blank` is
//    Obsidian-parity empty; `import` brings the user's own content.
//
//  • Obsidian-parity blank (§3a): a blank vault has only genuine machinery
//    (`.mythos/`, mythos.json + the two sibling JSON files, the empty vault
//    roots) — nothing the user sees in the tree. createMythosVault already
//    records the seed decision in mythos.json (`seed`), and
//    ensureMythosV2SeedMarker refuses to seed whenever that record is present,
//    so the empty choice is PERSISTED and re-seed-proof across relaunch /
//    index-rebuild / health-repair. This module records the *mode* in the seed
//    layout tag so provenance survives too.
//
//  • Import always creates a NEW MythosVault and copies into it — it never
//    adopts or writes into the source folder (§3b, the SKY-11132 rule).
//    Startup importer coverage today is Obsidian + plain-Markdown trees (both
//    route through importObsidianToVaultDir, byte-for-byte, links untouched —
//    SKY-10383). Notion / Scrivener are NOT wired into this startup primitive
//    yet; callers must not claim that parity. See docs note.
//
// Pure Node — no Electron imports — so unit tests drive it with real tmpdirs.

import fs from 'node:fs';
import path from 'node:path';
import { createMythosVault, type CreateMythosVaultResult } from './createVault.js';
import {
  notesVaultRootFor,
  tryReadMythosFile,
  writeMythosFile,
} from './mythosJson.js';
import { importObsidianToVaultDir } from '../obsidianImporter.js';

/** The three creation options, identical wherever the primitive is invoked. */
export type VaultCreationMode = 'template' | 'blank' | 'import';

/** Seed-layout provenance tags recorded in mythos.json for each mode. */
export const TEMPLATE_SEED_LAYOUT = 'template@SKY-11151';
export const IMPORT_SEED_LAYOUT = 'import@SKY-11151';

/**
 * The RECOMMENDED template's ready-shape: empty top-level folders in the
 * Notes Vault (the wiki side), no notes inside. Mirrors the existing
 * NOTES_VAULT_DIRS naming convention (vault.ts) so a template vault reads like
 * a hand-organised wiki the moment it opens. Copy/lay-out is UX-owned; this is
 * the sane default the primitive ships until UXDesigner rules otherwise.
 */
export const TEMPLATE_NOTES_SKELETON = [
  'Characters',
  'Locations',
  'Stories',
  'Plot',
  'Worldbuilding',
  'Research',
] as const;

/** One source folder to import into a side of the new vault. */
export interface VaultImportSource {
  /** Which half of the new vault this source populates. */
  kind: 'notes' | 'story';
  /** Absolute path to the user's source folder (Obsidian vault / md tree). */
  srcPath: string;
}

export interface CreateVaultFromOptionsInput {
  /** Absolute parent directory the new MythosVault folder is created under. */
  destinationParent: string;
  /** Vault display/folder name. Collision-suffixed unless `exactName`. */
  name?: string;
  /** Skip unique-name suffixing (destination chosen explicitly by the user). */
  exactName?: boolean;
  /** Which of the three creation options the caller picked. */
  mode: VaultCreationMode;
  /** Per-vault default theme token (validated by the caller). */
  defaultTheme?: string;
  /** Required for `import` mode — at least one side; the other stays blank. */
  importSources?: VaultImportSource[];
}

export interface ImportTally {
  /** Files copied across all sources. */
  imported: number;
  /** Files skipped because the destination already had them. */
  skipped: number;
  /** Total files found in the source folders. */
  sourceCount: number;
  /** Non-fatal warnings surfaced by the importer (e.g. dropped file types). */
  warnings: string[];
}

export type CreateVaultFromOptionsResult =
  | ({
      ok: true;
      mode: VaultCreationMode;
      mythosRoot: string;
      storyVaultPath: string;
      notesVaultPath: string;
      vaultName: string;
      /** Present for `import` mode only. */
      importTally?: ImportTally;
    })
  | { ok: false; error: string };

/**
 * Re-tag the recorded seed layout so mythos.json reflects the creation mode.
 * createMythosVault({ seedDemo:false }) already wrote a seed record with
 * mode:'blank' (which is what keeps re-seeding off — never regress that); we
 * only overwrite the free-form `layout` string for provenance. The `mode`
 * field stays 'blank' because, for the re-seed guard, all three options are
 * "do not seed the demo".
 */
function retagSeedLayout(mythosRoot: string, layout: string): void {
  const mythos = tryReadMythosFile(mythosRoot);
  if (!mythos || !mythos.seed) return;
  writeMythosFile(mythosRoot, { ...mythos, seed: { ...mythos.seed, layout } });
}

/**
 * Create the empty ready-shape skeleton for `template` mode. Folders only —
 * never a note file, so a template vault is still "no notes, just the shape"
 * (§3). Idempotent: existing folders are left as-is.
 */
function writeTemplateSkeleton(mythosRoot: string): void {
  const notesRoot = notesVaultRootFor(mythosRoot);
  for (const dir of TEMPLATE_NOTES_SKELETON) {
    fs.mkdirSync(path.join(notesRoot, dir), { recursive: true });
  }
}

/**
 * Materialise a new MythosVault for one of the three creation options.
 *
 * Never overwrites user data (createMythosVault refuses a non-empty target),
 * always creates a NEW vault (import copies in — it never adopts the source),
 * and always persists the choice so no later boot re-seeds it.
 */
export function createVaultFromOptions(
  input: CreateVaultFromOptionsInput,
): CreateVaultFromOptionsResult {
  const { destinationParent, name, exactName, mode, defaultTheme, importSources } = input;

  if (!path.isAbsolute(destinationParent)) {
    return { ok: false, error: 'destinationParent: must be an absolute path' };
  }
  if (mode !== 'template' && mode !== 'blank' && mode !== 'import') {
    return { ok: false, error: `Unknown creation mode: ${String(mode)}` };
  }
  if (mode === 'import') {
    const sources = (importSources ?? []).filter((s) => s && s.srcPath?.trim());
    if (sources.length === 0) {
      return { ok: false, error: 'import mode requires at least one source folder' };
    }
  }

  // Every option is a NON-demo v2 vault. The demo seed is intentionally never
  // used by the creation primitive (§3 removes the generated sample-story
  // path); blank/template/import all start from a clean v2 scaffold.
  const created: CreateMythosVaultResult = createMythosVault(destinationParent, {
    ...(name ? { name } : {}),
    ...(exactName ? { exactName: true } : {}),
    seedDemo: false,
    ...(defaultTheme ? { defaultTheme } : {}),
  });
  if (!created.ok) return { ok: false, error: created.error };

  const base = {
    mode,
    mythosRoot: created.mythosRoot,
    storyVaultPath: created.storyVaultPath,
    notesVaultPath: created.notesVaultPath,
    vaultName: created.vaultName,
  } as const;

  if (mode === 'blank') {
    // Nothing further — Obsidian-parity empty. The seed record written by
    // createMythosVault (mode:'blank', layout:'blank@M5') already persists the
    // choice and blocks any later re-seed.
    return { ok: true, ...base };
  }

  if (mode === 'template') {
    writeTemplateSkeleton(created.mythosRoot);
    retagSeedLayout(created.mythosRoot, TEMPLATE_SEED_LAYOUT);
    return { ok: true, ...base };
  }

  // mode === 'import'
  const sources = (importSources ?? []).filter((s) => s && s.srcPath?.trim());
  const tally: ImportTally = { imported: 0, skipped: 0, sourceCount: 0, warnings: [] };
  const errors: string[] = [];
  for (const source of sources) {
    const dest = source.kind === 'notes' ? created.notesVaultPath : created.storyVaultPath;
    const result = importObsidianToVaultDir(source.srcPath, dest);
    tally.imported += result.imported;
    tally.skipped += result.skipped;
    tally.sourceCount += result.sourceCount;
    if (result.dropWarning) tally.warnings.push(result.dropWarning);
    if (!result.ok) errors.push(...result.errors);
  }
  retagSeedLayout(created.mythosRoot, IMPORT_SEED_LAYOUT);

  if (errors.length > 0) {
    // The new vault scaffold stays on disk (partial copies may exist) but the
    // caller decides adoption; surface the failure rather than silently
    // half-importing.
    return { ok: false, error: errors.join('; ') };
  }
  return { ok: true, ...base, importTally: tally };
}
