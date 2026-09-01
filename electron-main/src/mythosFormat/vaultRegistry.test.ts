// SKY-11150 — unit tests for the generic vault registry core.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  VaultRegistryConfig,
  VaultEntry,
  ensureVaultRegistry,
  createBlankVaultEntry,
  setActiveVault,
  renameVaultEntry,
  registerExistingVaultEntry,
  readVaultRegistry,
  vaultAbsPath,
} from './vaultRegistry.js';

interface TestEntry extends VaultEntry {
  kind: 'test';
}

const TEST_CONFIG: VaultRegistryConfig = {
  registryFilename: 'test-vaults.json',
  defaultDirName: 'Test Vault',
  defaultDisplayName: 'Test',
};

function makeTestEntry(base: VaultEntry): TestEntry {
  return { ...base, kind: 'test' };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-test-'));
  fs.mkdirSync(path.join(tmpDir, TEST_CONFIG.defaultDirName));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ensureVaultRegistry', () => {
  it('creates registry with one entry on first call', () => {
    const registry = ensureVaultRegistry(tmpDir, TEST_CONFIG, makeTestEntry);
    expect(registry.vaults).toHaveLength(1);
    expect(registry.vaults[0].displayName).toBe('Test');
    expect(registry.vaults[0].dirName).toBe(TEST_CONFIG.defaultDirName);
    expect((registry.vaults[0] as TestEntry).kind).toBe('test');
    expect(registry.activeId).toBe(registry.vaults[0].id);
  });

  it('is idempotent — second call returns same registry', () => {
    const first = ensureVaultRegistry(tmpDir, TEST_CONFIG, makeTestEntry);
    const second = ensureVaultRegistry(tmpDir, TEST_CONFIG, makeTestEntry);
    expect(second.vaults[0].id).toBe(first.vaults[0].id);
  });

  it('writes registry file to mythosRoot', () => {
    ensureVaultRegistry(tmpDir, TEST_CONFIG, makeTestEntry);
    expect(fs.existsSync(path.join(tmpDir, TEST_CONFIG.registryFilename))).toBe(true);
  });
});

describe('createBlankVaultEntry', () => {
  it('creates directory and appends entry', () => {
    ensureVaultRegistry(tmpDir, TEST_CONFIG, makeTestEntry);
    const { entry } = createBlankVaultEntry(tmpDir, TEST_CONFIG, 'Extra', makeTestEntry);
    expect(fs.existsSync(vaultAbsPath(tmpDir, entry))).toBe(true);
  });

  it('deduplicates dirName when slug collides', () => {
    ensureVaultRegistry(tmpDir, TEST_CONFIG, makeTestEntry);
    const { entry: a } = createBlankVaultEntry(tmpDir, TEST_CONFIG, 'Extra', makeTestEntry);
    const { entry: b } = createBlankVaultEntry(tmpDir, TEST_CONFIG, 'Extra', makeTestEntry);
    expect(a.dirName).not.toBe(b.dirName);
  });

  it('does not change activeId', () => {
    const initial = ensureVaultRegistry(tmpDir, TEST_CONFIG, makeTestEntry);
    const { registry } = createBlankVaultEntry(tmpDir, TEST_CONFIG, 'Another', makeTestEntry);
    expect(registry.activeId).toBe(initial.activeId);
  });

  it('preserves extra fields from makeEntry', () => {
    ensureVaultRegistry(tmpDir, TEST_CONFIG, makeTestEntry);
    const { entry } = createBlankVaultEntry(tmpDir, TEST_CONFIG, 'Kind Test', makeTestEntry);
    expect((entry as TestEntry).kind).toBe('test');
  });
});

describe('setActiveVault', () => {
  it('updates activeId to the new vault', () => {
    ensureVaultRegistry(tmpDir, TEST_CONFIG, makeTestEntry);
    const { entry } = createBlankVaultEntry(tmpDir, TEST_CONFIG, 'Second', makeTestEntry);
    const { registry } = setActiveVault<TestEntry>(tmpDir, TEST_CONFIG, entry.id);
    expect(registry.activeId).toBe(entry.id);
  });

  it('throws on unknown id', () => {
    ensureVaultRegistry(tmpDir, TEST_CONFIG, makeTestEntry);
    expect(() => setActiveVault(tmpDir, TEST_CONFIG, 'does-not-exist')).toThrow();
  });

  it('persists the change to disk', () => {
    ensureVaultRegistry(tmpDir, TEST_CONFIG, makeTestEntry);
    const { entry } = createBlankVaultEntry(tmpDir, TEST_CONFIG, 'Second', makeTestEntry);
    setActiveVault(tmpDir, TEST_CONFIG, entry.id);
    const onDisk = readVaultRegistry<TestEntry>(tmpDir, TEST_CONFIG);
    expect(onDisk?.activeId).toBe(entry.id);
  });
});

describe('renameVaultEntry', () => {
  it('updates displayName only, leaves dirName unchanged', () => {
    const initial = ensureVaultRegistry(tmpDir, TEST_CONFIG, makeTestEntry);
    const origDirName = initial.vaults[0].dirName;
    const { entry } = renameVaultEntry(tmpDir, TEST_CONFIG, initial.vaults[0].id, 'Renamed');
    expect(entry.displayName).toBe('Renamed');
    expect(entry.dirName).toBe(origDirName);
  });

  it('throws on unknown id', () => {
    ensureVaultRegistry(tmpDir, TEST_CONFIG, makeTestEntry);
    expect(() => renameVaultEntry(tmpDir, TEST_CONFIG, 'bad-id', 'X')).toThrow();
  });

  it('preserves extra fields on rename', () => {
    const initial = ensureVaultRegistry(tmpDir, TEST_CONFIG, makeTestEntry);
    const { entry } = renameVaultEntry(tmpDir, TEST_CONFIG, initial.vaults[0].id, 'Renamed');
    expect((entry as TestEntry).kind).toBe('test');
  });
});

describe('registerExistingVaultEntry', () => {
  it('adds entry with given dirName', () => {
    ensureVaultRegistry(tmpDir, TEST_CONFIG, makeTestEntry);
    const importDir = 'Imported Vault';
    fs.mkdirSync(path.join(tmpDir, importDir));
    const { entry } = registerExistingVaultEntry(tmpDir, TEST_CONFIG, importDir, 'Imported', makeTestEntry);
    expect(entry.dirName).toBe(importDir);
    expect(entry.displayName).toBe('Imported');
  });
});
