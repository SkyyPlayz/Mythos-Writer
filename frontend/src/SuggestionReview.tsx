import { useState, useEffect, useCallback, useRef } from 'react';
import { SUGGESTION_CATEGORY_LABELS } from './types';
import SuggestionDetailPane, {
  type UnifiedSuggestion,
  type SuggestionSourceAgent,
} from './SuggestionDetailPane';
import './SuggestionReview.css';

type AgentFilter = 'all' | SuggestionSourceAgent;
type StatusFilter = 'all' | 'accepted' | 'rejected' | 'ignored';
type PanelTab = 'inbox' | 'audit';

const AGENT_LABELS: Record<SuggestionSourceAgent, string> = {
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

const MOCK_UNIFIED: UnifiedSuggestion[] = [
  {
    id: 'mock-wa-1',
    kind: 'suggestion',
    sourceAgent: 'writing-assistant',
    targetPath: 'stories/chapter-1/scene-2.md',
    targetAnchor: null,
    confidence: 0.87,
    rationale: 'Pacing slows in the third paragraph — consider splitting into two beats.',
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    status: 'proposed',
    appliedAt: null,
    budgetExceeded: false,
    category: null,
    payloadJson: null,
  },
  {
    id: 'mock-bs-1',
    kind: 'suggestion',
    sourceAgent: 'brainstorm',
    targetPath: 'characters/elara.md',
    targetAnchor: null,
    confidence: 0.72,
    rationale: "Elara's motivation for the vault heist is underspecified — add a backstory scene.",
    createdAt: new Date(Date.now() - 7_200_000).toISOString(),
    status: 'proposed',
    appliedAt: null,
    budgetExceeded: false,
    category: null,
    payloadJson: null,
  },
  {
    id: 'mock-arc-1',
    kind: 'continuity-issue',
    sourceAgent: 'archive',
    targetPath: 'locations/the-foundry.md',
    targetAnchor: null,
    confidence: 0.91,
    rationale: 'The Foundry appears in ch3 but was destroyed in ch1 — continuity conflict.',
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    status: 'proposed',
    appliedAt: null,
    budgetExceeded: false,
    category: 'high',
    payloadJson: null,
  },
  {
    id: 'mock-wa-2',
    kind: 'suggestion',
    sourceAgent: 'writing-assistant',
    targetPath: 'stories/chapter-2/scene-1.md',
    targetAnchor: null,
    confidence: 0.8,
    rationale: 'Chapter 2 opening buries the inciting event — consider leading with action.',
    createdAt: new Date(Date.now() - 172_800_000).toISOString(),
    status: 'accepted',
    appliedAt: null,
    budgetExceeded: false,
    category: null,
    payloadJson: null,
  },
  {
    id: 'mock-arc-2',
    kind: 'wiki-link',
    sourceAgent: 'archive',
    targetPath: 'characters/herald.md',
    targetAnchor: null,
    confidence: 0.65,
    rationale: 'Herald is referenced in ch4 but never introduced — add a wiki link.',
    createdAt: new Date(Date.now() - 259_200_000).toISOString(),
    status: 'proposed',
    appliedAt: null,
    budgetExceeded: false,
    category: null,
    payloadJson: JSON.stringify({ proposed_link: '[[Herald]]', anchor_text: 'The herald arrived' }),
  },
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

/** Maps an old-format DB row (from suggestions:search or suggestions:list) to UnifiedSuggestion. */
function mapDbRowToUnified(r: Record<string, unknown>): UnifiedSuggestion {
  return {
    id: r.id as string,
    kind: 'suggestion' as const,
    sourceAgent: (r.source_agent ?? 'brainstorm') as SuggestionSourceAgent,
    targetPath: (r.target_path ?? r.target ?? null) as string | null,
    targetAnchor: null,
    confidence: (r.confidence as number) ?? 0,
    rationale: (r.rationale ?? '') as string,
    createdAt: (r.created_at ?? r.createdAt ?? new Date().toISOString()) as string,
    status: (r.status ?? 'proposed') as UnifiedSuggestion['status'],
    appliedAt: null,
    budgetExceeded: Boolean(r.budget_exceeded),
    category: (r.category ?? null) as string | null,
    payloadJson: (r.payload_json ?? null) as string | null,
    preChangeSnapshot: (r.pre_change_snapshot ?? r.preChangeSnapshot ?? null) as string | null,
  };
}

interface SuggestionRowProps {
  suggestion: UnifiedSuggestion;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onIgnore: (id: string) => void;
  onOpenTarget: (path: string) => void;
  onOpenDetail: (id: string) => void;
  selected?: boolean;
  onSelect?: (id: string) => void;
}

function SuggestionRow({
  suggestion,
  onAccept,
  onReject,
  onIgnore,
  onOpenTarget,
  onOpenDetail,
  selected = false,
  onSelect,
}: SuggestionRowProps) {
  const handleRowClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    onOpenDetail(suggestion.id);
  };

  const handleClickCapture = (e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.stopPropagation();
      e.preventDefault();
      onSelect?.(suggestion.id);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onOpenDetail(suggestion.id);
    }
    if (e.key === 'a' || e.key === 'A') {
      e.preventDefault();
      onAccept(suggestion.id);
    }
    if (e.key === 'Backspace' || e.key === 'Delete' || e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      onReject(suggestion.id);
    }
    if (e.key === 'i' || e.key === 'I') {
      e.preventDefault();
      onIgnore(suggestion.id);
    }
  };

  const confidencePct = Math.round(suggestion.confidence * 100);

  // For wiki-link and scene_crafter_card rows, surface payload title as the descriptive line
  let rationaleText = suggestion.rationale;
  if (suggestion.kind === 'wiki-link' && suggestion.payloadJson) {
    try {
      const p = JSON.parse(suggestion.payloadJson) as {
        proposed_link?: string;
        link?: string;
      };
      const link = p.proposed_link ?? p.link;
      if (link) rationaleText = link;
    } catch {
      /* malformed — use rationale */
    }
  } else if (suggestion.kind === 'scene_crafter_card' && suggestion.payloadJson) {
    try {
      const p = JSON.parse(suggestion.payloadJson) as {
        payload?: { title?: string };
        target?: { laneId?: string };
      };
      const title = p.payload?.title;
      const lane = p.target?.laneId;
      if (title) rationaleText = lane ? `${title} → ${lane}` : title;
    } catch {
      /* malformed — use rationale */
    }
  }

  const isContinuity = suggestion.kind === 'continuity-issue';

  return (
    <div
      className={`sr-row${selected ? ' sr-row--selected' : ''}`}
      role="article"
      aria-label={`${AGENT_LABELS[suggestion.sourceAgent]} suggestion${suggestion.targetPath ? ` for ${suggestion.targetPath}` : ''}`}
      aria-selected={selected}
      tabIndex={0}
      onClick={handleRowClick}
      onKeyDown={handleKeyDown}
      onClickCapture={handleClickCapture}
    >
      <div className="sr-row-header">
        <span className={`sr-agent-badge sr-agent-${suggestion.sourceAgent}`}>
          {AGENT_LABELS[suggestion.sourceAgent]}
        </span>
        {isContinuity && suggestion.category && (
          <span
            className={`sr-severity-badge sr-severity-${suggestion.category}`}
            aria-label={`Severity: ${suggestion.category}`}
          >
            {suggestion.category}
          </span>
        )}
        {!isContinuity && suggestion.category && (
          <span
            className={`sr-category-badge sr-category-${suggestion.category}`}
            aria-label={`Category: ${SUGGESTION_CATEGORY_LABELS[suggestion.category as SuggestionCategory]}`}
          >
            {SUGGESTION_CATEGORY_LABELS[suggestion.category as SuggestionCategory]}
          </span>
        )}
        {suggestion.targetPath && (
          <button
            className="sr-target-link"
            onClick={(e) => {
              e.stopPropagation();
              onOpenTarget(suggestion.targetPath!);
            }}
            aria-label={`Open ${suggestion.targetPath} in vault`}
            tabIndex={-1}
          >
            {suggestion.targetPath.split('/').pop()?.replace(/\.md$/, '') ??
              suggestion.targetPath}
          </button>
        )}
        <span className="sr-age">{formatAge(suggestion.createdAt)}</span>
      </div>

      {/* Confidence bar only for non-continuity rows */}
      {!isContinuity && (
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
      )}

      <p className="sr-rationale">{rationaleText}</p>

      {suggestion.budgetExceeded && (
        <div className="sr-budget-held" role="status" aria-label="Auto-apply held — budget reached">
          <span aria-hidden="true">&#9888;</span> held — budget reached
        </div>
      )}

      <div className="sr-actions">
        <button
          className="sr-btn sr-btn-accept"
          onClick={() => onAccept(suggestion.id)}
          aria-label={`Accept suggestion from ${AGENT_LABELS[suggestion.sourceAgent]}`}
        >
          Accept
        </button>
        <button
          className="sr-btn sr-btn-reject"
          onClick={() => onReject(suggestion.id)}
          aria-label={`Reject suggestion from ${AGENT_LABELS[suggestion.sourceAgent]}`}
        >
          Reject
        </button>
        <button
          className="sr-btn sr-btn-ignore"
          onClick={() => onIgnore(suggestion.id)}
          aria-label={`Ignore suggestion from ${AGENT_LABELS[suggestion.sourceAgent]}`}
        >
          Ignore
        </button>
      </div>
    </div>
  );
}

