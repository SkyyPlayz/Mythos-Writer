// SKY-1700 (Wave 2f): Layout Manager dialog.
import { useState, useRef, useEffect } from 'react';
import './LayoutManagerDialog.css';

interface Props {
  layouts: WorkspaceLayout[];
  activeLayoutId: string | null;
  onClose: () => void;
  onSelectLayout: (layoutId: string) => void;
  onSaveCurrentAs: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onSetDefault: (id: string) => void;
  onDuplicate: (id: string) => void;
}

export default function LayoutManagerDialog({
  layouts,
  activeLayoutId,
  onClose,
  onSelectLayout,
  onSaveCurrentAs,
  onRename,
  onDelete,
  onSetDefault,
  onDuplicate,
}: Props) {
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [saveAsName, setSaveAsName] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const saveInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renameId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renameId]);

  function startRename(layout: WorkspaceLayout) {
    setRenameId(layout.id);
    setRenameValue(layout.name);
  }

  function commitRename() {
    if (!renameId) return;
    const trimmed = renameValue.trim();
    if (trimmed.length >= 1 && trimmed.length <= 64) {
      onRename(renameId, trimmed);
    }
    setRenameId(null);
  }

  function handleRenameKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
    if (e.key === 'Escape') { setRenameId(null); }
  }

  function handleDeleteClick(layout: WorkspaceLayout) {
    if (layout.id === activeLayoutId) return; // active layout cannot be deleted
    setDeleteConfirmId(layout.id);
  }

  function confirmDelete() {
    if (deleteConfirmId) {
      onDelete(deleteConfirmId);
      setDeleteConfirmId(null);
    }
  }

  function handleSaveAs() {
    const name = saveAsName.trim();
    if (name.length < 1 || name.length > 64) return;
    onSaveCurrentAs(name);
    setSaveAsName('');
  }

  function handleSaveAsKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); handleSaveAs(); }
  }

  const builtinLayouts = layouts.filter((l) => l.isBuiltIn);
  const userLayouts = layouts.filter((l) => !l.isBuiltIn);
  const deleteTarget = layouts.find((l) => l.id === deleteConfirmId);

  return (
    <div className="layout-manager-overlay" role="dialog" aria-modal="true" aria-label="Layout Manager">
      <div className="layout-manager-dialog">
        <div className="layout-manager-header">
          <div className="layout-manager-title">Layout Manager</div>
          <button
            className="layout-manager-close"
            onClick={onClose}
            aria-label="Close layout manager"
            data-testid="layout-manager-close"
          >
            ✕
          </button>
        </div>

        <div className="layout-manager-body">
          {/* Built-in layouts */}
          {builtinLayouts.length > 0 && (
            <>
              <div className="layout-manager-section-label">Built-in Layouts</div>
              {builtinLayouts.map((layout) => (
                <LayoutRow
                  key={layout.id}
                  layout={layout}
                  isActive={layout.id === activeLayoutId}
                  isRenaming={renameId === layout.id}
                  renameValue={renameValue}
                  renameInputRef={renameId === layout.id ? renameInputRef : undefined}
                  onSelect={() => onSelectLayout(layout.id)}
                  onStartRename={() => startRename(layout)}
                  onRenameChange={setRenameValue}
                  onRenameKey={handleRenameKey}
                  onRenameBlur={commitRename}
                  onDelete={() => handleDeleteClick(layout)}
                  onSetDefault={() => onSetDefault(layout.id)}
                  onDuplicate={() => onDuplicate(layout.id)}
                />
              ))}
            </>
          )}

          {userLayouts.length > 0 && (
            <>
              {builtinLayouts.length > 0 && <div className="layout-manager-divider" />}
              <div className="layout-manager-section-label">My Layouts</div>
              {userLayouts.map((layout) => (
                <LayoutRow
                  key={layout.id}
                  layout={layout}
                  isActive={layout.id === activeLayoutId}
                  isRenaming={renameId === layout.id}
                  renameValue={renameValue}
                  renameInputRef={renameId === layout.id ? renameInputRef : undefined}
                  onSelect={() => onSelectLayout(layout.id)}
                  onStartRename={() => startRename(layout)}
                  onRenameChange={setRenameValue}
                  onRenameKey={handleRenameKey}
                  onRenameBlur={commitRename}
                  onDelete={() => handleDeleteClick(layout)}
                  onSetDefault={() => onSetDefault(layout.id)}
                  onDuplicate={() => onDuplicate(layout.id)}
                />
              ))}
            </>
          )}
        </div>

        {/* Save current as… */}
        <div className="layout-manager-save-row">
          <input
            ref={saveInputRef}
            className="layout-manager-save-input"
            type="text"
            placeholder="Name for new layout…"
            value={saveAsName}
            onChange={(e) => setSaveAsName(e.target.value)}
            onKeyDown={handleSaveAsKey}
            maxLength={64}
            aria-label="New layout name"
            data-testid="layout-save-as-input"
          />
          <button
            className="layout-manager-save-btn"
            onClick={handleSaveAs}
            disabled={saveAsName.trim().length === 0}
            data-testid="layout-save-as-confirm"
          >
            Save current as
          </button>
        </div>

        <div className="layout-manager-footer">
          <button
            className="layout-manager-done-btn"
            onClick={onClose}
            data-testid="layout-manager-done"
          >
            Done
          </button>
        </div>

        {/* Delete confirmation overlay */}
        {deleteConfirmId && deleteTarget && (
          <div className="layout-manager-confirm-overlay" role="alertdialog" aria-modal="true">
            <div className="layout-manager-confirm-box">
              <div className="layout-manager-confirm-title">Delete Layout?</div>
              <div className="layout-manager-confirm-body">
                &ldquo;{deleteTarget.name}&rdquo; will be permanently removed.
              </div>
              <div className="layout-manager-confirm-actions">
                <button
                  className="layout-manager-confirm-cancel"
                  onClick={() => setDeleteConfirmId(null)}
                  data-testid="layout-delete-cancel"
                >
                  Cancel
                </button>
                <button
                  className="layout-manager-confirm-delete"
                  onClick={confirmDelete}
                  data-testid="layout-delete-confirm"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LayoutRow({
  layout,
  isActive,
  isRenaming,
  renameValue,
  renameInputRef,
  onSelect,
  onStartRename,
  onRenameChange,
  onRenameKey,
  onRenameBlur,
  onDelete,
  onSetDefault,
  onDuplicate,
}: {
  layout: WorkspaceLayout;
  isActive: boolean;
  isRenaming: boolean;
  renameValue: string;
  renameInputRef?: React.RefObject<HTMLInputElement>;
  onSelect: () => void;
  onStartRename: () => void;
  onRenameChange: (v: string) => void;
  onRenameKey: (e: React.KeyboardEvent) => void;
  onRenameBlur: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
  onDuplicate: () => void;
}) {
  return (
    <div
      className="layout-manager-row"
      data-testid={`layout-row-${layout.id}`}
    >
      {isRenaming ? (
        <input
          ref={renameInputRef}
          className="layout-manager-rename-input"
          type="text"
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onKeyDown={onRenameKey}
          onBlur={onRenameBlur}
          maxLength={64}
          aria-label={`Rename layout ${layout.name}`}
          data-testid={`layout-rename-input-${layout.id}`}
        />
      ) : (
        <button
          className={`layout-manager-row-name${isActive ? ' layout-manager-row-name--active' : ''}`}
          onClick={onSelect}
          data-testid={`layout-select-${layout.id}`}
          style={{ background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: 0 }}
        >
          {layout.name}
        </button>
      )}

      <div className="layout-manager-row-badges">
        {layout.isDefault && (
          <span className="layout-manager-badge layout-manager-badge--default" aria-label="Default layout">
            DEFAULT
          </span>
        )}
        {layout.isBuiltIn && (
          <span className="layout-manager-badge layout-manager-badge--builtin">
            built-in
          </span>
        )}
      </div>

      <div className="layout-manager-row-actions">
        <button
          className="layout-manager-action-btn"
          onClick={onDuplicate}
          title="Duplicate"
          data-testid={`layout-duplicate-${layout.id}`}
        >
          Copy
        </button>
        {!layout.isBuiltIn && (
          <>
            <button
              className="layout-manager-action-btn"
              onClick={onStartRename}
              title="Rename"
              data-testid={`layout-rename-${layout.id}`}
            >
              Rename
            </button>
            {!layout.isDefault && (
              <button
                className="layout-manager-action-btn"
                onClick={onSetDefault}
                title="Set as default"
                data-testid={`layout-set-default-${layout.id}`}
              >
                Set default
              </button>
            )}
            <button
              className="layout-manager-action-btn layout-manager-action-btn--danger"
              onClick={onDelete}
              disabled={isActive}
              title={isActive ? 'Cannot delete active layout' : 'Delete'}
              data-testid={`layout-delete-${layout.id}`}
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}
