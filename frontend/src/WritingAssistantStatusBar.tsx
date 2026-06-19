export type StatusBarState = 'scanning' | 'idle' | 'empty' | 'error';

interface Props {
  state: StatusBarState;
  lastScannedAt?: string | null;
  errorMessage?: string | null;
  onRetry?: () => void;
}

export function WritingAssistantStatusBar({ state, lastScannedAt, errorMessage, onRetry }: Props) {
  if (state === 'scanning') {
    return (
      <div className="wa-status-bar wa-status-bar--scanning" role="status" aria-label="Scanning">
        <span className="wa-spinner" aria-hidden="true" />
        <span className="wa-status-bar__label">Scanning…</span>
      </div>
    );
  }

  if (state === 'idle') {
    const timeLabel = lastScannedAt
      ? new Date(lastScannedAt).toLocaleTimeString()
      : null;
    return (
      <div className="wa-status-bar wa-status-bar--idle" role="status" aria-label="Ready">
        <span className="wa-status-bar__icon" aria-hidden="true">✓</span>
        <span className="wa-status-bar__label">Ready</span>
        {timeLabel && (
          <span className="wa-status-bar__time">{timeLabel}</span>
        )}
      </div>
    );
  }

  if (state === 'empty') {
    return (
      <div className="wa-status-bar wa-status-bar--empty" role="status" aria-label="No suggestions yet">
        <span className="wa-status-bar__label">All caught up — write a bit more to get suggestions.</span>
      </div>
    );
  }

  // error
  return (
    <div className="wa-status-bar wa-status-bar--error" role="alert" aria-label="Error">
      <span className="wa-status-bar__icon" aria-hidden="true">⚠</span>
      <span className="wa-status-bar__label">{errorMessage ?? 'Something went wrong.'}</span>
      {onRetry && (
        <button
          type="button"
          className="wa-status-bar__retry"
          onClick={onRetry}
          aria-label="Retry scan"
        >
          Retry
        </button>
      )}
    </div>
  );
}
