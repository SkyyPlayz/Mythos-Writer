// Beta 3 "Liquid Neon" M24 — Settings → Editor (prototype 1871–1890).
// Manuscript defaults (autosave snapshot cadence) + behavior toggles, bound to
// settings.editorPrefs (additive AppSettings field persisted via Save).
// Consumers (spellcheck flag on the editor surface, dictation gate) read the
// persisted prefs; page width intentionally lives in the editor toolbar (M10).
import { M24Card, M24Slider, M24Toggle } from './M24Controls';
import './M24Sections.css';

interface Props {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  setSavedOk: (ok: boolean) => void;
}

export const EDITOR_PREFS_DEFAULTS: Required<EditorPrefs> = {
  autosaveSeconds: 30, // prototype sx.autosave (HTML 3295)
  spellcheck: true,
  smartQuotes: true,
  dimFocus: true,
  dictation: false,
};

const TOGGLE_ROWS: { key: keyof Omit<Required<EditorPrefs>, 'autosaveSeconds'>; label: string }[] = [
  { key: 'spellcheck', label: 'Spellcheck while typing' },
  { key: 'smartQuotes', label: 'Smart quotes & dashes' },
  { key: 'dimFocus', label: 'Focus mode dims window chrome' },
  { key: 'dictation', label: 'Voice dictation (offline model)' },
];

export default function EditorSettingsSection({ settings, setSettings, setSavedOk }: Props) {
  const prefs: Required<EditorPrefs> = { ...EDITOR_PREFS_DEFAULTS, ...settings.editorPrefs };

  const patch = (p: Partial<EditorPrefs>) => {
    setSettings((prev) => ({ ...prev, editorPrefs: { ...EDITOR_PREFS_DEFAULTS, ...prev.editorPrefs, ...p } }));
    setSavedOk(false);
  };

  return (
    <section className="settings-section m24-root" aria-labelledby="section-editor" data-settings-cat="editor">
      <h3 className="settings-section-title" id="section-editor">Editor</h3>

      <M24Card title="Manuscript defaults">
        <div style={{ fontSize: 10.5, color: '#7686a2', marginBottom: 12 }}>
          Page width now lives in the editor toolbar — change it on the fly, no settings trip needed.
        </div>
        <M24Slider
          label="Autosave snapshot every"
          value={prefs.autosaveSeconds}
          min={5}
          max={120}
          unit="s"
          onChange={(v) => patch({ autosaveSeconds: v })}
          testId="editor-autosave-slider"
        />
      </M24Card>

      <M24Card title="Behavior">
        {TOGGLE_ROWS.map(({ key, label }) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
            <span style={{ flex: 1, fontSize: 11.5, color: '#aebad0' }}>{label}</span>
            <M24Toggle
              on={prefs[key]}
              label={label}
              testId={`editor-toggle-${key}`}
              onClick={() => patch({ [key]: !prefs[key] })}
            />
          </div>
        ))}
      </M24Card>
    </section>
  );
}
