// SKY-2094 (Phase 2 #1): Top-level two-tab switcher — Story / Notes.
import { useRef, useCallback } from 'react';
import './TabBar.css';

interface TabBarProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
}

const TABS: { id: AppTab; label: string; icon: string; shortcutHint: string }[] = [
  { id: 'story', label: 'Story', icon: '📖', shortcutHint: 'Ctrl+1' },
  { id: 'notes', label: 'Notes', icon: '📁', shortcutHint: 'Ctrl+2' },
];

export default function TabBar({ activeTab, onTabChange }: TabBarProps) {
  const tabRefs = useRef<Record<AppTab, HTMLButtonElement | null>>({
    story: null,
    notes: null,
  });

  const setRef = useCallback(
    (id: AppTab) => (el: HTMLButtonElement | null) => {
      tabRefs.current[id] = el;
    },
    [],
  );

  function handleKeyDown(e: React.KeyboardEvent, tabId: AppTab) {
    const ids = TABS.map((t) => t.id);
    const idx = ids.indexOf(tabId);
    let target: AppTab | null = null;

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      target = ids[(idx + 1) % ids.length];
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      target = ids[(idx - 1 + ids.length) % ids.length];
    } else if (e.key === 'Home') {
      e.preventDefault();
      target = ids[0];
    } else if (e.key === 'End') {
      e.preventDefault();
      target = ids[ids.length - 1];
    }

    if (target) {
      onTabChange(target);
      tabRefs.current[target]?.focus();
    }
  }

  return (
    <div className="tab-bar" data-testid="app-tab-bar">
      <div role="tablist" aria-label="App sections" className="tab-bar__list">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            ref={setRef(tab.id)}
            role="tab"
            id={`app-tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`app-tabpanel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={`tab-bar__tab${activeTab === tab.id ? ' tab-bar__tab--active' : ''}`}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, tab.id)}
            title={`${tab.label} (${tab.shortcutHint})`}
            data-testid={`app-tab-${tab.id}`}
          >
            <span className="tab-bar__icon" aria-hidden="true">{tab.icon}</span>
            <span className="tab-bar__label">{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
