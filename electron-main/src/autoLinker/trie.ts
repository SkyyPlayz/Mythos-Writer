// Trie for fast multi-pattern matching of note titles/aliases.
// Each leaf stores the canonical note name it belongs to.

export interface TrieMatch {
  /** Canonical note name (stem of the .md file). */
  noteName: string;
  /** The original term that matched (title or alias text). */
  term: string;
  /** Start offset (inclusive) in the source string. */
  start: number;
  /** End offset (exclusive) in the source string. */
  end: number;
}

interface TrieNode {
  children: Map<string, TrieNode>;
  /** Set when this node is a terminal for a note. */
  terminal?: { noteName: string; term: string };
}

function makeNode(): TrieNode {
  return { children: new Map() };
}

export class AutoLinkTrie {
  private root: TrieNode = makeNode();
  /** Map from noteName (lower) → original noteName for self-link checks. */
  private noteNames: Set<string> = new Set();

  insert(term: string, noteName: string, ignoreCase: boolean): void {
    const key = ignoreCase ? term.toLowerCase() : term;
    let node = this.root;
    for (const ch of key) {
      let child = node.children.get(ch);
      if (!child) {
        child = makeNode();
        node.children.set(ch, child);
      }
      node = child;
    }
    // Only set terminal if not already claimed (first-inserted wins for same key).
    if (!node.terminal) {
      node.terminal = { noteName, term };
    }
    this.noteNames.add(noteName);
  }

  getNoteNames(): Set<string> {
    return this.noteNames;
  }

  /**
   * Find all non-overlapping whole-word matches in `text`.
   * Longest match wins at each position (Aho-Corasick-style greedy).
   */
  findMatches(text: string, ignoreCase: boolean): TrieMatch[] {
    const haystack = ignoreCase ? text.toLowerCase() : text;
    const len = haystack.length;
    const matches: TrieMatch[] = [];
    let i = 0;

    while (i < len) {
      let node = this.root;
      let j = i;
      let lastTerminalJ = -1;
      let lastTerminal: TrieNode['terminal'] = undefined;

      while (j < len) {
        const ch = haystack[j];
        const child = node.children.get(ch);
        if (!child) break;
        node = child;
        j++;
        if (node.terminal) {
          lastTerminalJ = j;
          lastTerminal = node.terminal;
        }
      }

      if (lastTerminal && lastTerminalJ > i) {
        const start = i;
        const end = lastTerminalJ;
        // Whole-word boundary check.
        if (isWordBoundary(text, start, end)) {
          matches.push({ noteName: lastTerminal.noteName, term: lastTerminal.term, start, end });
          i = end;
          continue;
        }
      }
      i++;
    }

    return matches;
  }
}

function isWordChar(ch: string): boolean {
  return /\w/.test(ch);
}

function isWordBoundary(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1] : ' ';
  const after = end < text.length ? text[end] : ' ';
  return !isWordChar(before) && !isWordChar(after);
}
