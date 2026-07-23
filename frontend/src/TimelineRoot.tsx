// SKY-3185 — F5: TimelineRoot — single entry point for the Timeline view.
// Beta 4 M23 — Lane rows + Progress/Structure (§8.4): the mode segment grows
// to the prototype's seven modes (`tlModeSeg`, 6559) — Progress · Structure ·
// Plotlines · Spreadsheet · Tension · Relationships · Subway — with Progress
// as the DEFAULT mode. Progress/Structure render the M22/M23 axis lane rows
// straight from the M21 timelines store; Spreadsheet / Relationships / Subway
// keep their legacy surfaces until M24 rebuilds them; Plotlines (Plottr grid)
// reads/writes the M21 store directly (M24, see TimelinePlotlines.tsx);
// Tension (SVG curve) lands with M24 and explains itself until then.
//
// Beta 4 M25 (SKY-6981, §8.6): owns the cross-view TimelineSelection and the
// right panel (Inspector · Brainstorm · Archive) — any click on a timeline
// item surfaces the Inspector tab (§14.5). The Archive Agent auto-build now
// WRITES planned events into timelines.json (`archiveAutoBuild`, replacing
// the ephemeral M23 merge as the axis's source), quick-add plots agent-dated
// events, and the header flag badge + canvas outlines surface the SKY-7379
// TimelineFlag contract. Empty/Loading/Syncing/Error states per the Timeline
// Views design spec §4.
//
// Owns: viewMode, groupBy, the View/Show filter selects (prototype
// tlFilterSel, 6839), the Templates ▾ dropdown + `+ Plotline` (6598–6600),
// the left-panel book-focus cards + plotline visibility toggles (399–417),
// the cross-view selectedIds and the Today jump. viewMode + groupBy persist
// to localStorage; legacy modes ('aeon', 'track', M22's 'axis') migrate.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Story } from './types';
import type {
  TimelinesStore,
  TimelineEra,
  TimelineEvent,
  TimelineRow,
  TimelineSpan,
} from './timelinesTypes';
import TimelinePicker from './TimelinePicker';
import {
  type TimelineGroupBy,
  VALID_TIMELINE_GROUP_BYS,
} from './timelineFilters';
import {
  type TimelineMode,
  type AeonTimelineData,
  EMPTY_AEON_DATA,
  resolveTimelineMode,
  deriveAeonTimeline,
} from './timelineAeon';
import {
  mergePlannedIntoTimeline,
  parsePlanUnits,
  type PlanUnit,
} from './timelinePlanBuild';
import type { InconsistencyItem } from './InconsistencyCard';
import type { TimelineFlag } from './archive/timelineFlags';
import { planNotesFromVault } from './pages/SceneCrafter/crafterState';
import TimelineSpreadsheet from './TimelineSpreadsheet';
import TimelineRelationships from './TimelineRelationships';
import TimelineSubway from './TimelineSubway';
import TimelineTension from './TimelineTension';
import TimelinePlotlines from './TimelinePlotlines';
import { TimelineSubwayTableToggleButton } from './TimelineSubwayTableToggle';
import TimelineSubwayTableView from './TimelineSubwayTableToggle';
import AxisView, { type AxisChapterCell } from './timeline2/AxisView';
import CalendarEditorModal from './timeline2/CalendarEditorModal';
import TimelineRightPanel, { type TimelineRightTab } from './timeline2/panel/TimelineRightPanel';
import type { TimelineSelection, TimelineSelectableType } from './timeline2/panel/selection';
import type { RecentAutoAdd } from './timeline2/panel/ArchiveTab';
import {
  autoBuildSignature,
  planAutoBuild,
  type PlannedSceneInput,
} from './timeline2/archiveAutoBuild';
import {
  heuristicQuickAdd,
  parseAgentQuickAdd,
  quickAddAgentPrompt,
  quickAddEvent,
  quickAddToast,
  type QuickAddContext,
} from './timeline2/panel/quickAdd';
import { deriveAxisDomain } from './timeline2/axis/domain';
import { safeCalendar, safeDecodeWhen, formatWhen, roundWhen } from './timeline2/axis/calendarCodec';
import { chapterWhen, plotCardWhen, sortedBooks } from './timeline2/axis/chapters';
import { laneColor } from './timeline2/axis/palette';
import {
  PLOT_TEMPLATES,
  PLOTLINE_PALETTE,
  TIMELINE_SHOW_FILTERS,
  buildTemplateApplication,
  isMainSpan,
  plotlineRows,
  type PlotTemplate,
  type TimelineShowFilter,
} from './timeline2/axis/storyLanes';
import { useToast } from './hooks/useToast';
import { Toast } from './components/Toast/Toast';
import './TimelineRoot.css';

const STORAGE_KEY_MODE = 'timeline:viewMode';
const STORAGE_KEY_GROUP = 'timeline:groupBy';

/** Prototype seven-mode segment labels (`tlModeSeg`, 6559). */
const MODE_OPTIONS: { value: TimelineMode; label: string }[] = [
  { value: 'progress', label: 'Progress' },
  { value: 'structure', label: 'Structure' },
  { value: 'plot', label: 'Plotlines' },
  { value: 'spreadsheet', label: 'Spreadsheet' },
  { value: 'tension', label: 'Tension' },
  { value: 'relations', label: 'Relationships' },
  { value: 'subway', label: 'Subway' },
];

/** Prototype View filter (tlFilterSel 6839): jumps modes. */
const VIEW_FILTER_OPTIONS = ['Story Structure', 'World Chronology', 'Per Character'] as const;
const VIEW_FILTER_MODE: Readonly<Record<string, TimelineMode>> = {
  'Story Structure': 'structure',
  'World Chronology': 'spreadsheet',
  'Per Character': 'subway',
};

/** M23: cap plan-note reads per load — vaults can hold many plan files. */
const MAX_PLAN_NOTES = 12;

/** M23: collect planned chapter/scene units from the vault's Story Plan
 *  notes (Plans/ folder or Plan… names). Degrades to [] on any failure —
 *  the timeline then renders from written scenes alone. */
