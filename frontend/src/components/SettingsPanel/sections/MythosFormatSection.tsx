// Beta 4 M5 — Settings → Vaults: vault format card.
//
// Shows which storage format the active vault uses and, for v0.4 twin-root
// vaults, offers the copy-based upgrade wizard (the same one the boot prompt
// opens). Renders nothing while the status probe is in flight so the Vaults
// tab is unchanged for v2 vaults' existing assertions.
import { useEffect, useState } from 'react';
import { openMythosMigrationWizard } from '../../../migration/MythosMigrationCenter';

export default function MythosFormatSection() {
  const [status, setStatus] = useState<MythosMigrationStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const api = window.api;
    if (typeof api?.mythosMigrationStatus !== 'function') return;
    api
      .mythosMigrationStatus()
      .then((s) => {
        if (!cancelled && s && typeof s === 'object') setStatus(s);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status) return null;

  return (
    <section
      className="settings-section"
      aria-labelledby="section-vault-format"
      data-settings-cat="vaults"
      data-testid="mythos-format-section"
    >
      <h3 className="settings-section-title" id="section-vault-format">Vault format</h3>
      {status.format === 'mythos-v2' ? (
        <p className="settings-hint" data-testid="mythos-format-current">
          This vault uses the <strong>MythosVault</strong> format — everything lives as
          plain files in one folder (manuscripts, notes, comments, draft history,
          timelines). Copy or sync the folder and all of it travels along.
        </p>
      ) : (
        <>
          <p className="settings-hint" data-testid="mythos-format-current">
            This vault uses the older <strong>v0.4 two-folder</strong> layout. Upgrading
            builds a complete copy in the new single-folder MythosVault format —
            your current vault is never modified.
          </p>
          <div className="settings-input-row">
            <button
              type="button"
              className="settings-btn settings-btn-secondary"
              data-testid="mythos-format-upgrade-btn"
              onClick={openMythosMigrationWizard}
            >
              Upgrade to MythosVault…
            </button>
          </div>
        </>
      )}
    </section>
  );
}
