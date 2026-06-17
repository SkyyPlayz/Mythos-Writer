// Pure utility — extracts entity-relevant fields from Notes Vault frontmatter.
// No IPC, no filesystem calls; takes raw file content, returns structured metadata.
import { parseFrontmatter } from '../vault.js';

export interface EntityFrontmatterResult {
  aliases: string[];
  type: string | null;
}

export function parseEntityFrontmatter(content: string): EntityFrontmatterResult {
  const { frontmatter } = parseFrontmatter(content);

  const raw = frontmatter['aliases'];
  const aliases: string[] = Array.isArray(raw)
    ? raw.map(String).filter(Boolean)
    : typeof raw === 'string' && raw.trim()
      ? [raw.trim()]
      : [];

  const typeRaw = frontmatter['type'];
  const type = typeof typeRaw === 'string' && typeRaw.trim() ? typeRaw.trim() : null;

  return { aliases, type };
}
