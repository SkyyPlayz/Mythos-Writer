// Beta 4 M25 — Timeline right panel (§8.6): tabs Inspector · Brainstorm ·
// Archive. Any click on a timeline item selects into the Inspector tab
// (§14.5) — TimelineRoot owns the selection and forces this tab open on
// select. This panel hosts the exact-time picker and calendar editor modals
// for the Inspector's editors (absorbing AxisView's M22 mini inspector).
import { useState } from 'react';
import type {
  TimelineDefinition,
  TimelineEra,
  TimelineEvent,
  TimelineSpan,
  TimelinesStore,
} from '../../timelinesTypes';
import type { TimelineFlag } from '../../archive/timelineFlags';
import { resolveInspectorTarget, type TimelineSelection, type TimelineSelectableType } from './selection';
import { roundWhen, safeCalendar } from '../axis/calendarCodec';
import { deriveAxisDomain } from '../axis/domain';
import { plotlineRows } from '../axis/storyLanes';
import ExactTimeModal from '../ExactTimeModal';
import CalendarEditorModal from '../CalendarEditorModal';
import InspectorTab from './InspectorTab';
import BrainstormTab from './BrainstormTab';
import ArchiveTab, { type RecentAutoAdd } from './ArchiveTab';
import './TimelineRightPanel.css';

export type TimelineRightTab = 'inspector' | 'brainstorm' | 'archive';

type AnyItem = TimelineEra | TimelineSpan | TimelineEvent;

const TABS: { value: TimelineRightTab; label: string }[] = [
  { value: 'inspector', label: 'Inspector' },
  { value: 'brainstorm', label: 'Brainstorm' },
  { value: 'archive', label: 'Archive' },
];

export interface TimelineRightPanelProps {
  store: TimelinesStore;
  activeTimeline: TimelineDefinition;
  selection: TimelineSelection | null;
  onSelectionChange: (selection: TimelineSelection | null) => void;
  tab: TimelineRightTab;
  onTabChange: (tab: TimelineRightTab) => void;
  /** Ordered chapter labels (scene-card CHAPTER select). */
  chapterLabels: string[];
  /** Re-plot a card onto a chapter's date (0-based index). */
  whenForChapter: (chapterIndex: number) => number;
  onLocalMutate: (type: TimelineSelectableType, item: AnyItem) => void;
  onPersist: (type: TimelineSelectableType, item: AnyItem) => void;
  onDelete: (type: TimelineSelectableType, item: AnyItem, kindLabel: string) => void;
  onCalendarChange: (
    calendar: { preset: string; monthsPerYear: number; daysPerMonth: number; hoursPerDay: number },
    presetLabel?: string,
  ) => void;
  showToast: (message: string, level?: 'info' | 'warn' | 'error') => void;
  // ── Brainstorm tab ──
  /** Jump to a NEEDS-FILLING-OUT / flag target on the canvas. */
  onJumpTo: (itemId: string) => void;
  // ── Archive tab ──
  flags: TimelineFlag[];
  recentAutoAdds: RecentAutoAdd[];
  onQuickAdd: (text: string) => Promise<void>;
  onUndoAutoAdd: (eventId: string) => void;
  onFlagResolved: (flag: TimelineFlag) => void;
  archiveBusy: boolean;
}

export default function TimelineRightPanel(props: TimelineRightPanelProps) {
  const {
    store,
    activeTimeline,
    selection,
    onSelectionChange,
    tab,
    onTabChange,
    onCalendarChange,
  } = props;

  const [exactTimeOpen, setExactTimeOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const calendar = safeCalendar(activeTimeline.calendar);
  const target = resolveInspectorTarget(store, selection);
  const [t0] = deriveAxisDomain(store, activeTimeline.id, calendar);
  const plotlines = plotlineRows(store, activeTimeline.id);

  const applyExactTime = (result: { when?: number; startWhen?: number; endWhen?: number }) => {
    if (!target) return;
    if (target.type === 'event' && result.when != null) {
      const next = { ...(target.item as TimelineEvent), when: result.when };
      props.onLocalMutate('event', next);
      props.onPersist('event', next);
    } else if (target.type !== 'event' && result.startWhen != null && result.endWhen != null) {
      // The store rejects end ≤ start — keep at least one tick apart.
      const endWhen =
        result.endWhen > result.startWhen ? result.endWhen : roundWhen(result.startWhen + 0.1);
      const next = {
        ...(target.item as TimelineEra | TimelineSpan),
        startWhen: result.startWhen,
        endWhen,
      };
      props.onLocalMutate(target.type, next);
      props.onPersist(target.type, next);
    }
    setExactTimeOpen(false);
    props.showToast('Exact time set — replotted on the axis');
  };

  return (
    <aside className="trp-root" aria-label="Timeline panel" data-testid="timeline-right-panel">
      <div className="trp-tabs" role="tablist" aria-label="Timeline panel tabs">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={tab === t.value}
            className={`trp-tab${tab === t.value ? ' trp-tab--active' : ''}`}
            onClick={() => onTabChange(t.value)}
            data-testid={`trp-tab-${t.value}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="trp-body" role="tabpanel">
        {tab === 'inspector' && (
          <InspectorTab
            target={target}
            calendar={calendar}
            fallbackWhen={t0}
            timelines={store.timelines}
            activeTimelineId={activeTimeline.id}
            plotlines={plotlines}
            chapterLabels={props.chapterLabels}
            whenForChapter={props.whenForChapter}
            onLocalMutate={props.onLocalMutate}
            onPersist={props.onPersist}
            onDelete={props.onDelete}
            onOpenExactTime={() => setExactTimeOpen(true)}
            onClose={() => onSelectionChange(null)}
          />
        )}
        {tab === 'brainstorm' && (
          <BrainstormTab store={store} activeTimelineId={activeTimeline.id} onJumpTo={props.onJumpTo} showToast={props.showToast} />
        )}
        {tab === 'archive' && (
          <ArchiveTab
            flags={props.flags}
            recentAutoAdds={props.recentAutoAdds}
            onQuickAdd={props.onQuickAdd}
            onUndoAutoAdd={props.onUndoAutoAdd}
            onFlagResolved={props.onFlagResolved}
            onJumpTo={props.onJumpTo}
            busy={props.archiveBusy}
            showToast={props.showToast}
          />
        )}
      </div>

      {exactTimeOpen && target && (
        <ExactTimeModal
          calendar={calendar}
          target={
            target.type === 'event'
              ? { kind: 'single', when: (target.item as TimelineEvent).when }
              : {
                  kind: 'dual',
                  startWhen: (target.item as TimelineEra | TimelineSpan).startWhen,
                  endWhen: (target.item as TimelineEra | TimelineSpan).endWhen,
                }
          }
          fallbackWhen={t0}
          onApply={applyExactTime}
          onClose={() => setExactTimeOpen(false)}
          onEditCalendar={() => setCalendarOpen(true)}
        />
      )}

      {calendarOpen && (
        <CalendarEditorModal
          timelineName={activeTimeline.name}
          calendar={calendar}
          onChange={onCalendarChange}
          onClose={() => setCalendarOpen(false)}
        />
      )}
    </aside>
  );
}
