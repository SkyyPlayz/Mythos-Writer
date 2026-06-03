import { useState, useId } from 'react';
import { PRESET_LIBRARY, type Preset, type ToneKey, type PovKey, type LengthKey } from '../../PresetLibrary';
import './index.css';

export interface CustomAxes {
  tone?: ToneKey;
  pov?: PovKey;
  length?: LengthKey;
}

interface Props {
  activePresetId: string | null;
  customAxes: CustomAxes;
  onSelectPreset: (presetId: string | null) => void;
  onCustomAxesChange: (axes: CustomAxes) => void;
  showFirstRunTip?: boolean;
  onDismissTip?: () => void;
}

const TONE_OPTIONS: ToneKey[] = ['dark', 'wry', 'hopeful', 'tense', 'whimsical', 'elegant', 'clinical'];
const POV_OPTIONS: Array<{ value: PovKey; label: string }> = [
  { value: '1st-person', label: '1st-person' },
  { value: '3rd-person-limited', label: '3rd-person limited' },
  { value: '3rd-person-omniscient', label: '3rd-person omniscient' },
  { value: 'alternating-1st-person', label: 'alternating 1st-person' },
  { value: '2nd-person', label: '2nd-person' },
];
const LENGTH_OPTIONS: LengthKey[] = ['brief', 'medium', 'long'];

export default function GenrePresetPicker({
  activePresetId,
  customAxes,
  onSelectPreset,
  onCustomAxesChange,
  showFirstRunTip,
  onDismissTip,
}: Props) {
  const [showCustomize, setShowCustomize] = useState(false);
  const selectId = useId();

  const activePreset: Preset | undefined = activePresetId
    ? PRESET_LIBRARY.find((p) => p.id === activePresetId)
    : undefined;

  const grouped = groupByGenre(PRESET_LIBRARY);

  return (
    <div className="genre-picker">
      {showFirstRunTip && (
        <div className="genre-picker-tip" role="note" aria-label="Genre preset first-run tip">
          <span aria-hidden="true">🏷️</span>
          <span className="genre-picker-tip-text">
            Genre Preset: Pick one to steer your brainstorm.
          </span>
          <div className="genre-picker-tip-quick">
            {PRESET_LIBRARY.slice(0, 3).map((p) => (
              <button
                key={p.id}
                className="genre-picker-tip-btn"
                onClick={() => { onSelectPreset(p.id); onDismissTip?.(); }}
                type="button"
              >
                {p.name}
              </button>
            ))}
            <button
              className="genre-picker-tip-btn genre-picker-tip-more"
              onClick={onDismissTip}
              type="button"
            >
              More…
            </button>
          </div>
        </div>
      )}

      <div className="genre-picker-row">
        <label className="genre-picker-label" htmlFor={selectId}>
          Genre Preset:
        </label>
        <div className="genre-picker-select-wrap">
          <select
            id={selectId}
            className="genre-picker-select"
            value={activePresetId ?? ''}
            onChange={(e) => {
              onSelectPreset(e.target.value || null);
              setShowCustomize(false);
              onCustomAxesChange({});
            }}
            aria-label="Genre preset for brainstorm"
            data-testid="genre-preset-picker"
          >
            <option value="">Default</option>
            {grouped.map(([genre, presets]) => (
              <optgroup key={genre} label={genreLabel(genre)}>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <button
          className={`genre-picker-customize-btn${showCustomize ? ' genre-picker-customize-active' : ''}`}
          onClick={() => setShowCustomize((prev) => !prev)}
          type="button"
          aria-expanded={showCustomize}
          aria-label={showCustomize ? 'Collapse customize panel' : 'Customize preset axes'}
        >
          ✎ Customize
        </button>

        {activePreset && (
          <span className="genre-picker-badge" title={activePreset.description}>
            {activePreset.tone}
          </span>
        )}
      </div>

      {showCustomize && (
        <div className="genre-picker-axes" role="group" aria-label="Custom preset axes">
          <p className="genre-picker-axes-hint">
            Overrides apply to this prompt only; next prompt reverts to the selected preset.
          </p>
          <div className="genre-picker-axes-grid">
            <label className="genre-picker-axis-label">
              Tone
              <select
                className="genre-picker-axis-select"
                value={customAxes.tone ?? activePreset?.tone ?? ''}
                onChange={(e) => onCustomAxesChange({ ...customAxes, tone: (e.target.value as ToneKey) || undefined })}
                aria-label="Custom tone"
                data-testid="custom-axis-tone"
              >
                <option value="">— from preset —</option>
                {TONE_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>

            <label className="genre-picker-axis-label">
              POV
              <select
                className="genre-picker-axis-select"
                value={customAxes.pov ?? activePreset?.pov ?? ''}
                onChange={(e) => onCustomAxesChange({ ...customAxes, pov: (e.target.value as PovKey) || undefined })}
                aria-label="Custom POV"
                data-testid="custom-axis-pov"
              >
                <option value="">— from preset —</option>
                {POV_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>

            <label className="genre-picker-axis-label">
              Length
              <select
                className="genre-picker-axis-select"
                value={customAxes.length ?? activePreset?.length ?? ''}
                onChange={(e) => onCustomAxesChange({ ...customAxes, length: (e.target.value as LengthKey) || undefined })}
                aria-label="Custom length"
                data-testid="custom-axis-length"
              >
                <option value="">— from preset —</option>
                {LENGTH_OPTIONS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

function groupByGenre(presets: Preset[]): Array<[string, Preset[]]> {
  const map = new Map<string, Preset[]>();
  for (const p of presets) {
    const group = map.get(p.genre) ?? [];
    group.push(p);
    map.set(p.genre, group);
  }
  return Array.from(map.entries());
}

function genreLabel(genre: string): string {
  const labels: Record<string, string> = {
    fantasy: 'Fantasy',
    'sci-fi': 'Science Fiction',
    romance: 'Romance',
    literary: 'Literary',
    mystery: 'Mystery / Thriller',
    historical: 'Historical',
  };
  return labels[genre] ?? genre;
}
