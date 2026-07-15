// SKY-6596 (PR #932 review) — the main-process block serializer mirror and
// its inverse. These functions underpin block-aware structure-only manifest
// persistence: stripSceneProse records segment boundaries from
// computeSceneBodyLayout, and readManifest slices + unwraps segments back
// into per-block content. The invariants tested here are exactly what keeps
// multi-block scenes from being corrupted on write→read round-trips.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  blocksToMarkdownBody,
  computeSceneBodyLayout,
  serializeBlockSegment,
  unwrapBlockSegment,
  SEGMENT_SEPARATOR,
  type SerializableBlock,
} from './sceneBody.js';
import type { BlockEntry } from './ipc.js';

const BLOCK_TYPES: BlockEntry['type'][] = ['prose', 'heading', 'dialogue', 'action', 'description', 'note'];

function b(type: BlockEntry['type'], content: string, order: number): SerializableBlock {
  return { type, content, order };
}

describe('blocksToMarkdownBody — mirror of frontend/src/BlockEditor.tsx', () => {
  it('serializes each block type with its marker, blank-line separated, like the frontend', () => {
    const blocks: SerializableBlock[] = [
      b('heading', '## The Old Mill', 0),
      b('prose', 'Rain fell on the tin roof.', 1),
      b('dialogue', 'We should not be here.', 2),
      b('action', 'She bolts the door.', 3),
      b('description', 'The lamp gutters low.', 4),
      b('note', 'check continuity with ch. 2', 5),
    ];
    expect(blocksToMarkdownBody(blocks)).toBe(
      '## The Old Mill\n\n' +
        'Rain fell on the tin roof.\n\n' +
        '> We should not be here.\n\n' +
        '**She bolts the door.**\n\n' +
        '*The lamp gutters low.*\n\n' +
        '<!-- check continuity with ch. 2 -->'
    );
  });

  it('prefixes "# " onto a heading that carries no # run (frontend H1 fallback)', () => {
    expect(blocksToMarkdownBody([b('heading', 'Untitled Heading', 0)])).toBe('# Untitled Heading');
  });

  it('keeps an existing heading # run verbatim', () => {
    expect(blocksToMarkdownBody([b('heading', '### Deep Section', 0)])).toBe('### Deep Section');
  });

  it('skips blocks with empty or whitespace-only content', () => {
    const blocks = [b('prose', 'Kept.', 0), b('dialogue', '   ', 1), b('prose', '', 2)];
    expect(blocksToMarkdownBody(blocks)).toBe('Kept.');
  });

  it('sorts by order before serializing', () => {
    const blocks = [b('prose', 'Second.', 5), b('prose', 'First.', 1)];
    expect(blocksToMarkdownBody(blocks)).toBe('First.\n\nSecond.');
  });

  it('trims the final body (leading/trailing whitespace of edge segments)', () => {
    expect(blocksToMarkdownBody([b('prose', '  padded  ', 0)])).toBe('padded');
  });

  it('returns "" for no blocks / all-empty blocks', () => {
    expect(blocksToMarkdownBody([])).toBe('');
    expect(blocksToMarkdownBody([b('prose', '', 0)])).toBe('');
  });
});

