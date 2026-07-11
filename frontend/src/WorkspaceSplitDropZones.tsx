// Beta 4 M4 (§4; prototype 3686–3700 drop-zone overlays + tabDown zoneOf 5358):
// while a workspace tab is being dragged, the lower 45% (DOWN) and right 44%
// (RIGHT) of the workspace become drop zones. Hovering one shows the accent
// highlight + a doc chip; dropping opens the document as a split pane.
// Mounted by DesktopShell only while a tab drag is in flight.
import { useState } from 'react';
import { WORKSPACE_TAB_DRAG_MIME } from './WorkspaceTabBar';
import './WorkspaceSplitDropZones.css';

export type SplitDropZone = 'right' | 'down';

export interface WorkspaceSplitDropZonesProps {
  /** Label for the doc chip shown inside the hovered zone (the dragged tab's title). */
  dragLabel: string;
  onDropZone: (zone: SplitDropZone) => void;
}

export default function WorkspaceSplitDropZones({ dragLabel, onDropZone }: WorkspaceSplitDropZonesProps) {
  const [hoverZone, setHoverZone] = useState<SplitDropZone | null>(null);

  const zoneHandlers = (zone: SplitDropZone) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer?.types.includes(WORKSPACE_TAB_DRAG_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setHoverZone(zone);
    },
    onDragLeave: () => setHoverZone((cur) => (cur === zone ? null : cur)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setHoverZone(null);
      onDropZone(zone);
    },
  });

  const chip = (
    <div className="wsdz-chip">
      {/* Prototype 3689: 12px file glyph + doc label */}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#aebad0" strokeWidth="1.8" aria-hidden="true">
        <path d="M7 3.5h7l4 4v13H7z" />
        <path d="M14 3.5v4h4" />
      </svg>
      {dragLabel}
    </div>
  );

  return (
    <>
      {/* RIGHT = right 44% (below the tab strip so strip reorders keep working) */}
      <div
        className={`wsdz-zone wsdz-zone--right${hoverZone === 'right' ? ' wsdz-zone--active' : ''}`}
        data-testid="workspace-split-dropzone-right"
        {...zoneHandlers('right')}
      >
        {hoverZone === 'right' && chip}
      </div>
      {/* DOWN = lower 45%, stacked above RIGHT so it wins the overlap
          (prototype zoneOf checks `down` first). */}
      <div
        className={`wsdz-zone wsdz-zone--down${hoverZone === 'down' ? ' wsdz-zone--active' : ''}`}
        data-testid="workspace-split-dropzone-down"
        {...zoneHandlers('down')}
      >
        {hoverZone === 'down' && chip}
      </div>
    </>
  );
}
