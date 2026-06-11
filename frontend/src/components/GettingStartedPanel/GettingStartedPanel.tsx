import type { GsItemKey, GsAction } from '../../gettingStartedReducer';
import { GS_ITEMS } from '../../gettingStartedReducer';
import './GettingStartedPanel.css';

interface Props {
  completedItems: GsItemKey[];
  onAction: (action: GsAction) => void;
}

export default function GettingStartedPanel({ completedItems, onAction }: Props) {
  const count = completedItems.length;
  const total = GS_ITEMS.length;
  const pct = Math.round((count / total) * 100);

  return (
    <div className="gs-panel" data-testid="gs-panel" role="complementary" aria-label="Getting Started">
      <div className="gs-header">
        <span className="gs-title">Getting Started</span>
        <span className="gs-progress-label" aria-live="polite">{count} of {total}</span>
        <button
          className="gs-dismiss"
          aria-label="Dismiss Getting Started panel"
          data-testid="gs-dismiss"
          onClick={() => onAction({ type: 'DISMISS' })}
        >
          ×
        </button>
      </div>
      <div className="gs-progress-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="gs-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <ul className="gs-list" role="list">
        {GS_ITEMS.map(({ key, label }) => {
          const done = completedItems.includes(key);
          return (
            <li key={key} className={`gs-item${done ? ' gs-item--done' : ''}`}>
              <button
                className="gs-item-btn"
                data-testid={`gs-item-${key}`}
                onClick={() => onAction({ type: 'CHECK_ITEM', item: key })}
                aria-pressed={done}
              >
                <span className="gs-check" aria-hidden="true" />
                <span className="gs-label">{label}</span>
                {!done && <span className="gs-arrow" aria-hidden="true">›</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
