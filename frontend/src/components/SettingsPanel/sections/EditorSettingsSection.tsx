// Beta 3 "Liquid Neon" M24 — Settings → Editor (prototype 1871–1890).
// Manuscript defaults (autosave snapshot cadence) + behavior toggles, bound to
// settings.editorPrefs (additive AppSettings field persisted via Save).
// Consumers (spellcheck flag on the editor surface, dictation gate) read the
// persisted prefs; page width intentionally lives in the editor toolbar (M10).
// F4#4: note view toggles (Markdown/Source enablement + Always open in Rich)
// live here and bridge to NoteViewer via localStorage (no DesktopShell mount).
import { M24Card, M24Slider, M24Toggle } from './M24Controls';
import { syncNoteViewPrefsFromSettings } from '../../../noteViewPrefs';
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
  showMarkdownView: false,
  showSourceView: false,
  alwaysOpenRich: true,
};

const BEHAVIOR_TOGGLE_ROWS: {
  key: keyof Pick<Required<EditorPrefs>, 'spellcheck' | 'smartQuotes' | 'dimFocus' | 'dictation'>;
  label: string;
}[] = [
  { key: 'spellcheck', label: 'Spellcheck while typing' },
  { key: 'smartQuotes', label: 'Smart quotes & dashes' },
  { key: 'dimFocus', label: 'Focus mode dims window chrome' },
  { key: 'dictation', label: 'Voice dictation (offline model)' },
];

const VIEW_TOGGLE_ROWS: {
  key: keyof Pick<Required<EditorPrefs>, 'showMarkdownView' | 'showSourceView' | 'alwaysOpenRich'>;
  label: string;
  hint?: string;
}[] = [
  {
    key: 'alwaysOpenRich',
    label: 'Always open notes in Rich view',
    hint: 'Clears per-note sticky modes so new opens follow this setting.',
  },
  {
    key: 'showMarkdownView',
    label: 'Show Markdown view toggle',
    hint: 'Off by default — only Rich appears in the note gear until enabled.',
  },
  {
    key: 'showSourceView',
    label: 'Show Source Mode toggle',
    hint: 'Off by default — only Rich appears in the note gear until enabled.',
  },
];

export default function EditorSettingsSection({ settings, setSettings, setSavedOk }: Props) {
  const prefs: Required<EditorPrefs> = { ...EDITOR_PREFS_DEFAULTS, ...settings.editorPrefs };

  const patch = (p: Partial<EditorPrefs>) => {
    const next = { ...EDITOR_PREFS_DEFAULTS, ...settings.editorPrefs, ...p };
    setSettings((prev) => ({ ...prev, editorPrefs: { ...EDITOR_PREFS_DEFAULTS, ...prev.editorPrefs, ...p } }));
    syncNoteViewPrefsFromSettings({
      alwaysOpenRich: next.alwaysOpenRich,
      showMarkdownView: next.showMarkdownView,
      showSourceView: next.showSourceView,
    });
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
        {BEHAVIOR_TOGGLE_ROWS.map(({ key, label }) => (
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

      <M24Card title="Note view">
        <div style={{ fontSize: 10.5, color: '#7686a2', marginBottom: 12 }}>
          Rich is the default. Enable Markdown or Source here to show them in the note gear menu.
        </div>
        {VIEW_TOGGLE_ROWS.map(({ key, label, hint }) => (
          <div key={key} style={{ padding: '5px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1, fontSize: 11.5, color: '#aebad0' }}>{label}</span>
              <M24Toggle
                on={prefs[key]}
                label={label}
                testId={`editor-toggle-${key}`}
                onClick={() => patch({ [key]: !prefs[key] })}
              />
            </div>
            {hint ? (
              <div style={{ fontSize: 10, color: '#7686a2', marginTop: 4, paddingRight: 48 }}>{hint}</div>
            ) : null}
          </div>
        ))}
      </M24Card>
    </section>
  );
}
