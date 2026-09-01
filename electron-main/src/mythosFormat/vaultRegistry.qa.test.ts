// SKY-11163 — QA independent acceptance tests for generic vaultRegistry (SKY-11150 / PR#1374).
//
// Written from the SPEC (SKY-11141), NOT from the implementation.
// Spec invariants:
//   R1. ensureVaultRegistry is idempotent — two calls yield the same active ID.
//   R2. setActiveVault changes activeId; does not alter the vault list.
//   R3. createBlankVaultEntry creates a directory on disk and appends an entry.
//   R4. registerExistingVaultEntry does NOT create a directory — registers only.
//   R5. renameVaultEntry updates displayName; dirName is immutable.
//   R6. The registry file is written to mythosRoot/<registryFilename>.
//   R7. readVaultRegistry returns null when the file does not exist.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  VaultRegistryConfig,
  VaultEntry,
  ensureVaultRegistry,
  setActiveVault,
  createBlankVaultEntry,
  registerExistingVaultEntry,
  renameVaultEntry,
  readVaultRegistry,
  vaultAbsPath,
} from './vaultRegistry.js';

interface QAEntry extends VaultEntry {
  qa: true;
}

const QA_CONFIG: VaultRegistryConfig = {
  registryFilename: 'qa-test-vaults.json',
  defaultDirName: 'QA Default Vault',
  defaultDisplayName: 'QA Default',
};

function makeQAEntry(base: VaultEntry): QAEntry {
  return { ...base, qa: true };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-vr-'));
  fs.mkdirSync(path.join(tmpDir, QA_CONFIG.defaultDirName));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── R1: idempotency ──────────────────────────────────────────────────────────

describe('[QA] ensureVaultRegistry — idempotency (R1)', () => {
  it('returns the same activeId on repeated calls', () => {
    const first = ensureVaultRegistry(tmpDir, QA_CONFIG, makeQAEntry);
    const second = ensureVaultRegistry(tmpDir, QA_CONFIG, makeQAEntry);
    expect(second.activeId).toBe(first.activeId);
  });

  it('does not append a duplicate entry on second call', () => {
    ensureVaultRegistry(tmpDir, QA_CONFIG, makeQAEntry);
    const second = ensureVaultRegistry(tmpDir, QA_CONFIG, makeQAEntry);
    expect(second.vaults).toHaveLength(1);
  });
});

// ─── R2: setActiveVault ───────────────────────────────────────────────────────

describe('[QA] setActiveVault — changes active, not list (R2)', () => {
  it('updates activeId to the newly selected entry', () => {
    const registry = ensureVaultRegistry(tmpDir, QA_CONFIG, makeQAEntry);
    fs.mkdirSync(path.join(tmpDir, 'Second Vault'));
    const { entry: second } = createBlankVaultEntry(tmpDir, QA_CONFIG, 'Second', makeQAEntry);
    const { registry: updated } = setActiveVault(tmpDir, QA_CONFIG, second.id);
    expect(updated.activeId).toBe(second.id);
    expect(updated.activeId).not.toBe(registry.activeId);
  });

  it('does not change the vault count', () => {
    ensureVaultRegistry(tmpDir, QA_CONFIG, makeQAEntry);
    fs.mkdirSync(path.join(tmpDir, 'Extra'));
    const { entry } = createBlankVaultEntry(tmpDir, QA_CONFIG, 'Extra', makeQAEntry);
    const before = readVaultRegistry<QAEntry>(tmpDir, QA_CONFIG)?.vaults.length ?? 0;
    setActiveVault(tmpDir, QA_CONFIG, entry.id);
    const after = readVaultRegistry<QAEntry>(tmpDir, QA_CONFIG)?.vaults.length ?? 0;
    expect(after).toBe(before);
  });
});

// ─── R3: createBlankVaultEntry ────────────────────────────────────────────────

describe('[QA] createBlankVaultEntry — disk + registry (R3)', () => {
  it('creates a directory at the returned path', () => {
    ensureVaultRegistry(tmpDir, QA_CONFIG, makeQAEntry);
    const { entry } = createBlankVaultEntry(tmpDir, QA_CONFIG, 'Novel', makeQAEntry);
    expect(fs.existsSync(vaultAbsPath(tmpDir, entry))).toBe(true);
  });

  it('appends the entry so registry now has 2 vaults', () => {
    ensureVaultRegistry(tmpDir, QA_CONFIG, makeQAEntry);
    createBlankVaultEntry(tmpDir, QA_CONFIG, 'Novel', makeQAEntry);
    const registry = readVaultRegistry<QAEntry>(tmpDir, QA_CONFIG);
    expect(registry?.vaults).toHaveLength(2);
  });
});

// ─── R4: registerExistingVaultEntry ──────────────────────────────────────────

describe('[QA] registerExistingVaultEntry — no mkdir (R4)', () => {
  it('does not create a directory — registers only', () => {
    ensureVaultRegistry(tmpDir, QA_CONFIG, makeQAEntry);
    const { entry } = registerExistingVaultEntry(
      tmpDir,
      QA_CONFIG,
      'existing-vault-dir',
      'Existing',
      makeQAEntry,
    );
    // The dir must NOT have been created by registerExistingVaultEntry.
    expect(fs.existsSync(vaultAbsPath(tmpDir, entry))).toBe(false);
  });

  it('adds the entry to the registry', () => {
    ensureVaultRegistry(tmpDir, QA_CONFIG, makeQAEntry);
    registerExistingVaultEntry(
      tmpDir,
      QA_CONFIG,
      'legacy-dir',
      'Legacy',
      makeQAEntry,
    );
    const registry = readVaultRegistry<QAEntry>(tmpDir, QA_CONFIG);
    expect(registry?.vaults.some((v) => v.displayName === 'Legacy')).toBe(true);
  });
});

// ─── R5: renameVaultEntry ─────────────────────────────────────────────────────

describe('[QA] renameVaultEntry — displayName updates, dirName immutable (R5)', () => {
  it('updates displayName but does NOT change dirName', () => {
    const reg = ensureVaultRegistry(tmpDir, QA_CONFIG, makeQAEntry);
    const original = reg.vaults[0];
    renameVaultEntry(tmpDir, QA_CONFIG, original.id, 'New Display Name');
    const updated = readVaultRegistry<QAEntry>(tmpDir, QA_CONFIG);
    const entry = updated?.vaults.find((v) => v.id === original.id);
    expect(entry?.displayName).toBe('New Display Name');
    expect(entry?.dirName).toBe(original.dirName);
  });
});

// ─── R6: registry file location ───────────────────────────────────────────────

describe('[QA] registry file location (R6)', () => {
  it('writes registry at <mythosRoot>/<registryFilename>', () => {
    ensureVaultRegistry(tmpDir, QA_CONFIG, makeQAEntry);
    const expectedPath = path.join(tmpDir, QA_CONFIG.registryFilename);
    expect(fs.existsSync(expectedPath)).toBe(true);
  });
});

// ─── R7: readVaultRegistry returns null on missing file ───────────────────────

describe('[QA] readVaultRegistry — null on missing file (R7)', () => {
  it('returns null for a directory with no registry file', () => {
    const result = readVaultRegistry<QAEntry>(tmpDir, QA_CONFIG);
    expect(result).toBeNull();
  });
});
