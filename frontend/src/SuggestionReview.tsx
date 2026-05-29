import { useState, useEffect, useCallback, useRef } from 'react';
import './SuggestionReview.css';

type AgentSource = 'writing-assistant' | 'brainstorm' | 'archive';
type SuggestionStatus = 'proposed' | 'accepted' | 'rejected' | 'ignored';
type AgentFilter = 'all' | AgentSource;
type StatusFilter = 'all' | 'accepted' | 'rejected' | 'ignored';
type PanelTab = 'inbox' | 'audit';

interface Suggestion {
  id: string;
  source_agent: AgentSource;
  target: string;
  confidence: number;
  rationale: string;
  createdAt: string;
  status: SuggestionStatus;
  payload_json?: string | null;
}

const AGENT_LABELS: Record<AgentSource, string> = {
  'writing-assistant': 'Writing Assistant',
  brainstorm: 'Brainstorm',
  archive: 'Archive',
};

const AGENT_FILTER_OPTIONS: { id: AgentFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'writing-assistant', label: 'Writing Assistant' },
  { id: 'brainstorm', label: 'Brainstorm' },
  { id: 'archive', label: 'Archive' },
];

const STATUS_FILTER_OPTIONS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'ignored', label: 'Ignored' },
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
    rationale:
      "Elara's motivation for the vault heist is underspecified — add a scene showing her backstory.",
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
  {
    id: 'mock-wa-2',
    source_agent: 'writing-assistant',
    target: 'stories/chapter-2/scene-1.md',
    confidence: 0.8,
    rationale: 'Chapter 2 opening buries the inciting event — consider leading with action.',
    createdAt: new Date(Date.now() - 172_800_000).toISOString(),
    status: 'accepted',
  },
  {
    id: 'mock-arc-2',
    source_agent: 'archive',
    target: 'characters/herald.md',
    confidence: 0.65,
    rationale: 'Herald is referenced in ch4 but never introduced — add an establishing mention.',
    createdAt: new Date(Date.now() - 259_200_000).toISOString(),
    status: 'rejected',
  },
  {
    id: 'mock-bs-2',
    source_agent: 'brainstorm',
    target: 'worldbuilding/magic-system.md',
    confidence: 0.58,
    rationale: 'Magic system rules are inconsistent between ch1 and ch3.',
    createdAt: new Date(Date.now() - 345_600_000).toISOString(),
    status: 'ignored',
  },
];

interface SuggestionRowProps {
  suggestion: Suggestion;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onIgnore: (id: string) => void;
  onOpenTarget: (path: string) => void;
}

