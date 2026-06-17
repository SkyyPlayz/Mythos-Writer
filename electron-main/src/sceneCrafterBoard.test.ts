import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  parseBoardMarkdown,
  serializeBoardMarkdown,
  createBoard,
  boardRelPath,
} from './sceneCrafterBoard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '../fixtures/scene-crafter-sample.md');

const SAMPLE = fs.readFileSync(FIXTURE, 'utf-8').replace(/\r\n/g, '\n');
const SAMPLE_CRLF = SAMPLE.replace(/\n/g, '\r\n');

describe('parseBoardMarkdown', () => {
  it('extracts storyId and lastModified from frontmatter', () => {
    const board = parseBoardMarkdown(SAMPLE);
    expect(board.storyId).toBe('3fa85f64-5717-4562-b3fc-2c963f66afa6');
    expect(board.lastModified).toBe('2026-05-23T12:00:00.000Z');
  });

  it('parses all five lanes', () => {
    const board = parseBoardMarkdown(SAMPLE);
    expect(board.lanes.map(l => l.name)).toEqual(['Idea', 'Outline', 'Draft', 'Revision', 'Done']);
  });

  it('parses CRLF board markdown from Windows checkouts', () => {
    const board = parseBoardMarkdown(SAMPLE_CRLF);
    expect(board.storyId).toBe('3fa85f64-5717-4562-b3fc-2c963f66afa6');
    expect(board.lanes.map(l => l.name)).toEqual(['Idea', 'Outline', 'Draft', 'Revision', 'Done']);
    expect(board.lanes[0].cards).toHaveLength(2);
  });

  it('parses cards in each lane', () => {
    const board = parseBoardMarkdown(SAMPLE);
    expect(board.lanes[0].cards).toHaveLength(2);
    expect(board.lanes[1].cards).toHaveLength(1);
    expect(board.lanes[4].cards).toHaveLength(1);
  });

  it('parses card wikilink and title', () => {
    const board = parseBoardMarkdown(SAMPLE);
    const card = board.lanes[0].cards[0];
    expect(card.wikilink).toBe('scenes/the-lost-heir/tavern-meeting');
    expect(card.title).toBe('The Tavern Meeting');
  });

  it('parses card done status', () => {
    const board = parseBoardMarkdown(SAMPLE);
    const open = board.lanes[0].cards[0];
    const done = board.lanes[4].cards[0];
    expect(open.done).toBe(false);
    expect(done.done).toBe(true);
  });

  it('parses tags', () => {
    const board = parseBoardMarkdown(SAMPLE);
    expect(board.lanes[0].cards[0].tags).toEqual(['act1']);
    expect(board.lanes[0].cards[1].tags).toEqual(['act1', 'mystery']);
  });

  it('parses path-style tags (e.g. manuscript/sceneId) as a single tag', () => {
    const src = `---
kanban-plugin: board
mythos-board-version: 1
story-id: abc
last-modified: 2026-01-01T00:00:00.000Z
---

## Idea

- [ ] [[scenes/foo|Foo]] #manuscript/abc123

%% kanban:settings
{"kanban-plugin":"board"}
%%
`;
    const board = parseBoardMarkdown(src);
    expect(board.lanes[0].cards[0].tags).toEqual(['manuscript/abc123']);
  });

  it('preserves kanban settings block', () => {
    const board = parseBoardMarkdown(SAMPLE);
    expect(board.kanbanSettings).toBe('{"kanban-plugin":"board"}');
  });

  it('ignores known frontmatter keys in extraFrontmatter', () => {
    const board = parseBoardMarkdown(SAMPLE);
    expect(board.extraFrontmatter).not.toHaveProperty('kanban-plugin');
    expect(board.extraFrontmatter).not.toHaveProperty('story-id');
  });
});

