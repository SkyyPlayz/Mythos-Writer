import { useCallback, useId } from 'react';
import { STORY_PAGE_PRESET_WIDTHS, STORY_PAGE_DEFAULTS, type StoryPagePrefs } from './theme';
import { RULER_WIDTH_MAX, RULER_WIDTH_MIN, clampWidth } from './pageRulerMath';
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
const LINE_HEIGHT_MIN = 1.2;
const LINE_HEIGHT_MAX = 2.4;
const LINE_HEIGHT_STEP = 0.1;

export default function PageChromeToolbar({ prefs, onPrefsChange }: Props) {
  const marginSliderId = useId();
  const widthSliderId = useId();
  const fontSizeId = useId();
  const lineHeightId = useId();

  const setPreset = useCallback((key: StoryPagePrefs['sizePreset']) => {
    onPrefsChange({ ...prefs, sizePreset: key, customWidthPx: STORY_PAGE_PRESET_WIDTHS[key] });
  }, [prefs, onPrefsChange]);

  // GH #842 / Beta 3 M10: free page-width slider — writes the same pref the
  // ruler's edge handles drag, so the two controls always agree.
  const setWidth = useCallback((value: number) => {
    onPrefsChange({ ...prefs, sizePreset: 'custom', customWidthPx: clampWidth(value) });
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

  const setLineHeight = useCallback((value: number) => {
    onPrefsChange({ ...prefs, lineHeight: value });
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

      {/* Page width slider (GH #842 / M10) */}
      <div className="pct-group" role="group" aria-label="Page width">
        <label className="pct-label" htmlFor={widthSliderId}>
          Width
        </label>
        <input
          id={widthSliderId}
          type="range"
          className="pct-slider"
          min={RULER_WIDTH_MIN}
          max={RULER_WIDTH_MAX}
          step={10}
          value={effectiveWidthPx}
          onChange={e => setWidth(Number(e.target.value))}
          aria-valuemin={RULER_WIDTH_MIN}
          aria-valuemax={RULER_WIDTH_MAX}
          aria-valuenow={effectiveWidthPx}
          aria-valuetext={`${effectiveWidthPx}px`}
        />
        <span className="pct-slider-val" aria-hidden="true">{effectiveWidthPx}px</span>
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

      {/* Line spacing */}
      <div className="pct-group" role="group" aria-label="Line spacing">
        <label className="pct-label" htmlFor={lineHeightId}>
          Line spacing
        </label>
        <input
          id={lineHeightId}
          type="range"
          className="pct-slider pct-slider--sm"
          min={LINE_HEIGHT_MIN}
          max={LINE_HEIGHT_MAX}
          step={LINE_HEIGHT_STEP}
          value={prefs.lineHeight}
          onChange={e => setLineHeight(Number(e.target.value))}
          aria-valuemin={LINE_HEIGHT_MIN}
          aria-valuemax={LINE_HEIGHT_MAX}
          aria-valuenow={prefs.lineHeight}
          aria-valuetext={`${prefs.lineHeight.toFixed(1)}×`}
        />
        <span className="pct-slider-val" aria-hidden="true">{prefs.lineHeight.toFixed(1)}×</span>
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
