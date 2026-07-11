// Beta 4 M1 — Settings → Vault & Files "Mythos vaults" cards (prototype
// 2584–2612; myVaultRows 7103–7121): every known vault as a clickable card
// with a per-vault default theme select (§3: "Per-vault default theme:
// dropdown on each vault card; switching vaults applies its theme + toast").
// Clicking a card switches vaults; DesktopShell applies the stored theme on
// the switch push. M28 later grows these cards (stats, import, danger zone).
import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  applyLiquidNeonV2Tokens,
  normalizeLiquidNeonV2,
  type LiquidNeonV2Settings,
} from '../../../theme/liquidNeonEngine';
import { LIQUID_NEON_PRESETS, type LiquidNeonPresetKey } from '../../../theme/presets';
import { showLnToast } from '../../../theme/lnToast';
import { deriveVaultDisplayName } from '../../../ProjectSwitcher';
import cosmicBgUrl from '../../../assets/cosmic-bg.webp';

interface VaultEntry {
  vaultRoot: string;
  notesVaultRoot?: string;
  name: string;
}

interface Props {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  setSavedOk: (ok: boolean) => void;
}

const cardSt = (current: boolean): CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 12,
  background: 'rgba(255,255,255,.03)',
  border: current ? 'var(--bw,1px) solid var(--b1,rgba(0,240,255,.45))' : '1px solid rgba(255,255,255,.08)',
  cursor: current ? 'default' : 'pointer',
});

