import { useState, useCallback } from 'react';

type VaultHealthReport = {
  orphanedManifestEntries: string[];
  unindexedFiles: string[];
  manifestSchemaMismatch: boolean;
  corruptedEntries: string[];
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
    </section>
  );
}
