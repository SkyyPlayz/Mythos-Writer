// Beta 3 / M18 — Scene Crafter board persistence tests (mocked notes-vault IPC).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasBoardData } from '../../canvas/canvasTypes';
import {
  BOARD_FILE_SUFFIX,
  boardFileName,
  boardFilePath,
  boardsDirForStory,
  loadCrafterBoards,
  saveCrafterBoard,
} from './crafterBoardStore';

function sampleBoard(): CanvasBoardData {
  return {
    id: 'b1',
    name: 'The Broken Gate — board 1',
    cards: [
      { id: 'b1-0', t: 'The Broken Gate — beats', d: 'Open on the door.', av: '✦', c: 1, x: 440, y: 40, w: 280, h: 120, nid: null },
      { id: 'b1-1', t: 'Mira', d: '', av: 'M', c: 0, x: 130, y: 80, w: 200, h: 86, nid: 'Characters/Mira' },
    ],
    links: [['b1-0', 'b1-1']],
  };
}

interface MockApi {
  writeNotesVault: ReturnType<typeof vi.fn>;
  readNotesVault: ReturnType<typeof vi.fn>;
  listNotesVault: ReturnType<typeof vi.fn>;
}

function installApi(overrides: Partial<MockApi> = {}): MockApi {
  const api: MockApi = {
    writeNotesVault: vi.fn().mockResolvedValue({ path: 'x', bytes: 1 }),
    readNotesVault: vi.fn().mockResolvedValue({ content: '{}', path: 'x' }),
    listNotesVault: vi.fn().mockResolvedValue({ items: [] }),
    ...overrides,
  };
  (window as unknown as { api: unknown }).api = api;
  return api;
}

beforeEach(() => {
  installApi();
});

describe('board file naming', () => {
  it('stores boards under Boards/<storySlug>/ with a .canvas.json suffix', () => {
    expect(boardsDirForStory('story-1')).toBe('Boards/story-1');
    expect(boardFilePath('story-1', 'The Broken Gate — board 1'))
      .toBe('Boards/story-1/The Broken Gate — board 1.canvas.json');
  });

  it('sanitizes filesystem-hostile characters out of the file name', () => {
    expect(boardFileName('a/b\\c:d*e?"f<g>h|i#j^k[l]')).toBe(`a-b-c-d-e- -f-g-h-i-j-k-l-${''}`.replace(/-$/, '-') + BOARD_FILE_SUFFIX.slice(0));
  });

  it('never produces an empty or dot-leading file name', () => {
    expect(boardFileName('   ')).toBe(`board${BOARD_FILE_SUFFIX}`);
    expect(boardFileName('...hidden')).toBe(`hidden${BOARD_FILE_SUFFIX}`);
  });
});

describe('saveCrafterBoard', () => {
  it('writes Obsidian-canvas JSON through the notes-vault write IPC', async () => {
    const api = installApi();
    const { path } = await saveCrafterBoard('story-1', sampleBoard());

    expect(path).toBe('Boards/story-1/The Broken Gate — board 1.canvas.json');
    expect(api.writeNotesVault).toHaveBeenCalledTimes(1);
    const [writtenPath, content] = api.writeNotesVault.mock.calls[0];
    expect(writtenPath).toBe(path);
    const json = JSON.parse(content as string);
    expect(json.nodes).toHaveLength(2);
    expect(json.nodes[0]).toMatchObject({ type: 'text', text: 'The Broken Gate — beats\n\nOpen on the door.' });
    expect(json.nodes[1]).toMatchObject({ type: 'file', file: 'Characters/Mira' });
    expect(json.edges).toEqual([{ id: 'edge-0', fromNode: 'b1-0', toNode: 'b1-1' }]);
  });

  it('throws when the write IPC reports an error', async () => {
    installApi({ writeNotesVault: vi.fn().mockResolvedValue({ error: 'disk full' }) });
    await expect(saveCrafterBoard('story-1', sampleBoard())).rejects.toThrow('disk full');
  });
});

describe('loadCrafterBoards', () => {
  it('round-trips a saved board through write → list → read', async () => {
    const written = new Map<string, string>();
    const api = installApi({
      writeNotesVault: vi.fn().mockImplementation((path: string, content: string) => {
        written.set(path, content);
        return Promise.resolve({ path, bytes: content.length });
      }),
    });

    const original = sampleBoard();
    const { path } = await saveCrafterBoard('story-1', original);

    api.listNotesVault.mockResolvedValue({
      items: [
        { path: 'Boards', name: 'Boards', isDirectory: true, modifiedAt: '' },
        { path: 'Boards/story-1', name: 'story-1', isDirectory: true, modifiedAt: '' },
        { path, name: path.split('/').pop(), isDirectory: false, modifiedAt: '' },
        { path: 'Boards/story-2/Other.canvas.json', name: 'Other.canvas.json', isDirectory: false, modifiedAt: '' },
        { path: 'Characters/Mira.md', name: 'Mira.md', isDirectory: false, modifiedAt: '' },
      ],
    });
    api.readNotesVault.mockImplementation((p: string) =>
      Promise.resolve(written.has(p) ? { content: written.get(p), path: p } : { error: 'not found' }));

    const boards = await loadCrafterBoards('story-1');

    expect(boards).toHaveLength(1);
    const loaded = boards[0];
    expect(loaded.name).toBe('The Broken Gate — board 1');
    expect(loaded.id).toBe(path);
    // Geometry, links, and note attachments survive the round-trip.
    expect(loaded.cards.map(({ t, x, y, w, h, nid }) => ({ t, x, y, w, h, nid }))).toEqual([
      { t: 'The Broken Gate — beats', x: 440, y: 40, w: 280, h: 120, nid: null },
      { t: 'Mira', x: 130, y: 80, w: 200, h: 86, nid: 'Characters/Mira' },
    ]);
    expect(loaded.links).toEqual([['b1-0', 'b1-1']]);
  });

  it('skips malformed board files instead of failing the whole load', async () => {
    const api = installApi();
    api.listNotesVault.mockResolvedValue({
      items: [
        { path: 'Boards/story-1/bad.canvas.json', name: 'bad.canvas.json', isDirectory: false, modifiedAt: '' },
        { path: 'Boards/story-1/good.canvas.json', name: 'good.canvas.json', isDirectory: false, modifiedAt: '' },
      ],
    });
    api.readNotesVault.mockImplementation((p: string) => Promise.resolve(
      p.endsWith('bad.canvas.json')
        ? { content: 'not json {', path: p }
        : { content: JSON.stringify({ nodes: [], edges: [] }), path: p },
    ));

    const boards = await loadCrafterBoards('story-1');
    expect(boards).toHaveLength(1);
    expect(boards[0].name).toBe('good');
  });

  it('returns an empty list when the vault listing errors', async () => {
    installApi({ listNotesVault: vi.fn().mockResolvedValue({ error: 'no vault' }) });
    await expect(loadCrafterBoards('story-1')).resolves.toEqual([]);
  });

  it('reuses a pre-fetched listing without calling the list IPC again', async () => {
    const api = installApi();
    await loadCrafterBoards('story-1', []);
    expect(api.listNotesVault).not.toHaveBeenCalled();
  });
});
