/**
 * SKY-11191 — which connectors a board draws, and where they start and end.
 *
 * The two rules that matter:
 *   - a connector needs BOTH ends on this board (the vault-wide view is the
 *     Vault Graph, not the overlay), and
 *   - a `column` furniture item's `ref` (SKY-11188 / ticket 5) is just another
 *     link source, resolved by the same stem rule every other link surface
 *     uses — not a bespoke "board ref" link type.
 */
import { describe, it, expect } from 'vitest';
import {
  boardWikiLinks,
  clipToRectBorder,
  connectorSegments,
  furnitureAnchorKey,
  furnitureAnchorRects,
  refStem,
} from './boardLinks';
import type { FurnitureRecord, LinkableItem } from './boardLinks';
import { defaultFurnitureSize } from './boardLod';

const note = (path: string): LinkableItem => ({
  path,
  kind: 'note',
  name: path.replace(/\.md$/i, ''),
});

const folder = (path: string): LinkableItem => ({ path, kind: 'folder', name: path });

describe('refStem', () => {
  it('reduces a path to its last segment, drops .md and lower-cases — the app-wide link key', () => {
    expect(refStem('Characters/Aria.md')).toBe('aria');
    expect(refStem('Aria')).toBe('aria');
    expect(refStem('Characters\\Aria.MD')).toBe('aria');
  });
});

describe('boardWikiLinks — prose [[wikilinks]]', () => {
  const items = [note('Aria.md'), note('Kesh.md'), folder('Places')];

  it('draws a connector when both ends are notes on this board', () => {
    const links = boardWikiLinks({
      folderPath: 'Characters',
      items,
      edges: [{ source: 'Characters/Aria.md', target: 'Characters/Kesh.md' }],
    });
    expect(links).toEqual([
      { id: 'Aria.md→Kesh.md', from: 'Aria.md', to: 'Kesh.md', label: 'Aria links to Kesh' },
    ]);
  });

  it('resolves against Home, whose folderPath is the empty string', () => {
    const links = boardWikiLinks({
      folderPath: '',
      items,
      edges: [{ source: 'Aria.md', target: 'Kesh.md' }],
    });
    expect(links).toHaveLength(1);
  });

  it('draws nothing when the far end is on another board', () => {
    const links = boardWikiLinks({
      folderPath: 'Characters',
      items,
      edges: [{ source: 'Characters/Aria.md', target: 'Places/Bay.md' }],
    });
    expect(links).toEqual([]);
  });

  it('keeps both directions of a mutual link as two distinct connectors', () => {
    const links = boardWikiLinks({
      folderPath: 'Characters',
      items,
      edges: [
        { source: 'Characters/Aria.md', target: 'Characters/Kesh.md' },
        { source: 'Characters/Kesh.md', target: 'Characters/Aria.md' },
      ],
    });
    expect(links.map((l) => l.id)).toEqual(['Aria.md→Kesh.md', 'Kesh.md→Aria.md']);
  });

  it('de-duplicates a repeated edge, so a note linked twice draws one line', () => {
    const links = boardWikiLinks({
      folderPath: 'Characters',
      items,
      edges: [
        { source: 'Characters/Aria.md', target: 'Characters/Kesh.md' },
        { source: 'Characters/Aria.md', target: 'Characters/Kesh.md' },
      ],
    });
    expect(links).toHaveLength(1);
  });

  it('never connects a card to itself', () => {
    const links = boardWikiLinks({
      folderPath: 'Characters',
      items,
      edges: [{ source: 'Characters/Aria.md', target: 'Characters/Aria.md' }],
    });
    expect(links).toEqual([]);
  });
});

