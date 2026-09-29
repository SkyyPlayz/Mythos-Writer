// Slice D — seed pack content applicator (two distinguishable worlds).
// Reads seed/mythos-writer-seed.json packs and materializes notes + stories.
// Soft-FAIL: never enables Demo / TourModal / coach-mark / walkthroughSteps.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createMythosVault } from './createVault.js';
import {
  NOTES_GROUP_DIRNAME,
  STORIES_GROUP_DIRNAME,
  tryReadMythosFile,
  writeMythosFile,
  type MythosStoryRef,
} from './mythosJson.js';
import { writeFileAtomic } from '../vault.js';
import {
  chapterDirName,
  partDirName,
  sceneFileName,
  serializeV2SceneFile,
} from './sceneFiles.js';
import { BOOK_FILENAME, serializeBookFile, type BookSpinePart } from './bookFile.js';
import { ensureNotesVaultRegistry, writeNotesVaultRegistry } from './notesVaultRegistry.js';
import {
  ensureStoryVaultRegistry,
  writeStoryVaultRegistry,
} from './storyVaultRegistry.js';
import { VAULT_REGISTRY_VERSION } from './vaultRegistry.js';
import { ensureAgentsPartnerFiles } from './agentsVaultPartner.js';

export const SEED_PACK_LAYOUT = 'seed-pack@SliceD';
export const SEED_WORLD_NAMES = {
  mythos: 'Mythos Vault',
  aether: 'Shared Worlds',
} as const;

interface SeedNote {
  title?: string;
  md?: string;
}

interface SeedStory {
  id: string;
  name: string;
  svault?: string;
  sub?: string;
  book?: Array<{
    t: string;
    label?: string;
    intro?: string[];
    chapters?: Array<{
      t: string;
      n?: number;
      intro?: string[];
      scenes?: Array<{
        t: string;
        status?: string;
        paras?: string[];
        pov?: string;
      }>;
    }>;
  }>;
}

interface SeedFolderNode {
  id: string;
  label: string;
  kids?: SeedFolderNode[];
  files?: Array<{ id: string; label: string }>;
}

interface SeedPack {
  world?: string;
  vault?: SeedFolderNode[];
  notes?: Record<string, SeedNote>;
  stories?: SeedStory[];
  noteVaults?: Record<string, { vault?: SeedFolderNode[] }>;
}

interface SeedFile {
  packs?: Record<string, SeedPack>;
  walkthroughSteps?: unknown;
}

function resolveSeedJsonPath(): string {
  // Prefer repo-root seed/ (cwd may be repo root or electron-main workspace).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(process.cwd(), 'seed', 'mythos-writer-seed.json'),
    path.join(process.cwd(), '..', 'seed', 'mythos-writer-seed.json'),
    path.join(here, '..', '..', '..', 'seed', 'mythos-writer-seed.json'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('seed/mythos-writer-seed.json not found');
}

export function loadSeedFile(seedPath?: string): SeedFile {
  const p = seedPath ?? resolveSeedJsonPath();
  const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as SeedFile;
  return raw;
}

/** True when seed file is content-only for enablement (walkthroughSteps may exist as data). */
export function seedIsContentOnly(seed: SeedFile): boolean {
  // Presence of walkthroughSteps in JSON is OK; Soft-FAIL is *enablement* in product.
  return Boolean(seed.packs?.mythos && seed.packs?.aether);
}

function safeFolderName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim() || 'Untitled';
}

function writeNotesTree(
  notesRoot: string,
  nodes: SeedFolderNode[] | undefined,
  notes: Record<string, SeedNote> | undefined,
): void {
  if (!nodes) return;
  const walk = (list: SeedFolderNode[], parent: string): void => {
    for (const node of list) {
      const dir = path.join(parent, safeFolderName(node.label));
      fs.mkdirSync(dir, { recursive: true });
      for (const f of node.files ?? []) {
        const note = notes?.[f.id];
        const body = note?.md?.trim()
          || `# ${note?.title || f.label}\n\n`;
        const fileName = `${safeFolderName(note?.title || f.label)}.md`;
        writeFileAtomic(path.join(dir, fileName), body.endsWith('\n') ? body : `${body}\n`);
      }
      if (node.kids?.length) walk(node.kids, dir);
    }
  };
  walk(nodes, notesRoot);
}

