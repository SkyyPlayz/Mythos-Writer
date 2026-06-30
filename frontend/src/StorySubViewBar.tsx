// SKY-2095 (Phase 2 #2): Story-tab top bar — sub-view toggles + vault badge.
// SKY-3626: Writing mode (N/F/E) removed from here; lives in the center editor toolbar now.
import './StorySubViewBar.css';

type StorySubView = 'editor' | 'kanban' | 'structure' | 'timeline' | 'book';

interface StorySubViewBarProps {
  activeSubView: string;
  onSubViewChange: (view: StorySubView) => void;
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
    </div>
  );
}
