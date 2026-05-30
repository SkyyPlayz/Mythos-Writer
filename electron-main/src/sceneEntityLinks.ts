// Pure helpers for scene ↔ entity link management (SKY-170).
// No Electron dependency — fully unit-testable in Node.

/**
 * Extracts unique entity IDs from Markdown prose.
 * Matches the pattern  [display text](entity://ent_<id>)
 * and returns the `ent_<id>` portion, deduplicated.
 */
export function parseEntityMentions(prose: string): string[] {
  const seen = new Set<string>();
  const re = /\[[^\]]*\]\(entity:\/\/(ent_[^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prose)) !== null) {
    seen.add(m[1]);
  }
  return [...seen];
}
