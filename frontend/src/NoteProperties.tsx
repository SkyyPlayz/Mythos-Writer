// M16 (Beta 3 Liquid Neon): frontmatter-backed note properties + tags panel.
// Prototype: right panel "NOTES properties" card (HTML 2429–2463) — key/value
// rows + "Add property" + Tags card with an "Add tag…" input. Values live in
// the note's YAML frontmatter (the M15 templates write `title:`/`type:`/
// `createdAt:`), read and written through the existing notes-vault IPC.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  parseNoteFrontmatter,
  setFrontmatterField,
  setFrontmatterTags,
  type NoteFrontmatterField,
} from './noteFrontmatter';
import './NoteProperties.css';

interface Props {
  /** Notes-Vault-relative path of the active note. */
  path: string;
}

export default function NoteProperties({ path }: Props) {
  const [fields, setFields] = useState<NoteFrontmatterField[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [tagInput, setTagInput] = useState('');
  // Row edits buffer locally until commit (blur / Enter).
  const [rowEdits, setRowEdits] = useState<Record<string, string>>({});
  const contentRef = useRef<string>('');
  const editingRef = useRef(false);

  const load = useCallback(async () => {
    const r = await window.api.readNotesVault(path);
    if ('error' in r) {
      setError('Could not load note metadata.');
      setLoaded(true);
      return;
    }
    contentRef.current = r.content;
    const fm = parseNoteFrontmatter(r.content);
    setFields(fm.fields);
    setTags(fm.tags);
    setRowEdits({});
    setError(null);
    setLoaded(true);
  }, [path]);

  useEffect(() => {
    setLoaded(false);
    void load();
  }, [load]);

  // Live refresh: the notes editor autosaves beside this panel, and the vault
  // watcher fires for external edits too. Skip refreshes mid-edit so a
  // half-typed value is never clobbered.
  useEffect(() => {
    const off = window.api.onVaultFileChanged?.(() => {
      if (!editingRef.current) void load();
    });
    return off;
  }, [load]);

  const write = useCallback(async (nextContent: string) => {
    const r = await window.api.writeNotesVault(path, nextContent);
    if ('error' in r) {
      setError('Could not save note metadata.');
      return false;
    }
    contentRef.current = nextContent;
    const fm = parseNoteFrontmatter(nextContent);
    setFields(fm.fields);
    setTags(fm.tags);
    setError(null);
    // M16: tell any open editor on this note to adopt the new content so a
    // later editor autosave doesn't clobber the frontmatter change.
    window.dispatchEvent(new CustomEvent('mythos:note-frontmatter-updated', {
      detail: { path, content: nextContent },
    }));
    return true;
  }, [path]);

  // Read-modify-write: always mutate the LATEST on-disk content, not the
  // panel's last snapshot — the editor beside us autosaves the same file.
  const freshContent = useCallback(async (): Promise<string | null> => {
    const r = await window.api.readNotesVault(path);
    if ('error' in r) {
      setError('Could not save note metadata.');
      return null;
    }
    contentRef.current = r.content;
    return r.content;
  }, [path]);

  const commitField = useCallback(async (key: string, value: string) => {
    editingRef.current = false;
    const current = fields.find((f) => f.key === key)?.value ?? '';
    if (value === current) {
      setRowEdits((prev) => { const next = { ...prev }; delete next[key]; return next; });
      return;
    }
    const base = await freshContent();
    if (base !== null) await write(setFrontmatterField(base, key, value));
    setRowEdits((prev) => { const next = { ...prev }; delete next[key]; return next; });
  }, [fields, freshContent, write]);

  const commitNewProperty = useCallback(async () => {
    const key = newKey.trim().replace(/[^A-Za-z0-9_-]/g, '');
    if (!key) return;
    editingRef.current = false;
    const base = await freshContent();
    if (base === null) return;
    const ok = await write(setFrontmatterField(base, key, newValue.trim()));
    if (ok) {
      setNewKey('');
      setNewValue('');
      setAddOpen(false);
    }
  }, [newKey, newValue, freshContent, write]);

  const commitAddTag = useCallback(async () => {
    const tag = tagInput.trim().replace(/^#/, '');
    if (!tag) return;
    editingRef.current = false;
    if (tags.includes(tag)) {
      setTagInput('');
      return;
    }
    const base = await freshContent();
    if (base === null) return;
    const ok = await write(setFrontmatterTags(base, [...tags, tag]));
    if (ok) setTagInput('');
  }, [tagInput, tags, freshContent, write]);

  const removeTag = useCallback(async (tag: string) => {
    const base = await freshContent();
    if (base !== null) await write(setFrontmatterTags(base, tags.filter((t) => t !== tag)));
  }, [tags, freshContent, write]);

  if (!loaded) {
    return <div className="np-panel" data-testid="note-properties-panel" aria-live="polite"><div className="np-status">Loading…</div></div>;
  }

  return (
    <div className="np-panel" data-testid="note-properties-panel">
      {error && <div className="np-error" role="alert">{error}</div>}

      <section className="np-card" aria-label="Note properties">
        {fields.length === 0 && (
          <div className="np-empty" data-testid="note-properties-empty">
            No properties yet — add one below.
          </div>
        )}
        {fields.map((f) => (
          <div className="np-row" key={f.key} data-testid={`note-prop-row-${f.key}`}>
            <span className="np-key" title={f.key}>{f.key}</span>
            <input
              className="np-value"
              aria-label={`Property ${f.key}`}
              value={rowEdits[f.key] ?? f.value}
              onFocus={() => { editingRef.current = true; }}
              onChange={(e) => setRowEdits((prev) => ({ ...prev, [f.key]: e.target.value }))}
              onBlur={(e) => { void commitField(f.key, e.target.value); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') {
                  setRowEdits((prev) => { const next = { ...prev }; delete next[f.key]; return next; });
                  editingRef.current = false;
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />
          </div>
        ))}
        {addOpen ? (
          <div className="np-add-row" data-testid="note-prop-add-form">
            <input
              className="np-add-key"
              placeholder="Name"
              aria-label="New property name"
              value={newKey}
              autoFocus
              onFocus={() => { editingRef.current = true; }}
              onChange={(e) => setNewKey(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void commitNewProperty(); if (e.key === 'Escape') { editingRef.current = false; setAddOpen(false); } }}
            />
            <input
              className="np-value"
              placeholder="Value"
              aria-label="New property value"
              value={newValue}
              onFocus={() => { editingRef.current = true; }}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void commitNewProperty(); if (e.key === 'Escape') { editingRef.current = false; setAddOpen(false); } }}
            />
            <button type="button" className="np-add-confirm" onClick={() => void commitNewProperty()} disabled={!newKey.trim()}>
              Add
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="np-add-btn"
            data-testid="note-prop-add"
            onClick={() => setAddOpen(true)}
          >
            + Add property
          </button>
        )}
      </section>

      <section className="np-card" aria-label="Note tags">
        <div className="np-card-title">Tags</div>
        <div className="np-tags" data-testid="note-tags-list">
          {tags.length === 0 && <span className="np-empty">No tags</span>}
          {tags.map((t) => (
            <span className="np-tag" key={t} data-testid={`note-tag-${t}`}>
              #{t}
              <button
                type="button"
                className="np-tag-remove"
                aria-label={`Remove tag ${t}`}
                onClick={() => void removeTag(t)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <input
          className="np-tag-input"
          placeholder="Add tag…"
          aria-label="Add tag"
          data-testid="note-tag-input"
          value={tagInput}
          onFocus={() => { editingRef.current = true; }}
          onChange={(e) => setTagInput(e.target.value)}
          onBlur={() => { editingRef.current = false; }}
          onKeyDown={(e) => { if (e.key === 'Enter') void commitAddTag(); }}
        />
      </section>
    </div>
  );
}
