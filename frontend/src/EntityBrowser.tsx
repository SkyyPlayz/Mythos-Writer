import { useState, useEffect, useCallback } from 'react';
import type { EntityEntry, EntityType } from './types';
import './EntityBrowser.css';

const TYPE_LABELS: Record<EntityType, string> = {
  character: 'Characters',
  location: 'Locations',
  item: 'Items',
  concept: 'Concepts',
  other: 'Other',
};

const TYPE_ORDER: EntityType[] = ['character', 'location', 'item', 'concept', 'other'];

const TYPE_ICONS: Record<EntityType, string> = {
  character: '👤',
  location: '📍',
  item: '💎',
  concept: '💡',
  other: '📄',
};

interface CreateDialogProps {
  onConfirm: (name: string, type: EntityType, aliases: string[], tags: string[]) => Promise<void>;
  onCancel: () => void;
}

function CreateDialog({ onConfirm, onCancel }: CreateDialogProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<EntityType>('character');
  const [aliases, setAliases] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setError('Name is required.'); return; }
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

  return (
    <div className="entity-dialog-overlay" onClick={onCancel}>
      <div className="entity-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="entity-dialog-header">New Entity</div>
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
  const [expanded, setExpanded] = useState<Set<EntityType>>(
    new Set<EntityType>(['character', 'location', 'item', 'concept', 'other'])
  );
  const [showCreate, setShowCreate] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

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
    await loadEntities();
    onSelectEntity(created);
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

  const hasAny = entities.length > 0;

  return (
    <div className="entity-browser">
      <div className="entity-browser-toolbar">
        <button className="entity-btn entity-btn-primary entity-btn-sm" onClick={() => setShowCreate(true)}>
          + New Entity
        </button>
      </div>

      {!hasAny && (
        <div className="entity-empty">
          <div className="entity-empty-icon">🗃️</div>
          <p>No entities yet.</p>
          <p className="entity-empty-sub">Create characters, locations, and items to track your world.</p>
        </div>
      )}

      {TYPE_ORDER.map((type) => {
        const items = grouped[type];
        if (items.length === 0) return null;
        return (
          <div key={type} className="entity-group">
            <div className="entity-group-header" onClick={() => toggleType(type)}>
              <span className="entity-chevron">{expanded.has(type) ? '▾' : '▸'}</span>
              <span className="entity-group-icon">{TYPE_ICONS[type]}</span>
              <span className="entity-group-name">{TYPE_LABELS[type]}</span>
              <span className="entity-count">{items.length}</span>
            </div>
            {expanded.has(type) && (
              <div className="entity-items">
                {items.map((entity) => (
                  <div
                    key={entity.id}
                    className={`entity-item${entity.id === selectedEntityId ? ' selected' : ''}`}
                    onClick={() => onSelectEntity(entity)}
                  >
                    <span className="entity-item-name">{entity.name}</span>
                    {deleteConfirm === entity.id ? (
                      <span className="entity-delete-confirm">
                        <button
                          className="entity-btn-danger-sm"
                          onClick={(e) => { e.stopPropagation(); handleDelete(entity.id); }}
                        >
                          Delete
                        </button>
                        <button
                          className="entity-btn-ghost-sm"
                          onClick={(e) => { e.stopPropagation(); setDeleteConfirm(null); }}
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        className="entity-item-delete"
                        title="Delete entity"
                        onClick={(e) => { e.stopPropagation(); setDeleteConfirm(entity.id); }}
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
          onCancel={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
