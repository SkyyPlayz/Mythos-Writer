import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import KanbanBoard, { parseBoard, serializeBoard } from './KanbanBoard';

// ─── parseBoard / serializeBoard unit tests ───

describe('parseBoard', () => {
  it('parses Obsidian Kanban markdown into columns and cards', () => {
    const md = [
      '---',
      'kanban-plugin: basic',
      '---',
      '',
      '## Idea',
      '',
      '- [ ] [[Notes/Scene One]]',
      '- [x] [[Notes/Done Scene]]',
      '',
      '## Drafted',
      '',
      '- [ ] [[Notes/Scene Two]]',
      '',
    ].join('\n');

    const cols = parseBoard(md);
    expect(cols).toHaveLength(2);
    expect(cols[0].name).toBe('Idea');
    expect(cols[0].cards).toHaveLength(2);
    expect(cols[0].cards[0]).toEqual({ notePath: 'Notes/Scene One', checked: false });
    expect(cols[0].cards[1]).toEqual({ notePath: 'Notes/Done Scene', checked: true });
    expect(cols[1].name).toBe('Drafted');
    expect(cols[1].cards[0]).toEqual({ notePath: 'Notes/Scene Two', checked: false });
  });

  it('returns empty array for empty markdown', () => {
    expect(parseBoard('')).toEqual([]);
  });

  it('strips the kanban:settings block', () => {
    const md = [
      '---',
      'kanban-plugin: basic',
      '---',
      '',
      '## Cut',
      '',
      '%% kanban:settings',
      '{"kanban-plugin":"basic"}',
      '%%',
      '',
    ].join('\n');
    const cols = parseBoard(md);
    expect(cols).toHaveLength(1);
    expect(cols[0].cards).toHaveLength(0);
  });
});

describe('serializeBoard', () => {
  it('round-trips through parseBoard', () => {
    const columns = [
      { name: 'Idea', cards: [{ notePath: 'Notes/A', checked: false }] },
      { name: 'Written', cards: [{ notePath: 'Notes/B', checked: true }] },
    ];
    const md = serializeBoard(columns);
    const parsed = parseBoard(md);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe('Idea');
    expect(parsed[0].cards[0].notePath).toBe('Notes/A');
    expect(parsed[1].cards[0].checked).toBe(true);
  });
});

// ─── Component tests ───

const BOARD_MD = [
  '---',
  'kanban-plugin: basic',
  '---',
  '',
  '## Idea',
  '',
  '- [ ] [[Notes/Scene Alpha]]',
  '',
  '## Drafted',
  '',
  '- [ ] [[Notes/Scene Beta]]',
  '',
  '## Written',
  '',
  '## Cut',
  '',
].join('\n');

function makeApi(overrides: Record<string, unknown> = {}) {
  return {
    readBoard: vi.fn().mockResolvedValue({ content: BOARD_MD }),
    writeBoard: vi.fn().mockResolvedValue({ path: 'kanban.md', bytes: 100 }),
    ...overrides,
  };
}

beforeEach(() => {
  (window as unknown as { api: unknown }).api = makeApi();
});

async function renderBoard(props?: Partial<React.ComponentProps<typeof KanbanBoard>>) {
  const result = render(
    <KanbanBoard
      boardPath="Stories/MyStory/kanban.md"
      storyTitle="My Story"
      {...props}
    />,
  );
  // wait for async load
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  return result;
}

