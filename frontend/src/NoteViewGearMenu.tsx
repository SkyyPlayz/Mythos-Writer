/**
 * F4#4 — extracted note view-options gear menu (Rich / optional Markdown /
 * optional Source + Always-open-Rich). Owned by Slice F4; NoteViewer mounts it.
 */
import { type ReactElement } from 'react';
import {
  enabledGearModes,
  type NoteGearMode,
} from './noteViewPrefs';

export interface NoteViewGearMenuProps {
  mode: NoteGearMode | 'preview';
  defaultRich: boolean;
  showMarkdown?: boolean;
  showSource?: boolean;
  onModeClick: (mode: NoteGearMode) => void;
  onToggleDefaultRich: () => void;
  onClose: () => void;
  onCopyPath: () => void;
}

export default function NoteViewGearMenu({
  mode,
  defaultRich,
  showMarkdown,
  showSource,
  onModeClick,
  onToggleDefaultRich,
  onClose,
  onCopyPath,
}: NoteViewGearMenuProps): ReactElement {
  const modes = enabledGearModes({ showMarkdown, showSource });

  return (
    <>
      <div className="note-gear-backdrop" onClick={onClose} />
      <div
        className="note-gear-menu"
        role="menu"
        aria-label="View options"
        data-testid="note-gear-menu"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <div className="note-gear-heading" aria-hidden="true">
          VIEW AS
        </div>
        <div className="note-mode-group" role="group" aria-label="Editor mode">
          {modes.map(({ mode: m, label }) => (
            <button
              key={m}
              type="button"
              role="menuitemradio"
              aria-checked={mode === m}
              className={`note-viewer-mode${mode === m ? ' active' : ''}`}
              data-testid={`note-gear-mode-${m}`}
              onClick={() => onModeClick(m)}
            >
              <span className="note-gear-dot" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        <div className="note-gear-divider" aria-hidden="true" />
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={defaultRich}
          className="note-gear-toggle-row"
          data-testid="note-default-rich-toggle"
          onClick={onToggleDefaultRich}
        >
          <span className="note-gear-toggle-label">Always open notes in Rich view</span>
          <span className={`note-gear-pill${defaultRich ? ' on' : ''}`} aria-hidden="true">
            <span className="note-gear-knob" />
          </span>
        </button>
        <div className="note-gear-divider" aria-hidden="true" />
        <button
          type="button"
          role="menuitem"
          className="note-viewer-mode"
          data-testid="note-copy-path-btn"
          onClick={() => {
            onClose();
            onCopyPath();
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="7" y="7" width="12" height="14" rx="2" />
            <path d="M5 15V4a1 1 0 0 1 1-1h9" />
          </svg>
          Copy path
        </button>
      </div>
    </>
  );
}
