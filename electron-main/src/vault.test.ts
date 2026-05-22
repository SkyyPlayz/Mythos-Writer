// IPC round-trip integration test for vault operations.
// Uses a real temp directory — no Electron or fs mocking needed.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readVaultFile, writeVaultFile, listVaultFiles, deleteVaultFile } from './vault.js';

describe('IPC vault round-trip', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writeVaultFile then readVaultFile returns original content', () => {
    const content = 'Hello, Mythos Writer!';
    const filePath = 'test-scene.txt';

    const writeResult = writeVaultFile(tmpDir, filePath, content);
    expect(writeResult.path).toBe(filePath);
    expect(writeResult.bytes).toBe(Buffer.byteLength(content, 'utf-8'));

    const readResult = readVaultFile(tmpDir, filePath);
    expect(readResult.content).toBe(content);
    expect(readResult.path).toBe(filePath);
  });

  it('writeVaultFile creates nested directories automatically', () => {
    const content = 'Nested scene content';
    const filePath = 'chapters/chapter-1/scene-1.txt';

    writeVaultFile(tmpDir, filePath, content);
    const readResult = readVaultFile(tmpDir, filePath);
    expect(readResult.content).toBe(content);
  });

  it('listVaultFiles returns written files', () => {
    writeVaultFile(tmpDir, 'scene-a.txt', 'a');
    writeVaultFile(tmpDir, 'scene-b.txt', 'b');

    const { items } = listVaultFiles(tmpDir);
    const names = items.map((i) => i.name);
    expect(names).toContain('scene-a.txt');
    expect(names).toContain('scene-b.txt');
  });

  it('deleteVaultFile removes the file and reports deleted=true', () => {
    writeVaultFile(tmpDir, 'to-delete.txt', 'bye');
    const result = deleteVaultFile(tmpDir, 'to-delete.txt');
    expect(result.deleted).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'to-delete.txt'))).toBe(false);
  });

  it('deleteVaultFile on missing file reports deleted=false', () => {
    const result = deleteVaultFile(tmpDir, 'nonexistent.txt');
    expect(result.deleted).toBe(false);
  });

  it('readVaultFile rejects path traversal', () => {
    expect(() => readVaultFile(tmpDir, '../../../etc/passwd')).toThrow('Path traversal denied');
  });
});
