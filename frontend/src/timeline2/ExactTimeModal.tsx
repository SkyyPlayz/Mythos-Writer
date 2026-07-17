// Beta 4 M22 — Exact-time picker modal (§8.3, prototype 3702–3735).
// START (+ END when the target has from/to) as four mono inputs
// YEAR / MONTH / DAY / HOUR in the timeline's calendar, calendar note +
// `change` link → calendar editor modal. Inputs are draft-commit (§1.4):
// raw strings while typing, parsed once on Apply.
import { useState } from 'react';
import type { TimelineCalendar } from '../timelinesTypes';
import { calendarNote, safeDecodeWhen, safeEncodeWhen } from './axis/calendarCodec';
import './Timeline2Modals.css';

export type ExactTimeTarget =
  | { kind: 'single'; when: number }
  | { kind: 'dual'; startWhen: number; endWhen: number };

export interface ExactTimeModalProps {
  calendar: TimelineCalendar;
  target: ExactTimeTarget;
  /** Axis start — the §8.2 fallback when the stored `when` is invalid. */
  fallbackWhen: number;
  onApply: (result: { when?: number; startWhen?: number; endWhen?: number }) => void;
  onClose: () => void;
  /** The `change` link beside the calendar note. */
  onEditCalendar: () => void;
}

interface FieldSpec {
  key: 'year' | 'month' | 'day' | 'hour';
  label: string;
}

const FIELDS: FieldSpec[] = [
  { key: 'year', label: 'YEAR' },
  { key: 'month', label: 'MONTH' },
  { key: 'day', label: 'DAY' },
  { key: 'hour', label: 'HOUR' },
];

type DraftInstant = Record<FieldSpec['key'], string>;

function seedDraft(when: number, calendar: TimelineCalendar, fallback: number): DraftInstant {
  const v = safeDecodeWhen(when, calendar, fallback);
  return { year: String(v.year), month: String(v.month), day: String(v.day), hour: String(v.hour) };
}

function parseDraft(draft: DraftInstant) {
  const num = (s: string) => {
    const n = parseInt(s, 10);
    return Number.isNaN(n) ? 0 : n;
  };
  return { year: num(draft.year), month: num(draft.month), day: num(draft.day), hour: num(draft.hour) };
}

export default function ExactTimeModal({
  calendar,
  target,
  fallbackWhen,
  onApply,
  onClose,
  onEditCalendar,
}: ExactTimeModalProps) {
  const isDual = target.kind === 'dual';
  const [start, setStart] = useState<DraftInstant>(() =>
    seedDraft(target.kind === 'single' ? target.when : target.startWhen, calendar, fallbackWhen),
  );
  const [end, setEnd] = useState<DraftInstant>(() =>
    seedDraft(target.kind === 'dual' ? target.endWhen : fallbackWhen, calendar, fallbackWhen),
  );

  const apply = () => {
    const startWhen = safeEncodeWhen(parseDraft(start), calendar);
    if (isDual) {
      onApply({ startWhen, endWhen: safeEncodeWhen(parseDraft(end), calendar) });
    } else {
      onApply({ when: startWhen });
    }
  };

  const renderFields = (
    draft: DraftInstant,
    setDraft: (next: DraftInstant) => void,
    idPrefix: string,
  ) => (
    <div className="t2m-fields">
      {FIELDS.map((f) => (
        <div className="t2m-field" key={f.key}>
          <div className="t2m-field-label">{f.label}</div>
          <input
            className="t2m-field-input"
            value={draft[f.key]}
            onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
            inputMode="numeric"
            aria-label={`${idPrefix} ${f.label.toLowerCase()}`}
            data-testid={`etm-${idPrefix}-${f.key}`}
          />
        </div>
      ))}
    </div>
  );

  return (
    <div className="t2m-overlay" data-testid="exact-time-modal">
      <div className="t2m-backdrop" onClick={onClose} data-testid="etm-backdrop" />
      <div className="t2m-card t2m-card--cyan" role="dialog" aria-modal="true" aria-label="Set exact time">
        <div className="t2m-head">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--n1,#00f0ff)" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 3" />
          </svg>
          <span className="t2m-title">Set exact time</span>
          <button type="button" className="t2m-close" onClick={onClose} aria-label="Close" data-testid="etm-close">
            ✕
          </button>
        </div>
        <div className="t2m-note">
          Calendar for this timeline: <b>{calendarNote(calendar)}</b> ·{' '}
          <button type="button" className="t2m-link" onClick={onEditCalendar} data-testid="etm-change-calendar">
            change
          </button>
        </div>
        <div className="t2m-section-label">START</div>
        {renderFields(start, setStart, 'start')}
        {isDual && (
          <>
            <div className="t2m-section-label">END</div>
            {renderFields(end, setEnd, 'end')}
          </>
        )}
        <div className="t2m-actions">
          <button type="button" className="t2m-btn t2m-btn--ghost" onClick={onClose} data-testid="etm-cancel">
            Cancel
          </button>
          <button type="button" className="t2m-btn t2m-btn--primary" onClick={apply} data-testid="etm-apply">
            Set time
          </button>
        </div>
      </div>
    </div>
  );
}
