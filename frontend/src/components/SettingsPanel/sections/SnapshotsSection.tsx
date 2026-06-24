interface SnapshotsSectionProps {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  setSavedOk: (ok: boolean) => void;
}

export default function SnapshotsSection({ settings, setSettings, setSavedOk }: SnapshotsSectionProps) {
  return (
    <section className="settings-section" aria-labelledby="section-snapshots" data-settings-cat="vaults">
      <h3 className="settings-section-title" id="section-snapshots">Snapshots</h3>
      <div className="settings-agent-fields">
        <div className="settings-field settings-field-inline">
          <label className="settings-label" htmlFor="snap-max-per-scene">Max snapshots per scene</label>
          <input
            id="snap-max-per-scene"
            className="settings-input settings-input-sm settings-input-number"
            type="number"
            min={1}
            max={500}
            value={settings.snapshots?.maxPerScene ?? 100}
            onChange={(e) => {
              const val = Number(e.target.value);
              setSettings((p) => ({ ...p, snapshots: { maxAgeDays: p.snapshots?.maxAgeDays ?? 30, maxPerScene: val } }));
              setSavedOk(false);
            }}
          />
        </div>
        <div className="settings-field settings-field-inline">
          <label className="settings-label" htmlFor="snap-max-age-days">Retain snapshots for (days, 0=unlimited)</label>
          <input
            id="snap-max-age-days"
            className="settings-input settings-input-sm settings-input-number"
            type="number"
            min={0}
            max={365}
            value={settings.snapshots?.maxAgeDays ?? 30}
            onChange={(e) => {
              const val = Number(e.target.value);
              setSettings((p) => ({ ...p, snapshots: { maxPerScene: p.snapshots?.maxPerScene ?? 100, maxAgeDays: val } }));
              setSavedOk(false);
            }}
          />
        </div>
      </div>
      <p className="settings-hint">Snapshots are taken automatically while you write. Older ones are pruned by count and age.</p>
      <div className="settings-field settings-field-inline" style={{ marginTop: 8 }}>
        <span className="settings-label">Danger zone</span>
        <button
          type="button"
          className="settings-btn-danger"
          onClick={async () => {
            if (!window.confirm('Delete ALL snapshots across every scene? This cannot be undone.')) return;
            await window.api.snapshotDeleteAll();
            setSavedOk(false);
          }}
        >
          Delete all snapshots
        </button>
      </div>
    </section>
  );
}
