// Beta 4 M1 — Settings → Vault & Files "Mythos vaults" cards (prototype
// 2584–2612; myVaultRows 7103–7121): every known vault as a clickable card
// with a per-vault default theme select (§3: "Per-vault default theme:
// dropdown on each vault card; switching vaults applies its theme + toast").
// Clicking a card switches vaults; DesktopShell applies the stored theme on
// the switch push. M28 later grows these cards (stats, import, danger zone).
// SKY-10401: "New vault" button + inline create-empty-vault flow — reuses the
// SKY-320 vaultCreateDefaultMythos backend with activate:false, then offers a
// normal project:switch to the new vault.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  applyLiquidNeonV2Tokens,
  normalizeLiquidNeonV2,
  type LiquidNeonV2Settings,
} from '../../../theme/liquidNeonEngine';
import { LIQUID_NEON_PRESETS, type LiquidNeonPresetKey } from '../../../theme/presets';
import { showLnToast } from '../../../theme/lnToast';
import { deriveVaultDisplayName } from '../../../ProjectSwitcher';
import VaultDestinationPicker from './VaultDestinationPicker';
import { useVaultIcons } from '../../../hooks/useVaultIcons';
import { VaultIconAvatar } from '../../ui/VaultIconAvatar';
import { VaultIconEditMenu } from '../../ui/VaultIconEditMenu';
import VaultOverflowMenu from './VaultOverflowMenu';
import cosmicBgUrl from '../../../assets/cosmic-bg.webp';

interface VaultEntry {
  vaultRoot: string;
  notesVaultRoot?: string;
  name: string;
}

interface VaultStatEntry {
  storyFileCount: number;
  noteCount: number | null;
  notesVaultCount: number;
  storyVaultCount: number;
}

/** SKY-11154: the enclosing Mythos-vault root for the "..." Hide/Delete menu
 *  and for cross-referencing the hidden-paths list — vaults live FLAT
 *  directly under it (path.join(mythosRoot, 'Story Vault')), so strip that
 *  one known segment when present; a legacy (pre-v2) vaultRoot has no such
 *  enclosing folder, so it stands in for itself. */
function mythosPathFor(vaultRoot: string): string {
  const m = vaultRoot.match(/^(.*)[\\/]Story Vault$/);
  return m ? m[1] : vaultRoot;
}

