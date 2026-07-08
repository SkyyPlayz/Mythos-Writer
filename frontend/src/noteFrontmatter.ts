// M16 (Beta 3 Liquid Neon): frontmatter-backed note metadata.
//
// The Notes properties panel (NoteProperties.tsx) reads and edits the YAML
// frontmatter block that the M15 templates write (`title:` / `type:` /
// `createdAt:` scalars) plus a `tags:` list. This module is a deliberately
// small line-preserving editor — NOT a general YAML parser: it round-trips
// unknown lines untouched, only ever rewriting the single scalar line (or
// tags list) it was asked to change, so hand-written frontmatter survives.

export interface NoteFrontmatterField {
  key: string;
  value: string;
}

export interface NoteFrontmatter {
  hasFrontmatter: boolean;
  /** Top-level scalar `key: value` entries in file order, excluding `tags`. */
  fields: NoteFrontmatterField[];
  tags: string[];
}

const FM_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/;
const SCALAR_RE = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/;

function unquote(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

function parseInlineList(raw: string): string[] {
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '');
  return inner
    .split(',')
    .map((t) => unquote(t).replace(/^#/, ''))
    .filter(Boolean);
}

/** Quote a scalar for YAML output when it contains characters YAML would misread. */
export function quoteFrontmatterValue(value: string): string {
  if (value === '' || /[:#[\]{}"'\n]|^\s|\s$/.test(value)) {
    return `"${value.replace(/"/g, "'")}"`;
  }
  return value;
}

/**
 * Parse the top-level scalar fields + tags out of a note's frontmatter.
 * Nested/block values (indented children) are skipped — they are preserved
 * on write but not surfaced as editable rows.
 */
export function parseNoteFrontmatter(content: string): NoteFrontmatter {
  const m = content.match(FM_RE);
  if (!m) return { hasFrontmatter: false, fields: [], tags: [] };

  const lines = m[1].split(/\r?\n/);
  const fields: NoteFrontmatterField[] = [];
  const tags: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const scalar = line.match(SCALAR_RE);
    if (!scalar) continue; // indented child / list item / comment — preserved, not surfaced
    const key = scalar[1];
    const rawValue = scalar[2].trim();

    if (key.toLowerCase() === 'tags') {
      if (rawValue.startsWith('[')) {
        tags.push(...parseInlineList(rawValue));
      } else if (rawValue === '') {
        // block list: consume following `- item` lines
        for (let j = i + 1; j < lines.length; j++) {
          const item = lines[j].match(/^[ \t]+-[ \t]*(.*)$/);
          if (!item) break;
          const t = unquote(item[1]).replace(/^#/, '');
          if (t) tags.push(t);
        }
      } else {
        tags.push(...rawValue.split(/[,\s]+/).map((t) => unquote(t).replace(/^#/, '')).filter(Boolean));
      }
      continue;
    }

    // Scalar field. A key with an empty value followed by indented lines is a
    // block (nested map / list) — skip those from the editable rows.
    if (rawValue === '') {
      const next = lines[i + 1] ?? '';
      if (/^[ \t]/.test(next)) continue;
    }
    fields.push({ key, value: unquote(rawValue) });
  }

  return { hasFrontmatter: true, fields, tags };
}

/** Split a note into its raw frontmatter inner lines + the body that follows. */
function splitFrontmatter(content: string): { inner: string[]; body: string } | null {
  const m = content.match(FM_RE);
  if (!m) return null;
  return { inner: m[1].split(/\r?\n/), body: content.slice(m[0].length) };
}

function joinFrontmatter(inner: string[], body: string): string {
  return `---\n${inner.join('\n')}\n---\n${body}`;
}

/**
 * Set (or add) a top-level scalar field, preserving every other line.
 * Creates a frontmatter block when the note has none.
 */
export function setFrontmatterField(content: string, key: string, value: string): string {
  const rendered = `${key}: ${quoteFrontmatterValue(value)}`;
  const parts = splitFrontmatter(content);
  if (!parts) {
    return `---\n${rendered}\n---\n\n${content}`;
  }
  const { inner, body } = parts;
  const keyRe = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}:[ \\t]*`, 'i');
  const idx = inner.findIndex((line) => keyRe.test(line));
  if (idx === -1) {
    return joinFrontmatter([...inner, rendered], body);
  }
  const next = inner.slice();
  next[idx] = rendered;
  return joinFrontmatter(next, body);
}

/** Remove a top-level scalar field (no-op when absent or nested). */
export function removeFrontmatterField(content: string, key: string): string {
  const parts = splitFrontmatter(content);
  if (!parts) return content;
  const { inner, body } = parts;
  const keyRe = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}:[ \\t]*`, 'i');
  const idx = inner.findIndex((line) => keyRe.test(line));
  if (idx === -1) return content;
  const next = inner.slice(0, idx).concat(inner.slice(idx + 1));
  if (next.length === 0) return body.replace(/^\r?\n/, '');
  return joinFrontmatter(next, body);
}

/**
 * Replace the `tags:` entry (inline or block form) with an inline list,
 * creating frontmatter / the entry as needed. An empty list removes it.
 */
export function setFrontmatterTags(content: string, tags: string[]): string {
  const clean = tags.map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
  const rendered = `tags: [${clean.map(quoteFrontmatterValue).join(', ')}]`;
  const parts = splitFrontmatter(content);
  if (!parts) {
    if (clean.length === 0) return content;
    return `---\n${rendered}\n---\n\n${content}`;
  }
  const { inner, body } = parts;
  const idx = inner.findIndex((line) => /^tags:[ \t]*/i.test(line));
  if (idx === -1) {
    if (clean.length === 0) return content;
    return joinFrontmatter([...inner, rendered], body);
  }
  // Drop the tags line plus any block-list items directly under it.
  let end = idx + 1;
  if (inner[idx].match(/^tags:[ \t]*$/i)) {
    while (end < inner.length && /^[ \t]+-[ \t]*/.test(inner[end])) end++;
  }
  const next = inner.slice(0, idx).concat(clean.length > 0 ? [rendered] : [], inner.slice(end));
  if (next.length === 0) return body.replace(/^\r?\n/, '');
  return joinFrontmatter(next, body);
}
