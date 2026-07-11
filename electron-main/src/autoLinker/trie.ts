// Auto Note Linker — deterministic trie-based matching (SKY-6225)
// No LLM dependency. Pure text analysis against the vault note index.

export interface TrieNode {
  children: Map<string, TrieNode>;
  isEnd: boolean;
  data?: { targetTitle: string; targetPath: string };
}

export interface Match {
  start: number;
  end: number;
  matchedText: string;
  targetTitle: string;
  targetPath: string;
}

export interface NoteEntry {
  title: string;
  filePath: string;
  aliases: string[];
}

export function buildTrie(
  entries: NoteEntry[],
  opts: { ignoreCase: boolean },
): TrieNode {
  const root: TrieNode = { children: new Map(), isEnd: false };
  for (const entry of entries) {
    const terms = [entry.title, ...entry.aliases];
    for (const term of terms) {
      if (!term) continue;
      const key = opts.ignoreCase ? term.toLowerCase() : term;
      insertIntoTrie(root, key, entry.title, entry.filePath);
    }
  }
  return root;
}

function insertIntoTrie(
  root: TrieNode,
  term: string,
  targetTitle: string,
  targetPath: string,
): void {
  let node = root;
  for (const ch of term) {
    if (!node.children.has(ch)) {
      node.children.set(ch, { children: new Map(), isEnd: false });
    }
    node = node.children.get(ch)!;
  }
  // Don't overwrite if already set (first entry wins)
  if (!node.isEnd) {
    node.isEnd = true;
    node.data = { targetTitle, targetPath };
  }
}

export function findMatches(
  text: string,
  root: TrieNode,
  opts: { ignoreCase: boolean; wordBoundary: boolean },
): Match[] {
  const matches: Match[] = [];
  const searchText = opts.ignoreCase ? text.toLowerCase() : text;

  for (let i = 0; i < searchText.length; i++) {
    let node = root;
    let j = i;
    let lastMatch: { end: number; data: { targetTitle: string; targetPath: string } } | null =
      null;

    while (j < searchText.length && node.children.has(searchText[j])) {
      node = node.children.get(searchText[j])!;
      j++;
      if (node.isEnd && node.data) {
        lastMatch = { end: j, data: node.data };
      }
    }

    if (lastMatch) {
      const start = i;
      const end = lastMatch.end;

      if (opts.wordBoundary) {
        const before = start === 0 ? ' ' : text[start - 1];
        const after = end >= text.length ? ' ' : text[end];
        if (!/\w/.test(before) && !/\w/.test(after)) {
          matches.push({
            start,
            end,
            matchedText: text.slice(start, end),
            ...lastMatch.data,
          });
          i = end - 1;
          continue;
        }
      } else {
        matches.push({
          start,
          end,
          matchedText: text.slice(start, end),
          ...lastMatch.data,
        });
        i = end - 1;
      }
    }
  }

  return matches;
}