describe('KanbanBoard — rendering', () => {
  it('renders all four default columns from the fixture board', async () => {
    await renderBoard();
    expect(screen.getByTestId('kanban-column-Idea')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-column-Drafted')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-column-Written')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-column-Cut')).toBeInTheDocument();
  });

  it('renders cards inside the correct column', async () => {
    await renderBoard();
    expect(screen.getByTestId('kanban-card-Notes/Scene Alpha')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-card-Notes/Scene Beta')).toBeInTheDocument();
  });

  it('shows the story title and board path', async () => {
    await renderBoard();
    expect(screen.getByText('My Story — Scene Board')).toBeInTheDocument();
    expect(screen.getByText('Stories/MyStory/kanban.md')).toBeInTheDocument();
  });

  it('creates default columns when the board file does not exist', async () => {
    ((window as any).api).readBoard = vi.fn().mockRejectedValue(new Error('not found'));
    await renderBoard();
    expect(screen.getByTestId('kanban-column-Idea')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-column-Drafted')).toBeInTheDocument();
    expect(((window as any).api).writeBoard).toHaveBeenCalled();
  });
});

describe('KanbanBoard — card drag-to-column (board persistence)', () => {
  it('moves a card between columns when dropped and persists the new board', async () => {
    await renderBoard();

    const card = screen.getByTestId('kanban-card-Notes/Scene Alpha');
    const targetCol = screen.getByTestId('kanban-column-Drafted');

    fireEvent.dragStart(card, { dataTransfer: { setData: vi.fn(), getData: () => '' } });
    fireEvent.dragOver(targetCol);
    fireEvent.drop(targetCol, { dataTransfer: { getData: () => '' } });

    await waitFor(() => {
      expect(((window as any).api).writeBoard).toHaveBeenCalled();
    });

    const savedContent: string = ((window as any).api).writeBoard.mock.calls.at(-1)[1];
    expect(savedContent).toContain('## Drafted');
    expect(savedContent).toContain('[[Notes/Scene Alpha]]');
    // no longer in Idea column
    const ideaSection = savedContent.split('## Drafted')[0];
    expect(ideaSection).not.toContain('Notes/Scene Alpha');
  });

  it('drops an external vault note onto a column', async () => {
    await renderBoard();

    const targetCol = screen.getByTestId('kanban-column-Written');
    fireEvent.dragOver(targetCol);
    fireEvent.drop(targetCol, {
      dataTransfer: { getData: () => 'Notes/New Scene' },
    });

    await waitFor(() => {
      expect(((window as any).api).writeBoard).toHaveBeenCalled();
    });

    const savedContent: string = ((window as any).api).writeBoard.mock.calls.at(-1)[1];
    expect(savedContent).toContain('[[Notes/New Scene]]');
  });
});

describe('KanbanBoard — column CRUD', () => {
  it('adds a new column and persists the board', async () => {
    await renderBoard();

    fireEvent.click(screen.getByRole('button', { name: /add column/i }));

    await waitFor(() => {
      expect(((window as any).api).writeBoard).toHaveBeenCalled();
    });

    const savedContent: string = ((window as any).api).writeBoard.mock.calls.at(-1)[1];
    expect(savedContent).toContain('## New Column');
  });

  it('removes a column and persists the board', async () => {
    await renderBoard();

    const removeBtn = screen.getByRole('button', { name: /remove column Idea/i });
    fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(((window as any).api).writeBoard).toHaveBeenCalled();
    });

    expect(screen.queryByTestId('kanban-column-Idea')).not.toBeInTheDocument();

    const savedContent: string = ((window as any).api).writeBoard.mock.calls.at(-1)[1];
    expect(savedContent).not.toContain('## Idea');
  });

  it('renames a column on double-click and persists the board', async () => {
    await renderBoard();

    const colName = screen.getByText('Idea');
    fireEvent.doubleClick(colName);

    const input = screen.getByRole('textbox', { name: /column name/i });
    fireEvent.change(input, { target: { value: 'Brainstorm' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('Brainstorm')).toBeInTheDocument();
    });

    const savedContent: string = ((window as any).api).writeBoard.mock.calls.at(-1)[1];
    expect(savedContent).toContain('## Brainstorm');
    expect(savedContent).not.toContain('## Idea');
  });

  it('removes a card from its column and persists the board', async () => {
    await renderBoard();

    const removeCardBtn = screen.getByRole('button', { name: /remove card Notes\/Scene Alpha/i });
    fireEvent.click(removeCardBtn);

    await waitFor(() => {
      expect(((window as any).api).writeBoard).toHaveBeenCalled();
    });

    expect(screen.queryByTestId('kanban-card-Notes/Scene Alpha')).not.toBeInTheDocument();

    const savedContent: string = ((window as any).api).writeBoard.mock.calls.at(-1)[1];
    expect(savedContent).not.toContain('Notes/Scene Alpha');
  });
});

describe('KanbanBoard — board path configuration', () => {
  it('allows editing the board path', async () => {
    const onBoardPathChange = vi.fn();
    await renderBoard({ onBoardPathChange });

    fireEvent.click(screen.getByRole('button', { name: /edit board path/i }));
    const input = screen.getByRole('textbox', { name: /board file path/i });

    fireEvent.change(input, { target: { value: 'Stories/MyStory/custom-board.md' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(onBoardPathChange).toHaveBeenCalledWith('Stories/MyStory/custom-board.md');
    });
  });
});
