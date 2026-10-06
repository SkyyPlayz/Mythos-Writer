/**
 * SKY-3215 — SETTINGS_CATEGORIES coverage test.
 * Verifies that every section-* id rendered in SettingsPanel.tsx maps to
 * exactly one category and that no registered id appears more than once.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import {
  SETTINGS_CATEGORIES,
  SECTION_TO_CATEGORY,
  ALL_REGISTERED_SECTION_IDS,
} from './settingsCategories';

const FRONTEND_SRC = resolve(__dirname);

function resolveRelativeImport(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    `${base}/index.tsx`,
    `${base}/index.ts`,
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** Follow SettingsPanel's import graph — unmounted section files must not count as rendered. */
function collectSettingsPanelSources(entry: string, seen = new Set<string>()): string[] {
  if (seen.has(entry)) return [];
  seen.add(entry);
  const out = [entry];
  const src = readFileSync(entry, 'utf-8');
  for (const m of src.matchAll(/from ['"](\.\.?\/[^'"]+)['"]/g)) {
    const resolved = resolveRelativeImport(entry, m[1]);
    if (!resolved || !resolved.startsWith(FRONTEND_SRC)) continue;
    out.push(...collectSettingsPanelSources(resolved, seen));
  }
  return out;
}

const SOURCE_FILES = collectSettingsPanelSources(resolve(__dirname, 'SettingsPanel.tsx'));

/** Registered for nav/docs but not mounted in SettingsPanel (Slice C soft-fail). */
const REGISTRY_ONLY_SECTION_IDS = new Set(['section-agents']);

const RENDERED_IDS = new Set<string>();
for (const filePath of SOURCE_FILES) {
  const src = readFileSync(filePath, 'utf-8');
  for (const m of src.matchAll(/id="(section-[^"]+)"/g)) {
    RENDERED_IDS.add(m[1]);
  }
}

describe('SETTINGS_CATEGORIES registry (SKY-3215)', () => {
  it('defines at least one category', () => {
    expect(SETTINGS_CATEGORIES.length).toBeGreaterThan(0);
  });

  it('has unique category ids', () => {
    const ids = SETTINGS_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('PLAN-058 L2: Vault & Files is 2nd, Voice is 3rd, account last', () => {
    expect(SETTINGS_CATEGORIES.map((c) => c.id)).toEqual([
      'appearance',
      'vaults',
      'voice',
      'writingPartner',
      'agents',
      'editor',
      'sync',
      'shortcuts',
      'about',
      // Not in the prototype rail; kept and placed last by owner ruling
      // (Skyy, 2026-08-19, SKY-10668 change 3).
      'account',
    ]);
    const labels = SETTINGS_CATEGORIES.map((c) => c.label);
    expect(labels.indexOf('Writing partner')).toBeLessThan(labels.indexOf('Model & keys'));
  });

  it('Slice C: AI Agents label becomes Model & keys; Writing partner present', () => {
    expect(SETTINGS_CATEGORIES.find((c) => c.id === 'agents')?.label).toBe('Model & keys');
    expect(SETTINGS_CATEGORIES.find((c) => c.id === 'writingPartner')?.label).toBe('Writing partner');
    expect(SETTINGS_CATEGORIES.some((c) => c.label === 'AI Agents')).toBe(false);
  });

  it('has no duplicate section ids across categories', () => {
    const all: string[] = [];
    for (const cat of SETTINGS_CATEGORIES) {
      all.push(...cat.sectionIds);
    }
    const unique = new Set(all);
    expect(unique.size).toBe(all.length);
  });

  it('SECTION_TO_CATEGORY covers every registered section id', () => {
    for (const id of ALL_REGISTERED_SECTION_IDS) {
      expect(SECTION_TO_CATEGORY[id], `${id} must be in SECTION_TO_CATEGORY`).toBeDefined();
    }
  });

  it('every section-* id rendered in SettingsPanel.tsx has exactly one category mapping', () => {
    const orphans: string[] = [];
    for (const id of RENDERED_IDS) {
      if (!ALL_REGISTERED_SECTION_IDS.has(id)) {
        orphans.push(id);
      }
    }
    expect(orphans, `Orphan section ids (in SettingsPanel.tsx but not in registry): ${orphans.join(', ')}`).toHaveLength(0);
  });

  it('no registered id is absent from SettingsPanel.tsx', () => {
    const missing: string[] = [];
    for (const id of ALL_REGISTERED_SECTION_IDS) {
      if (REGISTRY_ONLY_SECTION_IDS.has(id)) continue;
      if (!RENDERED_IDS.has(id)) {
        missing.push(id);
      }
    }
    expect(missing, `Stale section ids (in registry but not rendered): ${missing.join(', ')}`).toHaveLength(0);
  });

  it('coverage follows SettingsPanel import graph (not every file in sections/)', () => {
    const sectionDir = resolve(__dirname, 'components/SettingsPanel/sections');
    const allSectionFiles = readdirSync(sectionDir)
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => resolve(sectionDir, f));
    const unmountedWithRegisteredIds: string[] = [];
    for (const filePath of allSectionFiles) {
      if (SOURCE_FILES.includes(filePath)) continue;
      const src = readFileSync(filePath, 'utf-8');
      for (const m of src.matchAll(/id="(section-[^"]+)"/g)) {
        if (ALL_REGISTERED_SECTION_IDS.has(m[1]) && !REGISTRY_ONLY_SECTION_IDS.has(m[1])) {
          unmountedWithRegisteredIds.push(`${filePath} → ${m[1]}`);
        }
      }
    }
    expect(
      unmountedWithRegisteredIds,
      `Unmounted files must not define registered section-* ids (grep bait): ${unmountedWithRegisteredIds.join(', ')}`,
    ).toHaveLength(0);
  });

  it('Vaults & Files sections use Sep Liquid Neon glass card chrome', () => {
    const css = readFileSync(resolve(__dirname, 'SettingsPanel.css'), 'utf-8');
    expect(css).toContain('.settings-section:not(.m24-root)');
    expect(css).toContain('.settings-section[data-settings-cat="vaults"]');
    expect(css).toContain('var(--bwh, 1px) solid var(--bh, rgba(0, 240, 255, 0.2))');
    expect(css).toContain('var(--glowH, none)');
  });
});
