interface EntityResult {
  name: string;
  aliases: string[];
  type: string | null;
  path: string;
  excerpt: string;
}

function typeBadgeClass(type: string | null): string {
  switch ((type ?? '').toLowerCase()) {
    case 'character': return 'entity-type-badge--character';
    case 'location':  return 'entity-type-badge--location';
    case 'item':      return 'entity-type-badge--item';
    case 'faction':   return 'entity-type-badge--faction';
    default:          return type ? 'entity-type-badge--other' : 'entity-type-badge--default';
  }
}

interface Props {
  entity: EntityResult;
  onClick?: (entity: EntityResult) => void;
  onOpenEntityNote?: (path: string) => void;
}

export default function EntityCard({ entity, onClick, onOpenEntityNote }: Props) {
  return (
    <div
      className="entity-card"
      role="article"
      aria-label={entity.name}
      tabIndex={0}
      onClick={() => onClick?.(entity)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(entity); } }}
    >
      <div className="entity-card-header">
        <span className="entity-card-name">{entity.name}</span>
        {entity.type && (
          <span className={`entity-type-badge ${typeBadgeClass(entity.type)}`} aria-label={`Type: ${entity.type}`}>
            {entity.type}
          </span>
        )}
      </div>
      {entity.aliases.length > 0 && (
        <div className="entity-card-aliases" aria-label="Also known as">
          a.k.a. {entity.aliases.join(', ')}
        </div>
      )}
      {entity.excerpt && (
        <div className="entity-card-excerpt">{entity.excerpt}</div>
      )}
      <button
        type="button"
        className="entity-card-view-note"
        aria-label={`View full note: ${entity.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onOpenEntityNote?.(entity.path);
        }}
      >
        View full note
      </button>
    </div>
  );
}
