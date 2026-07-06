// Beta 3 "Liquid Neon" M5 — the prototype title bar (HTML 59–134): one 44px
// glass bar hosting the project menu (logo · name · chevron), the six
// File…Help menus, the Ctrl-K search pill, the notification bell, settings,
// the account avatar popover, and the min/max/close controls, finished with
// a 1px --grad hairline. All slots are optional props so the bar still
// renders standalone (SKY-3033 behavior preserved).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import logoUrl from '../../assets/logo.png';
import './WindowChrome.css';

type Platform = string | null;

export interface WindowChromeMenuItem {
  label: string;
  run: () => void;
}

export interface WindowChromeMenu {
  label: string;
  items: WindowChromeMenuItem[];
}

export interface WindowChromeProps {
  /** File…Help menus (prototype menuDefs 4673–4678). Omit to hide the strip. */
  menus?: WindowChromeMenu[];
  /** Opens the Ctrl-K command palette (prototype openCmd). */
  onOpenPalette?: () => void;
  onOpenSettings?: () => void;
  /** Opens the account page/modal (prototype goAccount). */
  onOpenAccount?: () => void;
  /** Project menu wiring (prototype projItems). */
  activeVaultRoot?: string;
  onProjectSwitched?: (vaultRoot: string) => void;
  onNewStory?: () => void;
  onOpenVault?: () => void;
  /** "+ Create new Mythos Vault" — legacy ProjectSwitcher parity (SKY-320/SKY-906). */
  onCreateVault?: () => void;
  onReplayOnboarding?: () => void;
  /** Bell slot — pass <NotificationCenter /> (M5). */
  notificationCenter?: ReactNode;
}

interface ProjectEntry {
  name: string;
  vaultRoot: string;
  notesVaultRoot?: string;
  openedAt: string;
}

function CloseIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.1" aria-hidden="true" focusable="false">
      <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" />
    </svg>
  );
}

function MinimizeIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.1" aria-hidden="true" focusable="false">
      <path d="M1 6h10" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="9" height="9" rx="1" />
    </svg>
  );
}

interface WindowControlsProps {
  onClose: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
  isMac: boolean;
}

function WindowControls({ onClose, onMinimize, onMaximize, isMac }: WindowControlsProps) {
  if (isMac) {
    return (
      <div className="wc-controls wc-controls-left" data-testid="wc-controls">
        <button className="wc-btn wc-btn-close" onClick={onClose} aria-label="Close window" title="Close">
          <CloseIcon />
        </button>
        <button className="wc-btn wc-btn-minimize" onClick={onMinimize} aria-label="Minimize window" title="Minimize">
          <MinimizeIcon />
        </button>
        <button className="wc-btn wc-btn-maximize" onClick={onMaximize} aria-label="Maximize window" title="Maximize">
          <MaximizeIcon />
        </button>
      </div>
    );
  }
  return (
    <div className="wc-controls wc-controls-right" data-testid="wc-controls">
      <button className="wc-btn wc-btn-minimize" onClick={onMinimize} aria-label="Minimize window" title="Minimize">
        <MinimizeIcon />
      </button>
      <button className="wc-btn wc-btn-maximize" onClick={onMaximize} aria-label="Maximize window" title="Maximize">
        <MaximizeIcon />
      </button>
      <button className="wc-btn wc-btn-close" onClick={onClose} aria-label="Close window" title="Close">
        <CloseIcon />
      </button>
    </div>
  );
}