describe('boardWikiLinks — column `ref` items (ticket 5)', () => {
  const items = [note('Aria.md'), note('Kesh.md')];
  const column = (over: Partial<FurnitureRecord> = {}): FurnitureRecord => ({
    id: 'col1',
    k: 'column',
    x: 40,
    y: 40,
    title: 'Cast',
    items: [{ t: 'Aria', ref: 'Characters/Aria.md' }],
    ...over,
  });

  it('anchors the connector at the column box and points it at the referenced card', () => {
    const links = boardWikiLinks({
      folderPath: 'Characters',
      items,
      edges: [],
      furniture: [column()],
    });
    expect(links).toEqual([
      {
        id: 'furniture:col1→Aria.md',
        from: 'furniture:col1',
        to: 'Aria.md',
        label: 'Cast links to Aria',
      },
    ]);
  });

  it('resolves a bare-stem ref the same way a [[wikilink]] does', () => {
    const links = boardWikiLinks({
      folderPath: 'Characters',
      items,
      edges: [],
      furniture: [column({ items: [{ t: 'K', ref: 'kesh' }] })],
    });
    expect(links[0].to).toBe('Kesh.md');
  });

  it('ignores rows without a ref, and refs pointing off this board', () => {
    const links = boardWikiLinks({
      folderPath: 'Characters',
      items,
      edges: [],
      furniture: [column({ items: [{ t: 'plain row' }, { t: 'Bay', ref: 'Places/Bay.md' }] })],
    });
    expect(links).toEqual([]);
  });

  it('ignores furniture that is not a column, and malformed rows', () => {
    const links = boardWikiLinks({
      folderPath: 'Characters',
      items,
      edges: [],
      furniture: [
        column({ k: 'check' }),
        column({ id: 'col2', items: [null, 'string row', { t: 'x', ref: 42 }] as unknown[] }),
      ],
    });
    expect(links).toEqual([]);
  });
});

describe('furnitureAnchorRects', () => {
  // Asserted against `defaultFurnitureSize` rather than against literals: the
  // point of the fallback is that the anchor box IS the box BoardCanvas paints
  // the column in, so a change to that formula must move both or neither.
  it('falls back to the column default box when the user has never resized it', () => {
    const rects = furnitureAnchorRects([
      { id: 'col1', k: 'column', x: 20, y: 60, items: [{ t: 'a' }, { t: 'b' }] },
    ]);
    const def = defaultFurnitureSize('column', 2);
    expect(rects.get(furnitureAnchorKey('col1'))).toEqual({ x: 20, y: 60, w: def.w, h: def.h });
  });

  it('uses a stored size when there is one', () => {
    const rects = furnitureAnchorRects([{ id: 'c', k: 'column', x: 0, y: 0, w: 300, h: 200 }]);
    expect(rects.get('furniture:c')).toEqual({ x: 0, y: 0, w: 300, h: 200 });
  });
});

describe('connector geometry', () => {
  it('starts and ends on the boxes’ borders, not at their centres', () => {
    const rect = { x: 0, y: 0, w: 100, h: 100 };
    expect(clipToRectBorder(rect, 500, 50)).toEqual({ x: 100, y: 50 }); // right edge
    expect(clipToRectBorder(rect, 50, -500)).toEqual({ x: 50, y: 0 }); // top edge
  });

  it('degenerates to the centre when the two boxes are concentric', () => {
    expect(clipToRectBorder({ x: 0, y: 0, w: 10, h: 10 }, 5, 5)).toEqual({ x: 5, y: 5 });
  });

  it('resolves a link to a segment between the two anchors', () => {
    const anchors = new Map([
      ['a.md', { x: 0, y: 0, w: 100, h: 100 }],
      ['b.md', { x: 300, y: 0, w: 100, h: 100 }],
    ]);
    const [segment] = connectorSegments(
      [{ id: 'a→b', from: 'a.md', to: 'b.md', label: 'a links to b' }],
      anchors,
    );
    expect(segment).toEqual({ id: 'a→b', label: 'a links to b', x1: 100, y1: 50, x2: 300, y2: 50 });
  });

  it('skips a link whose anchor is not on the board — no line to (0, 0)', () => {
    const anchors = new Map([['a.md', { x: 0, y: 0, w: 10, h: 10 }]]);
    expect(
      connectorSegments([{ id: 'a→gone', from: 'a.md', to: 'gone.md', label: '' }], anchors),
    ).toEqual([]);
  });
});
