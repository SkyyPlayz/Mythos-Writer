import { useState, useEffect, useCallback } from 'react';
import './KanbanBoard.css';

export interface KanbanCard {
  notePath: string;
  checked: boolean;
}

export interface KanbanColumn {
  name: string;
  cards: KanbanCard[];
}

// ─── Obsidian-Kanban markdown parser ───

export function parseBoard(md: string): KanbanColumn[] {
  const columns: KanbanColumn[] = [];
  const body = md
    .replace(/^---[\s\S]*?---\n?/, '')
    .replace(/%%[\s\S]*?%%/g, '');

  let current: KanbanColumn | null = null;
  for (const line of body.split('\n')) {
    const headingMatch = line.match(/^##\s+(.+)/);
    if (headingMatch) {
      if (current) columns.push(current);
      current = { name: headingMatch[1].trim(), cards: [] };
      continue;
    }
    if (!current) continue;
    const cardMatch = line.match(/^- \[([ x])\] \[\[(.+?)\]\]/);
    if (cardMatch) {
      current.cards.push({ notePath: cardMatch[2], checked: cardMatch[1] === 'x' });
    }
  }
  if (current) columns.push(current);
  return columns;
}

export function serializeBoard(columns: KanbanColumn[]): string {
  const lines = ['---', 'kanban-plugin: basic', '---', ''];
  for (const col of columns) {
    lines.push(`## ${col.name}`, '');
    for (const card of col.cards) {
      lines.push(`- [${card.checked ? 'x' : ' '}] [[${card.notePath}]]`);
    }
    lines.push('');
  }
  lines.push('%% kanban:settings', '{"kanban-plugin":"basic"}', '%%', '');
  return lines.join('\n');
}

const DEFAULT_COLUMN_NAMES = ['Idea', 'Drafted', 'Written', 'Cut'];

interface Props {
  boardPath: string;
  storyTitle: string;
  onBoardPathChange?: (path: string) => void;
}

export default function KanbanBoard({ boardPath, storyTitle, onBoardPathChange }: Props) {
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragCard, setDragCard] = useState<{ colIdx: number; cardIdx: number } | null>(null);
  const [dragOverCol, setDragOverCol] = useState<number | null>(null);
  const [editingColIdx, setEditingColIdx] = useState<number | null>(null);
  const [editingColName, setEditingColName] = useState('');
  const [customBoardPath, setCustomBoardPath] = useState(boardPath);
  const [editingPath, setEditingPath] = useState(false);
  const [pendingPath, setPendingPath] = useState(boardPath);

  const saveBoard = useCallback(
    async (cols: KanbanColumn[], path = customBoardPath) => {
      const content = serializeBoard(cols);
      try {
        await (window as any).api.writeBoard(path, content);
      } catch (e) {
        console.error('Failed to save kanban board:', e);
      }
    },
    [customBoardPath],
  );

  useEffect(() => {
    setLoading(true);
    setCustomBoardPath(boardPath);
    setPendingPath(boardPath);
    (async () => {
      try {
        const result = await (window as any).api.readBoard(boardPath);
        if (result?.content) {
          const parsed = parseBoard(result.content);
          setColumns(
            parsed.length > 0
              ? parsed
              : DEFAULT_COLUMN_NAMES.map((n) => ({ name: n, cards: [] })),
          );
        } else {
          throw new Error('empty');
        }
      } catch {
        const defaults = DEFAULT_COLUMN_NAMES.map((n) => ({ name: n, cards: [] }));
        setColumns(defaults);
        saveBoard(defaults, boardPath);
      } finally {
        setLoading(false);
      }
    })();
  }, [boardPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDropOnColumn = useCallback(
    async (targetColIdx: number, e: React.DragEvent) => {
      e.preventDefault();
      setDragOverCol(null);
      const notePath = e.dataTransfer.getData('text/plain');

      if (dragCard) {
        const { colIdx: srcCol, cardIdx: srcCardIdx } = dragCard;
        if (srcCol === targetColIdx) {
          setDragCard(null);
          return;
        }
        const updated = columns.map((c) => ({ ...c, cards: [...c.cards] }));
        const [card] = updated[srcCol].cards.splice(srcCardIdx, 1);
        updated[targetColIdx].cards.push(card);
        setColumns(updated);
        await saveBoard(updated);
        setDragCard(null);
      } else if (notePath) {
        const updated = columns.map((c) => ({
          ...c,
          cards: c.cards.filter((card) => card.notePath !== notePath),
        }));
        updated[targetColIdx].cards.push({ notePath, checked: false });
        setColumns(updated);
        await saveBoard(updated);
      }
    },
    [columns, dragCard, saveBoard],
  );

  const addColumn = useCallback(async () => {
    const updated = [...columns, { name: 'New Column', cards: [] }];
    setColumns(updated);
    await saveBoard(updated);
    setEditingColIdx(updated.length - 1);
    setEditingColName('New Column');
  }, [columns, saveBoard]);

  const removeColumn = useCallback(
    async (colIdx: number) => {
      const updated = columns.filter((_, i) => i !== colIdx);
      setColumns(updated);
      await saveBoard(updated);
    },
    [columns, saveBoard],
  );

  const startRenameColumn = (colIdx: number) => {
    setEditingColIdx(colIdx);
    setEditingColName(columns[colIdx].name);
  };

  const commitRenameColumn = useCallback(async () => {
    if (editingColIdx === null) return;
    const trimmed = editingColName.trim();
    const updated = columns.map((c, i) =>
      i === editingColIdx ? { ...c, name: trimmed || c.name } : c,
    );
    setColumns(updated);
    await saveBoard(updated);
    setEditingColIdx(null);
  }, [columns, editingColIdx, editingColName, saveBoard]);

  const removeCard = useCallback(
    async (colIdx: number, cardIdx: number) => {
      const updated = columns.map((c, i) =>
        i === colIdx ? { ...c, cards: c.cards.filter((_, ci) => ci !== cardIdx) } : c,
      );
      setColumns(updated);
      await saveBoard(updated);
    },
    [columns, saveBoard],
  );

  const commitPathEdit = useCallback(() => {
    const trimmed = pendingPath.trim();
    if (!trimmed) return;
    setCustomBoardPath(trimmed);
    setEditingPath(false);
    onBoardPathChange?.(trimmed);
    saveBoard(columns, trimmed);
  }, [pendingPath, columns, saveBoard, onBoardPathChange]);

  if (loading) return <div className="kanban-loading" role="status">Loading board…</div>;

  return (
    <div className="kanban-board" data-testid="kanban-board">
      <div className="kanban-header">
        <h2 className="kanban-title">{storyTitle} — Scene Board</h2>
        <div className="kanban-path-row">
          {editingPath ? (
            <>
              <input
                className="kanban-path-input"
                value={pendingPath}
                onChange={(e) => setPendingPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitPathEdit();
                  if (e.key === 'Escape') setEditingPath(false);
                }}
                aria-label="Board file path"
                autoFocus
              />
              <button className="kanban-path-save-btn" onClick={commitPathEdit}>
                Save
              </button>
              <button className="kanban-path-cancel-btn" onClick={() => setEditingPath(false)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <span className="kanban-path-label" title={customBoardPath}>
                {customBoardPath}
              </span>
              <button
                className="kanban-path-edit-btn"
                onClick={() => setEditingPath(true)}
                aria-label="Edit board path"
              >
                Edit path
              </button>
            </>
          )}
        </div>
      </div>

      <div className="kanban-columns" role="list">
        {columns.map((col, colIdx) => (
          <div
            key={`${col.name}-${colIdx}`}
            className={`kanban-column${dragOverCol === colIdx ? ' drag-over' : ''}`}
            role="listitem"
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverCol(colIdx);
            }}
            onDragLeave={() => setDragOverCol(null)}
            onDrop={(e) => handleDropOnColumn(colIdx, e)}
            data-testid={`kanban-column-${col.name}`}
            aria-label={`Column: ${col.name}`}
          >
            <div className="kanban-column-header">
              {editingColIdx === colIdx ? (
                <input
                  className="kanban-col-name-input"
                  value={editingColName}
                  onChange={(e) => setEditingColName(e.target.value)}
                  onBlur={commitRenameColumn}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRenameColumn();
                    if (e.key === 'Escape') setEditingColIdx(null);
                  }}
                  aria-label="Column name"
                  autoFocus
                />
              ) : (
                <span
                  className="kanban-col-name"
                  onDoubleClick={() => startRenameColumn(colIdx)}
                  title="Double-click to rename"
                >
                  {col.name}
                </span>
              )}
              <span className="kanban-col-count">{col.cards.length}</span>
              <button
                className="kanban-col-remove-btn"
                onClick={() => removeColumn(colIdx)}
                title={`Remove column "${col.name}"`}
                aria-label={`Remove column ${col.name}`}
              >
                ×
              </button>
            </div>

            <div className="kanban-cards">
              {col.cards.map((card, cardIdx) => (
                <div
                  key={`${card.notePath}-${cardIdx}`}
                  className={`kanban-card${dragCard?.colIdx === colIdx && dragCard?.cardIdx === cardIdx ? ' dragging' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    setDragCard({ colIdx, cardIdx });
                    e.dataTransfer.setData('text/plain', card.notePath);
                  }}
                  onDragEnd={() => setDragCard(null)}
                  data-testid={`kanban-card-${card.notePath}`}
                  aria-label={`Card: ${card.notePath}`}
                >
                  <span className="kanban-card-link">[[{card.notePath}]]</span>
                  <button
                    className="kanban-card-remove"
                    onClick={() => removeCard(colIdx, cardIdx)}
                    aria-label={`Remove card ${card.notePath}`}
                    title="Remove card"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}

        <button
          className="kanban-add-col-btn"
          onClick={addColumn}
          aria-label="Add column"
        >
          + Add Column
        </button>
      </div>
    </div>
  );
}
