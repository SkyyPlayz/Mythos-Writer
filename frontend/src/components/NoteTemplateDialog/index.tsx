/**
 * NoteTemplateDialog — SKY-190
 *
 * Modal for creating a note from a template. Renders prompt (text input) and
 * pick (entity select) fields derived from the chosen template's body grammar,
 * then writes the resolved markdown to the Notes Vault.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import './NoteTemplateDialog.css';

// ─── Client-side template resolution ─────────────────────────────────────────

function resolveBody(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{([^}]+)\}\}/g, (_, expr: string) => {
    const key = expr.split('|')[0].trim();
    return vars[key] ?? '';
  });
}

function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .replace(/^-+|-+$/g, '') || 'note';
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface NoteTemplateDialogProps {
  open: boolean;
  dirPath: string;
  onClose: () => void;
  onCreated: (path: string) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function NoteTemplateDialog({
  open,
  dirPath,
  onClose,
  onCreated,
}: NoteTemplateDialogProps) {
  const [templates, setTemplates] = useState<NoteTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string>('__blank__');
  const [values, setValues] = useState<Record<string, string>>({});
  const [entityOptions, setEntityOptions] = useState<Record<string, EntityEntry[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstFieldRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  // Load templates once
  useEffect(() => {
    if (!open) return;
    window.api.noteTemplateList().then(({ templates: tpls }) => {
      setTemplates(tpls);
      // Default to first template
      if (tpls.length > 0) setSelectedId(tpls[0].id);
    }).catch(() => {
      // If IPC fails, fall back to blank-only mode
      setTemplates([]);
      setSelectedId('__blank__');
    });
  }, [open]);

  const selectedTemplate = templates.find((t) => t.id === selectedId) ?? null;

  // Reset field values when template changes
  useEffect(() => {
    if (!selectedTemplate) {
      setValues({});
      return;
    }
    const initial: Record<string, string> = {};
    for (const field of selectedTemplate.fields) {
      if (field.kind !== 'literal') initial[field.key] = field.defaultValue ?? '';
    }
    setValues(initial);
    setError(null);
  }, [selectedId, selectedTemplate]);

  // Load entity options for pick fields
  useEffect(() => {
    if (!selectedTemplate) return;
    const pickFields = selectedTemplate.fields.filter((f) => f.kind === 'pick' && f.entityType);
    if (pickFields.length === 0) return;

    const types = [...new Set(pickFields.map((f) => f.entityType!))];
    const fetches = types.map((type) =>
      window.api.entityList(type).then(({ entities }) => ({ type, entities })),
    );
    Promise.all(fetches).then((results) => {
      const map: Record<string, EntityEntry[]> = {};
      for (const { type, entities } of results) map[type] = entities;
      setEntityOptions(map);
    }).catch(() => setEntityOptions({}));
  }, [selectedTemplate]);

  // Open / close the <dialog> element
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open) {
      if (!el.open) el.showModal();
      // Focus first interactive field after render
      requestAnimationFrame(() => {
        const first = el.querySelector<HTMLInputElement | HTMLSelectElement>(
          'input:not([disabled]), select:not([disabled])',
        );
        first?.focus();
      });
    } else {
      if (el.open) el.close();
    }
  }, [open]);

  // Close on backdrop click (native <dialog> outside-click)
  const handleDialogClick = useCallback((e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) onClose();
  }, [onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  const titleKey = selectedTemplate?.fields.find(
    (f) => f.key === 'title' || f.key === 'name',
  )?.key;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      // Derive filename from title/name field, or fall back to a prompt value
      const noteTitle =
        (titleKey ? values[titleKey] : '') ||
        Object.values(values).find(Boolean) ||
        'note';
      const slug = slugify(noteTitle);
      const rel = dirPath ? `${dirPath}/${slug}.md` : `${slug}.md`;

      let content: string;
      if (!selectedTemplate) {
        content = `---\ntitle: "${noteTitle}"\ncreatedAt: ${new Date().toISOString()}\n---\n\n`;
      } else {
        content = resolveBody(selectedTemplate.body, values);
      }

      setSubmitting(true);
      try {
        await window.api.writeNotesVault(rel, content);
        onCreated(rel);
        onClose();
      } catch (err) {
        setError((err as Error).message || 'Failed to create note');
      } finally {
        setSubmitting(false);
      }
    },
    [selectedTemplate, values, dirPath, titleKey, onCreated, onClose],
  );

  if (!open) return null;

  const interactiveFields =
    selectedTemplate?.fields.filter((f) => f.kind !== 'literal') ?? [];

  return (
    <dialog
      ref={dialogRef}
      className="ntd-dialog"
      aria-modal="true"
      aria-labelledby="ntd-title"
      onClick={handleDialogClick}
      onKeyDown={handleKeyDown}
    >
      <div className="ntd-inner">
        <header className="ntd-header">
          <h2 id="ntd-title" className="ntd-title">New Note from Template</h2>
          <button
            type="button"
            className="ntd-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <form className="ntd-form" onSubmit={handleSubmit}>
          {/* Template selector */}
          <div className="ntd-field">
            <label className="ntd-label" htmlFor="ntd-template-select">
              Template
            </label>
            <select
              id="ntd-template-select"
              className="ntd-select"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              data-testid="ntd-template-select"
            >
              <option value="__blank__">Blank note</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {selectedTemplate && (
              <p className="ntd-description">{selectedTemplate.description}</p>
            )}
          </div>

          {/* Dynamic fields */}
          {interactiveFields.map((field, idx) => (
            <div className="ntd-field" key={field.key}>
              <label className="ntd-label" htmlFor={`ntd-field-${field.key}`}>
                {field.label}
              </label>
              {field.kind === 'pick' ? (
                <select
                  id={`ntd-field-${field.key}`}
                  className="ntd-select"
                  value={values[field.key] ?? ''}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [field.key]: e.target.value }))
                  }
                  ref={idx === 0 ? (firstFieldRef as React.RefObject<HTMLSelectElement>) : undefined}
                  data-testid={`ntd-field-${field.key}`}
                >
                  <option value="">— None —</option>
                  {(entityOptions[field.entityType!] ?? []).map((ent) => (
                    <option key={ent.id} value={ent.name}>
                      {ent.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`ntd-field-${field.key}`}
                  type="text"
                  className="ntd-input"
                  value={values[field.key] ?? ''}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [field.key]: e.target.value }))
                  }
                  ref={idx === 0 ? (firstFieldRef as React.RefObject<HTMLInputElement>) : undefined}
                  data-testid={`ntd-field-${field.key}`}
                  autoComplete="off"
                />
              )}
            </div>
          ))}

          {/* Blank note title input */}
          {selectedId === '__blank__' && (
            <div className="ntd-field">
              <label className="ntd-label" htmlFor="ntd-blank-title">
                Note name
              </label>
              <input
                id="ntd-blank-title"
                type="text"
                className="ntd-input"
                value={values['__blank_title__'] ?? ''}
                onChange={(e) =>
                  setValues((v) => ({ ...v, '__blank_title__': e.target.value }))
                }
                data-testid="ntd-blank-title"
                autoComplete="off"
                autoFocus
              />
            </div>
          )}

          {error && (
            <p className="ntd-error" role="alert">
              {error}
            </p>
          )}

          <div className="ntd-actions">
            <button
              type="button"
              className="ntd-btn ntd-btn-cancel"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="ntd-btn ntd-btn-ok"
              disabled={submitting}
              data-testid="ntd-submit"
            >
              {submitting ? 'Creating…' : 'Create Note'}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
