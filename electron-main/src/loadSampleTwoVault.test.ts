// SKY-12.3: integration tests for the two-vault sample project copy logic.
// Uses the real sample-project/ directory (from repo root) and a temp dir target.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Resolve sample-project relative to this file (electron-main/src/ → repo root/sample-project)
const SAMPLE_PROJECT_DIR = path.resolve(import.meta.dirname, '..', '..', 'sample-project');

function copySampleProject(sampleDir: string, parentPath: string): { storyVaultPath: string; notesVaultPath: string; error?: string } {
  if (!fs.existsSync(sampleDir)) {
    return { storyVaultPath: '', notesVaultPath: '', error: `Sample bundle not found: ${sampleDir}` };
  }
  const storyVaultPath = path.join(parentPath, 'Story Vault');
  const notesVaultPath = path.join(parentPath, 'Notes Vault');

  const isEmptyOrMissing = (p: string) => !fs.existsSync(p) || fs.readdirSync(p).length === 0;
  for (const [label, target] of [['Story Vault', storyVaultPath], ['Notes Vault', notesVaultPath]] as const) {
    if (fs.existsSync(target) && !isEmptyOrMissing(target)) {
      return { storyVaultPath: '', notesVaultPath: '', error: `Target for ${label} already exists and is not empty: ${target}` };
    }
  }
  try {
    fs.cpSync(path.join(sampleDir, 'story-vault'), storyVaultPath, { recursive: true, force: false });
    fs.cpSync(path.join(sampleDir, 'notes-vault'), notesVaultPath, { recursive: true, force: false });
  } catch (err) {
    return { storyVaultPath: '', notesVaultPath: '', error: `Copy failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { storyVaultPath, notesVaultPath };
}

describe('loadSampleTwoVault — copy logic', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky33-sample-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('copies story-vault and notes-vault into the parent directory', () => {
    const result = copySampleProject(SAMPLE_PROJECT_DIR, tmpDir);
    expect(result.error).toBeUndefined();
    expect(result.storyVaultPath).toBe(path.join(tmpDir, 'Story Vault'));
    expect(result.notesVaultPath).toBe(path.join(tmpDir, 'Notes Vault'));
    expect(fs.existsSync(result.storyVaultPath)).toBe(true);
    expect(fs.existsSync(result.notesVaultPath)).toBe(true);
  });

  it('Story Vault contains the sample story folder', () => {
    copySampleProject(SAMPLE_PROJECT_DIR, tmpDir);
    const storyVault = path.join(tmpDir, 'Story Vault');
    expect(fs.existsSync(path.join(storyVault, 'The Glass Library'))).toBe(true);
  });

  it('Notes Vault contains Universes/Argent directory', () => {
    copySampleProject(SAMPLE_PROJECT_DIR, tmpDir);
    const notesVault = path.join(tmpDir, 'Notes Vault');
    expect(fs.existsSync(path.join(notesVault, 'Universes', 'Argent'))).toBe(true);
  });

  it('Notes Vault contains Characters with sample files', () => {
    copySampleProject(SAMPLE_PROJECT_DIR, tmpDir);
    const chars = path.join(tmpDir, 'Notes Vault', 'Universes', 'Argent', 'Characters');
    const files = fs.readdirSync(chars);
    expect(files).toContain('Mira Halloway.md');
    expect(files).toContain('Custodian Bell.md');
  });

  it('sample markdown files carry source: sample provenance frontmatter', () => {
    copySampleProject(SAMPLE_PROJECT_DIR, tmpDir);
    const mira = path.join(tmpDir, 'Notes Vault', 'Universes', 'Argent', 'Characters', 'Mira Halloway.md');
    const content = fs.readFileSync(mira, 'utf-8');
    expect(content).toContain('source: sample');
    expect(content).toContain('provenance: bundled');
  });

  it('is idempotent when target is empty', () => {
    // First copy
    copySampleProject(SAMPLE_PROJECT_DIR, tmpDir);
    // Remove the copies so target is empty again
    fs.rmSync(path.join(tmpDir, 'Story Vault'), { recursive: true });
    fs.rmSync(path.join(tmpDir, 'Notes Vault'), { recursive: true });
    // Second copy should succeed
    const result = copySampleProject(SAMPLE_PROJECT_DIR, tmpDir);
    expect(result.error).toBeUndefined();
    expect(fs.existsSync(result.storyVaultPath)).toBe(true);
  });

  it('returns an error when target Story Vault already exists and is non-empty', () => {
    const storyVault = path.join(tmpDir, 'Story Vault');
    fs.mkdirSync(storyVault, { recursive: true });
    fs.writeFileSync(path.join(storyVault, 'existing.md'), '# hi');
    const result = copySampleProject(SAMPLE_PROJECT_DIR, tmpDir);
    expect(result.error).toMatch(/Story Vault.*not empty/);
    expect(result.storyVaultPath).toBe('');
  });

  it('returns an error when sample bundle does not exist', () => {
    const result = copySampleProject('/nonexistent/path/sample-project', tmpDir);
    expect(result.error).toMatch(/not found/);
  });
});
