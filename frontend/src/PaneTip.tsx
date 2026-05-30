import './PaneTip.css';

interface PaneTipProps {
  /** Unique key for this tip; used to persist dismissal. */
  tipKey: string;
  text: string;
  /** Whether the tip has already been dismissed (from seenTips record). */
  seen: boolean;
  onDismiss: (tipKey: string) => void;
}

/** Dismissible contextual tip shown on first pane visit (SKY-152). */
export default function PaneTip({ tipKey, text, seen, onDismiss }: PaneTipProps) {
  if (seen) return null;

  return (
    <div className="pane-tip" role="note" aria-live="polite" data-testid={`pane-tip-${tipKey}`}>
      <span className="pane-tip__icon" aria-hidden="true">💡</span>
      <span className="pane-tip__text">{text}</span>
      <button
        className="pane-tip__dismiss"
        onClick={() => onDismiss(tipKey)}
        aria-label="Dismiss tip"
        data-testid={`pane-tip-${tipKey}-dismiss`}
      >
        ×
      </button>
    </div>
  );
}
