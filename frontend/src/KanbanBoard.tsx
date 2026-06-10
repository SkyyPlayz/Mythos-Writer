import { useState, useEffect, useCallback } from 'react';
import {
  parseEntryFrontmatter,
  buildSceneCrafterPayload,
  type EntrySourcePayload,
} from './EntriesPanel';
import './KanbanBoard.css';

export { buildSceneCrafterPayload, type EntrySourcePayload };

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

interface EntryPoolItem {
  path: string;
  title: string;
}

function titleFromEntryPath(filePath: string): string {
  const name = filePath.split('/').pop() ?? filePath;
  const withoutExt = name.replace(/\.md$/, '');
  // Strip leading timestamp prefix like "20240601-123456-" if present
  const withoutTs = withoutExt.replace(/^\d{8}-\d{6}-/, '');
  return withoutTs
    .replace(/-+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || withoutExt;
}

// ─── Entry source picker ───

interface EntryItem {
  id: string;
  body: string;
  tags: string[];
}

interface EntrySourcePickerProps {
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
}

function EntrySourcePicker({ selectedIds, onSelectionChange }: EntrySourcePickerProps) {
  const [entries, setEntries] = useState<EntryItem[]>([]);
  const [tagFilter, setTagFilter] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void (async () => {
      try {
        const listResult = await window.api.listNotesVault('Entries');
        const mdFiles = listResult.items.filter(
          (item) => !item.isDirectory && item.name.endsWith('.md'),
        );
        const items: EntryItem[] = [];
        await Promise.all(
          mdFiles.map(async (item) => {
            try {
              const readResult = await window.api.readNotesVault(item.path);
              const parsed = parseEntryFrontmatter(readResult.content);
              if (!parsed) return;
              items.push({ id: item.path, body: parsed.body, tags: parsed.tags });
            } catch {
              // skip unreadable files
            }
          }),
        );
        items.sort((a, b) => a.id.localeCompare(b.id));
        setEntries(items);
      } catch {
        setEntries([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  const filteredEntries = tagFilter.trim()
    ? entries.filter((e) =>
        e.tags.some((t) => t.toLowerCase().includes(tagFilter.toLowerCase())),
      )
    : entries;

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter((s) => s !== id));
    } else {
      onSelectionChange([...selectedIds, id]);
    }
  };

  const payload = buildSceneCrafterPayload(
    entries.filter((e) => selectedIds.includes(e.id)),
  );

  return (
    <div className="kanban-entry-picker" data-testid="kanban-entry-picker">
      <button
        className="kanban-entry-picker-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Toggle Entry Sources picker"
        data-testid="kanban-entry-picker-toggle"
      >
        Entry Sources{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
      </button>
      {open && (
        <div className="kanban-entry-picker-panel" data-testid="kanban-entry-picker-panel">
          <input
            className="kanban-entry-tag-filter"
            placeholder="Filter by tag…"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            aria-label="Filter entries by tag"
            data-testid="kanban-entry-tag-filter"
          />
          {loading && <div className="kanban-entry-loading">Loading entries…</div>}
          {!loading && filteredEntries.length === 0 && (
            <div className="kanban-entry-empty">No entries found.</div>
          )}
          <ul className="kanban-entry-list" role="listbox" aria-multiselectable="true">
            {filteredEntries.map((e) => {
              const checked = selectedIds.includes(e.id);
              return (
                <li
                  key={e.id}
                  role="option"
                  aria-selected={checked}
                  className={`kanban-entry-option${checked ? ' selected' : ''}`}
                  onClick={() => toggle(e.id)}
                  data-testid={`kanban-entry-option-${e.id}`}
                >
                  <span className="kanban-entry-option-check">{checked ? '✓' : '○'}</span>
                  <span className="kanban-entry-option-body">
                    {e.body.slice(0, 80)}{e.body.length > 80 ? '…' : ''}
                  </span>
                  {e.tags.length > 0 && (
                    <span className="kanban-entry-option-tags">
                      {e.tags.join(', ')}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {selectedIds.length > 0 && (
            <div className="kanban-entry-payload-hint" data-testid="kanban-entry-payload">
              {payload.length} entr{payload.length === 1 ? 'y' : 'ies'} selected as scene context
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface Props {
  boardPath: string;
  storyTitle: string;
  onBoardPathChange?: (path: string) => void;
  /** Called when the user clicks a card link to navigate to the note/scene. */
  onOpenNote?: (notePath: string) => void;
  /** Scenes available in the current story, used for adding cards from the scene list. */
  scenes?: Array<{ id: string; title: string; path: string }>;
}

export default function KanbanBoard({ boardPath, storyTitle, onBoardPathChange, onOpenNote }: Props) {
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [dragCard, setDragCard] = useState<{ colIdx: number; cardIdx: number } | null>(null);
  const [dragOverCol, setDragOverCol] = useState<number | null>(null);
  const [editingColIdx, setEditingColIdx] = useState<number | null>(null);
  const [editingColName, setEditingColName] = useState('');
  const [customBoardPath, setCustomBoardPath] = useState(boardPath);
  const [editingPath, setEditingPath] = useState(false);
  const [pendingPath, setPendingPath] = useState(boardPath);

  // SKY-324: Entries quick-grab pool — files from Entries/ in the Notes Vault
  const [entriesPool, setEntriesPool] = useState<EntryPoolItem[]>([]);
  const [entriesPoolOpen, setEntriesPoolOpen] = useState(false);
  const [entriesPoolLoading, setEntriesPoolLoading] = useState(false);

  const saveBoard = useCallback(
    async (cols: KanbanColumn[], path = customBoardPath) => {
      const content = serializeBoard(cols);
      try {
        await (window as any).api.writeVault(path, content);
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
        const result = await (window as any).api.readVault(boardPath);
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

  // SKY-324: Load entries from Notes Vault Entries/ folder when pool is opened
  const loadEntriesPool = useCallback(async () => {
    setEntriesPoolLoading(true);
    try {
      const { items } = await (window as any).api.listNotesVault('Entries');
      const entries: EntryPoolItem[] = items
        .filter((item: { isDirectory: boolean; path: string }) => !item.isDirectory && item.path.endsWith('.md'))
        .map((item: { path: string }) => ({
          path: item.path,
          title: titleFromEntryPath(item.path),
        }))
        .sort((a: EntryPoolItem, b: EntryPoolItem) => b.path.localeCompare(a.path));
      setEntriesPool(entries);
    } catch {
      setEntriesPool([]);
    } finally {
      setEntriesPoolLoading(false);
    }
  }, []);

  const toggleEntriesPool = useCallback(() => {
    setEntriesPoolOpen((prev) => {
      const next = !prev;
      if (next) void loadEntriesPool();
      return next;
    });
  }, [loadEntriesPool]);

  // SKY-324: Add an entry from the pool to the first "Idea" lane (or first lane)
  const addEntryToIdeaLane = useCallback(
    async (entryPath: string) => {
      const ideaIdx = columns.findIndex((c) => c.name.toLowerCase() === 'idea');
      const targetIdx = ideaIdx >= 0 ? ideaIdx : 0;
      if (columns.length === 0) return;
      const alreadyInBoard = columns.some((c) => c.cards.some((card) => card.notePath === entryPath));
      if (alreadyInBoard) return;
      const updated = columns.map((c, i) =>
        i === targetIdx ? { ...c, cards: [...c.cards, { notePath: entryPath, checked: false }] } : c,
      );
      setColumns(updated);
      await saveBoard(updated);
    },
    [columns, saveBoard],
  );

  if (loading) return <div className="kanban-loading" role="status">Loading board…</div>;

  return (
    <div className="kanban-board" data-testid="kanban-board">
      <div className="kanban-header">
        <h2 className="kanban-title">{storyTitle} — Scene Board</h2>
        <EntrySourcePicker
          selectedIds={selectedEntryIds}
          onSelectionChange={setSelectedEntryIds}
        />
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
                  <span
                    className="kanban-card-link"
                    onClick={() => onOpenNote?.(card.notePath)}
                    role={onOpenNote ? 'button' : undefined}
                    tabIndex={onOpenNote ? 0 : undefined}
                    onKeyDown={onOpenNote ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenNote(card.notePath); } } : undefined}
                  >[[{card.notePath}]]</span>
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

      {/* SKY-324: Entries quick-grab pool */}
      <div className="kanban-entries-pool">
        <button
          className="kanban-entries-pool-toggle"
          onClick={toggleEntriesPool}
          aria-expanded={entriesPoolOpen}
          type="button"
        >
          <span className="kanban-entries-pool-arrow">{entriesPoolOpen ? '▾' : '▸'}</span>
          Entries Pool
        </button>
        {entriesPoolOpen && (
          <div className="kanban-entries-pool-body" data-testid="kanban-entries-pool-body">
            {entriesPoolLoading && (
              <div className="kanban-entries-pool-empty" role="status">Loading…</div>
            )}
            {!entriesPoolLoading && entriesPool.length === 0 && (
              <div className="kanban-entries-pool-empty">
                No entries yet. Add quick notes in the Brainstorm panel.
              </div>
            )}
            {!entriesPoolLoading && entriesPool.map((entry) => (
              <div
                key={entry.path}
                className="kanban-entry-item"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', entry.path);
                }}
                data-testid={`kanban-entry-item-${entry.path}`}
              >
                <span className="kanban-entry-title" title={entry.path}>
                  {entry.title}
                </span>
                <button
                  className="kanban-entry-add-btn"
                  onClick={() => void addEntryToIdeaLane(entry.path)}
                  type="button"
                  title="Add to Idea lane"
                  aria-label={`Add "${entry.title}" to Idea lane`}
                >
                  + Idea
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
