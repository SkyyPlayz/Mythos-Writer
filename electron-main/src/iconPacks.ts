// Icon pack utilities — user SVG packs + batch frontmatter icon extraction.
// No Electron dependency; pure Node.js so this is fully testable.
import fs from 'fs';
import path from 'path';

// ─── SVG sanitization ───

const SCRIPT_RE = /<script[\s\S]*?<\/script>/gi;
const FOREIGN_RE = /<foreignObject[\s\S]*?<\/foreignObject>/gi;
const ON_ATTR_RE = /\s+on\w+="[^"]*"/gi;
const HREF_JS_RE = /href\s*=\s*["']javascript:[^"']*["']/gi;

export function sanitizeSvg(raw: string): string {
  return raw
    .replace(SCRIPT_RE, '')
    .replace(FOREIGN_RE, '')
    .replace(ON_ATTR_RE, '')
    .replace(HREF_JS_RE, '');
}

export function isSvgSafe(raw: string): boolean {
  if (/<script/i.test(raw)) return false;
  if (/<foreignObject/i.test(raw)) return false;
  if (/\son\w+\s*=/i.test(raw)) return false;
  if (/href\s*=\s*["']javascript:/i.test(raw)) return false;
  return true;
}

// ─── User icon pack discovery ───

export interface UserIconPack {
  packName: string;
  icons: string[];
}

export function listUserIconPacks(iconsDir: string): UserIconPack[] {
  if (!fs.existsSync(iconsDir)) return [];
  const packs: UserIconPack[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(iconsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!/^[\w-]+$/.test(entry.name)) continue;
    const packDir = path.join(iconsDir, entry.name);
    try {
      const icons = fs
        .readdirSync(packDir)
        .filter((f) => f.endsWith('.svg'))
        .map((f) => f.slice(0, -4));
      packs.push({ packName: entry.name, icons });
    } catch {
      // skip unreadable pack
    }
  }
  return packs;
}

export function readUserPackSvg(
  iconsDir: string,
  packName: string,
  iconName: string,
): string | null {
  if (!/^[\w-]+$/.test(packName) || !/^[\w-]+$/.test(iconName)) return null;
  const svgPath = path.join(iconsDir, packName, `${iconName}.svg`);
  if (!fs.existsSync(svgPath)) return null;
  try {
    const raw = fs.readFileSync(svgPath, 'utf-8');
    return sanitizeSvg(raw);
  } catch {
    return null;
  }
}

// ─── Batch frontmatter icon extraction ───
// Reads only the first 1024 bytes per file for efficiency.

function extractIconFromHead(head: string): string | null {
  if (!head.startsWith('---')) return null;
  const end = head.indexOf('\n---', 3);
  if (end === -1) return null;
  const block = head.slice(3, end);
  for (const line of block.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    if (key !== 'icon') continue;
    const val = line.slice(colon + 1).trim();
    if (val) return val;
  }
  return null;
}

export function batchReadVaultIcons(vaultRoot: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!fs.existsSync(vaultRoot)) return result;

  function walk(dir: string, relBase: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), relPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const filePath = path.join(dir, entry.name);
        try {
          const fd = fs.openSync(filePath, 'r');
          const buf = Buffer.alloc(1024);
          const bytesRead = fs.readSync(fd, buf, 0, 1024, 0);
          fs.closeSync(fd);
          const head = buf.slice(0, bytesRead).toString('utf-8');
          const icon = extractIconFromHead(head);
          if (icon) result[relPath] = icon;
        } catch {
          // skip unreadable
        }
      }
    }
  }

  walk(vaultRoot, '');
  return result;
}
