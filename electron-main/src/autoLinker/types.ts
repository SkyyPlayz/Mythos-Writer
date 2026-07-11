// Shared types for the Auto Note Linker (§12, BUILT-IN · NO AI).

export interface AutoLinkerToggles {
  /** Run formatter when a note is saved (default: false). */
  formatOnSave: boolean;
  /** Include frontmatter aliases as linkable terms (default: true). */
  includeAliases: boolean;
  /** When multiple notes match, prefer the nearest one (default: false — first inserted wins). */
  proximityLinking: boolean;
  /** Case-insensitive matching (default: true). */
  ignoreCase: boolean;
  /** Never produce a link whose target is the file being formatted (default: true). */
  preventSelfLink: boolean;
  /** Skip tokens that look like ISO/Obsidian date patterns (default: true). */
  ignoreDateFormats: boolean;
  /** Folders (vault-relative) to skip entirely. */
  excludedFolders: string[];
  /** Milliseconds to wait after a save before auto-linking (default: 0). */
  formatDelayMs: number;
}

export const DEFAULT_TOGGLES: AutoLinkerToggles = {
  formatOnSave: false,
  includeAliases: true,
  proximityLinking: false,
  ignoreCase: true,
  preventSelfLink: true,
  ignoreDateFormats: true,
  excludedFolders: ['Templates/', 'Archive/'],
  formatDelayMs: 0,
};

/** One note scanned from the vault. */
export interface NoteEntry {
  /** Filename stem (no extension). */
  name: string;
  /** Vault-relative path (forward slashes). */
  vaultRelPath: string;
  /** Absolute filesystem path. */
  absPath: string;
  /** Aliases from frontmatter `aliases:`. */
  aliases: string[];
  /** True when frontmatter `automatic-linker-off: true`. */
  linkerOff: boolean;
  /** Terms listed in frontmatter `automatic-linker-exclude:`. */
  linkerExclude: string[];
  /** True when frontmatter `automatic-linker-scoped: true` (only link within same folder). */
  linkerScoped: boolean;
}

/** Summary returned after formatting the vault. */
export interface FormatVaultResult {
  filesScanned: number;
  filesChanged: number;
  linksAdded: number;
}
