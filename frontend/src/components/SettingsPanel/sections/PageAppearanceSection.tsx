import { applyPageBackgroundTokens, pageBackgroundContrastRatio } from '../../../theme';

interface PageAppearanceSectionProps {
  pageBg: PageBackgroundSettings;
  setPageBg: React.Dispatch<React.SetStateAction<PageBackgroundSettings>>;
  setSavedOk: (ok: boolean) => void;
}

export default function PageAppearanceSection({ pageBg, setPageBg, setSavedOk }: PageAppearanceSectionProps) {
  return (
    <section className="settings-section" aria-labelledby="section-page-appearance" data-settings-cat="appearance">
      <h3 className="settings-section-title" id="section-page-appearance">Page Appearance</h3>
      <p className="settings-hint">Controls the visual style of the writing surface panel.</p>

      {/* Panel Preset */}
      <div className="settings-field">
        <label className="settings-label" htmlFor="page-bg-preset">Panel Preset</label>
        <select
          id="page-bg-preset"
          className="settings-select"
          value={pageBg.preset}
          onChange={(e) => {
            const preset = e.target.value as PageBackgroundPreset;
            const next: PageBackgroundSettings = { ...pageBg, preset };
            setPageBg(next);
            applyPageBackgroundTokens(next);
            setSavedOk(false);
          }}
        >
          <option value="liquid-neon">Liquid Neon</option>
          <option value="minimal">Minimal</option>
          <option value="paper">Paper</option>
          <option value="dark-slate">Dark Slate</option>
        </select>
      </div>

      {/* Panel Opacity */}
      <div className="settings-field">
        <label className="settings-label" htmlFor="page-bg-opacity">
          Panel Opacity
          <span className="settings-slider-value">{pageBg.opacity}</span>
        </label>
        <input
          id="page-bg-opacity"
          className="settings-slider"
          type="range"
          min={0}
          max={100}
          step={1}
          value={pageBg.opacity}
          aria-label="Panel opacity 0 to 100"
          onChange={(e) => {
            const next: PageBackgroundSettings = { ...pageBg, opacity: Number(e.target.value) };
            setPageBg(next);
            applyPageBackgroundTokens(next);
            setSavedOk(false);
          }}
        />
        {pageBackgroundContrastRatio(pageBg) < 4.5 && (
          <p className="settings-hint-warn" role="alert">
            Low contrast — text may be hard to read at this opacity.
          </p>
        )}
      </div>

      {/* Panel Blur — glass presets only */}
      <div className={`settings-field${pageBg.preset !== 'liquid-neon' ? ' settings-field--disabled' : ''}`}>
        <label className="settings-label" htmlFor="page-bg-blur">
          Panel Blur
          <span className="settings-slider-value">{pageBg.blur}px</span>
        </label>
        <input
          id="page-bg-blur"
          className="settings-slider"
          type="range"
          min={0}
          max={32}
          step={1}
          value={pageBg.blur}
          disabled={pageBg.preset !== 'liquid-neon'}
          aria-label="Panel blur 0 to 32 pixels"
          aria-disabled={pageBg.preset !== 'liquid-neon'}
          onChange={(e) => {
            const next: PageBackgroundSettings = { ...pageBg, blur: Number(e.target.value) };
            setPageBg(next);
            applyPageBackgroundTokens(next);
            setSavedOk(false);
          }}
        />
        {pageBg.preset !== 'liquid-neon' && (
          <p className="settings-hint">Blur applies only to glass presets (Liquid Neon).</p>
        )}
      </div>

      {/* Panel Glow Intensity — Liquid Neon only */}
      <div className={`settings-field${pageBg.preset !== 'liquid-neon' ? ' settings-field--disabled' : ''}`}>
        <label className="settings-label" htmlFor="page-bg-glow">
          Panel Glow Intensity
          <span className="settings-slider-value">{pageBg.glowIntensity}</span>
        </label>
        <input
          id="page-bg-glow"
          className="settings-slider"
          type="range"
          min={0}
          max={100}
          step={1}
          value={pageBg.glowIntensity}
          disabled={pageBg.preset !== 'liquid-neon'}
          aria-label="Panel glow intensity 0 to 100"
          aria-disabled={pageBg.preset !== 'liquid-neon'}
          onChange={(e) => {
            const next: PageBackgroundSettings = { ...pageBg, glowIntensity: Number(e.target.value) };
            setPageBg(next);
            applyPageBackgroundTokens(next);
            setSavedOk(false);
          }}
        />
        {pageBg.preset !== 'liquid-neon' && (
          <p className="settings-hint">Glow applies only to the Liquid Neon preset.</p>
        )}
      </div>

      {/* Apply to both tabs */}
      <div className="settings-field">
        <label className="settings-focus-toggle">
          <input
            type="checkbox"
            checked={pageBg.applyToBothTabs}
            aria-label="Apply page appearance to both Story and Notes tabs"
            onChange={() => {
              const next: PageBackgroundSettings = { ...pageBg, applyToBothTabs: !pageBg.applyToBothTabs };
              setPageBg(next);
              applyPageBackgroundTokens(next);
              setSavedOk(false);
            }}
          />
          <span className="settings-label">Apply to both tabs</span>
        </label>
        <p className="settings-hint">When off, page appearance applies to the active tab only (tab-specific theming lands in a future release).</p>
      </div>
    </section>
  );
}