export default function WindowChrome({
  menus,
  onOpenPalette,
  onOpenSettings,
  onOpenAccount,
  activeVaultRoot,
  onProjectSwitched,
  onNewStory,
  onOpenVault,
  onCreateVault,
  onReplayOnboarding,
  notificationCenter,
}: WindowChromeProps) {
  const [platform, setPlatform] = useState<Platform>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [projOpen, setProjOpen] = useState(false);
  const [acctOpen, setAcctOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.api?.getAppInfo?.()
      .then((info) => { setPlatform(info.platform); })
      .catch(() => {});
  }, []);

  // Any open popover closes on outside click (prototype's fixed scrim, 78).
  useEffect(() => {
    if (!openMenu && !projOpen && !acctOpen) return;
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
        setProjOpen(false);
        setAcctOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [openMenu, projOpen, acctOpen]);

  const loadProjects = useCallback(() => {
    window.api?.projectList?.()
      .then((res) => { if (res?.projects) setProjects(res.projects); })
      .catch(() => {});
  }, []);

  const isMac = platform === 'darwin';

  const handleClose = () => { void window.api?.windowClose?.(); };
  const handleMinimize = () => { void window.api?.windowMinimize?.(); };
  const handleMaximize = () => { void window.api?.windowMaximize?.(); };

  const projItems: { t: string; sub: string; on?: boolean; testId?: string; pick: () => void }[] = [
    ...projects.map((p) => ({
      t: p.name || p.vaultRoot.split(/[/\\]/).filter(Boolean).pop() || p.vaultRoot,
      sub: p.vaultRoot,
      on: p.vaultRoot === activeVaultRoot,
      pick: () => {
        setProjOpen(false);
        if (p.vaultRoot === activeVaultRoot) return;
        window.api?.projectSwitch?.(p.vaultRoot, p.notesVaultRoot)
          .then((res) => { if (res?.switched) onProjectSwitched?.(p.vaultRoot); })
          .catch(() => {});
      },
    })),
    ...(onNewStory ? [{ t: 'New story…', sub: 'Fresh vault, ready to write', pick: () => { setProjOpen(false); onNewStory(); } }] : []),
    ...(onOpenVault ? [{ t: 'Open vault…', sub: 'Bring in an existing folder', pick: () => { setProjOpen(false); onOpenVault(); } }] : []),
    ...(onCreateVault ? [{ t: '+ Create new Mythos Vault', sub: 'Fresh Story + Notes pair', testId: 'project-switcher-create-new', pick: () => { setProjOpen(false); onCreateVault(); } }] : []),
    ...(onReplayOnboarding ? [{ t: 'Replay onboarding', sub: 'The welcome wizard, once more', pick: () => { setProjOpen(false); onReplayOnboarding(); } }] : []),
  ];

  return (
    // The extra `app-menu-bar` class is a selector-compat anchor: ~97 E2E
    // waits across the fleet key on it (the old menu row this bar replaces).
    <div className="wc-bar app-menu-bar" role="banner" aria-label="Window chrome" ref={barRef}>
      <div className="wc-drag-region">
        {isMac && (
          <WindowControls onClose={handleClose} onMinimize={handleMinimize} onMaximize={handleMaximize} isMac />
        )}

        {/* Project menu — logo · name · chevron (prototype 61–75) */}
        {/* `project-switcher-btn` / `project-switcher-item` are E2E-compat anchors:
            sky-906 drives vault create/switch through these legacy selectors. */}
        <div
          className="wc-project project-switcher-btn"
          onClick={() => { setProjOpen((o) => { if (!o) loadProjects(); return !o; }); setOpenMenu(null); setAcctOpen(false); }}
          data-testid="wc-project-trigger"
        >
          {projOpen && (
            <div className="wc-popover wc-popover-project" onClick={(e) => e.stopPropagation()} data-testid="wc-project-menu">
              {projItems.map((p) => (
                <div key={p.t + p.sub} className="wc-pop-row project-switcher-item" data-testid={p.testId} onClick={p.pick}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="wc-pop-row-title">{p.t}</div>
                    <div className="wc-pop-row-sub">{p.sub}</div>
                  </div>
                  {p.on && <span className="wc-active-dot" />}
                </div>
              ))}
            </div>
          )}
          <img src={logoUrl} alt="" className="wc-logo" />
          <span className="wc-title" aria-hidden="true">Mythos Writer</span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#8e9db8" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </div>

        {/* File…Help menus (prototype 79–87) */}
        {menus && menus.length > 0 && (
          <div className="wc-menus" data-testid="wc-menus">
            {menus.map((m) => (
              <div
                key={m.label}
                className={`wc-menu${openMenu === m.label ? ' wc-menu--open' : ''}`}
                onClick={(e) => { e.stopPropagation(); setOpenMenu((cur) => (cur === m.label ? null : m.label)); setProjOpen(false); setAcctOpen(false); }}
                data-testid={`wc-menu-${m.label.toLowerCase()}`}
              >
                {m.label}
                {openMenu === m.label && (
                  <div className="wc-popover wc-popover-menu">
                    {m.items.map((i) => (
                      <div
                        key={i.label}
                        className="wc-menu-item"
                        onClick={(e) => { e.stopPropagation(); setOpenMenu(null); i.run(); }}
                      >
                        {i.label}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* Ctrl-K search pill (prototype 89–93) */}
        {onOpenPalette && (
          <div className="wc-search" onClick={onOpenPalette} data-testid="wc-search-pill">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8e9db8" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M20.5 20.5L16 16" /></svg>
            <span className="wc-search-ph">Search vault…</span>
            <span className="wc-kbd">Ctrl K</span>
          </div>
        )}

        <div className="wc-icons">
          {notificationCenter}
          {onOpenSettings && (
            <div className="wc-icon-btn app-menu-gear-btn" onClick={onOpenSettings} role="button" aria-label="Settings" data-testid="wc-settings">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4.5 7.5h15M4.5 16.5h15" /><circle cx="9.5" cy="7.5" r="2.4" /><circle cx="14.5" cy="16.5" r="2.4" /></svg>
            </div>
          )}
          {onOpenAccount && (
            <div
              className="wc-avatar"
              onClick={() => { setAcctOpen((o) => !o); setOpenMenu(null); setProjOpen(false); }}
              role="button"
              aria-label="Account"
              data-testid="wc-avatar"
            >
              M
              {acctOpen && (
                <div className="wc-popover wc-popover-account" onClick={(e) => e.stopPropagation()} data-testid="wc-account-menu">
                  <div className="wc-acct-head">
                    <div className="wc-avatar wc-avatar--lg" aria-hidden="true">M</div>
                    <div style={{ flex: 1 }}>
                      <div className="wc-pop-row-title">M. Writer</div>
                      <div className="wc-acct-plan">Beta plan · local-first</div>
                    </div>
                  </div>
                  <div className="wc-menu-item" onClick={() => { setAcctOpen(false); onOpenAccount(); }}>Account &amp; profile</div>
                  <div className="wc-menu-item" onClick={() => { setAcctOpen(false); onOpenAccount(); }}>Manage devices</div>
                </div>
              )}
            </div>
          )}
        </div>

        {!isMac && (
          <WindowControls onClose={handleClose} onMinimize={handleMinimize} onMaximize={handleMaximize} isMac={false} />
        )}
      </div>
      <div className="wc-hairline" aria-hidden="true" />
    </div>
  );
}