interface AuditRowProps {
  suggestion: UnifiedSuggestion;
  onRollback: (id: string) => void;
  onOpenTarget: (path: string) => void;
  onOpenDetail: (id: string) => void;
  rollingBack: boolean;
}

function AuditRow({
  suggestion,
  onRollback,
  onOpenTarget,
  onOpenDetail,
  rollingBack,
}: AuditRowProps) {
  const handleRowClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    onOpenDetail(suggestion.id);
  };

  return (
    <div
      className="sr-audit-row"
      role="article"
      aria-label={`${AGENT_LABELS[suggestion.sourceAgent]} suggestion — ${suggestion.status}`}
      onClick={handleRowClick}
      style={{ cursor: 'default' }}
    >
      <div className="sr-row-header">
        <span className={`sr-agent-badge sr-agent-${suggestion.sourceAgent}`}>
          {AGENT_LABELS[suggestion.sourceAgent]}
        </span>
        {suggestion.category && (
          <span
            className={`sr-category-badge sr-category-${suggestion.category}`}
            aria-label={`Category: ${SUGGESTION_CATEGORY_LABELS[suggestion.category as SuggestionCategory]}`}
          >
            {SUGGESTION_CATEGORY_LABELS[suggestion.category as SuggestionCategory]}
          </span>
        )}
        {suggestion.targetPath && (
          <button
            className="sr-target-link"
            onClick={(e) => {
              e.stopPropagation();
              onOpenTarget(suggestion.targetPath!);
            }}
            aria-label={`Open ${suggestion.targetPath} in vault`}
            tabIndex={-1}
          >
            {suggestion.targetPath.split('/').pop()?.replace(/\.md$/, '') ??
              suggestion.targetPath}
          </button>
        )}
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
            aria-label={`Rollback accepted suggestion from ${AGENT_LABELS[suggestion.sourceAgent]}`}
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
  availableVaults?: string[];
}

