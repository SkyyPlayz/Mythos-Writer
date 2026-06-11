import { useState, useEffect, useRef, useCallback } from 'react';
import type { IdeaCardIdea, IdeaCardChip, IdeaCardType } from './IdeaCard';
import './IdeaDetailDrawer.css';

interface EntityPickerItem {
  id: string;
  name: string;
  type: IdeaCardType;
}

interface EntityPickerProps {
  onSelect: (entity: EntityPickerItem) => void;
  onClose: () => void;
}

function EntityPicker({ onSelect, onClose }: EntityPickerProps) {
  const [query, setQuery] = useState('');
  const [entities, setEntities] = useState<EntityPickerItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const result = await window.api.entityList();
        setEntities(
          result.entities.map((e) => ({
            id: e.id,
            name: e.name,
            type: (e.type === 'concept' || e.type === 'other' ? 'note' : e.type) as IdeaCardType,
          })),
        );
      } catch { /* non-critical */ }
    })();
  }, []);

  const filtered = query.trim()
    ? entities.filter((e) => e.name.toLowerCase().includes(query.toLowerCase()))
    : entities;

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };

  return (
    <div
      className="idd-entity-picker-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Entity picker"
      onKeyDown={handleKey}
    >
      <div className="idd-entity-picker">
        <input
          ref={inputRef}
          className="idd-entity-picker-input"
          type="text"
          placeholder="Search entities…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search entities"
        />
        <ul className="idd-entity-picker-list" role="listbox">
          {filtered.length === 0 && (
            <li className="idd-entity-picker-empty">No entities found</li>
          )}
          {filtered.map((e) => (
            <li
              key={e.id}
              className="idd-entity-picker-item"
              role="option"
              aria-selected={false}
              onClick={() => onSelect(e)}
            >
              <span className="idd-entity-picker-name">{e.name}</span>
              <span className={`idd-entity-picker-badge idd-badge-${e.type}`}>{e.type}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

interface DiscardDialogProps {
  onDiscard: () => void;
  onSave: () => void;
}

function DiscardDialog({ onDiscard, onSave }: DiscardDialogProps) {
  return (
    <div
      className="idd-discard-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Unsaved changes"
    >
      <div className="idd-discard-dialog">
        <p className="idd-discard-msg">You have unsaved changes. Discard or save?</p>
        <div className="idd-discard-actions">
          <button className="idd-btn-secondary" type="button" onClick={onDiscard}>
            Discard
          </button>
          <button className="idd-btn-accent" type="button" onClick={onSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export interface IdeaDetailDrawerProps {
  idea: IdeaCardIdea;
  onClose: () => void;
  onSave: (updated: IdeaCardIdea) => void;
  onChipClick?: (chip: IdeaCardChip) => void;
}

export function IdeaDetailDrawer({ idea, onClose, onSave, onChipClick }: IdeaDetailDrawerProps) {
  const [title, setTitle] = useState(idea.title);
  const [body, setBody] = useState('');
  const [linkedEntities, setLinkedEntities] = useState(idea.linkedEntities ?? []);
  const [showEntityPicker, setShowEntityPicker] = useState(false);
  const [showDiscard, setShowDiscard] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  const isDirty =
    title !== idea.title ||
    body !== '' ||
    linkedEntities.length !== (idea.linkedEntities ?? []).length;

  const handleClose = useCallback(() => {
    if (isDirty) {
      setShowDiscard(true);
    } else {
      onClose();
    }
  }, [isDirty, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !showEntityPicker) {
        e.stopPropagation();
        handleClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleClose, showEntityPicker]);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Focus trap: Tab cycles within the drawer when no nested overlay is open
  useEffect(() => {
    if (showEntityPicker || showDiscard) return;
    const drawer = drawerRef.current;
    if (!drawer) return;
    const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showEntityPicker, showDiscard]);

  const handleSave = useCallback(() => {
    onSave({ ...idea, title, linkedEntities });
    setShowDiscard(false);
  }, [idea, title, linkedEntities, onSave]);

  const handleDiscard = useCallback(() => {
    setShowDiscard(false);
    onClose();
  }, [onClose]);

  const handleEntitySelect = useCallback((entity: { id: string; name: string; type: IdeaCardType }) => {
    setLinkedEntities((prev) => {
      if (prev.some((e) => e.id === entity.id)) return prev;
      return [...prev, entity];
    });
    setShowEntityPicker(false);
  }, []);

  const removeEntity = useCallback((id: string) => {
    setLinkedEntities((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const STATUS_LABELS: Record<string, string> = {
    unsaved: 'Unsaved',
    saving: 'Saving…',
    saved: 'Saved',
    error: 'Error',
    pending_review: 'Pending review',
    needs_routing: 'Needs routing',
  };

  return (
    <>
      {/* Scrim blocks card list while drawer is open */}
      <div className="idd-scrim" aria-hidden="true" onClick={handleClose} />

      <aside
        ref={drawerRef}
        className="idd-drawer"
        role="complementary"
        aria-label="Idea detail"
        data-testid="idea-detail-drawer"
      >
        {/* Header */}
        <div className="idd-header">
          <span className="idd-header-title" aria-hidden="true">
            {title || 'Untitled'}
          </span>
          <button
            ref={closeButtonRef}
            className="idd-close-btn"
            type="button"
            aria-label="Close idea detail"
            onClick={handleClose}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="idd-body">
          {/* Metadata bar */}
          <div className="idd-meta-bar">
            <span className={`idd-badge idd-badge-${idea.type}`}>{idea.type}</span>
            <span className="idd-status">{STATUS_LABELS[String(idea.savedLabel)] ?? 'Unsaved'}</span>
          </div>

          {/* Title */}
          <div className="idd-section">
            <label className="idd-label" htmlFor="idd-title-input">Title</label>
            <input
              id="idd-title-input"
              className="idd-title-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="Idea title"
            />
          </div>

          {/* Body textarea */}
          <div className="idd-section">
            <label className="idd-label" htmlFor="idd-body-textarea">Notes</label>
            <textarea
              id="idd-body-textarea"
              className="idd-body-textarea"
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, 8000))}
              maxLength={8000}
              placeholder="Markdown notes…"
              aria-label="Idea notes"
            />
            {body.length >= 7900 && (
              <span className="idd-char-count">{body.length}/8000</span>
            )}
          </div>

          {/* Linked entities */}
          <div className="idd-section">
            <div className="idd-section-header">
              <span className="idd-label">Linked Entities</span>
            </div>
            <div className="idd-entity-pills" aria-label="Linked entities">
              {linkedEntities.map((e) => (
                <span key={e.id} className={`idd-entity-pill idd-badge-${e.type}`}>
                  {onChipClick ? (
                    <button
                      type="button"
                      className="idd-pill-name-btn"
                      aria-label={`Navigate to ${e.name}`}
                      onClick={() => onChipClick(e)}
                    >
                      {e.name}
                    </button>
                  ) : (
                    <span className="idd-pill-name">{e.name}</span>
                  )}
                  <button
                    type="button"
                    className="idd-pill-remove"
                    aria-label={`Remove ${e.name}`}
                    onClick={() => removeEntity(e.id)}
                  >
                    ×
                  </button>
                </span>
              ))}
              <button
                type="button"
                className="idd-add-entity-btn"
                onClick={() => setShowEntityPicker(true)}
              >
                + Add entity
              </button>
            </div>
          </div>

          {/* Scene draft */}
          <div className="idd-section">
            <div className="idd-section-header">
              <span className="idd-label">Scene Draft</span>
            </div>
            <button type="button" className="idd-scene-draft-btn">
              + Add to scene draft
            </button>
          </div>

          {/* Provenance (collapsed by default) */}
          <details className="idd-provenance">
            <summary className="idd-provenance-summary">Provenance</summary>
            <div className="idd-provenance-body">
              {idea.savedPath && (
                <div className="idd-provenance-row">
                  <span className="idd-provenance-key">Path</span>
                  <span className="idd-provenance-val">{idea.savedPath}</span>
                </div>
              )}
              {idea.updatedAt && (
                <div className="idd-provenance-row">
                  <span className="idd-provenance-key">Updated</span>
                  <span className="idd-provenance-val">{new Date(idea.updatedAt).toLocaleString()}</span>
                </div>
              )}
            </div>
          </details>
        </div>

        {/* Footer — only when dirty */}
        {isDirty && !showDiscard && (
          <div className="idd-footer">
            <button
              type="button"
              className="idd-btn-secondary"
              onClick={() => {
                setTitle(idea.title);
                setBody('');
                setLinkedEntities(idea.linkedEntities ?? []);
              }}
            >
              Discard
            </button>
            <button type="button" className="idd-btn-accent" onClick={handleSave}>
              Save
            </button>
          </div>
        )}
      </aside>

      {showEntityPicker && (
        <EntityPicker
          onSelect={handleEntitySelect}
          onClose={() => setShowEntityPicker(false)}
        />
      )}

      {showDiscard && (
        <DiscardDialog onDiscard={handleDiscard} onSave={handleSave} />
      )}
    </>
  );
}
