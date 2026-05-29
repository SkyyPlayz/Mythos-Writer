import { useState, useCallback, useRef, useEffect } from 'react';
import { renderSnippet } from './SearchBar';
import './GlobalSearchPanel.css';

type SearchScope = 'story' | 'notes' | 'both';

interface SearchResultItem {
  docId: string;
  vault: 'story' | 'notes';
  kind: string;
  title: string;
  snippet: string;
  rank: number;
}

interface Props {
  open: boolean;
  onNavigate: (result: SearchResultItem) => void;
  onClose: () => void;
}

const KIND_ICONS: Record<string, string> = {
  scene: '✍️',
  character: '👤',
  location: '📍',
  item: '🗡️',
  concept: '💡',
  other: '📄',
};

const SCOPE_LABELS: { id: SearchScope; label: string }[] = [
  { id: 'both', label: 'All' },
  { id: 'story', label: 'Story' },
  { id: 'notes', label: 'Notes' },
];

export default function GlobalSearchPanel({ open, onNavigate, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>('both');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const runSearch = useCallback(async (q: string, s: SearchScope) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp = await (window as any).api?.searchVault(q, s, 15);
      if (resp?.results) {
        setResults(resp.results);
        setActiveIdx(-1);
      }
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleQueryChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const q = e.target.value;
      setQuery(q);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => runSearch(q, scope), 200);
    },
    [scope, runSearch],
  );

  const handleScopeChange = useCallback(
    (s: SearchScope) => {
      setScope(s);
      if (query.trim()) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => runSearch(query, s), 50);
      }
    },
    [query, runSearch],
  );

  const handleSelect = useCallback(
    (result: SearchResultItem) => {
      onNavigate(result);
      onClose();
      setQuery('');
      setResults([]);
    },
    [onNavigate, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, -1));
      } else if (e.key === 'Enter' && activeIdx >= 0) {
        e.preventDefault();
        handleSelect(results[activeIdx]);
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [results, activeIdx, handleSelect, onClose],
  );

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  if (!open) return null;

  return (
    <div className="global-search-overlay" onClick={onClose} role="presentation">
      <div className="global-search-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="global-search-header">
          <div className="global-search-input-row">
            <span className="global-search-icon">🔍</span>
            <input
              ref={inputRef}
              className="global-search-input"
              type="text"
              placeholder="Search vault…"
              value={query}
              onChange={handleQueryChange}
              onKeyDown={handleKeyDown}
              aria-label="Search vault"
              aria-expanded={results.length > 0}
              aria-autocomplete="list"
              role="combobox"
              aria-haspopup="listbox"
            />
          </div>
          <div className="global-search-scope-toggle" role="group" aria-label="Search scope">
            {SCOPE_LABELS.map(({ id, label }) => (
              <button
                key={id}
                className={`global-search-scope-btn${scope === id ? ' active' : ''}`}
                onClick={() => handleScopeChange(id)}
                title={`Search in ${label}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="global-search-body">
          {loading && (
            <div className="global-search-loading">
              <div className="spinner" />
              <p>Searching…</p>
            </div>
          )}

          {!loading && !query && (
            <div className="global-search-empty-state">
              <div className="empty-state-illustration">
                <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
                  <circle cx="32" cy="32" r="20" stroke="currentColor" strokeWidth="2.5" />
                  <line x1="50" y1="50" x2="68" y2="68" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
              </div>
              <h2 className="empty-state-heading">Start typing to search…</h2>
              <p className="empty-state-subtext">Search across all your vaults to find notes, scenes, and entities.</p>
            </div>
          )}

          {!loading && query && results.length === 0 && (
            <div className="global-search-empty-state">
              <div className="empty-state-illustration">
                <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
                  <circle cx="32" cy="32" r="20" stroke="currentColor" strokeWidth="2.5" />
                  <line x1="50" y1="50" x2="68" y2="68" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  <line x1="24" y1="24" x2="40" y2="40" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
                </svg>
              </div>
              <h2 className="empty-state-heading">No results for &quot;{query}&quot;</h2>
              <p className="empty-state-subtext">
                {scope !== 'both' ? (
                  <>Try a different word, or <button className="suggestion-btn" onClick={() => handleScopeChange('both')}>search in All vaults</button></>
                ) : (
                  'Try a different search term or refine your query.'
                )}
              </p>
            </div>
          )}

          {!loading && results.length > 0 && (
            <div className="global-search-results" ref={listRef} role="listbox">
              {results.map((result, idx) => (
                <button
                  key={result.docId}
                  className={`global-search-result-item${idx === activeIdx ? ' active' : ''}`}
                  role="option"
                  aria-selected={idx === activeIdx}
                  onMouseDown={(e) => { e.preventDefault(); handleSelect(result); }}
                  onMouseEnter={() => setActiveIdx(idx)}
                >
                  <span className="global-search-result-icon">
                    {KIND_ICONS[result.kind] ?? KIND_ICONS.other}
                  </span>
                  <div className="global-search-result-body">
                    <span className="global-search-result-title">{result.title}</span>
                    {result.snippet && (
                      <span className="global-search-result-snippet">
                        {renderSnippet(result.snippet)}
                      </span>
                    )}
                  </div>
                  <span className={`global-search-result-vault global-search-result-vault-${result.vault}`}>
                    {result.vault === 'story' ? 'Story' : 'Notes'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
