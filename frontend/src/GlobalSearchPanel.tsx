import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { renderSnippet } from './SearchBar';
import './GlobalSearchPanel.css';

type SearchScope = 'story' | 'notes' | 'both';

interface SearchResultItem {
  resultType: 'scene' | 'entity';
  docId: string;
  vault: 'story' | 'notes';
  kind: string;
  title: string;
  snippet: string;
  rank: number;
}

/** Beta 3 M5: command palette entries (prototype cmdIndex 3900–3913). */
export interface PaletteCommand {
  t: string;
  sub: string;
  run: () => void;
}

interface Props {
  open: boolean;
  onNavigate: (result: SearchResultItem) => void;
  onClose: () => void;
  initialTagFilter?: string;
  /** Context-aware initial scope. Defaults to 'both'. */
  defaultScope?: SearchScope;
  /** Beta 3 M5: commands shown as the palette's first group, filtered by query, cap 5. */
  commands?: PaletteCommand[];
  /** Beta 4 M2: seed query handed off from the title-bar "Search vault…"
   *  field — applied (and searched) each time the panel opens with one. */
  initialQuery?: string;
}

const KIND_ICONS: Record<string, string> = {
  scene: '✍️',
  character: '👥',
  location: '📍',
  item: '🗡️',
  concept: '💡',
  other: '📄',
};

const KIND_LABELS: Record<string, string> = {
  character: 'Character',
  location: 'Location',
  item: 'Item',
  concept: 'Concept',
  other: 'Entity',
};

const SCOPE_LABELS: { id: SearchScope; label: string }[] = [
  { id: 'both', label: 'All' },
  { id: 'story', label: 'Story Vault' },
  { id: 'notes', label: 'Notes Vault' },
];

export default function GlobalSearchPanel({ open, onNavigate, onClose, initialTagFilter, defaultScope = 'both', commands, initialQuery }: Props) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>(defaultScope);
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [activeTagFilters, setActiveTagFilters] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Partition results into scenes and entities; keyboard nav uses the flat order.
  const { sceneResults, entityResults, flatResults } = useMemo(() => {
    const scenes = results.filter((r) => r.resultType === 'scene');
    const entities = results.filter((r) => r.resultType === 'entity');
    return { sceneResults: scenes, entityResults: entities, flatResults: [...scenes, ...entities] };
  }, [results]);

  // Beta 3 M5: commands filter like the prototype (4450–4452) — substring on
  // title or sub, capped at 5, shown even before typing.
  const cmdHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (commands ?? [])
      .filter((c) => !q || c.t.toLowerCase().includes(q) || c.sub.toLowerCase().includes(q))
      .slice(0, 5);
  }, [commands, query]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    // Beta 4 M2: the title-bar field hands its draft here — seed and search
    // immediately so the FTS5 results appear without retyping (CF-14).
    if (initialQuery && initialQuery.trim()) {
      setQuery(initialQuery);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => runSearch(initialQuery, scope), 150);
    }
    // Only on open — scope/runSearch identity churn must not re-seed mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (initialTagFilter) setActiveTagFilters([initialTagFilter]);
  }, [initialTagFilter]);

  // Capture phase so Escape fires before editor keybindings swallow it.
  // Guard with `open` so the listener only exists while the panel is visible ---
  // an always-mounted listener intercepts Escape app-wide and breaks other UI
  // such as VaultBrowser inline rename (TC-V-07).
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [open, onClose]);

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
        setActiveIdx((i) => Math.min(i + 1, cmdHits.length + flatResults.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, -1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const idx = activeIdx >= 0 ? activeIdx : 0;
        if (idx < cmdHits.length) {
          const cmd = cmdHits[idx];
          if (cmd) { onClose(); cmd.run(); }
        } else {
          const target = flatResults[idx - cmdHits.length];
          if (target) handleSelect(target);
        }
      }
    },
    [flatResults, cmdHits, activeIdx, handleSelect, onClose],
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

  const hasBoth = sceneResults.length > 0 && entityResults.length > 0;

  const renderCommandItem = (cmd: PaletteCommand, flatIdx: number) => (
    <button
      key={cmd.t}
      data-idx={flatIdx}
      className={`gsp-result-item${flatIdx === activeIdx ? ' active' : ''}`}
      role="option"
      aria-selected={flatIdx === activeIdx}
      onMouseDown={(e) => { e.preventDefault(); onClose(); cmd.run(); }}
      onMouseEnter={() => setActiveIdx(flatIdx)}
      data-testid={`gsp-command-${flatIdx}`}
    >
      <span className="gsp-result-icon" aria-hidden="true">⌘</span>
      <div className="gsp-result-body">
        <span className="gsp-result-title">{cmd.t}</span>
      </div>
      <span className="gsp-result-type-chip">{cmd.sub}</span>
    </button>
  );

  const renderResultItem = (result: SearchResultItem, flatIdx: number) => (
    <button
      key={result.docId}
      data-idx={flatIdx}
      className={`gsp-result-item${flatIdx === activeIdx ? ' active' : ''}`}
      role="option"
      aria-selected={flatIdx === activeIdx}
      onMouseDown={(e) => { e.preventDefault(); handleSelect(result); }}
      onMouseEnter={() => setActiveIdx(flatIdx)}
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
      {result.resultType === 'entity' ? (
        <span className="gsp-result-type-chip">
          {KIND_LABELS[result.kind] ?? 'Entity'}
        </span>
      ) : (
        <span className={`gsp-result-vault gsp-result-vault-${result.vault}`}>
          {result.vault === 'story' ? 'Story' : 'Notes'}
        </span>
      )}
    </button>
  );

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
            aria-expanded={flatResults.length > 0}
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
          {!loading && query.trim() && flatResults.length === 0 && (
            <div className="gsp-state-msg gsp-no-results">
              <svg className="gsp-state-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <span className="gsp-state-headline">No results for &ldquo;{query}&rdquo;</span>
              <span className="gsp-state-desc">Try a different keyword, or check spelling.</span>
              <button className="gsp-clear-btn" onClick={() => setQuery('')} aria-label="Clear search">
                Clear search
              </button>
            </div>
          )}

          {cmdHits.length > 0 && (
            <>
              <div className="gsp-section-header" aria-hidden="true">Commands</div>
              {cmdHits.map((cmd, i) => renderCommandItem(cmd, i))}
            </>
          )}

          {!loading && sceneResults.length > 0 && (
            <>
              {(hasBoth || cmdHits.length > 0) && (
                <div className="gsp-section-header" aria-hidden="true">Scenes</div>
              )}
              {sceneResults.map((result, i) => renderResultItem(result, cmdHits.length + i))}
            </>
          )}

          {!loading && entityResults.length > 0 && (
            <>
              {(hasBoth || cmdHits.length > 0) && (
                <div className="gsp-section-header" aria-hidden="true">Entities</div>
              )}
              {entityResults.map((result, i) =>
                renderResultItem(result, cmdHits.length + sceneResults.length + i)
              )}
            </>
          )}

          {!loading && !query && !activeTagFilters.length && cmdHits.length === 0 && (
            <div className="gsp-state-msg gsp-hint">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: 0.5 }}>
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
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
