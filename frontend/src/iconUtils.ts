// Icon value parsing and SVG safelist for SKY-194 (Iconize).

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