export default function MythosVaultsSection({ settings, setSettings, setSavedOk }: Props) {
  const [vaults, setVaults] = useState<VaultEntry[]>([]);
  const [activeRoot, setActiveRoot] = useState<string>('');

  useEffect(() => {
    window.api?.projectList?.()
      .then((res) => { if (res?.projects) setVaults(res.projects); })
      .catch(() => { /* non-fatal — section renders empty */ });
    window.api?.getVaultRoot?.()
      .then((res) => { if (res?.vaultRoot) setActiveRoot(res.vaultRoot); })
      .catch(() => { /* non-fatal */ });
  }, []);

  /** Prototype themeChange (7112–7120): store the vault's default; when it is
   *  the CURRENT vault, also apply it live. Persisted immediately so a vault
   *  switch applies the stored default without needing a panel Save first. */
  const onThemeChange = useCallback((v: VaultEntry, key: string) => {
    const preset = LIQUID_NEON_PRESETS[key as LiquidNeonPresetKey];
    if (!preset) return;
    const vaultThemes = { ...(settings.vaultThemes ?? {}), [v.vaultRoot]: key };
    let next: AppSettings = { ...settings, vaultThemes };
    if (v.vaultRoot === activeRoot) {
      const ln: LiquidNeonV2Settings = {
        ...normalizeLiquidNeonV2(settings.liquidNeonV2),
        setKey: preset.key,
        slots: [...preset.c] as LiquidNeonV2Settings['slots'],
        wp: 'match',
      };
      next = { ...next, liquidNeonV2: ln };
      applyLiquidNeonV2Tokens(ln, cosmicBgUrl);
    }
    setSettings(next);
    setSavedOk(false);
    window.api?.settingsSet?.(next).catch(() => { /* panel Save still persists */ });
    showLnToast(deriveVaultDisplayName(v) + ' default theme — ' + preset.name);
  }, [settings, activeRoot, setSettings, setSavedOk]);

  /** Prototype cardH (7111): click anywhere on a non-current card switches.
   *  DesktopShell hears the switch push and applies the vault's theme + toast;
   *  the panel's own copy of liquidNeonV2 is mirrored so a later Save can't
   *  write the pre-switch theme back. */
  const onCardClick = useCallback(async (v: VaultEntry) => {
    if (v.vaultRoot === activeRoot) return;
    try {
      const res = await window.api?.projectSwitch?.(v.vaultRoot, v.notesVaultRoot);
      if (res?.switched) {
        setActiveRoot(v.vaultRoot);
        const key = settings.vaultThemes?.[v.vaultRoot];
        const preset = key ? LIQUID_NEON_PRESETS[key as LiquidNeonPresetKey] : undefined;
        if (preset) {
          setSettings((prev) => ({
            ...prev,
            liquidNeonV2: {
              ...normalizeLiquidNeonV2(prev.liquidNeonV2),
              setKey: preset.key,
              slots: [...preset.c] as LiquidNeonV2Settings['slots'],
              wp: 'match',
            },
          }));
        }
      }
    } catch { /* switch failed — card stays as-is */ }
  }, [activeRoot, settings.vaultThemes, setSettings]);

  return (
    <section className="settings-section" aria-labelledby="section-mythos-vaults" data-settings-cat="vaults">
      <h3 className="settings-section-title" id="section-mythos-vaults">Mythos vaults</h3>
      <p className="settings-hint">
        Each Mythos vault is a folder holding its own Story Vault + Notes Vault. Give each vault its
        own theme so you always know where you are — switching vaults applies its theme.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {vaults.map((v) => {
          const current = v.vaultRoot === activeRoot;
          const themeKey = settings.vaultThemes?.[v.vaultRoot] ?? '';
          return (
            <div
              key={v.vaultRoot}
              role="button"
              tabIndex={0}
              aria-label={current ? `Current vault: ${deriveVaultDisplayName(v)}` : `Switch to vault ${deriveVaultDisplayName(v)}`}
              data-testid={`mvs-card-${v.vaultRoot}`}
              title={current ? undefined : 'Click to switch to this vault'}
              style={cardSt(current)}
              onClick={() => { void onCardClick(v); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  void onCardClick(v);
                }
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#e6ecf9' }}>{deriveVaultDisplayName(v) || v.name}</div>
                <div style={{ fontSize: 10, color: '#8e9db8', marginTop: 2, fontFamily: 'ui-monospace,monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {v.vaultRoot}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 'none', alignItems: 'flex-end' }}>
                <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '.1em', color: '#586a88' }}>VAULT THEME</span>
                <select
                  value={themeKey}
                  data-testid={`mvs-theme-${v.vaultRoot}`}
                  aria-label={`Default theme for vault ${deriveVaultDisplayName(v)}`}
                  title="Default theme for this vault — makes it obvious which vault you're in"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  onChange={(e) => { e.stopPropagation(); if (e.target.value) onThemeChange(v, e.target.value); }}
                  style={{ height: 26, background: 'rgba(255,255,255,.05)', border: 'var(--bw,1px) solid var(--b2,rgba(155,95,255,.4))', borderRadius: 8, color: '#dbe4f5', fontSize: 10.5, padding: '0 7px', cursor: 'pointer' }}
                >
                  <option value="">No default</option>
                  {(Object.keys(LIQUID_NEON_PRESETS) as LiquidNeonPresetKey[]).map((k) => (
                    <option key={k} value={k}>{LIQUID_NEON_PRESETS[k].name}</option>
                  ))}
                </select>
              </div>
              {current ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 600, color: 'var(--n1,#00f0ff)', border: 'var(--bw,1px) solid var(--b1,rgba(0,240,255,.45))', borderRadius: 8, padding: '4px 10px', flex: 'none' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--n1,#00f0ff)', boxShadow: '0 0 7px var(--g1,rgba(0,240,255,.4))' }} />
                  Current
                </span>
              ) : (
                <span style={{ fontSize: 10.5, color: '#7686a2', flex: 'none' }}>Click to switch ›</span>
              )}
            </div>
          );
        })}
        {vaults.length === 0 && (
          <p className="settings-hint" data-testid="mvs-empty">
            No other Mythos vaults yet — create one from the title-bar vault menu.
          </p>
        )}
      </div>
    </section>
  );
}
