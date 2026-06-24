interface UpdatesSectionProps {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  setSavedOk: (ok: boolean) => void;
}

export default function UpdatesSection({ settings, setSettings, setSavedOk }: UpdatesSectionProps) {
  return (
    <section className="settings-section" aria-labelledby="section-updates" data-settings-cat="general">
      <h3 className="settings-section-title" id="section-updates">Updates</h3>
      <div className="settings-field">
        <label className="settings-label">Update Channel</label>
        <div className="settings-radio-group" role="radiogroup" aria-label="Update channel">
          {(['stable', 'beta'] as const).map((ch) => (
            <label key={ch} className="settings-radio-label">
              <input
                type="radio"
                name="updateChannel"
                value={ch}
                checked={(settings.updateChannel ?? 'stable') === ch}
                onChange={() => { setSettings((p) => ({ ...p, updateChannel: ch })); setSavedOk(false); }}
              />
              {ch === 'stable' ? 'Stable' : 'Beta'}
            </label>
          ))}
        </div>
        <p className="settings-hint">
          Stable receives official releases. Beta receives pre-releases and may contain unfinished features.
          Changes take effect on the next update check.
        </p>
      </div>
    </section>
  );
}
