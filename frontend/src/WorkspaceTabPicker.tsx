import { useId } from 'react';
import Dialog, { DialogHeader, DialogBody } from './components/ui/Dialog';
import { PICKABLE_TAB_KINDS, TAB_KIND_META } from './workspaceTabKinds';
import './WorkspaceTabPicker.css';

// GH #643: content picker for the WorkspaceTabBar "+" button. Picking a kind
// opens (or focuses) that workspace tab.

export interface WorkspaceTabPickerProps {
  open: boolean;
  onClose: () => void;
  onPick: (kind: WorkspaceTabKind) => void;
}

export default function WorkspaceTabPicker({ open, onClose, onPick }: WorkspaceTabPickerProps) {
  const titleId = useId();

  return (
    <Dialog open={open} onClose={onClose} aria-labelledby={titleId}>
      <DialogHeader onClose={onClose}>
        <h2 id={titleId} className="wtp-title">New tab</h2>
      </DialogHeader>

      <DialogBody className="wtp-body">
        <ul className="wtp-list" aria-label="Tab types">
          {PICKABLE_TAB_KINDS.map((kind, index) => {
            const meta = TAB_KIND_META[kind];
            return (
              <li key={kind}>
                <button
                  type="button"
                  className="wtp-item"
                  data-testid={`wtp-item-${kind}`}
                  autoFocus={index === 0}
                  onClick={() => {
                    onPick(kind);
                    onClose();
                  }}
                >
                  <span className="wtp-item-icon" aria-hidden="true">{meta.icon}</span>
                  <span className="wtp-item-label">{meta.title}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </DialogBody>
    </Dialog>
  );
}
