// Beta 4 M25 — Timeline right panel (§8.6).
// Slice E / 03 v2.4.1: tabs are **Inspector · <partner name>** only.
// Separate Archivist tab is gone; Idea Board lives under Boards (not Timeline).
import { useState } from 'react';
import type { Story } from '../../types';
import type {
  TimelineDefinition,
  TimelineEra,
  TimelineEvent,
  TimelineSpan,
  TimelinesStore,
} from '../../timelinesTypes';
import { PARTNER_ACTIONS, type PartnerActionId } from '../../agents/partnerIdentity';
import { runPartnerAction } from '../../AgentHubPanel';
import type { TimelineFlag } from '../../archive/timelineFlags';
import { resolveInspectorTarget, type TimelineSelection, type TimelineSelectableType } from './selection';
import { roundWhen, safeCalendar } from '../axis/calendarCodec';
import { deriveAxisDomain } from '../axis/domain';
import { plotlineRows } from '../axis/storyLanes';
import ExactTimeModal from '../ExactTimeModal';
import CalendarEditorModal from '../CalendarEditorModal';
import InspectorTab from './InspectorTab';
import type { RecentAutoAdd } from './ArchiveTab';
import { useMiniAgentChat } from './useMiniAgentChat';
import MiniAgentChat from './MiniAgentChat';
import { invokeBrainstorm } from './BrainstormTab';
import { DEFAULT_PARTNER_DISPLAY_NAME, PARTNER_SESSION_AGENT } from '../../agents/partnerIdentity';
import './TimelineRightPanel.css';

export type TimelineRightTab = 'inspector' | 'partner';

type AnyItem = TimelineEra | TimelineSpan | TimelineEvent;

export interface TimelineRightPanelProps {
  /** SKY-7956: panel width in px, clamped by the caller to the prototype's 250-430 range. */
  width: number;
  store: TimelinesStore;
  activeTimeline: TimelineDefinition;
  selection: TimelineSelection | null;
  onSelectionChange: (selection: TimelineSelection | null) => void;
  tab: TimelineRightTab;
  onTabChange: (tab: TimelineRightTab) => void;
  /** Slice E — Writing partner display name for the partner tab label. */
  partnerName?: string;
  /** F3 / PLAN-058 L4 (FD-3) — partner action chips (Update Timeline, etc.). */
  story?: Story | null;
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
  /** Jump to a NEEDS-FILLING-OUT / flag target on the canvas. */
  onJumpTo: (itemId: string) => void;
  // ── Archive hand (lives inside partner; no separate Archivist tab) ──
  flags: TimelineFlag[];
  recentAutoAdds: RecentAutoAdd[];
  onQuickAdd: (text: string) => Promise<void>;
  onUndoAutoAdd: (eventId: string) => void;
  onFlagResolved: (flag: TimelineFlag) => void;
  archiveBusy: boolean;
  /** SKY-10876 M12.B4b: "Rebuild my timeline" command (manuscript-driven). */
  onRebuildTimeline?: () => void;
  /** SKY-10876: true only while the rebuild (not the quick-add) is in flight. */
  rebuilding?: boolean;
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
    partnerName = DEFAULT_PARTNER_DISPLAY_NAME,
  } = props;

  const tabs: { value: TimelineRightTab; label: string }[] = [
    { value: 'inspector', label: 'Inspector' },
    { value: 'partner', label: partnerName },
  ];

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
    <aside
      className="trp-root"
      style={{ width: props.width }}
      aria-label="Timeline panel"
      data-testid="timeline-right-panel"
    >
      <div className="trp-tabs" role="tablist" aria-label="Timeline panel tabs">
        {tabs.map((t) => (
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
        {tab === 'partner' && (
          <PartnerTimelineChat
            partnerName={partnerName}
            story={props.story ?? null}
            flags={props.flags}
            onJumpTo={props.onJumpTo}
            onRebuildTimeline={props.onRebuildTimeline}
            rebuilding={props.rebuilding}
            archiveBusy={props.archiveBusy}
            showControls={true}
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

/** F3#7 — unified agent chat + timeline controls button (no Archivist tab). */
function PartnerTimelineChat({
  partnerName,
  story,
  flags,
  onJumpTo,
  onRebuildTimeline,
  rebuilding,
  archiveBusy,
}: {
  partnerName: string;
  story: Story | null;
  flags: TimelineFlag[];
  onJumpTo: (itemId: string) => void;
  onRebuildTimeline?: () => void;
  rebuilding?: boolean;
  archiveBusy: boolean;
  showControls?: boolean;
}) {
  const chat = useMiniAgentChat(PARTNER_SESSION_AGENT, invokeBrainstorm);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [runningAction, setRunningAction] = useState<PartnerActionId | null>(null);

  const runAction = async (action: PartnerActionId) => {
    if (runningAction) return;
    const meta = PARTNER_ACTIONS.find((a) => a.id === action);
    if (!meta) return;
    setRunningAction(action);
    try {
      const result = await runPartnerAction(action, { scene: null, story });
      await chat.postActionResult(meta.label, result.text, {
        cardTitle: result.cardTitle,
        cardFoot: result.cardFoot,
        cardKind: result.cardTitle ? 'action' : undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await chat.postActionResult(meta.label, msg || 'Action failed.');
    } finally {
      setRunningAction(null);
    }
  };

  return (
    <div className="trp-partner-hand" data-testid="trp-partner-panel">
      <div className="trp-partner-actions" role="group" aria-label="Partner actions">
        {PARTNER_ACTIONS.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`trp-partner-action${runningAction === a.id ? ' trp-partner-action--busy' : ''}`}
            style={{ '--hand-color': a.color } as React.CSSProperties}
            data-testid={`trp-partner-action-${a.id}`}
            title={a.description}
            disabled={runningAction !== null}
            onClick={() => { void runAction(a.id); }}
          >
            {runningAction === a.id ? `${a.label}…` : a.label}
          </button>
        ))}
      </div>
      <MiniAgentChat
        chat={chat}
        accent="brainstorm"
        partnerName={partnerName}
        placeholder={`Message ${partnerName}…`}
        testidPrefix="trp-partner"
      />
      <button
        type="button"
        className="trp-rebuild"
        data-testid="trp-timeline-controls"
        aria-expanded={controlsOpen}
        onClick={() => setControlsOpen((o) => !o)}
      >
        {controlsOpen ? 'Hide timeline controls' : 'Timeline controls'}
      </button>
      {controlsOpen && (
        <div className="trp-partner-controls" data-testid="trp-partner-controls">
          {flags.length > 0 && (
            <div className="trp-partner-flags" data-testid="trp-partner-flags">
              <div className="trp-section-label">FLAGS</div>
              {flags.slice(0, 8).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="trp-flag-row"
                  onClick={() => onJumpTo(f.affectedItemId || f.id)}
                  data-testid={`trp-flag-${f.id}`}
                >
                  {f.description || f.anchor || f.id}
                </button>
              ))}
            </div>
          )}
          {onRebuildTimeline && (
            <button
              type="button"
              className="trp-rebuild"
              onClick={onRebuildTimeline}
              disabled={rebuilding || archiveBusy}
              data-testid="trp-rebuild"
            >
              {rebuilding ? 'Rebuilding…' : 'Rebuild my timeline'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
