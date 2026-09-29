// Beta 3 "Liquid Neon" M24 — Settings → Editor (prototype 1871–1890).
// Manuscript defaults (autosave snapshot cadence) + behavior toggles, bound to
// settings.editorPrefs (additive AppSettings field persisted via Save).
// F4#4: note view prefs — localStorage is SoT. Settings stages toggles in a
// draft; Save commits via commitSettingsViewPrefsDraft (SettingsPanel).
// Cancel / Escape / × discard the draft — keys and gear stay unchanged.
import { useState } from 'react';
import { M24Card, M24Slider, M24Toggle } from './M24Controls';
import {
  readSettingsViewPrefsDraft,
  stageSettingsViewPref,
  type SettingsViewPrefKey,
} from '../../../noteViewPrefs';
import './M24Sections.css';

interface Props {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  setSavedOk: (ok: boolean) => void;
}

/** Behavior/autosave defaults only — view prefs live in localStorage SoT. */
type BehaviorPrefs = Omit<EditorPrefs, 'showMarkdownView' | 'showSourceView' | 'alwaysOpenRich'>;

export const EDITOR_PREFS_DEFAULTS: Required<BehaviorPrefs> = {
  autosaveSeconds: 30, // prototype sx.autosave (HTML 3295)
  spellcheck: true,
  smartQuotes: true,
  dimFocus: true,
  dictation: false,
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

type ViewKey = SettingsViewPrefKey;

const VIEW_TOGGLE_ROWS: {
  key: ViewKey;
  label: string;
  hint?: string;
}[] = [
  {
    key: 'alwaysOpenRich',
    label: 'Always open notes in Rich view',
    hint: 'When on, notes open in Rich (sticky per-note modes stay stored for when this is off).',
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
  const prefs: Required<BehaviorPrefs> = { ...EDITOR_PREFS_DEFAULTS, ...settings.editorPrefs };
  // Draft UI — commit only on Settings Save (Probe N1).
  const [viewPrefs, setViewPrefs] = useState(readSettingsViewPrefsDraft);

  /** Behavior / autosave — never touches view-pref localStorage. */
  const patchBehavior = (p: Partial<BehaviorPrefs>) => {
    setSettings((prev) => ({
      ...prev,
      editorPrefs: { ...EDITOR_PREFS_DEFAULTS, ...prev.editorPrefs, ...p },
    }));
    setSavedOk(false);
  };

  /** Stage only — Cancel/Escape must not persist (Probe N1). */
  const setViewPref = (key: ViewKey, value: boolean) => {
    stageSettingsViewPref(key, value);
    setViewPrefs(readSettingsViewPrefsDraft());
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
          onChange={(v) => patchBehavior({ autosaveSeconds: v })}
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
              onClick={() => patchBehavior({ [key]: !prefs[key] })}
            />
          </div>
        ))}
      </M24Card>

      <M24Card title="Note view">
        <div style={{ fontSize: 10.5, color: '#7686a2', marginBottom: 12 }}>
          Rich is the default. Enable Markdown or Source here to show them in the note gear menu.
          Changes apply when you Save — Cancel leaves them as they were.
        </div>
        {VIEW_TOGGLE_ROWS.map(({ key, label, hint }) => (
          <div key={key} style={{ padding: '5px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1, fontSize: 11.5, color: '#aebad0' }}>{label}</span>
              <M24Toggle
                on={viewPrefs[key]}
                label={label}
                testId={`editor-toggle-${key}`}
                onClick={() => setViewPref(key, !viewPrefs[key])}
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
