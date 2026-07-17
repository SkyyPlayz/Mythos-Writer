// Beta 4 M28 — Settings → Editor: the manuscript-only appearance cards
// (FULL-SPEC §13). The Text colors and Manuscript page cards moved here from
// the Appearance page (they shipped there in M4/M7); §13 pins them to the
// Editor page: Text colors (Story headings, Story body, Wiki links, optional
// split Notes colors) and Manuscript page (mode seg Neon / No glow / Scroll /
// Custom / Off + per-mode controls incl. custom texture upload). Controls
// bind to settings.liquidNeonV2 and apply live via the v2 token engine,
// persisting through the panel's normal Save flow.
import { useMemo } from 'react';
import {
  applyLiquidNeonV2Tokens,
  normalizeLiquidNeonV2,
  type LiquidNeonV2Settings,
} from '../../../theme/liquidNeonEngine';
import {
  onActivateKey,
  NeonToggle,
  NeonSlider,
  NeonSeg,
  NeonCard as Card,
  hdrBtnSt,
  SCROLL_WHEEL_GRADIENT,
} from './liquidNeonControls';
import ColorWheel from '../ColorWheel';
import cosmicBgUrl from '../../../assets/cosmic-bg.webp';
import './LiquidNeonAppearanceSection.css';

interface Props {
  liquidNeonV2: Partial<LiquidNeonV2Settings> | undefined;
  onChange: (next: LiquidNeonV2Settings) => void;
  setSavedOk: (ok: boolean) => void;
}

export default function EditorManuscriptSection({ liquidNeonV2, onChange, setSavedOk }: Props) {
  const S = useMemo(() => normalizeLiquidNeonV2(liquidNeonV2), [liquidNeonV2]);

  const patch = (p: Partial<LiquidNeonV2Settings>) => {
    const next: LiquidNeonV2Settings = { ...S, ...p };
    onChange(next);
    applyLiquidNeonV2Tokens(next, cosmicBgUrl); // live preview
    setSavedOk(false);
  };

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

  /**
   * M7 (§5.1): the manuscript page's own "Custom texture" upload — reuses the
   * same generic image picker as the wallpaper upload, scoped to pageCfg.
   * Unlike the wallpaper (whose raw path is resolved to a data URL later, at
   * theme-apply time), the page texture is rendered directly from this state
   * via a plain CSS url() in pageMode.tsx with no such resolution step — so
   * it's resolved to a data URL here, once, at pick time.
   */
  const pickPageTexture = async () => {
    try {
      const res = await window.api?.pickBgImage?.();
      if (!res?.filePath) return;
      let dataUrl: string | null | undefined;
      try {
        dataUrl = (await window.api?.loadBgImage?.(res.filePath))?.dataUrl;
      } catch { /* fall back to the raw path */ }
      setPc({ mode: 'custom', textureUrl: dataUrl ?? res.filePath });
    } catch { /* dialog cancelled or unavailable */ }
  };

  return (
    <section className="settings-section lnas-root" aria-labelledby="section-editor-manuscript" data-settings-cat="editor">
      <h3 className="settings-section-title" id="section-editor-manuscript">Manuscript appearance</h3>

      <Card title="Text colors" sub="Story and notes match by default — split them to style each on its own.">
        {txRows.map((r) => (
          <div key={r.k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
            <span style={{ flex: 1, fontSize: 11.5, color: '#aebad0' }}>{r.k}</span>
            <span style={{ fontSize: 10, color: '#7686a2', fontFamily: 'ui-monospace,monospace' }}>{r.v}</span>
            <ColorWheel value={r.v} onChange={r.on} data-testid={`lnas-tx-${r.k.replace(/\s+/g, '-').toLowerCase()}`} />
          </div>
        ))}
        {/* M28 (§13): Wiki links color — theme slot B by default; a custom pick
            emits the --wiki-c token (cleared again by "Theme color"). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
          <span style={{ flex: 1, fontSize: 11.5, color: '#aebad0' }}>Wiki links</span>
          {S.txtCfg.wiki ? (
            <div
              role="button"
              tabIndex={0}
              data-testid="lnas-tx-wiki-clear"
              title="Back to the theme's wiki-link color (slot B)"
              onClick={() => patch({ txtCfg: { ...S.txtCfg, wiki: null } })}
              onKeyDown={onActivateKey(() => patch({ txtCfg: { ...S.txtCfg, wiki: null } }))}
              className="lnas-hdr-btn"
              style={hdrBtnSt('--b2')}
            >
              Theme color
            </div>
          ) : (
            <span style={{ fontSize: 10, color: '#7686a2' }}>Theme (slot B)</span>
          )}
          <span style={{ fontSize: 10, color: '#7686a2', fontFamily: 'ui-monospace,monospace' }}>{S.txtCfg.wiki ?? ''}</span>
          <ColorWheel
            value={S.txtCfg.wiki ?? '#9b5fff'}
            onChange={(v) => patch({ txtCfg: { ...S.txtCfg, wiki: v } })}
            data-testid="lnas-tx-wiki-links"
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 7, borderTop: '1px solid rgba(255,255,255,.06)', marginTop: 6 }}>
          <span style={{ flex: 1, fontSize: 11.5, color: '#aebad0' }}>Separate story &amp; notes colors</span>
          <NeonToggle
            on={S.txtCfg.split}
            testId="lnas-txsplit"
            onClick={() => patch({ txtCfg: { ...S.txtCfg, split: !S.txtCfg.split, nHead: S.txtCfg.head, nBody: S.txtCfg.body } })}
          />
        </div>
      </Card>

      <Card title="Manuscript page" sub="The box your words live in — glass, neon, ancient scroll, a texture of your own, or nothing at all.">
        <NeonSeg
          options={[['neon', 'Neon'], ['default', 'No glow'], ['scroll', 'Scroll'], ['custom', 'Custom texture'], ['off', 'Off']]}
          current={pc.mode}
          onPick={(k) => setPc({ mode: k })}
          testIdPrefix="lnas-page"
        />
        {pc.mode === 'custom' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 0 4px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11.5, color: '#aebad0' }}>Page texture image</div>
              <div style={{ fontSize: 10, color: '#7686a2', marginTop: 1, wordBreak: 'break-all' }}>
                {pc.textureUrl ? pc.textureUrl.split(/[\\/]/).pop() : 'No image chosen — cover-fit over the page'}
              </div>
            </div>
            <div
              role="button"
              tabIndex={0}
              data-testid="lnas-page-texture-upload"
              title="Choose a page texture image"
              onClick={() => { void pickPageTexture(); }}
              onKeyDown={onActivateKey(() => { void pickPageTexture(); })}
              className="lnas-hdr-btn"
              style={hdrBtnSt('--b2')}
            >
              Choose image…
            </div>
          </div>
        )}
        {pc.mode !== 'off' && pc.mode !== 'scroll' && pc.mode !== 'custom' && (
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
    </section>
  );
}