describe('computeSceneBodyLayout — boundaries match the built body without building it', () => {
  function assertLayoutMatchesBody(blocks: SerializableBlock[]) {
    const body = blocksToMarkdownBody(blocks);
    const layout = computeSceneBodyLayout(blocks);
    expect(layout.totalLength).toBe(body.length);
    let prevEnd: number | null = null;
    for (const seg of layout.segments) {
      if (prevEnd !== null) {
        expect(body.slice(prevEnd, seg.offset)).toBe(SEGMENT_SEPARATOR);
      }
      const slice = body.slice(seg.offset, seg.offset + seg.length);
      // Every slice must unwrap losslessly for its block's known type…
      const unwrapped = unwrapBlockSegment(blocks[seg.index].type as BlockEntry['type'], slice);
      expect(unwrapped).not.toBeNull();
      // …and re-serializing the unwrapped content must reproduce the slice
      // exactly (round-trip stability across arbitrarily many write→read cycles).
      const rewrapped = serializeBlockSegment({
        type: blocks[seg.index].type,
        content: unwrapped as string,
        order: blocks[seg.index].order,
      });
      expect(rewrapped).toBe(slice);
      prevEnd = seg.offset + seg.length;
    }
    if (prevEnd !== null) expect(prevEnd).toBe(body.length);
  }

  it('multi-type scene: every boundary slices its exact segment out of the body', () => {
    assertLayoutMatchesBody([
      b('heading', '## Ch 1', 0),
      b('prose', 'Alpha.', 1),
      b('dialogue', 'Beta?', 2),
      b('action', 'Gamma!', 3),
      b('description', 'Delta.', 4),
      b('note', 'Epsilon', 5),
    ]);
  });

  it('interior prose block containing a blank line does not break boundaries (why naive splitting fails)', () => {
    assertLayoutMatchesBody([
      b('prose', 'Para one.\n\nStill block one.', 0),
      b('prose', 'Block two.', 1),
    ]);
  });

  it('trim edges: leading whitespace on the first prose block and trailing on the last', () => {
    assertLayoutMatchesBody([
      b('prose', '  starts padded', 0),
      b('dialogue', 'middle', 1),
      b('prose', 'ends padded  \n', 2),
    ]);
  });

  it('trailing whitespace on a final dialogue block is trimmed with the body', () => {
    assertLayoutMatchesBody([b('prose', 'lead', 0), b('dialogue', 'tail ws  ', 1)]);
  });

  it('marker-like characters inside content stay inside the segment', () => {
    assertLayoutMatchesBody([
      b('action', 'ends with a star*', 0),
      b('description', '*already emphatic*', 1),
      b('note', 'contains --> inside', 2),
      b('dialogue', '> nested quote', 3),
    ]);
  });

  it('empty blocks contribute no segment but keep their index mapping', () => {
    const blocks = [b('prose', 'One.', 0), b('dialogue', '', 1), b('prose', 'Two.', 2)];
    const layout = computeSceneBodyLayout(blocks);
    expect(layout.segments.map((s) => s.index)).toEqual([0, 2]);
    assertLayoutMatchesBody(blocks);
  });

  it('unsorted order values: boundaries follow serialization order, indexes point at the original array', () => {
    const blocks = [b('dialogue', 'Later.', 9), b('heading', '# First', 1)];
    const layout = computeSceneBodyLayout(blocks);
    expect(layout.segments.map((s) => s.index)).toEqual([1, 0]);
    assertLayoutMatchesBody(blocks);
  });

  it('no segments → empty layout', () => {
    expect(computeSceneBodyLayout([])).toEqual({ segments: [], totalLength: 0 });
    expect(computeSceneBodyLayout([b('prose', '  ', 0)])).toEqual({ segments: [], totalLength: 0 });
  });

  it('property: layout slices always equal the built body segments, for arbitrary block lists', () => {
    const arbBlock = fc.record({
      type: fc.constantFrom(...BLOCK_TYPES),
      content: fc.string({ maxLength: 40 }),
      order: fc.integer({ min: 0, max: 20 }),
    });
    fc.assert(
      fc.property(fc.array(arbBlock, { maxLength: 8 }), (blocks) => {
        const body = blocksToMarkdownBody(blocks);
        const layout = computeSceneBodyLayout(blocks);
        expect(layout.totalLength).toBe(body.length);
        let prevEnd: number | null = null;
        for (const seg of layout.segments) {
          if (prevEnd !== null) expect(body.slice(prevEnd, seg.offset)).toBe(SEGMENT_SEPARATOR);
          const slice = body.slice(seg.offset, seg.offset + seg.length);
          const unwrapped = unwrapBlockSegment(blocks[seg.index].type, slice);
          expect(unwrapped).not.toBeNull();
          expect(
            serializeBlockSegment({ ...blocks[seg.index], content: unwrapped as string })
          ).toBe(slice);
          prevEnd = seg.offset + seg.length;
        }
      }),
      { numRuns: 200 }
    );
  });
});

describe('unwrapBlockSegment — exact inverse of serializeBlockSegment', () => {
  it('inverts every marker type by construction', () => {
    expect(unwrapBlockSegment('prose', 'plain text')).toBe('plain text');
    expect(unwrapBlockSegment('heading', '## Kept Run')).toBe('## Kept Run');
    expect(unwrapBlockSegment('dialogue', '> spoken')).toBe('spoken');
    expect(unwrapBlockSegment('action', '**moves**')).toBe('moves');
    expect(unwrapBlockSegment('description', '*seen*')).toBe('seen');
    expect(unwrapBlockSegment('note', '<!-- aside -->')).toBe('aside');
  });

  it('interior marker characters survive (slice by construction, not by pattern)', () => {
    expect(unwrapBlockSegment('action', '**a***')).toBe('a*');
    expect(unwrapBlockSegment('description', '**bold-ish**')).toBe('*bold-ish*');
    expect(unwrapBlockSegment('note', '<!-- x --> y -->')).toBe('x --> y');
    expect(unwrapBlockSegment('dialogue', '> > nested')).toBe('> nested');
  });

  it('returns null when a segment lacks the markers its type is always written with (external edit signal)', () => {
    expect(unwrapBlockSegment('heading', 'no hash run')).toBeNull();
    expect(unwrapBlockSegment('dialogue', 'no quote marker')).toBeNull();
    expect(unwrapBlockSegment('action', '**unterminated')).toBeNull();
    expect(unwrapBlockSegment('description', 'unstarred')).toBeNull();
    expect(unwrapBlockSegment('note', '<!-- unterminated')).toBeNull();
  });

  it('unwrap(wrap(content)) === content for every type with marker-free interior content', () => {
    for (const type of BLOCK_TYPES) {
      const content = type === 'heading' ? '# Stable Heading' : 'stable content';
      const seg = serializeBlockSegment({ type, content, order: 0 });
      expect(seg).not.toBeNull();
      expect(unwrapBlockSegment(type, seg as string)).toBe(content);
    }
  });
});
