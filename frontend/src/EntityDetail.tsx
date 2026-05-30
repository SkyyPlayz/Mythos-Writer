import { useState, useEffect, useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import type { EntityEntry, EntityType, EntityBacklinkScene } from './types';
import TagInput from './TagInput';
import { EntityPicker, MultiEntityPicker } from './EntityPicker';
import './EntityDetail.css';

// ─── Constants ───────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<EntityType, string> = {
  character: 'Character', location: 'Location', faction: 'Faction',
  event: 'Event', item: 'Item', concept: 'Concept', other: 'Other',
};

const TYPE_ICONS: Record<EntityType, string> = {
  character: '👤', location: '📍', faction: '⚔️',
  event: '📅', item: '💎', concept: '💡', other: '📄',
};

// Reserved core-field property keys per type (excluded from custom fields)
const CORE_KEYS: Partial<Record<EntityType, string[]>> = {
  character: ['role', 'age', 'gender', 'affiliationId', 'description'],
  location:  ['locationType', 'climate', 'parentLocationId', 'description'],
  faction:   ['factionType', 'alignment', 'headquartersId', 'description'],
  event:     ['eventDate', 'participantIds', 'outcome', 'description'],
  item:      ['itemType', 'ownerId', 'description'],
  concept:   ['conceptType', 'description'],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractProse(markdown: string): string {
  const match = markdown.match(/^---[\s\S]*?---\n?([\s\S]*)$/);
  return match ? match[1].trimStart() : markdown;
}

function strProp(props: Record<string, unknown>, key: string): string {
  const v = props[key];
  return typeof v === 'string' ? v : '';
}

function arrProp(props: Record<string, unknown>, key: string): string[] {
  const v = props[key];
  return Array.isArray(v) ? (v as string[]) : [];
}

interface CustomField { key: string; value: string; }

function customFieldsFrom(props: Record<string, unknown>): CustomField[] {
  const v = props['customFields'];
  if (!Array.isArray(v)) return [];
  return (v as CustomField[]).filter(f => f && typeof f.key === 'string');
}

function nonCoreProps(type: EntityType, props: Record<string, unknown>): Record<string, unknown> {
  const reserved = new Set([...(CORE_KEYS[type] ?? []), 'customFields', 'noAutoLink']);
  return Object.fromEntries(Object.entries(props).filter(([k]) => !reserved.has(k)));
}

// ─── CoreFields ───────────────────────────────────────────────────────────────

interface CoreFieldsProps {
  type: EntityType;
  props: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  onBlur: () => void;
}

function CoreFields({ type, props, onChange, onBlur }: CoreFieldsProps) {
  const field = (key: string, label: string, placeholder = '') => (
    <div className="entity-det-field" key={key}>
      <label className="entity-det-label">{label}</label>
      <input
        className="entity-det-input"
        value={strProp(props, key)}
        placeholder={placeholder}
        onChange={e => onChange(key, e.target.value)}
        onBlur={onBlur}
      />
    </div>
  );

  const picker = (key: string, label: string, types: EntityType[]) => (
    <div className="entity-det-field" key={key}>
      <label className="entity-det-label">{label}</label>
      <EntityPicker
        allowedTypes={types}
        value={strProp(props, key) || null}
        onChange={id => { onChange(key, id ?? ''); onBlur(); }}
        onBlur={onBlur}
      />
    </div>
  );

  const desc = (
    <div className="entity-det-field entity-det-field-desc" key="description">
      <label className="entity-det-label">Description</label>
      <textarea
        className="entity-det-desc"
        value={strProp(props, 'description')}
        onChange={e => onChange('description', e.target.value)}
        onBlur={onBlur}
        placeholder="…"
        rows={3}
      />
    </div>
  );

  switch (type) {
    case 'character': return <>{field('role', 'Role', 'e.g. Protagonist')}{field('age', 'Age')}{field('gender', 'Gender')}{picker('affiliationId', 'Affiliation', ['faction'])}{desc}</>;
    case 'location':  return <>{field('locationType', 'Location Type', 'e.g. City, Forest')}{field('climate', 'Climate')}{picker('parentLocationId', 'Parent Location', ['location'])}{desc}</>;
    case 'faction':   return <>{field('factionType', 'Faction Type', 'e.g. Guild, Empire')}{field('alignment', 'Alignment')}{picker('headquartersId', 'Headquarters', ['location'])}{desc}</>;
    case 'event':     return <>
      {field('eventDate', 'Event Date', 'e.g. Year 412')}
      <div className="entity-det-field" key="participantIds">
        <label className="entity-det-label">Participants</label>
        <MultiEntityPicker
          allowedTypes={['character', 'faction', 'location', 'item', 'concept', 'event', 'other']}
          value={arrProp(props, 'participantIds')}
          onChange={ids => { onChange('participantIds', ids); onBlur(); }}
          onBlur={onBlur}
          placeholder="Add participant…"
        />
      </div>
      {field('outcome', 'Outcome')}
      {desc}
    </>;
    case 'item':      return <>{field('itemType', 'Item Type', 'e.g. Weapon, Artifact')}{picker('ownerId', 'Owner', ['character'])}{desc}</>;
    case 'concept':   return <>{field('conceptType', 'Concept Type', 'e.g. Magic System, Culture')}{desc}</>;
    default:          return <>{desc}</>;
  }
}

// ─── CustomFieldsSection ─────────────────────────────────────────────────────

function CustomFieldsSection({ fields, onChange, onBlur }:
  { fields: CustomField[]; onChange: (f: CustomField[]) => void; onBlur: () => void }) {

  const update = (i: number, patch: Partial<CustomField>) => {
    onChange(fields.map((f, idx) => idx === i ? { ...f, ...patch } : f));
  };

  return (
    <div className="entity-det-custom">
      <div className="entity-det-section-header">Custom Fields</div>
      <div className={fields.length > 8 ? 'entity-det-custom-list entity-det-custom-scroll' : 'entity-det-custom-list'}>
        {fields.map((f, i) => (
          <div key={i} className="entity-det-custom-row">
            <input
              className="entity-det-input entity-det-custom-key"
              value={f.key}
              placeholder="Field name"
              onChange={e => update(i, { key: e.target.value })}
              onBlur={onBlur}
            />
            <input
              className="entity-det-input entity-det-custom-val"
              value={f.value}
              placeholder="Value"
              onChange={e => update(i, { value: e.target.value })}
              onBlur={onBlur}
            />
            <button
              className="entity-det-custom-remove"
              onClick={() => { onChange(fields.filter((_, idx) => idx !== i)); onBlur(); }}
              title="Remove field"
            >×</button>
          </div>
        ))}
      </div>
      <button className="entity-det-add-field" onClick={() => onChange([...fields, { key: '', value: '' }])}>
        + Add Field
      </button>
    </div>
  );
}

// ─── NotesEditor ─────────────────────────────────────────────────────────────

function NotesEditor({ initialContent, onBlur }:
  { initialContent: string; onBlur: (md: string) => void }) {
  const latestMd = useRef(initialContent);
  const onBlurRef = useRef(onBlur);
  onBlurRef.current = onBlur;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Markdown,
    ],
    content: initialContent,
    onUpdate({ editor: e }) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (e.storage as any).markdown.getMarkdown() as string;
      latestMd.current = raw.endsWith('\n') ? raw : `${raw}\n`;
    },
  });

  // Expose blur trigger
  const handleWrapBlur = useCallback((e: React.FocusEvent) => {
    // Only fire when focus leaves the editor entirely (not between nodes)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      onBlurRef.current(latestMd.current);
    }
  }, []);

  return (
    <div className="entity-det-notes-editor" onBlur={handleWrapBlur}>
      <EditorContent editor={editor} className="entity-notes-content" />
    </div>
  );
}

