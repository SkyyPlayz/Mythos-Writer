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
 * SKY-10668 + Slice C: rail order top-to-bottom:
 * Appearance · Writing partner · Model & keys · Editor · Vault & Files ·
 * Sync & Backup · Shortcuts · About · Account & profile (last by owner ruling).
 * Slice C renames the old AI Agents page to Model & keys and inserts
 * Writing partner first under AI.
 */

export type SettingsCategoryId =
  | 'vaults'
  | 'account'
  | 'editor'
  | 'sync'
  | 'shortcuts'
  | 'about'
  | 'writingPartner'
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
    id: 'writingPartner',
    label: 'Writing partner',
    description: 'One partner face — personality, hands, heartbeat, and hard bans.',
    sectionIds: [
      'section-writing-partner',
      'section-personality',
      'section-hands',
      'section-partner-limits',
      'section-tools',
      'section-heartbeat',
      // F3 — Earlier chats / SessionHistoryViewer on Writing partner
      // (AgentsSection unmounted; partner spine sessions are brainstorm).
      'section-partner-history',
    ],
  },
  {
    id: 'agents',
    label: 'Model & keys',
    // Slice C: old AI Agents page becomes Model & keys (providers / tools / privacy).
    description: 'Bring your own AI — providers, models, tools limits, and privacy.',
    sectionIds: [
      'section-ai-master',
      'section-transcript-placement',
      'section-provider-buckets',
      'section-providers',
      // Soft-FAIL: AgentsSection.tsx still defines section-agents (unmounted);
      // production roles ship via ProductionRolesSection.
      'section-api-key',
      'section-agents',
      'section-production-roles',
      'section-models',
      'section-privacy',
      'section-hands-files',
      'section-autolinker',
      'section-journal',
      'section-voice',
    ],
  },
  {
    id: 'editor',
    label: 'Editor',
    description: 'Defaults for manuscripts and notes.',
    sectionIds: [
      'section-editor',
      'section-editor-manuscript',
      'section-notes-board', // SKY-11186: Boards zoom-out limit — a visible performance setting
    ],
  },
  {
    id: 'vaults',
    label: 'Vault & Files',
    description: 'Where your world lives on disk.',
    sectionIds: [
      'section-vault-autolinker', // M6: Auto Note Linker — FIRST card per spec §12
      'section-account',
      'section-vaults-folder', // SKY-11154: "Vaults folder" row — Open folder + Move…
      'section-mythos-vaults', // Beta 4 M1: per-vault default theme cards
      'section-add-vault', // SKY-11154 (grew from SKY-11152): Notes/Story columns + dot-linking
      'section-vault-paths',
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
    description: 'Vault location, snapshots, restore points.',
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
