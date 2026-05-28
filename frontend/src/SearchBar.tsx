import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import './SearchBar.css';

// Splits a raw FTS5 snippet (with [[…]] highlight markers) into React nodes.
// Text segments are plain strings (React escapes them); matched terms become <mark>.
// This avoids dangerouslySetInnerHTML and any possibility of HTML injection.
export function renderSnippet(snippet: string): ReactNode {
  const parts: ReactNode[] = [];
  let remaining = snippet;
  let key = 0;
  while (remaining.length > 0) {
    const start = remaining.indexOf('[[');
    if (start === -1) {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }
    if (start > 0) {
      parts.push(<span key={key++}>{remaining.slice(0, start)}</span>);
    }
    const end = remaining.indexOf(']]', start + 2);
    if (end === -1) {
      // Unclosed marker — treat the rest as plain text
      parts.push(<span key={key++}>{remaining.slice(start)}</span>);
      break;
    }
    parts.push(<mark key={key++}>{remaining.slice(start + 2, end)}</mark>);
    remaining = remaining.slice(end + 2);
  }
  return <>{parts}</>;
}

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
  onNavigate: (result: SearchResultItem) => void;
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

export default function SearchBar({ onNavigate }: Props) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>('both');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const runSearch = useCallback(async (q: string, s: SearchScope) => {
    if (!q.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    try {
      const resp = await (window as any).api?.searchVault(q, s, 15);
      if (resp?.results) {
        setResults(resp.results);
        setOpen(resp.results.length > 0);
        setActiveIdx(-1);
      }
    } catch {
      setResults([]);
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
      setOpen(false);
      setQuery('');
      setResults([]);
    },
    [onNavigate],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) return;
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
        setOpen(false);
        setActiveIdx(-1);
      }
    },
    [open, results, activeIdx, handleSelect],
  );

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Cleanup debounce on unmount
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  return (
    <div className="search-bar" ref={containerRef}>
      <div className="search-input-row">
        <span className="search-icon">🔍</span>
        <input
          ref={inputRef}
          className="search-input"
          type="text"
          placeholder="Search vault…"
          value={query}
          onChange={handleQueryChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          aria-label="Search vault"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls="search-results"
          role="combobox"
          aria-haspopup="listbox"
        />
        <div className="search-scope-toggle" role="group" aria-label="Search scope">
          {SCOPE_LABELS.map(({ id, label }) => (
            <button
              key={id}
              className={`search-scope-btn${scope === id ? ' active' : ''}`}
              onClick={() => handleScopeChange(id)}
              title={`Search in ${label}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {open && results.length > 0 && (
        <div id="search-results" className="search-results" role="listbox" aria-label="Search results">
          {results.map((result, idx) => (
            <button
              key={result.docId}
              className={`search-result-item${idx === activeIdx ? ' active' : ''}`}
              role="option"
              aria-selected={idx === activeIdx}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(result); }}
              onMouseEnter={() => setActiveIdx(idx)}
            >
              <span className="search-result-icon">
                {KIND_ICONS[result.kind] ?? KIND_ICONS.other}
              </span>
              <div className="search-result-body">
                <span className="search-result-title">{result.title}</span>
                {result.snippet && (
                  <span className="search-result-snippet">
                    {renderSnippet(result.snippet)}
                  </span>
                )}
              </div>
              <span className={`search-result-vault search-result-vault-${result.vault}`}>
                {result.vault === 'story' ? 'Story' : 'Notes'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
