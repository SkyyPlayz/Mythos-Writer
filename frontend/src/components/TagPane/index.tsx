import { useState, useCallback, useEffect, useRef } from 'react';
import './TagPane.css';

// ─── Merge dialog ───

interface MergeDialogProps {
  sourceTag: string;
  allTags: string[];
  onMerge: (sourceTag: string, targetTag: string) => void;
  onClose: () => void;
}

function MergeDialog({ sourceTag, allTags, onMerge, onClose }: MergeDialogProps) {
  const [target, setTarget] = useState('');
  const candidates = allTags.filter((t) => t !== sourceTag);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (target) onMerge(sourceTag, target);
  };

  return (
    <div
      className="tp-merge-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Merge tag"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form className="tp-merge-dialog" onSubmit={handleSubmit}>
        <p className="tp-merge-title">
          Merge <strong>{sourceTag}</strong> into:
        </p>
        <select
          className="tp-merge-select"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          aria-label="Target tag"
          autoFocus
        >
          <option value="">— pick a tag —</option>
          {candidates.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <div className="tp-merge-actions">
          <button type="button" className="tp-merge-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="tp-merge-confirm" disabled={!target}>
            Merge
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Tag row ───

interface TagRowProps {
  entry: NotesTagEntry;
  depth: number;
  activeTag: string | null;
  onSelectTag: (fullName: string | null) => void;
  onRenameStart: (entry: NotesTagEntry) => void;
  onMergeStart: (entry: NotesTagEntry) => void;
  renamingFullName: string | null;
  renameValue: string;
  renameError: string | null;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
}

function TagRow({
  entry,
  depth,
  activeTag,
  onSelectTag,
  onRenameStart,
  onMergeStart,
  renamingFullName,
  renameValue,
  renameError,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
}: TagRowProps) {
  const [open, setOpen] = useState(depth === 0);
  const isActive = activeTag === entry.fullName;
  const isRenaming = renamingFullName === entry.fullName;
  const hasChildren = entry.children.length > 0;
  const cancelledRef = useRef(false);

  const handleClick = () => {
    if (!isRenaming) onSelectTag(isActive ? null : entry.fullName);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isRenaming) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(); }
  };

  return (
    <div className="tp-tag-item" style={{ '--tp-depth': depth } as React.CSSProperties}>
      {hasChildren && (
        <button
          className="tp-chevron-btn"
          onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
          aria-expanded={open}
          aria-label={open ? 'Collapse' : 'Expand'}
          tabIndex={-1}
        >
          <span className="tp-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
        </button>
      )}
      {!hasChildren && <span className="tp-chevron-spacer" aria-hidden="true" />}

      <div
        className={`tp-tag-row${isActive ? ' tp-tag-active' : ''}`}
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        title={isRenaming ? undefined : entry.fullName}
        data-testid={`tp-tag-${entry.fullName}`}
      >
        {isRenaming ? (
          <span className="tp-rename-wrap">
            <input
              className="tp-rename-input"
              autoFocus
              value={renameValue}
              aria-label="Rename tag"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onRenameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); cancelledRef.current = false; onRenameCommit(); }
                if (e.key === 'Escape') { e.preventDefault(); cancelledRef.current = true; onRenameCancel(); }
              }}
              onBlur={() => { if (!cancelledRef.current) onRenameCommit(); }}
            />
            {renameError && (
              <span className="tp-rename-error" role="alert">{renameError}</span>
            )}
          </span>
        ) : (
          <>
            <span className="tp-tag-name">{entry.name}</span>
            <span className="tp-tag-count" aria-label={`${entry.count} notes`}>{entry.count}</span>
            <span className="tp-tag-actions" aria-hidden="true">
              <button
                className="tp-tag-action-btn"
                title="Rename tag"
                aria-label={`Rename tag ${entry.fullName}`}
                tabIndex={-1}
                onClick={(e) => { e.stopPropagation(); onRenameStart(entry); }}
              >
                ✎
              </button>
              <button
                className="tp-tag-action-btn"
                title="Merge into…"
                aria-label={`Merge tag ${entry.fullName}`}
                tabIndex={-1}
                onClick={(e) => { e.stopPropagation(); onMergeStart(entry); }}
              >
                ⇒
              </button>
            </span>
          </>
        )}
      </div>

      {hasChildren && open && (
        <div className="tp-children">
          {entry.children.map((child) => (
            <TagRow
              key={child.fullName}
              entry={child}
              depth={depth + 1}
              activeTag={activeTag}
              onSelectTag={onSelectTag}
              onRenameStart={onRenameStart}
              onMergeStart={onMergeStart}
              renamingFullName={renamingFullName}
              renameValue={renameValue}
              renameError={renameError}
              onRenameChange={onRenameChange}
              onRenameCommit={onRenameCommit}
              onRenameCancel={onRenameCancel}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Flatten tag tree for merge dialog ───

function flattenTags(entries: NotesTagEntry[]): string[] {
  const result: string[] = [];
  for (const e of entries) {
    result.push(e.fullName);
    result.push(...flattenTags(e.children));
  }
  return result;
}

// ─── TagPane ───

export interface TagPaneProps {
  /** Called when the user clicks a tag to filter notes (null = clear filter). */
  onTagFilter: (tag: string | null) => void;
  activeTag: string | null;
}

export default function TagPane({ onTagFilter, activeTag }: TagPaneProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [tags, setTags] = useState<NotesTagEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const [renamingFullName, setRenamingFullName] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);

  const [mergeSrc, setMergeSrc] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.api.notesTagList();
      if (result && !('error' in result)) {
        setTags((result as { tags: NotesTagEntry[] }).tags);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRenameStart = useCallback((entry: NotesTagEntry) => {
    setRenamingFullName(entry.fullName);
    setRenameValue(entry.name);
    setRenameError(null);
  }, []);

  const handleRenameCommit = useCallback(async () => {
    if (!renamingFullName) return;
    const trimmed = renameValue.trim();
    if (!trimmed) { setRenameError('Tag name cannot be empty'); return; }
    if (trimmed === renamingFullName.split('/').pop()) {
      setRenamingFullName(null);
      return;
    }
    // Build new full name: replace last segment
    const parts = renamingFullName.split('/');
    parts[parts.length - 1] = trimmed;
    const newTag = parts.join('/');
    try {
      await window.api.notesTagRename(renamingFullName, newTag);
      if (activeTag === renamingFullName) onTagFilter(newTag);
      setRenamingFullName(null);
      await load();
    } catch (e) {
      setRenameError((e as Error).message || 'Rename failed');
    }
  }, [renamingFullName, renameValue, activeTag, onTagFilter, load]);

  const handleRenameCancel = useCallback(() => {
    setRenamingFullName(null);
    setRenameError(null);
  }, []);

  const handleMergeStart = useCallback((entry: NotesTagEntry) => {
    setMergeSrc(entry.fullName);
  }, []);

  const handleMerge = useCallback(async (sourceTag: string, targetTag: string) => {
    setMergeSrc(null);
    await window.api.notesTagMerge(sourceTag, targetTag);
    if (activeTag === sourceTag) onTagFilter(null);
    await load();
  }, [activeTag, onTagFilter, load]);

  const allTagNames = flattenTags(tags);

  if (tags.length === 0 && !loading) return null;

  return (
    <div className="tag-pane" data-testid="tag-pane">
      <div className="tp-header">
        <button
          className="tp-header-btn"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-controls="tp-body"
        >
          <span className="tp-chevron" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
          <span className="tp-header-label">Tags</span>
          {activeTag && (
            <button
              className="tp-clear-filter"
              onClick={(e) => { e.stopPropagation(); onTagFilter(null); }}
              aria-label="Clear tag filter"
              title="Clear filter"
              tabIndex={0}
            >
              ×
            </button>
          )}
        </button>
      </div>

      {!collapsed && (
        <div id="tp-body" className="tp-body">
          {loading ? (
            <div className="tp-loading">Loading…</div>
          ) : (
            tags.map((entry) => (
              <TagRow
                key={entry.fullName}
                entry={entry}
                depth={0}
                activeTag={activeTag}
                onSelectTag={onTagFilter}
                onRenameStart={handleRenameStart}
                onMergeStart={handleMergeStart}
                renamingFullName={renamingFullName}
                renameValue={renameValue}
                renameError={renameError}
                onRenameChange={setRenameValue}
                onRenameCommit={handleRenameCommit}
                onRenameCancel={handleRenameCancel}
              />
            ))
          )}
        </div>
      )}

      {mergeSrc && (
        <MergeDialog
          sourceTag={mergeSrc}
          allTags={allTagNames}
          onMerge={handleMerge}
          onClose={() => setMergeSrc(null)}
        />
      )}
    </div>
  );
}
