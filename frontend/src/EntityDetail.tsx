import { useState, useEffect, useCallback, useMemo } from 'react';
import type { EntityEntry, EntityType } from './types';
import TagInput from './TagInput';
import './EntityDetail.css';

const TYPE_LABELS: Record<EntityType, string> = {
  character: 'Character',
  location: 'Location',
  item: 'Item',
  concept: 'Concept',
  other: 'Other',
};

const TYPE_ICONS: Record<EntityType, string> = {
  character: '👤',
  location: '📍',
  item: '💎',
  concept: '💡',
  other: '📄',
};

function extractProse(markdown: string): string {
  const match = markdown.match(/^---[\s\S]*?---\n?([\s\S]*)$/);
  return match ? match[1].trimStart() : markdown;
}

interface Props {
  entity: EntityEntry;
  onClose: () => void;
  onUpdated: (entity: EntityEntry) => void;
  onDeleted: (id: string) => void;
  onOpenScene?: (scenePath: string) => void;
}

export default function EntityDetail({ entity, onClose, onUpdated, onDeleted, onOpenScene }: Props) {
  const [name, setName] = useState(entity.name);
  const [aliases, setAliases] = useState((entity.aliases ?? []).join(', '));
  const [tags, setTags] = useState<string[]>(entity.tags ?? []);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [prose, setProse] = useState('');
  const [proseLoading, setProseLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [error, setError] = useState('');
  const [backlinks, setBacklinks] = useState<EntityBacklinkScene[]>([]);
  const [backlinksOpen, setBacklinksOpen] = useState(true);
  const [backlinksLoading, setBacklinksLoading] = useState(false);

  // Relationships state
  const [relationships, setRelationships] = useState<EntityRelationship[]>([]);
  const [relLoading, setRelLoading] = useState(false);
  const [relOpen, setRelOpen] = useState(true);
  const [allEntities, setAllEntities] = useState<EntityEntry[]>([]);
  const [vaultLabels, setVaultLabels] = useState<string[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addLabel, setAddLabel] = useState('');
  const [addTargetId, setAddTargetId] = useState('');
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState('');

  const entityMap = useMemo<Map<string, EntityEntry>>(
    () => new Map(allEntities.map(e => [e.id, e])),
    [allEntities],
  );

  // Reset form when entity changes
  useEffect(() => {
    setName(entity.name);
    setAliases((entity.aliases ?? []).join(', '));
    setTags(entity.tags ?? []);
    setDirty(false);
    setError('');
    setDeleteConfirm(false);
  }, [entity.id]);

  // Load all tags for autocomplete
  useEffect(() => {
    window.api.tagsList?.().then((r: { tags: Array<{ name: string }> }) => {
      setAllTags(r.tags.map((t) => t.name));
    }).catch(() => {});
  }, []);

  // Load prose from vault file
  useEffect(() => {
    setProseLoading(true);
    (async () => {
      try {
        const result = await window.api.readVault(entity.path);
        setProse(extractProse(result.content));
      } catch {
        setProse('');
      } finally {
        setProseLoading(false);
      }
    })();
  }, [entity.id, entity.path]);

  // Load backlinks whenever entity changes
  const loadBacklinks = useCallback(async () => {
    setBacklinksLoading(true);
    try {
      const result = await window.api.entityBacklinks(entity.id);
      setBacklinks(result.scenes ?? []);
    } catch {
      setBacklinks([]);
    } finally {
      setBacklinksLoading(false);
    }
  }, [entity.id]);

  useEffect(() => {
    loadBacklinks();
  }, [loadBacklinks]);

  // Refresh backlinks when any vault file changes (e.g. a scene is saved)
  useEffect(() => {
    const off = window.api.onVaultFileChanged(() => {
      loadBacklinks();
    });
    return off;
  }, [loadBacklinks]);

  // Load all entities once for relationship row lookups + picker
  useEffect(() => {
    window.api.entityList()
      .then(r => setAllEntities(r.entities ?? []))
      .catch(() => {});
  }, []);

  // Load relationships when entity changes
  const loadRelationships = useCallback(async () => {
    setRelLoading(true);
    try {
      const result = await window.api.entityRelationshipsList(entity.id);
      setRelationships(Array.isArray(result) ? result : []);
    } catch {
      setRelationships([]);
    } finally {
      setRelLoading(false);
    }
  }, [entity.id]);

  useEffect(() => {
    setShowAddForm(false);
    setAddLabel('');
    setAddError('');
    loadRelationships();
  }, [loadRelationships]);

  // Set default target entity when add form opens
  useEffect(() => {
    if (!showAddForm) return;
    const first = allEntities.find(e => e.id !== entity.id);
    if (first && !addTargetId) setAddTargetId(first.id);
  }, [showAddForm, allEntities, entity.id, addTargetId]);

  // Collect vault-wide relationship labels when add form opens
  useEffect(() => {
    if (!showAddForm) return;
    const seen = new Set(relationships.map(r => r.label));
    setVaultLabels(Array.from(seen));
    const others = allEntities.filter(e => e.id !== entity.id);
    if (others.length === 0) return;
    Promise.allSettled(others.map(e => window.api.entityRelationshipsList(e.id)))
      .then(results => {
        results.forEach(r => {
          if (r.status === 'fulfilled' && Array.isArray(r.value)) {
            r.value.forEach((rel: EntityRelationship) => seen.add(rel.label));
          }
        });
        setVaultLabels(Array.from(seen).sort());
      });
  }, [showAddForm, entity.id]);

  const markDirty = useCallback(() => setDirty(true), []);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const aliasList = aliases.split(',').map((a) => a.trim()).filter(Boolean);
      const updated = await window.api.entityUpdate({
        id: entity.id,
        name: name.trim() || entity.name,
        aliases: aliasList,
        tags,
        prose,
      });
      setDirty(false);
      onUpdated(updated);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await window.api.entityDelete(entity.id);
      onDeleted(entity.id);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleAddRelationship = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addLabel.trim() || !addTargetId) return;
    setAddSubmitting(true);
    setAddError('');
    try {
      const newRel = await window.api.entityRelationshipsCreate(entity.id, addTargetId, addLabel.trim());
      setRelationships(prev => [...prev, newRel]);
      setAddLabel('');
      setAddTargetId('');
      setShowAddForm(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setAddError(msg.includes('already exists') ? 'This relationship already exists.' : msg);
    } finally {
      setAddSubmitting(false);
    }
  };

  const handleDeleteRelationship = async (relId: string) => {
    setRelationships(prev => prev.filter(r => r.id !== relId));
    try {
      await window.api.entityRelationshipsDelete(relId);
    } catch {
      loadRelationships();
    }
  };

  const otherEntities = allEntities.filter(e => e.id !== entity.id);

  return (
    <div className="entity-detail">
      <div className="entity-detail-header">
        <div className="entity-detail-header-left">
          <span className="entity-detail-icon">{TYPE_ICONS[entity.type]}</span>
          <span className="entity-detail-type">{TYPE_LABELS[entity.type]}</span>
        </div>
        <div className="entity-detail-header-right">
          {dirty && (
            <button
              className="entity-det-btn entity-det-btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
          {deleteConfirm ? (
            <>
              <button className="entity-det-btn entity-det-btn-danger" onClick={handleDelete}>
                Confirm delete
              </button>
              <button
                className="entity-det-btn entity-det-btn-ghost"
                onClick={() => setDeleteConfirm(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              className="entity-det-btn entity-det-btn-ghost"
              onClick={() => setDeleteConfirm(true)}
              title="Delete entity"
            >
              Delete
            </button>
          )}
          <button className="entity-det-btn entity-det-btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      <div className="entity-detail-body">
        <div className="entity-det-field">
          <label className="entity-det-label">Name</label>
          <input
            className="entity-det-input"
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); markDirty(); }}
          />
        </div>

        <div className="entity-det-field">
          <label className="entity-det-label">
            Aliases
            <span className="entity-det-hint">comma-separated</span>
          </label>
          <input
            className="entity-det-input"
            type="text"
            value={aliases}
            onChange={(e) => { setAliases(e.target.value); markDirty(); }}
            placeholder="Nickname, Alias…"
          />
        </div>

        <div className="entity-det-field">
          <label className="entity-det-label">Tags</label>
          <TagInput value={tags} onChange={(t) => { setTags(t); markDirty(); }} allTags={allTags} />
        </div>

        <div className="entity-det-field entity-det-field-prose">
          <label className="entity-det-label">Notes / Prose</label>
          {proseLoading ? (
            <div className="entity-det-prose-loading">Loading…</div>
          ) : (
            <textarea
              className="entity-det-prose"
              value={prose}
              onChange={(e) => { setProse(e.target.value); markDirty(); }}
              placeholder="Character notes, backstory, description…"
            />
          )}
        </div>

        {error && <div className="entity-det-error">{error}</div>}

        {/* Relationships panel */}
        <div className="entity-det-relationships">
          <button
            className="entity-det-backlinks-header"
            onClick={() => setRelOpen(o => !o)}
            aria-expanded={relOpen}
          >
            <span className="entity-det-backlinks-chevron">{relOpen ? '▾' : '▸'}</span>
            <span className="entity-det-backlinks-title">Relationships</span>
            <span className="entity-det-backlinks-count">
              {relLoading ? '…' : relationships.length}
            </span>
          </button>
          {relOpen && (
            <div className="entity-det-rel-body">
              {relLoading ? (
                <div className="entity-det-backlinks-empty">Loading…</div>
              ) : (
                <>
                  {relationships.length === 0 && !showAddForm ? (
                    <div className="entity-det-rel-empty-state">
                      No relationships yet.{' '}
                      <button
                        className="entity-det-rel-add-link"
                        onClick={() => setShowAddForm(true)}
                      >
                        + Add Relationship
                      </button>
                    </div>
                  ) : (
                    <>
                      {relationships.length > 0 && (
                        <ul className="entity-det-rel-list">
                          {relationships.map(rel => {
                            const otherId = rel.direction === 'outgoing' ? rel.toEntityId : rel.fromEntityId;
                            const other = entityMap.get(otherId);
                            return (
                              <li key={rel.id} className="entity-det-rel-row">
                                {rel.direction === 'outgoing' ? (
                                  <span className="entity-det-rel-desc">
                                    <span className="entity-det-rel-label">{rel.label}</span>
                                    <span className="entity-det-rel-arrow">→</span>
                                    <span className="entity-det-rel-chip">
                                      <span className="entity-det-rel-chip-icon">{TYPE_ICONS[other?.type ?? 'other']}</span>
                                      <span className="entity-det-rel-chip-name">{other?.name ?? otherId}</span>
                                    </span>
                                  </span>
                                ) : (
                                  <span className="entity-det-rel-desc">
                                    <span className="entity-det-rel-arrow entity-det-rel-arrow-in">←</span>
                                    <span className="entity-det-rel-label">{rel.label}</span>
                                    <span className="entity-det-rel-chip">
                                      <span className="entity-det-rel-chip-icon">{TYPE_ICONS[other?.type ?? 'other']}</span>
                                      <span className="entity-det-rel-chip-name">{other?.name ?? otherId}</span>
                                    </span>
                                  </span>
                                )}
                                <button
                                  className="entity-det-rel-delete"
                                  onClick={() => handleDeleteRelationship(rel.id)}
                                  title="Remove relationship"
                                  aria-label="Remove relationship"
                                >
                                  ×
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {!showAddForm && (
                        <button
                          className="entity-det-rel-add-btn"
                          onClick={() => setShowAddForm(true)}
                        >
                          + Add Relationship
                        </button>
                      )}
                    </>
                  )}

                  {showAddForm && (
                    <form className="entity-det-rel-form" onSubmit={handleAddRelationship}>
                      <div className="entity-det-rel-form-row">
                        <input
                          className="entity-det-rel-label-input entity-det-input"
                          type="text"
                          list="rel-labels-datalist"
                          placeholder="Label (e.g. allied with)"
                          value={addLabel}
                          onChange={e => setAddLabel(e.target.value)}
                          autoFocus
                          required
                        />
                        <datalist id="rel-labels-datalist">
                          {vaultLabels.map(l => <option key={l} value={l} />)}
                        </datalist>
                        <select
                          className="entity-det-rel-entity-select entity-det-input"
                          value={addTargetId}
                          onChange={e => setAddTargetId(e.target.value)}
                          required
                        >
                          {otherEntities.length === 0 ? (
                            <option value="" disabled>No other entities</option>
                          ) : (
                            otherEntities.map(e => (
                              <option key={e.id} value={e.id}>
                                {e.name} ({TYPE_LABELS[e.type]})
                              </option>
                            ))
                          )}
                        </select>
                      </div>
                      <div className="entity-det-rel-form-actions">
                        <button
                          type="submit"
                          className="entity-det-btn entity-det-btn-primary"
                          disabled={addSubmitting || !addLabel.trim() || !addTargetId}
                        >
                          {addSubmitting ? 'Adding…' : 'Add'}
                        </button>
                        <button
                          type="button"
                          className="entity-det-btn entity-det-btn-ghost"
                          onClick={() => {
                            setShowAddForm(false);
                            setAddLabel('');
                            setAddError('');
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                      {addError && <div className="entity-det-rel-form-error">{addError}</div>}
                    </form>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Backlinks panel */}
        <div className="entity-det-backlinks">
          <button
            className="entity-det-backlinks-header"
            onClick={() => setBacklinksOpen((o) => !o)}
            aria-expanded={backlinksOpen}
          >
            <span className="entity-det-backlinks-chevron">{backlinksOpen ? '▾' : '▸'}</span>
            <span className="entity-det-backlinks-title">Backlinks</span>
            <span className="entity-det-backlinks-count">
              {backlinksLoading ? '…' : backlinks.length}
            </span>
          </button>
          {backlinksOpen && (
            <div className="entity-det-backlinks-body">
              {backlinksLoading ? (
                <div className="entity-det-backlinks-empty">Scanning scenes…</div>
              ) : backlinks.length === 0 ? (
                <div className="entity-det-backlinks-empty">No scenes mention this entity yet.</div>
              ) : (
                <ul className="entity-det-backlinks-list">
                  {backlinks.map((bl) => (
                    <li key={bl.scenePath} className="entity-det-backlink-item">
                      <button
                        className="entity-det-backlink-scene"
                        onClick={() => onOpenScene?.(bl.scenePath)}
                        title={bl.scenePath}
                        disabled={!onOpenScene}
                      >
                        {bl.sceneTitle || bl.scenePath.split('/').pop()?.replace(/\.md$/, '')}
                      </button>
                      <span className="entity-det-backlink-snippet">{bl.snippet}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="entity-det-meta">
          <span>Created {new Date(entity.createdAt).toLocaleDateString()}</span>
          <span>Updated {new Date(entity.updatedAt).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  );
}
