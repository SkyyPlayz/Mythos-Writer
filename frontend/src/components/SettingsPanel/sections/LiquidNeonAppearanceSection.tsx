// Beta 3 "Liquid Neon" M4 — the prototype's Appearance settings page
// (template 1646–1809; renderVals helpers 4178–4232, 4607–4632). The
// prototype is the spec: card layouts, copy, and computed style strings are
// ported verbatim; controls bind to settings.liquidNeonV2 and apply live via
// the v2 token engine, persisting through the panel's normal Save flow.
import { useMemo, useRef } from 'react';
import {
  applyLiquidNeonV2Tokens,
  exportLiquidNeonPreset,
  hexA,
  normalizeLiquidNeonV2,
  parseLiquidNeonPreset,
  wallpaperCss,
  LIQUID_NEON_V2_DEFAULTS,
  type LiquidNeonV2Settings,
  type LiquidNeonWallpaperKey,
} from '../../../theme/liquidNeonEngine';
import { onActivateKey, NeonToggle, NeonSlider, NeonSeg, NeonCard as Card, hdrBtnSt } from './liquidNeonControls';
import {
  LIQUID_NEON_PRESETS,
  LIQUID_NEON_SLOT_ROLES,
  LIQUID_NEON_SWATCHES,
  type LiquidNeonPresetKey,
} from '../../../theme/presets';
import { showLnToast } from '../../../theme/lnToast';
import ColorWheel from '../ColorWheel';
import cosmicBgUrl from '../../../assets/cosmic-bg.webp';
import './LiquidNeonAppearanceSection.css';

interface Props {
  liquidNeonV2: Partial<LiquidNeonV2Settings> | undefined;
  onChange: (next: LiquidNeonV2Settings) => void;
  setSavedOk: (ok: boolean) => void;
  /** Beta 4 M1 — Interface card "Nav rail labels" toggle (navConfig.showLabels). */
  navRailLabels?: boolean;
  onNavRailLabelsChange?: (show: boolean) => void;
}

// ── The section ───────────────────────────────────────────────────────────────
// The small building blocks (NeonToggle / NeonSlider / NeonSeg / Card) live in
// ./liquidNeonControls — shared with the Editor page's manuscript cards (M28).

