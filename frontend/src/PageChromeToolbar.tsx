import { useCallback, useId } from 'react';
import { STORY_PAGE_PRESET_WIDTHS, STORY_PAGE_DEFAULTS, type StoryPagePrefs } from './theme';
import './PageChromeToolbar.css';

interface Props {
  prefs: StoryPagePrefs;
  onPrefsChange: (updated: StoryPagePrefs) => void;
}

const PRESETS: Array<{ key: StoryPagePrefs['sizePreset']; label: string }> = [
  { key: 'letter', label: 'Letter' },
  { key: 'a4', label: 'A4' },
  { key: 'a5', label: 'A5' },
  { key: 'manuscript', label: 'Manuscript' },
];

const FONT_OPTIONS: Array<{ key: StoryPagePrefs['fontFamily']; label: string }> = [
  { key: 'serif', label: 'Serif' },
  { key: 'sans', label: 'Sans' },
  { key: 'mono', label: 'Mono' },
];

const MARGIN_MIN = 0;
const MARGIN_MAX = 120;
const FONT_MIN = 12;
const FONT_MAX = 24;

export default function PageChromeToolbar({ prefs, onPrefsChange }: Props) {
  const marginSliderId = useId();
  const fontSizeId = useId();

  const setPreset = useCallback((key: StoryPagePrefs['sizePreset']) => {
    onPrefsChange({ ...prefs, sizePreset: key, customWidthPx: STORY_PAGE_PRESET_WIDTHS[key] });
  }, [prefs, onPrefsChange]);

  const setMargins = useCallback((value: number) => {
    onPrefsChange({ ...prefs, marginVertPx: value, marginHorizPx: value });
  }, [prefs, onPrefsChange]);

  const setFontFamily = useCallback((key: StoryPagePrefs['fontFamily']) => {
    onPrefsChange({ ...prefs, fontFamily: key });
  }, [prefs, onPrefsChange]);

  const setFontSize = useCallback((value: number) => {
    onPrefsChange({ ...prefs, fontSizePx: value });
  }, [prefs, onPrefsChange]);

  const handleReset = useCallback(() => {
    onPrefsChange(STORY_PAGE_DEFAULTS);
  }, [onPrefsChange]);

  const currentMargin = Math.round((prefs.marginVertPx + prefs.marginHorizPx) / 2);
  const effectiveWidthPx =
    prefs.sizePreset === 'custom' && prefs.customWidthPx != null
      ? prefs.customWidthPx
      : (STORY_PAGE_PRESET_WIDTHS[prefs.sizePreset] ?? STORY_PAGE_PRESET_WIDTHS.letter);

  return (
    <div className="pct-toolbar" role="toolbar" aria-label="Page chrome settings">
      {/* Size presets */}
      <div className="pct-group" role="group" aria-label="Page size preset">
        <span className="pct-label" aria-hidden="true">Page</span>
        <div className="pct-presets">
          {PRESETS.map(({ key, label }) => (
            <button
              key={key}
              className={`pct-preset-btn${prefs.sizePreset === key ? ' pct-preset-btn--active' : ''}`}
              onClick={() => setPreset(key)}
              aria-pressed={prefs.sizePreset === key}
              title={`${label} (${STORY_PAGE_PRESET_WIDTHS[key]}px)`}
              type="button"
            >
              {label}
            </button>
          ))}
          {prefs.sizePreset === 'custom' && (
            <span className="pct-custom-width" aria-live="polite">
              {effectiveWidthPx}px
            </span>
          )}
        </div>
      </div>

      <div className="pct-divider" aria-hidden="true" />

      {/* Margin slider */}
      <div className="pct-group" role="group" aria-label="Page margins">
        <label className="pct-label" htmlFor={marginSliderId}>
          Margins
        </label>
        <input
          id={marginSliderId}
          type="range"
          className="pct-slider"
          min={MARGIN_MIN}
          max={MARGIN_MAX}
          step={4}
          value={currentMargin}
          onChange={e => setMargins(Number(e.target.value))}
          aria-valuemin={MARGIN_MIN}
          aria-valuemax={MARGIN_MAX}
          aria-valuenow={currentMargin}
          aria-valuetext={`${currentMargin}px`}
        />
        <span className="pct-slider-val" aria-hidden="true">{currentMargin}px</span>
      </div>

      <div className="pct-divider" aria-hidden="true" />

      {/* Font size */}
      <div className="pct-group" role="group" aria-label="Font size">
        <label className="pct-label" htmlFor={fontSizeId}>
          Font size
        </label>
        <input
          id={fontSizeId}
          type="range"
          className="pct-slider pct-slider--sm"
          min={FONT_MIN}
          max={FONT_MAX}
          step={1}
          value={prefs.fontSizePx}
          onChange={e => setFontSize(Number(e.target.value))}
          aria-valuemin={FONT_MIN}
          aria-valuemax={FONT_MAX}
          aria-valuenow={prefs.fontSizePx}
          aria-valuetext={`${prefs.fontSizePx}px`}
        />
        <span className="pct-slider-val" aria-hidden="true">{prefs.fontSizePx}px</span>
      </div>

      <div className="pct-divider" aria-hidden="true" />

      {/* Font family */}
      <div className="pct-group" role="group" aria-label="Font family">
        {FONT_OPTIONS.map(({ key, label }) => (
          <button
            key={key}
            className={`pct-font-btn pct-font-btn--${key}${prefs.fontFamily === key ? ' pct-font-btn--active' : ''}`}
            onClick={() => setFontFamily(key)}
            aria-pressed={prefs.fontFamily === key}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      <div className="pct-spacer" />

      {/* Reset */}
      <button
        className="pct-reset-btn"
        onClick={handleReset}
        type="button"
        title="Reset page to defaults"
        aria-label="Reset page settings to defaults"
      >
        Reset
      </button>
    </div>
  );
}
