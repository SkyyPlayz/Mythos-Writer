import type { GettingStartedItemId, GettingStartedProgress } from '../../gettingStartedReducer';
import { CHECKLIST_ITEM_IDS } from '../../gettingStartedReducer';
import './GettingStartedPanel.css';

interface GettingStartedPanelProps {
  progress: GettingStartedProgress;
  onAction: (itemId: GettingStartedItemId) => void;
  onDismiss: () => void;
  onToggleCollapse: () => void;
}

const ITEM_META: Record<GettingStartedItemId, { label: string; description: string }> = {
  'write-scene': {
    label: 'Write your first scene',
    description: 'Jump back to the editor and put words on the page.',
  },
  'add-character': {
    label: 'Add a character',
    description: 'Open the character workspace for your cast.',
  },
  brainstorm: {
    label: 'Try Brainstorm',
    description: 'Use AI to explore a plot turn, scene, or world detail.',
  },
  'notes-vault': {
    label: 'Explore your Notes Vault',
    description: 'Open your notes area for worldbuilding and references.',
  },
};

export default function GettingStartedPanel({ progress, onAction, onDismiss, onToggleCollapse }: GettingStartedPanelProps) {
  const completed = progress.completedItems.length;
  const total = CHECKLIST_ITEM_IDS.length;
  const percent = Math.round((completed / total) * 100);
  const collapsed = progress.collapsed ?? false;

  return (
    <section className={`gs-panel${collapsed ? ' gs-panel--collapsed' : ''}`} aria-labelledby="getting-started-title">
      <div className="gs-header">
        <button
          type="button"
          className="gs-collapse-toggle"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          aria-controls="gs-body"
          aria-label={collapsed ? 'Expand Getting Started' : 'Collapse Getting Started'}
        >
          <span className="gs-collapse-chevron" aria-hidden="true">{collapsed ? '›' : '‹'}</span>
        </button>
        <h2 id="getting-started-title" className="gs-title">Getting Started</h2>
        {!collapsed && (
          <span className="gs-progress-label" aria-live="polite">{completed} of {total} complete</span>
        )}
        <button type="button" className="gs-dismiss" onClick={onDismiss} aria-label="Dismiss Getting Started">
          ×
        </button>
      </div>
      {!collapsed && (
        <div id="gs-body">
          <div className="gs-progress-track" aria-hidden="true">
            <div className="gs-progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <ul className="gs-list">
            {CHECKLIST_ITEM_IDS.map((itemId) => {
              const done = progress.completedItems.includes(itemId);
              const meta = ITEM_META[itemId];
              return (
                <li key={itemId}>
                  <button
                    type="button"
                    className={`gs-item${done ? ' gs-item--done' : ''}`}
                    onClick={() => onAction(itemId)}
                    role="checkbox"
                    aria-checked={done}
                  >
                    <span className="gs-check" aria-hidden="true" />
                    <span className="gs-copy">
                      <span className="gs-label">{meta.label}</span>
                      <span className="gs-description">{meta.description}</span>
                    </span>
                    {!done && <span className="gs-arrow" aria-hidden="true">›</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
