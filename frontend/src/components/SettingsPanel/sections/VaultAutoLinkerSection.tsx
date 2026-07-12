import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

interface VaultAutoLinkerSectionProps {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  setSavedOk: (ok: boolean) => void;
}

const DEFAULTS: AutoLinkerSettings = {
  formatOnSave: false,
  includeAliases: true,
  proximityPreference: false,
  ignoreCase: true,
  preventSelfLink: true,
  ignoreDates: true,
  formatDelay: 500,
  excludedFolders: [],
};

function patchLinker(
  setSettings: Dispatch<SetStateAction<AppSettings>>,
  setSavedOk: (ok: boolean) => void,
  patch: Partial<AutoLinkerSettings>,
) {
  setSettings((prev) => ({
    ...prev,
    autoLinkerSettings: { ...DEFAULTS, ...prev.autoLinkerSettings, ...patch },
  }));
  setSavedOk(false);
}

interface ToggleRowProps {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleRow({ id, label, hint, checked, onChange }: ToggleRowProps) {
  return (
    <div className="settings-field settings-field-inline">
      <div className="settings-label-group">
        <label className="settings-label" htmlFor={id}>{label}</label>
        {hint && <p className="settings-hint">{hint}</p>}
      </div>
      <label className="settings-toggle">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="settings-toggle-track" />
      </label>
    </div>
  );
}

export default function VaultAutoLinkerSection({
  settings,
  setSettings,
  setSavedOk,
}: VaultAutoLinkerSectionProps) {
  const linker: AutoLinkerSettings = { ...DEFAULTS, ...settings.autoLinkerSettings };

  // Load authoritative settings from main process on mount.
  useEffect(() => {
    window.api.autoLinkerGetSettings?.().then((s) => {
      setSettings((prev) => ({ ...prev, autoLinkerSettings: s }));
    }).catch(() => { /* settings layer may not be ready on first render */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [formatStatus, setFormatStatus] = useState<string | null>(null);

  function set(patch: Partial<AutoLinkerSettings>) {
    patchLinker(setSettings, setSavedOk, patch);
  }

  const excludedFoldersText = (linker.excludedFolders ?? []).join('\n');

  return (
    <section
      className="settings-section"
      aria-labelledby="section-vault-autolinker"
      data-settings-cat="vaults"
    >
      <div className="settings-section-header-row">
        <h3 className="settings-section-title" id="section-vault-autolinker">
          Auto Note Linker
        </h3>
        <span className="settings-badge settings-badge--builtin" aria-label="Built-in feature, no AI required">
          BUILT-IN · NO AI
        </span>
      </div>
      <p className="settings-hint">
        Detects plain-text mentions of note titles and aliases and wraps them in{' '}
        <code>{'[[wiki links]]'}</code>. Existing links are never modified.
      </p>

      <ToggleRow
        id="al-format-on-save"
        label="Format on save"
        hint="Automatically apply links whenever a note is saved."
        checked={linker.formatOnSave}
        onChange={(v) => set({ formatOnSave: v })}
      />

      <ToggleRow
        id="al-include-aliases"
        label="Include aliases"
        hint="Match aliases declared in note frontmatter in addition to the note title."
        checked={linker.includeAliases}
        onChange={(v) => set({ includeAliases: v })}
      />

      <ToggleRow
        id="al-proximity"
        label="Proximity-based linking"
        hint="When the same name exists in multiple folders, prefer the note closest to the current file."
        checked={linker.proximityPreference}
        onChange={(v) => set({ proximityPreference: v })}
      />

      <ToggleRow
        id="al-ignore-case"
        label="Ignore case"
        hint="Treat 'Aragorn' and 'aragorn' as the same name."
        checked={linker.ignoreCase}
        onChange={(v) => set({ ignoreCase: v })}
      />

      <ToggleRow
        id="al-prevent-self"
        label="Prevent self-linking"
        hint="Do not add a link inside the note that the link would point to."
        checked={linker.preventSelfLink}
        onChange={(v) => set({ preventSelfLink: v })}
      />

      <ToggleRow
        id="al-ignore-dates"
        label="Ignore date formats"
        hint="Skip strings that look like dates (e.g. 2024-01-01, Jan 1 2024)."
        checked={linker.ignoreDates}
        onChange={(v) => set({ ignoreDates: v })}
      />

      <div className="settings-field">
        <label className="settings-label" htmlFor="al-delay">
          Format delay (ms)
        </label>
        <input
          id="al-delay"
          className="settings-input settings-input--short"
          type="number"
          inputMode="numeric"
          min={0}
          max={10000}
          step={100}
          value={linker.formatDelay}
          onChange={(e) => {
            const val = Math.max(0, Math.min(10000, Number(e.target.value) || 0));
            set({ formatDelay: val });
          }}
        />
        <p className="settings-hint">
          Milliseconds after the user stops typing before automatic formatting runs.
          Set to 0 for immediate.
        </p>
      </div>

      <div className="settings-field">
        <label className="settings-label" htmlFor="al-excluded-folders">
          Excluded folders
        </label>
        <textarea
          id="al-excluded-folders"
          className="settings-textarea"
          rows={4}
          placeholder={'Templates/\nArchive/'}
          value={excludedFoldersText}
          onChange={(e) =>
            set({
              excludedFolders: e.target.value
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
        <p className="settings-hint">
          One folder path per line. Notes inside these folders are never formatted.
        </p>
      </div>

      <div className="settings-field settings-field-actions">
        <button
          type="button"
          className="settings-btn settings-btn--secondary"
          onClick={async () => {
            setFormatStatus('Formatting…');
            try {
              const r = await window.api.autoLinkerFormatVaultNow();
              setFormatStatus(`Done — ${r.linked} link${r.linked === 1 ? '' : 's'} added`);
            } catch {
              setFormatStatus('Error formatting vault');
            }
            setTimeout(() => setFormatStatus(null), 4000);
          }}
        >
          Format vault now
        </button>
        <button
          type="button"
          className="settings-btn settings-btn--ghost"
          onClick={() => { window.api.autoLinkerRebuildIndex(); }}
        >
          Rebuild index
        </button>
        {formatStatus && (
          <span className="settings-hint" aria-live="polite" style={{ alignSelf: 'center' }}>
            {formatStatus}
          </span>
        )}
      </div>
    </section>
  );
}
