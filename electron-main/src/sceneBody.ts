// SKY-6596 (PR #932 review): block-aware structure-only manifest persistence.
//
// Scene `.md` bodies are produced by the renderer's `blocksToMarkdownBody`
// (frontend/src/BlockEditor.tsx) and written verbatim by `scene:save`
// (main.ts `IPC_CHANNELS.SCENE_SAVE` → `writeSceneFileAtomic`); the main
// process never re-serializes blocks on the save path. This module is the
// main-process mirror of that serializer plus its exact inverse, so that:
//
//  - `stripEmbeddedProseForPersist` (manifest.ts) can record each block's
//    serialized-segment length inside the `.md` body at manifest-write time
//    (`BlockEntry.bodySegLen`) — machine-derived, O(1) per block, no file I/O;
//  - `readManifest` (vault.ts) can slice the `.md` body back across N blocks
//    on read and invert the per-type markers, instead of dumping the whole
//    raw body into the first prose block and blanking every other block.
//
// KEEP IN SYNC with frontend/src/BlockEditor.tsx `blocksToMarkdownBody`:
// changing either side changes what scene `.md` files contain.
//
// No Electron or vault-I/O dependency; fully testable in Node.
import type { BlockEntry } from './ipc.js';

/** The minimal block shape the serializer needs. */
export type SerializableBlock = Pick<BlockEntry, 'type' | 'order' | 'content'>;

/** Mirrors HEADING_PREFIX_RE in frontend/src/BlockEditor.tsx: a heading's
 * H1–H6 level lives in its own leading `#` run inside `content`. */
const HEADING_PREFIX_RE = /^#{1,6}(?=\s|$)/;

/** Blank line between serialized segments (see blocksToMarkdownBody). */
export const SEGMENT_SEPARATOR = '\n\n';

// Non-allocating whitespace helpers — used in the manifest-write hot path
// (computeSceneBodyLayout) where .trim()/.trimEnd() would allocate a new copy
// of every block's prose string (3000 × 8KB = 24MB+ of GC pressure per write).
function isWhitespaceChar(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}
function isAllWhitespace(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (!isWhitespaceChar(s.charCodeAt(i))) return false;
  return true;
}
function leadingWsLen(s: string): number {
  let i = 0;
  while (i < s.length && isWhitespaceChar(s.charCodeAt(i))) i++;
  return i;
}
function trailingWsLen(s: string): number {
  let i = s.length - 1;
  while (i >= 0 && isWhitespaceChar(s.charCodeAt(i))) i--;
  return s.length - 1 - i;
}

/**
 * Serialize one block to its `.md`-body segment, or null when the block
 * contributes no segment (empty / whitespace-only content is skipped, exactly
 * as the frontend serializer skips it).
 */
export function serializeBlockSegment(block: SerializableBlock): string | null {
  if (isAllWhitespace(block.content)) return null;
  switch (block.type) {
    case 'heading':
      return HEADING_PREFIX_RE.test(block.content) ? block.content : `# ${block.content}`;
    case 'dialogue':
      return `> ${block.content}`;
    case 'action':
      return `**${block.content}**`;
    case 'description':
      return `*${block.content}*`;
    case 'note':
      return `<!-- ${block.content} -->`;
    default:
      return block.content;
  }
}

/**
 * Main-process mirror of the frontend's `blocksToMarkdownBody`
 * (frontend/src/BlockEditor.tsx): sort by `order` (stable), skip empty blocks,
 * wrap each block in its type marker, join with blank lines, trim the result.
 * Produces byte-identical output to the frontend serializer for any input.
 */
export function blocksToMarkdownBody(blocks: SerializableBlock[]): string {
  const sorted = [...blocks].sort((a, b) => a.order - b.order);
  const segments: string[] = [];
  for (const block of sorted) {
    const seg = serializeBlockSegment(block);
    if (seg !== null) segments.push(seg);
  }
  // Identical to the frontend's interleaved-blank-line + join('\n') + trim():
  // both reduce to segments joined by '\n\n' with the whole result trimmed.
  return segments.join(SEGMENT_SEPARATOR).trim();
}

/** One block's serialized-segment boundary within the final `.md` body. */
export interface BlockSegmentBoundary {
  /** Index into the `blocks` array passed to `computeSceneBodyLayout`. */
  index: number;
  /** Offset of this block's segment within the final (trimmed) body. */
  offset: number;
  /** Length of this block's segment within the final (trimmed) body. */
  length: number;
}

