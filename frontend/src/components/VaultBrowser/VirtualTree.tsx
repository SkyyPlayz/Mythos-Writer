import { List } from 'react-window';
import { useRef, useState, useCallback, useEffect } from 'react';
import type { CSSProperties } from 'react';
import type { ListImperativeAPI } from 'react-window';
import type { FlatRow } from './treeUtils';

const ITEM_HEIGHT = 26;

interface RowData {
  rows: FlatRow[];
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, row: FlatRow) => void;
  editingPath?: string | null;
  editingValue?: string;
  editError?: string | null;
  onStartRename?: (row: FlatRow) => void;
  onRenameChange?: (val: string) => void;
  onRenameCommit?: () => void;
  onRenameCancel?: () => void;
  focusedIdx: number;
  onMoveFocus: (newIdx: number) => void;
}

interface RowProps extends RowData {
  ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' };
  index: number;
  style: CSSProperties;
}

function RenameInput({
  value,
  error,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string;
  error?: string | null;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const cancelledRef = useRef(false);
  return (
    <span className="vb-rename-wrap">
      <input
        className="vb-rename-input"
        autoFocus
        value={value}
        aria-label="Rename"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); cancelledRef.current = false; onCommit(); }
          if (e.key === 'Escape') { e.preventDefault(); cancelledRef.current = true; onCancel(); }
        }}
        onBlur={() => { if (!cancelledRef.current) onCommit(); }}
      />
      {error && <span className="vb-rename-error" role="alert">{error}</span>}
    </span>
  );
}

function Row({
  index, style, rows, onToggle, onOpen, onContextMenu,
  editingPath, editingValue, editError, onStartRename, onRenameChange, onRenameCommit, onRenameCancel,
  focusedIdx, onMoveFocus,
  // ariaAttributes (aria-posinset/aria-setsize/role="listitem") is intentionally unused;
  // we emit role="treeitem" + aria-level instead.
}: RowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const row = rows[index];
  const isFocused = index === focusedIdx;

  useEffect(() => {
    if (isFocused && row && rowRef.current && document.activeElement !== rowRef.current) {
      rowRef.current.focus({ preventScroll: true });
    }
  // row changes when expand/collapse changes the visible set; refocus if still the focused slot
  }, [isFocused, row]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!row) return null;

  const { node, depth, isExpanded, isSelected } = row;
  const isMd = !node.isDirectory && node.name.endsWith('.md');
  const indent = 8 + depth * 14;
  const isInteractive = node.isDirectory || isMd;
  const isEditing = editingPath === node.path;

  function handleClick() {
    onMoveFocus(index);
    if (node.isDirectory) onToggle(node.path);
    else if (isMd) onOpen(node.path);
  }

  function handleDoubleClick(e: React.MouseEvent) {
    if (isMd && onStartRename) {
      e.preventDefault();
      e.stopPropagation();
      onStartRename(row);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (isEditing) return;
    const count = rows.length;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (index < count - 1) onMoveFocus(index + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (index > 0) onMoveFocus(index - 1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (node.isDirectory && !isExpanded) onToggle(node.path);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (node.isDirectory && isExpanded) onToggle(node.path);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        handleClick();
        break;
    }
  }

  return (
    <div
      ref={rowRef}
      style={{ ...style, paddingLeft: indent, display: 'flex', alignItems: 'center', boxSizing: 'border-box', gap: 4, paddingRight: 8 }}
      className={`vb-row${isSelected ? ' vb-selected' : ''}${node.isDirectory ? ' vb-dir' : ' vb-file'}${isMd ? ' vb-md' : ''}`}
      data-testid={`vb-row-${node.path}`}
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={node.isDirectory ? isExpanded : undefined}
      aria-selected={isSelected}
      tabIndex={isInteractive ? (isFocused ? 0 : -1) : undefined}
      onClick={isEditing ? undefined : handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, row); }}
      onKeyDown={handleKeyDown}
      onFocus={() => { if (index !== focusedIdx) onMoveFocus(index); }}
      title={isEditing ? undefined : node.path}
    >
      <span className="vb-chevron" aria-hidden="true">
        {node.isDirectory ? (isExpanded ? '▾' : '▸') : ''}
      </span>
      <span className="vb-icon" aria-hidden="true">
        {node.isDirectory ? (isExpanded ? '📂' : '📁') : isMd ? '📄' : '·'}
      </span>
      {isEditing && onRenameChange && onRenameCommit && onRenameCancel ? (
        <RenameInput
          value={editingValue ?? ''}
          error={editError}
          onChange={onRenameChange}
          onCommit={onRenameCommit}
          onCancel={onRenameCancel}
        />
      ) : (
        <span className="vb-name">
          {isMd ? node.name.slice(0, -3) : node.name}
        </span>
      )}
    </div>
  );
}

interface VirtualTreeProps {
  rows: FlatRow[];
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, row: FlatRow) => void;
  'data-testid'?: string;
  editingPath?: string | null;
  editingValue?: string;
  editError?: string | null;
  onStartRename?: (row: FlatRow) => void;
  onRenameChange?: (val: string) => void;
  onRenameCommit?: () => void;
  onRenameCancel?: () => void;
  label?: string;
}

export default function VirtualTree({
  rows,
  onToggle,
  onOpen,
  onContextMenu,
  'data-testid': testId,
  editingPath,
  editingValue,
  editError,
  onStartRename,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  label,
}: VirtualTreeProps) {
  const [focusedIdx, setFocusedIdx] = useState(0);
  const listRef = useRef<ListImperativeAPI | null>(null);

  const onMoveFocus = useCallback((newIdx: number) => {
    setFocusedIdx(newIdx);
    listRef.current?.scrollToRow({ index: newIdx, align: 'auto' });
  }, []);

  // Clamp focusedIdx when rows shrink (e.g. parent folder collapses)
  useEffect(() => {
    if (rows.length > 0 && focusedIdx >= rows.length) {
      setFocusedIdx(rows.length - 1);
    }
  }, [rows.length, focusedIdx]);

  if (rows.length === 0) return null;

  return (
    <div
      role="tree"
      aria-label={label}
      data-testid={testId}
      style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
    >
      <List<RowData>
        listRef={listRef as React.Ref<ListImperativeAPI>}
        rowComponent={Row}
        rowCount={rows.length}
        rowHeight={ITEM_HEIGHT}
        rowProps={{
          rows, onToggle, onOpen, onContextMenu,
          editingPath, editingValue, editError,
          onStartRename, onRenameChange, onRenameCommit, onRenameCancel,
          focusedIdx, onMoveFocus,
        }}
        style={{ overflowX: 'hidden' }}
      />
    </div>
  );
}
