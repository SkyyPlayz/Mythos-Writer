import type { FocusPrefs } from '../../../types';
import { FOCUS_PREFS_DEFAULTS } from '../settingsPanelTypes';

interface FocusModeSectionProps {
  focusPrefs?: FocusPrefs;
  onFocusPrefsChange?: (prefs: FocusPrefs) => void;
}

export default function FocusModeSection({ focusPrefs, onFocusPrefsChange }: FocusModeSectionProps) {
  if (!onFocusPrefsChange) return null;

  return (
    <section className="settings-section" aria-labelledby="section-focus-mode" data-settings-cat="appearance">
      <h3 className="settings-section-title" id="section-focus-mode">Focus Mode</h3>
      <p className="settings-hint">Choose which UI elements stay visible in Focus Mode and Distraction-Free mode. Changes apply immediately.</p>
      {(
        [
          { key: 'showTitleBar',       label: 'Show title bar' },
          { key: 'showStatusBar',       label: 'Show status bar' },
          { key: 'showTabBar',          label: 'Show tabs' },
          { key: 'showSidebarButtons',  label: 'Show sidebar collapse buttons' },
          { key: 'showScrollbars',      label: 'Show scrollbars' },
          { key: 'showFileTreeArrows',  label: 'Show file tree toggle arrows' },
        ] as const
      ).map(({ key, label }) => {
        const checked = focusPrefs ? focusPrefs[key] : FOCUS_PREFS_DEFAULTS[key];
        return (
          <label key={key} className="settings-focus-toggle">
            <input
              type="checkbox"
              checked={checked}
              aria-label={label}
              onChange={() => {
                if (!focusPrefs || !onFocusPrefsChange) return;
                onFocusPrefsChange({ ...focusPrefs, [key]: !checked });
              }}
            />
            <span className="settings-label">{label}</span>
          </label>
        );
      })}
      <div className="settings-input-row" style={{ marginTop: 8 }}>
        <button
          className="settings-btn settings-btn-secondary"
          type="button"
          onClick={() => {
            if (!focusPrefs || !onFocusPrefsChange) return;
            onFocusPrefsChange({ ...focusPrefs, ...FOCUS_PREFS_DEFAULTS });
          }}
        >
          Reset to defaults
        </button>
      </div>
    </section>
  );
}
