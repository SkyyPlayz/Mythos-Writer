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
  const [linkedScenes, setLinkedScenes] = useState<LinkedScene[]>([]);
  const [linkedScenesOpen, setLinkedScenesOpen] = useState(true);
  const [linkedScenesLoading, setLinkedScenesLoading] = useState(false);

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

  // Load linked scenes whenever entity changes
  const loadLinkedScenes = useCallback(async () => {
    setLinkedScenesLoading(true);
    try {
      const result = await window.api.entityLinkedScenes(entity.id);
      setLinkedScenes(result.scenes ?? []);
    } catch {
      setLinkedScenes([]);
    } finally {
      setLinkedScenesLoading(false);
    }
  }, [entity.id]);

  useEffect(() => {
    loadLinkedScenes();
  }, [loadLinkedScenes]);

  // Refresh backlinks + linked scenes when any vault file changes (e.g. a scene is saved)
  useEffect(() => {
    const off = window.api.onVaultFileChanged(() => {
      loadBacklinks();
      loadLinkedScenes();
    });
    return off;
  }, [loadBacklinks, loadLinkedScenes]);

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

        {/* Linked Scenes panel */}
        <div className="entity-det-linked-scenes">
          <button
            className="entity-det-linked-scenes-header"
            onClick={() => setLinkedScenesOpen((o) => !o)}
            aria-expanded={linkedScenesOpen}
          >
            <span className="entity-det-linked-scenes-chevron">{linkedScenesOpen ? '▾' : '▸'}</span>
            <span className="entity-det-linked-scenes-title">Linked Scenes</span>
            <span className="entity-det-linked-scenes-count">
              {linkedScenesLoading ? '…' : linkedScenes.length}
            </span>
          </button>
          {linkedScenesOpen && (
            <div className="entity-det-linked-scenes-body">
              {linkedScenesLoading ? (
                <div className="entity-det-linked-scenes-empty">Loading…</div>
              ) : linkedScenes.length === 0 ? (
                <div
                  className="entity-det-linked-scenes-empty"
                  title={`Mention this entity in a scene using @${entity.name}`}
                >
                  No scenes link to this entity yet.
                </div>
              ) : (
                <ul className="entity-det-linked-scenes-list">
                  {linkedScenes.map((ls) => (
                    <li key={ls.sceneId} className="entity-det-linked-scene-item">
                      <span className="entity-det-linked-scene-breadcrumb">
                        Ch. {ls.chapterOrder + 1}
                      </span>
                      <span className="entity-det-linked-scene-sep"> / </span>
                      <span className="entity-det-linked-scene-name">
                        &ldquo;{ls.sceneTitle || ls.scenePath.split('/').pop()?.replace(/\.md$/, '')}&rdquo;
                      </span>
                      <button
                        className="entity-det-linked-scene-open"
                        onClick={() => onOpenScene?.(ls.scenePath)}
                        disabled={!onOpenScene}
                        title={`Open scene: ${ls.sceneTitle}`}
                      >
                        Open →
                      </button>
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
