import { useState, useRef, useEffect, useCallback, useId } from 'react';
import './SearchBar.css';

interface SearchResultItem {
  docId: string;
  vault: 'story' | 'notes';
  kind: string;
  title: string;
  snippet: string;
  rank: number;
}

interface SearchBarProps {
  onNavigate: (result: SearchResultItem) => void;
}

type Scope = 'all' | 'story' | 'notes';

const SCOPES: { id: Scope; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'story', label: 'Story' },
  { id: 'notes', label: 'Notes' },
];

export default function SearchBar({ onNavigate }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [loading, setLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (q: string, sc: Scope) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      setOpen(false);
      setActiveIdx(-1);
      return;
    }
    setLoading(true);
    try {
      const res: { results: SearchResultItem[] } = await (window as any).api?.searchQuery?.({
        query: trimmed,
        scope: sc === 'all' ? undefined : sc,
        limit: 8,
      }) ?? { results: [] };
      const filtered = sc === 'all'
        ? res.results
        : res.results.filter((r) => r.vault === sc);
      setResults(filtered);
      setOpen(filtered.length > 0);
      setActiveIdx(-1);
    } catch {
      setResults([]);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const scheduleSearch = useCallback((q: string, sc: Scope) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => runSearch(q, sc), 250);
  }, [runSearch]);

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    scheduleSearch(q, scope);
  };

  const handleScopeChange = (sc: Scope) => {
    setScope(sc);
    scheduleSearch(query, sc);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((prev) => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter') {
      if (activeIdx >= 0 && results[activeIdx]) {
        e.preventDefault();
        commitResult(results[activeIdx]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIdx(-1);
    }
  };

  const commitResult = (result: SearchResultItem) => {
    setOpen(false);
    setActiveIdx(-1);
    setQuery('');
    setResults([]);
    onNavigate(result);
  };

  const activeDescendant =
    open && activeIdx >= 0 && results[activeIdx]
      ? `search-result-${results[activeIdx].docId}`
      : undefined;

  return (
    <div className="search-bar" role="search">
      <div className="search-bar-scope" role="group" aria-label="Search scope">
        {SCOPES.map(({ id, label }) => (
          <button
            key={id}
            className={`search-scope-btn${scope === id ? ' active' : ''}`}
            onClick={() => handleScopeChange(id)}
            aria-pressed={scope === id}
            aria-label={`Search scope: ${label}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="search-bar-combobox">
        <input
          ref={inputRef}
          className="search-bar-input"
          type="search"
          placeholder="Search…"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeDescendant}
          aria-label="Search vault"
        />
        {loading && <span className="search-bar-spinner" aria-hidden="true" />}
        {open && results.length > 0 && (
          <ul
            id={listboxId}
            className="search-results"
            role="listbox"
            aria-label="Search results"
          >
            {results.map((result, idx) => (
              <li key={result.docId} role="presentation">
                <button
                  id={`search-result-${result.docId}`}
                  className={`search-result-item${idx === activeIdx ? ' active' : ''}`}
                  role="option"
                  aria-selected={idx === activeIdx}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commitResult(result);
                  }}
                >
                  <span className="search-result-title">{result.title}</span>
                  <span className="search-result-meta">{result.vault} · {result.kind}</span>
                  {result.snippet && (
                    <span className="search-result-snippet">{result.snippet}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
