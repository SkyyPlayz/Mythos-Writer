// SKY-1700 (Wave 2f): Layout picker toolbar button + dropdown.
import { useState, useRef, useEffect, useCallback } from 'react';
import './LayoutPicker.css';

interface Props {
  layouts: WorkspaceLayout[];
  activeLayoutId: string | null;
  hasUnsavedChanges: boolean;
  /** When true, opens the dropdown (e.g. from keyboard shortcut). */
  forceOpen?: boolean;
  onForceOpenConsumed?: () => void;
  onSelectLayout: (layoutId: string) => void;
  onSaveCurrentAs: () => void;
  onManage: () => void;
}

export default function LayoutPicker({
  layouts,
  activeLayoutId,
  hasUnsavedChanges,
  forceOpen,
  onForceOpenConsumed,
  onSelectLayout,
  onSaveCurrentAs,
  onManage,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const activeLayout = layouts.find((l) => l.id === activeLayoutId) ?? null;
  const label = activeLayout?.name ?? 'Custom';

  // Keyboard shortcut: Ctrl+Shift+L drives forceOpen from parent.
  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
      onForceOpenConsumed?.();
    }
  }, [forceOpen, onForceOpenConsumed]);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => document.removeEventListener('pointerdown', onPointerDown, { capture: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const builtinLayouts = layouts.filter((l) => l.isBuiltIn);
  const userLayouts = layouts.filter((l) => !l.isBuiltIn);

  function handleSelect(id: string) {
    onSelectLayout(id);
    setOpen(false);
  }

  function handleSaveAs() {
    onSaveCurrentAs();
    setOpen(false);
  }

  function handleManage() {
    onManage();
    setOpen(false);
  }

  return (
    <div className="layout-picker" ref={rootRef}>
      <button
        className="layout-picker-btn"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Layout: ${label}`}
        data-testid="layout-picker-btn"
        title="Layout picker (Ctrl+Shift+L)"
      >
        <span className="layout-picker-btn-label">{label}</span>
        <span className="layout-picker-caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div
          className="layout-picker-dropdown"
          role="listbox"
          aria-label="Workspace layouts"
          data-testid="layout-picker-dropdown"
        >
          {hasUnsavedChanges && activeLayoutId && (
            <div className="layout-unsaved-nudge" role="status">
              Unsaved changes to &ldquo;{activeLayout?.name}&rdquo;
            </div>
          )}

          {builtinLayouts.length > 0 && (
            <>
              <div className="layout-picker-section-label">Built-in</div>
              {builtinLayouts.map((layout) => (
                <LayoutItem
                  key={layout.id}
                  layout={layout}
                  isActive={layout.id === activeLayoutId}
                  onSelect={handleSelect}
                />
              ))}
            </>
          )}

          {userLayouts.length > 0 && (
            <>
              <div className="layout-picker-section-label">My Layouts</div>
              {userLayouts.map((layout) => (
                <LayoutItem
                  key={layout.id}
                  layout={layout}
                  isActive={layout.id === activeLayoutId}
                  onSelect={handleSelect}
                />
              ))}
            </>
          )}

          <div className="layout-picker-divider" />
          <button
            className="layout-picker-action"
            onClick={handleSaveAs}
            data-testid="layout-save-as-btn"
          >
            + Save current as…
          </button>
          <button
            className="layout-picker-action"
            onClick={handleManage}
            data-testid="layout-manage-btn"
          >
            ⚙ Manage layouts…
          </button>
        </div>
      )}
    </div>
  );
}

function LayoutItem({
  layout,
  isActive,
  onSelect,
}: {
  layout: WorkspaceLayout;
  isActive: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      className={`layout-picker-item${isActive ? ' layout-picker-item--active' : ''}`}
      role="option"
      aria-selected={isActive}
      onClick={() => onSelect(layout.id)}
      data-testid={`layout-item-${layout.id}`}
    >
      <span className="layout-picker-item-check" aria-hidden="true">
        {isActive ? '✓' : ''}
      </span>
      <span className="layout-picker-item-name">{layout.name}</span>
      {layout.isDefault && (
        <span className="layout-picker-item-default-badge" aria-label="Default layout">
          DEFAULT
        </span>
      )}
    </button>
  );
}
