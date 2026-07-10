// W0.1 (Beta 4, GAP-REPORT-v2 P0 #1) — seed-once regression tests.
// Real temp directories, no mocks: these drive the same scaffolds the boot
// path runs and assert the resulting trees byte-for-byte (names + structure).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  scaffoldNotesVault,
  scaffoldStoryVault,
  isEmptyOrMissing,
  type VaultLayoutMode,
} from './vault.js';
import {
  ensureVaultSeeded,
  hasSeedMarker,
  writeSeedMarker,
  seedMarkerPath,
  SEED_MARKER_FILENAME,
  NOTES_VAULT_SEED_LAYOUT,
  STORY_VAULT_SEED_LAYOUT,
  type SeedRegistry,
} from './vaultSeeding.js';

/** Recursive, sorted, relative snapshot of a directory tree (dirs get a trailing /). */
function treeSnapshot(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      out.push(entry.isDirectory() ? `${rel}/` : rel);
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
    }
  };
  walk(root, '');
  return out;
}

function makeMemoryRegistry(): SeedRegistry & { roots: Set<string> } {
  const roots = new Set<string>();
  return {
    roots,
    has: (root: string) => roots.has(path.resolve(root)),
    add: (root: string) => {
      roots.add(path.resolve(root));
    },
  };
}

/**
 * The shipped beta's boot-init seeding, verbatim (main.ts pre-W0.1):
 * the only guard was the stateless empty-dir heuristic.
 */
