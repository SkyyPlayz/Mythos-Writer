import { useCallback, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import './AppNavRail.css';

export interface AppNavRailProps {
  activeSection: AppTab;
  onSectionChange: (tab: AppTab) => void;
  onOpenAccount: () => void;
  onOpenSettings: () => void;
  navItems: NavRailItem[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export default function AppNavRail({
  activeSection,
  onSectionChange,
  onOpenAccount,
  onOpenSettings,
  navItems,
  collapsed,
}: AppNavRailProps) {
  const itemRefs = useRef<HTMLButtonElement[]>([]);

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

  return (
    <nav
      className={`nav-rail${collapsed ? ' nav-rail--collapsed' : ''}`}
      aria-label="Main navigation"
    >
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

      {/* Section nav items */}
      <div className="nav-rail__nav" role="group" aria-label="Sections">
        {navItems.map((item, index) => (
          <button
            key={item.id}
            ref={(el) => {
              if (el) itemRefs.current[index] = el;
            }}
            type="button"
            className={`nav-rail__item${activeSection === item.id ? ' nav-rail__item--active' : ''}`}
            onClick={() => onSectionChange(item.id)}
            onKeyDown={(e) => handleNavKeyDown(e, index)}
            aria-label={item.label}
            aria-current={activeSection === item.id ? 'page' : undefined}
          >
            <span className="nav-rail__item-icon" aria-hidden="true">{item.icon}</span>
            {!collapsed && (
              <span className="nav-rail__item-label">{item.label}</span>
            )}
          </button>
        ))}
      </div>

      {/* Settings — pinned to bottom */}
      <div className="nav-rail__bottom">
        <button
          type="button"
          className="nav-rail__settings"
          onClick={onOpenSettings}
          aria-label="Open settings"
        >
          <span className="nav-rail__settings-icon" aria-hidden="true">⚙</span>
          {!collapsed && (
            <span className="nav-rail__settings-label">Settings</span>
          )}
        </button>
      </div>
    </nav>
  );
}
