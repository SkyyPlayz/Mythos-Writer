import { useState, useEffect, useCallback } from 'react';
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
  const [relationships, setRelationships] = useState<EntityRelationshipRow[]>([]);
  const [relsOpen, setRelsOpen] = useState(true);
  const [relsLoading, setRelsLoading] = useState(false);
  const [allLabels, setAllLabels] = useState<string[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addLabel, setAddLabel] = useState('');
  const [addTargetId, setAddTargetId] = useState('');
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [allEntities, setAllEntities] = useState<EntityEntry[]>([]);

  // Reset form when entity changes
  useEffect(() => {
    setName(entity.name);
    setAliases((entity.aliases ?? []).join(', '));
    setTags(entity.tags ?? []);
    setDirty(false);
    setError('');
    setDeleteConfirm(false);
    setShowAddForm(false);
    setAddLabel('');
    setAddTargetId('');
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

  // Load relationships and all vault entities for the picker
  const loadRelationships = useCallback(async () => {
    setRelsLoading(true);
    try {
      const [relsResult, entitiesResult] = await Promise.all([
        window.api.entityRelationshipsList(entity.id),
        window.api.entityList(),
      ]);
      setRelationships(relsResult.relationships ?? []);
      setAllLabels(relsResult.allLabels ?? []);
      setAllEntities((entitiesResult.entities ?? []).filter((e) => e.id !== entity.id));
    } catch {
      setRelationships([]);
    } finally {
      setRelsLoading(false);
    }
  }, [entity.id]);

  useEffect(() => {
    loadRelationships();
  }, [loadRelationships]);

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

  const handleAddRelationship = async () => {
    if (!addLabel.trim() || !addTargetId) return;
    setAddSubmitting(true);
    try {
      const result = await window.api.entityRelationshipsCreate(entity.id, addTargetId, addLabel.trim());
      setRelationships((prev) => [...prev, result.relationship]);
      setAllLabels((prev) => (prev.includes(result.relationship.label) ? prev : [...prev, result.relationship.label].sort()));
      setAddLabel('');
      setAddTargetId('');
      setShowAddForm(false);
    } catch {
      // ignore — keep form open
    } finally {
      setAddSubmitting(false);
    }
  };

  const handleDeleteRelationship = async (relId: string) => {
    setRelationships((prev) => prev.filter((r) => r.id !== relId));
    try {
      await window.api.entityRelationshipsDelete(relId);
    } catch {
      // reload on failure to restore correct state
      loadRelationships();
    }
  };

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
            className="entity-det-rel-header"
            onClick={() => setRelsOpen((o) => !o)}
            aria-expanded={relsOpen}
          >
            <span className="entity-det-rel-chevron">{relsOpen ? '▾' : '▸'}</span>
            <span className="entity-det-rel-title">Relationships</span>
            <span className="entity-det-rel-count">
              {relsLoading ? '…' : relationships.length}
            </span>
          </button>
          {relsOpen && (
            <div className="entity-det-rel-body">
              {relsLoading ? (
                <div className="entity-det-rel-empty">Loading…</div>
              ) : relationships.length === 0 && !showAddForm ? (
                <div className="entity-det-rel-empty">
                  No relationships yet.{' '}
                  <button className="entity-det-rel-add-link" onClick={() => setShowAddForm(true)}>
                    + Add Relationship
                  </button>
                </div>
              ) : (
                <>
                  <ul className="entity-det-rel-list">
                    {relationships.map((rel) => (
                      <li key={rel.id} className="entity-det-rel-row">
                        {rel.direction === 'outgoing' ? (
                          <>
                            <span className="entity-det-rel-label">{rel.label}</span>
                            <span className="entity-det-rel-arrow">→</span>
                            <span className="entity-det-rel-chip">
                              {TYPE_ICONS[rel.otherEntityType]}{' '}{rel.otherEntityName}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="entity-det-rel-arrow">←</span>
                            <span className="entity-det-rel-label">{rel.label}</span>
                            <span className="entity-det-rel-chip">
                              {TYPE_ICONS[rel.otherEntityType]}{' '}{rel.otherEntityName}
                            </span>
                          </>
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
                    ))}
                  </ul>
                  {!showAddForm && (
                    <button className="entity-det-rel-add-row" onClick={() => setShowAddForm(true)}>
                      + Add Relationship
                    </button>
                  )}
                </>
              )}
              {showAddForm && (
                <div className="entity-det-rel-form">
                  <input
                    className="entity-det-rel-form-label"
                    type="text"
                    placeholder="Label (e.g. allied with)"
                    value={addLabel}
                    onChange={(e) => setAddLabel(e.target.value)}
                    list="entity-det-rel-labels"
                    autoFocus
                  />
                  <datalist id="entity-det-rel-labels">
                    {allLabels.map((l) => <option key={l} value={l} />)}
                  </datalist>
                  <select
                    className="entity-det-rel-form-target"
                    value={addTargetId}
                    onChange={(e) => setAddTargetId(e.target.value)}
                  >
                    <option value="">— pick entity —</option>
                    {allEntities.map((e) => (
                      <option key={e.id} value={e.id}>
                        {TYPE_ICONS[e.type]} {e.name}
                      </option>
                    ))}
                  </select>
                  <div className="entity-det-rel-form-actions">
                    <button
                      className="entity-det-btn entity-det-btn-primary"
                      onClick={handleAddRelationship}
                      disabled={!addLabel.trim() || !addTargetId || addSubmitting}
                    >
                      {addSubmitting ? 'Adding…' : 'Add'}
                    </button>
                    <button
                      className="entity-det-btn entity-det-btn-ghost"
                      onClick={() => { setShowAddForm(false); setAddLabel(''); setAddTargetId(''); }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
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
