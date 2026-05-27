// Performance budget bench — 1 000 scenes / 5 000 notes / 500 MB vault targets.
// Run: npm run perf  (from electron-main/)
// Outputs: plans/PERF_BUDGET.md and plans/PERF_BASELINE.json
//
// Regression policy: any metric > 25% slower than the last green baseline fails CI.
// Update baseline intentionally: PERF_UPDATE_BASELINE=1 npm run perf

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

import { openDb, closeDb, getDb } from './db.js';
import { buildFullIndex, searchVault } from './search.js';
import { reindexVault, defaultManifest, writeSceneFile, writeEntityFile } from './vault.js';
import { buildArchiveIndex, getArchiveIndex, runArchiveScan } from './archiveAgent.js';
import type { Manifest, SceneEntry, ChapterEntry, StoryEntry, BlockEntry, EntityEntry } from './ipc.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLANS_DIR = path.resolve(__dirname, '..', '..', 'plans');
const PERF_BUDGET_PATH = path.join(PLANS_DIR, 'PERF_BUDGET.md');
const PERF_BASELINE_PATH = path.join(PLANS_DIR, 'PERF_BASELINE.json');

// ─── Budget targets ───────────────────────────────────────────────────────────

const SCENE_COUNT = 1_000;   // 10 stories × 5 chapters × 20 scenes
const NOTE_COUNT  = 5_000;   // 50% chars, 30% locs, 20% items

// Absolute upper-bound thresholds (ms). Any run over these is a hard failure.
const THRESHOLDS: Record<string, number> = {
  db_open_ms:              1_000,   // migrations on fresh DB
  vault_reindex_ms:       30_000,   // scan 1 000 .md files cold
  fts5_build_ms:          30_000,   // insert 6 000 docs into FTS5
  fts5_search_median_ms:     500,   // median of 3 representative queries
  archive_index_ms:       60_000,   // read 5 000 entity files
  archive_scan_10_ms:     10_000,   // run archive scan on 10 scenes
};

// ─── Shared state ─────────────────────────────────────────────────────────────

let tmpDir  = '';
let vaultRoot = '';
let manifest: Manifest;
const timings: Record<string, number> = {};

// ─── Prose generators ─────────────────────────────────────────────────────────

const HAIR = ['blonde', 'dark', 'red', 'silver'] as const;
const EYES = ['blue', 'brown', 'green', 'hazel'] as const;

function sceneProse(si: number, ci: number, sc: number): string {
  const char = `Character ${(si * 7 + sc) % 100}`;
  const loc  = `Location ${(ci * 11 + sc) % 50}`;
  const item = `Item ${sc % 20}`;
  const hair = HAIR[(si + sc) % HAIR.length];
  const eyes = EYES[(ci + sc) % EYES.length];
  return [
    `${char} stood at the entrance of ${loc}, scanning the area with ${eyes} eyes.`,
    `The ${hair} hair caught the morning light as they gripped ${item} tightly.`,
    `${loc} was silent except for the wind threading through the archway overhead.`,
    `Every footstep felt deliberate, as though the stone floor recorded each one.`,
    `${char} knew the path forward, even as doubt settled like fog around the plan.`,
    `The ${item} had come a long way to arrive here, and so had ${char}.`,
    `Light shifted, shadows stretched, and the moment of decision drew near.`,
    `A voice from somewhere deep in ${loc} called out a single unintelligible syllable.`,
    `${char} turned, heart quickening, unsure whether the figure was ally or threat.`,
    `The chapter ahead would determine everything that came before it in this arc.`,
  ].join('\n');
}

