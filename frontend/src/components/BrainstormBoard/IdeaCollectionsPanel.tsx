// SKY-11192/SKY-11674 §3 — left IDEA COLLECTIONS panel.
//
// Collapsible groups over the agent's captured ideas + the preloaded starter
// library (prototype bsCollections / bsPool). Search filters rows AND
// auto-expands groups with matches. The row's trailing control is a labeled
// `File` button (not an icon-only `+`) — filing now has a real, visible
// consequence (creates a vault note, may create a folder), so a text label
// is required (design spec §3 / constraints: "clear labels rather than
// icon-only controls").
//
// REVIEW-BLOCKING CONSTRAINT (design spec §3, ticket ruling 5): `onFile`
// below is wired to exactly ONE call site in this file — the `File`
// button's `onClick`. No effect, no timer, no prop default, and no agent/
// chat code path may call it. A reviewer who cannot see that this is the
// only caller should block the PR.

import { useMemo, useState } from 'react';
import {
  COLLECTION_ORDER,
  boardCategory,
  type BoardCategoryKey,
} from '../../brainstormBoard';
import type { IdeaFileStatus } from './useIdeaCollectionsFiling';
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
  statusFor: (idea: CollectionIdea) => IdeaFileStatus;
  /** Direct user click on `File` only — see the review-blocking constraint above. */
  onFile: (idea: CollectionIdea) => void;
  /** `Open` on an already-filed idea — navigates to its board. */
  onOpen: (idea: CollectionIdea) => void;
  /** R11: true when the master AI toggle is off — Agent Chat is unreachable,
   * so the footer copy shouldn't promise a chat-driven capture flow. */
  manualOnly?: boolean;
}

interface GroupDef {
  key: string;
  label: string;
  dot: string;
  ideas: CollectionIdea[];
}

export default function IdeaCollectionsPanel({ pool, statusFor, onFile, onOpen, manualOnly }: Props) {
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
                const status = statusFor(idea);
                const starter = idea.chips[0] === 'Starter';
                return (
                  <div key={`${group.key}-${idea.key}`} className={`bs-coll-idea bs-coll-idea--${status}`}>
                    <span className={`bs-coll-glyph${status === 'filed' ? ' bs-coll-glyph--placed' : ''}`} aria-hidden="true">
                      {status === 'filed' ? '✓' : '+'}
                    </span>
                    <span className="bs-coll-idea-main">
                      <span className="bs-coll-idea-title">
                        {idea.title}
                        {starter && <span className="bs-coll-starter-chip">Starter</span>}
                      </span>
                      <span className="bs-coll-idea-desc">{idea.desc}</span>
                    </span>
                    {status === 'unfiled' && (
                      <button
                        type="button"
                        className="bs-coll-file-btn"
                        onClick={() => onFile(idea)}
                        data-testid="bs-coll-file"
                      >
                        File
                      </button>
                    )}
                    {status === 'filing' && (
                      <span className="bs-coll-filing" aria-live="polite">Filing…</span>
                    )}
                    {status === 'filed' && (
                      <span className="bs-coll-filed-group">
                        <span className="bs-coll-filed-label">Filed ✓</span>
                        <button
                          type="button"
                          className="bs-coll-open-btn"
                          onClick={() => onOpen(idea)}
                          data-testid="bs-coll-open"
                        >
                          Open
                        </button>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="bs-collections-foot">
        {manualOnly
          ? 'Click File to add an idea as a real note in your Notes Vault.'
          : 'Ideas the agent captures in chat land in your Notes Vault and appear here — click File to add one as a real note.'}
      </div>
    </aside>
  );
}
