import { useState, useCallback } from 'react';

type VaultHealthReport = {
  orphanedManifestEntries: string[];
  unindexedFiles: string[];
  manifestSchemaMismatch: boolean;
  corruptedEntries: string[];
};

// SKY-5161 / GH#615: mirrors electron-main `CleanUninstallResponse`. Kept local
// because the frontend `window.api` type in global.d.ts does not model this
// channel; it is reached via the same inline-cast pattern used for the
// vault-integrity calls above. The main-process handler shows the native
// keep-vs-delete dialog and returns this result (or `{ error }` on failure).
type CleanUninstallResult = {
  cancelled: boolean;
  deleted: string[];
  errors: string[];
  customPathsWarning: string[];
};

// VaultHealthSection has fully self-contained state; no props needed from parent.
// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface VaultHealthSectionProps {}

export default function VaultHealthSection(_props: VaultHealthSectionProps) {
  const [vaultHealthReport, setVaultHealthReport] = useState<VaultHealthReport | null>(null);
  const [vaultHealthBusy, setVaultHealthBusy] = useState(false);
  const [vaultHealthError, setVaultHealthError] = useState<string | null>(null);
  const [rebuildBusy, setRebuildBusy] = useState(false);
  const [rebuildResult, setRebuildResult] = useState<{ scenesFound: number; entitiesFound: number } | null>(null);

  // SKY-5161 / GH#615 — "Clear all data" danger-zone control.
  const [clearArmed, setClearArmed] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [clearResult, setClearResult] = useState<CleanUninstallResult | null>(null);

  const handleCheckVaultHealth = useCallback(async () => {
    setVaultHealthBusy(true);
    setVaultHealthError(null);
    setVaultHealthReport(null);
    setRebuildResult(null);
    try {
      const report = await (window.api as typeof window.api & { checkVaultIntegrity: () => Promise<VaultHealthReport> }).checkVaultIntegrity();
      setVaultHealthReport(report);
    } catch (e) {
      setVaultHealthError(e instanceof Error ? e.message : 'Integrity check failed.');
    } finally {
      setVaultHealthBusy(false);
    }
  }, []);

  const handleRebuildManifest = useCallback(async () => {
    setRebuildBusy(true);
    setVaultHealthError(null);
    try {
      const res = await (window.api as typeof window.api & { rebuildVaultManifest: () => Promise<{ rebuilt: boolean; scenesFound: number; entitiesFound: number }> }).rebuildVaultManifest();
      setRebuildResult({ scenesFound: res.scenesFound, entitiesFound: res.entitiesFound });
      setVaultHealthReport(null);
    } catch (e) {
      setVaultHealthError(e instanceof Error ? e.message : 'Rebuild failed.');
    } finally {
      setRebuildBusy(false);
    }
  }, []);

  // SKY-5161 / GH#615 — trigger the main-process clean-uninstall flow. The
  // native keep-vs-delete confirmation dialog is shown by the main process, so
  // this button only arms the destructive action; the OS dialog is the final
  // keep-vs-delete choice, matching the NSIS uninstaller semantics.
  const handleClearAllData = useCallback(async () => {
    setClearBusy(true);
    setClearError(null);
    setClearResult(null);
    try {
      const res = await (window.api as typeof window.api & { cleanUninstall: () => Promise<CleanUninstallResult | { error: string }> }).cleanUninstall();
      if (res && typeof res === 'object' && 'error' in res) {
        setClearError((res as { error: string }).error || 'Clearing app data failed.');
        return;
      }
      setClearResult(res as CleanUninstallResult);
      setClearArmed(false);
    } catch (e) {
      setClearError(e instanceof Error ? e.message : 'Clearing app data failed.');
    } finally {
      setClearBusy(false);
    }
  }, []);

  return (
    <section className="settings-section" aria-labelledby="section-vault-health" data-settings-cat="vaults">
      <h3 className="settings-section-title" id="section-vault-health">Vault health</h3>
      <p className="settings-hint">Check whether the vault manifest matches the files on disk. Use this after moving files outside the app or recovering from a crash.</p>
      <div className="settings-input-row">
        <button
          className="settings-btn settings-btn-secondary"
          type="button"
          onClick={handleCheckVaultHealth}
          disabled={vaultHealthBusy || rebuildBusy}
          data-testid="check-vault-health-btn"
        >
          {vaultHealthBusy ? 'Checking…' : 'Check vault health'}
        </button>
        {rebuildResult && (
          <span className="settings-saved-msg" role="status" data-testid="rebuild-result-msg">
            Manifest rebuilt — {rebuildResult.scenesFound} scene{rebuildResult.scenesFound !== 1 ? 's' : ''}, {rebuildResult.entitiesFound} entit{rebuildResult.entitiesFound !== 1 ? 'ies' : 'y'} found.
          </span>
        )}
      </div>
      {vaultHealthError && (
        <span className="settings-error-msg" role="alert" data-testid="vault-health-error">{vaultHealthError}</span>
      )}
      {vaultHealthReport && (() => {
        const { orphanedManifestEntries, unindexedFiles, manifestSchemaMismatch, corruptedEntries } = vaultHealthReport;
        const hasIssues = orphanedManifestEntries.length > 0 || unindexedFiles.length > 0 || manifestSchemaMismatch || corruptedEntries.length > 0;
        return (
          <div className="settings-vault-health-report" role="status" data-testid="vault-health-report">
            {hasIssues ? (
              <>
                <p className="settings-hint settings-vault-health-issues">Issues found:</p>
                <ul className="settings-vault-health-list">
                  {orphanedManifestEntries.length > 0 && (
                    <li>{orphanedManifestEntries.length} orphaned manifest entr{orphanedManifestEntries.length !== 1 ? 'ies' : 'y'} (manifest references missing files)</li>
                  )}
                  {unindexedFiles.length > 0 && (
                    <li>{unindexedFiles.length} unindexed file{unindexedFiles.length !== 1 ? 's' : ''} (disk files not in manifest)</li>
                  )}
                  {corruptedEntries.length > 0 && (
                    <li>{corruptedEntries.length} corrupted entr{corruptedEntries.length !== 1 ? 'ies' : 'y'} (unparseable frontmatter)</li>
                  )}
                  {manifestSchemaMismatch && (
                    <li>Manifest schema version mismatch</li>
                  )}
                </ul>
                <button
                  className="settings-btn settings-btn-secondary"
                  type="button"
                  onClick={handleRebuildManifest}
                  disabled={rebuildBusy}
                  data-testid="rebuild-manifest-btn"
                >
                  {rebuildBusy ? 'Rebuilding…' : 'Rebuild manifest'}
                </button>
              </>
            ) : (
              <p className="settings-hint" data-testid="vault-health-ok">Vault manifest is healthy — no issues found.</p>
            )}
          </div>
        );
      })()}

      {/* SKY-5161 / GH#615 — Danger Zone: in-app "Clear all data" control so
          users can wipe vaults + settings from inside the app, not only via the
          Windows uninstaller. Works on all platforms (routed through IPC). */}
      <div className="settings-danger-zone" data-testid="clear-data-danger-zone">
        <h4 className="settings-subsection-title" id="section-vault-danger-zone">Danger zone</h4>
        <p className="settings-hint">
          Permanently remove all app data — every vault (manuscript, notes, entities) and your
          settings. You&apos;ll be asked whether to keep or delete your vault files before anything
          is removed. This cannot be undone.
        </p>
        {!clearArmed ? (
          <div className="settings-input-row">
            <button
              className="settings-btn settings-btn-danger"
              type="button"
              onClick={() => { setClearArmed(true); setClearError(null); setClearResult(null); }}
              disabled={clearBusy}
              data-testid="clear-data-btn"
            >
              Clear all data…
            </button>
          </div>
        ) : (
          <div className="settings-input-row" data-testid="clear-data-confirm">
            <span className="settings-error-msg" role="alert">
              This will ask you to keep or delete your vaults, then remove all app data. Continue?
            </span>
            <button
              className="settings-btn settings-btn-danger"
              type="button"
              onClick={handleClearAllData}
              disabled={clearBusy}
              data-testid="clear-data-confirm-btn"
            >
              {clearBusy ? 'Clearing…' : 'Continue'}
            </button>
            <button
              className="settings-btn settings-btn-secondary"
              type="button"
              onClick={() => setClearArmed(false)}
              disabled={clearBusy}
              data-testid="clear-data-cancel-btn"
            >
              Cancel
            </button>
          </div>
        )}
        {clearError && (
          <span className="settings-error-msg" role="alert" data-testid="clear-data-error">{clearError}</span>
        )}
        {clearResult && (
          <div className="settings-vault-health-report" role="status" data-testid="clear-data-result">
            {clearResult.cancelled ? (
              <p className="settings-hint" data-testid="clear-data-cancelled">Cancelled — your vaults and settings were kept.</p>
            ) : (
              <>
                <p className="settings-saved-msg" data-testid="clear-data-success">
                  {clearResult.deleted.length > 0
                    ? `Deleted ${clearResult.deleted.length} location${clearResult.deleted.length !== 1 ? 's' : ''}. Restart the app to finish.`
                    : 'App data cleared. Restart the app to finish.'}
                </p>
                {clearResult.errors.length > 0 && (
                  <ul className="settings-vault-health-list" data-testid="clear-data-errors">
                    {clearResult.errors.map((err, i) => (
                      <li key={i} className="settings-error-msg">{err}</li>
                    ))}
                  </ul>
                )}
                {clearResult.customPathsWarning.length > 0 && (
                  <div data-testid="clear-data-custom-warning">
                    <p className="settings-hint settings-vault-health-issues">
                      Some vaults are stored in custom locations and were not removed automatically. Delete these folders manually:
                    </p>
                    <ul className="settings-vault-health-list">
                      {clearResult.customPathsWarning.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
