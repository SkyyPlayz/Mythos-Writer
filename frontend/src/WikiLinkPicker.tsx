import type { WikiLinkCandidate } from './crossTabLinkResolver';

export type { WikiLinkCandidate };

export type WikiLinkPickerItem =
  | { type: 'candidate'; candidate: WikiLinkCandidate }
  | { type: 'create'; title: string };

const KIND_LABELS: Record<string, string> = {
  scene: 'Scene',
  character: 'Character',
  location: 'Location',
  faction: 'Faction',
  item: 'Item',
  event: 'Event',
  concept: 'Concept',
  other: 'Note',
};

const MAX_RESULTS = 8;

/** Case-insensitive substring match against a candidate's title (SKY-5702). */
export function matchesWikiLinkQuery(candidate: WikiLinkCandidate, query: string): boolean {
  if (!query.trim()) return false;
  return candidate.title.toLowerCase().includes(query.trim().toLowerCase());
}

/**
 * Filter candidates by query (client-side, synchronous — see
 * `buildWikiLinkCandidates` for why this isn't backed by the FTS search
 * index) and append a trailing "create new" option (Obsidian-style) so an
 * unresolved title is always one Enter-press away. Deduped against an
 * exact-title match so re-selecting an existing note never offers to
 * "create" a duplicate.
 */
export function buildWikiLinkPickerItems(candidates: WikiLinkCandidate[], query: string): WikiLinkPickerItem[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const matched = candidates.filter((c) => matchesWikiLinkQuery(c, trimmed));
  const items: WikiLinkPickerItem[] = matched
    .slice(0, MAX_RESULTS)
    .map((candidate) => ({ type: 'candidate' as const, candidate }));

  const exactMatch = matched.some((c) => c.title.toLowerCase() === trimmed.toLowerCase());
  if (!exactMatch) {
    items.push({ type: 'create', title: trimmed });
  }
  return items;
}

interface Props {
  items: WikiLinkPickerItem[];
  query: string;
  top: number;
  left: number;
  selectedIndex: number;
  onSelect: (item: WikiLinkPickerItem) => void;
}

export default function WikiLinkPicker({ items, query, top, left, selectedIndex, onSelect }: Props) {
  return (
    <ul
      className="wiki-link-picker"
      style={{ top, left }}
      role="listbox"
      aria-label="Wiki link suggestions"
    >
      {!query.trim() || items.length === 0 ? (
        <li className="wiki-link-picker-empty">Type to search notes and story scenes…</li>
      ) : (
        items.map((item, i) => {
          const key = item.type === 'candidate' ? item.candidate.key : `create:${item.title}`;
          const selected = i === selectedIndex;
          return (
            <li
              key={key}
              className={`wiki-link-picker-item${selected ? ' selected' : ''}${item.type === 'create' ? ' wiki-link-picker-item--create' : ''}`}
              role="option"
              aria-selected={selected}
              // mousedown (not click) so the editor doesn't lose focus before we insert
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(item);
              }}
            >
              {item.type === 'candidate' ? (
                <>
                  <span className="wiki-link-picker-title">{item.candidate.title}</span>
                  <span className="wiki-link-picker-kind">
                    {KIND_LABELS[item.candidate.kind] ?? item.candidate.kind}
                  </span>
                </>
              ) : (
                <>
                  <span className="wiki-link-picker-title">{item.title}</span>
                  <span className="wiki-link-picker-kind wiki-link-picker-kind--create">New</span>
                </>
              )}
            </li>
          );
        })
      )}
    </ul>
  );
}
