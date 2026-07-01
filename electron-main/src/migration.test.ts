// SKY-10: Legacy single-file-per-chapter migration.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildMigrationPlans, applyMigrationPlan } from './migration.js';
import { listVersions } from './versions.js';

function seedVault(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-mig-'));
  fs.mkdirSync(path.join(root, 'Manuscript', 'A Story'), { recursive: true });
  return root;
}

function writeLegacyChapter(
  vaultRoot: string,
  storyRel: string,
  filename: string,
  body: string,
): string {
  const rel = path.posix.join(storyRel, filename);
  fs.writeFileSync(path.join(vaultRoot, rel), body, 'utf-8');
  return rel;
}

describe('buildMigrationPlans — detection', () => {
  let vaultRoot: string;
  const storyRel = path.posix.join('Manuscript', 'A Story');

  beforeEach(() => {
    vaultRoot = seedVault();
  });

  afterEach(() => {
    fs.rmSync(vaultRoot, { recursive: true, force: true });
  });

  it('returns no plans when story has no legacy chapter files', () => {
    fs.mkdirSync(path.join(vaultRoot, storyRel, '01 - Opening'), { recursive: true });
    expect(buildMigrationPlans(vaultRoot)).toEqual([]);
  });

  it('ignores reserved files (Outline.md, Synopsis.md)', () => {
    fs.writeFileSync(path.join(vaultRoot, storyRel, 'Outline.md'), 'outline');
    fs.writeFileSync(path.join(vaultRoot, storyRel, 'Synopsis.md'), 'synopsis');
    expect(buildMigrationPlans(vaultRoot)).toEqual([]);
  });

  it('detects a legacy chapter file and produces a single plan with the expected changes', () => {
    writeLegacyChapter(vaultRoot, storyRel, '01 - Opening.md', '# Scene 1\nHello');
    const plans = buildMigrationPlans(vaultRoot);
    expect(plans).toHaveLength(1);
    expect(plans[0].storyPath).toBe(storyRel);
    expect(plans[0].detectedLegacyFiles).toEqual([path.posix.join(storyRel, '01 - Opening.md')]);
    const kinds = plans[0].changes.map((c) => c.kind);
    expect(kinds).toContain('create-dir');
    expect(kinds).toContain('write-file');
    expect(kinds).toContain('snapshot-legacy');
    expect(kinds).toContain('unlink-file');
  });

  it('skips chapters where a same-named folder already exists (partial migration)', () => {
    writeLegacyChapter(vaultRoot, storyRel, '01 - Opening.md', '# X');
    fs.mkdirSync(path.join(vaultRoot, storyRel, '01 - Opening'), { recursive: true });
    expect(buildMigrationPlans(vaultRoot)).toEqual([]);
  });
});

