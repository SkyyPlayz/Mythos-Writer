// SKY-205: Smart Folders — query parser + executor for frontmatter-backed vault searches
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseFrontmatter } from './vault.js';
import type { SmartFolderResult } from './ipc.js';

interface ParsedCondition {
  field: string;
  value: string;
}

export interface SmartQueryParseResult {
  conditions: ParsedCondition[];
  error?: string;
}

/**
 * Parse a query string like `pov: Lyra AND status: draft` into conditions.
 * Only AND is supported. Returns an error string for invalid queries.
 */
export function parseSmartQuery(query: string): SmartQueryParseResult {
  const trimmed = (query ?? '').trim();
  if (!trimmed) return { conditions: [], error: 'Query cannot be empty' };

  const parts = trimmed.split(/\s+AND\s+/i);
  const conditions: ParsedCondition[] = [];

  for (const part of parts) {
    const colonIdx = part.indexOf(':');
    if (colonIdx === -1) {
      return { conditions: [], error: `Invalid condition "${part.trim()}" — expected "field: value"` };
    }
    const field = part.slice(0, colonIdx).trim().toLowerCase();
    const value = part.slice(colonIdx + 1).trim().toLowerCase();
    if (!field) return { conditions: [], error: `Missing field name in "${part.trim()}"` };
    if (!value) return { conditions: [], error: `Missing value in "${part.trim()}"` };
    conditions.push({ field, value });
  }

  return { conditions };
}

function matchesConditions(
  frontmatter: Record<string, unknown>,
  conditions: ParsedCondition[],
): boolean {
  for (const { field, value } of conditions) {
    const fmValue = frontmatter[field];
    if (fmValue === undefined || fmValue === null || fmValue === '') return false;

    if (Array.isArray(fmValue)) {
      if (!fmValue.some((v) => String(v).toLowerCase().includes(value))) return false;
    } else {
      if (!String(fmValue).toLowerCase().includes(value)) return false;
    }
  }
  return true;
}

/**
 * Scan all markdown files in `vaultRoot`, parse frontmatter, and return those
 * that match every condition in `query`. Results are sorted by title.
 */
export function executeSmartQuery(
  vaultRoot: string,
  query: string,
): SmartFolderResult[] {
  const { conditions, error } = parseSmartQuery(query);
  if (error || conditions.length === 0) return [];

  const results: SmartFolderResult[] = [];

  function scanDir(dirPath: string, relDir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dirPath, entry.name);
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        scanDir(fullPath, relPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const raw = fs.readFileSync(fullPath, 'utf-8');
          const { frontmatter } = parseFrontmatter(raw);
          if (
            Object.keys(frontmatter).length > 0 &&
            matchesConditions(frontmatter as Record<string, unknown>, conditions)
          ) {
            const rawTitle = frontmatter['title'];
            const title =
              typeof rawTitle === 'string' && rawTitle
                ? rawTitle
                : path.basename(entry.name, '.md');
            results.push({ path: relPath, title });
          }
        } catch {
          // Skip unreadable or malformed files
        }
      }
    }
  }

  scanDir(vaultRoot, '');
  results.sort((a, b) => a.title.localeCompare(b.title));
  return results;
}
