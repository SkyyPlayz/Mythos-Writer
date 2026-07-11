// Beta 4 M5 — MythosVault upgrade entry points.
//
// On boot the main process reports whether the active vault is still in the
// v0.4 twin-root format. When it is (and the user hasn't dismissed the offer
// for this vault) a small, non-blocking card invites them into the wizard.
// The card is fixed to the lower-left corner ABOVE the status bar and never
// overlays the nav rail, menus, or editors — v0.4 vaults keep working
// untouched until the user chooses to upgrade (the version-gate contract).
//
// The Settings → Vaults card (and any future menu entry) opens the same
// wizard by dispatching OPEN_MYTHOS_MIGRATION_EVENT on window.
import { useCallback, useEffect, useState } from 'react';
import MythosMigrationWizard from './MythosMigrationWizard';
import './MythosMigration.css';

export const OPEN_MYTHOS_MIGRATION_EVENT = 'mythos:open-migration-wizard';

export function openMythosMigrationWizard(): void {
  window.dispatchEvent(new CustomEvent(OPEN_MYTHOS_MIGRATION_EVENT));
}

export default function MythosMigrationCenter() {
  const [status, setStatus] = useState<MythosMigrationStatus | null>(null);
  const [promptVisible, setPromptVisible] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const api = window.api;
    if (typeof api?.mythosMigrationStatus !== 'function') return;
    api
      .mythosMigrationStatus()
      .then((s) => {
        if (cancelled || !s || typeof s !== 'object') return;
        setStatus(s);
        setPromptVisible(Boolean(s.shouldPrompt));
      })
      .catch(() => {
        /* status probe is best-effort — never block the shell */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const open = () => {
      setWizardOpen(true);
      setPromptVisible(false);
    };
    window.addEventListener(OPEN_MYTHOS_MIGRATION_EVENT, open);
    return () => window.removeEventListener(OPEN_MYTHOS_MIGRATION_EVENT, open);
  }, []);

  const dismiss = useCallback(() => {
    setPromptVisible(false);
    void window.api.mythosMigrationDismiss?.().catch(() => undefined);
  }, []);

  if (!status || status.format !== 'v0.4-twin-root') return null;

  return (
    <>
      {promptVisible && !wizardOpen && (
        <div
          className="mythos-migration-prompt"
          role="status"
          data-testid="mythos-migration-prompt"
        >
          <div className="mythos-migration-prompt-title">New vault format available</div>
          <div className="mythos-migration-prompt-body">
            “{status.vaultName}” still uses the v0.4 layout. Upgrade to a single
            MythosVault folder — your current vault is never modified.
          </div>
          <div className="mythos-migration-prompt-actions">
            <button
              type="button"
              className="mythos-migration-btn mythos-migration-btn-primary"
              data-testid="mythos-migration-prompt-upgrade"
              onClick={() => {
                setWizardOpen(true);
                setPromptVisible(false);
              }}
            >
              Upgrade…
            </button>
            <button
              type="button"
              className="mythos-migration-btn"
              data-testid="mythos-migration-prompt-dismiss"
              onClick={dismiss}
            >
              Not now
            </button>
          </div>
        </div>
      )}
      {wizardOpen && (
        <MythosMigrationWizard status={status} onClose={() => setWizardOpen(false)} />
      )}
    </>
  );
}
