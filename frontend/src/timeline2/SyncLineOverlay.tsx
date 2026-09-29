// Slice E — Sync playhead (03 §1): armed-only place, drag handle, stamp stack.
import { useCallback, useMemo, useRef } from 'react';
import type { TimelineDefinition, TimelinesStore } from '../timelinesTypes';
import {
  calendarRatio,
  eraOf,
  resolveStdCalendar,
  safeCalendar,
  timelineEpoch,
  toStandard,
} from './axis/calendarCodec';
import { formatLocalStamp, formatStandardStamp } from './axis/stamps';
import './SyncLineOverlay.css';

export interface SyncLineOverlayProps {
  store: TimelinesStore;
  active: TimelineDefinition;
  /** Visible window [win0, win1] in when-units. */
  win0: number;
  win1: number;
  syncWhen: number | null;
  armed: boolean;
  onPlace: (when: number) => void;
  onMove: (when: number) => void;
  onClear: () => void;
}

interface StampRow {
  label: string;
  value: string;
  std: boolean;
}

export default function SyncLineOverlay({
  store,
  active,
  win0,
  win1,
  syncWhen,
  armed,
  onPlace,
  onMove,
  onClear,
}: SyncLineOverlayProps) {
  const dragging = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const has = syncWhen != null && Number.isFinite(syncWhen);
  const inWin = has && syncWhen! >= win0 && syncWhen! <= win1;
  const span = Math.max(1e-9, win1 - win0);
  const pct = has ? ((syncWhen! - win0) / span) * 100 : 0;

  const stamps: StampRow[] = useMemo(() => {
    if (!has || syncWhen == null) return [];
    const stdCal = resolveStdCalendar(store.timelines);
    const stdTl = store.timelines.find((t) => t.std);
    const rootEra = stdTl ? eraOf(stdTl) : 'UST';
    const localCal = safeCalendar(active.calendar);
    const localEra = active.std
      ? (active.era?.trim() ? eraOf(active) : 'UST')
      : eraOf(active);

    const out: StampRow[] = [
      {
        label: active.name,
        value: formatLocalStamp(syncWhen, localCal, localEra, true),
        std: false,
      },
      {
        label: 'Universal standard',
        value: active.std
          ? formatStandardStamp(syncWhen, localCal, rootEra)
          : formatStandardStamp(toStandard(active, stdCal, syncWhen), stdCal, rootEra),
        std: true,
      },
    ];

    for (const sp of store.spans) {
      if (sp.timelineId !== active.id || !sp.opensTimelineId) continue;
      const lo = Math.min(sp.startWhen, sp.endWhen);
      const hi = Math.max(sp.startWhen, sp.endWhen);
      if (syncWhen < lo || syncWhen > hi) continue;
      const child = store.timelines.find((t) => t.id === sp.opensTimelineId);
      if (!child) continue;
      const childCal = safeCalendar(child.calendar);
      const r = calendarRatio(child, stdCal) || 1;
      const ep = timelineEpoch(child, stdCal, sp.startWhen);
      const childLocal = (syncWhen - ep) / r;
      out.push({
        label: child.name,
        value: formatLocalStamp(childLocal, childCal, eraOf(child), true),
        std: false,
      });
    }
    return out;
  }, [has, syncWhen, store, active]);

  const placeFromClientX = useCallback(
    (clientX: number, target: HTMLElement) => {
      const r = target.getBoundingClientRect();
      const x = Math.max(0, Math.min(r.width, clientX - r.left));
      const when = win0 + (x / Math.max(1, r.width)) * (win1 - win0);
      onPlace(when);
    },
    [win0, win1, onPlace],
  );

  const onCatchClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    placeFromClientX(e.clientX, e.currentTarget);
  };

  const onHandleDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = true;
    const move = (ev: MouseEvent) => {
      if (!dragging.current || !wrapRef.current) return;
      const r = wrapRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(r.width, ev.clientX - r.left));
      onMove(win0 + (x / Math.max(1, r.width)) * (win1 - win0));
    };
    const up = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div className="tl-sync-layer" data-testid="tl-sync-layer" aria-hidden={!armed && !inWin}>
      {armed && (
        <div
          className="tl-sync-catch"
          data-testid="tl-sync-catch"
          title="Click to drop the sync line"
          onClick={onCatchClick}
        />
      )}
      {inWin && has && (
        <div
          ref={wrapRef}
          className="tl-sync-wrap"
          style={{ left: `${pct}%` }}
          data-testid="tl-sync-line"
        >
          <span className="tl-sync-vline" />
          <div
            className="tl-sync-head"
            onMouseDown={onHandleDown}
            title="Drag to move this sync line"
            data-testid="tl-sync-handle"
          >
            SYNC
            <button
              type="button"
              className="tl-sync-clear"
              title="Clear the sync line"
              aria-label="Clear sync line"
              data-testid="tl-sync-clear"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              ×
            </button>
          </div>
          <div
            className={`tl-sync-stack${pct > 62 ? ' tl-sync-stack--left' : ''}`}
            data-testid="tl-sync-stamps"
          >
            {stamps.map((row) => (
              <div
                key={`${row.label}-${row.std ? 'std' : 'loc'}`}
                className={`tl-sync-chip${row.std ? ' tl-sync-chip--std' : ''}`}
              >
                <span className="tl-sync-chip-label">{row.label}</span>
                <span className="tl-sync-chip-value">{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
