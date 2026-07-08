// Beta 3 "Liquid Neon" M4 — the prototype's Appearance settings page
// (template 1646–1809; renderVals helpers 4178–4232, 4607–4632). The
// prototype is the spec: card layouts, copy, and computed style strings are
// ported verbatim; controls bind to settings.liquidNeonV2 and apply live via
// the v2 token engine, persisting through the panel's normal Save flow.
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  applyLiquidNeonV2Tokens,
  hexA,
  normalizeLiquidNeonV2,
  wallpaperCss,
  LIQUID_NEON_V2_DEFAULTS,
  type LiquidNeonV2Settings,
  type LiquidNeonWallpaperKey,
} from '../../../theme/liquidNeonEngine';
import {
  LIQUID_NEON_PRESETS,
  LIQUID_NEON_SLOT_ROLES,
  LIQUID_NEON_SWATCHES,
  type LiquidNeonPresetKey,
} from '../../../theme/presets';
import ColorWheel from '../ColorWheel';
import cosmicBgUrl from '../../../assets/cosmic-bg.webp';
import './LiquidNeonAppearanceSection.css';

interface Props {
  liquidNeonV2: Partial<LiquidNeonV2Settings> | undefined;
  onChange: (next: LiquidNeonV2Settings) => void;
  setSavedOk: (ok: boolean) => void;
}

/** Keyboard activation for div/label elements standing in for a button (Enter/Space). */
function onActivateKey(handler: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler();
    }
  };
}

// ── Small verbatim building blocks ────────────────────────────────────────────

/** mkToggle (prototype 4180) as a component. */
function NeonToggle({ on, onClick, testId }: { on: boolean; onClick: () => void; testId?: string }) {
  const pillSt: CSSProperties = {
    width: 37, height: 21, borderRadius: 99, position: 'relative', cursor: 'pointer', flex: 'none',
    transition: 'all .2s ease',
    ...(on
      ? { background: 'var(--gs1,rgba(0,240,255,.12))', border: 'var(--bw,1px) solid var(--b1,rgba(0,240,255,.5))', boxShadow: '0 0 10px -2px var(--g1,rgba(0,240,255,.4))' }
      : { background: 'rgba(255,255,255,.04)', border: 'var(--bw,1px) solid var(--b1,rgba(0,240,255,.3))' }),
  };
  const knobSt: CSSProperties = {
    position: 'absolute', top: 2.5, left: 3, width: 13, height: 13, borderRadius: '50%',
    transition: 'all .2s ease', transform: `translateX(${on ? 16 : 0}px)`,
    ...(on
      ? { background: 'var(--n1,#00f0ff)', boxShadow: '0 0 8px var(--g1,rgba(0,240,255,.4))' }
      : { background: '#8e9db8' }),
  };
  return (
    <div
      onClick={onClick}
      style={pillSt}
      role="switch"
      aria-checked={on}
      tabIndex={0}
      onKeyDown={onActivateKey(onClick)}
      data-testid={testId}
    >
      <span style={knobSt} />
    </div>
  );
}

/** mkSlider (prototype 4202): neon-filled range track + live value label. */
function NeonSlider({ label, value, min, max, unit, onChange, testId }: {
  label: string; value: number; min: number; max: number; unit: string;
  onChange: (v: number) => void; testId?: string;
}) {
  const pct = ((value - min) / (max - min) * 100).toFixed(1);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
        <span style={{ fontSize: 11.5, color: '#aebad0' }}>{label}</span>
        <span style={{ fontSize: 11.5, color: 'var(--n1,#00f0ff)', fontWeight: 600 }}>{value}{unit}</span>
      </div>
      <input
        type="range" min={min} max={max} value={value} data-testid={testId}
        aria-label={label}
        onChange={(e) => onChange(+e.target.value)} className="lnas-range"
        style={{ width: '100%', background: `linear-gradient(to right,var(--n1,#00f0ff) ${pct}%,rgba(255,255,255,.12) ${pct}%)` }}
      />
    </div>
  );
}