export interface SceneBodyLayout {
  /** Segment boundaries in serialization order (blocks sorted by `order`);
   * blocks with empty/whitespace-only content contribute no entry. */
  segments: BlockSegmentBoundary[];
  /** Total length of the serialized body — equals
   * `blocksToMarkdownBody(blocks).length` by construction. */
  totalLength: number;
}

/**
 * Compute each block's segment boundary within `blocksToMarkdownBody(blocks)`
 * WITHOUT building the body string — O(1) arithmetic per block, so
 * manifest writes stay O(structure) (the whole point of SKY-6596) even though
 * they now record per-block boundaries.
 *
 * Invariant (unit-tested in sceneBody.test.ts): for every returned boundary,
 * `blocksToMarkdownBody(blocks).slice(offset, offset + length)` is exactly
 * `serializeBlockSegment(blocks[index])` adjusted for the body-level trim.
 */
export function computeSceneBodyLayout(blocks: SerializableBlock[]): SceneBodyLayout {
  const orderIdx = blocks.map((_, i) => i).sort((a, b) => blocks[a].order - blocks[b].order);
  const raw: Array<{ index: number; length: number; leadWs: number; tailWs: number }> = [];
  for (const index of orderIdx) {
    const { type, content } = blocks[index];
    if (isAllWhitespace(content)) continue;
    let length: number;
    let leadWs = 0;
    let tailWs = 0;
    switch (type) {
      case 'heading':
        // Verbatim when it already carries a `#` run, else prefixed with '# '.
        length = HEADING_PREFIX_RE.test(content) ? content.length : content.length + 2;
        tailWs = trailingWsLen(content);
        break;
      case 'dialogue': // '> ' + content
        length = content.length + 2;
        tailWs = trailingWsLen(content);
        break;
      case 'action': // '**' + content + '**' — marker-terminated on both ends
        length = content.length + 4;
        break;
      case 'description': // '*' + content + '*'
        length = content.length + 2;
        break;
      case 'note': // '<!-- ' + content + ' -->'
        length = content.length + 9;
        break;
      default: // prose: content verbatim
        length = content.length;
        leadWs = leadingWsLen(content);
        tailWs = trailingWsLen(content);
    }
    raw.push({ index, length, leadWs, tailWs });
  }
  if (raw.length === 0) return { segments: [], totalLength: 0 };
  // The body-level trim() can only remove whitespace from the very first and
  // very last segments (every segment contains non-whitespace, so the trim
  // never reaches a separator).
  raw[0].length -= raw[0].leadWs;
  raw[raw.length - 1].length -= raw[raw.length - 1].tailWs;
  const segments: BlockSegmentBoundary[] = [];
  let offset = 0;
  for (let k = 0; k < raw.length; k++) {
    if (k > 0) offset += SEGMENT_SEPARATOR.length;
    segments.push({ index: raw[k].index, offset, length: raw[k].length });
    offset += raw[k].length;
  }
  return { segments, totalLength: offset };
}

/**
 * Exact inverse of `serializeBlockSegment` for a segment sliced out of the
 * `.md` body: strips the fixed type markers by construction (no guessing).
 * Returns null when the segment does not carry the markers this type is
 * guaranteed to have been written with — the caller treats that as an
 * external edit and falls back to whole-body hydration rather than mutilating
 * the user's text.
 */
export function unwrapBlockSegment(type: BlockEntry['type'], segment: string): string | null {
  switch (type) {
    case 'heading':
      // Serialized headings always carry their `#` run; keep it — the block
      // model stores heading level as the leading `#` run inside content.
      return HEADING_PREFIX_RE.test(segment) ? segment : null;
    case 'dialogue':
      return segment.startsWith('> ') ? segment.slice(2) : null;
    case 'action':
      return segment.length >= 4 && segment.startsWith('**') && segment.endsWith('**')
        ? segment.slice(2, -2)
        : null;
    case 'description':
      return segment.length >= 2 && segment.startsWith('*') && segment.endsWith('*')
        ? segment.slice(1, -1)
        : null;
    case 'note':
      return segment.length >= 9 && segment.startsWith('<!-- ') && segment.endsWith(' -->')
        ? segment.slice(5, -4)
        : null;
    default:
      return segment;
  }
}
