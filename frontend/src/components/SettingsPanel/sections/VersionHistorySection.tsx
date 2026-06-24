interface VersionHistorySectionProps {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  setSavedOk: (ok: boolean) => void;
}

export default function VersionHistorySection({ settings, setSettings, setSavedOk }: VersionHistorySectionProps) {
  return (
    <section className="settings-section" aria-labelledby="section-versions" data-settings-cat="vaults">
      <h3 className="settings-section-title" id="section-versions">Version History</h3>
      <div className="settings-agent-fields">
        <div className="settings-field settings-field-inline">
          <label className="settings-label" htmlFor="ver-max-per-scene">Max versions per scene</label>
          <input
            id="ver-max-per-scene"
            className="settings-input settings-input-sm settings-input-number"
            type="number"
            min={1}
            max={1000}
            value={settings.versions?.maxPerScene ?? 100}
            onChange={(e) => {
              const val = Number(e.target.value);
              setSettings((p) => ({ ...p, versions: { maxAgeDays: p.versions?.maxAgeDays ?? 0, maxPerScene: val } }));
              setSavedOk(false);
            }}
          />
        </div>
        <div className="settings-field settings-field-inline">
          <label className="settings-label" htmlFor="ver-max-age-days">Retain versions for (days, 0=unlimited)</label>
          <input
            id="ver-max-age-days"
            className="settings-input settings-input-sm settings-input-number"
            type="number"
            min={0}
            max={3650}
            value={settings.versions?.maxAgeDays ?? 0}
            onChange={(e) => {
              const val = Number(e.target.value);
              setSettings((p) => ({ ...p, versions: { maxPerScene: p.versions?.maxPerScene ?? 100, maxAgeDays: val } }));
              setSavedOk(false);
            }}
          />
        </div>
      </div>
      <p className="settings-hint">Versions are saved before each scene write. Older ones are pruned on next app start.</p>
    </section>
  );
}
