import { useId } from 'react';
import { PRESET_LIBRARY, type Preset } from '../../PresetLibrary';
import './index.css';

interface Props {
  activePresetId: string | null;
  onSelect: (presetId: string | null) => void;
  showFirstRunTip?: boolean;
  onDismissTip?: () => void;
}

export default function PresetSelector({ activePresetId, onSelect, showFirstRunTip, onDismissTip }: Props) {
  const selectId = useId();
  const activePreset: Preset | undefined = activePresetId
    ? PRESET_LIBRARY.find((p) => p.id === activePresetId)
    : undefined;

  const grouped = groupByGenre(PRESET_LIBRARY);

  return (
    <div className="preset-sel-bar">
      {showFirstRunTip && (
        <div className="preset-sel-tip" role="note" aria-label="Genre preset tip">
          <span className="preset-sel-tip-icon" aria-hidden="true">💡</span>
          <span className="preset-sel-tip-text">
            Tip: Choose a genre preset to shape how suggestions sound.{' '}
            E.g., &ldquo;Fantasy — Epic &amp; Dark&rdquo; favors morally complex scenarios.
          </span>
          {onDismissTip && (
            <button
              className="preset-sel-tip-dismiss"
              onClick={onDismissTip}
              type="button"
              aria-label="Dismiss genre preset tip"
            >
              ✕
            </button>
          )}
        </div>
      )}

      <div className="preset-sel-row">
        <label className="preset-sel-label" htmlFor={selectId}>
          Preset:
        </label>
        <div className="preset-sel-select-wrap">
          <select
            id={selectId}
            className="preset-sel-select"
            value={activePresetId ?? ''}
            onChange={(e) => onSelect(e.target.value || null)}
            aria-label="Writing style preset"
            data-testid="preset-selector"
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
        {activePreset && (
          <span className="preset-sel-badge" title={activePreset.description}>
            {activePreset.tone}
          </span>
        )}
      </div>
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
