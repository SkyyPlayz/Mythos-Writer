import { List } from 'react-window';
import { useRef } from 'react';
import type { CSSProperties } from 'react';
import type { FlatRow } from './treeUtils';
import { NodeIcon } from '../../NodeIcon';

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
  iconMap?: Record<string, string>;
}

interface RowProps extends RowData {
  ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' };
  index: number;
  style: CSSProperties;
}

function RenameInput({ value, error, onChange, onCommit, onCancel }: { value: string; error?: string | null; onChange: (v: string) => void; onCommit: () => void; onCancel: () => void; }) {
  const cancelledRef = useRef(false);
  return (
    <span className="vb-rename-wrap">
      <input className="vb-rename-input" autoFocus value={value} aria-label="Rename" onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); cancelledRef.current = false; onCommit(); } if (e.key === 'Escape') { e.preventDefault(); cancelledRef.current = true; onCancel(); } }} onBlur={() => { if (!cancelledRef.current) onCommit(); }} />
      {error && <span className="vb-rename-error" role="alert">{error}</span>}
    </span>
  );
}

function Row({ index, style, ariaAttributes, rows, onToggle, onOpen, onContextMenu, editingPath, editingValue, editError, onStartRename, onRenameChange, onRenameCommit, onRenameCancel, iconMap }: RowProps) {
  const row = rows[index];
  if (!row) return null;
  const { node, depth, isExpanded, isSelected } = row;
  const isMd = !node.isDirectory && node.name.endsWith('.md');
  const indent = 8 + depth * 14;
  const isInteractive = node.isDirectory || isMd;
  const isEditing = editingPath === node.path;
  function handleClick() { if (node.isDirectory) onToggle(node.path); else if (isMd) onOpen(node.path); }
  function handleDoubleClick(e: React.MouseEvent) { if (isMd && onStartRename) { e.preventDefault(); e.stopPropagation(); onStartRename(row); } }
  return (
    <div
      style={{ ...style, paddingLeft: indent, display: 'flex', alignItems: 'center', boxSizing: 'border-box', gap: 4, paddingRight: 8 }}
      className={`vb-row${isSelected ? ' vb-selected' : ''}${node.isDirectory ? ' vb-dir' : ' vb-file'}${isMd ? ' vb-md' : ''}`}
      data-testid={`vb-row-${node.path}`}
      onClick={isEditing ? undefined : handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, row); }}
      tabIndex={isInteractive ? 0 : undefined}
      onKeyDown={(e) => { if (isEditing) return; if (e.key === 'Enter') { e.preventDefault(); handleClick(); } if (e.key === 'ArrowRight' && node.isDirectory && !isExpanded) { e.preventDefault(); onToggle(node.path); } if (e.key === 'ArrowLeft' && node.isDirectory && isExpanded) { e.preventDefault(); onToggle(node.path); } }}
      title={isEditing ? undefined : node.path}
      {...ariaAttributes}
      role={isInteractive ? 'button' : ariaAttributes.role}
    >
      <span className="vb-chevron" aria-hidden="true">{node.isDirectory ? (isExpanded ? '▾' : '▸') : ''}</span>
      <span className="vb-icon" aria-hidden="true">
        <NodeIcon icon={!node.isDirectory ? iconMap?.[node.path] : undefined} fallback={node.isDirectory ? (isExpanded ? '📂' : '📁') : isMd ? '📄' : '·'} />
      </span>
      {isEditing && onRenameChange && onRenameCommit && onRenameCancel ? (
        <RenameInput value={editingValue ?? ''} error={editError} onChange={onRenameChange} onCommit={onRenameCommit} onCancel={onRenameCancel} />
      ) : (
        <span className="vb-name">{isMd ? node.name.slice(0, -3) : node.name}</span>
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
  iconMap?: Record<string, string>;
}

export default function VirtualTree({ rows, onToggle, onOpen, onContextMenu, 'data-testid': testId, editingPath, editingValue, editError, onStartRename, onRenameChange, onRenameCommit, onRenameCancel, iconMap }: VirtualTreeProps) {
  if (rows.length === 0) return null;
  return (
    <div data-testid={testId} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <List<RowData> rowComponent={Row} rowCount={rows.length} rowHeight={ITEM_HEIGHT} rowProps={{ rows, onToggle, onOpen, onContextMenu, editingPath, editingValue, editError, onStartRename, onRenameChange, onRenameCommit, onRenameCancel, iconMap }} style={{ overflowX: 'hidden' }} />
    </div>
  );
}
