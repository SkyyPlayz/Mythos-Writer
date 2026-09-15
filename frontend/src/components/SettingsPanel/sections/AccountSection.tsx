interface AccountSectionProps {
  vaults: { storyVaultPath: string; notesVaultPath: string };
  onMoveVault: () => void;
}

export default function AccountSection({ vaults, onMoveVault }: AccountSectionProps) {
  return (
    <section className="settings-section settings-account-section" aria-labelledby="section-account" data-settings-cat="vaults">
      <h3 className="settings-section-title" id="section-account">Account</h3>
      <div className="settings-vault-card" aria-label="Current Story Vault">
        <div className="settings-vault-card-header">
          <div>
            <span className="settings-vault-card-kicker">Vault</span>
            <h4 className="settings-vault-card-title">Story Vault location</h4>
          </div>
        </div>
        <p
          className="settings-vault-path-display"
          title={vaults.storyVaultPath || undefined}
        >
          {vaults.storyVaultPath || 'No Story Vault configured'}
        </p>
        <button
          className="settings-btn settings-btn-secondary settings-vault-move-btn"
          type="button"
          onClick={onMoveVault}
          aria-label="Move to a different folder"
          data-testid="move-vault-btn"
        >
          Move to a different folder
        </button>
      </div>
    </section>
  );
}