function writeStoryManuscript(storyVaultRoot: string, story: SeedStory): MythosStoryRef {
  const folder = safeFolderName(story.name);
  const storyDir = path.join(storyVaultRoot, folder);
  fs.mkdirSync(storyDir, { recursive: true });
  const now = new Date().toISOString();
  const storyId = story.id || crypto.randomUUID();
  const spine: BookSpinePart[] = [];
  const book = story.book ?? [];
  book.forEach((part, pi) => {
    const pDirName = partDirName(pi + 1);
    const partAbs = path.join(storyDir, pDirName);
    fs.mkdirSync(partAbs, { recursive: true });
    const chapters = part.chapters ?? [];
    const spineChapters: BookSpinePart['chapters'] = [];
    chapters.forEach((ch, ci) => {
      const cDirName = chapterDirName(ch.n ?? ci + 1);
      const chAbs = path.join(partAbs, cDirName);
      fs.mkdirSync(chAbs, { recursive: true });
      const scenes = ch.scenes ?? [];
      scenes.forEach((sc, si) => {
        const status = (sc.status === 'done' || sc.status === 'draft' || sc.status === 'todo')
          ? sc.status
          : 'draft';
        const file = sceneFileName(si + 1);
        const prose = (sc.paras ?? ['']).join('\n\n');
        const body = serializeV2SceneFile({
          id: crypto.randomUUID(),
          title: sc.t,
          status,
          pov: sc.pov,
          prose,
        });
        writeFileAtomic(path.join(chAbs, file), body);
      });
      spineChapters.push({
        id: crypto.randomUUID(),
        title: ch.t,
        dir: cDirName,
        ...(ch.intro?.length ? { intro: ch.intro } : {}),
      });
    });
    spine.push({
      dir: pDirName,
      label: part.t,
      ...(part.intro?.length ? { intro: part.intro } : {}),
      chapters: spineChapters,
    });
  });
  writeFileAtomic(
    path.join(storyDir, BOOK_FILENAME),
    serializeBookFile({
      id: storyId,
      title: story.name,
      synopsis: story.sub,
      createdAt: now,
      updatedAt: now,
      spine,
    }),
  );
  return {
    id: storyId,
    title: story.name,
    folder,
    synopsis: story.sub,
    createdAt: now,
    updatedAt: now,
  };
}

function ensureStoryVaultDir(
  mythosRoot: string,
  displayName: string,
  pairedNotesVaultId: string | null,
): { id: string; absPath: string } {
  const reg = ensureStoryVaultRegistry(mythosRoot);
  const existing = reg.vaults.find((v) => v.displayName === displayName);
  if (existing) {
    return {
      id: existing.id,
      absPath: path.join(mythosRoot, existing.dirName),
    };
  }
  const id = crypto.randomUUID();
  const dirName = `${STORIES_GROUP_DIRNAME}/${safeFolderName(displayName)}`;
  const absPath = path.join(mythosRoot, dirName);
  fs.mkdirSync(absPath, { recursive: true });
  reg.vaults.push({
    id,
    displayName,
    dirName,
    createdAt: new Date().toISOString(),
    pairedNotesVaultId,
  });
  if (!reg.activeId) reg.activeId = id;
  writeStoryVaultRegistry(mythosRoot, { ...reg, version: VAULT_REGISTRY_VERSION });
  return { id, absPath };
}

export type ApplySeedWorldResult =
  | {
      ok: true;
      packId: string;
      mythosRoot: string;
      vaultName: string;
      storyVaultPath: string;
      notesVaultPath: string;
      world: string;
      storyTitles: string[];
    }
  | { ok: false; error: string };

/**
 * Materialize one seed pack into a new Mythos vault (or overwrite content of a
 * blank vault created for seeding). Never enables walkthrough product chrome.
 */
