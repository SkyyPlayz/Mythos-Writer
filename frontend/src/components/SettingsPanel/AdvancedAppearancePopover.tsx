import { useState, useCallback } from 'react';
import { applyLiquidNeonTokens, DEFAULT_BG_GRADIENT } from '../../theme';
import { LG_DEFAULTS, BG_POSITIONS } from './settingsPanelTypes';
import { ColorPicker } from './ColorPicker';

interface AdvancedAppearancePopoverProps {
  lg: LiquidNeonPrefs;
  setLg: React.Dispatch<React.SetStateAction<LiquidNeonPrefs>>;
  setLgField: <K extends keyof LiquidNeonPrefs>(key: K, value: LiquidNeonPrefs[K]) => void;
  bgPreviewUrl: string | null;
  setBgPreviewUrl: (url: string | null) => void;
  setSavedOk: (ok: boolean) => void;
  onClose: () => void;
  onRelinkToSlider: () => void;
  onResetAll: () => void;
  resetConfirm: boolean;
  setResetConfirm: (v: boolean) => void;
  popoverRef: React.RefObject<HTMLDivElement>;
}

export default function AdvancedAppearancePopover({
  lg,
  setLg,
  setLgField,
  bgPreviewUrl,
  setBgPreviewUrl,
  setSavedOk,
  onClose,
  onRelinkToSlider,
  onResetAll,
  resetConfirm,
  setResetConfirm,
  popoverRef,
}: AdvancedAppearancePopoverProps) {
  const [bgPickBusy, setBgPickBusy] = useState(false);

  const handlePickBgImage = useCallback(async () => {
    if (bgPickBusy) return;
    setBgPickBusy(true);
    try {
      const res = await window.api.pickBgImage?.();
      if (res?.filePath && !res.cancelled) {
        const loadRes = await window.api.loadBgImage?.(res.filePath);
        const dataUrl: string | null = loadRes?.dataUrl ?? null;
        setBgPreviewUrl(dataUrl);
        setLg((prev) => {
          const next = { ...prev, background: res.filePath as string, bgMode: 'image' as const };
          applyLiquidNeonTokens(next, dataUrl);
          return next;
        });
        setSavedOk(false);
      }
    } catch {
      // non-fatal
    } finally {
      setBgPickBusy(false);
    }
  }, [bgPickBusy, setBgPreviewUrl, setLg, setSavedOk]);

  const handleResetBg = useCallback(() => {
    setBgPreviewUrl(null);
    setLg((prev) => {
      const next = { ...prev, background: 'default' as const, bgMode: 'color' as const };
      applyLiquidNeonTokens(next, null);
      return next;
    });
    setSavedOk(false);
  }, [setBgPreviewUrl, setLg, setSavedOk]);


  const effectiveBg = lg.bgBaseColor ?? LG_DEFAULTS.bgBaseColor!;

  return (
    <div
      className="lg-popover-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="lg-popover"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lg-popover-title"
        ref={popoverRef}
      >
        <div className="lg-popover-header">
          <h3 id="lg-popover-title" className="lg-popover-title">Advanced UI settings</h3>
          <button
            className="settings-close"
            type="button"
            onClick={onClose}
            aria-label="Close advanced UI settings"
          >
            ✕
          </button>
        </div>

        <div className="lg-popover-body">

          {/* ── B1–B3: Per-value sliders ── */}
          <div className="lg-popover-section">
            <h4 className="lg-popover-section-title">Backdrop &amp; Glow</h4>
            {lg.advancedDecoupled && (
              <p className="settings-hint lg-decouple-notice">
                Sliders below are decoupled from the main Style slider.{' '}
                <button className="lg-link-btn" onClick={onRelinkToSlider} type="button">Re-link</button>
              </p>
            )}

            <div className="settings-field settings-field-inline">
              <label className="settings-label lg-adv-label" htmlFor="adv-blur">Backdrop blur</label>
              <div className="lg-slider-labeled-row lg-adv-slider-row">
                <span className="lg-axis-label">More</span>
                <input
                  id="adv-blur"
                  className="settings-slider"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={lg.blur}
                  aria-label="Backdrop blur more to less"
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setLg((prev) => {
                      const next = { ...prev, blur: v, advancedDecoupled: true };
                      applyLiquidNeonTokens(next, bgPreviewUrl);
                      return next;
                    });
                    setSavedOk(false);
                  }}
                />
                <span className="lg-axis-label lg-axis-right">Less</span>
              </div>
            </div>

            <div className="settings-field settings-field-inline">
              <label className="settings-label lg-adv-label" htmlFor="adv-glass">Glass opacity</label>
              <div className="lg-slider-labeled-row lg-adv-slider-row">
                <span className="lg-axis-label">Lighter</span>
                <input
                  id="adv-glass"
                  className="settings-slider"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={lg.glass}
                  aria-label="Glass opacity lighter to darker"
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setLg((prev) => {
                      const next = { ...prev, glass: v, advancedDecoupled: true };
                      applyLiquidNeonTokens(next, bgPreviewUrl);
                      return next;
                    });
                    setSavedOk(false);
                  }}
                />
                <span className="lg-axis-label lg-axis-right">Darker</span>
              </div>
            </div>

            <div className="settings-field settings-field-inline">
              <label className="settings-label lg-adv-label" htmlFor="adv-neon">Neon glow</label>
              <div className="lg-slider-labeled-row lg-adv-slider-row">
                <span className="lg-axis-label">Strong</span>
                <input
                  id="adv-neon"
                  className="settings-slider"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={lg.neonIntensity}
                  aria-label="Neon glow strong to soft"
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setLg((prev) => {
                      const next = { ...prev, neonIntensity: v, advancedDecoupled: true };
                      applyLiquidNeonTokens(next, bgPreviewUrl);
                      return next;
                    });
                    setSavedOk(false);
                  }}
                />
                <span className="lg-axis-label lg-axis-right">Soft</span>
              </div>
            </div>
          </div>

          {/* ── D1–D3: Extra sliders ── */}
          <div className="lg-popover-section">
            <h4 className="lg-popover-section-title">Detail</h4>

            <div className="settings-field settings-field-inline">
              <label className="settings-label lg-adv-label" htmlFor="adv-neon-frame">Neon frame</label>
              <div className="lg-slider-labeled-row lg-adv-slider-row">
                <span className="lg-axis-label">Thin</span>
                <input
                  id="adv-neon-frame"
                  className="settings-slider"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={lg.neonFrameWidth ?? 50}
                  aria-label="Neon frame width thin to thick"
                  onChange={(e) => setLgField('neonFrameWidth', Number(e.target.value))}
                />
                <span className="lg-axis-label lg-axis-right">Thick</span>
              </div>
            </div>

            <div className="settings-field settings-field-inline">
              <label className="settings-label lg-adv-label" htmlFor="adv-border">Border</label>
              <div className="lg-slider-labeled-row lg-adv-slider-row">
                <span className="lg-axis-label">Subtle</span>
                <input
                  id="adv-border"
                  className="settings-slider"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={lg.borderStrength ?? 50}
                  aria-label="Border strength subtle to strong"
                  onChange={(e) => setLgField('borderStrength', Number(e.target.value))}
                />
                <span className="lg-axis-label lg-axis-right">Strong</span>
              </div>
            </div>
          </div>

          {/* ── C4–C7: Background ── */}
          <div className="lg-popover-section">
            <h4 className="lg-popover-section-title">Background</h4>

            <div className="settings-field">
              <div className="lg-mode-toggle" role="radiogroup" aria-label="Background mode">
                {(['color', 'image'] as const).map((mode) => (
                  <label key={mode} className={`lg-mode-btn${(lg.bgMode ?? 'color') === mode ? ' lg-mode-btn-active' : ''}`}>
                    <input
                      type="radio"
                      name="lg-bg-mode"
                      value={mode}
                      checked={(lg.bgMode ?? 'color') === mode}
                      onChange={() => setLgField('bgMode', mode)}
                      aria-label={`Background mode ${mode}`}
                    />
                    {mode === 'color' ? 'Colour' : 'Image'}
                  </label>
                ))}
              </div>
            </div>

            {(lg.bgMode ?? 'color') === 'image' && (
              <div className="lg-bg-image-section">
                <div className="lg-bg-preview-row">
                  <div
                    className="lg-bg-preview"
                    role="img"
                    aria-label="Current background preview"
                    style={{
                      backgroundImage: bgPreviewUrl
                        ? `url("${bgPreviewUrl}")`
                        : lg.background !== 'default'
                          ? `url("${lg.background}")`
                          : DEFAULT_BG_GRADIENT,
                      backgroundSize: lg.bgFit === 'tile' ? 'auto' : (lg.bgFit ?? 'cover'),
                      backgroundRepeat: lg.bgFit === 'tile' ? 'repeat' : 'no-repeat',
                      backgroundPosition: lg.bgPosition ?? 'center',
                    }}
                  />
                  <div className="lg-bg-actions">
                    <button
                      className="settings-btn lg-btn-secondary"
                      type="button"
                      onClick={handlePickBgImage}
                      disabled={bgPickBusy}
                      aria-label="Browse for background image"
                    >
                      {bgPickBusy ? 'Loading…' : 'Browse…'}
                    </button>
                    {lg.background !== 'default' && (
                      <button
                        className="settings-btn lg-btn-secondary"
                        type="button"
                        onClick={handleResetBg}
                        aria-label="Reset background to default"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
                <p className="settings-hint">JPEG, PNG, WebP — replaces the app wallpaper. Max ~12 MB.</p>

                <div className="settings-field settings-field-inline">
                  <label className="settings-label lg-adv-label" htmlFor="adv-bg-fit">Fit</label>
                  <div className="lg-mode-toggle" role="radiogroup" aria-label="Image fit">
                    {(['cover', 'contain', 'tile'] as const).map((fit) => (
                      <label key={fit} className={`lg-mode-btn${(lg.bgFit ?? 'cover') === fit ? ' lg-mode-btn-active' : ''}`}>
                        <input
                          type="radio"
                          name="lg-bg-fit"
                          value={fit}
                          checked={(lg.bgFit ?? 'cover') === fit}
                          onChange={() => setLgField('bgFit', fit)}
                          aria-label={`Image fit ${fit}`}
                        />
                        {fit.charAt(0).toUpperCase() + fit.slice(1)}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="settings-field">
                  <label className="settings-label">Position</label>
                  <div className="lg-position-grid" role="radiogroup" aria-label="Image position">
                    {BG_POSITIONS.map(({ value, label }) => (
                      <label
                        key={value}
                        className={`lg-position-cell${(lg.bgPosition ?? 'center') === value ? ' lg-position-cell-active' : ''}`}
                        title={value}
                      >
                        <input
                          type="radio"
                          name="lg-bg-position"
                          value={value}
                          checked={(lg.bgPosition ?? 'center') === value}
                          onChange={() => setLgField('bgPosition', value)}
                          aria-label={`Image position ${value}`}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="settings-field settings-field-inline">
                  <label className="settings-label lg-adv-label" htmlFor="adv-scrim">Scrim</label>
                  <div className="lg-slider-labeled-row lg-adv-slider-row">
                    <span className="lg-axis-label">Light</span>
                    <input
                      id="adv-scrim"
                      className="settings-slider"
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={lg.bgScrim ?? 40}
                      aria-label="Background scrim light to dark"
                      onChange={(e) => setLgField('bgScrim', Number(e.target.value))}
                    />
                    <span className="lg-axis-label lg-axis-right">Dark</span>
                  </div>
                </div>
              </div>
            )}

            <div className="settings-field settings-field-inline">
              <label className="settings-label lg-adv-label" htmlFor="adv-vignette">Vignette</label>
              <div className="lg-slider-labeled-row lg-adv-slider-row">
                <span className="lg-axis-label">Off</span>
                <input
                  id="adv-vignette"
                  className="settings-slider"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={lg.bgVignette ?? 40}
                  aria-label="Background vignette off to strong"
                  onChange={(e) => setLgField('bgVignette', Number(e.target.value))}
                />
                <span className="lg-axis-label lg-axis-right">Strong</span>
              </div>
            </div>

            <ColorPicker
              id="adv-bg-base"
              label="Base colour"
              value={lg.bgBaseColor ?? '#0e1116'}
              onChange={(v) => setLgField('bgBaseColor', v)}
            />
          </div>

          {/* ── E1–E4: Color pickers ── */}
          <div className="lg-popover-section">
            <h4 className="lg-popover-section-title">Colours</h4>

            <ColorPicker
              id="adv-text-header"
              label="Header text"
              value={lg.textHeader ?? LG_DEFAULTS.textHeader!}
              bgForContrast={effectiveBg}
              minRatio={4.5}
              onChange={(v) => setLgField('textHeader', v)}
            />
            <ColorPicker
              id="adv-text-body"
              label="Body text"
              value={lg.textBody ?? LG_DEFAULTS.textBody!}
              bgForContrast={effectiveBg}
              minRatio={4.5}
              onChange={(v) => setLgField('textBody', v)}
            />
            <ColorPicker
              id="adv-text-muted"
              label="Muted text"
              value={lg.textMuted ?? LG_DEFAULTS.textMuted!}
              bgForContrast={effectiveBg}
              minRatio={4.5}
              onChange={(v) => setLgField('textMuted', v)}
            />
            <ColorPicker
              id="adv-accent"
              label="Accent"
              value={lg.accentColor ?? '#00f0ff'}
              onChange={(v) => setLgField('accentColor', v)}
            />

            {([
              { field: 'neonBorderColor',  label: 'Neon border A', radioName: 'lg-neon-border',   fallback: 'cyan' },
              { field: 'neonBorderColor2', label: 'Neon border B', radioName: 'lg-neon-border-2', fallback: 'violet' },
              { field: 'neonBorderColor3', label: 'Neon border C', radioName: 'lg-neon-border-3', fallback: 'magenta' },
            ] as const).map(({ field, label, radioName, fallback }) => {
              const current = (lg[field] ?? fallback) as 'cyan' | 'violet' | 'magenta';
              return (
                <div key={field} className="settings-field">
                  <label className="settings-label">{label}</label>
                  <div className="lg-swatch-row" role="radiogroup" aria-label={`${label} colour`}>
                    {(['cyan', 'violet', 'magenta'] as const).map((accent) => (
                      <label key={accent} className="lg-swatch-label">
                        <input
                          type="radio"
                          name={radioName}
                          value={accent}
                          checked={current === accent}
                          onChange={() => setLgField(field, accent)}
                          aria-label={`${label} ${accent}`}
                        />
                        <span
                          className={`lg-swatch lg-swatch-${accent}${current === accent ? ' lg-swatch-active' : ''}`}
                          title={accent.charAt(0).toUpperCase() + accent.slice(1)}
                        />
                        <span className="lg-swatch-name">{accent.charAt(0).toUpperCase() + accent.slice(1)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}

            <div className="settings-field">
              <label className="settings-label">Neon accent</label>
              <div className="lg-swatch-row" role="radiogroup" aria-label="Neon accent colour">
                {(['cyan', 'violet', 'magenta'] as const).map((accent) => (
                  <label key={accent} className="lg-swatch-label">
                    <input
                      type="radio"
                      name="lg-neon-accent"
                      value={accent}
                      checked={lg.neonAccent === accent}
                      onChange={() => setLgField('neonAccent', accent)}
                      aria-label={`Neon accent ${accent}`}
                    />
                    <span
                      className={`lg-swatch lg-swatch-${accent}${lg.neonAccent === accent ? ' lg-swatch-active' : ''}`}
                      title={accent.charAt(0).toUpperCase() + accent.slice(1)}
                    />
                    <span className="lg-swatch-name">{accent.charAt(0).toUpperCase() + accent.slice(1)}</span>
                  </label>
                ))}
              </div>
            </div>

            <ColorPicker
              id="lg-neon-cyan"
              label="Cyan neon colour"
              value={lg.neonColorCyan ?? '#00f0ff'}
              onChange={(v) => setLgField('neonColorCyan', v)}
            />
            <ColorPicker
              id="lg-neon-violet"
              label="Violet neon colour"
              value={lg.neonColorViolet ?? '#9b5fff'}
              onChange={(v) => setLgField('neonColorViolet', v)}
            />
            <ColorPicker
              id="lg-neon-magenta"
              label="Magenta neon colour"
              value={lg.neonColorMagenta ?? '#ff4dff'}
              onChange={(v) => setLgField('neonColorMagenta', v)}
            />
          </div>

          {/* ── Reset ── */}
          <div className="lg-popover-reset">
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

        </div>
      </div>
    </div>
  );
}
