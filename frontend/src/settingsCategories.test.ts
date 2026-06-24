/**
 * SKY-3215 — SETTINGS_CATEGORIES coverage test.
 * Verifies that every section-* id rendered in SettingsPanel.tsx maps to
 * exactly one category and that no registered id appears more than once.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import {
  SETTINGS_CATEGORIES,
  SECTION_TO_CATEGORY,
  ALL_REGISTERED_SECTION_IDS,
} from './settingsCategories';

// ── Extract rendered section ids from SettingsPanel.tsx + all section components ─
// Sections were extracted to components/SettingsPanel/sections/ (SKY-3216/D2).
// The test now scans all source files that contribute to the rendered output.
const SECTION_DIR = resolve(__dirname, 'components/SettingsPanel/sections');
const SOURCE_FILES = [
  resolve(__dirname, 'SettingsPanel.tsx'),
  ...readdirSync(SECTION_DIR)
    .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
    .map((f) => resolve(SECTION_DIR, f)),
];

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
      if (!RENDERED_IDS.has(id)) {
        missing.push(id);
      }
    }
    expect(missing, `Stale section ids (in registry but not rendered): ${missing.join(', ')}`).toHaveLength(0);
  });
});
