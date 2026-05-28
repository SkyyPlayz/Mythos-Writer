import { List } from 'react-window';
import type { CSSProperties } from 'react';
import type { FlatRow } from './treeUtils';

const ITEM_HEIGHT = 26;

interface RowData {
  rows: FlatRow[];
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, row: FlatRow) => void;
}

interface RowProps extends RowData {
  ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' };
  index: number;
  style: CSSProperties;
}

function Row({ index, style, ariaAttributes, rows, onToggle, onOpen, onContextMenu }: RowProps) {
  const row = rows[index];
  if (!row) return null;

  const { node, depth, isExpanded, isSelected } = row;
  const isMd = !node.isDirectory && node.name.endsWith('.md');
  const indent = 8 + depth * 14;
  const isInteractive = node.isDirectory || isMd;

  function handleClick() {
    if (node.isDirectory) onToggle(node.path);
    else if (isMd) onOpen(node.path);
  }

  return (
    <div
      style={{ ...style, paddingLeft: indent, display: 'flex', alignItems: 'center', boxSizing: 'border-box', gap: 4, paddingRight: 8 }}
      className={`vb-row${isSelected ? ' vb-selected' : ''}${node.isDirectory ? ' vb-dir' : ' vb-file'}${isMd ? ' vb-md' : ''}`}
      data-testid={`vb-row-${node.path}`}
      onClick={handleClick}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, row); }}
      tabIndex={isInteractive ? 0 : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); handleClick(); }
        if (e.key === 'ArrowRight' && node.isDirectory && !isExpanded) { e.preventDefault(); onToggle(node.path); }
        if (e.key === 'ArrowLeft' && node.isDirectory && isExpanded) { e.preventDefault(); onToggle(node.path); }
      }}
      title={node.path}
      {...ariaAttributes}
      role={isInteractive ? 'button' : ariaAttributes.role}
    >
      <span className="vb-chevron" aria-hidden="true">
        {node.isDirectory ? (isExpanded ? '▾' : '▸') : ''}
      </span>
      <span className="vb-icon" aria-hidden="true">
        {node.isDirectory ? (isExpanded ? '📂' : '📁') : isMd ? '📄' : '·'}
      </span>
      <span className="vb-name">
        {isMd ? node.name.slice(0, -3) : node.name}
      </span>
    </div>
  );
}

interface VirtualTreeProps {
  rows: FlatRow[];
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, row: FlatRow) => void;
  'data-testid'?: string;
}

export default function VirtualTree({
  rows,
  onToggle,
  onOpen,
  onContextMenu,
  'data-testid': testId,
}: VirtualTreeProps) {
  if (rows.length === 0) return null;

  return (
    <div
      data-testid={testId}
      style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
    >
      <List<RowData>
        rowComponent={Row}
        rowCount={rows.length}
        rowHeight={ITEM_HEIGHT}
        rowProps={{ rows, onToggle, onOpen, onContextMenu }}
        style={{ overflowX: 'hidden' }}
      />
    </div>
  );
}