describe('serializeBoardMarkdown', () => {
  it('round-trips the sample fixture exactly', () => {
    const board = parseBoardMarkdown(SAMPLE);
    const out = serializeBoardMarkdown(board);
    expect(out).toBe(SAMPLE);
  });

  it('normalizes CRLF input to deterministic LF output', () => {
    const board = parseBoardMarkdown(SAMPLE_CRLF);
    const out = serializeBoardMarkdown(board);

    expect(out).toBe(SAMPLE);
  });

  it('writes valid kanban-plugin frontmatter key', () => {
    const board = createBoard('abc-123');
    const md = serializeBoardMarkdown(board);
    expect(md).toContain('kanban-plugin: board');
  });

  it('writes mythos-board-version: 1', () => {
    const board = createBoard('abc-123');
    const md = serializeBoardMarkdown(board);
    expect(md).toContain('mythos-board-version: 1');
  });

  it('writes settings block at end', () => {
    const board = createBoard('abc-123');
    const md = serializeBoardMarkdown(board);
    expect(md.trimEnd()).toMatch(/%% kanban:settings\n.*\n%%$/s);
  });

  it('serializes done cards with [x]', () => {
    const board = createBoard('abc-123');
    board.lanes[4].cards.push({
      wikilink: 'scenes/foo/bar',
      title: 'Bar Scene',
      done: true,
      tags: [],
      raw: '',
    });
    const md = serializeBoardMarkdown(board);
    expect(md).toContain('- [x] [[scenes/foo/bar|Bar Scene]]');
  });

  it('serializes open cards with [ ]', () => {
    const board = createBoard('abc-123');
    board.lanes[0].cards.push({
      wikilink: 'scenes/foo/baz',
      title: 'Baz Scene',
      done: false,
      tags: ['act1'],
      raw: '',
    });
    const md = serializeBoardMarkdown(board);
    expect(md).toContain('- [ ] [[scenes/foo/baz|Baz Scene]] #act1');
  });
});

describe('createBoard', () => {
  it('creates five default lanes', () => {
    const board = createBoard('story-id-xyz');
    expect(board.lanes).toHaveLength(5);
    expect(board.lanes[0].name).toBe('Idea');
    expect(board.lanes[4].name).toBe('Done');
  });

  it('sets storyId', () => {
    const board = createBoard('story-id-xyz');
    expect(board.storyId).toBe('story-id-xyz');
  });

  it('starts with empty lanes', () => {
    const board = createBoard('story-id-xyz');
    board.lanes.forEach(lane => expect(lane.cards).toHaveLength(0));
  });
});

describe('boardRelPath', () => {
  it('returns scenes/<slug>/board.md', () => {
    expect(boardRelPath('the-lost-heir')).toBe('scenes/the-lost-heir/board.md');
  });
});

describe('parseBoardMarkdown — bare wikilinks (Delta 1)', () => {
  const BARE_MD = `---
kanban-plugin: board
mythos-board-version: 1
story-id: bare-test
last-modified: 2026-01-01T00:00:00.000Z
---

## Idea

- [ ] [[scenes/foo/bar]]
- [x] [[scenes/baz/qux]] #act1

%% kanban:settings
{"kanban-plugin":"board"}
%%
`;

  it('parses bare [[path]] using basename as title', () => {
    const board = parseBoardMarkdown(BARE_MD);
    expect(board.lanes[0].cards).toHaveLength(2);
    const card = board.lanes[0].cards[0];
    expect(card.wikilink).toBe('scenes/foo/bar');
    expect(card.title).toBe('bar');
    expect(card.done).toBe(false);
  });

  it('parses done status on bare wikilink card', () => {
    const board = parseBoardMarkdown(BARE_MD);
    expect(board.lanes[0].cards[1].done).toBe(true);
    expect(board.lanes[0].cards[1].wikilink).toBe('scenes/baz/qux');
  });

  it('parses tags on bare wikilink card', () => {
    const board = parseBoardMarkdown(BARE_MD);
    expect(board.lanes[0].cards[1].tags).toEqual(['act1']);
  });

  it('preserves raw line for round-trip fidelity', () => {
    const board = parseBoardMarkdown(BARE_MD);
    expect(board.lanes[0].cards[0].raw).toBe('- [ ] [[scenes/foo/bar]]');
  });
});

describe('pre-v1 migration (Delta 2)', () => {
  const PRE_V1_FIXTURE = path.join(__dirname, '../fixtures/scene-crafter-pre-v1.md');
  const src = fs.readFileSync(PRE_V1_FIXTURE, 'utf-8');

  it('fixture contains no mythos-board-version', () => {
    expect(src).not.toContain('mythos-board-version');
  });

  it('parses pre-v1 fixture without error', () => {
    const board = parseBoardMarkdown(src);
    expect(board.storyId).toBe('pre-v1-story-id');
    expect(board.lanes[0].cards).toHaveLength(1);
  });

  it('round-trip adds mythos-board-version: 1', () => {
    const board = parseBoardMarkdown(src);
    const out = serializeBoardMarkdown(board);
    expect(out).toContain('mythos-board-version: 1');
  });
});