describe('applyMigrationPlan — execution + reversibility', () => {
  let vaultRoot: string;
  const storyRel = path.posix.join('Manuscript', 'A Story');

  beforeEach(() => {
    vaultRoot = seedVault();
  });

  afterEach(() => {
    fs.rmSync(vaultRoot, { recursive: true, force: true });
  });

  it('splits a two-scene chapter into per-scene .md files + chapter.md', () => {
    const legacyBody = [
      '---',
      'id: ch-legacy',
      'title: 01 - Opening',
      '---',
      'A short epigraph.',
      '',
      '# Scene Alpha',
      'Alpha prose.',
      '',
      '# Scene Beta',
      'Beta prose.',
    ].join('\n');
    writeLegacyChapter(vaultRoot, storyRel, '01 - Opening.md', legacyBody);

    const [plan] = buildMigrationPlans(vaultRoot);
    const result = applyMigrationPlan(vaultRoot, plan.storyPath, plan.planId);
    expect(result.appliedChanges).toBeGreaterThan(0);

    const chapterRel = path.posix.join(storyRel, '01 - Opening');
    const chapterAbs = path.join(vaultRoot, chapterRel);
    expect(fs.existsSync(path.join(chapterAbs, 'chapter.md'))).toBe(true);
    const files = fs.readdirSync(chapterAbs).filter((f) => f.endsWith('.md'));
    expect(files.length).toBe(3); // chapter.md + 2 scenes
    expect(fs.existsSync(path.join(vaultRoot, storyRel, '01 - Opening.md'))).toBe(false);
  });

  it('writes a migration-intent snapshot before unlinking the legacy file (reversible)', () => {
    writeLegacyChapter(vaultRoot, storyRel, '02 - Middle.md', '---\nid: ch-mid\ntitle: 02 - Middle\n---\nProse.');
    const [plan] = buildMigrationPlans(vaultRoot);
    applyMigrationPlan(vaultRoot, plan.storyPath, plan.planId);
    const chapterRel = path.posix.join(storyRel, '02 - Middle');
    const versions = listVersions(vaultRoot, 'ch-mid', { chapterRelPath: chapterRel });
    expect(versions).toHaveLength(1);
    expect(versions[0].intent).toBe('migration');
    expect(versions[0].content).toContain('Prose.');
  });

  it('is idempotent — running twice does not duplicate work', () => {
    writeLegacyChapter(vaultRoot, storyRel, '03 - End.md', '---\nid: ch-end\n---\nPlain');
    const [plan] = buildMigrationPlans(vaultRoot);
    applyMigrationPlan(vaultRoot, plan.storyPath, plan.planId);
    const second = applyMigrationPlan(vaultRoot, plan.storyPath, plan.planId);
    expect(second.appliedChanges).toBe(0);
    expect(buildMigrationPlans(vaultRoot)).toEqual([]);
  });

  it('rejects an unknown planId (GH#636)', () => {
    writeLegacyChapter(vaultRoot, storyRel, 'Ch.md', 'prose');
    expect(() => applyMigrationPlan(vaultRoot, storyRel, crypto.randomUUID())).toThrow(
      /unknown or stale/i,
    );
  });

  it('rejects a stale plan when the file set expands after dry-run (GH#636)', () => {
    writeLegacyChapter(vaultRoot, storyRel, 'Ch1.md', 'prose1');
    const [plan] = buildMigrationPlans(vaultRoot);
    // Add a new legacy file after the dry-run, expanding the detected set.
    writeLegacyChapter(vaultRoot, storyRel, 'Ch2.md', 'prose2');
    expect(() => applyMigrationPlan(vaultRoot, plan.storyPath, plan.planId)).toThrow(
      /stale/i,
    );
  });

  it('handles a chapter file without headings as a single Scene One', () => {
    writeLegacyChapter(
      vaultRoot,
      storyRel,
      '04 - Solo.md',
      '---\nid: ch-solo\ntitle: 04 - Solo\n---\nJust plain prose.',
    );
    const [plan] = buildMigrationPlans(vaultRoot);
    applyMigrationPlan(vaultRoot, plan.storyPath, plan.planId);
    const chapterRel = path.posix.join(storyRel, '04 - Solo');
    const files = fs.readdirSync(path.join(vaultRoot, chapterRel)).filter((f) => f.endsWith('.md'));
    expect(files).toContain('chapter.md');
    const sceneFiles = files.filter((f) => f !== 'chapter.md');
    expect(sceneFiles).toHaveLength(1);
  });
});

describe('security — storyPathHint containment (GH#634)', () => {
  let vaultRoot: string;
  const storyRel = path.posix.join('Manuscript', 'A Story');

  beforeEach(() => {
    vaultRoot = seedVault();
  });

  afterEach(() => {
    fs.rmSync(vaultRoot, { recursive: true, force: true });
  });

  it('rejects a "../.." traversal hint', () => {
    expect(() => buildMigrationPlans(vaultRoot, '../..')).toThrow(/path traversal denied/i);
  });

  it('rejects an absolute path hint', () => {
    expect(() => buildMigrationPlans(vaultRoot, '/etc/passwd')).toThrow(/path traversal denied/i);
  });

  it('accepts a valid vault-relative Manuscript/<story> hint', () => {
    writeLegacyChapter(vaultRoot, storyRel, 'Ch.md', 'prose');
    expect(() => buildMigrationPlans(vaultRoot, storyRel)).not.toThrow();
  });
});
