import { useState, useEffect, useCallback, useRef } from 'react';
import type { EntityEntry, EntityType } from './types';
import { NodeIcon } from './NodeIcon';
import './EntityBrowser.css';

// The 6 canonical display types; 'other' is kept in EntityType for data compat only.
const TYPE_ORDER: EntityType[] = ['character', 'location', 'faction', 'item', 'event', 'concept'];

const TYPE_LABELS: Record<EntityType, string> = {
  character: 'Characters',
  location: 'Locations',
  faction: 'Factions',
  item: 'Items',
  event: 'Events',
  concept: 'Concepts',
  other: 'Other',
};

const TYPE_SINGULAR: Record<EntityType, string> = {
  character: 'Character',
  location: 'Location',
  faction: 'Faction',
  item: 'Item',
  event: 'Event',
  concept: 'Concept',
  other: 'Other',
};

const TYPE_ICONS: Record<EntityType, string> = {
  character: '👤',
  location: '📍',
  faction: '⚔️',
  item: '💎',
  event: '📅',
  concept: '💡',
  other: '📄',
};

interface TypePickerProps {
  onSelect: (type: EntityType) => void;
  onClose: () => void;
}

function TypePickerPopover({ onSelect, onClose }: TypePickerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={ref} className="entity-type-picker" role="menu" aria-label="Choose entity type">
      {TYPE_ORDER.map((t) => (
        <button
          key={t}
          className="entity-type-picker-item"
          role="menuitem"
          onClick={() => onSelect(t)}
        >
          <span className="entity-type-picker-icon">{TYPE_ICONS[t]}</span>
          <span className="entity-type-picker-label">{TYPE_SINGULAR[t]}</span>
        </button>
      ))}
    </div>
  );
}

interface Props {
  onSelectEntity: (entity: EntityEntry) => void;
  selectedEntityId?: string | null;
}

export default function EntityBrowser({ onSelectEntity, selectedEntityId }: Props) {
  const [entities, setEntities] = useState<EntityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<EntityType>>(new Set(TYPE_ORDER));
  const [showPicker, setShowPicker] = useState(false);
  const [creating, setCreating] = useState<EntityType | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const createBtnRef = useRef<HTMLButtonElement>(null);

  const loadEntities = useCallback(async () => {
    try {
      const result = await window.api.entityList();
      setEntities(result.entities);
    } catch {
      // vault not ready
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadEntities(); }, [loadEntities]);

  const toggleType = (type: EntityType) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });

  const quickCreate = useCallback(async (type: EntityType) => {
    setCreating(type);
    setShowPicker(false);
    try {
      const name = `New ${TYPE_SINGULAR[type]}`;
      const created = await window.api.entityCreate({
        name,
        type,
        aliases: [],
        tags: [],
      });
      await loadEntities();
      onSelectEntity(created);
      // SKY-324: fire-and-forget — brainstorm agent generates a description for
      // this entry and writes it to the Notes Vault in the background.
      // Non-blocking; failures are silently swallowed here (the agent itself logs).
      void window.api.brainstormEnrichEntry({ name, type }).catch(() => undefined);
    } catch {
      // creation failed; leave browser as-is
    } finally {
      setCreating(null);
    }
  }, [loadEntities, onSelectEntity]);

  const handleDelete = async (id: string) => {
    await window.api.entityDelete(id);
    setDeleteConfirm(null);
    await loadEntities();
  };

  if (loading) return <div className="entity-loading">Loading entities…</div>;

  const grouped = TYPE_ORDER.reduce<Record<EntityType, EntityEntry[]>>(
    (acc, t) => { acc[t] = entities.filter((e) => e.type === t); return acc; },
    {} as Record<EntityType, EntityEntry[]>
  );

  return (
    <div className="entity-browser">
      <div className="entity-browser-toolbar">
        <div className="entity-browser-toolbar-inner">
          <button
            ref={createBtnRef}
            className="entity-btn entity-btn-primary entity-btn-sm"
            onClick={() => setShowPicker((v) => !v)}
            disabled={!!creating}
            aria-haspopup="menu"
            aria-expanded={showPicker}
          >
            {creating ? 'Creating…' : '+ New Entity'}
          </button>
          {showPicker && (
            <TypePickerPopover
              onSelect={quickCreate}
              onClose={() => { setShowPicker(false); createBtnRef.current?.focus(); }}
            />
          )}
        </div>
      </div>

      {TYPE_ORDER.map((type) => {
        const items = grouped[type];
        return (
          <div key={type} className="entity-group">
            <button
              className="entity-group-header"
              onClick={() => toggleType(type)}
              aria-expanded={expanded.has(type)}
            >
              <span className="entity-chevron">{expanded.has(type) ? '▾' : '▸'}</span>
              <span className="entity-group-icon">{TYPE_ICONS[type]}</span>
              <span className="entity-group-name">{TYPE_LABELS[type]}</span>
              <span className="entity-count">{items.length}</span>
            </button>
            {expanded.has(type) && (
              <div className="entity-items">
                {items.length === 0 ? (
                  <div className="entity-group-empty">
                    <span className="entity-group-empty-text">
                      No {TYPE_SINGULAR[type].toLowerCase()}s yet
                    </span>
                    <button
                      className="entity-group-add-link"
                      onClick={() => quickCreate(type)}
                      disabled={!!creating}
                    >
                      + Add
                    </button>
                  </div>
                ) : (
                  items.map((entity) => (
                    <div
                      key={entity.id}
                      className={`entity-item${entity.id === selectedEntityId ? ' selected' : ''}`}
                    >
                      <button
                        className="entity-item-select"
                        onClick={() => onSelectEntity(entity)}
                        aria-pressed={entity.id === selectedEntityId}
                      >
                        <span className="entity-item-icon" aria-hidden="true">
                          <NodeIcon icon={entity.properties?.icon as string | undefined} fallback={TYPE_ICONS[type]} />
                        </span>
                        <span className="entity-item-name">{entity.name}</span>
                      </button>
                      {deleteConfirm === entity.id ? (
                        <span className="entity-delete-confirm">
                          <button
                            className="entity-btn-danger-sm"
                            onClick={() => handleDelete(entity.id)}
                          >
                            Delete
                          </button>
                          <button
                            className="entity-btn-ghost-sm"
                            onClick={() => setDeleteConfirm(null)}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          className="entity-item-delete"
                          aria-label="Delete entity"
                          title="Delete entity"
                          onClick={() => setDeleteConfirm(entity.id)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
