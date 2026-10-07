/**
 * PLAN-058 L6 (30:00 / 30:10): resolve vault-relative image paths for inline
 * note images (markdown `![alt](path)` and TipTap image nodes).
 */
/** Resolve a markdown image `src` relative to the open note's vault path. */
export function resolveNoteImageVaultPath(notePath: string, src: string): string {
  const trimmed = src.trim();
  if (!trimmed) return trimmed;
  if (/^(https?:|data:|file:|blob:)/i.test(trimmed)) return trimmed;
  const norm = notePath.replace(/\\/g, '/');
  const dir = norm.includes('/') ? norm.slice(0, norm.lastIndexOf('/')) : '';
  const combined = `${dir ? `${dir}/` : ''}${trimmed}`.replace(/\/+/g, '/');
  const parts = combined.split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '.' || p === '') continue;
    if (p === '..') {
      out.pop();
      continue;
    }
    out.push(p);
  }
  return out.join('/');
}

const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;

export function parseMarkdownImageLine(line: string): { alt: string; src: string } | null {
  const m = line.trim().match(IMAGE_LINE);
  if (!m) return null;
  return { alt: m[1], src: m[2].trim() };
}
