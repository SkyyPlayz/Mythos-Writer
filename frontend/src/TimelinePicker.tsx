// SKY-6306 M21 AC3 — Timeline picker card.
// Purple card at the top of the timeline left panel: shows current timeline
// name + kind icon + chevron; dropdown lists all timelines, '+ New timeline',
// 'Edit calendar…'.
import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, BarChart2, Globe, Star, LayoutList, Plus, Settings2 } from 'lucide-react';
import type { TimelinesStore, TimelineDefinition, TimelineKind } from './timelinesTypes';
import './TimelinePicker.css';

const KIND_ICONS: Record<TimelineKind, React.ReactNode> = {
  story: <BarChart2 size={14} aria-hidden="true" />,
  world: <Globe size={14} aria-hidden="true" />,
  universe: <Star size={14} aria-hidden="true" />,
  custom: <LayoutList size={14} aria-hidden="true" />,
};

const KIND_LABELS: Record<TimelineKind, string> = {
  story: 'Story',
  world: 'World',
  universe: 'Universe',
  custom: 'Custom',
};

export interface TimelinePickerProps {
  store: TimelinesStore;
  onSelect: (timelineId: string) => void;
  onNewTimeline: () => void;
  onEditCalendar: () => void;
}

export default function TimelinePicker({
  store,
  onSelect,
  onNewTimeline,
  onEditCalendar,
}: TimelinePickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const active: TimelineDefinition | undefined = store.timelines.find(
    (t) => t.id === store.activeTimelineId,
  );

  const toggle = useCallback(() => setOpen((v) => !v), []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  function handleSelect(id: string) {
    setOpen(false);
    onSelect(id);
  }

  const hint = 'Drop an existing timeline into another as a span — click a span with a dashed border to open it';
  const calendarNote = active
    ? `${active.calendar.monthsPerYear} months × ${active.calendar.daysPerMonth} days × ${active.calendar.hoursPerDay}h days`
    : '';

  return (
    <div className="tlpicker" ref={rootRef} data-testid="timeline-picker">
      <button
        className="tlpicker__card"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Active timeline: ${active?.name ?? 'None'}`}
        onClick={toggle}
      >
        <span className="tlpicker__icon" aria-hidden="true">
          <BarChart2 size={16} />
        </span>
        <span className="tlpicker__info">
          <span className="tlpicker__name">{active?.name ?? 'Select timeline'}</span>
          {active && (
            <span className="tlpicker__kind">{KIND_LABELS[active.kind]} timeline</span>
          )}
        </span>
        <ChevronDown
          size={14}
          className={`tlpicker__chevron${open ? ' tlpicker__chevron--open' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          className="tlpicker__dropdown"
          role="listbox"
          aria-label="Timeline list"
          data-testid="timeline-picker-dropdown"
        >
          {store.timelines.map((tl) => (
            <button
              key={tl.id}
              role="option"
              aria-selected={tl.id === store.activeTimelineId}
              className={`tlpicker__item${tl.id === store.activeTimelineId ? ' tlpicker__item--active' : ''}`}
              onClick={() => handleSelect(tl.id)}
              data-testid={`timeline-option-${tl.id}`}
            >
              <span className="tlpicker__item-icon" aria-hidden="true">
                {KIND_ICONS[tl.kind]}
              </span>
              <span className="tlpicker__item-label">{tl.name}</span>
              {tl.id === store.activeTimelineId && (
                <span className="tlpicker__active-dot" aria-hidden="true" />
              )}
            </button>
          ))}

          <div className="tlpicker__divider" role="separator" />

          <button
            className="tlpicker__action"
            onClick={() => { setOpen(false); onNewTimeline(); }}
            data-testid="timeline-new"
          >
            <Plus size={13} aria-hidden="true" />
            <span>+ New timeline</span>
          </button>

          <button
            className="tlpicker__action"
            onClick={() => { setOpen(false); onEditCalendar(); }}
            data-testid="timeline-edit-calendar"
          >
            <Settings2 size={13} aria-hidden="true" />
            <span>Edit calendar{calendarNote ? `… (${calendarNote})` : '…'}</span>
          </button>

          <p className="tlpicker__hint">{hint}</p>
        </div>
      )}
    </div>
  );
}
