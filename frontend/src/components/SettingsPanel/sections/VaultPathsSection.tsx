import { useState, useCallback, useRef } from 'react';

interface VaultPathsSectionProps {
  vaults: { storyVaultPath: string; notesVaultPath: string };
  setVaults: React.Dispatch<React.SetStateAction<{ storyVaultPath: string; notesVaultPath: string }>>;
  vaultsDirty: boolean;
  setVaultsDirty: React.Dispatch<React.SetStateAction<boolean>>;
  vaultsSavedOk: boolean;
  setVaultsSavedOk: React.Dispatch<React.SetStateAction<boolean>>;
  vaultsError: string | null;
  onPickVaultFolder: (which: 'storyVaultPath' | 'notesVaultPath') => void;
  onSaveVaults: () => void;
}

export default function VaultPathsSection({
  vaults,
  setVaults,
  vaultsDirty,
  setVaultsDirty,
  vaultsSavedOk,
  setVaultsSavedOk,
  vaultsError,
  onPickVaultFolder,
  onSaveVaults,
}: VaultPathsSectionProps) {
  // SKY-1303: Save-as-Template state (self-contained)
  const [saveAsTplOpen, setSaveAsTplOpen] = useState(false);
  const [saveAsTplName, setSaveAsTplName] = useState('');
  const [saveAsTplBusy, setSaveAsTplBusy] = useState(false);
  const [saveAsTplResult, setSaveAsTplResult] = useState<{ ok: true; name: string } | { error: string } | null>(null);
  const saveAsTplInputRef = useRef<HTMLInputElement>(null);

  const handleOpenSaveAsTpl = useCallback(() => {
    setSaveAsTplOpen(true);
    setSaveAsTplName('');
    setSaveAsTplResult(null);
    setTimeout(() => saveAsTplInputRef.current?.focus(), 0);
  }, []);

  const handleSaveAsTpl = useCallback(async () => {
    const name = saveAsTplName.trim();
    if (!name) return;
    setSaveAsTplBusy(true);
    setSaveAsTplResult(null);
    try {
      const res = await window.api.templateSaveAs(name);
      if ('error' in res) {
        setSaveAsTplResult({ error: res.error });
      } else {
        setSaveAsTplResult({ ok: true, name });
        setSaveAsTplOpen(false);
        setSaveAsTplName('');
      }
    } catch (e) {
      setSaveAsTplResult({ error: e instanceof Error ? e.message : 'Failed to save template.' });
    } finally {
      setSaveAsTplBusy(false);
    }
  }, [saveAsTplName]);

  const handleCancelSaveAsTpl = useCallback(() => {
    setSaveAsTplOpen(false);
    setSaveAsTplName('');
    setSaveAsTplResult(null);
  }, []);

  return (
    <section className="settings-section" aria-labelledby="section-vault-paths" data-settings-cat="vaults">
      <h3 className="settings-section-title" id="section-vault-paths">Vault paths</h3>
      <div className="settings-field">
        <label className="settings-label" htmlFor="story-vault-path-input">Story Vault</label>
        <div className="settings-input-row">
          <input
            id="story-vault-path-input"
            className="settings-input"
            type="text"
            value={vaults.storyVaultPath}
            onChange={(e) => {
              setVaults((prev) => ({ ...prev, storyVaultPath: e.target.value }));
              setVaultsDirty(true);
              setVaultsSavedOk(false);
            }}
            placeholder="~/Mythos/Story Vault"
            aria-describedby="story-vault-path-hint"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            className="settings-reveal-btn"
            type="button"
            onClick={() => onPickVaultFolder('storyVaultPath')}
            aria-label="Choose Story Vault folder"
          >
            Browse…
          </button>
        </div>
        <p className="settings-hint" id="story-vault-path-hint">Chapters and scenes live here. Agents never edit Story Vault contents.</p>
      </div>
      <div className="settings-field">
        <label className="settings-label" htmlFor="notes-vault-path-input">Notes Vault</label>
        <div className="settings-input-row">
          <input
            id="notes-vault-path-input"
            className="settings-input"
            type="text"
            value={vaults.notesVaultPath}
            onChange={(e) => {
              setVaults((prev) => ({ ...prev, notesVaultPath: e.target.value }));
              setVaultsDirty(true);
              setVaultsSavedOk(false);
            }}
            placeholder="~/Mythos/Notes Vault"
            aria-describedby="notes-vault-path-hint"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            className="settings-reveal-btn"
            type="button"
            onClick={() => onPickVaultFolder('notesVaultPath')}
            aria-label="Choose Notes Vault folder"
          >
            Browse…
          </button>
        </div>
        <p className="settings-hint" id="notes-vault-path-hint">Worldbuilding, characters, lore, and AI-curated notes. Seeded with <code>Universes/</code>, <code>Stories/</code>, <code>Inbox/</code>, <code>Research/</code>, <code>Daily Notes/</code>, and <code>Archive/</code> on first run (per the SKY-15 default layout).</p>
      </div>
      <div className="settings-input-row">
        <button
          className="settings-btn settings-btn-secondary"
          type="button"
          onClick={onSaveVaults}
          disabled={!vaultsDirty || !vaults.storyVaultPath.trim() || !vaults.notesVaultPath.trim()}
        >
          Save vault paths
        </button>
        {vaultsSavedOk && <span className="settings-saved-msg" role="status">Saved. Restart to fully apply.</span>}
        {vaultsError && <span className="settings-error-msg" role="alert">{vaultsError}</span>}
      </div>
      <p className="settings-hint">Changes take effect after restart — the Story Vault watcher and DB are bound at app boot.</p>

      {/* SKY-1303: Save-as-Template (AC-3) */}
      <div className="settings-save-as-tpl">
        {!saveAsTplOpen && (
          <button
            type="button"
            className="settings-reveal-btn"
            onClick={handleOpenSaveAsTpl}
            aria-label="Save current vault structure as a template"
            data-testid="save-as-template-btn"
          >
            Save as Template…
          </button>
        )}
        {saveAsTplOpen && (
          <div className="settings-save-as-tpl-form" role="group" aria-label="Save as template">
            <input
              ref={saveAsTplInputRef}
              id="save-as-tpl-name"
              className="settings-input"
              type="text"
              placeholder="Template name"
              value={saveAsTplName}
              maxLength={80}
              aria-label="Template name"
              data-testid="save-as-template-name-input"
              onChange={(e) => { setSaveAsTplName(e.target.value); setSaveAsTplResult(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveAsTpl();
                if (e.key === 'Escape') handleCancelSaveAsTpl();
              }}
            />
            <button
              type="button"
              className="settings-btn settings-btn-save"
              disabled={!saveAsTplName.trim() || saveAsTplBusy}
              onClick={handleSaveAsTpl}
              data-testid="save-as-template-confirm"
            >
              {saveAsTplBusy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="settings-reveal-btn"
              onClick={handleCancelSaveAsTpl}
              data-testid="save-as-template-cancel"
            >
              Cancel
            </button>
          </div>
        )}
        {saveAsTplResult && 'ok' in saveAsTplResult && (
          <span className="settings-saved-msg" role="status" data-testid="save-as-template-success">
            Saved as &ldquo;{saveAsTplResult.name}&rdquo;
          </span>
        )}
        {saveAsTplResult && 'error' in saveAsTplResult && (
          <span className="settings-error-msg" role="alert" data-testid="save-as-template-error">
            {saveAsTplResult.error}
          </span>
        )}
        <p className="settings-hint">Snapshots the current Story Vault and Notes Vault folder structure as a reusable template.</p>
      </div>
    </section>
  );
}