export default function SuggestionReview({ onOpenVaultPath, availableVaults }: Props) {
  const [items, setItems] = useState<UnifiedSuggestion[]>([]);
  const [agentFilter, setAgentFilter] = useState<AgentFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [vaultFilter, setVaultFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<PanelTab>('inbox');
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [rollingBackIds, setRollingBackIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Confidence range filter (integer 0–100 representing percent)
  const [confidenceMin, setConfidenceMin] = useState(0);
  const [confidenceMax, setConfidenceMax] = useState(100);
  // Keyword search
  const [searchQuery, setSearchQuery] = useState('');

  const filterRef = useRef<HTMLDivElement>(null);
  const lastFocusedRowRef = useRef<HTMLElement | null>(null);

  // Always-current filter snapshot — avoids stale closures in debounce timer callbacks
  const filtersRef = useRef({ confidenceMin: 0, confidenceMax: 100, searchQuery: '' });
  useEffect(() => {
    filtersRef.current = { confidenceMin, confidenceMax, searchQuery };
  }, [confidenceMin, confidenceMax, searchQuery]);

  // Guards confidence/search debounce effects from firing before the initial load completes
  const initializedRef = useRef(false);

  /** Fetches items from IPC with the given confidence + search filters.
   *  Falls back to client-side filtering of MOCK_UNIFIED when IPC is unavailable. */
  const loadItems = useCallback(
    async (params: {
      confMin: number;
      confMax: number;
      query: string;
      isInitial?: boolean;
    }) => {
      const { confMin, confMax, query, isInitial } = params;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = (window as any).api;

      const confOpts: { confidenceMin?: number; confidenceMax?: number } = {};
      if (confMin > 0) confOpts.confidenceMin = confMin / 100;
      if (confMax < 100) confOpts.confidenceMax = confMax / 100;
      const hasConfOpts = Object.keys(confOpts).length > 0;

      try {
        if (query.trim() && typeof api?.suggestionsSearch === 'function') {
          // Keyword search — route to suggestions:search IPC (returns old DB format)
          const result = await api.suggestionsSearch({ query: query.trim(), ...confOpts });
          const mapped = (
            (result.suggestions ?? []) as Array<Record<string, unknown>>
          ).map(mapDbRowToUnified);
          setItems(mapped);
          if (isInitial) setIsLive(true);
        } else if (typeof api?.suggestionsUnifiedList === 'function') {
          // Unified list — pass confidence params directly
          const result = await api.suggestionsUnifiedList(
            hasConfOpts ? confOpts : {},
          );
          setItems((result.items ?? []) as UnifiedSuggestion[]);
          if (isInitial) setIsLive(true);
        } else if (typeof api?.suggestionsList === 'function') {
          // Legacy fallback: map old format to UnifiedSuggestion
          const result = await api.suggestionsList(
            undefined,
            undefined,
            hasConfOpts ? confOpts : undefined,
          );
          const mapped = (
            (result.suggestions ?? []) as Array<Record<string, unknown>>
          ).map(mapDbRowToUnified);
          setItems(mapped);
          if (isInitial) setIsLive(true);
        } else {
          // Offline / mock mode: apply filters client-side
          const lq = query.trim().toLowerCase();
          const filtered = MOCK_UNIFIED.filter((s) => {
            const pct = s.confidence * 100;
            if (pct < confMin || pct > confMax) return false;
            if (
              lq &&
              !s.rationale.toLowerCase().includes(lq) &&
              !(s.targetPath ?? '').toLowerCase().includes(lq)
            ) {
              return false;
            }
            return true;
          });
          setItems(filtered);
        }
      } catch {
        if (isInitial) setItems(MOCK_UNIFIED);
      } finally {
        if (isInitial) setLoading(false);
      }
    },
    [],
  );

  // Initial fetch on mount
  useEffect(() => {
    (async () => {
      await loadItems({ confMin: 0, confMax: 100, query: '', isInitial: true });
      initializedRef.current = true;
    })();
  }, [loadItems]);

  // Confidence range filter: re-fetch after 200ms debounce
  useEffect(() => {
    if (!initializedRef.current) return;
    const timer = setTimeout(() => {
      const { confidenceMin: min, confidenceMax: max, searchQuery: q } = filtersRef.current;
      void loadItems({ confMin: min, confMax: max, query: q });
    }, 200);
    return () => clearTimeout(timer);
  }, [confidenceMin, confidenceMax, loadItems]);

  // Keyword search: re-fetch after 300ms debounce
  useEffect(() => {
    if (!initializedRef.current) return;
    const timer = setTimeout(() => {
      const { confidenceMin: min, confidenceMax: max, searchQuery: q } = filtersRef.current;
      void loadItems({ confMin: min, confMax: max, query: q });
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, loadItems]);

  const updateStatus = useCallback(
    async (id: string, status: 'accepted' | 'rejected' | 'ignored') => {
      setItems((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
      setSelectedId(null);
      setSelectedIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
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
        /* IPC not wired — state already updated optimistically */
      }
    },
    [],
  );

  const handleAccept = useCallback((id: string) => updateStatus(id, 'accepted'), [updateStatus]);
  const handleReject = useCallback((id: string) => updateStatus(id, 'rejected'), [updateStatus]);
  const handleIgnore = useCallback((id: string) => updateStatus(id, 'ignored'), [updateStatus]);

  const handleRollback = useCallback(async (id: string) => {
    setRollingBackIds((prev) => new Set(prev).add(id));
    setSelectedId(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = (window as any).api;
      if (typeof api?.suggestionsRollback === 'function') {
        await api.suggestionsRollback(id);
      }
      setItems((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: 'proposed' as const } : s)),
      );
    } catch {
      setItems((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: 'proposed' as const } : s)),
      );
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

  const handleOpenDetail = useCallback((id: string) => {
    lastFocusedRowRef.current = document.activeElement as HTMLElement;
    setSelectedId(id);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedId(null);
    lastFocusedRowRef.current?.focus();
  }, []);

  const handleSelectRow = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleBatchAction = useCallback(
    async (action: 'accepted' | 'rejected' | 'ignored') => {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;
      setItems((prev) => prev.map((s) => (ids.includes(s.id) ? { ...s, status: action } : s)));
      setSelectedIds(new Set());
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const api = (window as any).api;
        if (typeof api?.suggestionsBatchAction === 'function') {
          const apiAction =
            action === 'accepted' ? 'accept' : action === 'rejected' ? 'reject' : 'ignore';
          await api.suggestionsBatchAction({ ids, action: apiAction });
        }
      } catch {
        /* IPC not wired — state already updated optimistically */
      }
    },
    [selectedIds],
  );

  const handleAgentFilterKeyDown = (e: React.KeyboardEvent, id: AgentFilter) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setAgentFilter(id);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setSearchQuery('');
    }
  };

  const handleMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setConfidenceMin(Math.min(v, confidenceMax));
  };

  const handleMaxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setConfidenceMax(Math.max(v, confidenceMin));
  };

  const proposed = items.filter((s) => s.status === 'proposed');

  const matchesVault = (s: UnifiedSuggestion) => {
    if (vaultFilter === 'all') return true;
    return s.targetPath?.startsWith(vaultFilter) ?? false;
  };

  const inboxVisible = (
    agentFilter === 'all' ? proposed : proposed.filter((s) => s.sourceAgent === agentFilter)
  ).filter(matchesVault);

  const allVisibleSelected =
    inboxVisible.length > 0 && inboxVisible.every((s) => selectedIds.has(s.id));
  const someVisibleSelected = inboxVisible.some((s) => selectedIds.has(s.id));

  const handleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        inboxVisible.forEach((s) => next.delete(s.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        inboxVisible.forEach((s) => next.add(s.id));
        return next;
      });
    }
  };

  const audited = items.filter((s) => s.status !== 'proposed');
  const auditVisible = audited
    .filter((s) => agentFilter === 'all' || s.sourceAgent === agentFilter)
    .filter((s) => statusFilter === 'all' || s.status === statusFilter)
    .filter(matchesVault);

  const pendingCounts: Record<SuggestionSourceAgent, number> = {
    'writing-assistant': proposed.filter((s) => s.sourceAgent === 'writing-assistant').length,
    brainstorm: proposed.filter((s) => s.sourceAgent === 'brainstorm').length,
    archive: proposed.filter((s) => s.sourceAgent === 'archive').length,
  };

  const showVaultFilter = availableVaults && availableVaults.length > 1;
  const selectedSuggestion = selectedId ? items.find((s) => s.id === selectedId) ?? null : null;

  // Whether any confidence or keyword filter is active (drives empty-state copy)
  const hasActiveFilter =
    confidenceMin > 0 || confidenceMax < 100 || searchQuery.trim().length > 0;

  // Boost min-handle z-index when near max so the user can drag it leftward
  const minHandleZIndex = confidenceMin >= confidenceMax - 5 ? 2 : 1;

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
    <div className="suggestion-review" style={{ position: 'relative' }}>
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

      {/* Per-vault filter */}
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

      {/* Filters: confidence slider + keyword search + agent chips */}
      <div className="sr-filters" role="group" aria-label="Suggestion filters" ref={filterRef}>
        {/* Confidence range slider */}
        <div className="sr-confidence-filter" role="group" aria-label="Filter by confidence">
          <div className="sr-confidence-filter-header">
            <span className="sr-filter-label">Confidence</span>
            <span className="sr-confidence-values" aria-live="polite">
              {confidenceMin}%&ndash;{confidenceMax}%
            </span>
          </div>
          <div className="sr-range-container">
            <div className="sr-range-track">
              <div
                className="sr-range-fill"
                style={{ left: `${confidenceMin}%`, right: `${100 - confidenceMax}%` }}
              />
            </div>
            <input
              type="range"
              className="sr-range-input"
              min={0}
              max={100}
              step={1}
              value={confidenceMin}
              onChange={handleMinChange}
              aria-label="Minimum confidence"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={confidenceMin}
              style={{ zIndex: minHandleZIndex }}
            />
            <input
              type="range"
              className="sr-range-input"
              min={0}
              max={100}
              step={1}
              value={confidenceMax}
              onChange={handleMaxChange}
              aria-label="Maximum confidence"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={confidenceMax}
              style={{ zIndex: minHandleZIndex === 2 ? 1 : 2 }}
            />
          </div>
        </div>

        {/* Keyword search */}
        <div className="sr-search-wrapper">
          <input
            type="text"
            role="searchbox"
            className="sr-search-input"
            placeholder="Search rationale or file…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            aria-label="Search suggestions"
          />
          {searchQuery && (
            <button
              className="sr-search-clear"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              tabIndex={-1}
            >
              &times;
            </button>
          )}
        </div>

        {/* Per-agent filter chips */}
        <div className="sr-filter-chips" role="group" aria-label="Filter by agent">
          {AGENT_FILTER_OPTIONS.map(({ id, label }) => {
            const count =
              id === 'all' ? proposed.length : pendingCounts[id as SuggestionSourceAgent];
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
      </div>

      {/* Inbox panel */}
      {activeTab === 'inbox' && (
        <div id="sr-panel-inbox" role="tabpanel" aria-labelledby="sr-tab-inbox">
          {inboxVisible.length > 0 && (
            <div className="sr-select-all-row">
              <input
                type="checkbox"
                id="sr-select-all"
                className="sr-select-all-checkbox"
                checked={allVisibleSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected;
                }}
                onChange={handleSelectAll}
                aria-label="Select all"
              />
              <label className="sr-select-all-label" htmlFor="sr-select-all">
                {allVisibleSelected ? 'Deselect all' : 'Select all'}
              </label>
            </div>
          )}

          <div
            className="sr-list"
            role="list"
            aria-label="Pending suggestions"
            aria-live="polite"
          >
            {inboxVisible.length === 0 ? (
              <div className="sr-empty" role="status">
                {hasActiveFilter
                  ? 'No suggestions match this filter.'
                  : agentFilter === 'all'
                    ? 'No pending suggestions — all caught up!'
                    : `No pending suggestions from ${AGENT_LABELS[agentFilter as SuggestionSourceAgent]}.`}
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
                  onOpenDetail={handleOpenDetail}
                  selected={selectedIds.has(s.id)}
                  onSelect={handleSelectRow}
                />
              ))
            )}
          </div>

          {proposed.length > 0 && (
            <p className="sr-keyboard-hint" aria-hidden="true">
              Click row to review &middot; Backspace reject &middot; I ignore &middot; Ctrl+Click select
            </p>
          )}

          {selectedIds.size > 0 && (
            <div className="sr-batch-bar" role="toolbar" aria-label="Batch actions">
              <span className="sr-batch-count" aria-live="polite" aria-atomic="true">
                {selectedIds.size} selected
              </span>
              <div className="sr-batch-actions">
                <button
                  className="sr-btn sr-btn-accept"
                  onClick={() => handleBatchAction('accepted')}
                  aria-label="Accept all selected suggestions"
                >
                  Accept all
                </button>
                <button
                  className="sr-btn sr-btn-reject"
                  onClick={() => handleBatchAction('rejected')}
                  aria-label="Reject all selected suggestions"
                >
                  Reject all
                </button>
                <button
                  className="sr-btn sr-btn-ignore"
                  onClick={() => handleBatchAction('ignored')}
                  aria-label="Ignore all selected suggestions"
                >
                  Ignore all
                </button>
                <button
                  className="sr-btn sr-btn-clear"
                  onClick={() => setSelectedIds(new Set())}
                  aria-label="Clear selection"
                >
                  Clear selection
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Audit Trail panel */}
      {activeTab === 'audit' && (
        <div id="sr-panel-audit" role="tabpanel" aria-labelledby="sr-tab-audit">
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
                  onOpenDetail={handleOpenDetail}
                  rollingBack={rollingBackIds.has(s.id)}
                />
              ))
            )}
          </div>
        </div>
      )}

      {/* Detail pane — slides in from the right */}
      {selectedSuggestion && (
        <SuggestionDetailPane
          suggestion={selectedSuggestion}
          onClose={handleCloseDetail}
          onAccept={handleAccept}
          onReject={handleReject}
          onIgnore={handleIgnore}
          onRollback={handleRollback}
        />
      )}
    </div>
  );
}
