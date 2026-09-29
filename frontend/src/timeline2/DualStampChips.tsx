// Slice E — always-visible Local + Standard stamp chips (03 §2).
import './DualStampChips.css';

export interface DualStampChipsProps {
  local: string;
  standard: string;
  /** When true, only the standard row is shown (root IS the standard). */
  standardOnly?: boolean;
  testId?: string;
}

export default function DualStampChips({
  local,
  standard,
  standardOnly = false,
  testId = 'tl-dual-stamps',
}: DualStampChipsProps) {
  if (standardOnly) {
    return (
      <div className="tl-stamps" data-testid={testId}>
        <span className="tl-stamp tl-stamp--std" data-testid={`${testId}-std`} title="Standard stamp">
          {standard}
        </span>
      </div>
    );
  }
  return (
    <div className="tl-stamps" data-testid={testId}>
      <span className="tl-stamp tl-stamp--local" data-testid={`${testId}-local`} title="Local stamp">
        {local}
      </span>
      <span className="tl-stamp tl-stamp--std" data-testid={`${testId}-std`} title="Standard stamp">
        {standard}
      </span>
    </div>
  );
}
