// M12.B3 (SKY-10738): Archive Agent composer quick-action chips, above the
// message composer — one global "Run full scan" plus two context-specific
// actions generated from the current flag set. Same affordance as
// Brainstorm's RefinementChips (+warmer/+darker/+specific).
import type { QuickActionChip } from '../archive/composerQuickActions';
import './ComposerQuickActions.css';

interface Props {
  chips: QuickActionChip[];
  onSelect: (chip: QuickActionChip) => void;
  disabled?: boolean;
}

export default function ComposerQuickActions({ chips, onSelect, disabled }: Props) {
  if (chips.length === 0) return null;
  return (
    <div className="cqa-chips" aria-label="Quick actions">
      <div className="cqa-chips-list" role="group" aria-label="Archive Agent quick actions">
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            className="cqa-chip"
            onClick={() => onSelect(chip)}
            disabled={disabled}
            aria-label={chip.label}
            title={chip.label}
          >
            {chip.label}
          </button>
        ))}
      </div>
    </div>
  );
}