/** segMk (prototype 4231): the pill segment control. */
function NeonSeg<K extends string>({ options, current, onPick, testIdPrefix }: {
  options: [K, string][]; current: K; onPick: (k: K) => void; testIdPrefix?: string;
}) {
  return (
    <div style={{ display: 'flex', padding: 3, borderRadius: 10, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)', gap: 2, width: 'fit-content' }}>
      {options.map(([k, label]) => (
        <div
          key={k}
          onClick={() => onPick(k)}
          role="button"
          tabIndex={0}
          aria-pressed={current === k}
          onKeyDown={onActivateKey(() => onPick(k))}
          data-testid={testIdPrefix ? `${testIdPrefix}-${k}` : undefined}
          className={current === k ? undefined : 'lnas-seg-idle'}
          style={{
            padding: '4px 13px', borderRadius: 8, fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap',
            ...(current === k
              ? { background: 'var(--gs1,rgba(0,240,255,.12))', color: 'var(--n1,#00f0ff)', border: 'var(--bw,1px) solid var(--b1,rgba(0,240,255,.5))', fontWeight: 600, boxShadow: '0 0 10px -3px var(--g1,rgba(0,240,255,.4))' }
              : { color: '#94a3bd', border: '1px solid transparent' }),
          }}
        >
          {label}
        </div>
      ))}
    </div>
  );
}

function Card({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="lnas-card">
      <div style={{ fontSize: 12.5, fontWeight: 600, color: '#eef2fb' }}>{title}</div>
      {sub && <div style={{ fontSize: 11, color: '#8e9db8', margin: '2px 0 12px' }}>{sub}</div>}
      {children}
    </div>
  );
}

const SCROLL_WHEEL_GRADIENT = 'conic-gradient(#5a4014,#8a6a2c,#2b2213,#4a3a1a,#5a4014)';

// ── The section ───────────────────────────────────────────────────────────────

export default function LiquidNeonAppearanceSection({ liquidNeonV2, onChange, setSavedOk }: Props) {
  const S = useMemo(() => normalizeLiquidNeonV2(liquidNeonV2), [liquidNeonV2]);

  // M3: wp:'none' means a transparent Electron window, which is fixed at
  // creation — surface the restart-to-apply affordance when they disagree.
  const [windowTransparent, setWindowTransparent] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    window.api?.windowIsTransparent?.()
      .then((v) => { if (alive) setWindowTransparent(v === true); })
      .catch(() => { if (alive) setWindowTransparent(null); });
    return () => { alive = false; };
  }, []);

  const patch = (p: Partial<LiquidNeonV2Settings>) => {
    const next: LiquidNeonV2Settings = { ...S, ...p };
    onChange(next);
    applyLiquidNeonV2Tokens(next, cosmicBgUrl); // live preview
    setSavedOk(false);
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
            backgroundSize: k === 'none' ? '13px 13px' : 'cover', backgroundPosition: 'center',
            border: '1px solid rgba(255,255,255,.08)',
            ...(k === 'none' ? { display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7686a2', fontSize: 9, letterSpacing: '.06em' } : {}),
          }}
        >
          {k === 'none' ? 'transparent' : ''}
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

  // Text color rows (prototype 4625–4626)
  const txRows: { k: string; v: string; on: (v: string) => void }[] = [
    { k: 'Story headings', v: S.txtCfg.head, on: (v) => patch({ txtCfg: { ...S.txtCfg, head: v } }) },
    { k: 'Story body', v: S.txtCfg.body, on: (v) => patch({ txtCfg: { ...S.txtCfg, body: v } }) },
    ...(S.txtCfg.split
      ? [
          { k: 'Notes headings', v: S.txtCfg.nHead, on: (v: string) => patch({ txtCfg: { ...S.txtCfg, nHead: v } }) },
          { k: 'Notes body', v: S.txtCfg.nBody, on: (v: string) => patch({ txtCfg: { ...S.txtCfg, nBody: v } }) },
        ]
      : []),
  ];

  const pc = S.pageCfg;
  const setPc = (p: Partial<LiquidNeonV2Settings['pageCfg']>) => patch({ pageCfg: { ...pc, ...p } });

  const transparencyMismatch = windowTransparent !== null && (S.wp === 'none') !== windowTransparent;

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
  });

  return (
    <section className="settings-section lnas-root" aria-labelledby="section-liquid-neon" data-settings-cat="appearance">
      <h3 className="settings-section-title" id="section-liquid-neon">Liquid Neon</h3>

      <Card title="Color theme" sub="Curated neon sets. Pick one, or build your own below.">
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>{presetCards}</div>
      </Card>

      <Card title="Neon border colors" sub="Six slots. A · B · C frame the panels, tabs and gradients; D · E color data accents like graph categories; F lights the nav rail and window frame. Pick a swatch — or use the wheel to get it just right.">
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
              <div style={{ fontSize: 11.5, color: '#aebad0' }}>Neon window frame</div>
              <div style={{ fontSize: 10, color: '#7686a2', marginTop: 1 }}>Six-color gradient ring around the window — static, laptop-friendly</div>
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

      <Card title="Background" sub="The glass needs something to refract. Wallpaper sits behind every panel — or go fully transparent and let your desktop show through.">
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
        {transparencyMismatch && (
          <div className="lnas-restart-row" data-testid="lnas-restart-row">
            <span style={{ flex: 1, fontSize: 11, color: '#ffd97a' }}>
              {S.wp === 'none'
                ? 'True transparency needs a window restart — until then a checkerboard stands in.'
                : 'The window is still transparent — restart to bring the solid backdrop back.'}
            </span>
            <button
              type="button"
              className="lnas-restart-btn"
              data-testid="lnas-restart-btn"
              onClick={() => { void window.api?.appRelaunch?.(); }}
            >
              Restart now
            </button>
          </div>
        )}
      </Card>

      <Card title="Neon animation" sub="Animates the window frame and every panel border — Cycle rotates the colors, Sparkle fades your palette in and out.">
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

      <Card title="Text colors" sub="Story and notes match by default — split them to style each on its own.">
        {txRows.map((r) => (
          <div key={r.k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
            <span style={{ flex: 1, fontSize: 11.5, color: '#aebad0' }}>{r.k}</span>
            <span style={{ fontSize: 10, color: '#7686a2', fontFamily: 'ui-monospace,monospace' }}>{r.v}</span>
            <ColorWheel value={r.v} onChange={r.on} data-testid={`lnas-tx-${r.k.replace(/\s+/g, '-').toLowerCase()}`} />
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 7, borderTop: '1px solid rgba(255,255,255,.06)', marginTop: 6 }}>
          <span style={{ flex: 1, fontSize: 11.5, color: '#aebad0' }}>Separate story &amp; notes colors</span>
          <NeonToggle
            on={S.txtCfg.split}
            testId="lnas-txsplit"
            onClick={() => patch({ txtCfg: { ...S.txtCfg, split: !S.txtCfg.split, nHead: S.txtCfg.head, nBody: S.txtCfg.body } })}
          />
        </div>
      </Card>

      <Card title="Manuscript page" sub="The box your words live in — glass, neon, ancient scroll, or nothing at all.">
        <NeonSeg
          options={[['neon', 'Neon'], ['default', 'No glow'], ['scroll', 'Scroll'], ['off', 'Off']]}
          current={pc.mode}
          onPick={(k) => setPc({ mode: k })}
          testIdPrefix="lnas-page"
        />
        {pc.mode !== 'off' && pc.mode !== 'scroll' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 0 6px' }}>
              <span style={{ flex: 1, fontSize: 11.5, color: '#aebad0' }}>Background color</span>
              <span style={{ fontSize: 10, color: '#7686a2', fontFamily: 'ui-monospace,monospace' }}>{pc.bg}</span>
              <ColorWheel value={pc.bg} onChange={(v) => setPc({ bg: v })} data-testid="lnas-pagebg" />
            </div>
            <div style={{ marginBottom: 11 }}>
              <NeonSlider label="Background opacity" value={pc.op} min={0} max={96} unit="%" onChange={(v) => setPc({ op: v })} testId="lnas-pageop" />
            </div>
            <div style={{ marginBottom: 4 }}>
              <NeonSlider label="Background blur" value={pc.blur} min={0} max={30} unit="px" onChange={(v) => setPc({ blur: v })} testId="lnas-pageblur" />
            </div>
          </>
        )}
        {pc.mode === 'scroll' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 0 6px' }}>
              <span style={{ flex: 1, fontSize: 11.5, color: '#aebad0' }}>Scroll color</span>
              <span style={{ fontSize: 10, color: '#7686a2', fontFamily: 'ui-monospace,monospace' }}>{S.scrollTint}</span>
              <ColorWheel value={S.scrollTint} gradient={SCROLL_WHEEL_GRADIENT} onChange={(v) => patch({ scrollTint: v })} data-testid="lnas-scrolltint" />
            </div>
            <div style={{ marginBottom: 8 }}>
              <NeonSlider label="Scroll opacity" value={S.scrollOp} min={30} max={100} unit="%" onChange={(v) => patch({ scrollOp: v })} testId="lnas-scrollop" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 2 }}>
              <span style={{ flex: 1, fontSize: 11.5, color: '#aebad0' }}>Glowing archaic symbols</span>
              <NeonToggle on={!!pc.sym} onClick={() => setPc({ sym: !pc.sym })} testId="lnas-pagesym" />
            </div>
          </>
        )}
      </Card>

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
