// Auto-format engine: replaces plain-text note mentions with [[wiki links]].
// BUILT-IN · NO AI. Port of kdnk/obsidian-automatic-linker behaviour.
//
// Invariants:
//  - Never rewrites text already inside a [[...]] link.
//  - Never rewrites text inside code fences or inline code spans.
//  - Never self-links (when preventSelfLink is on).
//  - Never touches existing markdown links [text](url) or bare URLs.

import { AutoLinkTrie } from './trie.js';
import type { NoteEntry, AutoLinkerToggles } from './types.js';

// Regex that matches regions we must NOT touch:
//   1. [[existing wiki links]]
//   2. [markdown links](...)
//   3. `inline code`
//   4. ```code fences``` (simplified — full fence handled by line scanner)
//   5. http(s):// URLs
const PROTECTED_RE =
  /(\[\[.*?\]\]|\[.*?\]\(.*?\)|`[^`]*`|https?:\/\/\S+)/g;

/** Build the trie from scanned notes. */
export function buildTrie(
  notes: NoteEntry[],
  toggles: Pick<AutoLinkerToggles, 'includeAliases' | 'ignoreCase'>,
): AutoLinkTrie {
  const trie = new AutoLinkTrie();
  for (const note of notes) {
    if (note.linkerOff) continue;
    const excluded = new Set(note.linkerExclude.map((s) => s.toLowerCase()));
    const addTerm = (term: string) => {
      if (!term.trim()) return;
      if (excluded.has(term.toLowerCase())) return;
      trie.insert(term, note.name, toggles.ignoreCase);
    };
    addTerm(note.name);
    if (toggles.includeAliases) {
      for (const alias of note.aliases) addTerm(alias);
    }
  }
  return trie;
}

/**
 * Format a single file's content: add [[wiki links]] for plain mentions.
 *
 * @param content   Raw file text (with frontmatter).
 * @param selfName  Stem of the file being formatted (for self-link prevention).
 * @param trie      Pre-built trie (from buildTrie).
 * @param toggles   Behaviour flags.
 * @returns         New content string (unchanged if nothing to replace).
 */
export function formatContent(
  content: string,
  selfName: string,
  trie: AutoLinkTrie,
  toggles: Pick<AutoLinkerToggles, 'ignoreCase' | 'preventSelfLink'>,
): string {
  const lines = content.split('\n');
  let inFence = false;
  let inFrontmatter = false;
  let frontmatterDone = false;
  const resultLines: string[] = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];

    // Handle YAML frontmatter block (only valid at file start).
    if (idx === 0 && line === '---') {
      inFrontmatter = true;
      resultLines.push(line);
      continue;
    }
    if (inFrontmatter && !frontmatterDone) {
      resultLines.push(line);
      if (line === '---') {
        inFrontmatter = false;
        frontmatterDone = true;
      }
      continue;
    }

    // Toggle fences — content inside triple-backtick blocks is untouched.
    if (/^```/.test(line)) {
      inFence = !inFence;
      resultLines.push(line);
      continue;
    }
    if (inFence) {
      resultLines.push(line);
      continue;
    }

    resultLines.push(formatLine(line, selfName, trie, toggles));
  }

  return resultLines.join('\n');
}

function formatLine(
  line: string,
  selfName: string,
  trie: AutoLinkTrie,
  toggles: Pick<AutoLinkerToggles, 'ignoreCase' | 'preventSelfLink'>,
): string {
  // Skip frontmatter lines (caller should strip them, but be defensive).
  if (line.startsWith('---')) return line;

  // Split line into protected and free segments.
  const segments: Array<{ text: string; protected: boolean }> = [];
  let last = 0;
  for (const m of line.matchAll(PROTECTED_RE)) {
    if (m.index! > last) {
      segments.push({ text: line.slice(last, m.index!), protected: false });
    }
    segments.push({ text: m[0], protected: true });
    last = m.index! + m[0].length;
  }
  if (last < line.length) {
    segments.push({ text: line.slice(last), protected: false });
  }

  const resultParts: string[] = [];
  for (const seg of segments) {
    if (seg.protected) {
      resultParts.push(seg.text);
      continue;
    }
    resultParts.push(linkifySegment(seg.text, selfName, trie, toggles));
  }
  return resultParts.join('');
}

function linkifySegment(
  text: string,
  selfName: string,
  trie: AutoLinkTrie,
  toggles: Pick<AutoLinkerToggles, 'ignoreCase' | 'preventSelfLink'>,
): string {
  const matches = trie.findMatches(text, toggles.ignoreCase);
  if (matches.length === 0) return text;

  // Filter self-links.
  const filtered = toggles.preventSelfLink
    ? matches.filter(
        (m) => m.noteName.toLowerCase() !== selfName.toLowerCase(),
      )
    : matches;

  if (filtered.length === 0) return text;

  // Build result by splicing in [[links]].
  let result = '';
  let cursor = 0;
  for (const m of filtered) {
    result += text.slice(cursor, m.start);
    result += `[[${m.noteName}]]`;
    cursor = m.end;
  }
  result += text.slice(cursor);
  return result;
}
