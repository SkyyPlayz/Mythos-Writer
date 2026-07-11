import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent, ReactNode } from 'react';
import { reorderNavConfigItems } from './components/SettingsPanel/settingsPanelTypes';
import './AppNavRail.css';

/** Beta 3 M7: one row of the Stories popover (prototype HTML 179–203). */
export interface NavRailStory {
  id: string;
  title: string;
  active: boolean;
  /** Beta 4 M3: genre · voice · POV line under the title (prototype s.sub). */
  subtitle?: string;
}

export interface AppNavRailProps {
  activeSection: NavRailModuleId;
  onSectionChange: (moduleId: NavRailModuleId) => void;
  onOpenAccount: () => void;
  onOpenSettings: () => void;
  navItems: NavRailItem[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** SKY-3218: honor the user's nav-bar customization (Settings → Nav-bar). */
  showLabels?: boolean;
  showIcons?: boolean;
  /** Beta 3 M3 (Liquid Neon): slot-F breathing border overlay (prototype brRail). */
  neonOverlay?: ReactNode;
  /**
   * Beta 3 M7: Stories popover. When provided, re-clicking the already-active
   * Story Writer item toggles the popover (prototype pick(), HTML 3987)
   * instead of re-selecting the section. Absent → legacy click behavior.
   */
  stories?: NavRailStory[];
  onStorySelect?: (id: string) => void;
  onNewStory?: () => void;
  /**
   * Beta 4 M3: rail edit popover (prototype "CUSTOMIZE NAVIGATION", HTML
   * 216–236). The full ordered module config — hidden items included — plus a
   * change callback that persists reorder/hide across restarts. Absent → the
   * pencil button is not rendered.
   */
  editableItems?: NavRailItemConfig[];
  onEditableItemsChange?: (items: NavRailItemConfig[]) => void;
}

/**
 * Per-module neon slot, from the prototype's modDefs (HTML 3974–3981):
 * editor/notes → slot 1, crafter/brainstorm/timeline → slot 2, graph → slot 3.
 * Unknown ids fall back to slot 1.
 */
const SLOT_BY_MODULE: Partial<Record<NavRailModuleId, number>> = {
  story: 1,
  notes: 1,
  crafter: 2,
  brainstorm: 2,
  timeline: 2,
  graph: 3,
};

/** Prototype 184: story-row book glyph (columns icon, slot-2 tinted). */
function StoryGlyph() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--n2, #9b5fff)"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 21V8l3-3v16M9 21V5l3-2v18M12 21V3l4 3v15M19 21V9l-3-3" />
      <path d="M3 21h18" />
    </svg>
  );
}

/** Prototype 213: settings sliders glyph. */
function SettingsGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <path d="M4.5 7.5h15M4.5 16.5h15" />
      <circle cx="9.5" cy="7.5" r="2.4" />
      <circle cx="14.5" cy="16.5" r="2.4" />
    </svg>
  );
}

/** Prototype 217: rail-edit pencil glyph ("Customize navigation"). */
function PencilGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
      <path d="M14.5 5.5l4 4L8 20H4v-4z" />
    </svg>
  );
}

/** Prototype 221: eye glyph on rail-edit rows (show / hide). */
function EyeGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

