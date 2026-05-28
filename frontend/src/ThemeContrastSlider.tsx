import { useEffect, useState, useCallback } from 'react';
import {
  resolveAxisTokens,
  applyAxisTokens,
  readContrastFloors,
  ContrastFloors,
  WCAG_AA_NORMAL,
} from './themeAxis';
import './ThemeContrastSlider.css';

interface Props {
  value: number;
  onChange: (value: number) => void;
}

const PRESETS: { label: string; value: number; hint: string }[] = [
  { label: 'Soft', value: 0, hint: 'More blur, translucent panels' },
  { label: 'Default', value: 50, hint: 'Balanced blur and opacity' },
  { label: 'Sharp', value: 100, hint: 'Less blur, denser panels' },
];

export default function ThemeContrastSlider({ value, onChange }: Props) {
  const [floors, setFloors] = useState<ContrastFloors | null>(null);

  const refresh = useCallback(() => {
    setFloors(readContrastFloors());
  }, []);

  useEffect(() => {
    refresh();
  }, [value, refresh]);

  function handleChange(next: number) {
    const tokens = resolveAxisTokens(next);
    applyAxisTokens(tokens);
    onChange(next);
    // Defer floor re-read so CSS vars have time to apply
    requestAnimationFrame(() => setFloors(readContrastFloors()));
  }

  function floorBadge(ratio: number | undefined) {
    if (ratio == null) return null;
    const pass = ratio >= WCAG_AA_NORMAL;
    return (
      <span className={`tcs-badge ${pass ? 'tcs-badge--pass' : 'tcs-badge--fail'}`}>
        {ratio.toFixed(1)}:1
      </span>
    );
  }

  return (
    <div className="tcs-root">
      <div className="tcs-labels-row">
        <span className="tcs-label-end">Soft</span>
        <span className="tcs-label-end tcs-label-end--right">Sharp</span>
      </div>

      <div className="tcs-track-wrap">
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          onChange={(e) => handleChange(Number(e.target.value))}
          className="tcs-slider"
          data-testid="theme-contrast-slider"
          aria-label="Softness to contrast axis"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={value}
          aria-valuetext={
            value <= 25 ? 'Soft' : value <= 75 ? 'Default' : 'Sharp'
          }
        />
        <div className="tcs-markers">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              className={`tcs-marker ${value === p.value ? 'tcs-marker--active' : ''}`}
              style={{ left: `${p.value}%` }}
              onClick={() => handleChange(p.value)}
              title={p.hint}
              aria-label={`Set ${p.label} (${p.hint})`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {floors && (
        <div className="tcs-floors" aria-label="Contrast floor readings">
          <span className="tcs-floors-label">Contrast floors (WCAG AA ≥ 4.5:1)</span>
          <div className="tcs-floors-row">
            <span className="tcs-floor-name">Soft</span>
            {floorBadge(floors.soft)}
            <span className="tcs-floor-name">Default</span>
            {floorBadge(floors.default)}
            <span className="tcs-floor-name">Sharp</span>
            {floorBadge(floors.sharp)}
          </div>
        </div>
      )}
    </div>
  );
}
