import { useState, useEffect, useCallback, useRef } from 'react';
import type { EntityEntry, EntityType } from './types';
import TagInput from './TagInput';
import './EntityDetail.css';

const TYPE_LABELS: Record<EntityType, string> = {
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

function extractProse(markdown: string): string {
  const match = markdown.match(/^---[\s\S]*?---\n?([\s\S]*)$/);
  return match ? match[1].trimStart() : markdown;
}

interface ProposedRelation {
  suggestionId: string;
  relationType: string;
  targetEntityId: string;
  targetEntityName: string;
  rationale: string;
}

interface Props {
  entity: EntityEntry;
  onClose: () => void;
  onUpdated: (entity: EntityEntry) => void;
  onDeleted: (id: string) => void;
  onOpenScene?: (scenePath: string) => void;
  onOpenEntity?: (entityId: string) => void;
}

export default function EntityDetail({ entity, onClose, onUpdated, onDeleted, onOpenScene, onOpenEntity }: Props) {
  const [name, setName] = useState(entity.name);
  const [aliases, setAliases] = useState((entity.aliases ?? []).join(', '));
  const [noAutoLink, setNoAutoLink] = useState(!!entity.properties?.noAutoLink);
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

  // Relations state (legacy typed relations from archive)
  const [relationsOpen, setRelationsOpen] = useState(true);
  const [entityNameMap, setEntityNameMap] = useState<Map<string, string>>(new Map());
  const [proposedRelations, setProposedRelations] = useState<ProposedRelation[]>([]);
  const [proposedRelationsLoading, setProposedRelationsLoading] = useState(false);

  // SKY-232: entity-to-entity relationships
  const [relationships, setRelationships] = useState<EntityRelationshipRow[]>([]);
  const [relsOpen, setRelsOpen] = useState(true);
  const [relsLoading, setRelsLoading] = useState(false);
  const [allLabels, setAllLabels] = useState<string[]>([]);
  const [allEntities, setAllEntities] = useState<EntityEntry[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addLabel, setAddLabel] = useState('');
  const [addTargetId, setAddTargetId] = useState('');
  const [addSubmitting, setAddSubmitting] = useState(false);

  // Guards the form-reset effect so it only fires on entity id changes (see useEffect below).
  const prevEntityIdRef = useRef<string | null>(null);

  // Reset form when a different entity is selected. The dep array is [entity] to satisfy
  // exhaustive-deps, but we guard on entity.id so the reset only runs when the selected
  // entity switches — not when the parent passes a new object reference for the same entity
  // (e.g. after onUpdated returns the saved copy, or EntityBrowser passes back a stale object).
  useEffect(() => {
    if (prevEntityIdRef.current === entity.id) return;
    prevEntityIdRef.current = entity.id;
    setName(entity.name);
    setAliases((entity.aliases ?? []).join(', '));
    setNoAutoLink(!!entity.properties?.noAutoLink);
    setTags(entity.tags ?? []);
    setDirty(false);
    setError('');
    setDeleteConfirm(false);
    setShowAddForm(false);
    setAddLabel('');
    setAddTargetId('');
  }, [entity]);

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

  // Load relationships whenever entity changes
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

  useEffect(() => {
    loadRelationships();
  }, [loadRelationships]);

  // Refresh backlinks + linked scenes when any vault file changes (e.g. a scene is saved)
  useEffect(() => {
    const off = window.api.onVaultFileChanged(() => {
      loadBacklinks();
      loadLinkedScenes();
    });
    return off;
  }, [loadBacklinks, loadLinkedScenes]);

  // Build entity id to name map for rendering relation targets
  useEffect(() => {
    (async () => {
      try {
        const result = await window.api.entityList();
        const map = new Map<string, string>();
        for (const e of result.entities) map.set(e.id, e.name);
        setEntityNameMap(map);
      } catch {
        // silent -- relations render raw IDs as fallback
      }
    })();
  }, []);

  // Load proposed typed-relation suggestions targeting this entity
  const loadProposedRelations = useCallback(async () => {
    setProposedRelationsLoading(true);
    try {
      const result = await window.api.suggestionsList('proposed', 'archive');
      const proposed: ProposedRelation[] = [];
      for (const s of result.suggestions) {
        if (!s.payload_json) continue;
        try {
          const p = JSON.parse(s.payload_json) as {
            kind?: string;
            relationType?: string;
            sourceEntityId?: string;
            targetEntityId?: string;
            targetEntityName?: string;
            sourceEntityName?: string;
          };
          if (
            p.kind === 'typed-relation' &&
            (p.sourceEntityId === entity.id || p.targetEntityId === entity.id)
          ) {
            proposed.push({
              suggestionId: s.id,
              relationType: p.relationType ?? '',
              targetEntityId:
                p.sourceEntityId === entity.id
                  ? (p.targetEntityId ?? '')
                  : (p.sourceEntityId ?? ''),
              targetEntityName:
                p.sourceEntityId === entity.id
                  ? (p.targetEntityName ?? '')
                  : (p.sourceEntityName ?? ''),
              rationale: s.rationale,
            });
          }
        } catch {
          // malformed payload -- skip
        }
      }
      setProposedRelations(proposed);
    } catch {
      setProposedRelations([]);
    } finally {
      setProposedRelationsLoading(false);
    }
  }, [entity.id]);

  useEffect(() => {
    loadProposedRelations();
  }, [loadProposedRelations]);

  const handleAcceptRelation = useCallback(
    async (suggestionId: string) => {
      try {
        await window.api.suggestionsAccept(suggestionId);
        setProposedRelations((prev) => prev.filter((r) => r.suggestionId !== suggestionId));
        const updated = await window.api.entityRead(entity.id);
        if (updated) onUpdated(updated);
      } catch {
        // silent -- user can retry
      }
    },
    [entity.id, onUpdated],
  );

  const handleRejectRelation = useCallback(async (suggestionId: string) => {
    try {
      await window.api.suggestionsReject(suggestionId);
      setProposedRelations((prev) => prev.filter((r) => r.suggestionId !== suggestionId));
    } catch {
      // silent
    }
  }, []);

  const markDirty = useCallback(() => setDirty(true), []);

  const handleAddRelationship = async () => {
    if (!addLabel.trim() || !addTargetId) return;
    setAddSubmitting(true);
    try {
      const result = await window.api.entityRelationshipsCreate(entity.id, addTargetId, addLabel.trim());
      setRelationships((prev) => [...prev, result.relationship]);
      if (!allLabels.includes(addLabel.trim())) {
        setAllLabels((prev) => [...prev, addLabel.trim()].sort());
      }
      setAddLabel('');
      setAddTargetId('');
      setShowAddForm(false);
    } catch {
      // ignore — user can retry
    } finally {
      setAddSubmitting(false);
    }
  };

  const handleDeleteRelationship = async (relId: string) => {
    setRelationships((prev) => prev.filter((r) => r.id !== relId));
    try {
      await window.api.entityRelationshipsDelete(relId);
    } catch {
      loadRelationships();
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const aliasList = aliases.split(',').map((a) => a.trim()).filter(Boolean);
      const updatedProps: Record<string, unknown> = { ...(entity.properties ?? {}) };
      if (noAutoLink) {
        updatedProps.noAutoLink = true;
      } else {
        delete updatedProps.noAutoLink;
      }
      const updated = await window.api.entityUpdate({
        id: entity.id,
        name: name.trim() || entity.name,
        aliases: aliasList,
        tags,
        prose,
        properties: Object.keys(updatedProps).length > 0 ? updatedProps : undefined,
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

  const currentRelations = entity.relations ?? [];
  const totalRelations = currentRelations.length + proposedRelations.length;

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

        <div className="entity-det-field entity-det-field-inline">
          <label className="entity-det-label entity-det-label-check">
            <input
              type="checkbox"
              checked={noAutoLink}
              onChange={(e) => { setNoAutoLink(e.target.checked); markDirty(); }}
              aria-label="Skip auto-link for this entity"
            />
            Skip auto-link (common nouns like &ldquo;Mom&rdquo;, &ldquo;the King&rdquo;)
          </label>
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

        {/* Connections (typed relations) panel */}
        <div className="entity-det-backlinks">
          <button
            className="entity-det-backlinks-header"
            onClick={() => setRelationsOpen((o) => !o)}
            aria-expanded={relationsOpen}
          >
            <span className="entity-det-backlinks-chevron">{relationsOpen ? '▾' : '▸'}</span>
            <span className="entity-det-backlinks-title">Connections</span>
            <span className="entity-det-backlinks-count">
              {proposedRelationsLoading ? '…' : totalRelations}
            </span>
          </button>
          {relationsOpen && (
            <div className="entity-det-backlinks-body">
              {currentRelations.length === 0 && proposedRelations.length === 0 && (
                <div className="entity-det-backlinks-empty">
                  No connections yet. Run Archive scan to detect relations from brainstorm transcripts.
                </div>
              )}
              {currentRelations.length > 0 && (
                <ul className="entity-det-backlinks-list" aria-label="Confirmed connections">
                  {currentRelations.map((rel, i) => {
                    const targetName = entityNameMap.get(rel.target) ?? rel.target;
                    return (
                      <li key={rel.type + '-' + rel.target + '-' + i} className="entity-det-relation-item">
                        <span className="entity-det-relation-type">{rel.type}</span>
                        <button
                          className="entity-det-backlink-scene"
                          onClick={() => onOpenEntity?.(rel.target)}
                          disabled={!onOpenEntity}
                          aria-label={'Open ' + targetName}
                        >
                          {targetName}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {proposedRelations.length > 0 && (
                <div className="entity-det-proposed-relations" aria-label="Proposed connections">
                  <div className="entity-det-proposed-header">Proposed by Archive</div>
                  {proposedRelations.map((pr) => (
                    <div key={pr.suggestionId} className="entity-det-proposed-item">
                      <div className="entity-det-proposed-desc">
                        <span className="entity-det-relation-type">{pr.relationType}</span>
                        <span className="entity-det-proposed-target">
                          {pr.targetEntityName || pr.targetEntityId}
                        </span>
                      </div>
                      <p className="entity-det-proposed-rationale">{pr.rationale}</p>
                      <div className="entity-det-proposed-actions">
                        <button
                          className="entity-det-btn entity-det-btn-primary entity-det-btn-sm"
                          onClick={() => handleAcceptRelation(pr.suggestionId)}
                          aria-label={'Accept relation: ' + pr.relationType + ' ' + pr.targetEntityName}
                        >
                          Accept
                        </button>
                        <button
                          className="entity-det-btn entity-det-btn-ghost entity-det-btn-sm"
                          onClick={() => handleRejectRelation(pr.suggestionId)}
                          aria-label={'Reject relation: ' + pr.relationType + ' ' + pr.targetEntityName}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
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

        {/* Relationships panel */}
        <div className="entity-det-relationships">
          <button
            className="entity-det-rel-header"
            onClick={() => setRelsOpen((o) => !o)}
            aria-expanded={relsOpen}
          >
            <span className="entity-det-backlinks-chevron">{relsOpen ? '▾' : '▸'}</span>
            <span className="entity-det-backlinks-title">Relationships</span>
            <span className="entity-det-backlinks-count">
              {relsLoading ? '…' : relationships.length}
            </span>
          </button>
          {relsOpen && (
            <div className="entity-det-rel-body">
              {relsLoading ? (
                <div className="entity-det-backlinks-empty">Loading…</div>
              ) : relationships.length === 0 && !showAddForm ? (
                <div className="entity-det-backlinks-empty">No relationships yet.</div>
              ) : (
                <ul className="entity-det-rel-list">
                  {relationships.map((rel) => (
                    <li key={rel.id} className="entity-det-rel-row">
                      <span className="entity-det-rel-label">
                        {rel.direction === 'outgoing' ? rel.label : `← ${rel.label}`}
                      </span>
                      <span className="entity-det-rel-chip">
                        <span className="entity-det-rel-chip-icon">{TYPE_ICONS[rel.otherEntityType]}</span>
                        <span className="entity-det-rel-chip-name">{rel.otherEntityName}</span>
                      </span>
                      <button
                        className="entity-det-rel-delete"
                        onClick={() => handleDeleteRelationship(rel.id)}
                        title="Remove relationship"
                        aria-label={`Remove relationship ${rel.label} with ${rel.otherEntityName}`}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {showAddForm ? (
                <div className="entity-det-rel-form">
                  <input
                    className="entity-det-input entity-det-rel-form-label"
                    list="rel-labels-list"
                    placeholder="Relationship label…"
                    value={addLabel}
                    onChange={(e) => setAddLabel(e.target.value)}
                    autoFocus
                  />
                  <datalist id="rel-labels-list">
                    {allLabels.map((l) => <option key={l} value={l} />)}
                  </datalist>
                  <select
                    className="entity-det-input entity-det-rel-form-target"
                    value={addTargetId}
                    onChange={(e) => setAddTargetId(e.target.value)}
                  >
                    <option value="">Select entity…</option>
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
                      disabled={addSubmitting || !addLabel.trim() || !addTargetId}
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
              ) : (
                <button
                  className="entity-det-rel-add-btn"
                  onClick={() => setShowAddForm(true)}
                >
                  + Add relationship
                </button>
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
