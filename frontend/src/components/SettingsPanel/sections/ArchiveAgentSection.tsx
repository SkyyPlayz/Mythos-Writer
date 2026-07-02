interface ArchiveAgentSectionProps {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  setSavedOk: (ok: boolean) => void;
}

export default function ArchiveAgentSection({
  settings,
  setSettings,
  setSavedOk,
}: ArchiveAgentSectionProps) {
  const update = (patch: Partial<AppSettings>) => {
    setSettings((p) => ({ ...p, ...patch }));
    setSavedOk(false);
  };

  return (
    <section className="settings-section" aria-labelledby="section-archive-agent" data-settings-cat="agents" data-testid="archive-agent-section">
      <h3 className="settings-section-title" id="section-archive-agent">Archive Agent</h3>

      {/* Master toggle */}
      <div className="settings-field settings-field-inline">
        <label className="settings-toggle" htmlFor="archive-continuity-enabled">
          <input
            type="checkbox"
            id="archive-continuity-enabled"
            data-testid="archive-continuity-enabled"
            checked={settings.archiveContinuityEnabled ?? true}
            onChange={(e) => update({ archiveContinuityEnabled: e.target.checked })}
          />
          <span className="settings-toggle-track" />
          <span className="settings-toggle-label">Enable continuity checking</span>
        </label>
      </div>
      <p className="settings-hint">
        Continuously scans your manuscript against the Archive vault to surface character, location, and factual contradictions.
      </p>

      {/* Sub-settings — disabled when master off */}
      <fieldset
        className="settings-fieldset"
        disabled={!(settings.archiveContinuityEnabled ?? true)}
        data-testid="archive-agent-subsettings"
      >
        <div className="settings-field settings-field-inline">
          <label className="settings-toggle" htmlFor="archive-scan-on-save">
            <input
              type="checkbox"
              id="archive-scan-on-save"
              data-testid="archive-scan-on-save"
              checked={settings.archiveScanOnSave ?? true}
              onChange={(e) => update({ archiveScanOnSave: e.target.checked })}
            />
            <span className="settings-toggle-track" />
            <span className="settings-toggle-label">Scan on save</span>
          </label>
        </div>

        <div className="settings-field">
          <label className="settings-label" htmlFor="archive-scan-scope">Scan scope</label>
          <select
            id="archive-scan-scope"
            data-testid="archive-scan-scope"
            className="settings-input settings-select"
            value={settings.archiveScanScope ?? 'active_scene'}
            onChange={(e) => update({ archiveScanScope: e.target.value as AppSettings['archiveScanScope'] })}
          >
            <option value="active_scene">Active scene</option>
            <option value="active_chapter">Active chapter</option>
            <option value="full_manuscript">Full manuscript</option>
          </select>
        </div>

        <div className="settings-field">
          <label className="settings-label" htmlFor="archive-scan-interval">Scan interval</label>
          <select
            id="archive-scan-interval"
            data-testid="archive-scan-interval"
            className="settings-input settings-select"
            value={settings.archiveScanInterval == null ? 'off' : String(settings.archiveScanInterval)}
            onChange={(e) => {
              const val = e.target.value === 'off' ? null : Number(e.target.value);
              update({ archiveScanInterval: val });
            }}
          >
            <option value="off">Off</option>
            <option value="900">15 min</option>
            <option value="1800">30 min</option>
            <option value="3600">1 hr</option>
          </select>
        </div>

        {(settings.archiveScanScope ?? 'active_scene') === 'full_manuscript' && (settings.archiveScanInterval != null) && (
          <p className="settings-hint settings-hint-warning" data-testid="archive-full-manuscript-warning" role="alert">
            Warning: scanning the full manuscript on a timer may be slow on large projects and consume significant AI budget.
          </p>
        )}

        <div className="settings-field">
          <label className="settings-label" htmlFor="archive-min-severity">Minimum severity</label>
          <select
            id="archive-min-severity"
            data-testid="archive-min-severity"
            className="settings-input settings-select"
            value={settings.archiveMinSeverity ?? 'low'}
            onChange={(e) => update({ archiveMinSeverity: e.target.value as AppSettings['archiveMinSeverity'] })}
          >
            <option value="low">Low and above</option>
            <option value="high">High and above</option>
            <option value="critical">Critical only</option>
          </select>
        </div>

        <div className="settings-field settings-field-inline">
          <label className="settings-toggle" htmlFor="archive-check-character-drift">
            <input
              type="checkbox"
              id="archive-check-character-drift"
              data-testid="archive-check-character-drift"
              checked={settings.archiveCheckCharacterDrift ?? true}
              onChange={(e) => update({ archiveCheckCharacterDrift: e.target.checked })}
            />
            <span className="settings-toggle-track" />
            <span className="settings-toggle-label">Character attribute drift</span>
          </label>
        </div>

        <div className="settings-field settings-field-inline">
          <label className="settings-toggle" htmlFor="archive-check-location-mismatch">
            <input
              type="checkbox"
              id="archive-check-location-mismatch"
              data-testid="archive-check-location-mismatch"
              checked={settings.archiveCheckLocationMismatch ?? true}
              onChange={(e) => update({ archiveCheckLocationMismatch: e.target.checked })}
            />
            <span className="settings-toggle-track" />
            <span className="settings-toggle-label">Location attribute mismatch</span>
          </label>
        </div>

        <div className="settings-field settings-field-inline">
          <label className="settings-toggle" htmlFor="archive-check-factual-contradict">
            <input
              type="checkbox"
              id="archive-check-factual-contradict"
              data-testid="archive-check-factual-contradict"
              checked={settings.archiveCheckFactualContradict ?? true}
              onChange={(e) => update({ archiveCheckFactualContradict: e.target.checked })}
            />
            <span className="settings-toggle-track" />
            <span className="settings-toggle-label">Factual contradiction</span>
          </label>
        </div>

        <div className="settings-field">
          <label className="settings-label" htmlFor="archive-scan-budget">
            Scan token budget: {(settings.archiveScanBudget ?? 8000).toLocaleString()}
          </label>
          <input
            type="range"
            id="archive-scan-budget"
            data-testid="archive-scan-budget"
            aria-label="Scan token budget"
            aria-describedby="archive-scan-budget-hint"
            className="settings-slider"
            min={2000}
            max={16000}
            step={1000}
            disabled={!settings.agents.archive.enabled}
            value={settings.archiveScanBudget ?? 8000}
            onChange={(e) => update({ archiveScanBudget: Number(e.target.value) })}
          />
          <p className="settings-hint" id="archive-scan-budget-hint">Limits AI token spend per scan. Higher values allow deeper analysis.</p>
        </div>
      </fieldset>
    </section>
  );
}
