import React, { useState, useEffect, useCallback, useRef } from 'react';
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

const TYPE_ICONS: Record<EntityType, string> = {
  character: '👤',
  location: '📍',
  faction: '⚔️',
  item: '💎',
  event: '📅',
  concept: '💡',
  other: '📄',
};

interface EntityEmptySpec {
  icon: React.ReactElement;
  headline: string;
  desc: string;
  cta: string;
}

const ENTITY_EMPTY_SPECS: Record<EntityType, EntityEmptySpec> = {
  character: {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
      </svg>
    ),
    headline: 'No characters yet',
    desc: 'Add the people who populate your story.',
    cta: '+ New Character',
  },
  location: {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
        <circle cx="12" cy="10" r="3"/>
      </svg>
    ),
    headline: 'No locations yet',
    desc: 'Add places where your story unfolds.',
    cta: '+ New Location',
  },
  faction: {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
    headline: 'No factions yet',
    desc: 'Add groups, guilds, and organisations.',
    cta: '+ New Faction',
  },
  item: {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="21 8 21 21 3 21 3 8"/>
        <rect x="1" y="3" width="22" height="5"/>
        <line x1="10" y1="12" x2="14" y2="12"/>
      </svg>
    ),
    headline: 'No items yet',
    desc: 'Track objects, artifacts, and key items.',
    cta: '+ New Item',
  },
  event: {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/>
        <line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
    ),
    headline: 'No events yet',
    desc: 'Record key moments and turning points.',
    cta: '+ New Event',
  },
  concept: {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="9" y1="18" x2="15" y2="18"/>
        <line x1="10" y1="22" x2="14" y2="22"/>
        <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14H15.09z"/>
      </svg>
    ),
    headline: 'No concepts yet',
    desc: 'Capture themes, rules, and abstract ideas.',
    cta: '+ New Concept',
  },
  other: {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
        <polyline points="13 2 13 9 20 9"/>
      </svg>
    ),
    headline: 'Nothing here yet',
    desc: 'Create a custom entity for anything else.',
    cta: '+ New Entity',
  },
};

const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

const MAX_NAME_LENGTH = 256;

interface CreateDialogProps {
  defaultType?: EntityType;
  onConfirm: (name: string, type: EntityType, aliases: string[], tags: string[]) => Promise<void>;
  onCancel: () => void;
  existingEntities?: EntityEntry[];
}

function CreateDialog({ defaultType = 'character', onConfirm, onCancel, existingEntities = [] }: CreateDialogProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<EntityType>(defaultType);
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
  onEntityCreated?: (entity: EntityEntry) => void;
}

export default function EntityBrowser({ onSelectEntity, selectedEntityId, onEntityCreated }: Props) {
  const [entities, setEntities] = useState<EntityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<EntityType>>(new Set(TYPE_ORDER));
  const [showCreate, setShowCreate] = useState(false);
  const [createDefaultType, setCreateDefaultType] = useState<EntityType>('character');
  const [activeEmptyType, setActiveEmptyType] = useState<EntityType>('character');
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
    onEntityCreated?.(created);
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

  const hasAny = entities.length > 0;

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

      {!hasAny && (
        <div className="entity-empty">
          <div className="entity-empty-tabs" role="tablist" aria-label="Entity type">
            {TYPE_ORDER.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={activeEmptyType === t}
                className={`entity-empty-tab${activeEmptyType === t ? ' active' : ''}`}
                onClick={() => setActiveEmptyType(t)}
              >
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>
          <div className="entity-empty-icon-svg">{ENTITY_EMPTY_SPECS[activeEmptyType].icon}</div>
          <p className="entity-empty-headline">{ENTITY_EMPTY_SPECS[activeEmptyType].headline}</p>
          <p className="entity-empty-sub">{ENTITY_EMPTY_SPECS[activeEmptyType].desc}</p>
          <button
            className="entity-btn entity-btn-primary entity-btn-sm entity-empty-cta"
            onClick={() => { setCreateDefaultType(activeEmptyType); setShowCreate(true); }}
          >
            {ENTITY_EMPTY_SPECS[activeEmptyType].cta}
          </button>
        </div>
      )}

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
          defaultType={createDefaultType}
          onConfirm={handleCreate}
          onCancel={() => { setShowCreate(false); createBtnRef.current?.focus(); }}
          existingEntities={entities}
        />
      )}
    </div>
  );
}