function legacyEnsureNotesVaultDir(notesVaultRoot: string, mode: VaultLayoutMode): void {
  if (!fs.existsSync(notesVaultRoot)) {
    fs.mkdirSync(notesVaultRoot, { recursive: true });
  }
  if (isEmptyOrMissing(notesVaultRoot)) {
    scaffoldNotesVault(notesVaultRoot, mode);
  }
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-seed-once-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Reproduction: the GAP #1 mechanism exists without a marker ─────────────

describe('GAP #1 reproduction — legacy empty-heuristic seeding re-arms', () => {
  it('legacy boot-init re-seeds a vault the user emptied (the shipped bug)', () => {
    const root = path.join(tmpDir, 'Notes Vault');
    legacyEnsureNotesVaultDir(root, 'default'); // boot 1 — seeds
    expect(fs.existsSync(path.join(root, 'Universes'))).toBe(true);

    // User empties their notes vault on purpose.
    for (const entry of fs.readdirSync(root)) {
      fs.rmSync(path.join(root, entry), { recursive: true, force: true });
    }

    legacyEnsureNotesVaultDir(root, 'default'); // boot 2 — re-seeds. BUG.
    expect(fs.existsSync(path.join(root, 'Universes'))).toBe(true);
  });

  it('seed-once boot-init does NOT re-seed the emptied vault (the W0.1 fix)', () => {
    const root = path.join(tmpDir, 'Notes Vault');
    const registry = makeMemoryRegistry();
    const boot = () =>
      ensureVaultSeeded({
        root,
        mode: 'default',
        layout: NOTES_VAULT_SEED_LAYOUT,
        scaffold: scaffoldNotesVault,
        registry,
      });

    expect(boot().seeded).toBe(true); // boot 1 — seeds once
    for (const entry of fs.readdirSync(root)) {
      fs.rmSync(path.join(root, entry), { recursive: true, force: true });
    }
    expect(boot().seeded).toBe(false); // boot 2 — marker (registry) holds
    expect(fs.readdirSync(root)).toEqual([]); // stays exactly as the user left it
  });
});

// ─── W0.1 acceptance: two consecutive boots → byte-identical trees ──────────

describe('ensureVaultSeeded — boot twice produces an identical tree', () => {
  it('notes vault: second boot changes nothing', () => {
    const root = path.join(tmpDir, 'Notes Vault');
    const registry = makeMemoryRegistry();
    const boot = () =>
      ensureVaultSeeded({
        root,
        mode: 'default',
        layout: NOTES_VAULT_SEED_LAYOUT,
        scaffold: scaffoldNotesVault,
        registry,
      });

    const first = boot();
    const afterBoot1 = treeSnapshot(root);
    const second = boot();
    const afterBoot2 = treeSnapshot(root);

    expect(first.seeded).toBe(true);
    expect(second.seeded).toBe(false);
    expect(afterBoot2).toEqual(afterBoot1);
    // Prototype-named folders only — exactly one of each seed dir.
    expect(afterBoot1.filter((p) => p === 'Universes/')).toHaveLength(1);
    expect(afterBoot1.filter((p) => p === 'Archive/')).toHaveLength(1);
  });

  it('story vault: second boot changes nothing', () => {
    const root = path.join(tmpDir, 'Story Vault');
    const registry = makeMemoryRegistry();
    const boot = () =>
      ensureVaultSeeded({
        root,
        mode: 'default',
        layout: STORY_VAULT_SEED_LAYOUT,
        scaffold: scaffoldStoryVault,
        registry,
      });

    expect(boot().seeded).toBe(true);
    const afterBoot1 = treeSnapshot(root);
    expect(boot().seeded).toBe(false);
    expect(treeSnapshot(root)).toEqual(afterBoot1);
  });

  it('survives losing the settings registry (sentinel file half still guards)', () => {
    const root = path.join(tmpDir, 'Notes Vault');
    const boot = (registry: SeedRegistry) =>
      ensureVaultSeeded({
        root,
        mode: 'default',
        layout: NOTES_VAULT_SEED_LAYOUT,
        scaffold: scaffoldNotesVault,
        registry,
      });

    expect(boot(makeMemoryRegistry()).seeded).toBe(true);
    const afterBoot1 = treeSnapshot(root);
    // Fresh registry simulates vault-settings.json being lost/reset between boots.
    expect(boot(makeMemoryRegistry()).seeded).toBe(false);
    expect(treeSnapshot(root)).toEqual(afterBoot1);
  });

  it('survives losing the sentinel file (registry half still guards)', () => {
    const root = path.join(tmpDir, 'Notes Vault');
    const registry = makeMemoryRegistry();
    const boot = () =>
      ensureVaultSeeded({
        root,
        mode: 'default',
        layout: NOTES_VAULT_SEED_LAYOUT,
        scaffold: scaffoldNotesVault,
        registry,
      });

    expect(boot().seeded).toBe(true);
    fs.rmSync(seedMarkerPath(root));
    // Also empty the vault so the legacy heuristic WOULD have re-seeded.
    for (const entry of fs.readdirSync(root)) {
      fs.rmSync(path.join(root, entry), { recursive: true, force: true });
    }
    expect(boot().seeded).toBe(false);
    expect(fs.readdirSync(root)).toEqual([]);
  });
});

// ─── Adoption + blank-mode semantics ─────────────────────────────────────────

describe('ensureVaultSeeded — pre-marker and blank vaults', () => {
  it('adopts an already-populated pre-marker vault without scaffolding into it', () => {
    const root = path.join(tmpDir, 'Existing Vault');
    fs.mkdirSync(path.join(root, 'My Own Notes'), { recursive: true });
    fs.writeFileSync(path.join(root, 'My Own Notes', 'idea.md'), '# Idea', 'utf-8');

    const registry = makeMemoryRegistry();
    const result = ensureVaultSeeded({
      root,
      mode: 'default',
      layout: NOTES_VAULT_SEED_LAYOUT,
      scaffold: scaffoldNotesVault,
      registry,
    });

    expect(result.seeded).toBe(false);
    expect(fs.existsSync(path.join(root, 'Universes'))).toBe(false); // no seed dumped in
    expect(hasSeedMarker(root)).toBe(true); // but the decision is now durable
    expect(registry.has(root)).toBe(true);
  });

  it('blank mode records the decision without creating seed folders', () => {
    const root = path.join(tmpDir, 'Blank Vault');
    const registry = makeMemoryRegistry();
    const result = ensureVaultSeeded({
      root,
      mode: 'blank',
      layout: NOTES_VAULT_SEED_LAYOUT,
      scaffold: scaffoldNotesVault,
      registry,
    });

    expect(result.seeded).toBe(true);
    expect(fs.readdirSync(root)).toEqual([SEED_MARKER_FILENAME]);

    // A later layoutMode flip to 'default' must NOT seed into the blank vault.
    const flipped = ensureVaultSeeded({
      root,
      mode: 'default',
      layout: NOTES_VAULT_SEED_LAYOUT,
      scaffold: scaffoldNotesVault,
      registry,
    });
    expect(flipped.seeded).toBe(false);
    expect(fs.existsSync(path.join(root, 'Universes'))).toBe(false);
  });

  it('backfills the registry when only the sentinel exists', () => {
    const root = path.join(tmpDir, 'Synced Vault');
    fs.mkdirSync(root, { recursive: true });
    writeSeedMarker(root, { layout: NOTES_VAULT_SEED_LAYOUT, mode: 'default' });

    const registry = makeMemoryRegistry();
    const result = ensureVaultSeeded({
      root,
      mode: 'default',
      layout: NOTES_VAULT_SEED_LAYOUT,
      scaffold: scaffoldNotesVault,
      registry,
    });

    expect(result.seeded).toBe(false);
    expect(registry.has(root)).toBe(true);
    expect(fs.existsSync(path.join(root, 'Universes'))).toBe(false);
  });

  it('creates a missing root directory before deciding', () => {
    const root = path.join(tmpDir, 'brand-new', 'Notes Vault');
    const result = ensureVaultSeeded({
      root,
      mode: 'default',
      layout: NOTES_VAULT_SEED_LAYOUT,
      scaffold: scaffoldNotesVault,
    });
    expect(result.seeded).toBe(true);
    expect(fs.existsSync(path.join(root, 'Universes'))).toBe(true);
    expect(hasSeedMarker(root)).toBe(true);
  });
});
