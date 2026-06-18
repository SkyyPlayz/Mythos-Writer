import { useState, useEffect, useRef, useCallback } from 'react';
import EntityCard from './EntityCard';
import ContinuityEmptyState from './ContinuityEmptyState';
import './ContinuityPanel.css';

interface EntityResult {
  name: string;
  aliases: string[];
  type: string | null;
  path: string;
  excerpt: string;
}

interface Props {
  /** Current editor selection text, updated in real time. Empty string = no selection. */
  selectionText: string;
  autoFocusSearch?: boolean;
  onOpenEntityNote?: (path: string) => void;
}

const MATCH_DEBOUNCE_MS = 200;

export default function ContinuityPanel({ selectionText, autoFocusSearch = false, onOpenEntityNote }: Props) {
  const [notesVaultRoot, setNotesVaultRoot] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [matchResult, setMatchResult] = useState<EntityResult | null | 'loading' | 'no-match'>('no-match');
  const [searchResults, setSearchResults] = useState<EntityResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const matchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestVaultRootRef = useRef<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Load notes vault root once on mount, re-read on project switch
  useEffect(() => {
    const load = async () => {
      try {
        const res = await window.api.projectList?.();
        const nvr = res?.activeNotesVaultRoot ?? null;
        setNotesVaultRoot(nvr);
        latestVaultRootRef.current = nvr;
      } catch {
        // non-fatal: panel degrades gracefully
      }
    };
    load();

    const unsub = window.api.onProjectSwitched?.((data: { vaultRoot: string; notesVaultRoot?: string }) => {
      const nvr = data.notesVaultRoot ?? null;
      setNotesVaultRoot(nvr);
      latestVaultRootRef.current = nvr;
    });
    return () => unsub?.();
  }, []);

  useEffect(() => {
    if (!autoFocusSearch) return;
    const timer = setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [autoFocusSearch]);

  // Selection-driven auto-match with 200ms debounce
  const runMatch = useCallback(async (text: string, vaultRoot: string) => {
    if (!text.trim()) {
      setMatchResult('no-match');
      return;
    }
    setMatchResult('loading');
    try {
      const res = await window.api.continuityMatchSelection?.(text, vaultRoot);
      setMatchResult(res?.match ?? 'no-match');
    } catch {
      setMatchResult('no-match');
    }
  }, []);

  useEffect(() => {
    const vr = latestVaultRootRef.current;
    if (!vr) return;
    if (matchDebounceRef.current) clearTimeout(matchDebounceRef.current);
    if (!selectionText.trim()) {
      setMatchResult('no-match');
      return;
    }
    matchDebounceRef.current = setTimeout(() => {
      runMatch(selectionText, vr);
    }, MATCH_DEBOUNCE_MS);
    return () => { if (matchDebounceRef.current) clearTimeout(matchDebounceRef.current); };
  }, [selectionText, runMatch]);

  // Manual search with debounce
  useEffect(() => {
    const vr = latestVaultRootRef.current;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!query.trim() || !vr) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const res = await window.api.continuitySearch?.(query, vr);
        setSearchResults(res?.results ?? []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, MATCH_DEBOUNCE_MS);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [query]);

  const isSearchMode = query.trim().length > 0;

  if (!notesVaultRoot) {
    return (
      <div className="continuity-panel">
        <ContinuityEmptyState mode="no-vault" />
      </div>
    );
  }

  return (
    <div className="continuity-panel">
      <div className="continuity-search-row">
        <input
          ref={searchInputRef}
          type="search"
          className="continuity-search-input"
          placeholder="Search entities…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search entities in Notes Vault"
        />
      </div>

      <div className="continuity-scroll">
        {isSearchMode ? (
          <>
            {searchLoading && (
              <div className="continuity-loading" aria-live="polite">
                <span className="wa-spinner" aria-hidden="true" />
                Searching…
              </div>
            )}
            {!searchLoading && searchResults.length === 0 && (
              <ContinuityEmptyState mode="no-match" />
            )}
            {!searchLoading && searchResults.length > 0 && (
              <>
                <div className="continuity-section-label">Results</div>
                {searchResults.map((e) => (
                  <EntityCard
                    key={e.path}
                    entity={e}
                    onOpenEntityNote={onOpenEntityNote}
                    onClick={(entity) => {
                      setMatchResult(entity);
                      setQuery('');
                      setSearchResults([]);
                    }}
                  />
                ))}
              </>
            )}
          </>
        ) : (
          <>
            {matchResult === 'loading' && (
              <div className="continuity-loading" aria-live="polite">
                <span className="wa-spinner" aria-hidden="true" />
                Looking up…
              </div>
            )}
            {matchResult === 'no-match' && (
              <ContinuityEmptyState mode={selectionText.trim() ? 'no-match' : 'idle'} />
            )}
            {matchResult !== 'loading' && matchResult !== 'no-match' && matchResult !== null && (
              <>
                <div className="continuity-section-label">Best match</div>
                <EntityCard entity={matchResult} onOpenEntityNote={onOpenEntityNote} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