function SuggestionRow({
  suggestion,
  onAccept,
  onReject,
  onIgnore,
  onOpenTarget,
}: SuggestionRowProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onAccept(suggestion.id);
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      onReject(suggestion.id);
    }
    if (e.key === 'i' || e.key === 'I') {
      e.preventDefault();
      onIgnore(suggestion.id);
    }
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

      {suggestion.payload_json &&
        (() => {
          try {
            const payload = JSON.parse(suggestion.payload_json) as {
              prose?: string;
              kind?: string;
              link?: string;
              anchorText?: string;
            };
            if (payload.kind === 'wiki-link' && payload.link) {
              return (
                <div className="sr-wikilink-preview">
                  <span className="sr-wikilink-badge">Wiki Link</span>
                  <span className="sr-wikilink-link">{payload.link}</span>
                  {payload.anchorText && (
                    <span className="sr-wikilink-anchor">
                      on &ldquo;{payload.anchorText}&rdquo;
                    </span>
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
          } catch {
            /* malformed JSON — skip */
          }
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

interface AuditRowProps {
  suggestion: Suggestion;
  onRollback: (id: string) => void;
  onOpenTarget: (path: string) => void;
  rollingBack: boolean;
}

function AuditRow({ suggestion, onRollback, onOpenTarget, rollingBack }: AuditRowProps) {
  return (
    <div
      className="sr-audit-row"
      role="article"
      aria-label={`${AGENT_LABELS[suggestion.source_agent]} suggestion — ${suggestion.status}`}
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
        <span className={`sr-status-badge sr-status-${suggestion.status}`}>
          {suggestion.status}
        </span>
        <span className="sr-age">{formatAge(suggestion.createdAt)}</span>
      </div>
      <p className="sr-rationale">{suggestion.rationale}</p>
      {suggestion.status === 'accepted' && (
        <div className="sr-actions">
          <button
            className="sr-btn sr-btn-rollback"
            onClick={() => onRollback(suggestion.id)}
            disabled={rollingBack}
            aria-label={`Rollback accepted suggestion from ${AGENT_LABELS[suggestion.source_agent]}`}
          >
            {rollingBack ? 'Rolling back…' : 'Rollback'}
          </button>
        </div>
      )}
    </div>
  );
}

interface Props {
  onOpenVaultPath?: (path: string) => void;
  /** All available vault roots — enables per-vault filter when more than one */
  availableVaults?: string[];
}

export default function SuggestionReview({ onOpenVaultPath, availableVaults }: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [agentFilter, setAgentFilter] = useState<AgentFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [vaultFilter, setVaultFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<PanelTab>('inbox');
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [rollingBackIds, setRollingBackIds] = useState<Set<string>>(new Set());
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const api = (window as any).api;
        if (typeof api?.suggestionsList === 'function') {
          const result = await api.suggestionsList();
          const mapped: Suggestion[] = (
            (result.suggestions ?? []) as Array<Record<string, unknown>>
          ).map((r) => ({
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

  const updateStatus = useCallback(
    async (id: string, status: 'accepted' | 'rejected' | 'ignored') => {
      setSuggestions((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    },
    [],
  );

  const handleAccept = useCallback((id: string) => updateStatus(id, 'accepted'), [updateStatus]);
  const handleReject = useCallback((id: string) => updateStatus(id, 'rejected'), [updateStatus]);
  const handleIgnore = useCallback((id: string) => updateStatus(id, 'ignored'), [updateStatus]);

  const handleRollback = useCallback(async (id: string) => {
    setRollingBackIds((prev) => new Set(prev).add(id));
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = (window as any).api;
      if (typeof api?.suggestionsRollback === 'function') {
        await api.suggestionsRollback(id);
      }
      setSuggestions((prev) => prev.map((s) => (s.id === id ? { ...s, status: 'proposed' } : s)));
    } catch {
      setSuggestions((prev) => prev.map((s) => (s.id === id ? { ...s, status: 'proposed' } : s)));
    } finally {
      setRollingBackIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const handleOpenTarget = useCallback(
    (path: string) => {
      onOpenVaultPath?.(path);
    },
    [onOpenVaultPath],
  );

  const handleAgentFilterKeyDown = (e: React.KeyboardEvent, id: AgentFilter) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setAgentFilter(id);
    }
  };

  const proposed = suggestions.filter((s) => s.status === 'proposed');

  const matchesVault = (s: Suggestion) => {
    if (vaultFilter === 'all') return true;
    return s.target.startsWith(vaultFilter);
  };

  const inboxVisible = (
    agentFilter === 'all' ? proposed : proposed.filter((s) => s.source_agent === agentFilter)
  ).filter(matchesVault);

  const audited = suggestions.filter((s) => s.status !== 'proposed');
  const auditVisible = audited
    .filter((s) => agentFilter === 'all' || s.source_agent === agentFilter)
    .filter((s) => statusFilter === 'all' || s.status === statusFilter)
    .filter(matchesVault);

  const pendingCounts = {
    'writing-assistant': proposed.filter((s) => s.source_agent === 'writing-assistant').length,
    brainstorm: proposed.filter((s) => s.source_agent === 'brainstorm').length,
    archive: proposed.filter((s) => s.source_agent === 'archive').length,
  };

  const showVaultFilter = availableVaults && availableVaults.length > 1;

  if (loading) {
    return (
      <div className="suggestion-review">
        <div className="sr-loading" aria-label="Loading suggestions">
          Loading&hellip;
        </div>
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
          Preview mode &mdash; live API not yet connected.
        </div>
      )}

      {/* Tab strip */}
      <div className="sr-tab-strip" role="tablist" aria-label="Review panel tabs">
        <button
          role="tab"
          aria-selected={activeTab === 'inbox'}
          className={`sr-tab${activeTab === 'inbox' ? ' active' : ''}`}
          onClick={() => setActiveTab('inbox')}
          id="sr-tab-inbox"
          aria-controls="sr-panel-inbox"
        >
          Inbox
          {proposed.length > 0 && <span className="sr-chip-count">{proposed.length}</span>}
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'audit'}
          className={`sr-tab${activeTab === 'audit' ? ' active' : ''}`}
          onClick={() => setActiveTab('audit')}
          id="sr-tab-audit"
          aria-controls="sr-panel-audit"
        >
          Audit Trail
          {audited.length > 0 && <span className="sr-chip-count">{audited.length}</span>}
        </button>
      </div>

      {/* Per-vault filter (only when multiple vaults available) */}
      {showVaultFilter && (
        <div className="sr-vault-filter">
          <label className="sr-vault-label" htmlFor="sr-vault-select">
            Vault
          </label>
          <select
            id="sr-vault-select"
            className="sr-vault-select"
            value={vaultFilter}
            onChange={(e) => setVaultFilter(e.target.value)}
            aria-label="Filter by vault"
          >
            <option value="all">All vaults</option>
            {availableVaults!.map((v) => (
              <option key={v} value={v}>
                {v.split('/').pop() ?? v}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Per-agent filter chips */}
      <div className="sr-filters" role="group" aria-label="Filter by agent" ref={filterRef}>
        {AGENT_FILTER_OPTIONS.map(({ id, label }) => {
          const count = id === 'all' ? proposed.length : pendingCounts[id as AgentSource];
          return (
            <button
              key={id}
              className={`sr-filter-chip${agentFilter === id ? ' active' : ''}`}
              onClick={() => setAgentFilter(id)}
              onKeyDown={(e) => handleAgentFilterKeyDown(e, id)}
              aria-pressed={agentFilter === id}
              aria-label={`${label}${count > 0 ? `, ${count} pending` : ''}`}
            >
              {label}
              {count > 0 && activeTab === 'inbox' && (
                <span className="sr-chip-count">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Inbox panel */}
      {activeTab === 'inbox' && (
        <div id="sr-panel-inbox" role="tabpanel" aria-labelledby="sr-tab-inbox">
          <div
            className="sr-list"
            role="list"
            aria-label="Pending suggestions"
            aria-live="polite"
          >
            {inboxVisible.length === 0 ? (
              <div className="sr-empty" role="status">
                {agentFilter === 'all'
                  ? 'No pending suggestions — all caught up!'
                  : `No pending suggestions from ${AGENT_LABELS[agentFilter as AgentSource]}.`}
              </div>
            ) : (
              inboxVisible.map((s) => (
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
              Row focused: Enter accept &middot; Backspace reject &middot; I ignore
            </p>
          )}
        </div>
      )}

      {/* Audit Trail panel */}
      {activeTab === 'audit' && (
        <div id="sr-panel-audit" role="tabpanel" aria-labelledby="sr-tab-audit">
          {/* Per-status filter */}
          <div className="sr-status-filters" role="group" aria-label="Filter by status">
            {STATUS_FILTER_OPTIONS.map(({ id, label }) => (
              <button
                key={id}
                className={`sr-filter-chip${statusFilter === id ? ' active' : ''}`}
                onClick={() => setStatusFilter(id)}
                aria-pressed={statusFilter === id}
                aria-label={label}
              >
                {label}
              </button>
            ))}
          </div>

          <div
            className="sr-list"
            role="list"
            aria-label="Suggestion audit trail"
            aria-live="polite"
          >
            {auditVisible.length === 0 ? (
              <div className="sr-empty" role="status">
                {audited.length === 0
                  ? 'No reviewed suggestions yet.'
                  : 'No suggestions match this filter.'}
              </div>
            ) : (
              auditVisible.map((s) => (
                <AuditRow
                  key={s.id}
                  suggestion={s}
                  onRollback={handleRollback}
                  onOpenTarget={handleOpenTarget}
                  rollingBack={rollingBackIds.has(s.id)}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
