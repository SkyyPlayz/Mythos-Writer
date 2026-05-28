import type { FocusPrefs } from './types';
import './FocusModePrefsDialog.css';

interface Props {
  prefs: FocusPrefs;
  onChange: (prefs: FocusPrefs) => void;
  onClose: () => void;
}

export default function FocusModePrefsDialog({ prefs, onChange, onClose }: Props) {
  const toggle = (key: keyof FocusPrefs) => {
    onChange({ ...prefs, [key]: !prefs[key] });
  };

  return (
    <div className="focus-prefs-backdrop" onClick={onClose}>
      <div className="focus-prefs-dialog" role="dialog" aria-modal="true" aria-label="Focus Mode preferences" onClick={(e) => e.stopPropagation()}>
        <div className="focus-prefs-header">
          <span className="focus-prefs-title">Focus Mode</span>
          <button className="focus-prefs-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <p className="focus-prefs-desc">Choose which panels stay visible in Focus mode.</p>
        <label className="focus-prefs-row">
          <input type="checkbox" checked={prefs.showLeftSidebar} onChange={() => toggle('showLeftSidebar')} />
          Show left sidebar
        </label>
        <label className="focus-prefs-row">
          <input type="checkbox" checked={prefs.showRightSidebar} onChange={() => toggle('showRightSidebar')} />
          Show right sidebar
        </label>
        <label className="focus-prefs-row">
          <input type="checkbox" checked={prefs.showBottomBar} onChange={() => toggle('showBottomBar')} />
          Show bottom bar
        </label>
      </div>
    </div>
  );
}
