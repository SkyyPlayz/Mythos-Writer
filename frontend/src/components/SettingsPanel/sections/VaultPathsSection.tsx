import { useState, useCallback, useEffect, useRef } from 'react';

interface UserTemplateSummary {
  id: string;
  name: string;
  description: string;
  isUserTemplate?: boolean;
}

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

  // SKY-1399 (restored SKY-11352): manage previously-saved custom templates —
  // rename / duplicate / delete. Bundled templates (isUserTemplate falsy)
  // never render these actions: template:rename/delete/duplicate only look
  // inside the user templates dir and throw "Template not found" for them.
  const [userTemplates, setUserTemplates] = useState<UserTemplateSummary[]>([]);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [templateOpBusyId, setTemplateOpBusyId] = useState<string | null>(null);

  const loadUserTemplates = useCallback(async () => {
    try {
      const res = await window.api.templateList();
      setUserTemplates(res.templates.filter((t) => t.isUserTemplate));
      setTemplatesError(null);
    } catch (e) {
      setTemplatesError(e instanceof Error ? e.message : 'Failed to load templates.');
    }
  }, []);

  useEffect(() => {
    void loadUserTemplates();
  }, [loadUserTemplates]);

  const handleStartRename = useCallback((tpl: UserTemplateSummary) => {
    setRenamingId(tpl.id);
    setRenameValue(tpl.name);
    setDeleteConfirmId(null);
  }, []);

  const handleCancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameValue('');
  }, []);

  const handleCommitRename = useCallback(async (id: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    setTemplateOpBusyId(id);
    try {
      const res = await window.api.templateRename(id, trimmed);
      if ('error' in res) {
        setTemplatesError(res.error);
      } else {
        setRenamingId(null);
        setRenameValue('');
        await loadUserTemplates();
      }
    } catch (e) {
      setTemplatesError(e instanceof Error ? e.message : 'Failed to rename template.');
    } finally {
      setTemplateOpBusyId(null);
    }
  }, [renameValue, loadUserTemplates]);

  const handleDuplicate = useCallback(async (id: string) => {
    setTemplateOpBusyId(id);
    try {
      const res = await window.api.templateDuplicate(id);
      if ('error' in res) {
        setTemplatesError(res.error);
      } else {
        await loadUserTemplates();
      }
    } catch (e) {
      setTemplatesError(e instanceof Error ? e.message : 'Failed to duplicate template.');
    } finally {
      setTemplateOpBusyId(null);
    }
  }, [loadUserTemplates]);

  const handleConfirmDelete = useCallback(async (id: string) => {
    setTemplateOpBusyId(id);
    try {
      const res = await window.api.templateDelete(id);
      if ('error' in res) {
        setTemplatesError(res.error);
      } else {
        setDeleteConfirmId(null);
        await loadUserTemplates();
      }
    } catch (e) {
      setTemplatesError(e instanceof Error ? e.message : 'Failed to delete template.');
    } finally {
      setTemplateOpBusyId(null);
    }
  }, [loadUserTemplates]);

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
        await loadUserTemplates();
      }
    } catch (e) {
      setSaveAsTplResult({ error: e instanceof Error ? e.message : 'Failed to save template.' });
    } finally {
      setSaveAsTplBusy(false);
    }
  }, [saveAsTplName, loadUserTemplates]);

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
        {/* SKY-11454: no folder list here — a blank vault starts empty
            (SKY-11141 §3a) and the template layout is owned by the template,
            so enumerating folders in copy goes stale. */}
        <p className="settings-hint" id="notes-vault-path-hint">Worldbuilding, characters, lore, and AI-curated notes. Starts empty unless you created it from a template.</p>
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

      {/* SKY-11352: restored custom-template management UI (rename / duplicate /
          delete + confirm dialog + count badge) — deleted from the pre-rewrite
          onboarding wizard by PR #1408; the IPC layer it drives was never
          removed (template:rename/delete/duplicate, electron-main/src/templates.ts). */}
      {userTemplates.length > 0 && (
        <div className="settings-user-templates" data-testid="user-templates-section">
          <div className="settings-section-header-row">
            <h4 className="settings-label" id="user-templates-heading">Your templates</h4>
            <span className="settings-badge" data-testid="user-templates-count">{userTemplates.length}</span>
          </div>
          <ul className="settings-user-templates-list" aria-labelledby="user-templates-heading">
            {userTemplates.map((tpl) => (
              <li key={tpl.id} className="settings-user-template-item" data-testid={`user-template-item-${tpl.id}`}>
                {renamingId === tpl.id ? (
                  <input
                    className="settings-input"
                    type="text"
                    value={renameValue}
                    maxLength={80}
                    autoFocus
                    aria-label={`Rename template ${tpl.name}`}
                    data-testid={`template-rename-input-${tpl.id}`}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCommitRename(tpl.id);
                      if (e.key === 'Escape') handleCancelRename();
                    }}
                    onBlur={() => handleCommitRename(tpl.id)}
                  />
                ) : (
                  <span className="settings-user-template-name" data-testid={`template-name-${tpl.id}`}>{tpl.name}</span>
                )}

                {deleteConfirmId === tpl.id ? (
                  <span className="settings-user-template-actions" role="group" aria-label={`Confirm delete ${tpl.name}`}>
                    <span className="settings-error-msg">Delete &ldquo;{tpl.name}&rdquo;?</span>
                    <button
                      type="button"
                      className="settings-btn-danger"
                      disabled={templateOpBusyId === tpl.id}
                      onClick={() => handleConfirmDelete(tpl.id)}
                      data-testid="template-delete-confirm"
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      className="settings-btn-secondary"
                      onClick={() => setDeleteConfirmId(null)}
                      data-testid="template-delete-cancel"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  renamingId !== tpl.id && (
                    <span className="settings-user-template-actions">
                      <button
                        type="button"
                        className="settings-btn-secondary"
                        disabled={templateOpBusyId === tpl.id}
                        onClick={() => handleStartRename(tpl)}
                        data-testid={`template-rename-btn-${tpl.id}`}
                        aria-label={`Rename ${tpl.name}`}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="settings-btn-secondary"
                        disabled={templateOpBusyId === tpl.id}
                        onClick={() => handleDuplicate(tpl.id)}
                        data-testid={`template-duplicate-btn-${tpl.id}`}
                        aria-label={`Duplicate ${tpl.name}`}
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        className="settings-btn-danger"
                        disabled={templateOpBusyId === tpl.id}
                        onClick={() => setDeleteConfirmId(tpl.id)}
                        data-testid={`template-delete-btn-${tpl.id}`}
                        aria-label={`Delete ${tpl.name}`}
                      >
                        Delete
                      </button>
                    </span>
                  )
                )}
              </li>
            ))}
          </ul>
          {templatesError && <span className="settings-error-msg" role="alert" data-testid="user-templates-error">{templatesError}</span>}
        </div>
      )}
    </section>
  );
}
