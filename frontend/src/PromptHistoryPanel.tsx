import { useState, useEffect, useCallback, useRef } from 'react';
import './PromptHistoryPanel.css';

type AgentTab = 'all' | 'writing-assistant' | 'brainstorm' | 'archive';

const TABS: { id: AgentTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'writing-assistant', label: 'Writing Assistant' },
  { id: 'brainstorm', label: 'Brainstorm' },
  { id: 'archive', label: 'Archive' },
];

const PAGE_SIZE = 20;

interface Props {
  onClose: () => void;
  initialTab?: AgentTab;
}

export default function PromptHistoryPanel({ onClose, initialTab }: Props) {
  const [tab, setTab] = useState<AgentTab>(initialTab ?? 'all');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(0);

  const [entries, setEntries] = useState<GenerationLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload: Parameters<typeof window.api.generationLogRecent>[0] = {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      };
      if (tab !== 'all') payload.agent = tab;
      if (debouncedSearch.trim()) payload.search = debouncedSearch.trim();
      if (dateFrom) payload.dateFrom = dateFrom + 'T00:00:00.000Z';
      if (dateTo) payload.dateTo = dateTo + 'T23:59:59.999Z';

      const result = await window.api.generationLogRecent(payload);
      setEntries(result.entries);
      setTotal(result.total);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [tab, debouncedSearch, dateFrom, dateTo, page]);

  useEffect(() => {
    setPage(0);
  }, [tab, debouncedSearch, dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  function agentLabel(agent: string): string {
    const map: Record<string, string> = {
      'writing-assistant': 'Writing Assistant',
      brainstorm: 'Brainstorm',
      archive: 'Archive',
    };
    return map[agent] ?? agent;
  }

  function snippet(text: string | null, max = 120): string {
    if (!text) return '—';
    const t = text.replace(/\n+/g, ' ').trim();
    return t.length > max ? t.slice(0, max) + '…' : t;
  }

  return (
    <div className="phistory-overlay" role="dialog" aria-modal="true" aria-label="Prompt History">
      <div className="phistory-panel">
        <div className="phistory-header">
          <h2 className="phistory-title">Prompt History</h2>
          <button
            className="phistory-close"
            onClick={onClose}
            aria-label="Close prompt history"
          >
            ×
          </button>
        </div>

        <div className="phistory-tabs" role="tablist" aria-label="Filter by agent">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`phistory-tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="phistory-filters">
          <input
            className="phistory-search"
            type="search"
            placeholder="Search prompts and responses…"
            aria-label="Search prompt history"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="phistory-date-row">
            <label className="phistory-date-label">
              From
              <input
                type="date"
                className="phistory-date"
                aria-label="Filter from date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </label>
            <label className="phistory-date-label">
              To
              <input
                type="date"
                className="phistory-date"
                aria-label="Filter to date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </label>
            {(dateFrom || dateTo) && (
              <button
                className="phistory-clear-dates"
                onClick={() => { setDateFrom(''); setDateTo(''); }}
                aria-label="Clear date range"
              >
                Clear dates
              </button>
            )}
          </div>
        </div>

        <div className="phistory-body" aria-live="polite" aria-busy={loading}>
          {loading && <div className="phistory-loading" aria-label="Loading">Loading…</div>}
          {error && <div className="phistory-error" role="alert">{error}</div>}
          {!loading && !error && entries.length === 0 && (
            <div className="phistory-empty">No prompt history found.</div>
          )}
          {!loading && !error && entries.length > 0 && (
            <ul className="phistory-list" aria-label="Prompt history entries">
              {entries.map((entry) => {
                const expanded = expandedId === entry.id;
                return (
                  <li key={entry.id} className={`phistory-row${expanded ? ' expanded' : ''}`}>
                    <button
                      className="phistory-row-summary"
                      onClick={() => setExpandedId(expanded ? null : entry.id)}
                      aria-expanded={expanded}
                      aria-label={`${agentLabel(entry.agent)} entry from ${formatDate(entry.created_at)}`}
                    >
                      <span className="phistory-agent-badge">{agentLabel(entry.agent)}</span>
                      <span className="phistory-timestamp">{formatDate(entry.created_at)}</span>
                      <span className="phistory-prompt-snippet">{snippet(entry.prompt_text)}</span>
                      {entry.error && <span className="phistory-error-badge">Error</span>}
                    </button>
                    {expanded && (
                      <div className="phistory-row-detail" aria-label="Entry detail">
                        <div className="phistory-detail-meta">
                          <span>{entry.model}</span>
                          {entry.tokens_in != null && (
                            <span>{entry.tokens_in} in / {entry.tokens_out ?? 0} out tokens</span>
                          )}
                          <span>{entry.latency_ms} ms</span>
                          {entry.error && <span className="phistory-detail-error">Error: {entry.error}</span>}
                        </div>
                        <section className="phistory-detail-section">
                          <h4>Prompt</h4>
                          <pre className="phistory-detail-text" aria-label="Full prompt text">{entry.prompt_text ?? '(none)'}</pre>
                        </section>
                        <section className="phistory-detail-section">
                          <h4>Response</h4>
                          <pre className="phistory-detail-text" aria-label="Full response text">{entry.response_text ?? '(none)'}</pre>
                        </section>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {totalPages > 1 && (
          <div className="phistory-pagination" aria-label="Pagination">
            <button
              className="phistory-page-btn"
              onClick={() => setPage((p) => p - 1)}
              disabled={page === 0}
              aria-label="Previous page"
            >
              ← Prev
            </button>
            <span className="phistory-page-info">
              Page {page + 1} of {totalPages} ({total} entries)
            </span>
            <button
              className="phistory-page-btn"
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= totalPages - 1}
              aria-label="Next page"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
