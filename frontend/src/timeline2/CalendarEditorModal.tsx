// Beta 4 M22 — Per-timeline calendar editor modal (§8.3, prototype
// 3738–3772): three number fields (months/yr · days/mo · hours/day) +
// presets `Earth-like — 12 × 30 · 24h` / `Strange world — 13 × 28 · 18h`.
import type { TimelineCalendar } from '../timelinesTypes';
import './Timeline2Modals.css';

export interface CalendarEditorModalProps {
  timelineName: string;
  calendar: TimelineCalendar;
  /** Called with the updated calendar; presetLabel set when a preset chip was picked (for the toast). */
  onChange: (calendar: TimelineCalendar, presetLabel?: string) => void;
  onClose: () => void;
}

const FIELD_ROWS: { key: 'monthsPerYear' | 'daysPerMonth' | 'hoursPerDay'; label: string }[] = [
  { key: 'monthsPerYear', label: 'Months per year' },
  { key: 'daysPerMonth', label: 'Days per month' },
  { key: 'hoursPerDay', label: 'Hours per day' },
];

const PRESETS: { label: string; calendar: TimelineCalendar }[] = [
  {
    label: 'Earth-like — 12 × 30 · 24h',
    calendar: { preset: 'standard', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 },
  },
  {
    label: 'Strange world — 13 × 28 · 18h',
    calendar: { preset: 'aeon-13', monthsPerYear: 13, daysPerMonth: 28, hoursPerDay: 18 },
  },
];

export default function CalendarEditorModal({
  timelineName,
  calendar,
  onChange,
  onClose,
}: CalendarEditorModalProps) {
  const commitField = (key: (typeof FIELD_ROWS)[number]['key'], raw: string) => {
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || n <= 0) return; // prototype: only positive integers commit
    onChange({ ...calendar, preset: 'custom', [key]: n });
  };

  return (
    <div className="t2m-overlay t2m-overlay--top" data-testid="calendar-editor-modal">
      <div className="t2m-backdrop" onClick={onClose} data-testid="cem-backdrop" />
      <div className="t2m-card t2m-card--purple" role="dialog" aria-modal="true" aria-label={`Calendar — ${timelineName}`}>
        <div className="t2m-head">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--n2,#9b5fff)" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
          <span className="t2m-title">Calendar — {timelineName}</span>
          <button type="button" className="t2m-close" onClick={onClose} aria-label="Close" data-testid="cem-close">
            ✕
          </button>
        </div>
        <div className="t2m-note">
          Each timeline can run its own calendar — a 13-month world with 28-day months and 18-hour
          days plots just as cleanly. Dates entered in the time picker use these units.
        </div>
        <div className="t2m-cal-rows">
          {FIELD_ROWS.map((row) => (
            <div className="t2m-cal-row" key={row.key}>
              <span className="t2m-cal-label">{row.label}</span>
              <input
                className="t2m-field-input t2m-cal-input"
                defaultValue={String(calendar[row.key])}
                onChange={(e) => commitField(row.key, e.target.value)}
                inputMode="numeric"
                aria-label={row.label}
                data-testid={`cem-${row.key}`}
              />
            </div>
          ))}
        </div>
        <div className="t2m-section-label">PRESETS</div>
        <div className="t2m-presets">
          {PRESETS.map((preset) => (
            <button
              type="button"
              key={preset.label}
              className="t2m-preset"
              onClick={() => onChange(preset.calendar, preset.label)}
              data-testid={`cem-preset-${preset.calendar.preset}`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="t2m-actions">
          <button type="button" className="t2m-btn t2m-btn--primary" onClick={onClose} data-testid="cem-done">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
