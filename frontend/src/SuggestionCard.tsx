import { useState } from 'react';
import './SuggestionCard.css';

export interface SuggestionCardData {
  id: string;
  source_agent: string;
  text: string;
  confidence: number; // 0–1
  rationale: string;
  status: 'proposed' | 'accepted' | 'rejected';
  decidedAt?: string;
}

interface ConfidenceBadgeProps {
  confidence: number; // 0–1
}

function confidenceTier(segments: number): 'low' | 'medium' | 'high' {
  if (segments <= 4) return 'low';
  if (segments <= 7) return 'medium';
  return 'high';
}

export function ConfidenceBadge({ confidence }: ConfidenceBadgeProps) {
  const pct = Math.round(Math.max(0, Math.min(1, confidence)) * 100);
  const filled = Math.round(pct / 10);
  const tier = confidenceTier(filled);

  return (
    <span
      className={`wa-confidence-badge wa-confidence-badge--${tier}`}
      aria-label={`Confidence: ${pct}% (${tier})`}
      role="img"
    >
      <span className="wa-confidence-bar" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => (
          <span
            key={i}
            className={`wa-seg${i < filled ? ' wa-seg--on' : ''}`}
          />
        ))}
      </span>
      <span className="wa-confidence-pct" aria-hidden="true">{pct}%</span>
    </span>
  );
}

function relativeLabel(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

interface SuggestionCardProps {
  suggestion: SuggestionCardData;
  onApply: (id: string) => void;
  onReject: (id: string) => void;
}

export function SuggestionCard({ suggestion, onApply, onReject }: SuggestionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isTerminal = suggestion.status !== 'proposed';
  const verb = suggestion.status === 'accepted' ? 'Applied' : 'Rejected';

  return (
    <article
      className={`wa-suggestion-card${isTerminal ? ' wa-suggestion-card--terminal' : ''}`}
      aria-label="Writing assistant suggestion"
      tabIndex={0}
    >
      <div className="wa-card-agent-row">
        <span className="wa-card-agent-icon" aria-hidden="true">✦</span>
        <span className="wa-card-agent-label">Writing Assistant</span>
      </div>

      <p className={`wa-card-text${expanded ? ' wa-card-text--expanded' : ''}`}>
        {suggestion.text}
      </p>
      {suggestion.text.length > 140 && (
        <button
          type="button"
          className="wa-card-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}

      {expanded && suggestion.rationale && (
        <p className="wa-card-rationale">{suggestion.rationale}</p>
      )}

      <div className="wa-card-footer">
        <ConfidenceBadge confidence={suggestion.confidence} />

        {isTerminal ? (
          <span className="wa-card-decided-label">
            {verb}{suggestion.decidedAt ? ` ${relativeLabel(suggestion.decidedAt)}` : ''}
          </span>
        ) : (
          <div className="wa-card-actions">
            <button
              type="button"
              className="wa-card-btn wa-card-btn--apply"
              onClick={() => onApply(suggestion.id)}
              aria-label={`Apply: ${suggestion.text.slice(0, 50)}`}
            >
              ✓ Apply
            </button>
            <button
              type="button"
              className="wa-card-btn wa-card-btn--reject"
              onClick={() => onReject(suggestion.id)}
              aria-label={`Reject: ${suggestion.text.slice(0, 50)}`}
            >
              ✕ Reject
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
