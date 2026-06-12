import type { EntityEntry } from './types';

export function matchesEntityQuery(entity: EntityEntry, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (entity.name.toLowerCase().includes(q)) return true;
  if (entity.aliases) {
    for (const alias of entity.aliases) {
      if (alias.toLowerCase().includes(q)) return true;
    }
  }
  return false;
}

const TYPE_LABELS: Record<string, string> = {
  character: 'Char',
  location: 'Loc',
  item: 'Item',
  concept: 'Concept',
  other: 'Other',
};

interface Props {
  entities: EntityEntry[];
  query: string;
  top: number;
  left: number;
  selectedIndex: number;
  onSelect: (entity: EntityEntry) => void;
}

export default function EntityMentionPicker({ entities, query, top, left, selectedIndex, onSelect }: Props) {
  const filtered = entities.filter((e) => matchesEntityQuery(e, query)).slice(0, 10);
  if (filtered.length === 0) return null;

  return (
    <ul
      className="entity-mention-picker"
      style={{ top, left }}
      role="listbox"
      aria-label="Entity suggestions"
    >
      {filtered.map((entity, i) => (
        <li
          key={entity.id}
          className={`entity-mention-picker-item${i === selectedIndex ? ' selected' : ''}`}
          role="option"
          aria-selected={i === selectedIndex}
          // mousedown (not click) so the editor doesn't lose focus before we insert
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(entity);
          }}
        >
          <span className="entity-mention-picker-name">{entity.name}</span>
          <span className="entity-mention-picker-type">
            {TYPE_LABELS[entity.type] ?? entity.type}
          </span>
        </li>
      ))}
    </ul>
  );
}
