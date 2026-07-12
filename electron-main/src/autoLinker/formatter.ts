// Auto Note Linker — wiki-link formatter (SKY-6225)

import type { Match } from './trie.js';

export function formatText(
  text: string,
  matches: Match[],
  _existingLinkTitles: Set<string>,
): string {
  if (matches.length === 0) return text;

  // Parse frontmatter range
  const frontmatterEnd = getFrontmatterEnd(text);

  // Find all existing [[link]] ranges to skip
  const existingRanges = findExistingLinkRanges(text);

  // Filter matches: skip frontmatter, skip overlaps with existing links
  const validMatches = matches.filter((m) => {
    if (m.start < frontmatterEnd) return false;
    if (existingRanges.some((r) => m.start < r.end && m.end > r.start)) return false;
    return true;
  });

  if (validMatches.length === 0) return text;

  // Sort right-to-left to preserve offsets during replacement
  validMatches.sort((a, b) => b.start - a.start);

  let result = text;
  for (const match of validMatches) {
    result =
      result.slice(0, match.start) +
      `[[${match.matchedText}]]` +
      result.slice(match.end);
  }
  return result;
}

function getFrontmatterEnd(text: string): number {
  if (!text.startsWith('---')) return 0;
  const second = text.indexOf('\n---', 3);
  if (second === -1) return 0;
  return second + 4; // past the closing ---\n
}

function findExistingLinkRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const re = /\[\[.*?\]\]/gs;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length });
  }
  return ranges;
}
