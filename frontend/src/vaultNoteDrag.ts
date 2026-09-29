/** Explorer → editor drag MIME (set on VaultBrowser drag source; read by RichTextEditor). */
export const VAULT_NOTE_DRAG_MIME = 'application/x-mythos-vault-note';

/**
 * Strip wiki-link delimiter chars so a dropped filename cannot corrupt `[[title]]`
 * (Shield R2: `]]` `|` `#` / brackets).
 */
export function sanitizeWikiLinkTitle(title: string): string | null {
  const cleaned = title.replace(/[\[\]|#]/g, '').trim();
  return cleaned || null;
}

/** F2#4 / H5: map an explorer drag payload (vault-relative path) to a wiki-link title. */
export function wikiTitleFromDroppedPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes('\n') || /^https?:\/\//i.test(trimmed)) return null;
  const normalized = trimmed.replace(/\\/g, '/');
  // Path-shaped only — bare short text must not become [[title]].
  const looksLikePath = normalized.includes('/') || /\.(md|markdown|txt)$/i.test(normalized);
  if (!looksLikePath) return null;
  const leaf = normalized.split('/').pop() ?? normalized;
  const title = leaf.replace(/\.(md|markdown|txt)$/i, '').trim();
  return sanitizeWikiLinkTitle(title);
}