// ─── Proposed relation type ───────────────────────────────────────────────────

interface ProposedRelation {
  suggestionId: string;
  relationType: string;
  targetEntityId: string;
  targetEntityName: string;
  rationale: string;
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  entity: EntityEntry;
  onClose: () => void;
  onUpdated: (entity: EntityEntry) => void;
  onDeleted: (id: string) => void;
  onOpenScene?: (scenePath: string) => void;
  onOpenEntity?: (entityId: string) => void;
}

// ─── EntityDetail ────────────────────────────────────────────────────────────

export default function EntityDetail({ entity, onClose, onUpdated, onDeleted, onOpenScene, onOpenEntity }: Props) {
  const [name, setName] = useState(entity.name);
  const [aliases, setAliases] = useState<string[]>(entity.aliases ?? []);
  const [tags, setTags] = useState<string[]>(entity.tags ?? []);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [noAutoLink, setNoAutoLink] = useState(!!entity.properties?.noAutoLink);
  const [coreProps, setCoreProps] = useState<Record<string, unknown>>(entity.properties ?? {});
  const [customFields, setCustomFields] = useState<CustomField[]>(customFieldsFrom(entity.properties ?? {}));
  const [prose, setProse] = useState('');
  const [proseLoading, setProseLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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

  // Keep latest state in refs for save callbacks
  const nameRef = useRef(name);
  const aliasesRef = useRef(aliases);
  const tagsRef = useRef(tags);
  const corePropsRef = useRef(coreProps);
  const customFieldsRef = useRef(customFields);
  const proseRef = useRef(prose);
  const noAutoLinkRef = useRef(noAutoLink);
  nameRef.current = name;
  aliasesRef.current = aliases;
  tagsRef.current = tags;
  corePropsRef.current = coreProps;
  customFieldsRef.current = customFields;
  proseRef.current = prose;
  noAutoLinkRef.current = noAutoLink;

  // Reset form when entity changes
  useEffect(() => {
    setName(entity.name);
    setAliases(entity.aliases ?? []);
    setTags(entity.tags ?? []);
    setNoAutoLink(!!entity.properties?.noAutoLink);
    setCoreProps(entity.properties ?? {});
    setCustomFields(customFieldsFrom(entity.properties ?? {}));
    setError('');
    setDeleteConfirm(false);
    setShowAddForm(false);
    setAddLabel('');
    setAddTargetId('');
  }, [entity.id]);

  // Load all tags for autocomplete
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.api as any).tagsList?.().then((r: { tags: Array<{ name: string }> }) => {
      setAllTags(r.tags.map(t => t.name));
    }).catch(() => {});
  }, []);

  // Load prose from vault file
  useEffect(() => {
    setProseLoading(true);
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (window.api as any).readVault(entity.path);
        const p = extractProse(result.content);
        setProse(p);
        proseRef.current = p;
      } catch {
        setProse('');
        proseRef.current = '';
      } finally {
        setProseLoading(false);
      }
    })();
  }, [entity.id, entity.path]);

  // Load backlinks
  const loadBacklinks = useCallback(async () => {
    setBacklinksLoading(true);
    try {
      const result = await window.api.entityBacklinks(entity.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setBacklinks((result as any).scenes ?? []);
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

  // Build entity name map for relation display
  useEffect(() => {
    (async () => {
      try {
        const result = await window.api.entityList();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const map = new Map<string, string>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const e of (result as any).entities) map.set(e.id, e.name);
        setEntityNameMap(map);
      } catch { /* noop */ }
    })();
  }, []);

  // Load proposed typed-relation suggestions
  const loadProposedRelations = useCallback(async () => {
    setProposedRelationsLoading(true);
    try {
      const result = await window.api.suggestionsList('proposed', 'archive');
      const proposed: ProposedRelation[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const s of (result as any).suggestions) {
        if (!s.payload_json) continue;
        try {
          const p = JSON.parse(s.payload_json) as {
            kind?: string; relationType?: string;
            sourceEntityId?: string; targetEntityId?: string;
            targetEntityName?: string; sourceEntityName?: string;
          };
          if (p.kind === 'typed-relation' &&
            (p.sourceEntityId === entity.id || p.targetEntityId === entity.id)) {
            proposed.push({
              suggestionId: s.id,
              relationType: p.relationType ?? '',
              targetEntityId: p.sourceEntityId === entity.id ? (p.targetEntityId ?? '') : (p.sourceEntityId ?? ''),
              targetEntityName: p.sourceEntityId === entity.id ? (p.targetEntityName ?? '') : (p.sourceEntityName ?? ''),
              rationale: s.rationale,
            });
          }
        } catch { /* noop */ }
      }
      setProposedRelations(proposed);
    } catch {
      setProposedRelations([]);
    } finally {
      setProposedRelationsLoading(false);
    }
  }, [entity.id]);

  useEffect(() => { loadProposedRelations(); }, [loadProposedRelations]);

  const handleAcceptRelation = useCallback(async (suggestionId: string) => {
    try {
      await window.api.suggestionsAccept(suggestionId);
      setProposedRelations(prev => prev.filter(r => r.suggestionId !== suggestionId));
      const updated = await window.api.entityRead(entity.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (updated) onUpdated(updated as any);
    } catch { /* noop */ }
  }, [entity.id, onUpdated]);

  const handleRejectRelation = useCallback(async (suggestionId: string) => {
    try {
      await window.api.suggestionsReject(suggestionId);
      setProposedRelations(prev => prev.filter(r => r.suggestionId !== suggestionId));
    } catch { /* noop */ }
  }, []);

  // ── Save on blur ─────────────────────────────────────────────────────────

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

  const buildProps = useCallback((
    overrideCore?: Record<string, unknown>,
    overrideCustom?: CustomField[],
    overrideNoAutoLink?: boolean,
  ): Record<string, unknown> => {
    const core = overrideCore ?? corePropsRef.current;
    const custom = overrideCustom ?? customFieldsRef.current;
    const nal = overrideNoAutoLink ?? noAutoLinkRef.current;
    const extra = nonCoreProps(entity.type, core);
    const merged: Record<string, unknown> = { ...core, ...extra, customFields: custom };
    if (nal) merged.noAutoLink = true;
    else delete merged.noAutoLink;
    return merged;
  }, [entity.type]);

  const save = useCallback(async (overrides?: {
    name?: string; aliases?: string[]; tags?: string[];
    core?: Record<string, unknown>; custom?: CustomField[];
    prose?: string; noAutoLink?: boolean;
  }) => {
    setSaving(true);
    setError('');
    try {
      const updated = await window.api.entityUpdate({
        id: entity.id,
        name: (overrides?.name ?? nameRef.current).trim() || entity.name,
        aliases: overrides?.aliases ?? aliasesRef.current,
        tags: overrides?.tags ?? tagsRef.current,
        prose: overrides?.prose ?? proseRef.current,
        properties: buildProps(overrides?.core, overrides?.custom, overrides?.noAutoLink),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onUpdated(updated as any);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }, [entity.id, entity.name, buildProps, onUpdated]);

  const handleDelete = async () => {
    try {
      await window.api.entityDelete(entity.id);
      onDeleted(entity.id);
    } catch (err) {
      setError(String(err));
    }
  };

  // ── Prop helpers ──────────────────────────────────────────────────────────

  const handleCorePropChange = (key: string, value: unknown) => {
    setCoreProps(prev => ({ ...prev, [key]: value }));
  };

  const handleCustomChange = (fields: CustomField[]) => {
    setCustomFields(fields);
    customFieldsRef.current = fields;
  };

  const currentRelations = entity.relations ?? [];
  const totalRelations = currentRelations.length + proposedRelations.length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="entity-detail">
      {/* ── Header ── */}
      <div className="entity-detail-header">
        <div className="entity-detail-header-left">
          <span className={`entity-type-chip entity-type-chip-${entity.type}`}>
            <span className="entity-type-icon">{TYPE_ICONS[entity.type]}</span>
            {TYPE_LABELS[entity.type]}
          </span>
        </div>
        <div className="entity-detail-header-right">
          {saving && <span className="entity-det-saving">Saving…</span>}
          {deleteConfirm ? (
            <>
              <button className="entity-det-btn entity-det-btn-danger" onClick={handleDelete}>Confirm delete</button>
              <button className="entity-det-btn entity-det-btn-ghost" onClick={() => setDeleteConfirm(false)}>Cancel</button>
            </>
          ) : (
            <button className="entity-det-btn entity-det-btn-ghost" onClick={() => setDeleteConfirm(true)} title="Delete entity">
              Delete
            </button>
          )}
          <button className="entity-det-btn entity-det-btn-ghost" onClick={onClose}>✕</button>
        </div>
      </div>

      <div className="entity-detail-body">
        {/* Name */}
        <div className="entity-det-field">
          <label className="entity-det-label">Name</label>
          <input
            className="entity-det-input entity-det-name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={() => save({ name })}
          />
        </div>

        {/* Aliases — chip-style */}
        <div className="entity-det-field">
          <label className="entity-det-label">Aliases</label>
          <TagInput
            value={aliases}
            onChange={v => { setAliases(v); aliasesRef.current = v; }}
            placeholder="Add alias…"
            // Save after a chip is added/removed (TagInput calls onChange immediately)
          />
          {/* Hidden blur trigger: save after TagInput settles */}
          <input
            style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', height: 0, width: 0 }}
            onFocus={() => {}}
            onBlur={() => save({ aliases })}
            tabIndex={-1}
            aria-hidden
          />
        </div>

        {/* Tags — chip-style with autocomplete */}
        <div className="entity-det-field">
          <label className="entity-det-label">Tags</label>
          <TagInput
            value={tags}
            onChange={v => { setTags(v); tagsRef.current = v; save({ tags: v }); }}
            allTags={allTags}
            placeholder="Add tag…"
          />
        </div>

        {/* Skip auto-link */}
        <div className="entity-det-field entity-det-field-inline">
          <label className="entity-det-label entity-det-label-check">
            <input
              type="checkbox"
              checked={noAutoLink}
              onChange={e => { setNoAutoLink(e.target.checked); noAutoLinkRef.current = e.target.checked; save({ noAutoLink: e.target.checked }); }}
              aria-label="Skip auto-link for this entity"
            />
            Skip auto-link (common nouns like &ldquo;Mom&rdquo;, &ldquo;the King&rdquo;)
          </label>
        </div>

        {/* ── Core fields section ── */}
        <div className="entity-det-section">
          <div className="entity-det-section-header">Details</div>
          <CoreFields
            type={entity.type}
            props={coreProps}
            onChange={handleCorePropChange}
            onBlur={() => save({ core: corePropsRef.current })}
          />
        </div>

        {/* ── Custom fields section ── */}
        <CustomFieldsSection
          fields={customFields}
          onChange={handleCustomChange}
          onBlur={() => save({ custom: customFieldsRef.current })}
        />

        {/* ── Notes (Tiptap) section ── */}
        <div className="entity-det-section">
          <div className="entity-det-section-header">Notes</div>
          {proseLoading ? (
            <div className="entity-det-prose-loading">Loading…</div>
          ) : (
            <NotesEditor
              key={entity.id}
              initialContent={prose}
              onBlur={md => { setProse(md); proseRef.current = md; save({ prose: md }); }}
            />
          )}
        </div>

        {error && <div className="entity-det-error">{error}</div>}

        {/* ── Connections (typed relations) panel ── */}
        <div className="entity-det-backlinks">
          <button
            className="entity-det-backlinks-header"
            onClick={() => setRelationsOpen(o => !o)}
            aria-expanded={relationsOpen}
          >
            <span className="entity-det-backlinks-chevron">{relationsOpen ? '▾' : '▸'}</span>
            <span className="entity-det-backlinks-title">Connections</span>
            <span className="entity-det-backlinks-count">{proposedRelationsLoading ? '…' : totalRelations}</span>
          </button>
          {relationsOpen && (
            <div className="entity-det-backlinks-body">
              {currentRelations.length === 0 && proposedRelations.length === 0 && (
                <div className="entity-det-backlinks-empty">No connections yet. Run Archive scan to detect relations.</div>
              )}
              {currentRelations.length > 0 && (
                <ul className="entity-det-backlinks-list" aria-label="Confirmed connections">
                  {currentRelations.map((rel, i) => {
                    const targetName = entityNameMap.get(rel.target) ?? rel.target;
                    return (
                      <li key={`${rel.type}-${rel.target}-${i}`} className="entity-det-relation-item">
                        <span className="entity-det-relation-type">{rel.type}</span>
                        <button
                          className="entity-det-backlink-scene"
                          onClick={() => onOpenEntity?.(rel.target)}
                          disabled={!onOpenEntity}
                          aria-label={`Open ${targetName}`}
                        >{targetName}</button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {proposedRelations.length > 0 && (
                <div className="entity-det-proposed-relations" aria-label="Proposed connections">
                  <div className="entity-det-proposed-header">Proposed by Archive</div>
                  {proposedRelations.map(pr => (
                    <div key={pr.suggestionId} className="entity-det-proposed-item">
                      <div className="entity-det-proposed-desc">
                        <span className="entity-det-relation-type">{pr.relationType}</span>
                        <span className="entity-det-proposed-target">{pr.targetEntityName || pr.targetEntityId}</span>
                      </div>
                      <p className="entity-det-proposed-rationale">{pr.rationale}</p>
                      <div className="entity-det-proposed-actions">
                        <button className="entity-det-btn entity-det-btn-primary entity-det-btn-sm" onClick={() => handleAcceptRelation(pr.suggestionId)}>Accept</button>
                        <button className="entity-det-btn entity-det-btn-ghost entity-det-btn-sm" onClick={() => handleRejectRelation(pr.suggestionId)}>Reject</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Backlinks panel ── */}
        <div className="entity-det-backlinks">
          <button
            className="entity-det-backlinks-header"
            onClick={() => setBacklinksOpen(o => !o)}
            aria-expanded={backlinksOpen}
          >
            <span className="entity-det-backlinks-chevron">{backlinksOpen ? '▾' : '▸'}</span>
            <span className="entity-det-backlinks-title">Backlinks</span>
            <span className="entity-det-backlinks-count">{backlinksLoading ? '…' : backlinks.length}</span>
          </button>
          {backlinksOpen && (
            <div className="entity-det-backlinks-body">
              {backlinksLoading ? (
                <div className="entity-det-backlinks-empty">Scanning scenes…</div>
              ) : backlinks.length === 0 ? (
                <div className="entity-det-backlinks-empty">No scenes mention this entity yet.</div>
              ) : (
                <ul className="entity-det-backlinks-list">
                  {backlinks.map(bl => (
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
