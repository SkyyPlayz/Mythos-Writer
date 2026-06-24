interface AutoLinkerSectionProps {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  setSavedOk: (ok: boolean) => void;
}

export default function AutoLinkerSection({ settings, setSettings, setSavedOk }: AutoLinkerSectionProps) {
  return (
    <section className="settings-section" aria-labelledby="section-autolinker" data-settings-cat="general">
      <h3 className="settings-section-title" id="section-autolinker">Auto Linker</h3>
      <div className="settings-field">
        <label className="settings-label">Entity mention mode</label>
        <div className="settings-radio-group" role="radiogroup" aria-label="Auto Linker mode">
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
        <p className="settings-hint">
          <strong>Suggest</strong> — underlines unlinked entity names; click to wrap in{' '}
          <code>[[wikilink]]</code>.{' '}
          <strong>Auto on save</strong> — applies all suggestions automatically when the scene is saved
          (one Undo to revert).
        </p>
      </div>
    </section>
  );
}
