import { REFINEMENT_CHIPS } from '../presets';
import type { PresetAxes, RefinementChip } from '../presets';
import './RefinementChips.css';

interface Props {
  effectiveAxes: PresetAxes;
  onRefine: (chip: RefinementChip) => void;
  disabled?: boolean;
  activeChipId?: string | null;
}

export default function RefinementChips({ effectiveAxes, onRefine, disabled, activeChipId }: Props) {
  return (
    <div className="refinement-chips" aria-label="Refinement options">
      <span className="refinement-chips-label">Refine:</span>
      <div className="refinement-chips-list" role="group" aria-label="Refinement chips">
        {REFINEMENT_CHIPS.map((chip) => {
          const isActive = activeChipId === chip.id;
          return (
            <button
              key={chip.id}
              className={`refinement-chip${isActive ? ' refinement-chip--active' : ''}`}
              onClick={() => onRefine(chip)}
              disabled={disabled}
              aria-pressed={isActive}
              aria-label={`Refine: ${chip.description}`}
              title={`Refine to ${chip.description}`}
              type="button"
            >
              {chip.label}
            </button>
          );
        })}
      </div>
      <span className="sr-only">
        Current style: {effectiveAxes.genre}, {effectiveAxes.tone} tone
      </span>
    </div>
  );
}
