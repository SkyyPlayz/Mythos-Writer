// SKY-2095 (Phase 2 #2): Story-tab top bar — sub-view toggles + vault badge.
// PLAN-058 L5 (37:22): N/F/E live here; center editor toolbar no longer hosts them.
import './StorySubViewBar.css';

export type WritingMode = 'normal' | 'focus' | 'edit';

// Slice B: Story strip = Editor · Book · Structure only.
// Coach = Writer hand mode on the partner; Beta Reader reached from partner.
type StorySubView = 'editor' | 'coach' | 'structure' | 'book';

interface StorySubViewBarProps {
  activeSubView: string;
  onSubViewChange: (view: StorySubView) => void;
  vaultName: string;
  /** Kept for call-site compat; Coach tab is removed regardless (Slice B). */
  aiEnabled: boolean;
  writingMode: WritingMode;
  onWritingModeChange: (mode: WritingMode) => void;
  onOpenFocusPrefs: () => void;
}

const SUB_VIEWS: { id: StorySubView; label: string }[] = [
  { id: 'editor', label: 'Editor' },
  { id: 'book', label: 'Book' },
  { id: 'structure', label: 'Structure' },
];

export default function StorySubViewBar({
  activeSubView,
  onSubViewChange,
  vaultName,
  aiEnabled: _aiEnabled,
  writingMode,
  onWritingModeChange,
  onOpenFocusPrefs,
}: StorySubViewBarProps) {
  void _aiEnabled;
  // Legacy 'coach' sub-view → treat Editor as selected in the strip.
  const selected = activeSubView === 'coach' ? 'editor' : activeSubView;
  return (
    <div className="story-subview-bar" data-testid="story-subview-bar">
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
            aria-selected={selected === sv.id}
            aria-controls="app-tabpanel-story"
            tabIndex={selected === sv.id ? 0 : -1}
            className={`story-subview-bar__tab${selected === sv.id ? ' story-subview-bar__tab--active' : ''}`}
            onClick={() => onSubViewChange(sv.id)}
            data-testid={`story-subview-${sv.id}`}
          >
            {sv.label}
          </button>
        ))}
      </div>

      <div className="story-subview-bar__spacer" aria-hidden="true" style={{ flex: 1 }} />

      <div className="story-subview-bar__modes" aria-label="Writing mode" data-testid="nfe-mode-group">
        <button
          type="button"
          className={`story-subview-bar__mode-btn${writingMode === 'normal' ? ' active' : ''}`}
          onClick={() => onWritingModeChange('normal')}
          aria-pressed={writingMode === 'normal'}
          title="Normal mode — full editor + sidebars (Ctrl+Shift+N)"
          data-testid="writing-mode-normal"
        >
          N
        </button>
        <button
          type="button"
          className={`story-subview-bar__mode-btn${writingMode === 'focus' ? ' active' : ''}`}
          onClick={() => onWritingModeChange('focus')}
          aria-pressed={writingMode === 'focus'}
          title="Focus mode — distraction-free"
          data-testid="writing-mode-focus"
        >
          F
        </button>
        {writingMode === 'focus' && (
          <button
            type="button"
            className="story-subview-bar__mode-prefs"
            onClick={onOpenFocusPrefs}
            title="Configure Focus mode panels"
            aria-label="Focus mode preferences"
          >
            ⚙
          </button>
        )}
        <button
          type="button"
          className={`story-subview-bar__mode-btn${writingMode === 'edit' ? ' active' : ''}`}
          onClick={() => onWritingModeChange('edit')}
          aria-pressed={writingMode === 'edit'}
          title="Edit mode — review with Writing Coach + comments (Ctrl+Shift+E)"
          data-testid="writing-mode-edit"
        >
          E
        </button>
      </div>
    </div>
  );
}
