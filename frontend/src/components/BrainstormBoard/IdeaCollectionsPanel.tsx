// Beta 4 / M20 — left IDEA COLLECTIONS panel (§7.2).
//
// Collapsible groups over the agent's captured ideas + the preloaded starter
// library (prototype bsCollections / bsPool). Search filters rows AND
// auto-expands groups with matches; `+` places an idea on the board, `✓`
// (dimmed) marks ideas already placed.

import { useMemo, useState } from 'react';
import {
  COLLECTION_ORDER,
  boardCategory,
  type BoardCategoryKey,
} from '../../brainstormBoard';
import './BrainstormBoard.css';

export interface CollectionIdea {
  key: string;
  cat: BoardCategoryKey;
  title: string;
  desc: string;
  chips: string[];
  av?: string;
  /** Set when the idea came from a detected fact (agent-filed vault note). */
  factId?: string;
}

interface Props {
  pool: CollectionIdea[];
  /** Lowercase titles of cards already placed on the board. */
  placedTitles: ReadonlySet<string>;
  onPlace: (idea: CollectionIdea) => void;
  showToast: (message: string) => void;
}

interface GroupDef {
  key: string;
  label: string;
  dot: string;
  ideas: CollectionIdea[];
}

export default function IdeaCollectionsPanel({ pool, placedTitles, onPlace, showToast }: Props) {
  const [query, setQuery] = useState('');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const groups: GroupDef[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (idea: CollectionIdea) =>
      !q || `${idea.title} ${idea.desc}`.toLowerCase().includes(q);
    const all: GroupDef = {
      key: 'all',
      label: 'All Ideas',
      dot: '#eaf2ff',
      ideas: pool.filter(matches),
    };
    const cats = COLLECTION_ORDER.map((catKey) => {
      const def = boardCategory(catKey);
      return {
        key: catKey,
        label: def.collectionLabel,
        dot: def.dot,
        ideas: pool.filter((idea) => idea.cat === catKey && matches(idea)),
      };
    });
    return [all, ...cats];
  }, [pool, query]);

  const searching = query.trim().length > 0;

  return (
    <aside className="bs-collections" data-testid="bs-collections" aria-label="Idea collections">
      <div className="bs-collections-title">IDEA COLLECTIONS</div>
      <div className="bs-collections-search">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="M20.5 20.5L16 16" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search ideas…"
          aria-label="Search idea collections"
          data-testid="bs-coll-search"
        />
      </div>
      <div className="bs-collections-list">
        {groups.map((group) => {
          // Search auto-expands groups that have matches (prototype behavior).
          const open = searching ? group.ideas.length > 0 : !!openGroups[group.key];
          return (
            <div key={group.key} className="bs-coll-group">
              <button
                type="button"
                className="bs-coll-head"
                aria-expanded={open}
                onClick={() =>
                  setOpenGroups((prev) => ({ ...prev, [group.key]: !prev[group.key] }))
                }
                data-testid={`bs-coll-toggle-${group.key}`}
              >
                <span className={`bs-coll-chev${open ? ' bs-coll-chev--open' : ''}`} aria-hidden="true">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </span>
                <span className="bs-coll-dot" style={{ background: group.dot, boxShadow: `0 0 7px ${group.dot}` }} aria-hidden="true" />
                <span className="bs-coll-label">{group.label}</span>
                <span className="bs-coll-count">{group.ideas.length}</span>
              </button>
              {open && group.ideas.map((idea) => {
                const placed = placedTitles.has(idea.title.trim().toLowerCase());
                const starter = idea.chips[0] === 'Starter';
                return (
                  <button
                    key={`${group.key}-${idea.key}`}
                    type="button"
                    className={`bs-coll-idea${placed ? ' bs-coll-idea--placed' : ''}`}
                    title={placed ? 'Already on the board' : 'Add to the board'}
                    aria-label={placed
                      ? `${idea.title} — already on the board`
                      : `Add ${idea.title} to the board`}
                    onClick={() => {
                      if (placed) {
                        showToast(`“${idea.title}” is already on the board`);
                        return;
                      }
                      onPlace(idea);
                    }}
                  >
                    <span className={`bs-coll-glyph${placed ? ' bs-coll-glyph--placed' : ''}`} aria-hidden="true">
                      {placed ? '✓' : '+'}
                    </span>
                    <span className="bs-coll-idea-main">
                      <span className="bs-coll-idea-title">
                        {idea.title}
                        {starter && <span className="bs-coll-starter-chip">Starter</span>}
                      </span>
                      <span className="bs-coll-idea-desc">{idea.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="bs-collections-foot">
        Ideas the agent captures in chat land in your Notes Vault and appear here — click + to
        place one on the board.
      </div>
    </aside>
  );
}