export default function LiquidNeonAppearanceSection({ liquidNeonV2, onChange, setSavedOk, navRailLabels, onNavRailLabelsChange }: Props) {
  const S = useMemo(() => normalizeLiquidNeonV2(liquidNeonV2), [liquidNeonV2]);
  const importFileRef = useRef<HTMLInputElement>(null);

  const patch = (p: Partial<LiquidNeonV2Settings>) => {
    const next: LiquidNeonV2Settings = { ...S, ...p };
    onChange(next);
    applyLiquidNeonV2Tokens(next, cosmicBgUrl); // live preview
    setSavedOk(false);
  };

  // ── Beta 4 M1: preset import/export (§3; prototype 7191–7192) ──────────────

  /** Export: clipboard + JSON file in one action (M1: "clipboard AND file"). */
  const exportPreset = () => {
    const json = exportLiquidNeonPreset(S);
    try {
      void navigator.clipboard?.writeText(json);
    } catch { /* clipboard unavailable — the file half still runs */ }
    try {
      if (typeof URL.createObjectURL === 'function') {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'mythos-theme-preset.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
    } catch { /* download unavailable — clipboard copy already happened */ }
    showLnToast('Theme preset exported — copied to clipboard and saved as JSON');
  };

  /** Shared import tail: invalid text → toast, no crash (prototype 7192). */
  const importFromText = (text: string) => {
    const parsed = parseLiquidNeonPreset(text);
    if (!parsed) {
      showLnToast('Not a valid theme preset file');
      return;
    }
    patch(parsed);
    showLnToast('Theme preset imported — applied live');
  };

  const onImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = ''; // allow re-importing the same file
    if (!f) return;
    const r = new FileReader();
    r.onload = () => importFromText(String(r.result ?? ''));
    r.onerror = () => showLnToast('Not a valid theme preset file');
    r.readAsText(f);
  };

  const importFromClipboard = async () => {
    let text = '';
    try {
      text = (await navigator.clipboard?.readText?.()) ?? '';
    } catch { /* permission denied or unavailable */ }
    if (!text) {
      showLnToast('Clipboard has no theme preset');
      return;
    }
    importFromText(text);
  };

  // Preset cards (prototype 4185–4194)
  const presetCards = (Object.keys(LIQUID_NEON_PRESETS) as LiquidNeonPresetKey[]).map((k) => {
    const v = LIQUID_NEON_PRESETS[k];
    const active = S.setKey === k;
    return (
      <div
        key={k}
        data-testid={`lnas-preset-${k}`}
        onClick={() => patch({ setKey: k, slots: [...v.c] as LiquidNeonV2Settings['slots'], wp: 'match' })}
        role="button"
        tabIndex={0}
        aria-pressed={active}
        aria-label={`Theme: ${v.name}`}
        onKeyDown={onActivateKey(() => patch({ setKey: k, slots: [...v.c] as LiquidNeonV2Settings['slots'], wp: 'match' }))}
        className={active ? undefined : 'lnas-hover-lift'}
        style={{
          flex: 1, minWidth: 118, padding: 11, borderRadius: 13, cursor: 'pointer',
          background: 'rgba(255,255,255,.03)', transition: 'all .18s ease',
          border: active ? `1px solid ${hexA(v.c[0], .7)}` : '1px solid rgba(255,255,255,.08)',
          boxShadow: active ? `0 0 20px -5px ${hexA(v.c[0], .5)}` : undefined,
        }}
      >
        <div style={{ height: 7, borderRadius: 6, background: `linear-gradient(120deg,${v.c.join(',')})`, boxShadow: `0 0 12px -2px ${hexA(v.c[1], .55)}`, marginBottom: 9 }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: '#e6ecf9' }}>{v.name}</span>
          <span style={{ display: 'flex', gap: 4 }}>
            {v.c.map((c, i) => (
              <span key={i} style={{ width: 11, height: 11, borderRadius: '50%', background: c, boxShadow: `0 0 8px ${hexA(c, .5)}` }} />
            ))}
          </span>
        </div>
      </div>
    );
  });

  // Slot rows (prototype 4195–4201)
  const slotRows = ([0, 1, 2, 3, 4, 5] as const).map((i) => (
    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
      <div style={{ width: 122, flex: 'none' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#aebad0' }}>{`Slot ${'ABCDEF'[i]}`}</div>
        <div style={{ fontSize: 8.5, color: '#7686a2', marginTop: 1, lineHeight: 1.3 }}>{LIQUID_NEON_SLOT_ROLES[i]}</div>
      </div>
      <div style={{ width: 36, height: 36, borderRadius: 11, flex: 'none', background: S.slots[i], boxShadow: `0 0 16px ${hexA(S.slots[i], .5)}`, border: '1px solid rgba(255,255,255,.3)' }} />
      <span style={{ width: 66, fontSize: 10.5, color: '#7686a2', fontFamily: 'ui-monospace,monospace', flex: 'none' }}>{S.slots[i].toUpperCase()}</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {LIQUID_NEON_SWATCHES.map((c) => {
          const selected = S.slots[i].toLowerCase() === c.toLowerCase();
          return (
            <div
              key={c}
              data-testid={`lnas-slot${i}-swatch-${c.replace('#', '')}`}
              onClick={() => {
                const slots = [...S.slots] as LiquidNeonV2Settings['slots'];
                slots[i] = c;
                patch({ slots, setKey: 'custom' });
              }}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              aria-label={`Slot ${'ABCDEF'[i]} color ${c}`}
              onKeyDown={onActivateKey(() => {
                const slots = [...S.slots] as LiquidNeonV2Settings['slots'];
                slots[i] = c;
                patch({ slots, setKey: 'custom' });
              })}
              className="lnas-hover-scale"
              style={{
                width: 23, height: 23, borderRadius: 8, cursor: 'pointer', background: c,
                border: `2px solid ${selected ? '#fff' : 'transparent'}`,
                boxShadow: selected ? `0 0 12px ${hexA(c, .65)}` : 'none',
                transition: 'transform .12s ease',
              }}
            />
          );
        })}
        <ColorWheel
          value={S.slots[i]}
          data-testid={`lnas-slot${i}-wheel`}
          onChange={(v) => {
            const slots = [...S.slots] as LiquidNeonV2Settings['slots'];
            slots[i] = v;
            patch({ slots, setKey: 'custom' });
          }}
        />
      </div>
    </div>
  ));

  // Wallpaper cards (prototype 4225–4232)
  const wpDefs: [LiquidNeonWallpaperKey, string][] = [
    ['match', 'Theme match'], ['aurora', 'Aurora Glass'], ['slate', 'Slate Gradient'], ['deep', 'Deep Space'], ['none', 'No background'],
    ...(S.customWp ? ([['custom', 'Your image']] as [LiquidNeonWallpaperKey, string][]) : []),
  ];
  const wpCards = wpDefs.map(([k, label]) => {
    const active = S.wp === k;
    const thumbBg = wallpaperCss({ ...S, wp: k }, cosmicBgUrl);
    return (
      <div
        key={k}
        data-testid={`lnas-wp-${k}`}
        onClick={() => patch({ wp: k })}
        role="button"
        tabIndex={0}
        aria-pressed={active}
        aria-label={`Wallpaper: ${label}`}
        onKeyDown={onActivateKey(() => patch({ wp: k }))}
        className={active ? undefined : 'lnas-hover-border'}
        style={{
          flex: 1, minWidth: 120, padding: 7, borderRadius: 13, cursor: 'pointer',
          background: 'rgba(255,255,255,.03)', transition: 'all .18s ease',
          ...(active
            ? { border: 'var(--bw,1px) solid var(--b1,rgba(0,240,255,.5))', boxShadow: '0 0 18px -5px var(--g1,rgba(0,240,255,.4))' }
            : { border: '1px solid rgba(255,255,255,.08)' }),
        }}
      >
        <div
          style={{
            height: 58, borderRadius: 9, backgroundImage: thumbBg,
            backgroundSize: 'cover', backgroundPosition: 'center',
            border: '1px solid rgba(255,255,255,.08)',
            // B4-2: `No background` is a plain dark backdrop now (no transparency).
            ...(k === 'none' ? { display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7686a2', fontSize: 9, letterSpacing: '.06em' } : {}),
          }}
        >
          {k === 'none' ? 'plain dark' : ''}
        </div>
        <div style={{ fontSize: 11, marginTop: 7, textAlign: 'center', ...(active ? { color: 'var(--n1,#00f0ff)', fontWeight: 600 } : { color: '#aebad0' }) }}>{label}</div>
      </div>
    );
  });

  const pickCustomWallpaper = async () => {
    try {
      const res = await window.api?.pickBgImage?.();
      if (res?.filePath) patch({ customWp: res.filePath, wp: 'custom' });
    } catch { /* dialog cancelled or unavailable */ }
  };

  // Frame animation speed slider (prototype 4629–4631): 0.25s quantized, 1–30s.
  const fsQ = Math.max(1, Math.round(S.frameSpeed * 4));
  const fsPct = ((fsQ - 1) / 119 * 100).toFixed(1);

  const resetToDefaults = () => patch({
    setKey: 'classic',
    slots: [...LIQUID_NEON_PRESETS.classic.c] as LiquidNeonV2Settings['slots'],
    intensity: LIQUID_NEON_V2_DEFAULTS.intensity,
    glassA: LIQUID_NEON_V2_DEFAULTS.glassA,
    blur: LIQUID_NEON_V2_DEFAULTS.blur,
    wp: LIQUID_NEON_V2_DEFAULTS.wp,
    scrim: LIQUID_NEON_V2_DEFAULTS.scrim,
    glowW: LIQUID_NEON_V2_DEFAULTS.glowW,
    glowR: LIQUID_NEON_V2_DEFAULTS.glowR,
    reduceGlow: false,
    animGlow: true,
    // Beta 4 M1 additions
    ambMode: LIQUID_NEON_V2_DEFAULTS.ambMode,
    ambSpeed: LIQUID_NEON_V2_DEFAULTS.ambSpeed,
    ambColor: null,
    density: LIQUID_NEON_V2_DEFAULTS.density,
    reduceMotion: false,
    uiTextCol: LIQUID_NEON_V2_DEFAULTS.uiTextCol,
    uiBtnCol: LIQUID_NEON_V2_DEFAULTS.uiBtnCol,
  });

  return (
    <section className="settings-section lnas-root" aria-labelledby="section-liquid-neon" data-settings-cat="appearance">
      <h3 className="settings-section-title" id="section-liquid-neon">Liquid Neon</h3>

      {/* §3 card 1 — Color theme, with preset export/import in the header
          (prototype 2238–2243; Beta 4 M1: clipboard AND file both ways). */}
      <Card title="Color theme">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0 12px' }}>
          <div style={{ flex: 1, fontSize: 11, color: '#8e9db8' }}>Curated neon sets. Pick one, or build your own below.</div>
          <div
            role="button"
            tabIndex={0}
            data-testid="lnas-export"
            title="Copies your theme — colors, background & animation — to the clipboard and saves it as a shareable .json preset"
            onClick={exportPreset}
            onKeyDown={onActivateKey(exportPreset)}
            className="lnas-hdr-btn"
            style={hdrBtnSt('--b1')}
          >
            Export preset
          </div>
          <div
            role="button"
            tabIndex={0}
            data-testid="lnas-import-paste"
            title="Apply a theme preset JSON from your clipboard"
            onClick={() => { void importFromClipboard(); }}
            onKeyDown={onActivateKey(() => { void importFromClipboard(); })}
            className="lnas-hdr-btn"
            style={hdrBtnSt('--b2')}
          >
            Paste
          </div>
          <label
            role="button"
            tabIndex={0}
            data-testid="lnas-import"
            title="Import a shared theme preset (.json)"
            onKeyDown={onActivateKey(() => importFileRef.current?.click())}
            className="lnas-hdr-btn"
            style={hdrBtnSt('--b2')}
          >
            Import…
            <input
              ref={importFileRef}
              type="file"
              accept=".json,application/json"
              data-testid="lnas-import-file"
              onChange={onImportFile}
              style={{ display: 'none' }}
            />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>{presetCards}</div>
      </Card>

      <Card title="Neon border colors" sub="Six slots. A · B · C frame the panels, tabs and gradients; D · E color data accents like graph categories; F lights the nav rail. Pick a swatch — or use the wheel to get it just right.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>{slotRows}</div>
      </Card>

      <Card title="Glow & glass">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <NeonSlider label="Neon intensity" value={S.intensity} min={0} max={100} unit="%" onChange={(v) => patch({ intensity: v })} testId="lnas-intensity" />
          <NeonSlider label="Border thickness" value={S.glowW} min={1} max={4} unit="px" onChange={(v) => patch({ glowW: v })} testId="lnas-gloww" />
          <NeonSlider label="Glow radius" value={S.glowR} min={8} max={160} unit="px" onChange={(v) => patch({ glowR: v })} testId="lnas-glowr" />
          <NeonSlider label="Glass opacity" value={S.glassA} min={0} max={96} unit="%" onChange={(v) => patch({ glassA: v })} testId="lnas-glassa" />
          <NeonSlider label="Backdrop blur" value={S.blur} min={0} max={40} unit="px" onChange={(v) => patch({ blur: v })} testId="lnas-blur" />
          <NeonSlider label="Wallpaper scrim" value={S.scrim} min={0} max={70} unit="%" onChange={(v) => patch({ scrim: v })} testId="lnas-scrim" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 3 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11.5, color: '#aebad0' }}>Breathing panel borders</div>
              <div style={{ fontSize: 10, color: '#7686a2', marginTop: 1 }}>Idle glow animation on panel borders — off keeps them static, laptop-friendly</div>
            </div>
            <NeonToggle on={S.animGlow !== false} onClick={() => patch({ animGlow: S.animGlow === false })} testId="lnas-animglow" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 3 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11.5, color: '#aebad0' }}>Reduce glow</div>
              <div style={{ fontSize: 10, color: '#7686a2', marginTop: 1 }}>Accessibility — caps neon intensity at a whisper</div>
            </div>
            <NeonToggle on={S.reduceGlow} onClick={() => patch({ reduceGlow: !S.reduceGlow })} testId="lnas-reduceglow" />
          </div>
        </div>
      </Card>

      <Card title="Background" sub="The glass needs something to refract. Wallpaper sits behind every panel — or go minimal with a plain dark backdrop.">
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
          {wpCards}
          <label
            className="lnas-upload"
            onClick={(e) => { e.preventDefault(); void pickCustomWallpaper(); }}
            role="button"
            tabIndex={0}
            aria-label="Add your own wallpaper image"
            onKeyDown={onActivateKey(() => void pickCustomWallpaper())}
            data-testid="lnas-wp-upload"
          >
            <div style={{ height: 58, borderRadius: 9, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: '#8e9db8', border: '1px solid rgba(255,255,255,.06)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><circle cx="9" cy="10" r="1.8" /><path d="M3.5 16.5l4.5-4 3.5 3 3-2.5 5.5 4.5" /></svg>
              <span style={{ fontSize: 9.5 }}>Your image</span>
            </div>
            <div style={{ fontSize: 11, marginTop: 7, textAlign: 'center', color: '#aebad0' }}>+ Add your own…</div>
          </label>
        </div>
      </Card>

      {/* §3 card 5 — Background animation (prototype 2311–2332, ambSeg 7022). */}
      <Card title="Background animation" sub="The drifting motes behind the glass — snowfall, rising sparks, or nothing at all.">
        <NeonSeg
          options={[['match', 'Theme match'], ['snow', 'Snowfall'], ['rise', 'Rising'], ['off', 'Off']]}
          current={S.ambMode}
          onPick={(k) => {
            patch({ ambMode: k });
            showLnToast(k === 'off'
              ? 'Background animation off'
              : 'Background animation — ' + (k === 'match' ? 'theme match' : k === 'snow' ? 'snowfall' : 'rising motes'));
          }}
          testIdPrefix="lnas-amb"
        />
        {S.ambMode !== 'off' && (
          <>
            <div style={{ marginTop: 12 }}>
              <NeonSlider label="Drift speed" value={S.ambSpeed} min={50} max={200} unit="%" onChange={(v) => patch({ ambSpeed: v })} testId="lnas-ambspeed" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11.5, color: '#aebad0' }}>Particle color</div>
                <div style={{ fontSize: 10, color: '#7686a2', marginTop: 1 }}>Make it your own — or leave it matched to the theme</div>
              </div>
              {!!S.ambColor && (
                <div
                  role="button"
                  tabIndex={0}
                  data-testid="lnas-ambcolor-clear"
                  onClick={() => { patch({ ambColor: null }); showLnToast('Particles back to theme colors'); }}
                  onKeyDown={onActivateKey(() => { patch({ ambColor: null }); showLnToast('Particles back to theme colors'); })}
                  className="lnas-hdr-btn"
                  style={{ fontSize: 10, color: '#aebad0', border: '1px solid rgba(255,255,255,.14)', borderRadius: 7, padding: '2px 8px', cursor: 'pointer' }}
                >
                  Reset to theme
                </div>
              )}
              <input
                type="color"
                value={S.ambColor || '#9fd4ff'}
                data-testid="lnas-ambcolor"
                aria-label="Particle color"
                onChange={(e) => patch({ ambColor: e.target.value })}
                style={{ width: 38, height: 26, padding: 0, border: '1px solid rgba(255,255,255,.14)', borderRadius: 8, background: 'none', cursor: 'pointer' }}
              />
            </div>
          </>
        )}
      </Card>

      {/* §3 card 6 — Neon animation. */}
      <Card title="Neon animation" sub="Animates every panel border — Cycle rotates the colors, Sparkle fades your palette in and out.">
        <NeonSeg
          options={[['off', 'Off'], ['cycle', 'Cycle'], ['sparkle', 'Sparkle']]}
          current={S.frameAnim}
          onPick={(k) => patch({ frameAnim: k })}
          testIdPrefix="lnas-frame"
        />
        {S.frameAnim !== 'off' && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
              <span style={{ fontSize: 11.5, color: '#aebad0' }}>Animation speed</span>
              <span style={{ fontSize: 11.5, color: 'var(--n1,#00f0ff)', fontWeight: 600 }}>{Math.round(S.frameSpeed * 100) / 100}s</span>
            </div>
            <input
              type="range" min={1} max={120} value={fsQ} data-testid="lnas-framespeed"
              aria-label="Animation speed"
              onChange={(e) => patch({ frameSpeed: +e.target.value / 4 })} className="lnas-range"
              style={{ width: '100%', background: `linear-gradient(to right,var(--n1,#00f0ff) ${fsPct}%,rgba(255,255,255,.12) ${fsPct}%)` }}
            />
          </div>
        )}
      </Card>

      {/* §3 card 7 — Interface (prototype 2346–2373; handlers 7018–7020, 7189–7190). */}
      <Card title="Interface">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11.5, color: '#aebad0' }}>Interface density</div>
              <div style={{ fontSize: 10, color: '#7686a2', marginTop: 1 }}>How much breathing room panels and lists get</div>
            </div>
            <NeonSeg
              options={[['comfortable', 'Comfortable'], ['cozy', 'Cozy'], ['compact', 'Compact']]}
              current={S.density}
              onPick={(k) => { patch({ density: k }); showLnToast('Density — ' + k); }}
              testIdPrefix="lnas-density"
            />
          </div>
          {onNavRailLabelsChange && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11.5, color: '#aebad0' }}>Nav rail labels</div>
                <div style={{ fontSize: 10, color: '#7686a2', marginTop: 1 }}>Show names under the left-rail icons — off gives a slim rail</div>
              </div>
              <NeonToggle
                on={navRailLabels !== false}
                onClick={() => { onNavRailLabelsChange(navRailLabels === false); setSavedOk(false); }}
                testId="lnas-raillabels"
              />
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11.5, color: '#aebad0' }}>Reduce motion</div>
              <div style={{ fontSize: 10, color: '#7686a2', marginTop: 1 }}>Pauses the drifting motes and all neon animation in one switch</div>
            </div>
            <NeonToggle
              on={S.reduceMotion}
              onClick={() => {
                const on = !S.reduceMotion;
                patch({ reduceMotion: on });
                showLnToast(on ? 'Motion reduced — motes & neon animation paused' : 'Motion restored');
              }}
              testId="lnas-reducemotion"
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11.5, color: '#aebad0' }}>App text color</div>
              <div style={{ fontSize: 10, color: '#7686a2', marginTop: 1 }}>Interface text everywhere — separate from manuscript text colors</div>
            </div>
            <span style={{ fontSize: 10, color: '#7686a2', fontFamily: 'ui-monospace,monospace' }}>{S.uiTextCol}</span>
            <ColorWheel value={S.uiTextCol} onChange={(v) => patch({ uiTextCol: v })} data-testid="lnas-uitext" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11.5, color: '#aebad0' }}>Button text color</div>
              <div style={{ fontSize: 10, color: '#7686a2', marginTop: 1 }}>Text on every button and chip across the app</div>
            </div>
            <span style={{ fontSize: 10, color: '#7686a2', fontFamily: 'ui-monospace,monospace' }}>{S.uiBtnCol}</span>
            <ColorWheel value={S.uiBtnCol} onChange={(v) => patch({ uiBtnCol: v })} data-testid="lnas-uibtn" />
          </div>
        </div>
      </Card>

      {/* M28 (§13): the Text colors + Manuscript page cards moved to the
          Editor page — see sections/EditorManuscriptSection.tsx. */}

      {/* Reset (prototype 2643) */}
      <div
        className="lnas-reset"
        data-testid="lnas-reset"
        onClick={resetToDefaults}
        role="button"
        tabIndex={0}
        onKeyDown={onActivateKey(resetToDefaults)}
      >
        Reset appearance to defaults
      </div>
    </section>
  );
}
