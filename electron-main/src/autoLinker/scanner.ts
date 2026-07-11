// Auto Note Linker — vault scanner (SKY-6225)

import * as fs from 'fs';
import * as path from 'path';
import { buildTrie, findMatches, type NoteEntry } from './trie.js';
import { formatText } from './formatter.js';

export interface AutoLinkerSettings {
  formatOnSave: boolean;
  includeAliases: boolean;
  proximityPreference: boolean;
  ignoreCase: boolean;
  preventSelfLink: boolean;
  ignoreDates: boolean;
  formatDelay: number;
  excludedFolders: string[];
}

export const DEFAULT_AUTO_LINKER_SETTINGS: AutoLinkerSettings = {
  formatOnSave: false,
  includeAliases: true,
  proximityPreference: true,
  ignoreCase: false,
  preventSelfLink: true,
  ignoreDates: true,
  formatDelay: 2000,
  excludedFolders: ['Templates', 'Archive'],
};

const DATE_FILENAME_RE = /^\d{4}-\d{2}-\d{2}/;

function getAllMarkdownFiles(dir: string, excludedFolders: string[]): string[] {
  const results: string[] = [];
  function walk(current: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!excludedFolders.includes(entry.name)) {
          walk(fullPath);
        }
      } else if (entry.name.endsWith('.md')) {
        results.push(fullPath);
      }
    }
  }
  walk(dir);
  return results;
}

interface FrontmatterOverrides {
  linkerOff: boolean;
  excludeTerms: string[];
  scoped: boolean;
}

function parseFrontmatterOverrides(content: string): FrontmatterOverrides {
  const overrides: FrontmatterOverrides = { linkerOff: false, excludeTerms: [], scoped: false };
  if (!content.startsWith('---')) return overrides;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return overrides;
  const fm = content.slice(3, end);
  for (const line of fm.split('\n')) {
    if (/^automatic-linker-off\s*:\s*true/.test(line)) overrides.linkerOff = true;
    const excludeMatch = line.match(/^automatic-linker-exclude\s*:\s*\[(.+)\]/);
    if (excludeMatch) {
      overrides.excludeTerms = excludeMatch[1]
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
    }
    if (/^automatic-linker-scoped\s*:\s*true/.test(line)) overrides.scoped = true;
  }
  return overrides;
}

function extractTitle(filePath: string, content: string): string {
  if (content.startsWith('---')) {
    const end = content.indexOf('\n---', 3);
    if (end !== -1) {
      const fm = content.slice(3, end);
      const titleMatch = fm.match(/^title\s*:\s*(.+)$/m);
      if (titleMatch) return titleMatch[1].trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return path.basename(filePath, '.md');
}

function extractAliases(content: string): string[] {
  if (!content.startsWith('---')) return [];
  const end = content.indexOf('\n---', 3);
  if (end === -1) return [];
  const fm = content.slice(3, end);
  // Inline array format: aliases: [Foo, Bar]
  const aliasMatch = fm.match(/^aliases\s*:\s*\[(.+)\]/m);
  if (aliasMatch) {
    return aliasMatch[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
  }
  // YAML list format
  const lines = fm.split('\n');
  let inAliases = false;
  const aliases: string[] = [];
  for (const line of lines) {
    if (/^aliases\s*:/.test(line)) {
      inAliases = true;
      continue;
    }
    if (inAliases) {
      const listItem = line.match(/^\s*-\s+(.+)/);
      if (listItem) {
        aliases.push(listItem[1].trim().replace(/^['"]|['"]$/g, ''));
      } else if (line.trim() && !/^\s/.test(line)) {
        inAliases = false;
      }
    }
  }
  return aliases;
}

export function buildIndex(
  vaultRoot: string,
  opts: AutoLinkerSettings,
): NoteEntry[] {
  const files = getAllMarkdownFiles(vaultRoot, opts.excludedFolders);
  const entries: NoteEntry[] = [];
  for (const filePath of files) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }
    if (opts.ignoreDates && DATE_FILENAME_RE.test(path.basename(filePath, '.md'))) continue;
    const title = extractTitle(filePath, content);
    const aliases = opts.includeAliases ? extractAliases(content) : [];
    entries.push({ title, filePath, aliases });
  }
  return entries;
}

export function formatNote(
  filePath: string,
  index: NoteEntry[],
  opts: AutoLinkerSettings,
): { linked: number } | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  const overrides = parseFrontmatterOverrides(content);
  if (overrides.linkerOff) return null;

  const fileDir = path.dirname(filePath);

  // Filter index
  let filteredIndex = index.filter((entry) => {
    if (opts.preventSelfLink && entry.filePath === filePath) return false;
    if (overrides.scoped) {
      return path.dirname(entry.filePath) === fileDir;
    }
    return true;
  });

  // Apply excludeTerms
  if (overrides.excludeTerms.length > 0) {
    filteredIndex = filteredIndex.filter(
      (entry) =>
        !overrides.excludeTerms.includes(entry.title) &&
        !entry.aliases.some((a) => overrides.excludeTerms.includes(a)),
    );
  }

  // Proximity preference: prefer same-folder note when same title appears in multiple paths
  if (opts.proximityPreference) {
    const titleMap = new Map<string, NoteEntry>();
    for (const entry of filteredIndex) {
      const existing = titleMap.get(entry.title);
      if (!existing) {
        titleMap.set(entry.title, entry);
      } else if (path.dirname(entry.filePath) === fileDir) {
        titleMap.set(entry.title, entry);
      }
    }
    filteredIndex = Array.from(titleMap.values());
  }

  const root = buildTrie(filteredIndex, { ignoreCase: opts.ignoreCase });
  const matches = findMatches(content, root, {
    ignoreCase: opts.ignoreCase,
    wordBoundary: true,
  });

  if (matches.length === 0) return { linked: 0 };

  const existingLinkTitles = new Set<string>();
  const formatted = formatText(content, matches, existingLinkTitles);

  if (formatted !== content) {
    try {
      fs.writeFileSync(filePath, formatted, 'utf-8');
    } catch {
      return { linked: 0 };
    }
    const newLinks =
      (formatted.match(/\[\[/g) ?? []).length - (content.match(/\[\[/g) ?? []).length;
    return { linked: Math.max(0, newLinks) };
  }
  return { linked: 0 };
}

export function formatVaultNow(
  vaultRoot: string,
  opts: AutoLinkerSettings,
): { processed: number; linked: number; skipped: number } {
  const index = buildIndex(vaultRoot, opts);
  const files = getAllMarkdownFiles(vaultRoot, opts.excludedFolders);

  let processed = 0;
  let linked = 0;
  let skipped = 0;

  for (const filePath of files) {
    if (opts.ignoreDates && DATE_FILENAME_RE.test(path.basename(filePath, '.md'))) {
      skipped++;
      continue;
    }
    const result = formatNote(filePath, index, opts);
    if (result === null) {
      skipped++;
    } else {
      processed++;
      linked += result.linked;
    }
  }

  return { processed, linked, skipped };
}
