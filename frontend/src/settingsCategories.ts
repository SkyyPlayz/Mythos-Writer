/**
 * Settings category registry — maps each section-* DOM id to exactly one
 * display category.  The coverage test (settingsCategories.test.ts) verifies
 * no orphan or duplicate mappings exist relative to the sections actually
 * rendered in SettingsPanel.tsx / components/SettingsPanel/sections/*.
 *
 * This is the single source of truth for the 3-tab structure (Vaults /
 * Agents / Appearance) — SettingsPanel.tsx imports SETTINGS_CATEGORIES to
 * drive its category nav instead of maintaining a second, hand-written list
 * (SKY-5694).
 */

export type SettingsCategoryId = 'vaults' | 'agents' | 'appearance';

export interface SettingsCategory {
  id: SettingsCategoryId;
  label: string;
  /** Ordered list of section-* ids that belong to this category. */
  sectionIds: readonly string[];
}

export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  {
    id: 'vaults',
    label: 'Vaults',
    sectionIds: [
      'section-account',
      'section-vault-paths',
      'section-vault-health',
      'section-vault-danger-zone',
      'section-scene-fields',
      'section-snapshots',
      'section-versions',
    ],
  },
  {
    id: 'agents',
    label: 'Agents',
    sectionIds: [
      'section-providers',
      'section-api-key',
      'section-agents',
      'section-autolinker',
      'section-journal',
      'section-archive-agent',
      'section-voice',
    ],
  },
  {
    id: 'appearance',
    label: 'Appearance',
    sectionIds: [
      'section-updates',
      'section-theme',
      'section-page-appearance',
      'section-nav-config',
      'section-focus-mode',
      'section-telemetry',
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
