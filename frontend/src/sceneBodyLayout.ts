// SKY-6196: renderer-side mirror of electron-main/src/sceneBody.ts's
// `computeSceneBodyLayout`. The manifest write IPC boundary no longer carries
// `blocks[].content` (see `stripManifestContentForIpc` in manifestIpc.ts) —
// this module computes each block's `bodySegLen` here, before content is
// blanked, so `readManifest` (electron-main/src/vault.ts) can still slice a
// scene's `.md` body back across N blocks on the next read.
//
// KEEP IN SYNC with electron-main/src/sceneBody.ts: both must derive the same
// segment boundary for a given block, or multi-block scenes fall back to
// whole-body-into-first-prose-block hydration (never data loss, just a loss
// of block structure until the scene is next saved with real content).
import type { Block } from './types';

const HEADING_PREFIX_RE = /^#{1,6}(?=\s|$)/;

export const SEGMENT_SEPARATOR = '\n\n';

export interface BlockSegmentBoundary {
  index: number;
  offset: number;
  length: number;
}

export interface SceneBodyLayout {
  segments: BlockSegmentBoundary[];
  totalLength: number;
}

/** Mirrors electron-main/src/sceneBody.ts's `computeSceneBodyLayout` exactly. */
export function computeSceneBodyLayout(blocks: Pick<Block, 'type' | 'order' | 'content'>[]): SceneBodyLayout {
  const orderIdx = blocks.map((_, i) => i).sort((a, b) => blocks[a].order - blocks[b].order);
  const raw: Array<{ index: number; length: number; leadWs: number; tailWs: number }> = [];
  for (const index of orderIdx) {
    const { type, content } = blocks[index];
    if (!content.trim()) continue;
    let length: number;
    let leadWs = 0;
    let tailWs = 0;
    switch (type) {
      case 'heading':
        length = HEADING_PREFIX_RE.test(content) ? content.length : content.length + 2;
        tailWs = content.length - content.trimEnd().length;
        break;
      case 'dialogue':
        length = content.length + 2;
        tailWs = content.length - content.trimEnd().length;
        break;
      case 'action':
        length = content.length + 4;
        break;
      case 'description':
        length = content.length + 2;
        break;
      case 'note':
        length = content.length + 9;
        break;
      default:
        length = content.length;
        leadWs = content.length - content.trimStart().length;
        tailWs = content.length - content.trimEnd().length;
    }
    raw.push({ index, length, leadWs, tailWs });
  }
  if (raw.length === 0) return { segments: [], totalLength: 0 };
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
