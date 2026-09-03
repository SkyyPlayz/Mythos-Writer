// M1-S3 (SKY-9013): THE page-setup popover — the plan names this component
// canonical (§M1 spec #5a). Opened from the row-5 page chip in the unified
// editor; edits the canonical StoryPagePrefs fields (pageWidthPx /
// pageMarginPx / fontName / fontSizeStep), the same prefs the ruler diamond
// pairs write — two controls, one pref, always in agreement. Page style
// speaks the LiquidNeonPageCfg mode union (the engine ManuscriptView renders).

import { useCallback, useId, useRef } from 'react';
import {
  FONT_STEP_MAX,
  FONT_STEP_MIN,
  PAGE_MARGIN_MIN,
  PAGE_WIDTH_MAX,
  PAGE_WIDTH_MIN,
  STORY_FONT_NAMES,
  maxPageMargin,
  resolveDropCapEnabled,
  resolveFontName,
  resolveFontStep,
  resolvePageMargin,
  resolvePageWidth,
  type StoryFontName,
  type StoryPagePrefs,
} from './theme';
import type { LiquidNeonPageCfg } from './theme/liquidNeonEngine';
import './PageSetupPopover.css';

export type PageStyle = LiquidNeonPageCfg['mode'];

const PAGE_STYLE_OPTIONS: Array<{ key: PageStyle; label: string; description: string }> = [
  { key: 'neon',    label: 'Neon',           description: 'Glowing text on dark background' },
  { key: 'default', label: 'No Glow',        description: 'Text without glow effect' },
  { key: 'scroll',  label: 'Scroll',         description: 'Continuous scroll, no page boundaries' },
  { key: 'custom',  label: 'Custom texture', description: 'Custom background texture' },
  { key: 'off',     label: 'Off',            description: 'Plain light background' },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  prefs: StoryPagePrefs;
  onPrefsChange: (p: StoryPagePrefs) => void;
  pageStyle: PageStyle;
  onPageStyleChange: (s: PageStyle) => void;
  /** Display name for the chosen custom texture image, if any. */
  textureFileName?: string;
  /** Native texture picker (IPC). Absent → the in-popover file input is used. */
  onPickPageTexture?: () => void;
}

