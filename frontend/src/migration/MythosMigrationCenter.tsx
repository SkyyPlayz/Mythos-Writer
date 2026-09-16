// SKY-10390 — MythosVault upgrade: migrates silently, no user-facing choice.
//
// The v0.4 → MythosVault format upgrade used to prompt on boot and from a
// Settings card; both are gone (SKY-10407) — the owner ruling is that no
// vault-format choice appears anywhere in the UI. The boot-time migration
// itself now runs silently in the main process (SKY-10405); on failure the
// original vault stays open and MythosBootMigrationNotice surfaces the
// error. This component keeps the wizard reachable via
// OPEN_MYTHOS_MIGRATION_EVENT for a future explicit entry point, but nothing
// in the app currently dispatches it.
import { useEffect, useState } from 'react';
import MythosMigrationWizard from './MythosMigrationWizard';
import './MythosMigration.css';

export const OPEN_MYTHOS_MIGRATION_EVENT = 'mythos:open-migration-wizard';

export function openMythosMigrationWizard(): void {
  window.dispatchEvent(new CustomEvent(OPEN_MYTHOS_MIGRATION_EVENT));
}

// SKY-8882: the migration status used to be probed once at mount and never
// again, so switching or creating a vault mid-session left this card (and
// the Settings → Vaults section) describing whatever vault was active on
// boot. Anything that repoints the active vault must dispatch this so both
// re-probe against the vault that's actually open now.
export const ACTIVE_VAULT_CHANGED_EVENT = 'mythos:active-vault-changed';

export function notifyMythosActiveVaultChanged(): void {
  window.dispatchEvent(new CustomEvent(ACTIVE_VAULT_CHANGED_EVENT));
}

export default function MythosMigrationCenter() {
  const [status, setStatus] = useState<MythosMigrationStatus | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const api = window.api;
    if (typeof api?.mythosMigrationStatus !== 'function') return;
    api
      .mythosMigrationStatus()
      .then((s) => {
        if (cancelled || !s || typeof s !== 'object') return;
        setStatus(s);
      })
      .catch(() => {
        /* status probe is best-effort — never block the shell */
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  useEffect(() => {
    const refresh = () => setRefreshToken((t) => t + 1);
    window.addEventListener(ACTIVE_VAULT_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(ACTIVE_VAULT_CHANGED_EVENT, refresh);
  }, []);

  useEffect(() => {
    const open = () => setWizardOpen(true);
    window.addEventListener(OPEN_MYTHOS_MIGRATION_EVENT, open);
    return () => window.removeEventListener(OPEN_MYTHOS_MIGRATION_EVENT, open);
  }, []);

  if (!status || status.format !== 'v0.4-twin-root' || !wizardOpen) return null;

  return <MythosMigrationWizard status={status} onClose={() => setWizardOpen(false)} />;
}