async function loadPlanUnits(api: Window['api']): Promise<PlanUnit[]> {
  try {
    if (typeof api.listNotesVault !== 'function' || typeof api.readNotesVault !== 'function') {
      return [];
    }
    const listing = await api.listNotesVault();
    if ('error' in listing) return [];
    const plans = planNotesFromVault(listing.items).slice(0, MAX_PLAN_NOTES);
    const units: PlanUnit[] = [];
    for (const plan of plans) {
      try {
        const res = await api.readNotesVault(`${plan.id}.md`);
        if (!('error' in res)) units.push(...parsePlanUnits(res.content ?? '', plan.id));
      } catch { /* unreadable plan note — skip it */ }
    }
    return units;
  } catch {
    return [];
  }
}

/** M25: open continuity flags project onto the timeline as contradictions
 *  (SKY-7379). Degrades to [] — flags are an affordance, never a gate. */
async function loadOpenContinuityItems(api: Window['api']): Promise<InconsistencyItem[]> {
  try {
    if (typeof api.archiveListContinuity !== 'function') return [];
    const result = await api.archiveListContinuity({ filter: { status: 'open' } });
    return (result.items ?? []) as InconsistencyItem[];
  } catch {
    return [];
  }
}

const GROUP_BY_OPTIONS: { value: TimelineGroupBy; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'arc', label: 'Arc' },
  { value: 'chapter', label: 'Chapter' },
  { value: 'character', label: 'Character' },
  { value: 'location', label: 'Location' },
];

/** Read the persisted view mode; legacy values ('aeon' → progress, 'track' →
 *  subway, 'axis' → progress) migrate, unknown/absent values fall back to
 *  'progress' — the §8.4 DEFAULT mode. */
function readStoredViewMode(): TimelineMode {
  try {
    return resolveTimelineMode(localStorage.getItem(STORAGE_KEY_MODE)) ?? 'progress';
  } catch {
    // localStorage unavailable — use the default
    return 'progress';
  }
}

/** Read the persisted grouping; unknown/absent values fall back to 'none'. */
function readStoredGroupBy(): TimelineGroupBy {
  try {
    const v = localStorage.getItem(STORAGE_KEY_GROUP);
    if (v && (VALID_TIMELINE_GROUP_BYS as readonly string[]).includes(v)) {
      return v as TimelineGroupBy;
    }
  } catch {
    // localStorage unavailable — use the default
  }
  return 'none';
}

