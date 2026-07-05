import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import './AppNavRail.css';

/** Beta 3 M7: one row of the Stories popover (prototype HTML 179–203). */
export interface NavRailStory {
  id: string;
  title: string;
  active: boolean;
}

export interface AppNavRailProps {
  activeSection: AppTab;
  onSectionChange: (tab: AppTab) => void;
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
}

/**
 * Per-module neon slot, from the prototype's modDefs (HTML 3974–3981):
 * editor/notes → slot 1, crafter/brainstorm/timeline → slot 2, graph → slot 3.
 * Unknown ids fall back to slot 1.
 */
const SLOT_BY_TAB: Partial<Record<AppTab, number>> = {
  story: 1,
  notes: 1,
  brainstorm: 2,
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
}: AppNavRailProps) {
  const itemRefs = useRef<HTMLButtonElement[]>([]);
  const [storiesOpen, setStoriesOpen] = useState(false);

  // A collapsed (slim) rail only has room for the icon; and when the user
  // hides labels, icons become the only visible affordance — so at least one
  // of the two is always rendered (aria-labels keep every state accessible).
  const renderIcons = showIcons || collapsed || !showLabels;
  const renderLabels = !collapsed && showLabels;
  const storiesEnabled = stories !== undefined;

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
          const slot = SLOT_BY_TAB[item.id] ?? 1;
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
                <span className="nav-rail__story-title">{story.title}</span>
                {story.active && <span className="nav-rail__story-dot" aria-hidden="true" />}
              </button>
            ))}
            <div className="nav-rail__stories-divider" aria-hidden="true" />
            <button
              type="button"
              className="nav-rail__story nav-rail__story--new"
              onClick={handleNewStory}
              aria-label="New Story"
              data-testid="nav-rail-new-story"
            >
              <span className="nav-rail__story-icon nav-rail__story-icon--new" aria-hidden="true">+</span>
              <span className="nav-rail__story-title">New Story</span>
            </button>
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
        <button
          type="button"
          className="nav-rail__toggle"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          title="Slim rail"
        >
          <span aria-hidden="true">{collapsed ? '»' : '«'}</span>
        </button>
      </div>
    </nav>
  );
}
