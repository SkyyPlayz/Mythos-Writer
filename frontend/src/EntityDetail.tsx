import { useState, useEffect, useCallback } from 'react';
import type { EntityEntry, EntityType } from './types';
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
}

export default function EntityDetail({ entity, onClose, onUpdated, onDeleted }: Props) {
  const [name, setName] = useState(entity.name);
  const [aliases, setAliases] = useState((entity.aliases ?? []).join(', '));
  const [tags, setTags] = useState((entity.tags ?? []).join(', '));
  const [prose, setProse] = useState('');
  const [proseLoading, setProseLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [error, setError] = useState('');

  // Reset form when entity changes
  useEffect(() => {
    setName(entity.name);
    setAliases((entity.aliases ?? []).join(', '));
    setTags((entity.tags ?? []).join(', '));
    setDirty(false);
    setError('');
    setDeleteConfirm(false);
  }, [entity.id]);

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

  const markDirty = useCallback(() => setDirty(true), []);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const aliasList = aliases.split(',').map((a) => a.trim()).filter(Boolean);
      const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
      const updated = await window.api.entityUpdate({
        id: entity.id,
        name: name.trim() || entity.name,
        aliases: aliasList,
        tags: tagList,
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
          <label className="entity-det-label">
            Tags
            <span className="entity-det-hint">comma-separated</span>
          </label>
          <input
            className="entity-det-input"
            type="text"
            value={tags}
            onChange={(e) => { setTags(e.target.value); markDirty(); }}
            placeholder="protagonist, mage…"
          />
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

        <div className="entity-det-meta">
          <span>Created {new Date(entity.createdAt).toLocaleDateString()}</span>
          <span>Updated {new Date(entity.updatedAt).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  );
}