export function applySeedPackToNewVault(
  destinationParent: string,
  packId: 'mythos' | 'aether',
  opts: { seedPath?: string; exactName?: boolean } = {},
): ApplySeedWorldResult {
  const seed = loadSeedFile(opts.seedPath);
  if (!seedIsContentOnly(seed)) {
    return { ok: false, error: 'Seed file missing mythos/aether packs' };
  }
  const pack = seed.packs![packId];
  const vaultName = SEED_WORLD_NAMES[packId];
  const created = createMythosVault(destinationParent, {
    name: vaultName,
    exactName: opts.exactName === true,
    seedDemo: false,
  });
  if (!created.ok) return { ok: false, error: created.error };

  const mythosRoot = created.mythosRoot;
  try {
    const notesReg = ensureNotesVaultRegistry(mythosRoot);
    const notesId = notesReg.activeId ?? notesReg.vaults[0]?.id;
    const notesEntry = notesReg.vaults.find((v) => v.id === notesId) ?? notesReg.vaults[0];
    if (!notesEntry) return { ok: false, error: 'Seed apply: missing notes vault entry' };
    const notesRoot = path.join(mythosRoot, notesEntry.dirName);

    writeNotesTree(notesRoot, pack.vault, pack.notes);
    // Private / extra notes vaults (e.g. Caerwyn private notes)
    if (pack.noteVaults) {
      for (const [nvKey, nv] of Object.entries(pack.noteVaults)) {
        const id = crypto.randomUUID();
        const dirName = `${NOTES_GROUP_DIRNAME}/${safeFolderName(nvKey === 'n2' ? 'Private Notes' : nvKey)}`;
        const abs = path.join(mythosRoot, dirName);
        fs.mkdirSync(abs, { recursive: true });
        writeNotesTree(abs, nv.vault, pack.notes);
        notesReg.vaults.push({
          id,
          displayName: nvKey === 'n2' ? 'Private Notes' : nvKey,
          dirName,
          createdAt: new Date().toISOString(),
          origin: 'created',
        });
      }
      writeNotesVaultRegistry(mythosRoot, notesReg);
    }

    // Group stories by Story Vault name
    const bySvault = new Map<string, SeedStory[]>();
    for (const st of pack.stories ?? []) {
      const sv = st.svault?.trim() || 'Story';
      const list = bySvault.get(sv) ?? [];
      list.push(st);
      bySvault.set(sv, list);
    }

    // Remove default empty Story vault content listing; keep first as rename or add
    let storyReg = ensureStoryVaultRegistry(mythosRoot);
    const defaultStory = storyReg.vaults[0];
    const storyRefs: MythosStoryRef[] = [];
    let firstStoryAbs = created.storyVaultPath;
    let first = true;
    for (const [svName, stories] of bySvault) {
      let svId: string;
      let svAbs: string;
      if (first && defaultStory) {
        // Rename default Story vault display to first series name
        defaultStory.displayName = svName;
        writeStoryVaultRegistry(mythosRoot, storyReg);
        svId = defaultStory.id;
        svAbs = path.join(mythosRoot, defaultStory.dirName);
        first = false;
      } else {
        const createdSv = ensureStoryVaultDir(mythosRoot, svName, notesId ?? null);
        svId = createdSv.id;
        svAbs = createdSv.absPath;
        storyReg = ensureStoryVaultRegistry(mythosRoot);
      }
      if (svId && notesId) {
        const entry = storyReg.vaults.find((v) => v.id === svId);
        if (entry) entry.pairedNotesVaultId = notesId;
        writeStoryVaultRegistry(mythosRoot, storyReg);
      }
      for (const st of stories) {
        storyRefs.push(writeStoryManuscript(svAbs, st));
      }
      firstStoryAbs = firstStoryAbs || svAbs;
    }

    const mythos = tryReadMythosFile(mythosRoot);
    if (mythos) {
      writeMythosFile(mythosRoot, {
        ...mythos,
        name: vaultName,
        stories: storyRefs,
        seed: {
          layout: `${SEED_PACK_LAYOUT}:${packId}`,
          mode: 'blank',
          seededAt: new Date().toISOString(),
        },
      });
    }

    ensureAgentsPartnerFiles(mythosRoot);

    // World marker note so Probe/Soft-FAIL can distinguish vaults by DOM text.
    const world = pack.world ?? packId;
    writeFileAtomic(
      path.join(notesRoot, `World — ${safeFolderName(world)}.md`),
      `# World: ${world}\n\nSeed pack world marker for Slice D vault separation.\n`,
    );

    return {
      ok: true,
      packId,
      mythosRoot,
      vaultName,
      storyVaultPath: firstStoryAbs,
      notesVaultPath: notesRoot,
      world,
      storyTitles: storyRefs.map((s) => s.title),
    };
  } catch (e) {
    return { ok: false, error: `Seed apply failed: ${(e as Error).message}` };
  }
}

export type ApplyBothSeedWorldsResult =
  | {
      ok: true;
      worlds: ApplySeedWorldResult[];
    }
  | { ok: false; error: string };

/** Create both Mythos Vault + Shared Worlds under destinationParent. */
export function applyBothSeedWorlds(
  destinationParent: string,
  opts: { seedPath?: string } = {},
): ApplyBothSeedWorldsResult {
  const worlds: ApplySeedWorldResult[] = [];
  for (const packId of ['mythos', 'aether'] as const) {
    const r = applySeedPackToNewVault(destinationParent, packId, {
      seedPath: opts.seedPath,
      exactName: true,
    });
    worlds.push(r);
    if (!r.ok) return { ok: false, error: r.error };
  }
  return { ok: true, worlds };
}