function pluralize(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

interface CreatedVault {
  mythosVaultRoot: string;
  vaultRoot: string;
  notesVaultRoot: string;
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
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDest, setCreateDest] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdVault, setCreatedVault] = useState<CreatedVault | null>(null);
  const createNameRef = useRef<HTMLInputElement | null>(null);
  // SKY-11068: per-vault icon — vault-local, shared with the nav-rail tiles
  // and title-bar switcher.
  const { icons: vaultIcons, loadIcons, setVaultIcon, pickIconImage } = useVaultIcons();
  const [iconEditFor, setIconEditFor] = useState<string | null>(null);
  const iconEditTriggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  // SKY-11154: inner notes/story vault counts per card (§4).
  const [statsByRoot, setStatsByRoot] = useState<Record<string, VaultStatEntry>>({});
  // SKY-11154: inline rename (double-click a vault name) — Enter commits,
  // Escape cancels, blur commits.
  const [renameFor, setRenameFor] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // SKY-11154: Hide/Delete + "Show hidden" (§4a) — hidden state is a flat
  // list of absolute vault-root paths, cross-referenced against each card's
  // computed Mythos-root path.
  const [hiddenPaths, setHiddenPaths] = useState<string[]>([]);
  const [showHidden, setShowHidden] = useState(false);

  const refreshVaults = useCallback(() => {
    window.api?.projectList?.()
      .then((res) => { if (res?.projects) setVaults(res.projects); })
      .catch(() => { /* non-fatal — section renders empty */ });
    window.api?.projectStats?.()
      .then((res) => {
        if (!res?.stats) return;
        const next: Record<string, VaultStatEntry> = {};
        for (const s of res.stats) {
          next[s.vaultRoot] = {
            storyFileCount: s.storyFileCount,
            noteCount: s.noteCount,
            notesVaultCount: s.notesVaultCount,
            storyVaultCount: s.storyVaultCount,
          };
        }
        setStatsByRoot(next);
      })
      .catch(() => { /* non-fatal — counts just don't render */ });
  }, []);

  const refreshHidden = useCallback(() => {
    window.api?.vaultSurfaceListHidden?.()
      .then((res) => { if (res?.hiddenVaultRoots) setHiddenPaths(res.hiddenVaultRoots); })
      .catch(() => { /* non-fatal */ });
  }, []);

  useEffect(() => {
    refreshVaults();
    refreshHidden();
    loadIcons();
    window.api?.getVaultRoot?.()
      .then((res) => { if (res?.vaultRoot) setActiveRoot(res.vaultRoot); })
      .catch(() => { /* non-fatal */ });
  }, [refreshVaults, refreshHidden, loadIcons]);

  useEffect(() => {
    if (createOpen) createNameRef.current?.focus();
  }, [createOpen]);

  // If the user switches to the just-created vault via its card instead of
  // the offer button, the offer is answered — drop it.
  useEffect(() => {
    if (createdVault && activeRoot === createdVault.vaultRoot) setCreatedVault(null);
  }, [activeRoot, createdVault]);

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

  /** SKY-10385: open the create form, prefilled with the default vaults
   *  parent (same rule Skyy set for import destinations in SKY-10370 R3). */
  const onOpenCreate = useCallback(async () => {
    setCreateOpen(true);
    setCreateError(null);
    setCreatedVault(null);
    if (!createDest) {
      try {
        const paths = await window.api?.vaultGetPaths?.();
        if (paths?.defaultVaultsParentPath) setCreateDest(paths.defaultVaultsParentPath);
      } catch { /* prefill unavailable — Browse still works */ }
    }
  }, [createDest]);

  const onCancelCreate = useCallback(() => {
    setCreateOpen(false);
    setCreateError(null);
  }, []);

  const onBrowseDest = useCallback(async () => {
    try {
      const res = await window.api?.chooseVaultFolder?.('Choose where to create the new vault', createDest || undefined);
      if (res && !res.cancelled && res.path) setCreateDest(res.path);
    } catch { /* picker unavailable */ }
  }, [createDest]);

  /** Create the vault WITHOUT activating it (activate:false) — main scaffolds
   *  Story Vault + Notes Vault with the standard seeded layout and registers
   *  the pair in recents; the user is then offered a normal switch. */
  const onCreateVault = useCallback(async () => {
    if (createBusy) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const res = await window.api?.vaultCreateDefaultMythos?.({
        parentPath: createDest || undefined,
        vaultName: createName.trim() || undefined,
        seedMode: 'default',
        activate: false,
      });
      if (!res || res.error) {
        setCreateError(res?.error ?? 'Could not create the vault. Check the destination and try again.');
      } else {
        setCreatedVault({
          mythosVaultRoot: res.mythosVaultRoot,
          vaultRoot: res.vaultRoot,
          notesVaultRoot: res.notesVaultRoot,
          name: res.name,
        });
        setCreateOpen(false);
        setCreateName('');
        showLnToast(`Vault "${res.name}" created`);
        refreshVaults();
      }
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Could not create the vault.');
    } finally {
      setCreateBusy(false);
    }
  }, [createBusy, createDest, createName, refreshVaults]);

  const onSwitchToCreated = useCallback(async () => {
    if (!createdVault || createBusy) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const res = await window.api?.projectSwitch?.(createdVault.vaultRoot, createdVault.notesVaultRoot);
      if (res?.switched) {
        setActiveRoot(createdVault.vaultRoot);
        setCreatedVault(null);
      } else {
        setCreateError('Could not switch to the new vault — it is still available in the vault list below.');
      }
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Could not switch to the new vault.');
    } finally {
      setCreateBusy(false);
    }
  }, [createdVault, createBusy]);

  const onDismissCreated = useCallback(() => {
    setCreatedVault(null);
    setCreateError(null);
  }, []);

  /** SKY-11154: matches DesktopShell.tsx's existing precedence (line ~1762)
   *  — settings.vaultDisplayNames override wins, then the derived name, then
   *  the raw project name. This component previously ignored the override
   *  entirely; that was a bug fixed as part of wiring up the rename UI. */
  const displayNameFor = useCallback((v: VaultEntry): string => (
    settings.vaultDisplayNames?.[v.vaultRoot] ?? (deriveVaultDisplayName(v) || v.name)
  ), [settings.vaultDisplayNames]);

  const startRename = useCallback((v: VaultEntry) => {
    setRenameFor(v.vaultRoot);
    setRenameValue(displayNameFor(v));
  }, [displayNameFor]);

  const cancelRename = useCallback(() => {
    setRenameFor(null);
    setRenameValue('');
  }, []);

  /** Persisted the SAME way onThemeChange (above) persists vaultThemes — a
   *  plain settings write, non-fatal on failure. Empty submissions are
   *  ignored (revert to the previous name, no override written). */
  const commitRename = useCallback((v: VaultEntry) => {
    const trimmed = renameValue.trim();
    setRenameFor(null);
    if (!trimmed) return;
    const vaultDisplayNames = { ...(settings.vaultDisplayNames ?? {}), [v.vaultRoot]: trimmed };
    const next: AppSettings = { ...settings, vaultDisplayNames };
    setSettings(next);
    setSavedOk(false);
    window.api?.settingsSet?.(next).catch(() => { /* panel Save still persists */ });
  }, [renameValue, settings, setSettings, setSavedOk]);

  const onUnhide = useCallback((vaultRoot: string) => {
    window.api?.vaultSurfaceUnhide?.(vaultRoot)
      .then(() => refreshHidden())
      .catch(() => { /* non-fatal */ });
  }, [refreshHidden]);

  return (
    <section className="settings-section" aria-labelledby="section-mythos-vaults" data-settings-cat="vaults">
      <div className="settings-section-header-row" style={{ justifyContent: 'space-between' }}>
        <h3 className="settings-section-title" id="section-mythos-vaults">Mythos vaults</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="m24-btn"
            data-testid="mvs-show-hidden-btn"
            aria-expanded={showHidden}
            onClick={() => setShowHidden((s) => !s)}
          >
            Show hidden{hiddenPaths.length > 0 ? ` (${hiddenPaths.length})` : ''}
          </button>
          <button
            type="button"
            className="m24-btn m24-btn--primary"
            data-testid="mvs-new-vault"
            onClick={() => { void onOpenCreate(); }}
            disabled={createBusy}
          >
            New vault…
          </button>
        </div>
      </div>
      <p className="settings-hint">
        Each Mythos vault is a folder holding its own Story Vault + Notes Vault. Give each vault its
        own theme so you always know where you are — switching vaults applies its theme.
      </p>

      {createOpen && !createdVault && (
        <div
          data-testid="mvs-create-form"
          style={{ padding: 12, borderRadius: 12, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          <label className="settings-label" htmlFor="mvs-create-name">Vault name</label>
          <input
            id="mvs-create-name"
            data-testid="mvs-create-name"
            ref={createNameRef}
            className="settings-input"
            value={createName}
            maxLength={120}
            placeholder="My First Vault"
            disabled={createBusy}
            onChange={(e) => setCreateName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void onCreateVault(); }}
          />
          <div className="settings-label" style={{ marginTop: 4 }}>Destination</div>
          <VaultDestinationPicker
            variant="m24"
            path={createDest}
            placeholder="Choose where to create the new vault"
            onBrowse={onBrowseDest}
            disabled={createBusy}
            testIdPrefix="mvs-create-dest"
          />
          <p className="settings-hint">
            A new folder named after the vault is created inside this destination.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
            <button
              type="button"
              className="m24-btn m24-btn--primary"
              data-testid="mvs-create-confirm"
              onClick={() => { void onCreateVault(); }}
              disabled={createBusy}
            >
              {createBusy ? 'Creating…' : 'Create vault'}
            </button>
            <button type="button" className="m24-btn" data-testid="mvs-create-cancel" onClick={onCancelCreate} disabled={createBusy}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {createdVault && (
        <div
          data-testid="mvs-create-done"
          role="status"
          aria-live="polite"
          style={{ padding: 12, borderRadius: 12, background: 'var(--gs1,rgba(0,240,255,.06))', border: 'var(--bw,1px) solid var(--b1,rgba(0,240,255,.45))', display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          <div style={{ fontSize: 11.5, color: '#dbe4f5' }}>
            Vault <span style={{ fontWeight: 600 }}>{createdVault.name}</span> created — switch to it now?
          </div>
          <div style={{ fontSize: 10.5, color: '#8e9db8', fontFamily: 'ui-monospace,monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {createdVault.mythosVaultRoot}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="m24-btn m24-btn--primary"
              data-testid="mvs-create-switch"
              onClick={() => { void onSwitchToCreated(); }}
              disabled={createBusy}
            >
              Switch to it now
            </button>
            <button type="button" className="m24-btn" data-testid="mvs-create-stay" onClick={onDismissCreated} disabled={createBusy}>
              Not now
            </button>
          </div>
        </div>
      )}

      {createError && (
        <p className="settings-error-msg" role="alert" data-testid="mvs-create-error">{createError}</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {vaults.filter((v) => !hiddenPaths.includes(mythosPathFor(v.vaultRoot))).map((v) => {
          const current = v.vaultRoot === activeRoot;
          const themeKey = settings.vaultThemes?.[v.vaultRoot] ?? '';
          const displayName = displayNameFor(v);
          const stats = statsByRoot[v.vaultRoot];
          const renaming = renameFor === v.vaultRoot;
          return (
            <div
              key={v.vaultRoot}
              role="button"
              tabIndex={0}
              aria-label={current ? `Current vault: ${displayName}` : `Switch to vault ${displayName}`}
              data-testid={`mvs-card-${v.vaultRoot}`}
              title={current ? undefined : 'Click to switch to this vault'}
              style={cardSt(current)}
              onClick={() => { void onCardClick(v); }}
              onDoubleClick={() => { if (!renaming) startRename(v); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  void onCardClick(v);
                }
              }}
            >
              <button
                type="button"
                className="mvs-card-icon-edit"
                ref={(el) => { if (el) iconEditTriggerRefs.current.set(v.vaultRoot, el); else iconEditTriggerRefs.current.delete(v.vaultRoot); }}
                aria-label={`Set icon for ${displayName}`}
                data-testid={`mvs-icon-edit-${v.vaultRoot}`}
                style={{ flex: 'none', background: 'none', border: 'none', padding: 0, margin: 0, cursor: 'pointer', borderRadius: 8 }}
                onClick={(e) => { e.stopPropagation(); setIconEditFor((cur) => (cur === v.vaultRoot ? null : v.vaultRoot)); }}
              >
                <VaultIconAvatar icon={vaultIcons[v.vaultRoot]} label={displayName} size="md" />
              </button>
              {iconEditFor === v.vaultRoot && (
                <VaultIconEditMenu
                  open
                  anchorEl={iconEditTriggerRefs.current.get(v.vaultRoot) ?? null}
                  hasIcon={vaultIcons[v.vaultRoot]?.kind != null}
                  data-testid={`mvs-icon-edit-menu-${v.vaultRoot}`}
                  onClose={() => setIconEditFor(null)}
                  onPickImage={() => {
                    pickIconImage()?.then((res) => {
                      if (res?.filePath) setVaultIcon(v.vaultRoot, { kind: 'image', sourcePath: res.filePath });
                    });
                  }}
                  onSetIcon={(icon) => { setVaultIcon(v.vaultRoot, icon); setIconEditFor(null); }}
                />
              )}
              <div
                style={{ flex: 1, minWidth: 0 }}
                onDoubleClick={(e) => { e.stopPropagation(); if (!renaming) startRename(v); }}
              >
                {renaming ? (
                  <input
                    className="settings-input"
                    autoFocus
                    aria-label={`Rename vault ${displayName}`}
                    data-testid={`mvs-rename-input-${v.vaultRoot}`}
                    value={renameValue}
                    style={{ fontSize: 12, height: 24, padding: '0 6px' }}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(v)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') { e.preventDefault(); commitRename(v); }
                      else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                    }}
                  />
                ) : (
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#e6ecf9' }}>{displayName}</div>
                )}
                <div style={{ fontSize: 10, color: '#8e9db8', marginTop: 2, fontFamily: 'ui-monospace,monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {v.vaultRoot}
                </div>
                {stats && (
                  <div style={{ fontSize: 10, color: '#7686a2', marginTop: 2 }}>
                    {pluralize(stats.notesVaultCount, 'notes vault')} · {pluralize(stats.storyVaultCount, 'story vault')}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 'none', alignItems: 'flex-end' }}>
                <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '.1em', color: '#586a88' }}>VAULT THEME</span>
                <select
                  value={themeKey}
                  data-testid={`mvs-theme-${v.vaultRoot}`}
                  aria-label={`Default theme for vault ${displayName}`}
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
              <div onClick={(e) => e.stopPropagation()}>
                <VaultOverflowMenu
                  level="mythos"
                  vaultPath={mythosPathFor(v.vaultRoot)}
                  vaultName={displayName}
                  testIdSuffix={v.vaultRoot}
                  onHidden={refreshHidden}
                  onDeleted={refreshVaults}
                />
              </div>
            </div>
          );
        })}
        {vaults.length === 0 && (
          <p className="settings-hint" data-testid="mvs-empty">
            No Mythos vaults known yet — use the New vault… button above to create one.
          </p>
        )}
      </div>

      {showHidden && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }} data-testid="mvs-hidden-list">
          {vaults.filter((v) => hiddenPaths.includes(mythosPathFor(v.vaultRoot))).map((v) => (
            <div
              key={`hidden-${v.vaultRoot}`}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 10, background: 'rgba(255,255,255,.02)', border: '1px dashed rgba(255,255,255,.1)' }}
            >
              <span style={{ flex: 1, fontSize: 11.5, color: '#8e9db8' }}>{displayNameFor(v)}</span>
              <button
                type="button"
                className="m24-btn"
                data-testid={`mvs-unhide-${v.vaultRoot}`}
                onClick={() => onUnhide(mythosPathFor(v.vaultRoot))}
              >
                Unhide
              </button>
            </div>
          ))}
          {vaults.filter((v) => hiddenPaths.includes(mythosPathFor(v.vaultRoot))).length === 0 && (
            <p className="settings-hint">No hidden Mythos vaults.</p>
          )}
        </div>
      )}
    </section>
  );
}
