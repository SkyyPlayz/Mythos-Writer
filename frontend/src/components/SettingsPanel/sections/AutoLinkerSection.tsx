import { useState, useEffect, useCallback } from 'react';

const DEFAULT_AUTO_LINKER_SETTINGS: AutoLinkerSettings = {
  formatOnSave: false,
  includeAliases: true,
  proximityPreference: true,
  ignoreCase: false,
  preventSelfLink: true,
  ignoreDates: true,
  formatDelay: 2000,
  excludedFolders: ['Templates', 'Archive'],
};

interface AutoLinkerSectionProps {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  setSavedOk: (ok: boolean) => void;
}

export default function AutoLinkerSection({ settings, setSettings, setSavedOk }: AutoLinkerSectionProps) {
  const linker: AutoLinkerSettings = settings.autoLinkerSettings ?? DEFAULT_AUTO_LINKER_SETTINGS;

  const [formatStatus, setFormatStatus] = useState<string | null>(null);
  const [isFormatting, setIsFormatting] = useState(false);

  // Clear status after 4 seconds
  useEffect(() => {
    if (!formatStatus) return;
    const t = setTimeout(() => setFormatStatus(null), 4000);
    return () => clearTimeout(t);
  }, [formatStatus]);

  function updateLinker(patch: Partial<AutoLinkerSettings>) {
    const updated = { ...linker, ...patch };
    setSettings((p) => ({ ...p, autoLinkerSettings: updated }));
    setSavedOk(false);
  }

  const handleFormatVaultNow = useCallback(async () => {
    setIsFormatting(true);
    setFormatStatus(null);
    try {
      const result = await window.api.autoLinkerFormatVaultNow();
      setFormatStatus(
        `Done — ${result.linked} link${result.linked !== 1 ? 's' : ''} inserted across ${result.processed} note${result.processed !== 1 ? 's' : ''} (${result.skipped} skipped).`,
      );
    } catch (err) {
      setFormatStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsFormatting(false);
    }
  }, []);

  return (
    <section className="settings-section" aria-labelledby="section-autolinker" data-settings-cat="vault-files">
      <h3 className="settings-section-title" id="section-autolinker">
        Auto Note Linker{' '}
        <span
          className="settings-badge settings-badge--green"
          title="No AI required — deterministic trie-based matching against your vault index."
        >
          BUILT-IN · NO AI
        </span>
      </h3>

      <p className="settings-hint" style={{ marginBottom: '0.75rem' }}>
        Scans your notes for unlinked mentions of other note titles and aliases, then wraps them in
        {' '}<code>[[wikilinks]]</code>. Fully deterministic — no API calls required.
      </p>

      {/* Toggles */}
      <div className="settings-toggle-group">
        <label className="settings-toggle-label">
          <input
            type="checkbox"
            checked={linker.formatOnSave}
            onChange={(e) => updateLinker({ formatOnSave: e.target.checked })}
          />
          Enable format on save
        </label>

        <label className="settings-toggle-label">
          <input
            type="checkbox"
            checked={linker.includeAliases}
            onChange={(e) => updateLinker({ includeAliases: e.target.checked })}
          />
          Include aliases
        </label>

        <label className="settings-toggle-label">
          <input
            type="checkbox"
            checked={linker.ignoreCase}
            onChange={(e) => updateLinker({ ignoreCase: e.target.checked })}
          />
          Ignore case
        </label>

        <label className="settings-toggle-label">
          <input
            type="checkbox"
            checked={linker.preventSelfLink}
            onChange={(e) => updateLinker({ preventSelfLink: e.target.checked })}
          />
          Prevent self-links
        </label>

        <label className="settings-toggle-label">
          <input
            type="checkbox"
            checked={linker.ignoreDates}
            onChange={(e) => updateLinker({ ignoreDates: e.target.checked })}
          />
          Ignore date-format filenames
        </label>
      </div>

      {/* Format delay */}
      <div className="settings-field" style={{ marginTop: '0.75rem' }}>
        <label className="settings-label" htmlFor="al-format-delay">
          Format delay (ms)
        </label>
        <input
          id="al-format-delay"
          type="number"
          className="settings-input"
          min={0}
          max={30000}
          step={100}
          value={linker.formatDelay}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!Number.isNaN(v)) updateLinker({ formatDelay: v });
          }}
          style={{ width: '120px' }}
        />
        <p className="settings-hint">Delay after the last keystroke before format-on-save triggers.</p>
      </div>

      {/* Excluded folders */}
      <div className="settings-field" style={{ marginTop: '0.75rem' }}>
        <label className="settings-label" htmlFor="al-excluded-folders">
          Excluded folders (comma-separated)
        </label>
        <input
          id="al-excluded-folders"
          type="text"
          className="settings-input"
          value={linker.excludedFolders.join(', ')}
          onChange={(e) => {
            const folders = e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            updateLinker({ excludedFolders: folders });
          }}
          placeholder="Templates, Archive"
          style={{ width: '280px' }}
        />
        <p className="settings-hint">Folder names (not paths) to skip when scanning the vault.</p>
      </div>

      {/* Format now button */}
      <div className="settings-field" style={{ marginTop: '1rem' }}>
        <button
          type="button"
          className="settings-btn"
          onClick={handleFormatVaultNow}
          disabled={isFormatting}
        >
          {isFormatting ? 'Formatting…' : 'Format vault now'}
        </button>
        {formatStatus && (
          <p className="settings-hint" style={{ marginTop: '0.4rem' }}>
            {formatStatus}
          </p>
        )}
      </div>

      {/* Legacy suggest-mode radio (kept for backward compat with SKY-192) */}
      <details style={{ marginTop: '1.25rem' }}>
        <summary className="settings-hint" style={{ cursor: 'pointer' }}>
          Legacy suggest mode (SKY-192)
        </summary>
        <div className="settings-field" style={{ marginTop: '0.5rem' }}>
          <div className="settings-radio-group" role="radiogroup" aria-label="Auto Linker legacy mode">
            {([
              { value: 'off', label: 'Off' },
              { value: 'suggest', label: 'Suggest (default)' },
              { value: 'auto', label: 'Auto on save' },
            ] as const).map(({ value, label }) => (
              <label key={value} className="settings-radio-label">
                <input
                  type="radio"
                  name="autoLinkerMode"
                  value={value}
                  checked={(settings.autoLinker?.mode ?? 'suggest') === value}
                  onChange={() => {
                    setSettings((p) => ({ ...p, autoLinker: { mode: value } }));
                    setSavedOk(false);
                  }}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      </details>
    </section>
  );
}
