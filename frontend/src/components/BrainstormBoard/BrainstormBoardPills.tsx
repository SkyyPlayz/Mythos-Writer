/**
 * SKY-11192/SKY-11674 §1 — the folder-scope pill row on Brainstorm's Board
 * page. Exactly three pills (CEO ruling on SKY-11192: no `Browse vault…`
 * picker — that navigator already lives in the Notes Board tab). The active
 * pill is the minimum wayfinding a user needs to know which folder's board
 * they're looking at (Recognition over Recall); the caption underneath is
 * the whole "this is the same vault" affordance — no modal, no tooltip.
 */
import { PILL_FOLDERS, type PillFolder } from './BrainstormBoardSurface';

export interface BrainstormBoardPillsProps {
  active: PillFolder['key'];
  onSelect: (key: PillFolder['key']) => void;
}

export default function BrainstormBoardPills({ active, onSelect }: BrainstormBoardPillsProps) {
  return (
    <>
      <div className="bbs-pills" role="tablist" aria-label="Board folder">
        {PILL_FOLDERS.map((pill) => (
          <button
            key={pill.key}
            type="button"
            role="tab"
            aria-selected={active === pill.key}
            className={`bbs-pill${active === pill.key ? ' bbs-pill--active' : ''}`}
            onClick={() => onSelect(pill.key)}
            data-testid={`bbs-pill-${pill.key}`}
          >
            {pill.label}
          </button>
        ))}
      </div>
      <p className="bbs-pills-caption">This is your Notes Vault, viewed here.</p>
    </>
  );
}
