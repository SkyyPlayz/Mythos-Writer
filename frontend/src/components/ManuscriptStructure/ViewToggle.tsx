import { type ReactElement } from 'react';
import './ViewToggle.css';

export type ManuscriptViewMode = 'card' | 'list';

interface ViewToggleProps {
  mode: ManuscriptViewMode;
  onChange: (mode: ManuscriptViewMode) => void;
}

/** Grid / List segmented control — prototype 559–561 (structSeg, renderVals 4410). */
export function ViewToggle({ mode, onChange }: ViewToggleProps): ReactElement {
  return (
    <div className="msv-view-toggle" role="group" aria-label="View mode">
      <button
        className={`msv-view-toggle__btn${mode === 'card' ? ' msv-view-toggle__btn--active' : ''}`}
        onClick={() => onChange('card')}
        aria-pressed={mode === 'card'}
        title="Grid view (Ctrl+2)"
      >
        Grid
      </button>
      <button
        className={`msv-view-toggle__btn${mode === 'list' ? ' msv-view-toggle__btn--active' : ''}`}
        onClick={() => onChange('list')}
        aria-pressed={mode === 'list'}
        title="List view (Ctrl+1)"
      >
        List
      </button>
    </div>
  );
}