function newItemId(prefix: string): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}:${uuid}`;
}

type AnyItem = TimelineEra | TimelineSpan | TimelineEvent;

/** M25: the auto-build slice of one merged plan pass (planned scenes only). */
interface PlannedBuild {
  scenes: PlannedSceneInput[];
  chapterIndexById: Map<string, number>;
}

interface Props {
  story: Story | null;
  onOpenScene?: (sceneId: string) => void;
}

export default function TimelineRoot({ story, onOpenScene }: Props) {
  // Lazy init so localStorage is read once per mount, not on every render.
  const [viewMode, setViewModeState] = useState<TimelineMode>(readStoredViewMode);
  const [groupBy, setGroupByState] = useState<TimelineGroupBy>(readStoredGroupBy);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Bumped by the "Today" jump; the axis view selects/scrolls to "current".
  const [todaySignal, setTodaySignal] = useState(0);

  // ── M23: toolbar filters + plotline visibility + book focus ──
  const [viewFilter, setViewFilter] = useState<string>('Story Structure');
  const [showFilter, setShowFilter] = useState<TimelineShowFilter>('All Events');
  const [hiddenPlotlines, setHiddenPlotlines] = useState<ReadonlySet<string>>(new Set());
  const [bookFocus, setBookFocus] = useState<string | null>(null);
  const [tplOpen, setTplOpen] = useState(false);
  const [renamingPlotline, setRenamingPlotline] = useState<string | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  // ── M21: multi-timeline store ──
  const [timelinesStore, setTimelinesStore] = useState<TimelinesStore | null>(null);
  const [storeLoading, setStoreLoading] = useState(true);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const { toast, showToast, clearToast } = useToast();
  // M25 (§1 principle 7): destructive actions get an inline Undo on the toast.
  const [toastAction, setToastAction] = useState<{ label: string; onClick: () => void } | null>(null);
  const notify = useCallback(
    (message: string, level?: 'info' | 'warn' | 'error') => {
      setToastAction(null);
      showToast(message, level);
    },
    [showToast],
  );

  // ── M25: cross-view selection + right panel ──
  const [tlSelection, setTlSelection] = useState<TimelineSelection | null>(null);
  const [rightTab, setRightTab] = useState<TimelineRightTab>('inspector');
  const [jumpTarget, setJumpTarget] = useState<{ id: string; n: number } | null>(null);
  const jumpSeq = useRef(0);
  const [flags, setFlags] = useState<TimelineFlag[]>([]);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [plannedBuild, setPlannedBuild] = useState<PlannedBuild | null>(null);
  const lastAutoBuildSig = useRef<string | null>(null);
  // Empty-state dismissal: "Start empty" reveals the bare axis for hand-adds.
  const [emptyDismissed, setEmptyDismissed] = useState<ReadonlySet<string>>(new Set());

  // ── Shared Aeon data (relations / subway + the chapters row) ──
  const [aeonData, setAeonData] = useState<AeonTimelineData>(EMPTY_AEON_DATA);
  const [aeonLoading, setAeonLoading] = useState(false);
  const [aeonError, setAeonError] = useState<string | null>(null);
  const [aeonRetry, setAeonRetry] = useState(0);

  const api = window.api;

  // §14.5: ANY selection surfaces the Inspector tab, even when Brainstorm or
  // Archive was open.
  const handleSelectionChange = useCallback((sel: TimelineSelection | null) => {
    setTlSelection(sel);
    if (sel) setRightTab('inspector');
  }, []);

  // Load M21 timelines store on mount (vault-scoped, independent of story).
  useEffect(() => {
    if (typeof api.timelinesGetStore !== 'function') {
      setStoreLoading(false);
      return;
    }
    api.timelinesGetStore().then((res: { store: TimelinesStore }) => {
      setTimelinesStore(res.store);
    }).catch(() => { /* non-fatal: picker hidden */ })
      .finally(() => setStoreLoading(false));
  }, [api]);

  const handleTimelineSelect = useCallback((timelineId: string) => {
    if (typeof api.timelinesSetActive !== 'function') return;
    api.timelinesSetActive(timelineId).then((res: { ok: boolean; store: TimelinesStore }) => {
      if (res.ok) {
        setTimelinesStore(res.store);
        setBookFocus(null);
        setTlSelection(null);
      }
    }).catch(() => {});
  }, [api]);

  // Prototype `tlNewTimeline` (7216): '+ New timeline' creates one right away
  // (no editor modal) and switches to it.
  const handleNewTimeline = useCallback(() => {
    const upsert = api.timelinesUpsert;
    const setActive = api.timelinesSetActive;
    if (typeof upsert !== 'function' || typeof setActive !== 'function') return;
    upsert({ name: 'New Timeline', kind: 'custom' })
      .then((res) => {
        if (!res.ok) return;
        return setActive(res.id).then((activated) => {
          if (activated.ok) setTimelinesStore(activated.store);
          notify('New timeline — add spans, or embed an existing timeline inside it');
        });
      })
      .catch(() => {});
  }, [api, notify]);

  const handleEditCalendar = useCallback(() => {
    setShowCalendarModal(true);
  }, []);

  // M22: persist calendar edits on the active timeline.
  const activeTimeline = timelinesStore?.timelines.find(
    (t) => t.id === timelinesStore.activeTimelineId,
  );
  const handleCalendarChange = useCallback(
    (calendar: { preset: string; monthsPerYear: number; daysPerMonth: number; hoursPerDay: number }, presetLabel?: string) => {
      if (!activeTimeline || typeof api.timelinesUpsert !== 'function') return;
      api.timelinesUpsert({
        id: activeTimeline.id,
        name: activeTimeline.name,
        kind: activeTimeline.kind,
        calendar,
      })
        .then((res) => {
          if (res.ok) setTimelinesStore(res.store);
          if (presetLabel) notify(`Calendar set — ${presetLabel}`);
        })
        .catch(() => {});
    },
    [api, activeTimeline, notify],
  );

  useEffect(() => {
    if (!story) {
      setAeonData(EMPTY_AEON_DATA);
      setAeonError(null);
      setFlags([]);
      setPlannedBuild(null);
      return;
    }
    let cancelled = false;
    setAeonLoading(true);
    setAeonError(null);

    const entityList = api.entityList;
    Promise.all([
      api.timelineGetScenes(story.id),
      api.timelineListArcs(),
      entityList('character').catch(() => ({ entities: [] })),
      entityList('event').catch(() => ({ entities: [] })),
      entityList('concept').catch(() => ({ entities: [] })),
      // M23: vault Story Plans auto-build the timeline (planned-vs-written).
      loadPlanUnits(api),
      // M25: open continuity items → contradiction flags (SKY-7379).
      loadOpenContinuityItems(api),
    ])
      .then(([scenesResp, arcsResp, charsResp, eventsResp, conceptsResp, planUnits, continuityItems]) => {
        if (cancelled) return;
        const toEntity = (e: { id: string; name: string; tags?: string[] }) => ({
          id: e.id,
          name: e.name,
          detail: e.tags?.length ? e.tags.join(', ') : undefined,
        });
        const realScenes = (scenesResp.scenes ?? []).map(s => ({
          id: s.id,
          title: s.title,
          chapterId: s.chapterId ?? '',
          date: s.chronologicalTime?.date ?? '',
          wordCount: s.timelineMetadata?.wordCount ?? null,
          pov: s.timelineMetadata?.pov ?? '',
          mood: s.timelineMetadata?.mood ?? '',
          arcIds: s.entityLinks?.arcs ?? [],
          characterIds: s.entityLinks?.characterIds ?? [],
        }));
        const realChapters = (story.chapters ?? []).map(ch => ({ id: ch.id, title: ch.title }));
        // M23/M25: merge planned units — the Archive Agent auto-build pass.
        // Flags feed the header badge + Archive tab; planned scenes feed the
        // timelines.json write-through below.
        const merged = mergePlannedIntoTimeline(realScenes, realChapters, planUnits, continuityItems);
        setFlags(merged.flags);
        setPlannedBuild({
          scenes: merged.scenes
            .filter((s) => s.id.startsWith('plan:'))
            .map((s) => ({ id: s.id, title: s.title, chapterId: s.chapterId })),
          chapterIndexById: new Map(merged.chapters.map((ch, i) => [ch.id, i])),
        });
        setAeonData(deriveAeonTimeline({
          storyTitle: story.title,
          scenes: merged.scenes,
          chapters: merged.chapters,
          arcs: (arcsResp.arcs ?? []).map(a => ({ id: a.id, title: a.title, color: a.color })),
          characters: (charsResp.entities ?? []).map(toEntity),
          worldEvents: (eventsResp.entities ?? []).map(toEntity),
          concepts: (conceptsResp.entities ?? []).map(toEntity),
        }));
      })
      .catch(err => { if (!cancelled) setAeonError(String(err)); })
      .finally(() => { if (!cancelled) setAeonLoading(false); });

    return () => { cancelled = true; };
  }, [story, api, aeonRetry]);

  const handleViewModeChange = useCallback((mode: TimelineMode) => {
    setViewModeState(mode);
    // Clear the selection on view switch so no stale cross-view state lingers.
    setSelectedIds(new Set());
    setTlSelection(null);
    try { localStorage.setItem(STORAGE_KEY_MODE, mode); } catch { /* ignore quota errors */ }
  }, []);

  const handleGroupByChange = useCallback((g: TimelineGroupBy) => {
    setGroupByState(g);
    try { localStorage.setItem(STORAGE_KEY_GROUP, g); } catch { /* ignore quota errors */ }
  }, []);

  // Prototype View filter: jumps modes (tlFilterSel 6842).
  const handleViewFilterChange = useCallback((v: string) => {
    setViewFilter(v);
    const mode = VIEW_FILTER_MODE[v];
    if (mode) handleViewModeChange(mode);
    notify(`View → ${v}`);
  }, [handleViewModeChange, notify]);

  const handleShowFilterChange = useCallback((v: TimelineShowFilter) => {
    setShowFilter(v);
    notify(`Show → ${v}`);
  }, [notify]);

  // Prototype `tlToday`: the lanes modes jump to Progress; the sheet /
  // relations / subway surfaces keep their mode. The axis view answers the
  // signal by selecting + scrolling to the current position (§8.4 "Today
  // jumps/selects current").
  const handleToday = useCallback(() => {
    setViewModeState(prev => {
      const next: TimelineMode =
        prev === 'spreadsheet' || prev === 'relations' || prev === 'subway' ? prev : 'progress';
      try { localStorage.setItem(STORAGE_KEY_MODE, next); } catch { /* ignore quota errors */ }
      return next;
    });
    setTodaySignal(n => n + 1);
  }, []);

  const isLanesMode = viewMode === 'progress' || viewMode === 'structure';
  const isAeonMode = viewMode === 'relations' || viewMode === 'subway';

  // SKY-7935 — Subway "View as table" toggle: visible only in Subway mode,
  // resets whenever the user leaves Subway so re-entering always starts on
  // the diagram.
  const [subwayTableView, setSubwayTableView] = useState(false);
  useEffect(() => {
    if (viewMode !== 'subway') setSubwayTableView(false);
  }, [viewMode]);

  // ── M23: derived store slices for the toolbar + left panel ──
  const activeId = timelinesStore?.activeTimelineId ?? '';
  const isStoryTimeline = activeTimeline?.kind === 'story';

  const books = useMemo(() => {
    if (!timelinesStore) return [];
    return [...timelinesStore.spans.filter((s) => s.timelineId === activeId && isMainSpan(s))]
      .sort((a, b) => a.startWhen - b.startWhen);
  }, [timelinesStore, activeId]);

  const plotlines = useMemo(
    () => (timelinesStore ? plotlineRows(timelinesStore, activeId) : []),
    [timelinesStore, activeId],
  );

  const cardCountOf = useCallback(
    (plotlineId: string) =>
      timelinesStore ? timelinesStore.events.filter((e) => e.rowId === plotlineId).length : 0,
    [timelinesStore],
  );

  const axisChapters: AxisChapterCell[] = useMemo(
    () =>
      aeonData.chapters.map((ch) => ({
        id: ch.id,
        label: ch.label,
        written: ch.written,
        isHere: ch.isHere,
      })),
    [aeonData.chapters],
  );

  const calendar = safeCalendar(activeTimeline?.calendar);
  const domain = useMemo(
    () => (timelinesStore ? deriveAxisDomain(timelinesStore, activeId, calendar) : ([0, 1] as const)),
    [timelinesStore, activeId, calendar],
  );

  // M25: chapter index → axis `when` (chapters distribute across the books).
  const whenForChapter = useCallback(
    (chapterIndex: number) =>
      roundWhen(
        chapterWhen(chapterIndex + 0.5, Math.max(axisChapters.length, 1), sortedBooks(books), [domain[0], domain[1]]),
      ),
    [axisChapters.length, books, domain],
  );

  // ── M25: Archive Agent auto-build → timelines.json writes (AC7).
  //    Applies the diff once per distinct plan pass (signature-guarded so the
  //    store round-trip can't loop); the Syncing strip shows while it runs.
  useEffect(() => {
    if (!timelinesStore || !plannedBuild || !isStoryTimeline) return;
    if (typeof api.timelinesUpsertItem !== 'function' || typeof api.timelinesDeleteItem !== 'function') return;
    const sig = autoBuildSignature(activeId, plannedBuild.scenes, plannedBuild.chapterIndexById);
    if (sig === lastAutoBuildSig.current) return;
    lastAutoBuildSig.current = sig;
    const plan = planAutoBuild(
      timelinesStore,
      activeId,
      plannedBuild.scenes,
      plannedBuild.chapterIndexById,
      whenForChapter,
    );
    if (plan.upserts.length === 0 && plan.deleteIds.length === 0) return;
    let cancelled = false;
    setAutoSyncing(true);
    (async () => {
      try {
        let latest: TimelinesStore | null = null;
        for (const item of plan.upserts) {
          const res = await api.timelinesUpsertItem!({ type: 'event', item });
          if (res.ok) latest = res.store;
        }
        for (const id of plan.deleteIds) {
          const res = await api.timelinesDeleteItem!({ type: 'event', id });
          if (res.ok) latest = res.store;
        }
        if (latest && !cancelled) setTimelinesStore(latest);
      } catch { /* next plan pass reconciles */ }
      finally { if (!cancelled) setAutoSyncing(false); }
    })();
    return () => { cancelled = true; };
  }, [timelinesStore, plannedBuild, isStoryTimeline, activeId, whenForChapter, api]);

  // ── M25: right-panel item actions (optimistic local + IPC persist). ──
  const mutateLocalItem = useCallback((type: TimelineSelectableType, item: AnyItem) => {
    setTimelinesStore((prev) => {
      if (!prev) return prev;
      const key = ({ era: 'eras', span: 'spans', event: 'events' } as const)[type];
      const list = prev[key] as { id: string }[];
      const idx = list.findIndex((existing) => existing.id === item.id);
      const nextList = idx === -1 ? [...list, item] : list.map((x, i) => (i === idx ? item : x));
      return { ...prev, [key]: nextList };
    });
  }, []);

  const persistTimelineItem = useCallback(
    (type: TimelineSelectableType, item: AnyItem) => {
      if (typeof api.timelinesUpsertItem !== 'function') return;
      api.timelinesUpsertItem({ type, item })
        .then((res) => { if (res.ok) setTimelinesStore(res.store); })
        .catch(() => { /* keep the local copy — next load reconciles */ });
    },
    [api],
  );

  const deleteTimelineItem = useCallback(
    (type: TimelineSelectableType, item: AnyItem, kindLabel: string) => {
      if (typeof api.timelinesDeleteItem !== 'function') return;
      api.timelinesDeleteItem({ type, id: item.id })
        .then((res) => {
          if (!res.ok) return;
          setTimelinesStore(res.store);
          setTlSelection(null);
          // §1 principle 7: deletes are undoable from the toast.
          showToast(`${kindLabel} deleted`);
          setToastAction({
            label: 'Undo',
            onClick: () => {
              setToastAction(null);
              clearToast();
              api.timelinesUpsertItem?.({ type, item })
                .then((restored) => { if (restored.ok) setTimelinesStore(restored.store); })
                .catch(() => {});
            },
          });
        })
        .catch(() => {});
    },
    [api, showToast, clearToast],
  );

  // ── M25: flag jump — select the flagged item and scroll it into view. ──
  const handleJumpTo = useCallback(
    (itemId: string) => {
      if (!isLanesMode) handleViewModeChange('progress');
      const store = timelinesStore;
      if (store) {
        const event = store.events.find((e) => e.id === itemId || e.sceneId === itemId);
        const span = event ? null : store.spans.find((s) => s.id === itemId);
        const era = event || span ? null : store.eras.find((e) => e.id === itemId);
        if (event) handleSelectionChange({ type: 'event', id: event.id });
        else if (span) handleSelectionChange({ type: 'span', id: span.id });
        else if (era) handleSelectionChange({ type: 'era', id: era.id });
      }
      jumpSeq.current += 1;
      setJumpTarget({ id: itemId, n: jumpSeq.current });
    },
    [isLanesMode, handleViewModeChange, timelinesStore, handleSelectionChange],
  );

  const handleFlagResolved = useCallback((flag: TimelineFlag) => {
    setFlags((prev) => prev.filter((f) => f.id !== flag.id));
  }, []);

  // ── M25: Archive quick-add — the agent dates it, heuristics back it up. ──
  const handleQuickAdd = useCallback(
    async (text: string) => {
      if (!timelinesStore || !activeTimeline || typeof api.timelinesUpsertItem !== 'function') return;
      setArchiveBusy(true);
      try {
        const ctx: QuickAddContext = {
          timelineId: activeId,
          calendar,
          domain: [domain[0], domain[1]],
          chapterCount: axisChapters.length,
          whenForChapter,
          newItemId,
        };
        let parse = null;
        if (typeof api.agentArchive === 'function') {
          try {
            const reply = await api.agentArchive(quickAddAgentPrompt(text, calendar));
            parse = parseAgentQuickAdd(reply.text, ctx, text);
          } catch { /* agent offline / capped — heuristics below */ }
        }
        if (!parse) parse = heuristicQuickAdd(text, ctx);
        const event = quickAddEvent(parse, ctx);
        const res = await api.timelinesUpsertItem({ type: 'event', item: event });
        if (res.ok) {
          setTimelinesStore(res.store);
          jumpSeq.current += 1;
          setJumpTarget({ id: event.id, n: jumpSeq.current });
          notify(quickAddToast(parse));
        } else {
          notify(res.error ?? 'Could not add the event', 'error');
        }
      } finally {
        setArchiveBusy(false);
      }
    },
    [timelinesStore, activeTimeline, api, activeId, calendar, domain, axisChapters.length, whenForChapter, notify],
  );

  // RECENTLY AUTO-ADDED: agent-sourced events on the active timeline, newest
  // first (append order), capped per §8.6.
  const recentAutoAdds: RecentAutoAdd[] = useMemo(() => {
    if (!timelinesStore) return [];
    return timelinesStore.events
      .filter((e) => e.timelineId === activeId && e.source === 'agent')
      .slice(-8)
      .reverse()
      .map((e) => ({
        eventId: e.id,
        label: `${e.name} — ${formatWhen(e.when, calendar, domain[0])}`,
      }));
  }, [timelinesStore, activeId, calendar, domain]);

  const handleUndoAutoAdd = useCallback(
    (eventId: string) => {
      if (typeof api.timelinesDeleteItem !== 'function') return;
      const removed = timelinesStore?.events.find((e) => e.id === eventId);
      api.timelinesDeleteItem({ type: 'event', id: eventId })
        .then((res) => {
          if (!res.ok) return;
          setTimelinesStore(res.store);
          setTlSelection((sel) => (sel?.id === eventId ? null : sel));
          notify(`Removed “${removed?.name ?? 'event'}” from the timeline`);
        })
        .catch(() => {});
    },
    [api, timelinesStore, notify],
  );

  // M25: canvas ids carrying a flag (per-item warning outline, design §2).
  const flaggedItemIds = useMemo(
    () => new Set(flags.map((f) => f.affectedItemId)),
    [flags],
  );

  // M25: legacy spreadsheet rows resolve to store events (id or sceneId)
  // so a row click surfaces the Inspector like every other mode (§14.5).
  const handleSheetSelection = useCallback(
    (ids: Set<string>) => {
      setSelectedIds(ids);
      if (ids.size !== 1 || !timelinesStore) return;
      const [only] = [...ids];
      const event = timelinesStore.events.find((e) => e.id === only || e.sceneId === only);
      if (event) handleSelectionChange({ type: 'event', id: event.id });
    },
    [timelinesStore, handleSelectionChange],
  );

  // ── M23: + Plotline / Templates ▾ (prototype 6598–6600) ──
  const persistRow = useCallback(
    (row: TimelineRow, after?: (store: TimelinesStore) => void) => {
      if (typeof api.timelinesUpsertItem !== 'function') return;
      api.timelinesUpsertItem({ type: 'row', item: row })
        .then((res) => {
          if (res.ok) {
            setTimelinesStore(res.store);
            after?.(res.store);
          }
        })
        .catch(() => {});
    },
    [api],
  );

  const handleAddPlotline = useCallback(() => {
    if (!timelinesStore) return;
    const row: TimelineRow = {
      id: newItemId('row'),
      timelineId: activeId,
      name: 'New Plotline',
      kind: 'plotline',
      color: PLOTLINE_PALETTE[plotlines.length % PLOTLINE_PALETTE.length],
    };
    persistRow(row);
    notify('Plotline added — rename it in the left panel (right-click)');
  }, [timelinesStore, activeId, plotlines.length, persistRow, notify]);

  const handleApplyTemplate = useCallback(
    (template: PlotTemplate) => {
      setTplOpen(false);
      if (!timelinesStore || typeof api.timelinesUpsertItem !== 'function') return;
      const bookRanges = sortedBooks(books);
      const chapterCount = axisChapters.length;
      const application = buildTemplateApplication(
        template,
        activeId,
        plotlines.length,
        (ch) => roundWhen(plotCardWhen(ch, chapterCount, bookRanges, [domain[0], domain[1]])),
        newItemId,
      );
      (async () => {
        try {
          let res = await api.timelinesUpsertItem!({ type: 'row', item: application.row });
          if (!res.ok) return;
          for (const card of application.cards) {
            res = await api.timelinesUpsertItem!({ type: 'event', item: card });
            if (!res.ok) return;
          }
          setTimelinesStore(res.store);
          notify(`“${template.name}” laid onto the timeline as a plotline`);
        } catch { /* next load reconciles */ }
      })();
    },
    [timelinesStore, api, activeId, books, axisChapters.length, plotlines.length, domain, notify],
  );

  // Left-panel plotline rows: click toggles visibility; right-click renames
  // inline (the prototype's "rename it in the left panel (right-click)").
  const togglePlotline = useCallback((id: string) => {
    setHiddenPlotlines((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const commitPlotlineRename = useCallback(
    (row: TimelineRow) => {
      const name = renameRef.current?.value.trim();
      setRenamingPlotline(null);
      if (!name || name === row.name) return;
      persistRow({ ...row, name });
    },
    [persistRow],
  );

  // Book-focus cards (prototype tlBooks 5889 / tlOverviewPick 5887).
  const handleBookFocus = useCallback(
    (spanId: string, name: string) => {
      setBookFocus((prev) => {
        const next = prev === spanId ? null : spanId;
        notify(next ? `Focused on ${name}` : 'Showing the whole series');
        return next;
      });
    },
    [notify],
  );

  const handleOverview = useCallback(() => {
    setBookFocus(null);
    notify('Showing the whole series');
  }, [notify]);

  // Esc closes the Templates dropdown (§14 #10: Esc closes the top layer).
  useEffect(() => {
    if (!tplOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setTplOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tplOpen]);

  const showPlotlineTools = isLanesMode || viewMode === 'plot';

  const legend = useMemo(() => {
    if (viewMode !== 'progress') return null;
    return (
      <span className="tlr-legend" data-testid="tl-legend">
        <span className="tlr-legend-item">
          <span className="tlr-legend-swatch tlr-legend-swatch--written" aria-hidden="true" />
          written
        </span>
        <span className="tlr-legend-item">
          <span className="tlr-legend-swatch tlr-legend-swatch--planned" aria-hidden="true" />
          planned from your notes
        </span>
        {aeonData.hereLabel && (
          <span className="tlr-legend-item">
            <span className="tlr-legend-swatch tlr-legend-swatch--here" aria-hidden="true" />
            you are here · {aeonData.hereLabel}
          </span>
        )}
      </span>
    );
  }, [viewMode, aeonData.hereLabel]);

  const yearOf = (when: number) => safeDecodeWhen(when, calendar, 0).year;

  // ── M25 (design §4): shared canvas states for the lanes viewport. ──
  const activeTimelineIsEmpty = useMemo(() => {
    if (!timelinesStore || !activeId) return false;
    return (
      !timelinesStore.eras.some((e) => e.timelineId === activeId) &&
      !timelinesStore.spans.some((s) => s.timelineId === activeId) &&
      !timelinesStore.events.some((e) => e.timelineId === activeId)
    );
  }, [timelinesStore, activeId]);
  const showEmptyState = activeTimelineIsEmpty && !emptyDismissed.has(activeId);

  const handleRunArchiveNow = useCallback(() => {
    // Re-run the plan pass; the auto-build effect writes whatever it finds.
    lastAutoBuildSig.current = null;
    setAeonRetry((n) => n + 1);
    notify('Archive Agent is rebuilding this timeline from your notes…');
  }, [notify]);

  const handleStartEmpty = useCallback(() => {
    setEmptyDismissed((prev) => new Set(prev).add(activeId));
  }, [activeId]);

  return (
    <div className="tlr-root" data-testid="timeline-root">
      {/* ── M21: Timeline picker (left panel top) ── */}
      {timelinesStore && (
        <div className="tlr-picker-wrap" data-testid="tlr-picker-wrap">
          <TimelinePicker
            store={timelinesStore}
            onSelect={handleTimelineSelect}
            onNewTimeline={handleNewTimeline}
            onEditCalendar={handleEditCalendar}
          />
        </div>
      )}

      {/* ── Header: 7-mode segment + legend + filters + Templates + Today ── */}
      <div
        className="tlr-header"
        role="toolbar"
        aria-label="Timeline controls"
        data-testid="timeline-header"
      >
        <span className="tlr-title" title={story ? `Timeline: ${story.title}` : 'Timeline'}>
          Timeline
        </span>

        <div
          className="tlr-seg"
          role="group"
          aria-label="Timeline view mode"
          data-testid="view-mode-toggle"
        >
          {MODE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              className={`tlr-seg-btn${viewMode === opt.value ? ' tlr-seg-btn--active' : ''}`}
              aria-pressed={viewMode === opt.value}
              onClick={() => handleViewModeChange(opt.value)}
              data-testid={`view-mode-${opt.value}`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* SKY-7935 — Subway "View as table" toggle: sits beside the mode-seg,
            visible only in Subway mode (spec §3.3). */}
        {viewMode === 'subway' && (
          <TimelineSubwayTableToggleButton
            pressed={subwayTableView}
            onToggle={() => setSubwayTableView(v => !v)}
          />
        )}

        {legend}

        {/* M25 (design §2): header-level flag badge — reads in every mode,
            absent when there is nothing to flag. Click reviews in Archive. */}
        {flags.length > 0 && (
          <button
            type="button"
            className="tlr-flag-badge"
            onClick={() => setRightTab('archive')}
            title="Archive Agent flags — contradictions, gaps and order skips. Click to review."
            data-testid="tl-flag-badge"
          >
            <span className="tlr-flag-badge-dot" aria-hidden="true" />
            {flags.length} flag{flags.length === 1 ? '' : 's'}
          </button>
        )}

        <div className="tlr-spacer" aria-hidden="true" />

        {/* ── M23: Templates ▾ + `+ Plotline` (prototype 1918–1937) ── */}
        {showPlotlineTools && (
          <>
            <div className="tlr-tpl-anchor">
              <button
                type="button"
                className="tlr-tool-btn tlr-tool-btn--tpl"
                onClick={() => setTplOpen(v => !v)}
                aria-expanded={tplOpen}
                data-testid="tl-templates-btn"
              >
                Templates <span aria-hidden="true">▾</span>
              </button>
              {tplOpen && (
                <>
                  <div
                    className="tlr-tpl-backdrop"
                    onClick={() => setTplOpen(false)}
                    data-testid="tl-templates-backdrop"
                  />
                  <div className="tlr-tpl-menu" data-testid="tl-templates-menu">
                    <div className="tlr-tpl-head">PLOT STRUCTURE TEMPLATES</div>
                    {PLOT_TEMPLATES.map(tpl => (
                      <button
                        type="button"
                        key={tpl.name}
                        className="tlr-tpl-item"
                        onClick={() => handleApplyTemplate(tpl)}
                        data-testid={`tl-template-${tpl.name.replace(/[^a-z]+/gi, '-').toLowerCase()}`}
                      >
                        <span className="tlr-tpl-name">{tpl.name}</span>
                        <span className="tlr-tpl-sub">
                          {tpl.beats.length} beats · lays a new plotline of beat cards
                        </span>
                      </button>
                    ))}
                    <div className="tlr-tpl-foot">Beat cards are dashed — replace them with your scenes</div>
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              className="tlr-tool-btn"
              onClick={handleAddPlotline}
              data-testid="tl-add-plotline"
            >
              + Plotline
            </button>
          </>
        )}

        {/* ── M23: View / Group By / Show filter selects (1938–1945) ── */}
        <div className="tlr-filters" title="Filters">
          <select
            className="tlr-filter-select"
            title="View"
            aria-label="View"
            value={viewFilter}
            onChange={e => handleViewFilterChange(e.target.value)}
            data-testid="tl-view-filter"
          >
            {VIEW_FILTER_OPTIONS.map(o => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <select
            id="tlr-group-select"
            className="tlr-filter-select"
            title="Group By"
            aria-label="Group By"
            value={groupBy}
            onChange={e => handleGroupByChange(e.target.value as TimelineGroupBy)}
            data-testid="groupby-select"
          >
            {GROUP_BY_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            className="tlr-filter-select"
            title="Show"
            aria-label="Show"
            value={showFilter}
            onChange={e => handleShowFilterChange(e.target.value as TimelineShowFilter)}
            data-testid="tl-show-filter"
          >
            {TIMELINE_SHOW_FILTERS.map(o => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className="tlr-today-btn"
          onClick={handleToday}
          data-testid="tl-today-btn"
        >
          Today
        </button>
      </div>

      {/* M22: per-timeline calendar editor (prototype 3738–3772) */}
      {showCalendarModal && activeTimeline && (
        <CalendarEditorModal
          timelineName={activeTimeline.name}
          calendar={activeTimeline.calendar}
          onChange={handleCalendarChange}
          onClose={() => setShowCalendarModal(false)}
        />
      )}

      <div className="tlr-content-row">
        <div className="tlr-body">
          {/* ── M25 (design §4): Error banner — last-known-good stays live. ── */}
          {isLanesMode && aeonError && (
            <div className="tlr-error-banner" role="alert" data-testid="tlr-error-banner">
              <span>Couldn&apos;t reach the Archive Agent — showing the last synced timeline.</span>
              <button
                type="button"
                className="tlr-banner-btn"
                onClick={() => setAeonRetry((n) => n + 1)}
                data-testid="tlr-error-retry"
              >
                Retry
              </button>
            </div>
          )}
          {/* ── M25 (design §4): Syncing strip — never blocks interaction. ── */}
          {isLanesMode && autoSyncing && (
            <div className="tlr-sync-strip" data-testid="tlr-sync-strip">
              <span className="tlr-sync-dot" aria-hidden="true" />
              <span aria-live="polite">
                Archive Agent is syncing this timeline from your manuscript — content stays
                interactive while it works.
              </span>
            </div>
          )}

          {/* ── M23: Progress / Structure — axis lane rows (§8.4) ── */}
          {isLanesMode && storeLoading && (
            <div className="tlr-skeleton" role="status" aria-label="Loading timeline" data-testid="tlr-skeleton">
              <div className="tlr-skeleton-bar" />
              <div className="tlr-skeleton-bar" />
              <div className="tlr-skeleton-bar" />
            </div>
          )}
          {isLanesMode && !storeLoading && timelinesStore && showEmptyState && (
            <div className="tlr-state" data-testid="tlr-empty-state">
              <h2>No events yet</h2>
              <p>
                The Archive Agent builds this timeline from your notes and scenes — or start
                placing spans and events by hand.
              </p>
              <div className="tlr-state-actions">
                <button
                  type="button"
                  className="tlr-state-btn tlr-state-btn--primary"
                  onClick={handleRunArchiveNow}
                  data-testid="tlr-run-archive"
                >
                  Run Archive Agent now
                </button>
                <button
                  type="button"
                  className="tlr-state-btn"
                  onClick={handleStartEmpty}
                  data-testid="tlr-start-empty"
                >
                  Start empty
                </button>
              </div>
            </div>
          )}
          {isLanesMode && !storeLoading && timelinesStore && !showEmptyState && (
            <div className="tlr-lanes-wrap" data-testid="tlr-lanes-wrap">
              {isStoryTimeline && (
                <aside className="tlr-aside" data-testid="tlr-aside" aria-label="Timeline focus">
                  <button
                    type="button"
                    className={`tlr-book-card${bookFocus == null ? ' tlr-book-card--active' : ''}`}
                    onClick={handleOverview}
                    data-testid="tl-overview-card"
                  >
                    <span className="tlr-book-title">Overview</span>
                    <span className="tlr-book-sub">All arcs and key events</span>
                  </button>
                  {books.map((b, i) => (
                    <button
                      type="button"
                      key={b.id}
                      className={`tlr-book-card${bookFocus === b.id ? ' tlr-book-card--active' : ''}`}
                      style={bookFocus === b.id ? { borderColor: b.color ?? laneColor(i) } : undefined}
                      onClick={() => handleBookFocus(b.id, b.name)}
                      title="Focus the timeline on this book — Overview resets"
                      data-testid={`tl-book-card-${b.id}`}
                    >
                      <span className="tlr-book-title">{b.name}</span>
                      <span className="tlr-book-sub">
                        Y{yearOf(b.startWhen)}–Y{yearOf(b.endWhen)}
                      </span>
                    </button>
                  ))}
                  <div className="tlr-aside-head">PLOTLINES</div>
                  {plotlines.length === 0 && (
                    <div className="tlr-aside-hint">+ Plotline in the toolbar adds one</div>
                  )}
                  {plotlines.map((p, i) => {
                    const col = p.color ?? laneColor(i);
                    const off = hiddenPlotlines.has(p.id);
                    return (
                      <div
                        key={p.id}
                        className={`tlr-pl-row${off ? ' tlr-pl-row--off' : ''}`}
                        data-testid={`tl-pl-row-${p.id}`}
                      >
                        {renamingPlotline === p.id ? (
                          <input
                            ref={renameRef}
                            className="tlr-pl-rename"
                            defaultValue={p.name}
                            aria-label="Rename plotline"
                            autoFocus
                            onBlur={() => commitPlotlineRename(p)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitPlotlineRename(p);
                              if (e.key === 'Escape') setRenamingPlotline(null);
                            }}
                            data-testid={`tl-pl-rename-${p.id}`}
                          />
                        ) : (
                          <button
                            type="button"
                            className="tlr-pl-btn"
                            onClick={() => togglePlotline(p.id)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setRenamingPlotline(p.id);
                            }}
                            title="Click to show / hide this plotline · right-click to rename"
                            data-testid={`tl-pl-toggle-${p.id}`}
                          >
                            <span
                              className="tlr-pl-dot"
                              style={{ background: col, boxShadow: `0 0 8px ${col}` }}
                            />
                            <span className="tlr-pl-name">{p.name}</span>
                            <span className="tlr-pl-count">{cardCountOf(p.id)}</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </aside>
              )}
              <AxisView
                store={timelinesStore}
                onStoreChange={setTimelinesStore}
                mode={viewMode as 'progress' | 'structure'}
                chapters={axisChapters}
                hiddenPlotlines={hiddenPlotlines}
                bookFocus={bookFocus}
                showFilter={showFilter}
                todaySignal={todaySignal}
                selection={tlSelection}
                onSelectionChange={handleSelectionChange}
                flaggedItemIds={flaggedItemIds}
                jumpTarget={jumpTarget}
              />
            </div>
          )}
          {isLanesMode && !storeLoading && !timelinesStore && (
            <div className="tlr-state" data-testid="tlr-lanes-unavailable">
              <h2>Timeline store unavailable.</h2>
            </div>
          )}

          {/* ── M24: Plotlines (Plottr grid, §8.5) — reads/writes timelines.json ── */}
          {viewMode === 'plot' && timelinesStore && (
            <TimelinePlotlines
              store={timelinesStore}
              onStoreChange={setTimelinesStore}
              chapters={axisChapters}
            />
          )}
          {viewMode === 'plot' && !timelinesStore && (
            <div className="tlr-state" data-testid="tlr-plot-unavailable">
              <h2>Timeline store unavailable.</h2>
            </div>
          )}

          {/* ── M24: Tension (SVG curve, §8.5) — reads/writes timelines.json ── */}
          {viewMode === 'tension' && timelinesStore && (
            <TimelineTension
              store={timelinesStore}
              onStoreChange={setTimelinesStore}
              chapters={axisChapters}
            />
          )}
          {viewMode === 'tension' && !timelinesStore && (
            <div className="tlr-state" data-testid="tlr-tension-unavailable">
              <h2>Timeline store unavailable.</h2>
            </div>
          )}

          {viewMode === 'spreadsheet' && (
            <TimelineSpreadsheet
              store={timelinesStore}
              selectedIds={selectedIds}
              onSelectionChange={handleSheetSelection}
              groupBy={groupBy}
              onGroupByChange={handleGroupByChange}
            />
          )}

          {isAeonMode && !story && (
            <div className="tlr-state" data-testid="tlr-no-story">
              <h2>Select a story to view its timeline.</h2>
            </div>
          )}
          {isAeonMode && story && aeonLoading && (
            <div className="tlr-state" role="status" aria-label="Loading timeline">
              <p>Loading timeline…</p>
            </div>
          )}
          {isAeonMode && story && !aeonLoading && aeonError && (
            <div className="tlr-state" role="alert">
              <h2>Timeline unavailable</h2>
              <p className="tlr-state-error">{aeonError}</p>
            </div>
          )}

          {isAeonMode && story && !aeonLoading && !aeonError && (
            <>
              {viewMode === 'relations' && (
                <TimelineRelationships data={aeonData} onOpenScene={onOpenScene} />
              )}
              {viewMode === 'subway' && (
                subwayTableView ? (
                  <TimelineSubwayTableView data={aeonData} onOpenScene={onOpenScene} />
                ) : (
                  <TimelineSubway data={aeonData} onOpenScene={onOpenScene} />
                )
              )}
            </>
          )}
        </div>

        {/* ── M25: right panel — Inspector · Brainstorm · Archive (§8.6) ── */}
        {timelinesStore && activeTimeline && (
          <TimelineRightPanel
            store={timelinesStore}
            activeTimeline={activeTimeline}
            selection={tlSelection}
            onSelectionChange={handleSelectionChange}
            tab={rightTab}
            onTabChange={setRightTab}
            chapterLabels={axisChapters.map((ch) => ch.label)}
            whenForChapter={whenForChapter}
            onLocalMutate={mutateLocalItem}
            onPersist={persistTimelineItem}
            onDelete={deleteTimelineItem}
            onCalendarChange={handleCalendarChange}
            showToast={notify}
            onJumpTo={handleJumpTo}
            flags={flags}
            recentAutoAdds={recentAutoAdds}
            onQuickAdd={handleQuickAdd}
            onUndoAutoAdd={handleUndoAutoAdd}
            onFlagResolved={handleFlagResolved}
            archiveBusy={archiveBusy}
          />
        )}
      </div>

      <Toast message={toast?.message ?? null} level={toast?.level} action={toastAction ?? undefined} />
    </div>
  );
}
