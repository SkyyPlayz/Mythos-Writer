// Beta 3 / M17 — Obsidian-canvas (de)serialization unit tests.

import { describe, it, expect } from 'vitest';
import {
  avatarForTitle,
  boardToCanvasJson,
  canvasJsonToBoard,
  type CanvasBoardData,
  type ObsidianCanvasJson,
} from './canvasTypes';

function sampleBoard(): CanvasBoardData {
  return {
    id: 'b1',
    name: 'The Broken Gate — board 1',
    cards: [
      { id: 'b1-0', t: 'The Broken Gate — beats', d: 'Open on the unmapped door.', av: '✦', c: 1, x: 440, y: 40, w: 280, h: 120, nid: null },
      { id: 'b1-1', t: 'Mira Veynn', d: 'POV. Dread first, wonder second.', av: 'MV', c: 0, x: 130, y: 80, w: 200, h: 86, nid: 'mira' },
      { id: 'b1-2', t: 'Drownlight', d: '', av: 'DL', c: 3, x: 1090, y: 170, w: 200, h: 86, nid: null },
    ],
    links: [
      ['b1-0', 'b1-1'],
      ['b1-0', 'b1-2'],
    ],
  };
}

describe('boardToCanvasJson', () => {
  it('serializes free-standing cards as text nodes with title + body', () => {
    const json = boardToCanvasJson(sampleBoard());
    expect(json.nodes[0]).toEqual({
      id: 'b1-0',
      type: 'text',
      x: 440,
      y: 40,
      width: 280,
      height: 120,
      text: 'The Broken Gate — beats\n\nOpen on the unmapped door.',
      color: '2',
    });
  });

  it('omits the blank separator when the card has no body', () => {
    const json = boardToCanvasJson(sampleBoard());
    expect(json.nodes[2].text).toBe('Drownlight');
    expect(json.nodes[2].color).toBe('4');
  });

  it('serializes note-attached cards as file nodes', () => {
    const json = boardToCanvasJson(sampleBoard());
    expect(json.nodes[1]).toEqual({
      id: 'b1-1',
      type: 'file',
      x: 130,
      y: 80,
      width: 200,
      height: 86,
      file: 'mira',
      color: '1',
    });
  });

  it('serializes links as fromNode/toNode edges', () => {
    const json = boardToCanvasJson(sampleBoard());
    expect(json.edges).toEqual([
      { id: 'edge-0', fromNode: 'b1-0', toNode: 'b1-1' },
      { id: 'edge-1', fromNode: 'b1-0', toNode: 'b1-2' },
    ]);
  });

  it('omits color for out-of-range slot indices', () => {
    const board = sampleBoard();
    board.cards[0].c = 9;
    expect(boardToCanvasJson(board).nodes[0].color).toBeUndefined();
  });
});

describe('canvasJsonToBoard', () => {
  it('round-trips geometry, colors, note ids, and links', () => {
    const original = sampleBoard();
    const back = canvasJsonToBoard(boardToCanvasJson(original), {
      id: original.id,
      name: original.name,
    });
    expect(back.id).toBe('b1');
    expect(back.name).toBe('The Broken Gate — board 1');
    expect(back.links).toEqual(original.links);
    expect(back.cards.map((c) => ({ x: c.x, y: c.y, w: c.w, h: c.h, c: c.c, nid: c.nid }))).toEqual(
      original.cards.map((c) => ({ x: c.x, y: c.y, w: c.w, h: c.h, c: c.c, nid: c.nid })),
    );
    // Text cards keep title + body; file cards re-derive them from the file.
    expect(back.cards[0].t).toBe('The Broken Gate — beats');
    expect(back.cards[0].d).toBe('Open on the unmapped door.');
    expect(back.cards[2].t).toBe('Drownlight');
    expect(back.cards[2].d).toBe('');
  });

  it('derives file-card titles from the basename and strips .md', () => {
    const json: ObsidianCanvasJson = {
      nodes: [
        { id: 'n1', type: 'file', x: 0, y: 0, width: 200, height: 86, file: 'People/Mira Veynn.md', color: '3' },
      ],
      edges: [],
    };
    const board = canvasJsonToBoard(json, { id: 'b2', name: 'Imported' });
    expect(board.cards[0]).toMatchObject({
      t: 'Mira Veynn',
      d: '',
      av: 'MV',
      c: 2,
      nid: 'People/Mira Veynn.md',
    });
  });

  it('strips a leading markdown heading from Obsidian text nodes', () => {
    const json: ObsidianCanvasJson = {
      nodes: [{ id: 'n1', type: 'text', x: 0, y: 0, width: 200, height: 86, text: '## Beats\n\nOpen cold.' }],
      edges: [],
    };
    const board = canvasJsonToBoard(json, { id: 'b3', name: 'Imported' });
    expect(board.cards[0].t).toBe('Beats');
    expect(board.cards[0].d).toBe('Open cold.');
  });

  it('falls back to slot 0 for missing or non-preset colors', () => {
    const json: ObsidianCanvasJson = {
      nodes: [
        { id: 'n1', type: 'text', x: 0, y: 0, width: 100, height: 60, text: 'A' },
        { id: 'n2', type: 'text', x: 0, y: 0, width: 100, height: 60, text: 'B', color: '#ff0000' },
        { id: 'n3', type: 'text', x: 0, y: 0, width: 100, height: 60, text: 'C', color: '7' },
      ],
      edges: [],
    };
    const board = canvasJsonToBoard(json, { id: 'b4', name: 'Imported' });
    expect(board.cards.map((c) => c.c)).toEqual([0, 0, 0]);
  });
});

describe('avatarForTitle', () => {
  it('takes the initials of the first two words', () => {
    expect(avatarForTitle('Mira Veynn')).toBe('MV');
    expect(avatarForTitle('The Sunken Gate')).toBe('TS');
    expect(avatarForTitle('Drownlight')).toBe('D');
  });

  it('falls back to + when there are no word characters', () => {
    expect(avatarForTitle('')).toBe('+');
    expect(avatarForTitle('···')).toBe('+');
  });
});
