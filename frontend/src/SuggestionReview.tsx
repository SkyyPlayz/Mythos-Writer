import { useState, useEffect, useCallback, useRef } from 'react';
import './SuggestionReview.css';

type AgentSource = 'writing-assistant' | 'brainstorm' | 'archive';
type SuggestionStatus = 'proposed' | 'accepted' | 'rejected' | 'ignored' | 'applied' | 'rolled_back';
type FilterOption = 'all' | AgentSource;
type AuditAction = 'accept' | 'apply' | 'reject' | 'rollback';

interface Suggestion {
  id: string;
  source_agent: AgentSource;
  target: string;
  confidence: number;
  rationale: string;
  payload?: string;
  auditId?: string;
  createdAt: string;
  status: SuggestionStatus;
}

interface AuditEntry {
  id: string;
  suggestionId: string;
  action: AuditAction;
  actor: string;
  snapshotPath: string | null;
  createdAt: string;
  sourceAgent: AgentSource;
  confidence: number;
  rationale: string;
  target: string;
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

const RESOLVED_STATUSES: SuggestionStatus[] = ['accepted', 'rejected', 'applied', 'rolled_back'];

function formatAge(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Normalize DbSuggestion (snake_case from API) to component Suggestion type
function normalizeSuggestion(raw: Record<string, unknown>): Suggestion {
  return {
    id: raw.id as string,
    source_agent: (raw.source_agent ?? '') as AgentSource,
    target: (raw.target_path ?? raw.target ?? '') as string,
    confidence: raw.confidence as number,
    rationale: raw.rationale as string,
    payload: (raw.payload_json ?? raw.payload) as string | undefined,
    createdAt: (raw.created_at ?? raw.createdAt ?? '') as string,
    status: raw.status as SuggestionStatus,
  };
}

const MOCK_SUGGESTIONS: Suggestion[] = [
  {
    id: 'mock-wa-1',
    source_agent: 'writing-assistant',
    target: 'stories/chapter-1/scene-2.md',
    confidence: 0.87,
    rationale: 'Pacing slows in the third paragraph — consider splitting into two beats.',
    payload: 'Split "The lantern swung wildly as she ran, her breath ragged, the footsteps behind her growing louder with every stride." into two sentences ending at "swung wildly" and resuming with "Her breath was ragged…"',
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    status: 'proposed',
  },
  {
    id: 'mock-bs-1',
    source_agent: 'brainstorm',
    target: 'characters/elara.md',
    confidence: 0.72,
    rationale: "Elara's motivation for the vault heist is underspecified — add a scene showing her backstory.",
    payload: "Add a flashback scene in Chapter 2: Elara finds her father's old lockpicking kit in the rubble of their childhood home, establishing her personal stakes in the heist.",
    createdAt: new Date(Date.now() - 7_200_000).toISOString(),
    status: 'proposed',
  },
  {
    id: 'mock-arc-1',
    source_agent: 'archive',
    target: 'locations/the-foundry.md',
    confidence: 0.91,
    rationale: 'The Foundry appears in ch3 but was destroyed in ch1 — continuity conflict.',
    payload: 'ch1 Scene 4 line 12: "The Foundry collapsed in a cloud of ash and smoke." Conflicts with ch3 Scene 1: "They met at The Foundry\'s east entrance."',
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    status: 'proposed',
  },
];

const MOCK_AUDIT_ENTRIES: AuditEntry[] = [
  {
    id: 'mock-audit-1',
    suggestionId: 'mock-wa-hist-1',
    action: 'accept',
    actor: 'user',
    snapshotPath: null,
    createdAt: new Date(Date.now() - 14_400_000).toISOString(),
    sourceAgent: 'writing-assistant',
    confidence: 0.93,
    rationale: 'Opening paragraph rhythm improved — shorter sentences increase urgency during the chase.',
    target: 'stories/chapter-1/scene-1.md',
  },
  {
    id: 'mock-audit-2',
    suggestionId: 'mock-arc-hist-1',
    action: 'reject',
    actor: 'user',
    snapshotPath: null,
    createdAt: new Date(Date.now() - 28_800_000).toISOString(),
    sourceAgent: 'archive',
    confidence: 0.65,
    rationale: 'Possible continuity issue with secondary character name in Chapter 4 — "Maren" vs "Marin".',
    target: 'characters/secondary.md',
  },
  {
    id: 'mock-audit-3',
    suggestionId: 'mock-bs-hist-1',
    action: 'accept',
    actor: 'user',
    snapshotPath: null,
    createdAt: new Date(Date.now() - 172_800_000).toISOString(),
    sourceAgent: 'brainstorm',
    confidence: 0.78,
    rationale: 'Secondary antagonist needs clearer motivation — suggest adding rival merchant subplot.',
    target: 'plot/act-2.md',
  },
];

interface SuggestionRowProps {
  suggestion: Suggestion;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onIgnore: (id: string) => void;
  onOpenTarget: (path: string) => void;
  onOpenAuditTrail?: (agent: AgentSource) => void;
}

function SuggestionRow({ suggestion, onAccept, onReject, onIgnore, onOpenTarget, onOpenAuditTrail }: SuggestionRowProps) {
  const [payloadExpanded, setPayloadExpanded] = useState(false);

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

      {suggestion.payload && (
        <div className="sr-payload">
          <button
            className="sr-payload-toggle"
            onClick={() => setPayloadExpanded((v) => !v)}
            aria-expanded={payloadExpanded}
            aria-label={payloadExpanded ? 'Collapse payload preview' : 'Expand payload preview'}
            tabIndex={-1}
          >
            <span className="sr-payload-toggle-icon">{payloadExpanded ? '▾' : '▸'}</span>
            Payload preview
          </button>
          {payloadExpanded && (
            <pre className="sr-payload-body" aria-label="Payload preview">
              {suggestion.payload}
            </pre>
          )}
        </div>
      )}

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
        {onOpenAuditTrail && (
          <button
            className="sr-btn sr-btn-audit"
            onClick={() => onOpenAuditTrail(suggestion.source_agent)}
            aria-label={`View audit trail for ${AGENT_LABELS[suggestion.source_agent]} suggestion`}
            tabIndex={-1}
          >
            Audit trail
          </button>
        )}
      </div>
    </div>
  );
}

function AuditTrailRow({ entry }: { entry: AuditEntry }) {
  const confidencePct = Math.round(entry.confidence * 100);
  const isAccepted = entry.action === 'accept' || entry.action === 'apply';

  return (
    <div
      className="sr-audit-row"
      role="article"
      aria-label={`${AGENT_LABELS[entry.sourceAgent]} suggestion ${isAccepted ? 'accepted' : 'rejected'}`}
    >
      <div className="sr-row-header">
        <span className={`sr-agent-badge sr-agent-${entry.sourceAgent}`}>
          {AGENT_LABELS[entry.sourceAgent]}
        </span>
        <span className="sr-target-text">
          {entry.target.split('/').pop()?.replace(/\.md$/, '') ?? entry.target}
        </span>
        <span className={`sr-audit-action-badge${isAccepted ? ' sr-audit-accepted' : ' sr-audit-rejected'}`}>
          {isAccepted ? 'Accepted' : 'Rejected'}
        </span>
        <span className="sr-age">{formatAge(entry.createdAt)}</span>
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

      <p className="sr-rationale sr-audit-summary">{entry.rationale}</p>
    </div>
  );
}

interface Props {
  onOpenVaultPath?: (path: string) => void;
  onOpenAuditTrail?: (agent: AgentSource) => void;
}

export default function SuggestionReview({ onOpenVaultPath, onOpenAuditTrail }: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [filter, setFilter] = useState<FilterOption>('all');
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  // Ref lets updateStatus read current suggestions without a stale closure
  const suggestionsRef = useRef<Suggestion[]>([]);
  suggestionsRef.current = suggestions;

  useEffect(() => {
    (async () => {
      try {
        const api = (window as any).api;
        if (typeof api?.suggestionsList === 'function') {
          const result = await api.suggestionsList();
          const normalized: Suggestion[] = (result.suggestions ?? []).map(
            (r: Record<string, unknown>) => normalizeSuggestion(r)
          );
          setSuggestions(normalized);

          if (typeof api?.auditList === 'function') {
            const auditResult = await api.auditList();
            const auditRows: Array<{
              id: string;
              suggestion_id: string;
              action: string;
              snapshot_path: string | null;
              actor: string;
              created_at: string;
            }> = auditResult.entries ?? [];

            // Build a map for O(1) lookup when joining
            const suggestionMap = new Map<string, Suggestion>(
              normalized.map((s) => [s.id, s])
            );

            // One entry per suggestion (latest first from API ordering)
            const seen = new Set<string>();
            const joined: AuditEntry[] = [];
            for (const row of auditRows) {
              if (seen.has(row.suggestion_id)) continue;
              const suggestion = suggestionMap.get(row.suggestion_id);
              if (!suggestion || !RESOLVED_STATUSES.includes(suggestion.status)) continue;
              seen.add(row.suggestion_id);
              joined.push({
                id: row.id,
                suggestionId: row.suggestion_id,
                action: row.action as AuditAction,
                actor: row.actor,
                snapshotPath: row.snapshot_path,
                createdAt: row.created_at,
                sourceAgent: suggestion.source_agent,
                confidence: suggestion.confidence,
                rationale: suggestion.rationale,
                target: suggestion.target,
              });
            }
            setAuditEntries(joined);
          }

          setIsLive(true);
        } else {
          setSuggestions(MOCK_SUGGESTIONS);
          setAuditEntries(MOCK_AUDIT_ENTRIES);
        }
      } catch {
        setSuggestions(MOCK_SUGGESTIONS);
        setAuditEntries(MOCK_AUDIT_ENTRIES);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const updateStatus = useCallback(async (id: string, status: 'accepted' | 'rejected' | 'ignored') => {
    // Read suggestion before state update to avoid stale closure
    const suggestion = suggestionsRef.current.find((s) => s.id === id);

    setSuggestions((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));

    // Optimistically add an audit entry for accept/reject
    if (suggestion && (status === 'accepted' || status === 'rejected')) {
      const optimisticEntry: AuditEntry = {
        id: `local-${id}-${Date.now()}`,
        suggestionId: id,
        action: status === 'accepted' ? 'accept' : 'reject',
        actor: 'user',
        snapshotPath: null,
        createdAt: new Date().toISOString(),
        sourceAgent: suggestion.source_agent,
        confidence: suggestion.confidence,
        rationale: suggestion.rationale,
        target: suggestion.target,
      };
      setAuditEntries((prev) => [optimisticEntry, ...prev.filter((e) => e.suggestionId !== id)]);
    }

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
  const visibleAudit = filter === 'all'
    ? auditEntries
    : auditEntries.filter((e) => e.sourceAgent === filter);

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
              onOpenAuditTrail={onOpenAuditTrail}
            />
          ))
        )}
      </div>

      {proposed.length > 0 && (
        <p className="sr-keyboard-hint" aria-hidden="true">
          Row focused: Enter accept · Backspace reject · I ignore
        </p>
      )}

      {visibleAudit.length > 0 && (
        <div className="sr-audit-section">
          <div className="sr-section-divider" />
          <div className="sr-section-header">
            <h3 className="sr-section-title">Audit Trail</h3>
            <span className="sr-count sr-count-muted" aria-label={`${visibleAudit.length} resolved`}>
              {visibleAudit.length}
            </span>
          </div>
          <div
            className="sr-list"
            role="list"
            aria-label="Audit trail entries"
          >
            {visibleAudit.map((entry) => (
              <AuditTrailRow key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
