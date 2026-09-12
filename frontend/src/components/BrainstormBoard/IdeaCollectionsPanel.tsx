// Beta 4 / M20 — left IDEA COLLECTIONS panel (§7.2).
//
// Collapsible groups over the agent's captured ideas + the preloaded starter
// library (prototype bsCollections / bsPool). Search filters rows AND
// auto-expands groups with matches; `+` places an idea on the board, `✓`
// (dimmed) marks ideas already placed.

import { useMemo, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
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

/**
 * SKY-11192 §3: the unified-board filing mode.
 *
 * When present, a row's trailing control is a LABELLED `File` button instead
 * of a bare `+` glyph — the action now creates a real vault note (and may
 * create a folder), and a consequence that real deserves a word, not an icon.
 *
 * `onFile` receives the click event itself, deliberately: the write path
 * behind it will not run without a trusted user gesture minted from that
 * event, which is how the "never filed by an agent" constraint is enforced.
 * See `useIdeaFiling.ts`.
 */
export interface IdeaFilingMode {
  isFiled: (idea: CollectionIdea) => boolean;
  /** Key of the idea currently being written — renders `Filing…`. */
  filingKey: string | null;
  onFile: (event: ReactMouseEvent, idea: CollectionIdea) => void;
  /** Open the filed note's board and bring the card into view. */
  onOpen: (idea: CollectionIdea) => void;
}

interface Props {
  pool: CollectionIdea[];
  /** Lowercase titles of cards already placed on the board. */
  placedTitles: ReadonlySet<string>;
  onPlace: (idea: CollectionIdea) => void;
  showToast: (message: string) => void;
  /** R11: true when the master AI toggle is off — Agent Chat is unreachable,
   * so the footer copy shouldn't promise a chat-driven capture flow. */
  manualOnly?: boolean;
  /** SKY-11192: set when the unified-board flag is on. Absent = legacy `+`. */
  filing?: IdeaFilingMode;
}

interface GroupDef {
  key: string;
  label: string;
  dot: string;
  ideas: CollectionIdea[];
}

export default function IdeaCollectionsPanel({ pool, placedTitles, onPlace, showToast, manualOnly, filing }: Props) {
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
                const starter = idea.chips[0] === 'Starter';

                // SKY-11192 §3: the unified-board row. The whole row is no
                // longer one big button — a `Filed` row carries an `Open`
                // link beside the status, and nesting those inside a button
                // would be invalid and unreachable by keyboard.
                if (filing) {
                  const filed = filing.isFiled(idea);
                  const busy = filing.filingKey === idea.key;
                  return (
                    <div
                      key={`${group.key}-${idea.key}`}
                      className={`bs-coll-idea bs-coll-idea--row${filed ? ' bs-coll-idea--placed' : ''}`}
                      data-testid="bs-coll-idea-row"
                      data-idea-title={idea.title}
                    >
                      <span className="bs-coll-idea-main">
                        <span className="bs-coll-idea-title">
                          {idea.title}
                          {starter && <span className="bs-coll-starter-chip">Starter</span>}
                        </span>
                        <span className="bs-coll-idea-desc">{idea.desc}</span>
                      </span>
                      {filed ? (
                        <span className="bs-coll-filed-group">
                          {/* Text, not a bare checkmark glyph — a screen
                              reader should hear the state, not "tick". */}
                          <span className="bs-coll-filed" data-testid="bs-coll-filed">Filed ✓</span>
                          <button
                            type="button"
                            className="bs-coll-open"
                            data-testid="bs-coll-open"
                            onClick={() => filing.onOpen(idea)}
                          >
                            Open
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="bs-coll-file"
                          data-testid="bs-coll-file"
                          disabled={busy}
                          aria-label={`File ${idea.title} into your notes`}
                          // The event object is the point: the write path
                          // refuses to run without a trusted gesture from it.
                          onClick={(e) => filing.onFile(e, idea)}
                        >
                          {busy ? 'Filing…' : 'File'}
                        </button>
                      )}
                    </div>
                  );
                }

                const placed = placedTitles.has(idea.title.trim().toLowerCase());
                return (
                  <button
                    key={`${group.key}-${idea.key}`}
                    type="button"
                    className={`bs-coll-idea${placed ? ' bs-coll-idea--placed' : ''}`}
                    title={placed ? 'Already on the Idea Board' : 'Add to the Idea Board'}
                    aria-label={placed
                      ? `${idea.title} — already on the Idea Board`
                      : `Add ${idea.title} to the Idea Board`}
                    onClick={() => {
                      if (placed) {
                        showToast(`“${idea.title}” is already on the Idea Board`);
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
        {filing
          ? 'Click File to save an idea as a note in your vault — Plot & Story, Characters, or Worldbuilding.'
          : manualOnly
            ? 'Click + to place an idea on the Idea Board, or add one straight from the Idea Board with + Idea.'
            : 'Ideas the agent captures in chat land in your Notes Vault and appear here — click + to place one on the Idea Board.'}
      </div>
    </aside>
  );
}
