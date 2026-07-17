/**
 * Settings category registry — maps each section-* DOM id to exactly one
 * display category.  The coverage test (settingsCategories.test.ts) verifies
 * no orphan or duplicate mappings exist relative to the sections actually
 * rendered in SettingsPanel.tsx / components/SettingsPanel/sections/*.
 *
 * This is the single source of truth for the rail structure — SettingsPanel.tsx
 * imports SETTINGS_CATEGORIES to drive its category nav instead of maintaining
 * a second, hand-written list (SKY-5694).
 *
 * Beta 4 M28 (§13; GAP #8): the settings workspace left rail follows the
 * prototype `settingsMeta` (HTML 6458) order and labels:
 * Account & profile · Appearance · AI Agents · Editor · Vault & Files ·
 * Sync & Backup · Shortcuts · About. Each category carries the prototype's
 * one-line description, shown in the page header.
 */

export type SettingsCategoryId =
  | 'vaults'
  | 'account'
  | 'editor'
  | 'sync'
  | 'shortcuts'
  | 'about'
  | 'agents'
  | 'appearance';

export interface SettingsCategory {
  id: SettingsCategoryId;
  label: string;
  /** Prototype settingsMeta subtitle — rendered in the page header (M28). */
  description: string;
  /** Ordered list of section-* ids that belong to this category. */
  sectionIds: readonly string[];
}

export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  {
    id: 'account',
    label: 'Account & profile',
    description: 'You, your plan, and your devices.',
    sectionIds: ['section-account-profile'],
  },
  {
    id: 'appearance',
    label: 'Appearance',
    description: 'Liquid Neon theme — every change applies live, everywhere.',
    sectionIds: [
      'section-updates',
      'section-liquid-neon',
      'section-theme',
      'section-page-appearance',
      'section-nav-config',
      'section-focus-mode',
      'section-telemetry',
    ],
  },
  {
    id: 'agents',
    label: 'AI Agents',
    description: 'Providers, personas, and how much autonomy each agent gets.',
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
    id: 'editor',
    label: 'Editor',
    description: 'Defaults for manuscripts and notes.',
    sectionIds: ['section-editor', 'section-editor-manuscript'],
  },
  {
    id: 'vaults',
    label: 'Vault & Files',
    description: 'Where your world lives on disk.',
    sectionIds: [
      'section-vault-autolinker', // M6: Auto Note Linker — FIRST card per spec §12
      'section-account',
      'section-mythos-vaults', // Beta 4 M1: per-vault default theme cards
      'section-vault-paths',
      'section-vault-format',
      'section-import-vault',
      'section-import-story',
      'section-vault-health',
      'section-vault-danger-zone',
      'section-scene-fields',
      'section-snapshots',
      'section-versions',
      'section-backup',
    ],
  },
  {
    id: 'sync',
    label: 'Sync & Backup',
    description: 'Cloud sync, snapshots, restore points.',
    sectionIds: ['section-sync-backup'],
  },
  {
    id: 'shortcuts',
    label: 'Shortcuts',
    description: 'Every action, one keystroke away.',
    sectionIds: ['section-shortcuts'],
  },
  {
    id: 'about',
    label: 'About',
    description: 'Version, updates and credits.',
    sectionIds: ['section-about'],
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
