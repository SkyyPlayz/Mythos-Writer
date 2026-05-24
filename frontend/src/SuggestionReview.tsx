import { useState, useEffect, useCallback, useRef } from 'react';
import './SuggestionReview.css';

type AgentSource = 'writing-assistant' | 'brainstorm' | 'archive';
type SuggestionStatus = 'proposed' | 'accepted' | 'rejected' | 'ignored';
type FilterOption = 'all' | AgentSource;

interface Suggestion {
  id: string;
  source_agent: AgentSource;
  target: string;
  confidence: number;
  rationale: string;
  createdAt: string;
  status: SuggestionStatus;
  /** Serialised JSON payload — for brainstorm edits contains `{ prose: string }` */
  payload_json?: string | null;
}

const AGENT_LABELS: Record<AgentSource, string> = {
  'writing-assistant': 'Writing Assistant',
  brainstorm: 'Brainstorm',
  archive: 'Archive',
};

const FILTER_OPTIONS: { id: FilterOption; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'writing-assistant', label: 'Writing Assistant' },
  { id: 'brainstorm', label: 'Brainstorm' },
  { id: 'archive', label: 'Archive' },
];

function formatAge(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const MOCK_SUGGESTIONS: Suggestion[] = [
  {
    id: 'mock-wa-1',
    source_agent: 'writing-assistant',
    target: 'stories/chapter-1/scene-2.md',
    confidence: 0.87,
    rationale: 'Pacing slows in the third paragraph — consider splitting into two beats.',
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    status: 'proposed',
  },
  {
    id: 'mock-bs-1',
    source_agent: 'brainstorm',
    target: 'characters/elara.md',
    confidence: 0.72,
    rationale: "Elara's motivation for the vault heist is underspecified — add a scene showing her backstory.",
    createdAt: new Date(Date.now() - 7_200_000).toISOString(),
    status: 'proposed',
  },
  {
    id: 'mock-arc-1',
    source_agent: 'archive',
    target: 'locations/the-foundry.md',
    confidence: 0.91,
    rationale: 'The Foundry appears in ch3 but was destroyed in ch1 — continuity conflict.',
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    status: 'proposed',
  },
];

interface SuggestionRowProps {
  suggestion: Suggestion;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onIgnore: (id: string) => void;
  onOpenTarget: (path: string) => void;
}

function SuggestionRow({ suggestion, onAccept, onReject, onIgnore, onOpenTarget }: SuggestionRowProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); onAccept(suggestion.id); }
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); onReject(suggestion.id); }
    if (e.key === 'i' || e.key === 'I') { e.preventDefault(); onIgnore(suggestion.id); }
  };

  const confidencePct = Math.round(suggestion.confidence * 100);

  return (
    <div
      className="sr-row"
      role="article"
      aria-label={`${AGENT_LABELS[suggestion.source_agent]} suggestion for ${suggestion.target}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="sr-row-header">
        <span className={`sr-agent-badge sr-agent-${suggestion.source_agent}`}>
          {AGENT_LABELS[suggestion.source_agent]}
        </span>
        <button
          className="sr-target-link"
          onClick={() => onOpenTarget(suggestion.target)}
          aria-label={`Open ${suggestion.target} in vault`}
          tabIndex={-1}
        >
          {suggestion.target.split('/').pop()?.replace(/\.md$/, '') ?? suggestion.target}
        </button>
        <span className="sr-age">{formatAge(suggestion.createdAt)}</span>
      </div>

      <div className="sr-row-confidence" aria-label={`Confidence ${confidencePct}%`}>
        <div
          className="sr-confidence-bar"
          role="progressbar"
          aria-valuenow={confidencePct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="sr-confidence-fill" style={{ width: `${confidencePct}%` }} />
        </div>
        <span className="sr-confidence-pct">{confidencePct}%</span>
      </div>

      <p className="sr-rationale">{suggestion.rationale}</p>

      {suggestion.payload_json && (() => {
        try {
          const payload = JSON.parse(suggestion.payload_json) as { prose?: string; kind?: string; link?: string; anchorText?: string };
          if (payload.kind === 'wiki-link' && payload.link) {
            return (
              <div className="sr-wikilink-preview">
                <span className="sr-wikilink-badge">Wiki Link</span>
                <span className="sr-wikilink-link">{payload.link}</span>
                {payload.anchorText && (
                  <span className="sr-wikilink-anchor">on &ldquo;{payload.anchorText}&rdquo;</span>
                )}
              </div>
            );
          }
          if (payload.prose) {
            return (
              <details className="sr-proposed-content">
                <summary className="sr-proposed-summary">Proposed content</summary>
                <pre className="sr-proposed-pre">{payload.prose}</pre>
              </details>
            );
          }
        } catch { /* malformed JSON — skip */ }
        return null;
      })()}

      <div className="sr-actions">
        <button
          className="sr-btn sr-btn-accept"
          onClick={() => onAccept(suggestion.id)}
          aria-label={`Accept suggestion from ${AGENT_LABELS[suggestion.source_agent]}`}
        >
          Accept
        </button>
        <button
          className="sr-btn sr-btn-reject"
          onClick={() => onReject(suggestion.id)}
          aria-label={`Reject suggestion from ${AGENT_LABELS[suggestion.source_agent]}`}
        >
          Reject
        </button>
        <button
          className="sr-btn sr-btn-ignore"
          onClick={() => onIgnore(suggestion.id)}
          aria-label={`Ignore suggestion from ${AGENT_LABELS[suggestion.source_agent]}`}
        >
          Ignore
        </button>
      </div>
    </div>
  );
}

interface Props {
  onOpenVaultPath?: (path: string) => void;
}

export default function SuggestionReview({ onOpenVaultPath }: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [filter, setFilter] = useState<FilterOption>('all');
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const api = (window as any).api;
        if (typeof api?.suggestionsList === 'function') {
          const result = await api.suggestionsList();
          const mapped: Suggestion[] = ((result.suggestions ?? []) as Array<Record<string, unknown>>).map((r) => ({
            id: r.id as string,
            source_agent: (r.source_agent ?? 'brainstorm') as AgentSource,
            target: (r.target_path ?? r.target ?? '') as string,
            confidence: (r.confidence as number) ?? 0,
            rationale: (r.rationale ?? '') as string,
            createdAt: (r.created_at ?? r.createdAt ?? new Date().toISOString()) as string,
            status: (r.status ?? 'proposed') as SuggestionStatus,
            payload_json: (r.payload_json ?? null) as string | null,
          }));
          setSuggestions(mapped);
          setIsLive(true);
        } else {
          setSuggestions(MOCK_SUGGESTIONS);
        }
      } catch {
        setSuggestions(MOCK_SUGGESTIONS);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const updateStatus = useCallback(async (id: string, status: 'accepted' | 'rejected' | 'ignored') => {
    setSuggestions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status } : s))
    );
    try {
      const api = (window as any).api;
      if (status === 'accepted' && typeof api?.suggestionsAccept === 'function') {
        await api.suggestionsAccept(id);
      } else if (status === 'rejected' && typeof api?.suggestionsReject === 'function') {
        await api.suggestionsReject(id);
      } else if (status === 'ignored' && typeof api?.suggestionsIgnore === 'function') {
        await api.suggestionsIgnore(id);
      }
    } catch {
      // IPC not wired — state already updated optimistically
    }
  }, []);

  const handleAccept = useCallback((id: string) => updateStatus(id, 'accepted'), [updateStatus]);
  const handleReject = useCallback((id: string) => updateStatus(id, 'rejected'), [updateStatus]);
  const handleIgnore = useCallback((id: string) => updateStatus(id, 'ignored'), [updateStatus]);

  const handleOpenTarget = useCallback((path: string) => {
    onOpenVaultPath?.(path);
  }, [onOpenVaultPath]);

  const handleFilterKeyDown = (e: React.KeyboardEvent, id: FilterOption) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFilter(id); }
  };

  const proposed = suggestions.filter((s) => s.status === 'proposed');
  const visible = filter === 'all' ? proposed : proposed.filter((s) => s.source_agent === filter);

  const pendingCounts = {
    'writing-assistant': proposed.filter((s) => s.source_agent === 'writing-assistant').length,
    brainstorm: proposed.filter((s) => s.source_agent === 'brainstorm').length,
    archive: proposed.filter((s) => s.source_agent === 'archive').length,
  };

  if (loading) {
    return (
      <div className="suggestion-review">
        <div className="sr-loading" aria-label="Loading suggestions">Loading…</div>
      </div>
    );
  }

  return (
    <div className="suggestion-review">
      <div className="sr-header">
        <h2 className="sr-title">Review Inbox</h2>
        <span className="sr-count" aria-label={`${proposed.length} pending suggestions`}>
          {proposed.length}
        </span>
      </div>

      {!isLive && (
        <div className="sr-mock-banner" role="note">
          Preview mode — live API not yet connected.
        </div>
      )}

      <div
        className="sr-filters"
        role="group"
        aria-label="Filter by agent"
        ref={filterRef}
      >
        {FILTER_OPTIONS.map(({ id, label }) => {
          const count = id === 'all' ? proposed.length : pendingCounts[id as AgentSource];
          return (
            <button
              key={id}
              className={`sr-filter-chip${filter === id ? ' active' : ''}`}
              onClick={() => setFilter(id)}
              onKeyDown={(e) => handleFilterKeyDown(e, id)}
              aria-pressed={filter === id}
              aria-label={`${label}${count > 0 ? `, ${count} pending` : ''}`}
            >
              {label}
              {count > 0 && <span className="sr-chip-count">{count}</span>}
            </button>
          );
        })}
      </div>

      <div
        className="sr-list"
        role="list"
        aria-label="Pending suggestions"
        aria-live="polite"
      >
        {visible.length === 0 ? (
          <div className="sr-empty" role="status">
            {filter === 'all'
              ? 'No pending suggestions — all caught up!'
              : `No pending suggestions from ${AGENT_LABELS[filter as AgentSource]}.`}
          </div>
        ) : (
          visible.map((s) => (
            <SuggestionRow
              key={s.id}
              suggestion={s}
              onAccept={handleAccept}
              onReject={handleReject}
              onIgnore={handleIgnore}
              onOpenTarget={handleOpenTarget}
            />
          ))
        )}
      </div>

      {proposed.length > 0 && (
        <p className="sr-keyboard-hint" aria-hidden="true">
          Row focused: Enter accept · Backspace reject · I ignore
        </p>
      )}
    </div>
  );
}
