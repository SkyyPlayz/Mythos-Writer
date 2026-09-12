// Icon value parsing and SVG safelist for SKY-194 (Iconize).

// SKY-11190 (Notes Board 7/9, Iconize colour parity): a path-keyed map entry
// is either the original plain icon reference (no colour) or `{icon, color}`
// from the Boards closed 24-glyph/8-colour picker. Mirrors
// electron-main/src/vaultIcons.ts's VaultIconEntry.
export type VaultIconEntry = string | { icon: string; color: string };

/** Split a map entry into its icon-reference string and optional colour. */
export function unpackIconEntry(entry: VaultIconEntry | undefined): { icon?: string; color?: string } {
  if (entry === undefined) return {};
  if (typeof entry === 'string') return { icon: entry };
  return { icon: entry.icon, color: entry.color };
}

export type IconValue =
  | { kind: 'emoji'; value: string }
  | { kind: 'lucide'; name: string }
  | { kind: 'user-svg'; pack: string; name: string }
  | { kind: 'default' };

/**
 * Parse a raw frontmatter `icon:` field into a typed descriptor.
 *
 * Formats:
 *   "🗡️"               → { kind: 'emoji', value: '🗡️' }
 *   "pack:lucide/sword" → { kind: 'lucide', name: 'sword' }
 *   "pack:mypack/arrow" → { kind: 'user-svg', pack: 'mypack', name: 'arrow' }
 */
export function parseIconValue(raw: string | undefined): IconValue {
  if (!raw) return { kind: 'default' };

  if (raw.startsWith('pack:lucide/')) {
    const name = raw.slice('pack:lucide/'.length).trim();
    if (name) return { kind: 'lucide', name };
    return { kind: 'default' };
  }

  if (raw.startsWith('pack:')) {
    const rest = raw.slice('pack:'.length);
    const slash = rest.indexOf('/');
    if (slash > 0) {
      const pack = rest.slice(0, slash).trim();
      const name = rest.slice(slash + 1).trim();
      if (pack && name) return { kind: 'user-svg', pack, name };
    }
    return { kind: 'default' };
  }

  return { kind: 'emoji', value: raw };
}

// ─── SVG safelist ───

export function isSvgSafe(svg: string): boolean {
  if (/<script/i.test(svg)) return false;
  if (/<foreignObject/i.test(svg)) return false;
  if (/\son\w+\s*=/i.test(svg)) return false;
  if (/href\s*=\s*["']javascript:/i.test(svg)) return false;
  return true;
}
