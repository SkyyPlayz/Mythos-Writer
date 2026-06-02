import type { EntityEntry, EntityType } from './types';

const TYPE_LABELS: Record<EntityType, string> = {
  character: 'Character',
  location: 'Location',
  faction: 'Faction',
  item: 'Item',
  event: 'Event',
  concept: 'Concept',
  other: 'Other',
};

interface Props {
  entities: EntityEntry[];
  selectedIndex: number;
  onSelect: (entity: EntityEntry) => void;
  style: React.CSSProperties;
}

/** Case-insensitive substring match against name and aliases. Empty query matches all. */
export function matchesEntityQuery(entity: EntityEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (entity.name.toLowerCase().includes(q)) return true;
  return (entity.aliases ?? []).some((a) => a.toLowerCase().includes(q));
}

export function EntityMentionPicker({ entities, selectedIndex, onSelect, style }: Props) {
  if (entities.length === 0) return null;

  return (
    <ul
      className="entity-mention-picker"
      role="listbox"
      aria-label="Entity mentions"
      style={style}
    >
      {entities.map((entity, idx) => (
        <li
          key={entity.id}
          role="option"
          aria-selected={idx === selectedIndex}
          className={`entity-mention-picker-item${idx === selectedIndex ? ' selected' : ''}`}
          // mousedown instead of click so we don't lose editor focus before insertion
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(entity);
          }}
        >
          <span className="entity-mention-picker-name">{entity.name}</span>
          <span className={`entity-mention-picker-type entity-mention--${entity.type}`}>
            {TYPE_LABELS[entity.type] ?? 'Other'}
          </span>
        </li>
      ))}
    </ul>
  );
}