export default function PageSetupPopover({
  isOpen,
  onClose,
  prefs,
  onPrefsChange,
  pageStyle,
  onPageStyleChange,
  textureFileName,
  onPickPageTexture,
}: Props) {
  const widthInputId = useId();
  const widthSliderId = useId();
  const marginSliderId = useId();
  const fontNameId = useId();
  const fontSizeId = useId();
  const dropCapId = useId();
  const textureInputRef = useRef<HTMLInputElement>(null);

  const widthPx = resolvePageWidth(prefs);
  const marginPx = resolvePageMargin(prefs);
  const marginMax = maxPageMargin(widthPx);
  const fontName = resolveFontName(prefs);
  const fontStep = resolveFontStep(prefs);
  const dropCapEnabled = resolveDropCapEnabled(prefs);

  const setWidth = useCallback(
    (value: number) => {
      const clamped = Math.max(PAGE_WIDTH_MIN, Math.min(PAGE_WIDTH_MAX, value));
      onPrefsChange({ ...prefs, pageWidthPx: clamped });
    },
    [prefs, onPrefsChange]
  );

  const setMargins = useCallback(
    (value: number) => {
      onPrefsChange({ ...prefs, pageMarginPx: value });
    },
    [prefs, onPrefsChange]
  );

  const setFontName = useCallback(
    (value: StoryFontName) => {
      onPrefsChange({ ...prefs, fontName: value });
    },
    [prefs, onPrefsChange]
  );

  const setFontStep = useCallback(
    (value: number) => {
      onPrefsChange({ ...prefs, fontSizeStep: value });
    },
    [prefs, onPrefsChange]
  );

  const toggleDropCap = useCallback(() => {
    onPrefsChange({ ...prefs, dropCapEnabled: !resolveDropCapEnabled(prefs) });
  }, [prefs, onPrefsChange]);

  const handleTextureFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        try {
          localStorage.setItem('mythos-page-texture', reader.result);
        } catch {
          // storage quota exceeded — silently ignore
        }
      }
    };
    reader.readAsDataURL(file);
  }, []);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop for click-outside close */}
      <div
        className="page-setup-popover__backdrop"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        className="page-setup-popover"
        role="dialog"
        aria-label="Page setup"
        aria-modal="true"
      >
        <div className="page-setup-popover__header">
          <h2 className="page-setup-popover__title">Page Setup</h2>
          <button
            className="page-setup-popover__close"
            onClick={onClose}
            type="button"
            aria-label="Close page setup"
          >
            ✕
          </button>
        </div>

        {/* Page style */}
        <section className="page-setup-popover__section">
          <h3 className="page-setup-popover__section-title">Page style</h3>
          <div className="page-setup-popover__style-grid" role="radiogroup" aria-label="Page style">
            {PAGE_STYLE_OPTIONS.map(({ key, label, description }) => (
              <button
                key={key}
                className={`page-setup-popover__style-btn${pageStyle === key ? ' page-setup-popover__style-btn--active' : ''}`}
                onClick={() => onPageStyleChange(key)}
                aria-pressed={pageStyle === key}
                title={description}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          {pageStyle === 'custom' && (
            <div className="page-setup-popover__texture-upload">
              {onPickPageTexture ? (
                <button
                  type="button"
                  className="page-setup-popover__upload-btn"
                  onClick={onPickPageTexture}
                >
                  {textureFileName ? `Texture: ${textureFileName}` : 'Choose texture image…'}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="page-setup-popover__upload-btn"
                    onClick={() => textureInputRef.current?.click()}
                  >
                    Choose texture image…
                  </button>
                  <input
                    ref={textureInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleTextureFile}
                    aria-label="Upload custom background texture"
                  />
                </>
              )}
            </div>
          )}
        </section>

        {/* Width */}
        <section className="page-setup-popover__section">
          <h3 className="page-setup-popover__section-title">Page width</h3>
          <div className="page-setup-popover__row">
            <label className="page-setup-popover__label" htmlFor={widthInputId}>
              Width (px)
            </label>
            <input
              id={widthInputId}
              type="number"
              className="page-setup-popover__number-input"
              min={PAGE_WIDTH_MIN}
              max={PAGE_WIDTH_MAX}
              step={10}
              value={widthPx}
              onChange={e => setWidth(Number(e.target.value))}
              aria-label="Page width in pixels"
            />
          </div>
          <input
            id={widthSliderId}
            type="range"
            className="page-setup-popover__slider"
            min={PAGE_WIDTH_MIN}
            max={PAGE_WIDTH_MAX}
            step={10}
            value={widthPx}
            onChange={e => setWidth(Number(e.target.value))}
            aria-label="Page width slider"
            aria-valuemin={PAGE_WIDTH_MIN}
            aria-valuemax={PAGE_WIDTH_MAX}
            aria-valuenow={widthPx}
            aria-valuetext={`${widthPx}px`}
          />
        </section>

        {/* Margins — absolute px, symmetric; same pref the ruler's inner
            diamond pair writes, clamped against the current page width. */}
        <section className="page-setup-popover__section">
          <h3 className="page-setup-popover__section-title">Margins</h3>
          <div className="page-setup-popover__row">
            <label className="page-setup-popover__label" htmlFor={marginSliderId}>
              Margin
            </label>
            <input
              id={marginSliderId}
              type="range"
              className="page-setup-popover__slider"
              min={PAGE_MARGIN_MIN}
              max={marginMax}
              step={4}
              value={marginPx}
              onChange={e => setMargins(Number(e.target.value))}
              aria-valuemin={PAGE_MARGIN_MIN}
              aria-valuemax={marginMax}
              aria-valuenow={marginPx}
              aria-valuetext={`${marginPx}px`}
            />
            <span className="page-setup-popover__slider-val" aria-hidden="true">{marginPx}px</span>
          </div>
        </section>

        {/* Font — same prefs the row-5 toolbar's font controls write. */}
        <section className="page-setup-popover__section">
          <h3 className="page-setup-popover__section-title">Font</h3>
          <div className="page-setup-popover__row">
            <label className="page-setup-popover__label" htmlFor={fontNameId}>
              Font
            </label>
            <select
              id={fontNameId}
              className="page-setup-popover__select"
              value={fontName}
              onChange={e => setFontName(e.target.value as StoryFontName)}
              aria-label="Manuscript font"
            >
              {STORY_FONT_NAMES.map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
          <div className="page-setup-popover__row">
            <label className="page-setup-popover__label" htmlFor={fontSizeId}>
              Size
            </label>
            <input
              id={fontSizeId}
              type="range"
              className="page-setup-popover__slider"
              min={FONT_STEP_MIN}
              max={FONT_STEP_MAX}
              step={1}
              value={fontStep}
              onChange={e => setFontStep(Number(e.target.value))}
              aria-valuemin={FONT_STEP_MIN}
              aria-valuemax={FONT_STEP_MAX}
              aria-valuenow={fontStep}
              aria-valuetext={`${fontStep}`}
            />
            <span className="page-setup-popover__slider-val" aria-hidden="true">{fontStep}</span>
          </div>
          <div className="page-setup-popover__row">
            <label className="page-setup-popover__toggle" htmlFor={dropCapId}>
              <input
                id={dropCapId}
                type="checkbox"
                checked={dropCapEnabled}
                aria-label="Drop cap"
                onChange={toggleDropCap}
              />
              <span>Drop cap</span>
            </label>
          </div>
        </section>
      </div>
    </>
  );
}
