import './VaultNotFoundScreen.css';

interface Props {
  vaultPath?: string;
  onRerunWizard: () => void;
  onOpenSettings?: () => void;
  onQuit?: () => void;
}

export default function VaultNotFoundScreen({ vaultPath, onRerunWizard, onOpenSettings, onQuit }: Props) {
  const displayPath = vaultPath?.trim() || 'No Story Vault path is configured.';

  return (
    <main className="vault-not-found-screen" aria-labelledby="vault-not-found-title">
      <section className="vault-not-found-card">
        <div className="vault-not-found-icon" aria-hidden="true">!</div>
        <p className="vault-not-found-eyebrow">Vault check failed</p>
        <h1 id="vault-not-found-title">Vault not found</h1>
        <p className="vault-not-found-copy">
          Mythos could not find or read your Story Vault. Reconnect your drive, or run setup again before writing.
        </p>
        <div className="vault-not-found-path" aria-label="Missing vault path">
          {displayPath}
        </div>
        <div className="vault-not-found-actions">
          <button type="button" className="vault-not-found-primary" onClick={onRerunWizard}>
            Re-run setup
          </button>
          <button type="button" className="vault-not-found-secondary" onClick={onOpenSettings}>
            Open Settings
          </button>
          <button type="button" className="vault-not-found-danger" onClick={onQuit}>
            Quit
          </button>
        </div>
      </section>
    </main>
  );
}
