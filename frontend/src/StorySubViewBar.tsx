// SKY-2095 (Phase 2 #2): Story-tab top bar — sub-view toggles + vault badge.
// SKY-3626: Writing mode (N/F/E) removed from here; lives in the center editor toolbar now.
import './StorySubViewBar.css';

// Slice B: Story strip = Editor · Book · Structure only.
// Coach = Writer hand mode on the partner; Beta Reader reached from partner.
type StorySubView = 'editor' | 'coach' | 'structure' | 'book';

interface StorySubViewBarProps {
  activeSubView: string;
  onSubViewChange: (view: StorySubView) => void;
  vaultName: string;
  /** Kept for call-site compat; Coach tab is removed regardless (Slice B). */
  aiEnabled: boolean;
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
    </div>
  );
}