function entityProse(idx: number, type: string): string {
  const hair = HAIR[idx % HAIR.length];
  const eyes = EYES[idx % EYES.length];
  if (type === 'character') {
    return [
      `Notable figure in the story world.`,
      `hair: ${hair}`,
      `eyes: ${eyes}`,
      `Background: complex history spanning multiple arcs and narrative threads.`,
    ].join('\n');
  }
  if (type === 'location') {
    const atm = idx % 2 === 0 ? 'urban tension' : 'rural stillness';
    return [
      `Significant setting that recurs across several chapters.`,
      `Atmosphere: ${atm}.`,
      `History: ancient origins, contested in the present day.`,
    ].join('\n');
  }
  return [
    `Key object in the narrative with multiple appearances.`,
    `Purpose: drives plot in at least two distinct arcs.`,
    `Status: currently in play and actively sought by protagonists.`,
  ].join('\n');
}

// ─── Vault seeder ─────────────────────────────────────────────────────────────

function seedVault(): Manifest {
  const now = new Date().toISOString();
  const mf  = defaultManifest(vaultRoot);
  mf.schemaVersion = 2;

  // Story vault — 10 × 5 × 20 = 1 000 scenes
  for (let si = 0; si < 10; si++) {
    const storyId = crypto.randomUUID();
    const story: StoryEntry = {
      id: storyId,
      title: `Story ${si}`,
      path: `Manuscript/story-${si}`,
      chapters: [],
      createdAt: now,
      updatedAt: now,
    };

    for (let ci = 0; ci < 5; ci++) {
      const chapterId  = crypto.randomUUID();
      const chapterDir = `Manuscript/story-${si}/chapter-${ci}`;
      fs.mkdirSync(path.join(vaultRoot, chapterDir), { recursive: true });

      const chapter: ChapterEntry = {
        id: chapterId,
        title: `Chapter ${ci}`,
        path: chapterDir,
        order: ci,
        scenes: [],
        createdAt: now,
        updatedAt: now,
      };

      for (let sc = 0; sc < 20; sc++) {
        const sceneId = crypto.randomUUID();
        const relPath = `${chapterDir}/scene-${sc}.md`;
        const prose   = sceneProse(si, ci, sc);

        writeSceneFile(vaultRoot, relPath, {
          id: sceneId,
          title: `Scene ${si}-${ci}-${sc}`,
          chapterId,
          storyId,
          order: sc,
          prose,
        });

        const block: BlockEntry = {
          id: crypto.randomUUID(),
          type: 'prose',
          order: 0,
          content: prose,
          updatedAt: now,
        };
        chapter.scenes.push({
          id: sceneId,
          title: `Scene ${si}-${ci}-${sc}`,
          path: relPath,
          order: sc,
          chapterId,
          storyId,
          blocks: [block],
          createdAt: now,
          updatedAt: now,
        } satisfies SceneEntry);
      }
      story.chapters.push(chapter);
    }
    mf.stories.push(story);
  }

  // Notes vault — 5 000 entities (50% chars, 30% locs, 20% items)
  const TYPES = [
    'character', 'character', 'character', 'character', 'character',
    'location',  'location',  'location',
    'item',      'item',
  ] as const;

  for (let i = 0; i < NOTE_COUNT; i++) {
    const type   = TYPES[i % TYPES.length] as EntityEntry['type'];
    const id     = crypto.randomUUID();
    const relPath = `entities/${type}s/${id}.md`;
    const entDir  = path.join(vaultRoot, `entities/${type}s`);
    if (!fs.existsSync(entDir)) fs.mkdirSync(entDir, { recursive: true });

    writeEntityFile(vaultRoot, relPath, {
      id,
      name: `${type.charAt(0).toUpperCase()}${type.slice(1)} ${i}`,
      type,
      prose: entityProse(i, type),
    });

    mf.entities.push({
      id,
      name: `${type.charAt(0).toUpperCase()}${type.slice(1)} ${i}`,
      type,
      path: relPath,
      createdAt: now,
      updatedAt: now,
    } satisfies EntityEntry);
  }

  return mf;
}

// ─── Bench suite ──────────────────────────────────────────────────────────────

