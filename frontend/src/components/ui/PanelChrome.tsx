import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { AddCatalog, CatalogEntry } from '../../frame/globalCatalog';
import './PanelChrome.css';

/** F2#12 — re-export shared top-bar metrics for F1 Story toolbar consumers. */
export {
  PANEL_TOP_BAR_HEIGHT_PX,
  PANEL_TOP_BAR_HEIGHT_VAR,
} from '../../lib/panelChromeMetrics';

interface PanelChromeProps {
  children: React.ReactNode;
  className?: string;
}

interface PanelHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

interface PanelBodyProps {
  children: React.ReactNode;
  className?: string;
}

interface PanelFooterProps {
  children: React.ReactNode;
  className?: string;
}

export function PanelChrome({ children, className }: PanelChromeProps) {
  const cls = className ? `pc-chrome ${className}` : 'pc-chrome';
  return <div className={cls}>{children}</div>;
}

export function PanelHeader({ title, subtitle, icon, actions, className }: PanelHeaderProps) {
  const cls = className ? `pc-header ${className}` : 'pc-header';
  // Critic #6 / N7: production never mounts PanelChrome (.pc-chrome), so the
  // @container wrap must live on a real ancestor of .pc-header. This host is
  // that ancestor — at ≤320px the header wraps instead of clipping.
  return (
    <div className="pc-header-host">
      <div className={cls}>
        <div className="pc-header-start">
          {icon !== undefined && <div className="pc-header-icon">{icon}</div>}
          <div className="pc-header-title-group">
            <div className="pc-header-title">{title}</div>
            {subtitle !== undefined && <div className="pc-header-subtitle">{subtitle}</div>}
          </div>
        </div>
        {actions !== undefined && <div className="pc-header-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function PanelBody({ children, className }: PanelBodyProps) {
  const cls = className ? `pc-body ${className}` : 'pc-body';
  return <div className={cls}>{children}</div>;
}

export function PanelFooter({ children, className }: PanelFooterProps) {
  const cls = className ? `pc-footer ${className}` : 'pc-footer';
  return <div className={cls}>{children}</div>;
}

// ── W1 widget shell: in-page panel dock + scoped Add menu ─────────────────────

export interface PageDockTab {
  id: string;
  label: string;
}

interface PageDockProps {
  /** Design panel id (e.g. `edPanel`); written to `data-panel-id`. */
  panelId: string;
  /** Panel scope (e.g. `page:editor`); written to `data-scope`. */
  scope: string;
  label: string;
  side: 'left' | 'right';
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Optional page tabs. When set, the dock follows the WAI-ARIA tabs pattern. */
  tabs?: readonly PageDockTab[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
  width?: number;
  testId?: string;
  children: React.ReactNode;
}

const DOCK_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
  minHeight: 0,
  overflow: 'hidden',
  background: 'var(--bg-panel, var(--bg-elevated))',
  borderInlineStart: '1px solid var(--border-subtle)',
};

const DOCK_TAB_STYLE: React.CSSProperties = {
  flex: 1,
  padding: 'var(--space-2) var(--space-3)',
  background: 'transparent',
  border: 0,
  borderBottom: '2px solid transparent',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  fontSize: 'var(--text-xs)',
};

/**
 * A page panel that lives inside its page window (W1). Collapsing hides the
 * body with the `hidden` attribute, so the panel's content stays mounted and
 * nothing next to it (e.g. the editor) re-renders into a new tree.
 */
export function PageDock({
  panelId,
  scope,
  label,
  side,
  collapsed,
  onToggleCollapsed,
  tabs,
  activeTab,
  onTabChange,
  width = 300,
  testId,
  children,
}: PageDockProps) {
  const baseId = useId();
  const bodyId = `${baseId}-body`;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const currentTab = tabs?.find((tab) => tab.id === activeTab) ?? tabs?.[0];
  const tabDomId = (id: string) => `${baseId}-tab-${id}`;
  const panelDomId = `${baseId}-tabpanel`;

  const moveFocus = useCallback(
    (index: number) => {
      if (!tabs || tabs.length === 0) return;
      const next = (index + tabs.length) % tabs.length;
      const tab = tabs[next];
      if (!tab) return;
      onTabChange?.(tab.id);
      tabRefs.current[next]?.focus();
    },
    [tabs, onTabChange],
  );

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!tabs) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); moveFocus(index + 1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); moveFocus(index - 1); }
    else if (event.key === 'Home') { event.preventDefault(); moveFocus(0); }
    else if (event.key === 'End') { event.preventDefault(); moveFocus(tabs.length - 1); }
  };

  const collapseLabel = collapsed ? `Expand ${label}` : `Collapse ${label}`;
  const chevron = (side === 'right') === collapsed ? '\u2039' : '\u203a';

  return (
    <section
      className={`pc-dock pc-dock--${side}${collapsed ? ' pc-dock--collapsed' : ''}`}
      aria-label={label}
      data-panel-id={panelId}
      data-scope={scope}
      data-collapsed={collapsed ? 'true' : 'false'}
      data-testid={testId}
      style={{ ...DOCK_STYLE, width: collapsed ? 'auto' : width }}
    >
      <PanelHeader
        title={collapsed ? '' : label}
        actions={
          <button
            type="button"
            className="pc-dock-collapse"
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            aria-label={collapseLabel}
            title={collapseLabel}
            onClick={onToggleCollapsed}
            data-testid={testId ? `${testId}-collapse` : undefined}
          >
            <span aria-hidden="true">{chevron}</span>
          </button>
        }
      />
      <div id={bodyId} hidden={collapsed} style={{ display: collapsed ? 'none' : 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {tabs && tabs.length > 0 && (
          <div role="tablist" aria-label={`${label} tabs`} style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)' }}>
            {tabs.map((tab, index) => {
              const selected = tab.id === currentTab?.id;
              return (
                <button
                  key={tab.id}
                  ref={(el) => { tabRefs.current[index] = el; }}
                  type="button"
                  role="tab"
                  id={tabDomId(tab.id)}
                  aria-selected={selected}
                  aria-controls={panelDomId}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => onTabChange?.(tab.id)}
                  onKeyDown={(event) => onTabKeyDown(event, index)}
                  data-testid={testId ? `${testId}-tab-${tab.id}` : undefined}
                  style={{
                    ...DOCK_TAB_STYLE,
                    ...(selected ? { color: 'var(--text-header)', borderBottomColor: 'var(--n1, currentColor)' } : {}),
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        )}
        <div
          {...(tabs && tabs.length > 0 && currentTab
            ? { role: 'tabpanel', id: panelDomId, 'aria-labelledby': tabDomId(currentTab.id), tabIndex: 0 }
            : {})}
          style={{ flex: 1, minHeight: 0, overflow: 'auto' }}
        >
          {children}
        </div>
      </div>
    </section>
  );
}

interface AddPanelMenuProps {
  catalog: AddCatalog;
  onAdd: (id: CatalogEntry['id']) => void;
  testId?: string;
}

const POPOVER_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  insetInlineEnd: 0,
  zIndex: 60,
  minWidth: 240,
  padding: 'var(--space-2)',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
};

const SECTION_TITLE_STYLE: React.CSSProperties = {
  margin: 'var(--space-2) var(--space-2) var(--space-1)',
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
};

const ITEM_STYLE: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'start',
  padding: 'var(--space-2)',
  background: 'transparent',
  border: 0,
  borderRadius: 'var(--radius-md, 6px)',
  color: 'var(--text-body)',
  cursor: 'pointer',
  fontSize: 'var(--text-sm)',
};

const NOTE_STYLE: React.CSSProperties = {
  margin: '0 var(--space-2) var(--space-2)',
  fontSize: 'var(--text-xs)',
  color: 'var(--text-muted)',
};

function AddPanelSection({
  title,
  entries,
  emptyText,
  sectionKey,
  testId,
  onPick,
}: {
  title: string;
  entries: CatalogEntry[];
  emptyText: string;
  sectionKey: 'global' | 'page';
  testId: string;
  onPick: (id: CatalogEntry['id']) => void;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-testid={`${testId}-section-${sectionKey}`}>
      <h3 id={headingId} style={SECTION_TITLE_STYLE}>{title}</h3>
      {entries.length === 0 ? (
        <p style={NOTE_STYLE}>{emptyText}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {entries.map((entry) => {
            const reasonId = `${headingId}-${entry.id}-reason`;
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  disabled={entry.inert}
                  aria-describedby={entry.reason ? reasonId : undefined}
                  onClick={() => onPick(entry.id)}
                  data-testid={`${testId}-item-${entry.id}`}
                  data-scope={entry.scope}
                  data-kind={entry.kind}
                  style={{ ...ITEM_STYLE, ...(entry.inert ? { opacity: 0.55, cursor: 'not-allowed' } : {}) }}
                >
                  {entry.label}
                </button>
                {entry.reason && <p id={reasonId} style={NOTE_STYLE}>{entry.reason}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * W1 Add-panel control: a disclosure button that opens two sections, Global
 * panels (for the sidebars) and On this page (opens inside the page window).
 * Escape or a click outside closes it and returns focus to the button.
 */
export function AddPanelMenu({ catalog, onAdd, testId = 'add-panel' }: AddPanelMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open, close]);

  const pick = (id: CatalogEntry['id']) => {
    onAdd(id);
    close(true);
  };

  return (
    <div
      ref={rootRef}
      className="pc-add-panel"
      style={{ position: 'relative' }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true); }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="pc-add-panel-btn"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-label="Add panel"
        title="Add panel"
        onClick={() => setOpen((value) => !value)}
        data-testid={`${testId}-btn`}
      >
        <span aria-hidden="true">+</span>
      </button>
      {open && (
        <div id={popoverId} data-testid={`${testId}-popover`} style={POPOVER_STYLE}>
          <AddPanelSection
            title="Global panels"
            entries={catalog.global}
            emptyText="Every global panel is already open."
            sectionKey="global"
            testId={testId}
            onPick={pick}
          />
          <AddPanelSection
            title="On this page"
            entries={catalog.page}
            emptyText="This page's panels are already open."
            sectionKey="page"
            testId={testId}
            onPick={pick}
          />
        </div>
      )}
    </div>
  );
}
