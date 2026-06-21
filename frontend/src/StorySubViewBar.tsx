// SKY-2095 (Phase 2 #2): Story-tab top bar — sub-view toggles + vault badge + writing mode.
import './StorySubViewBar.css';
import type { WritingMode } from './types';

type StorySubView = 'editor' | 'kanban' | 'structure' | 'timeline' | 'book';

interface StorySubViewBarProps {
  activeSubView: string;
  onSubViewChange: (view: StorySubView) => void;
  writingMode: WritingMode;
  onSetWritingMode: (mode: WritingMode) => void;
  onOpenFocusPrefs: () => void;
  vaultName: string;
}

const SUB_VIEWS: { id: StorySubView; label: string }[] = [
  { id: 'editor', label: 'Editor' },
  { id: 'kanban', label: 'Scene Crafter' },
  { id: 'structure', label: 'Structure' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'book', label: 'Book' },
];

export default function StorySubViewBar({
  activeSubView,
  onSubViewChange,
  writingMode,
  onSetWritingMode,
  onOpenFocusPrefs,
  vaultName,
}: StorySubViewBarProps) {
  return (
    <div className="story-subview-bar" data-testid="story-subview-bar">
      {/* Left: Vault badge */}
      <div className="story-subview-bar__vault">
        <span className="story-subview-bar__vault-label" aria-label="Story Vault">
          Story Vault
        </span>
        {vaultName && (
          <span className="story-subview-bar__vault-name" title={vaultName}>
            {vaultName}
          </span>
        )}
      </div>

      {/* Center: Sub-view toggle group */}
      <div
        role="tablist"
        aria-label="Story view"
        className="story-subview-bar__tabs"
      >
        {SUB_VIEWS.map((sv) => (
          <button
            key={sv.id}
            role="tab"
            id={`story-subview-tab-${sv.id}`}
            aria-selected={activeSubView === sv.id}
            aria-controls="app-tabpanel-story"
            tabIndex={activeSubView === sv.id ? 0 : -1}
            className={`story-subview-bar__tab${activeSubView === sv.id ? ' story-subview-bar__tab--active' : ''}`}
            onClick={() => onSubViewChange(sv.id)}
            data-testid={`story-subview-${sv.id}`}
          >
            {sv.label}
          </button>
        ))}
      </div>

      {/* Right: Writing mode switcher */}
      <div className="story-subview-bar__modes" aria-label="Writing mode">
        <button
          className={`story-subview-bar__mode-btn${writingMode === 'normal' ? ' active' : ''}`}
          onClick={() => onSetWritingMode('normal')}
          aria-pressed={writingMode === 'normal'}
          title="Normal mode — full editor + sidebars (Ctrl+Shift+N)"
          data-testid="writing-mode-normal"
        >
          N
        </button>
        <button
          className={`story-subview-bar__mode-btn${writingMode === 'focus' ? ' active' : ''}`}
          onClick={() => onSetWritingMode('focus')}
          aria-pressed={writingMode === 'focus'}
          title="Focus mode — distraction-free"
          data-testid="writing-mode-focus"
        >
          F
        </button>
        {writingMode === 'focus' && (
          <button
            className="story-subview-bar__mode-prefs"
            onClick={onOpenFocusPrefs}
            title="Configure Focus mode panels"
            aria-label="Focus mode preferences"
          >
            ⚙
          </button>
        )}
        <button
          className={`story-subview-bar__mode-btn${writingMode === 'edit' ? ' active' : ''}`}
          onClick={() => onSetWritingMode('edit')}
          aria-pressed={writingMode === 'edit'}
          title="Edit mode — review with Writing Assistant + comments (Ctrl+Shift+E)"
          data-testid="writing-mode-edit"
        >
          E
        </button>
      </div>
    </div>
  );
}
