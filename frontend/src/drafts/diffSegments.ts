// Beta 3 "Liquid Neon" M12 — pure word-level diff for the drafts compare
// views. Produces the prototype's segment shape (diffData 3130–3139): a flat
// list of `{ t, k }` where k is 's' (same), 'd' (removed — red strike) or
// 'a' (added — green). No dependencies; word-level LCS with common
// prefix/suffix trimming so typical "edited one paragraph" diffs stay cheap.

export type DiffKind = 's' | 'd' | 'a';

export interface DiffSegment {
  /** Segment text, whitespace included. */
  t: string;
  /** Segment kind: 's' same · 'd' removed from the old draft · 'a' added in the new draft. */
  k: DiffKind;
}

/** DP-table budget: beyond this the middle chunk falls back to a coarse
 *  delete-all + add-all pair instead of an O(n·m) LCS (keeps huge pastes
 *  from freezing the renderer). ~3000×3000 tokens ≈ 36 MB of Uint32Array. */
const MAX_DP_CELLS = 9_000_000;

/** Tokenize into words with their trailing whitespace attached (plus a
 *  leading-whitespace token when the text starts with whitespace). Keeping
 *  the space glued to the word makes replaced phrases come out as single
 *  contiguous segments instead of space-fragmented confetti. */
function tokenize(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

/**
 * Word-level LCS diff of two draft texts.
 *
 * Returns merged segments in document order. At a replace point the removed
 * ('d') run always precedes the added ('a') run, matching the prototype's
 * old-then-new presentation. `diffSegments('', '')` is `[]`; identical texts
 * yield a single 's' segment.
 */
export function diffSegments(oldText: string, newText: string): DiffSegment[] {
  if (oldText === newText) return oldText ? [{ t: oldText, k: 's' }] : [];

  const a = tokenize(oldText);
  const b = tokenize(newText);

  // Trim the common prefix and suffix so the DP table only covers the change.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const out: DiffSegment[] = [];
  const push = (t: string, k: DiffKind) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.k === k) last.t += t;
    else out.push({ t, k });
  };

  push(a.slice(0, start).join(''), 's');

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;

  if (n === 0 || m === 0 || (n + 1) * (m + 1) > MAX_DP_CELLS) {
    push(midA.join(''), 'd');
    push(midB.join(''), 'a');
  } else {
    // dp[i][j] = LCS length of midA[i:] vs midB[j:], flattened row-major.
    const w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] =
          midA[i] === midB[j]
            ? dp[(i + 1) * w + j + 1] + 1
            : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }

    // Forward walk; batch each change run as one 'd' block then one 'a' block.
    let i = 0;
    let j = 0;
    let pendingD = '';
    let pendingA = '';
    const flush = () => {
      push(pendingD, 'd');
      push(pendingA, 'a');
      pendingD = '';
      pendingA = '';
    };
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        flush();
        push(midA[i], 's');
        i++;
        j++;
      } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
        pendingD += midA[i];
        i++;
      } else {
        pendingA += midB[j];
        j++;
      }
    }
    while (i < n) pendingD += midA[i++];
    while (j < m) pendingA += midB[j++];
    flush();
  }

  push(a.slice(endA).join(''), 's');
  return out;
}

/**
 * One side of the two-column diff, split into paragraph rows on blank lines.
 * `side: 'old'` keeps 's' + 'd' segments (prototype `r.old`), `side: 'new'`
 * keeps 's' + 'a' (`r.neu`). Whitespace-only paragraphs are dropped.
 */
export function sideParagraphs(segments: DiffSegment[], side: 'old' | 'new'): DiffSegment[][] {
  const drop: DiffKind = side === 'old' ? 'a' : 'd';
  const paras: DiffSegment[][] = [[]];
  for (const seg of segments) {
    if (seg.k === drop) continue;
    const parts = seg.t.split(/\n\s*\n/);
    parts.forEach((part, idx) => {
      if (idx > 0) paras.push([]);
      if (!part) return;
      const row = paras[paras.length - 1];
      const last = row[row.length - 1];
      if (last && last.k === seg.k) last.t += part;
      else row.push({ t: part, k: seg.k });
    });
  }
  return paras.filter((row) => row.some((seg) => seg.t.trim().length > 0));
}

/** Word count used by the drafts popover meta/delta chips. */
export function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}
