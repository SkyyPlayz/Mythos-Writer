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
  initialTagFilter?: string;
  /** Context-aware initial scope. Defaults to 'both'. */
  defaultScope?: SearchScope;
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
  { id: 'story', label: 'Story Vault' },
  { id: 'notes', label: 'Notes Vault' },
];

export default function GlobalSearchPanel({ open, onNavigate, onClose, initialTagFilter, defaultScope = 'both' }: Props) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>(defaultScope);
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [activeTagFilters, setActiveTagFilters] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (initialTagFilter) setActiveTagFilters([initialTagFilter]);
  }, [initialTagFilter]);

  // Capture phase so Escape fires before editor keybindings swallow it
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [onClose]);

  const runSearch = useCallback(async (q: string, s: SearchScope, tagFilters?: string[]) => {
    const filters = tagFilters ?? activeTagFilters;
    if (!q.trim() && !filters.length) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const resp = await window.api.searchVault(q, s, 20, filters.length ? filters : undefined) as { results?: SearchResultItem[] };
      if (resp?.results) {
        setResults(resp.results);
        setActiveIdx(-1);
      }
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [activeTagFilters]);

  const handleQueryChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const q = e.target.value;
      setQuery(q);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => runSearch(q, scope), 300);
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
    },
    [onNavigate, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, -1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const target = activeIdx >= 0 ? results[activeIdx] : results[0];
        if (target) handleSelect(target);
      }
    },
    [results, activeIdx, handleSelect],
  );

  useEffect(() => {
    if (activeIdx < 0 || !listRef.current) return;
    const item = listRef.current.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    item?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  if (!open) return null;

  return (
    <div className="gsp-backdrop" onClick={onClose} role="presentation">
      <div
        className="gsp-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Search vault"
      >
        {activeTagFilters.length > 0 && (
          <div className="gsp-tag-filters">
            {activeTagFilters.map((t) => (
              <span key={t} className="gsp-tag-filter">
                #{t}
                <button
                  className="gsp-tag-filter-remove"
                  onClick={() => setActiveTagFilters((fs) => fs.filter((f) => f !== t))}
                  aria-label={`Remove tag filter ${t}`}
                >×</button>
              </span>
            ))}
          </div>
        )}

        <div className="gsp-header">
          <span className="gsp-icon" aria-hidden="true">🔍</span>
          <input
            ref={inputRef}
            className="gsp-input"
            type="text"
            placeholder="Search across all scenes and notes…"
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleKeyDown}
            aria-label="Search vault"
            aria-controls="gsp-results"
            aria-autocomplete="list"
            aria-expanded={results.length > 0}
            role="combobox"
            aria-haspopup="listbox"
          />
          <div className="gsp-scope-toggle" role="group" aria-label="Search scope">
            {SCOPE_LABELS.map(({ id, label }) => (
              <button
                key={id}
                className={`gsp-scope-btn${scope === id ? ' active' : ''}`}
                onClick={() => handleScopeChange(id)}
                aria-pressed={scope === id}
              >
                {label}
              </button>
            ))}
          </div>
          <button className="gsp-close-btn" onClick={onClose} aria-label="Close search panel">
            ✕
          </button>
        </div>

        <div
          id="gsp-results"
          className="gsp-results"
          ref={listRef}
          role="listbox"
          aria-label="Search results"
        >
          {loading && (
            <div className="gsp-state-msg" aria-live="polite">Searching…</div>
          )}
          {!loading && query.trim() && results.length === 0 && (
            <div className="gsp-state-msg">No results for &ldquo;{query}&rdquo;</div>
          )}
          {!loading && results.map((result, idx) => (
            <button
              key={result.docId}
              data-idx={idx}
              className={`gsp-result-item${idx === activeIdx ? ' active' : ''}`}
              role="option"
              aria-selected={idx === activeIdx}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(result); }}
              onMouseEnter={() => setActiveIdx(idx)}
            >
              <span className="gsp-result-icon" aria-hidden="true">
                {KIND_ICONS[result.kind] ?? KIND_ICONS.other}
              </span>
              <div className="gsp-result-body">
                <span className="gsp-result-title">{result.title}</span>
                {result.snippet && (
                  <span className="gsp-result-snippet">{renderSnippet(result.snippet)}</span>
                )}
              </div>
              <span className={`gsp-result-vault gsp-result-vault-${result.vault}`}>
                {result.vault === 'story' ? 'Story' : 'Notes'}
              </span>
            </button>
          ))}
          {!loading && !query && (
            <div className="gsp-state-msg gsp-hint">
              Type to search across all scenes and notes.
            </div>
          )}
        </div>

        <div className="gsp-footer">
          <span className="gsp-hint-key">↑↓ navigate</span>
          <span className="gsp-hint-sep" aria-hidden="true">·</span>
          <span className="gsp-hint-key">↵ open</span>
          <span className="gsp-hint-sep" aria-hidden="true">·</span>
          <span className="gsp-hint-key">Esc close</span>
        </div>
      </div>
    </div>
  );
}
