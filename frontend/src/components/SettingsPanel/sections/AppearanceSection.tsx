import { applyTheme } from '../../../theme';
import { THEME_CHOICES } from '../settingsPanelTypes';

interface AppearanceSectionProps {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  lg: LiquidNeonPrefs;
  onSoftnessChange: (s: number) => void;
  onOpenAdvanced: () => void;
  onRelinkToSlider: () => void;
  onResetAll: () => void;
  resetConfirm: boolean;
  setResetConfirm: (v: boolean) => void;
  setSavedOk: (ok: boolean) => void;
}

export default function AppearanceSection({
  settings,
  setSettings,
  lg,
  onSoftnessChange,
  onOpenAdvanced,
  onRelinkToSlider,
  onResetAll,
  resetConfirm,
  setResetConfirm,
  setSavedOk,
}: AppearanceSectionProps) {
  return (
    <section className="settings-section" aria-labelledby="section-theme" data-settings-cat="appearance">
      <h3 className="settings-section-title" id="section-theme">Appearance</h3>

      {/* Theme mode */}
      <div className="settings-field">
        <div className="settings-radio-group" role="radiogroup" aria-label="Appearance">
          {THEME_CHOICES.map(({ value, label }) => (
            <label key={value} className="settings-radio-label">
              <input
                type="radio"
                name="theme"
                value={value}
                checked={settings.theme === value}
                onChange={() => {
                  setSettings((p) => ({ ...p, theme: value }));
                  applyTheme(value);
                  setSavedOk(false);
                }}
              />
              {label}
            </label>
          ))}
        </div>
        <p className="settings-hint">
          High contrast switches to opaque, AAA-contrast surfaces for accessibility.
        </p>
      </div>

      {/* Main softness↔contrast slider with Advanced button */}
      <div className="settings-field">
        <label className="settings-label" htmlFor="lg-softness">Style</label>
        <div className="lg-slider-band">
          <div className="lg-slider-labeled-row">
            <span className="lg-axis-label">Softness</span>
            <input
              id="lg-softness"
              data-testid="theme-contrast-slider"
              className="settings-slider lg-slider-main"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={lg.softnessContrast}
              aria-label="Softness to Contrast"
              onChange={(e) => onSoftnessChange(Number(e.target.value))}
            />
            <span className="lg-axis-label lg-axis-right">Contrast</span>
          </div>
          <div className="lg-slider-footer">
            {lg.advancedDecoupled && (
              <button
                className="lg-relink-btn"
                type="button"
                onClick={onRelinkToSlider}
              >
                Re-link to slider
              </button>
            )}
            <button
              className="lg-advanced-pill"
              type="button"
              onClick={onOpenAdvanced}
              aria-haspopup="dialog"
            >
              Advanced…
            </button>
          </div>
        </div>
      </div>

      {/* Reset to defaults */}
      <div className="lg-reset-row">
        <button
          className="settings-btn lg-btn-reset"
          type="button"
          onClick={onResetAll}
          aria-label="Reset all appearance settings to defaults"
        >
          {resetConfirm ? 'Confirm reset' : 'Reset to defaults'}
        </button>
        {resetConfirm && (
          <button
            className="settings-btn lg-btn-secondary"
            type="button"
            onClick={() => setResetConfirm(false)}
          >
            Cancel
          </button>
        )}
      </div>

    </section>
  );
}
