interface JournalSectionProps {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  setSavedOk: (ok: boolean) => void;
}

export default function JournalSection({ settings, setSettings, setSavedOk }: JournalSectionProps) {
  return (
    <section className="settings-section" aria-labelledby="section-journal" data-settings-cat="general">
      <h3 className="settings-section-title" id="section-journal">Journal Mode</h3>
      <div className="settings-field">
        <label className="settings-checkbox-label">
          <input
            type="checkbox"
            checked={settings.journalMode?.enabled ?? false}
            onChange={(e) => {
              setSettings((p) => ({
                ...p,
                journalMode: { ...(p.journalMode ?? {}), enabled: e.target.checked },
              }));
              setSavedOk(false);
            }}
          />
          Enable daily notes (auto-create a dated note each day you open the app)
        </label>
        <p className="settings-hint">
          Creates a note like <code>Daily Notes/2025-01-15.md</code> on first launch of each new
          calendar day. The writing streak counter in the Notes sidebar tracks consecutive days
          with a note.
        </p>
      </div>
      {(settings.journalMode?.enabled) && (
        <div className="settings-field settings-field-inline">
          <label className="settings-label" htmlFor="journal-folder">Daily notes folder</label>
          <input
            id="journal-folder"
            className="settings-input"
            type="text"
            placeholder="Daily Notes"
            value={settings.journalMode?.noteFolder ?? ''}
            onChange={(e) => {
              setSettings((p) => ({
                ...p,
                journalMode: { ...(p.journalMode ?? { enabled: true }), noteFolder: e.target.value || undefined },
              }));
              setSavedOk(false);
            }}
          />
        </div>
      )}
    </section>
  );
}
