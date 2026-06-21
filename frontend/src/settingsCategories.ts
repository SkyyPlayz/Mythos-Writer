/**
 * Settings category registry — maps each section-* DOM id to exactly one
 * display category.  The coverage test (settingsCategories.test.ts) verifies
 * no orphan or duplicate mappings exist relative to the sections actually
 * rendered in SettingsPanel.tsx.
 */

export type SettingsCategoryId = 'general' | 'vaults' | 'agents' | 'appearance';

export interface SettingsCategory {
  id: SettingsCategoryId;
  label: string;
  /** Ordered list of section-* ids that belong to this category. */
  sectionIds: readonly string[];
}

export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  {
    id: 'general',
    label: 'General',
    sectionIds: [
      'section-api-key',
      'section-autolinker',
      'section-journal',
      'section-scene-fields',
      'section-updates',
      'section-telemetry',
    ],
  },
  {
    id: 'vaults',
    label: 'Vaults',
    sectionIds: [
      'section-account',
      'section-vault-paths',
      'section-vault-health',
      'section-snapshots',
      'section-versions',
    ],
  },
  {
    id: 'agents',
    label: 'Agents',
    sectionIds: [
      'section-providers',
      'section-agents',
      'section-archive-agent',
      'section-voice',
    ],
  },
  {
    id: 'appearance',
    label: 'Appearance',
    sectionIds: [
      'section-theme',
      'section-page-appearance',
      'section-focus-mode',
    ],
  },
] as const;

/** Flat map from section id → category id, derived from the registry. */
export const SECTION_TO_CATEGORY: Readonly<Record<string, SettingsCategoryId>> =
  Object.fromEntries(
    SETTINGS_CATEGORIES.flatMap((cat) =>
      cat.sectionIds.map((id) => [id, cat.id]),
    ),
  );

/** All section ids in the registry (for coverage validation). */
export const ALL_REGISTERED_SECTION_IDS: ReadonlySet<string> = new Set(
  SETTINGS_CATEGORIES.flatMap((cat) => cat.sectionIds),
);
