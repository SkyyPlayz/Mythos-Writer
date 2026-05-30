import type { EntityEntry } from './types';
import './EntityMention.css';

const TYPE_LABELS: Record<string, string> = {
  character: 'Character',
  location: 'Location',
  item: 'Item',
  concept: 'Concept',
  other: 'Other',
};

interface Props {
  entities: EntityEntry[];
  query: string;
  selectedIndex: number;
  onSelect: (entity: EntityEntry) => void;
  style: React.CSSProperties;
}

export function matchesEntityQuery(entity: EntityEntry, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (entity.name.toLowerCase().includes(needle)) return true;
  return (entity.aliases ?? []).some((a) => a.toLowerCase().includes(needle));
}

export function EntityMentionPicker({ entities, query, selectedIndex, onSelect, style }: Props) {
  const filtered = entities.filter((e) => matchesEntityQuery(e, query)).slice(0, 10);

  if (!filtered.length) {
    return (
      <div className="entity-mention-picker" style={style} role="listbox" aria-label="Entity suggestions">
        <div className="entity-mention-picker-empty">
          No entities match &ldquo;{query.trim() || '@'}&rdquo;
        </div>
      </div>
    );
  }

  return (
    <div
      className="entity-mention-picker"
      style={style}
      role="listbox"
      aria-label="Entity suggestions"
    >
      {filtered.map((entity, i) => (
        <div
          key={entity.id}
          role="option"
          aria-selected={i === selectedIndex}
          className={`entity-mention-picker-item${i === selectedIndex ? ' active' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(entity);
          }}
        >
          <span className="entity-mention-picker-name">{entity.name}</span>
          <span className={`entity-mention-picker-type entity-mention--${entity.type}`}>
            {TYPE_LABELS[entity.type] ?? entity.type}
          </span>
        </div>
      ))}
    </div>
  );
}
