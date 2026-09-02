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
 * SKY-10668 (owner request, supersedes the M28 §13/GAP #8 order): the rail
 * follows the prototype rail order top-to-bottom:
 * Appearance · AI Agents · Editor · Vault & Files · Sync & Backup ·
 * Shortcuts · About. `Account & profile` has no prototype counterpart; by
 * owner ruling (Skyy, 2026-08-19, SKY-10668 change 3) it is KEPT and placed
 * last, after About. That placement outranks the prototype (PLAN §0) — a
 * fidelity pass must not flag the eighth entry as a divergence or delete it.
 * Each category carries the prototype's one-line description, shown in the
 * page header.
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
    // M11a: prototype 6607 rewrote this one-liner alongside the master switch.
    description: 'Provider, models and autonomy. Pick an agent in the sidebar for its own page.',
    sectionIds: [
      'section-ai-master',
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
      'section-add-vault', // SKY-11152: "+ Add Notes Vault" / "+ Add Story Vault" dialogs
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
  {
    // Not in the prototype rail. Owner ruling (Skyy, 2026-08-19, SKY-10668
    // change 3): keep this page, placed last after About. Do not delete it or
    // "restore prototype parity" by removing it — the ruling outranks the
    // prototype for app-only pages (PLAN §0).
    id: 'account',
    label: 'Account & profile',
    description: 'You, your plan, and your devices.',
    sectionIds: ['section-account-profile'],
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