describe.sequential('perf-budget', () => {

  beforeAll(() => {
    tmpDir    = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-perf-'));
    vaultRoot = tmpDir;
    manifest  = seedVault();
  }, 300_000); // 5 min ceiling for seeding 6 000 files

  afterAll(() => {
    closeDb();
    writeReport();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // 1. DB initialisation (migrations on a brand-new database)
  it('db-cold-open', { timeout: 5_000 }, () => {
    const t0 = performance.now();
    openDb(vaultRoot);
    timings.db_open_ms = performance.now() - t0;
    expect.soft(timings.db_open_ms).toBeLessThan(THRESHOLDS.db_open_ms);
  });

  // 2. Cold vault reindex — discovers 1 000 scene files written to disk
  it('vault-reindex-1000-scenes', { timeout: 60_000 }, () => {
    // Empty manifest forces reindexVault to treat every file as new.
    const freshManifest = defaultManifest(vaultRoot);
    const t0 = performance.now();
    const result = reindexVault(vaultRoot, freshManifest);
    timings.vault_reindex_ms = performance.now() - t0;
    expect(result.scanned).toBeGreaterThanOrEqual(SCENE_COUNT);
    expect.soft(timings.vault_reindex_ms).toBeLessThan(THRESHOLDS.vault_reindex_ms);
  });

  // 3. FTS5 full index build — 1 000 scenes + 5 000 entity docs
  it('fts5-full-build-6000-docs', { timeout: 60_000 }, () => {
    const db = getDb();
    const t0 = performance.now();
    buildFullIndex(db, vaultRoot, manifest);
    timings.fts5_build_ms = performance.now() - t0;
    expect.soft(timings.fts5_build_ms).toBeLessThan(THRESHOLDS.fts5_build_ms);
  });

  // 4. FTS5 search latency — median of three representative queries
  it('fts5-search-latency', { timeout: 10_000 }, () => {
    const db = getDb();
    const queries = ['character location', 'item horizon', 'story challenge'] as const;
    const times = queries.map((q) => {
      const t0 = performance.now();
      const results = searchVault(db, q, 'both', 20);
      const elapsed = performance.now() - t0;
      expect(results).toBeDefined();
      return elapsed;
    });
    const sorted = [...times].sort((a, b) => a - b);
    timings.fts5_search_median_ms = sorted[Math.floor(sorted.length / 2)];
    expect.soft(timings.fts5_search_median_ms).toBeLessThan(THRESHOLDS.fts5_search_median_ms);
  });

  // 5. Archive entity index — reads all 5 000 entity files from disk
  it('archive-index-build-5000-entities', { timeout: 120_000 }, () => {
    const t0 = performance.now();
    buildArchiveIndex(vaultRoot, manifest);
    timings.archive_index_ms = performance.now() - t0;
    expect.soft(timings.archive_index_ms).toBeLessThan(THRESHOLDS.archive_index_ms);
  });

  // 6. Archive scan — inconsistency + wiki-link detection on 10 scenes
  it('archive-scan-10-scenes', { timeout: 30_000 }, () => {
    const index = getArchiveIndex();
    expect(index, 'archive index must exist after build step').not.toBeNull();
    if (!index) return;

    const scenes = manifest.stories[0].chapters[0].scenes.slice(0, 10);
    const t0 = performance.now();
    for (const scene of scenes) {
      let prose = '';
      try {
        const raw = fs.readFileSync(path.join(vaultRoot, scene.path), 'utf-8');
        const m   = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
        prose     = m ? m[1].trim() : raw.trim();
      } catch { /* missing file — empty prose */ }
      runArchiveScan(prose, index, scene.path);
    }
    timings.archive_scan_10_ms = performance.now() - t0;
    expect.soft(timings.archive_scan_10_ms).toBeLessThan(THRESHOLDS.archive_scan_10_ms);
  });

});

// ─── Report writer ────────────────────────────────────────────────────────────

interface Baseline {
  timestamp: string;
  measurements: Record<string, number>;
}

function writeReport(): void {
  fs.mkdirSync(PLANS_DIR, { recursive: true });

  // Load existing baseline
  let baseline: Baseline | null = null;
  if (fs.existsSync(PERF_BASELINE_PATH)) {
    try {
      baseline = JSON.parse(fs.readFileSync(PERF_BASELINE_PATH, 'utf-8')) as Baseline;
    } catch { /* corrupt — ignore */ }
  }

  // Detect regressions (> 25% slower than baseline)
  const regressions: string[] = [];
  if (baseline) {
    for (const [key, val] of Object.entries(timings)) {
      const prev = baseline.measurements[key];
      if (prev !== undefined && val > prev * 1.25) {
        const pct = ((val / prev - 1) * 100).toFixed(1);
        regressions.push(`\`${key}\`: ${val.toFixed(0)} ms vs baseline ${prev.toFixed(0)} ms (+${pct}%)`);
      }
    }
  }

  // Persist baseline on first run or when explicitly requested
  if (!baseline || process.env.PERF_UPDATE_BASELINE === '1') {
    const newBaseline: Baseline = {
      timestamp: new Date().toISOString(),
      measurements: { ...timings },
    };
    fs.writeFileSync(
      PERF_BASELINE_PATH,
      JSON.stringify(newBaseline, null, 2) + '\n',
      'utf-8',
    );
  }

  const allAbsPass = Object.entries(THRESHOLDS).every(([k, t]) => (timings[k] ?? 0) < t);
  const status     = allAbsPass && regressions.length === 0 ? '✅ PASS' : '❌ FAIL';

  const rows = Object.entries(THRESHOLDS).map(([key, threshold]) => {
    const val = timings[key];
    if (val === undefined) return `| \`${key}\` | — | < ${threshold} ms | ⚠ not run |`;
    const ok  = val < threshold;
    return `| \`${key}\` | ${val.toFixed(0)} ms | < ${threshold} ms | ${ok ? '✅' : '❌'} |`;
  });

  const regressionBlock = baseline
    ? [
        '',
        '## Regression vs Baseline',
        '',
        `Baseline from: \`${baseline.timestamp}\``,
        '',
        regressions.length === 0
          ? '✅ All metrics within 25 % of last green baseline.'
          : [
              '❌ Regressions detected (> 25 % slower than baseline):',
              '',
              ...regressions.map((r) => `- ${r}`),
            ].join('\n'),
      ]
    : [
        '',
        '> No baseline on record — this run has been written as the initial baseline.',
        '> Re-run with `PERF_UPDATE_BASELINE=1 npm run perf` to refresh it intentionally.',
      ];

  const lines = [
    '# Performance Budget Report',
    '',
    `Generated: \`${new Date().toISOString()}\``,
    `Status: **${status}**`,
    '',
    '## Targets',
    '',
    `- Story Vault: **${SCENE_COUNT} scenes**`,
    `- Notes Vault: **${NOTE_COUNT} notes**`,
    `- Max vault size: **500 MB**`,
    '',
    '## Measurements',
    '',
    '| Metric | Result | Threshold | Status |',
    '|--------|-------:|----------:|:------:|',
    ...rows,
    ...regressionBlock,
    '',
    '## Notes',
    '',
    '- **db-cold-open**: time to open a brand-new SQLite DB and run all schema migrations.',
    '- **vault-reindex**: cold scan of 1 000 scene files from disk (first-open scenario).',
    '- **fts5-build**: full FTS5 index build for 1 000 scenes + 5 000 entity docs.',
    '- **fts5-search**: median of three representative full-text search queries.',
    '- **archive-index**: time for the Archive Agent to read and index all 5 000 entity files.',
    '- **archive-scan**: total time to scan 10 scenes for inconsistencies and wiki-link gaps.',
    '',
    '## Regression Policy',
    '',
    'Regressions > 25 % from the last green baseline are treated as bugs.',
    'Update baseline intentionally: `PERF_UPDATE_BASELINE=1 npm run perf`',
    '',
  ];

  fs.writeFileSync(PERF_BUDGET_PATH, lines.join('\n'), 'utf-8');
}
