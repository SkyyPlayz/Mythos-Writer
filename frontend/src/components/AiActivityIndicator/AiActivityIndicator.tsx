// AiActivityIndicator — SKY-11223: the always-visible surface for "what is
// the app doing right now." Renders one row per in-flight AI request, naming
// the agent, surface, and provider/model so a local-only user can confirm at
// a glance that nothing went to a cloud provider — plus a Stop button that
// calls straight through to the real AbortController behind the request.
// Recently finished requests stay visible for a few seconds with their real
// terminal outcome (done/empty/error/cancelled) — silence is never the end
// state a request leaves behind.
import './AiActivityIndicator.css';
import { useAiActivities, useRecentAiActivityTerminals, cancelAiActivity } from '../../agents/aiActivity';

const TERMINAL_LABELS: Record<AiActivityTerminalStatus, string> = {
  done: 'Finished',
  empty: 'Produced nothing',
  error: 'Error',
  cancelled: 'Stopped',
};

function providerLabel(entry: AiActivityEntry): string {
  return `${entry.provider.kind} · ${entry.provider.model}`;
}

export function AiActivityIndicator() {
  const activities = useAiActivities();
  const recentTerminals = useRecentAiActivityTerminals();

  if (activities.length === 0 && recentTerminals.length === 0) return null;

  return (
    <div className="ai-activity-indicator" role="status" aria-live="polite" data-testid="ai-activity-indicator">
      {activities.map((entry) => (
        <div key={entry.requestId} className="ai-activity-indicator__row ai-activity-indicator__row--running">
          <span className="ai-activity-indicator__dot" aria-hidden="true" />
          <span className="ai-activity-indicator__text">
            <strong>{entry.agentLabel}</strong> · {entry.surfaceLabel} · {providerLabel(entry)}
          </span>
          <button
            type="button"
            className="ai-activity-indicator__stop"
            onClick={() => cancelAiActivity(entry.requestId)}
            aria-label={`Stop ${entry.agentLabel} — ${entry.surfaceLabel}`}
          >
            Stop
          </button>
        </div>
      ))}
      {recentTerminals.map((event) => (
        <div
          key={`${event.requestId}-${event.endedAt}`}
          className={`ai-activity-indicator__row ai-activity-indicator__row--terminal ai-activity-indicator__row--${event.status}`}
        >
          <span className="ai-activity-indicator__text">
            {event.agentLabel} · {event.surfaceLabel} — {TERMINAL_LABELS[event.status]}
            {event.reason ? `: ${event.reason}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}
