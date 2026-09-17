// Beta 4 M22 — Per-timeline calendar editor modal (§8.3, prototype
// 3738–3772): three number fields (months/yr · days/mo · hours/day) +
// presets `Earth-like — 12 × 30 · 24h` / `Strange world — 13 × 28 · 18h`.
//
// 0.5.3 multi-calendar (SKY-11698 §6): epoch, era, conversion table, live
// ratio note for non-standard timelines.
import { useMemo } from 'react';
import type { TimelineCalendar, TimelineDefinition } from '../timelinesTypes';
import {
  calendarRatio,
  buildConversionTable,
  eraOf,
  hoursPerYear,
  safeCalendar,
  timelineEpoch,
} from './axis/calendarCodec';
import Dialog from '../components/ui/Dialog';
import './Timeline2Modals.css';

export interface CalendarEditorModalProps {
  timelineName: string;
  calendar: TimelineCalendar;
  /** Called with the updated calendar; presetLabel set when a preset chip was picked (for the toast). */
  onChange: (calendar: TimelineCalendar, presetLabel?: string) => void;
  onClose: () => void;
  /** Multi-calendar fields for the active timeline (optional — absent hides epoch/era UI). */
  timeline?: TimelineDefinition;
  /** Standard calendar resolved from the store. */
  stdCalendar?: TimelineCalendar;
  /** Called when the user changes epoch, epName, era, or std. */
  onMultiCalChange?: (patch: Partial<Pick<TimelineDefinition, 'ep' | 'epName' | 'era' | 'std'>>) => void;
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
  timeline,
  stdCalendar,
  onMultiCalChange,
}: CalendarEditorModalProps) {
  const commitField = (key: (typeof FIELD_ROWS)[number]['key'], raw: string) => {
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || n <= 0) return;
    onChange({ ...calendar, preset: 'custom', [key]: n });
  };

  const isStd = timeline?.std === true;
  const safeCal = safeCalendar(calendar);
  const safeStdCal = safeCalendar(stdCalendar);
  const ratio = timeline ? calendarRatio(timeline, safeStdCal) : 1;
  const localHpy = hoursPerYear(safeCal);
  const stdHpy = hoursPerYear(safeStdCal);

  const conversionTable = useMemo(() => {
    if (!timeline || isStd || !stdCalendar) return null;
    const ep = timelineEpoch(timeline, safeStdCal);
    const epYear = (ep * 10) / stdHpy;
    const localEnd = Math.max(10, Math.round(epYear > 0 ? 125 : 100));
    return buildConversionTable(timeline, safeStdCal, 0, localEnd, 5);
  }, [timeline, isStd, stdCalendar, safeStdCal, stdHpy]);

  const showMultiCal = Boolean(timeline && stdCalendar && onMultiCalChange);

  return (
    <Dialog
      open
      onClose={onClose}
      aria-label={`Calendar — ${timelineName}`}
      className="t2m-card t2m-card--purple"
      overlayTestId="cem-backdrop"
      testId="calendar-editor-modal"
    >
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
        {isStd && <><br /><b>This is the universal standard.</b></>}
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

      {/* Multi-calendar: ratio note */}
      {showMultiCal && !isStd && (
        <div className="t2m-note" data-testid="cem-ratio-note">
          One local year = <b>{ratio.toFixed(ratio === Math.round(ratio) ? 1 : 3)} standard year{ratio === 1 ? '' : 's'}</b>
          {' · '}{localHpy} local hours vs {stdHpy} standard
          {safeCal.hoursPerDay !== safeStdCal.hoursPerDay &&
            ` · a local day is ${safeCal.hoursPerDay}h against the standard ${safeStdCal.hoursPerDay}h`}
        </div>
      )}

      {/* Multi-calendar: epoch + era */}
      {showMultiCal && (
        <>
          <div className="t2m-section-label">WHERE ITS YEAR 0 LANDS</div>
          <div className="t2m-cal-rows">
            <div className="t2m-cal-row">
              <span className="t2m-cal-label">Name of year zero</span>
              <input
                className="t2m-field-input t2m-cal-input"
                defaultValue={timeline?.epName ?? ''}
                onBlur={(e) => onMultiCalChange!({ epName: e.target.value || undefined })}
                aria-label="Name of year zero"
                data-testid="cem-epName"
              />
            </div>
            {!isStd && (
              <div className="t2m-cal-row">
                <span className="t2m-cal-label">Standard year it falls on</span>
                <input
                  className="t2m-field-input t2m-cal-input"
                  defaultValue={timeline?.ep != null ? String(Math.round((timeline.ep * 10) / stdHpy)) : ''}
                  onBlur={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (Number.isNaN(n)) return;
                    onMultiCalChange!({ ep: (n * stdHpy) / 10 });
                  }}
                  inputMode="numeric"
                  aria-label="Epoch standard year"
                  data-testid="cem-ep"
                />
              </div>
            )}
            <div className="t2m-cal-row">
              <span className="t2m-cal-label">Era suffix</span>
              <input
                className="t2m-field-input t2m-cal-input"
                defaultValue={timeline?.era ?? 'EC'}
                onBlur={(e) => onMultiCalChange!({ era: e.target.value || 'EC' })}
                aria-label="Era suffix"
                data-testid="cem-era"
              />
            </div>
            {!isStd && (
              <div className="t2m-cal-row">
                <label className="t2m-cal-label">
                  <input
                    type="checkbox"
                    checked={isStd}
                    onChange={(e) => onMultiCalChange!({ std: e.target.checked || undefined })}
                    data-testid="cem-std"
                  />{' '}
                  This is the universal standard
                </label>
              </div>
            )}
          </div>
        </>
      )}

      {/* Multi-calendar: conversion table */}
      {conversionTable && timeline && (
        <>
          <div className="t2m-section-label" data-testid="cem-conversion-head">
            THIS WORLD SAYS → YOU FILE IT AT (EC)
          </div>
          <div className="t2m-conv-table" data-testid="cem-conversion-table">
            {conversionTable.map((row, i) => (
              <div className="t2m-conv-row" key={i}>
                <span className="t2m-conv-local">
                  {row.localYear} {eraOf(timeline)}
                </span>
                <span className="t2m-conv-arrow" aria-hidden="true">→</span>
                <span className="t2m-conv-std">{row.stdYear} EC</span>
              </div>
            ))}
          </div>
        </>
      )}

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
    </Dialog>
  );
}
