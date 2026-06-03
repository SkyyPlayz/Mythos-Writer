import { useState } from 'react';
import {
  STANDARD_REFINEMENT_ACTIONS,
  getDynamicActions,
  type Preset,
  type RefinementAction,
} from '../../PresetLibrary';
import './index.css';

interface Props {
  suggestionId: string;
  activePreset: Preset | null;
  onRefine: (action: RefinementAction, additionalInstruction?: string) => void;
  disabled?: boolean;
}

export default function RefinementButtonGroup({ suggestionId, activePreset, onRefine, disabled }: Props) {
  const [showConstraintInput, setShowConstraintInput] = useState(false);
  const [constraintText, setConstraintText] = useState('');

  const dynamicActions = activePreset ? getDynamicActions(activePreset) : [];

  const handleAction = (action: RefinementAction) => {
    if (action === 'add_constraint') {
      setShowConstraintInput((prev) => !prev);
      return;
    }
    onRefine(action);
  };

  const submitConstraint = () => {
    onRefine('add_constraint', constraintText.trim() || undefined);
    setShowConstraintInput(false);
    setConstraintText('');
  };

  return (
    <div
      className="refine-btns"
      role="group"
      aria-label={`Refinement actions for suggestion ${suggestionId}`}
    >
      <div className="refine-btns-row">
        {STANDARD_REFINEMENT_ACTIONS.map(({ action, label }) => (
          <button
            key={action}
            className={`refine-btn${action === 'reject' ? ' refine-btn-reject' : ''}`}
            onClick={() => handleAction(action)}
            disabled={disabled}
            type="button"
            aria-label={`${label} this suggestion`}
            data-testid={`refine-action-${action}`}
          >
            {label}
          </button>
        ))}
        {dynamicActions.map(({ action, label }) => (
          <button
            key={action}
            className="refine-btn refine-btn-dynamic"
            onClick={() => handleAction(action)}
            disabled={disabled}
            type="button"
            aria-label={`${label} this suggestion`}
            data-testid={`refine-action-${action}`}
          >
            {label}
          </button>
        ))}
      </div>

      {showConstraintInput && (
        <div className="refine-constraint-row">
          <input
            className="refine-constraint-input"
            type="text"
            value={constraintText}
            onChange={(e) => setConstraintText(e.target.value)}
            placeholder='e.g. "no dialogue", "must end on a question"'
            aria-label="Add a creative constraint"
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submitConstraint(); }
              if (e.key === 'Escape') { setShowConstraintInput(false); setConstraintText(''); }
            }}
            autoFocus
          />
          <button
            className="refine-btn refine-btn-apply"
            onClick={submitConstraint}
            type="button"
            aria-label="Apply constraint"
          >
            Apply
          </button>
          <button
            className="refine-btn"
            onClick={() => { setShowConstraintInput(false); setConstraintText(''); }}
            type="button"
            aria-label="Cancel constraint"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