/** Prototype 225/226: reorder chevrons on rail-edit rows. */
function ChevronGlyph({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d={direction === 'up' ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
    </svg>
  );
}

export default function AppNavRail({
  activeSection,
  onSectionChange,
  onOpenAccount,
  onOpenSettings,
  navItems,
  collapsed,
  onToggleCollapsed,
  showLabels = true,
  showIcons = true,
  neonOverlay,
  stories,
  onStorySelect,
  onNewStory,
  editableItems,
  onEditableItemsChange,
}: AppNavRailProps) {
  const itemRefs = useRef<HTMLButtonElement[]>([]);
  const [storiesOpen, setStoriesOpen] = useState(false);
  // Beta 4 M3: rail edit popover + drag-reorder source row index.
  const [editOpen, setEditOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // A collapsed (slim) rail only has room for the icon; and when the user
  // hides labels, icons become the only visible affordance — so at least one
  // of the two is always rendered (aria-labels keep every state accessible).
  const renderIcons = showIcons || collapsed || !showLabels;
  const renderLabels = !collapsed && showLabels;
  const storiesEnabled = stories !== undefined;
  const editEnabled = editableItems !== undefined && onEditableItemsChange !== undefined;

  // If the section changes from outside the rail (command palette, Ctrl+Tab),
  // the popover no longer belongs to the active module — drop it.
  useEffect(() => {
    if (activeSection !== 'story') setStoriesOpen(false);
  }, [activeSection]);

  const handleNavKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = itemRefs.current[index + 1];
        if (next) next.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = itemRefs.current[index - 1];
        if (prev) prev.focus();
      }
    },
    [],
  );

  // Prototype pick() (HTML 3987): re-clicking the active Story Writer item
  // toggles the Stories popover; any other pick navigates and closes it.
  const handleItemClick = useCallback(
    (item: NavRailItem) => {
      if (storiesEnabled && item.id === 'story' && activeSection === 'story') {
        setStoriesOpen((open) => !open);
        return;
      }
      setStoriesOpen(false);
      onSectionChange(item.id);
    },
    [storiesEnabled, activeSection, onSectionChange],
  );

  const handleStorySelect = useCallback(
    (id: string) => {
      setStoriesOpen(false);
      onStorySelect?.(id);
    },
    [onStorySelect],
  );

  const handleNewStory = useCallback(() => {
    setStoriesOpen(false);
    onNewStory?.();
  }, [onNewStory]);

  // ── Beta 4 M3: rail edit popover handlers ────────────────────────────────
  // Rows operate on the full ordered config (hidden items included) sorted by
  // order; every mutation re-normalizes order to array positions and hands
  // the whole list to the shell, which persists it (survives restarts).
  // Only sorted while the popover is open — the rail re-renders on every
  // section change and this list is invisible the rest of the time.
  const sortedEditItems = editEnabled && editOpen
    ? [...editableItems].sort((a, b) => a.order - b.order)
    : [];

  const handleToggleVisibility = useCallback(
    (id: NavRailModuleId) => {
      if (!editableItems || !onEditableItemsChange) return;
      onEditableItemsChange(
        editableItems.map((it) => (it.id === id ? { ...it, enabled: !it.enabled } : it)),
      );
    },
    [editableItems, onEditableItemsChange],
  );

  const handleMoveItem = useCallback(
    (from: number, to: number) => {
      if (!editableItems || !onEditableItemsChange) return;
      if (to < 0 || to >= editableItems.length) return;
      const sorted = [...editableItems].sort((a, b) => a.order - b.order);
      onEditableItemsChange(reorderNavConfigItems(sorted, from, to));
    },
    [editableItems, onEditableItemsChange],
  );

  const handleRowDragStart = useCallback((index: number) => (e: DragEvent<HTMLDivElement>) => {
    setDragIndex(index);
    // jsdom drag events carry no DataTransfer — the state index is enough.
    const dt = e.dataTransfer as DataTransfer | null;
    if (dt) {
      dt.effectAllowed = 'move';
      try {
        dt.setData('text/plain', String(index));
      } catch {
        /* some environments expose a read-only DataTransfer */
      }
    }
  }, []);

  const handleRowDrop = useCallback(
    (index: number) => (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (dragIndex !== null && dragIndex !== index) handleMoveItem(dragIndex, index);
      setDragIndex(null);
    },
    [dragIndex, handleMoveItem],
  );

  return (
    <nav
      className={`nav-rail${collapsed ? ' nav-rail--collapsed' : ''}`}
      aria-label="Main navigation"
    >
      {neonOverlay}
      {/* Mythos brand glyph — opens AccountModal */}
      <div className="nav-rail__top">
        <button
          type="button"
          className="nav-rail__brand"
          onClick={onOpenAccount}
          aria-label="Open account"
        >
          <span className="nav-rail__brand-glyph" aria-hidden="true">M</span>
          {!collapsed && <span className="nav-rail__brand-label">Mythos</span>}
        </button>
      </div>

      {/* Section nav items (prototype 173–178) */}
      <div className="nav-rail__nav" role="group" aria-label="Sections">
        {navItems.map((item, index) => {
          const active = activeSection === item.id;
          const slot = SLOT_BY_MODULE[item.id] ?? 1;
          const hasStories = storiesEnabled && item.id === 'story';
          return (
            <button
              key={item.id}
              ref={(el) => {
                if (el) itemRefs.current[index] = el;
              }}
              type="button"
              className={`nav-rail__item nav-rail__item--slot-${slot}${active ? ' nav-rail__item--active' : ''}`}
              onClick={() => handleItemClick(item)}
              onKeyDown={(e) => handleNavKeyDown(e, index)}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              aria-haspopup={hasStories ? 'true' : undefined}
              aria-expanded={hasStories ? storiesOpen : undefined}
              title={item.label}
            >
              {renderIcons && (
                <span className="nav-rail__item-icon" aria-hidden="true">{item.icon}</span>
              )}
              {renderLabels && (
                <span className="nav-rail__item-label">{item.label}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Stories popover (prototype 179–203) */}
      {storiesEnabled && storiesOpen && (
        <>
          <div
            className="nav-rail__stories-backdrop"
            onClick={() => setStoriesOpen(false)}
            data-testid="nav-rail-stories-backdrop"
          />
          <div
            className="nav-rail__stories"
            role="group"
            aria-label="Stories"
            data-testid="nav-rail-stories"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setStoriesOpen(false);
            }}
          >
            <div className="nav-rail__stories-header">STORIES — THIS VAULT</div>
            {stories.map((story) => (
              <button
                key={story.id}
                type="button"
                className="nav-rail__story"
                onClick={() => handleStorySelect(story.id)}
                data-testid={`nav-rail-story-${story.id}`}
              >
                <span className="nav-rail__story-icon" aria-hidden="true"><StoryGlyph /></span>
                <span className="nav-rail__story-text">
                  <span className="nav-rail__story-title">{story.title}</span>
                  {story.subtitle && (
                    <span className="nav-rail__story-sub">{story.subtitle}</span>
                  )}
                </span>
                {story.active && <span className="nav-rail__story-dot" aria-hidden="true" />}
              </button>
            ))}
            <div className="nav-rail__stories-divider" aria-hidden="true" />
            {/* Beta 4 M3: prototype 190–202 — gradient "New Story…" opens the wizard. */}
            <button
              type="button"
              className="nav-rail__new-story"
              onClick={handleNewStory}
              aria-label="New Story"
              data-testid="nav-rail-new-story"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" fill="none" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              New Story…
            </button>
            <div className="nav-rail__stories-hint">
              Opens the story setup window — name it, tune the voice, and link your existing plans.
            </div>
          </div>
        </>
      )}

      {/* Divider + settings + slim toggle — pinned to bottom (prototype 211–238) */}
      <div className="nav-rail__bottom">
        <div className="nav-rail__divider" aria-hidden="true" />
        <button
          type="button"
          className="nav-rail__settings"
          onClick={onOpenSettings}
          aria-label="Open settings"
          title="Settings"
        >
          <span className="nav-rail__settings-icon" aria-hidden="true"><SettingsGlyph /></span>
          {!collapsed && (
            <span className="nav-rail__settings-label">Settings</span>
          )}
        </button>
        {/* Beta 4 M3: prototype 216–236 — pencil (edit popover) + slim toggle.
            Escape is handled on this wrapper so it also works while focus sits
            on the pencil button (the popover is a sibling, not an ancestor,
            of the focused element). */}
        <div
          className="nav-rail__tools"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && editOpen) setEditOpen(false);
          }}
        >
          {editEnabled && (
            <button
              type="button"
              className="nav-rail__edit-btn"
              onClick={() => setEditOpen((open) => !open)}
              aria-label="Customize navigation"
              aria-haspopup="true"
              aria-expanded={editOpen}
              title="Customize navigation"
              data-testid="nav-rail-edit-btn"
            >
              <PencilGlyph />
            </button>
          )}
          <button
            type="button"
            className="nav-rail__toggle"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            title="Slim rail"
          >
            <span aria-hidden="true">{collapsed ? '»' : '«'}</span>
          </button>
          {editEnabled && editOpen && (
            <>
              <div
                className="nav-rail__edit-backdrop"
                onClick={() => setEditOpen(false)}
                data-testid="nav-rail-edit-backdrop"
              />
              <div
                className="nav-rail__edit"
                role="group"
                aria-label="Customize navigation"
                data-testid="nav-rail-edit"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setEditOpen(false);
                }}
              >
                <div className="nav-rail__edit-header">CUSTOMIZE NAVIGATION</div>
                {sortedEditItems.map((item, index) => (
                  <div
                    key={item.id}
                    className={`nav-rail__edit-row${dragIndex === index ? ' nav-rail__edit-row--dragging' : ''}`}
                    draggable
                    onDragStart={handleRowDragStart(index)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleRowDrop(index)}
                    onDragEnd={() => setDragIndex(null)}
                    data-testid={`nav-rail-edit-row-${item.id}`}
                  >
                    <button
                      type="button"
                      className={`nav-rail__edit-eye${item.enabled ? '' : ' nav-rail__edit-eye--hidden'}`}
                      onClick={() => handleToggleVisibility(item.id)}
                      aria-label={`${item.enabled ? 'Hide' : 'Show'} ${item.label}`}
                      aria-pressed={item.enabled}
                      title="Show / hide"
                    >
                      <EyeGlyph />
                    </button>
                    <span className="nav-rail__edit-label">{item.label}</span>
                    <button
                      type="button"
                      className="nav-rail__edit-move"
                      onClick={() => handleMoveItem(index, index - 1)}
                      disabled={index === 0}
                      aria-label={`Move ${item.label} up`}
                    >
                      <ChevronGlyph direction="up" />
                    </button>
                    <button
                      type="button"
                      className="nav-rail__edit-move"
                      onClick={() => handleMoveItem(index, index + 1)}
                      disabled={index === sortedEditItems.length - 1}
                      aria-label={`Move ${item.label} down`}
                    >
                      <ChevronGlyph direction="down" />
                    </button>
                  </div>
                ))}
                <div className="nav-rail__edit-hint">Hide, reorder, or slim — the rail is yours.</div>
              </div>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
