// Beta 3 "Liquid Neon" M24 — Settings → Editor (prototype 1871–1890).
// Manuscript defaults (autosave snapshot cadence) + behavior toggles, bound to
// settings.editorPrefs (additive AppSettings field persisted via Save).
// F4#4 / Ivy H3: note view prefs write localStorage immediately (same as gear).
// F2#15 owns SettingsPanel save/close — no F4 staging draft.
import { useEffect, useState } from 'react';
import { M24Card, M24Slider, M24Toggle } from './M24Controls';
import {
  readDefaultNoteView,
  subscribeNoteViewPrefs,
  writeDefaultNoteView,
  type DefaultNoteView,
} from '../../../noteViewPrefs';
import './M24Sections.css';

interface Props {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  setSavedOk: (ok: boolean) => void;
}

/**
 * Behavior/autosave defaults — view prefs are localStorage SoT, not EditorPrefs.
 * defaultZoom is intentionally absent: spreading these defaults must not reset
 * the manuscript depth on an unrelated editorPrefs patch.
 */
export const EDITOR_PREFS_DEFAULTS: Omit<Required<EditorPrefs>, 'defaultZoom'> = {
  autosaveSeconds: 30, // prototype sx.autosave (HTML 3295)
  spellcheck: true,
  smartQuotes: true,
  dimFocus: true,
  dictation: false,
};

const BEHAVIOR_TOGGLE_ROWS: {
  key: keyof Pick<typeof EDITOR_PREFS_DEFAULTS, 'spellcheck' | 'smartQuotes' | 'dimFocus'>;
  label: string;
}[] = [
  { key: 'spellcheck', label: 'Spellcheck while typing' },
  { key: 'smartQuotes', label: 'Smart quotes & dashes' },
  { key: 'dimFocus', label: 'Focus mode dims window chrome' },
];

const NOTE_VIEW_OPTIONS: ReadonlyArray<{ value: DefaultNoteView; label: string }> = [
  { value: 'rich', label: 'Rich' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'source', label: 'Source' },
];

const ZOOM_OPTIONS: ReadonlyArray<{ value: NonNullable<EditorPrefs['defaultZoom']>; label: string }> = [
  { value: 'book', label: 'Full book' },
  { value: 'part', label: 'Part' },
  { value: 'chapter', label: 'Chapter' },
  { value: 'scene', label: 'Scene' },
];

export default function EditorSettingsSection({ settings, setSettings, setSavedOk }: Props) {
  const prefs = { ...EDITOR_PREFS_DEFAULTS, ...settings.editorPrefs };
  const [defaultNoteView, setDefaultNoteView] = useState(readDefaultNoteView);

  useEffect(() => subscribeNoteViewPrefs(() => setDefaultNoteView(readDefaultNoteView())), []);

  /** Behavior / autosave — never touches view-pref localStorage. */
  const patchBehavior = (p: Partial<EditorPrefs>) => {
    setSettings((prev) => ({
      ...prev,
      editorPrefs: { ...EDITOR_PREFS_DEFAULTS, ...prev.editorPrefs, ...p },
    }));
    setSavedOk(false);
  };

  /** Immediate localStorage write — not gated on Settings Save. Sticky modes stay. */
  const onDefaultNoteView = (value: DefaultNoteView) => {
    writeDefaultNoteView(value);
    setDefaultNoteView(readDefaultNoteView());
  };

  const onDefaultZoom = (value: NonNullable<EditorPrefs['defaultZoom']>) => {
    patchBehavior({ defaultZoom: value });
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
        <p className="settings-hint" data-testid="editor-dictation-offline">
          Voice dictation uses the offline model and stays off until you start it in the editor.
        </p>
      </M24Card>

      <M24Card title="Default views">
        <div style={{ fontSize: 10.5, color: '#7686a2', marginBottom: 12 }}>
          Rich is the default note view. Choosing Markdown or Source also shows that mode in the note gear.
          Sticky per-note modes stay stored. Changes apply immediately.
        </div>
        <label className="settings-field" htmlFor="editor-default-note-view">
          <span className="settings-label">Default note view</span>
          <select
            id="editor-default-note-view"
            className="settings-input settings-select"
            aria-label="Default note view"
            data-testid="editor-default-note-view"
            value={defaultNoteView}
            onChange={(e) => {
              const next = e.target.value;
              if (next === 'rich' || next === 'markdown' || next === 'source') onDefaultNoteView(next);
            }}
          >
            {NOTE_VIEW_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
        <label className="settings-field" htmlFor="editor-default-zoom">
          <span className="settings-label">Default manuscript zoom</span>
          <select
            id="editor-default-zoom"
            className="settings-input settings-select"
            aria-label="Default manuscript zoom"
            data-testid="editor-default-manuscript-zoom"
            value={prefs.defaultZoom ?? 'book'}
            onChange={(e) => {
              const next = e.target.value;
              if (next === 'book' || next === 'part' || next === 'chapter' || next === 'scene') onDefaultZoom(next);
            }}
          >
            {ZOOM_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
      </M24Card>
    </section>
  );
}
