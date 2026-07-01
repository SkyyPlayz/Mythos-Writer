// SKY-2452 — Inline timestamp editor: day slider + time dropdown + confirm/cancel.
//
// Rendered inside or beside the BlockDetail popover when "Edit timestamp" is clicked.
// Calls onConfirm(day, time); the parent supplies the sceneId closure.
import { useState, useCallback, useId } from 'react';
import { parseStrictInt } from './utils/parseStrictInt';
import './TimestampEditor.css';

type StoryTimeOfDay =
  | 'unspecified'
  | 'midnight'
  | 'dawn'
  | 'morning'
  | 'noon'
  | 'afternoon'
  | 'dusk'
  | 'night';

const TIME_OPTIONS: { value: StoryTimeOfDay; label: string }[] = [
  { value: 'unspecified', label: 'Unspecified' },
  { value: 'midnight', label: 'Midnight' },
  { value: 'dawn', label: 'Dawn' },
  { value: 'morning', label: 'Morning' },
  { value: 'noon', label: 'Noon' },
  { value: 'afternoon', label: 'Afternoon' },
  { value: 'dusk', label: 'Dusk' },
  { value: 'night', label: 'Night' },
];

const VALID_TIMES = new Set<string>(TIME_OPTIONS.map(o => o.value));

function clampDay(value: number, max: number): number {
  return Math.max(1, Math.min(max, Math.round(value)));
}

function toStoryTime(raw: string): StoryTimeOfDay {
  return VALID_TIMES.has(raw) ? (raw as StoryTimeOfDay) : 'unspecified';
}

export interface TimestampEditorProps {
  currentDay: number;
  currentTime: string;
  /** Max story day from manifest; slider upper bound. */
  maxDay: number;
  onConfirm: (day: number, time: string) => Promise<void>;
  onCancel: () => void;
}

export default function TimestampEditor({
  currentDay,
  currentTime,
  maxDay,
  onConfirm,
  onCancel,
}: TimestampEditorProps) {
  const safeMax = Math.max(1, maxDay);
  const initialDay = clampDay(currentDay, safeMax);

  const [day, setDay] = useState<number>(initialDay);
  // Raw string mirrors the number input; allows free typing without clamping on every keystroke.
  const [inputStr, setInputStr] = useState<string>(String(initialDay));
  const [time, setTime] = useState<StoryTimeOfDay>(toStoryTime(currentTime));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dayLabelId = useId();
  const timeLabelId = useId();

  // ── Slider ──

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = Number(e.target.value);
      setDay(val);
      setInputStr(String(val));
    },
    [],
  );

  // ── Number input ──

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputStr(e.target.value);
      const parsed = parseStrictInt(e.target.value);
      if (parsed !== null) {
        setDay(clampDay(parsed, safeMax));
      }
    },
    [safeMax],
  );

  const handleInputBlur = useCallback(() => {
    const parsed = parseStrictInt(inputStr);
    const clamped = clampDay(parsed === null ? 1 : parsed, safeMax);
    setDay(clamped);
    setInputStr(String(clamped));
  }, [inputStr, safeMax]);

  // ── Time dropdown ──

  const handleTimeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setTime(toStoryTime(e.target.value));
  }, []);

  // ── Confirm ──

  const doConfirm = useCallback(async () => {
    if (pending) return;
    const parsed = parseStrictInt(inputStr);
    const finalDay = clampDay(parsed === null ? 1 : parsed, safeMax);
    if (finalDay < 1 || finalDay > safeMax) {
      setError(`Day must be between 1 and ${safeMax}.`);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onConfirm(finalDay, time);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save timestamp.');
      setPending(false);
    }
  }, [pending, inputStr, safeMax, time, onConfirm]);

  // ── Keyboard shortcuts ──

  const handleEditorKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    },
    [onCancel],
  );

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void doConfirm();
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    },
    [doConfirm, onCancel],
  );

  return (
    <div
      className="te-root"
      role="group"
      aria-label="Edit scene timestamp"
      onKeyDown={handleEditorKeyDown}
      data-testid="timestamp-editor"
    >
      {/* ── Day control ── */}
      <div className="te-field">
        <label className="te-label" id={dayLabelId} htmlFor={`${dayLabelId}-input`}>
          Day
        </label>
        <div className="te-slider-row" aria-labelledby={dayLabelId}>
          <input
            className="te-slider"
            id={`${dayLabelId}-slider`}
            type="range"
            min={1}
            max={safeMax}
            value={day}
            onChange={handleSliderChange}
            aria-label="Day (slider)"
            aria-valuemin={1}
            aria-valuemax={safeMax}
            aria-valuenow={day}
            disabled={pending}
          />
          <input
            className="te-input-number"
            id={`${dayLabelId}-input`}
            type="number"
            min={1}
            max={safeMax}
            value={inputStr}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            onKeyDown={handleInputKeyDown}
            aria-label="Day (number)"
            disabled={pending}
            data-testid="te-day-input"
          />
        </div>
      </div>

      {/* ── Time of day control ── */}
      <div className="te-field">
        <label className="te-label" id={timeLabelId} htmlFor={`${timeLabelId}-select`}>
          Time of day
        </label>
        <select
          className="te-select"
          id={`${timeLabelId}-select`}
          value={time}
          onChange={handleTimeChange}
          aria-labelledby={timeLabelId}
          disabled={pending}
          data-testid="te-time-select"
        >
          {TIME_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* ── Error ── */}
      {error !== null && (
        <p className="te-error" role="alert" data-testid="te-error">
          {error}
        </p>
      )}

      {/* ── Actions ── */}
      <div className="te-actions">
        <button
          className="te-btn te-btn--secondary"
          type="button"
          onClick={onCancel}
          disabled={pending}
          data-testid="te-cancel"
        >
          Cancel
        </button>
        <button
          className="te-btn te-btn--primary"
          type="button"
          onClick={() => void doConfirm()}
          disabled={pending}
          aria-busy={pending}
          data-testid="te-confirm"
        >
          {pending ? 'Saving…' : 'Confirm'}
        </button>
      </div>
    </div>
  );
}
