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

const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

const MAX_NAME_LENGTH = 256;

interface CreateDialogProps {
  onConfirm: (name: string, type: EntityType, aliases: string[], tags: string[]) => Promise<void>;
  onCancel: () => void;
  existingEntities?: EntityEntry[];
}

function CreateDialog({ onConfirm, onCancel, existingEntities = [] }: CreateDialogProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<EntityType>('character');
  const [aliases, setAliases] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  const isDuplicate = (testName: string, testType: EntityType): boolean => {
    return existingEntities.some((e) => e.type === testType && e.name === testName);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setError('Name is required.'); return; }
    if (trimmed.length > MAX_NAME_LENGTH) {
      setError(`Name must be ${MAX_NAME_LENGTH} characters or less.`);
      return;
    }
    if (isDuplicate(trimmed, type)) { setError('An entity with this name already exists in this type.'); return; }
    setSaving(true);
    try {
      const aliasList = aliases.split(',').map((a) => a.trim()).filter(Boolean);
      const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
      await onConfirm(trimmed, type, aliasList, tagList);
    } catch (err) {
      setError(String(err));
      setSaving(false);
    }
  };

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { onCancel(); return; }
    if (e.key === 'Tab' && dialogRef.current) {
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
  }, [onCancel]);

  return (
    <div className="entity-dialog-overlay" onClick={onCancel}>
      <div
        ref={dialogRef}
        className="entity-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-entity-title"
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
      >
        <div id="create-entity-title" className="entity-dialog-header">New Entity</div>
        <form onSubmit={handleSubmit} className="entity-dialog-form">
          <label className="entity-dialog-label">
            Type
            <select
              className="entity-dialog-select"
              value={type}
              onChange={(e) => setType(e.target.value as EntityType)}
            >
              {TYPE_ORDER.map((t) => (
                <option key={t} value={t}>{TYPE_LABELS[t]}</option>
              ))}
            </select>
          </label>
          <label className="entity-dialog-label">
            Name *
            <input
              className="entity-dialog-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Aria Voss"
              autoFocus
            />
          </label>
          <label className="entity-dialog-label">
            Aliases <span className="entity-dialog-hint">(comma-separated)</span>
            <input
              className="entity-dialog-input"
              type="text"
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              placeholder="Aria, The Weaver"
            />
          </label>
          <label className="entity-dialog-label">
            Tags <span className="entity-dialog-hint">(comma-separated)</span>
            <input
              className="entity-dialog-input"
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="protagonist, mage"
            />
          </label>
          {error && <div className="entity-dialog-error">{error}</div>}
          <div className="entity-dialog-actions">
            <button type="button" className="entity-btn entity-btn-ghost" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="entity-btn entity-btn-primary" disabled={saving}>
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
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
  const [showCreate, setShowCreate] = useState(false);
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

  const handleCreate = async (
    name: string,
    type: EntityType,
    aliases: string[],
    tags: string[]
  ) => {
    const created = await window.api.entityCreate({ name, type, aliases, tags });
    setShowCreate(false);
    createBtnRef.current?.focus();
    await loadEntities();
    onSelectEntity(created);
    // SKY-324: fire-and-forget — brainstorm agent generates a description for
    // this entry and writes it to the Notes Vault in the background.
    void window.api.brainstormEnrichEntry({ name, type }).catch(() => undefined);
  };

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
            onClick={() => setShowCreate(true)}
          >
            + New Entity
          </button>
        </div>
      </div>

      {TYPE_ORDER.map((type) => {
        const items = grouped[type];
        if (items.length === 0) return null;
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
                {items.map((entity) => (
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
                ))}
              </div>
            )}
          </div>
        );
      })}

      {showCreate && (
        <CreateDialog
          onConfirm={handleCreate}
          onCancel={() => { setShowCreate(false); createBtnRef.current?.focus(); }}
          existingEntities={entities}
        />
      )}
    </div>
  );
}

export { TYPE_SINGULAR };
