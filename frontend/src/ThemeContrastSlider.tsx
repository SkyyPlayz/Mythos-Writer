import { useCallback, type KeyboardEvent } from 'react';
import {
  THEME_AXIS_MIN,
  THEME_AXIS_MAX,
  THEME_AXIS_SNAP_SOFT,
  THEME_AXIS_SNAP_SHARP,
  clampAxis,
} from './themeAxis';
import './ThemeContrastSlider.css';

/** Keyboard increments per MYT-520 §4.3. */
const STEP_ARROW = 0.02;
const STEP_PAGE = 0.1;

interface Props {
  /** Current axis position, 0 (softer) … 1 (sharper). */
  value: number;
  /** Called with the new clamped position on any change (live preview). */
  onChange: (s: number) => void;
  /**
   * Disabled when the WCAG high-contrast theme is on — that mode manages
   * contrast itself, so the two systems never fight (MYT-520 §5.2).
   */
  disabled?: boolean;
  /**
   * OS is requesting increased contrast: the axis can't go softer than 0.6,
   * so reflect that as the effective minimum (MYT-520 §4.5).
   */
  osHighContrast?: boolean;
}

/**
 * Softness ↔ Contrast slider (MYT-518). A single continuous control that
 * blends the dark Liquid Glass theme from softer (lighter, gentler neon) to
 * sharper (darker, crisper neon). Continuous — users park it anywhere.
 */
export default function ThemeContrastSlider({ value, onChange, disabled, osHighContrast }: Props) {
  const effMin = osHighContrast ? clampAxis(THEME_AXIS_MIN, { osHighContrast }) : THEME_AXIS_MIN;
  const pct = Math.round(value * 100);
  const valueText = `Contrast ${pct}%`;

  const emit = useCallback(
    (next: number) => onChange(clampAxis(next, { osHighContrast })),
    [onChange, osHighContrast],
  );

  // The native range step is fine-grained for true continuity; arrow/page/home
  // keys get the spec increments via an explicit handler.
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      let next: number | null = null;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowUp':
          next = value + STEP_ARROW;
          break;
        case 'ArrowLeft':
        case 'ArrowDown':
          next = value - STEP_ARROW;
          break;
        case 'PageUp':
          next = value + STEP_PAGE;
          break;
        case 'PageDown':
          next = value - STEP_PAGE;
          break;
        case 'Home':
          next = effMin;
          break;
        case 'End':
          next = THEME_AXIS_MAX;
          break;
        default:
          return;
      }
      e.preventDefault();
      emit(next);
    },
    [value, effMin, emit],
  );

  return (
    <div className={`theme-axis-slider${disabled ? ' is-disabled' : ''}`}>
      <div className="theme-axis-labels">
        <span className="theme-axis-end" aria-hidden="true">Softer</span>
        <span className="theme-axis-value" aria-hidden="true">{valueText}</span>
        <span className="theme-axis-end" aria-hidden="true">Sharper</span>
      </div>
      <div className="theme-axis-track-wrap">
        {/* Orientation ticks at the two reference looks — visual only, not steps. */}
        <span
          className="theme-axis-snap"
          style={{ left: `${THEME_AXIS_SNAP_SOFT * 100}%` }}
          aria-hidden="true"
        />
        <span
          className="theme-axis-snap"
          style={{ left: `${THEME_AXIS_SNAP_SHARP * 100}%` }}
          aria-hidden="true"
        />
        <input
          className="theme-axis-input"
          type="range"
          min={THEME_AXIS_MIN}
          max={THEME_AXIS_MAX}
          step={0.001}
          value={value}
          disabled={disabled}
          aria-label="Softer to sharper theme contrast"
          aria-valuemin={effMin}
          aria-valuemax={THEME_AXIS_MAX}
          aria-valuenow={value}
          aria-valuetext={valueText}
          onKeyDown={onKeyDown}
          onChange={(e) => emit(Number(e.target.value))}
        />
      </div>
      {disabled && (
        <p className="theme-axis-note" role="note">
          Managed by High-Contrast mode.
        </p>
      )}
    </div>
  );
}
