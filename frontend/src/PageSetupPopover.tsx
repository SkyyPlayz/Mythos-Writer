import { useCallback, useId, useRef } from 'react';
import { STORY_PAGE_PRESET_WIDTHS, type StoryPagePrefs } from './theme';
import './PageSetupPopover.css';

export type PageStyle = 'neon' | 'no-glow' | 'scroll' | 'texture' | 'off';

const PAGE_STYLE_OPTIONS: Array<{ key: PageStyle; label: string; description: string }> = [
  { key: 'neon',      label: 'Neon',        description: 'Glowing text on dark background' },
  { key: 'no-glow',   label: 'No Glow',     description: 'Text without glow effect' },
  { key: 'scroll',    label: 'Scroll',       description: 'Continuous scroll, no page boundaries' },
  { key: 'texture',   label: 'Texture',      description: 'Custom background texture' },
  { key: 'off',       label: 'Off',          description: 'Plain light background' },
];

const MARGIN_MIN = 0;
const MARGIN_MAX = 120;
const FONT_MIN = 12;
const FONT_MAX = 24;
const WIDTH_MIN = 520;
const WIDTH_MAX = 3000;

interface Props {
  isOpen: boolean;
  onClose: () => void;
  prefs: StoryPagePrefs;
  onPrefsChange: (p: StoryPagePrefs) => void;
  pageStyle: PageStyle;
  onPageStyleChange: (s: PageStyle) => void;
}

export default function PageSetupPopover({
  isOpen,
  onClose,
  prefs,
  onPrefsChange,
  pageStyle,
  onPageStyleChange,
}: Props) {
  const widthInputId = useId();
  const widthSliderId = useId();
  const marginSliderId = useId();
  const fontSizeId = useId();
  const textureInputRef = useRef<HTMLInputElement>(null);

  const effectiveWidthPx =
    prefs.sizePreset === 'custom' && prefs.customWidthPx != null
      ? prefs.customWidthPx
      : (STORY_PAGE_PRESET_WIDTHS[prefs.sizePreset] ?? STORY_PAGE_PRESET_WIDTHS.letter);

  const setWidth = useCallback((value: number) => {
    const clamped = Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, value));
    onPrefsChange({ ...prefs, sizePreset: 'custom', customWidthPx: clamped });
  }, [prefs, onPrefsChange]);

  const setMargins = useCallback((value: number) => {
    onPrefsChange({ ...prefs, marginVertPx: value, marginHorizPx: value });
  }, [prefs, onPrefsChange]);

  const setFontSize = useCallback((value: number) => {
    onPrefsChange({ ...prefs, fontSizePx: value });
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

  const currentMargin = Math.round((prefs.marginVertPx + prefs.marginHorizPx) / 2);

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
          {pageStyle === 'texture' && (
            <div className="page-setup-popover__texture-upload">
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
              min={WIDTH_MIN}
              max={WIDTH_MAX}
              step={10}
              value={effectiveWidthPx}
              onChange={e => setWidth(Number(e.target.value))}
              aria-label="Page width in pixels"
            />
          </div>
          <input
            id={widthSliderId}
            type="range"
            className="page-setup-popover__slider"
            min={WIDTH_MIN}
            max={WIDTH_MAX}
            step={10}
            value={effectiveWidthPx}
            onChange={e => setWidth(Number(e.target.value))}
            aria-label="Page width slider"
            aria-valuemin={WIDTH_MIN}
            aria-valuemax={WIDTH_MAX}
            aria-valuenow={effectiveWidthPx}
            aria-valuetext={`${effectiveWidthPx}px`}
          />
        </section>

        {/* Margins */}
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
            <span className="page-setup-popover__slider-val" aria-hidden="true">{currentMargin}px</span>
          </div>
        </section>

        {/* Font size */}
        <section className="page-setup-popover__section">
          <h3 className="page-setup-popover__section-title">Font size</h3>
          <div className="page-setup-popover__row">
            <label className="page-setup-popover__label" htmlFor={fontSizeId}>
              Size
            </label>
            <input
              id={fontSizeId}
              type="range"
              className="page-setup-popover__slider"
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
            <span className="page-setup-popover__slider-val" aria-hidden="true">{prefs.fontSizePx}px</span>
          </div>
        </section>
      </div>
    </>
  );
}
