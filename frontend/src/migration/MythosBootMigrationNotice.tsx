// SKY-10405 — boot-time silent MythosVault migration: failure notice.
//
// The silent upgrade never asks the user anything, but a FAILURE must never
// be silent either (SKY-10390 acceptance: clear actionable error, original
// vault stays open). Main reports the boot attempt's error through
// mythosMigration:status; this card surfaces it once per session.
//
// Deliberately self-contained (own CSS, no wizard imports) so the sibling
// ticket removing the upgrade prompt/wizard components cannot orphan it.
import { useEffect, useState } from 'react';
import './MythosBootMigrationNotice.css';

export default function MythosBootMigrationNotice() {
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const api = window.api;
    if (typeof api?.mythosMigrationStatus !== 'function') return;
    api
      .mythosMigrationStatus()
      .then((s) => {
        if (cancelled || !s || typeof s !== 'object') return;
        if (s.bootMigrationError) setError(s.bootMigrationError);
      })
      .catch(() => {
        /* status probe is best-effort — never block the shell */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!error || dismissed) return null;
  return (
    <div
      className="mythos-boot-migration-error"
      role="alert"
      data-testid="mythos-boot-migration-error"
    >
      <div className="mythos-boot-migration-error-title">Vault upgrade failed</div>
      <div className="mythos-boot-migration-error-body">
        Mythos Writer could not upgrade this vault to the MythosVault format, so
        it opened your original vault unchanged. The upgrade will be retried on
        the next launch.
        <div className="mythos-boot-migration-error-detail">{error}</div>
      </div>
      <div className="mythos-boot-migration-error-actions">
        <button
          type="button"
          className="mythos-boot-migration-error-btn"
          data-testid="mythos-boot-migration-error-dismiss"
          onClick={() => setDismissed(true)}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
