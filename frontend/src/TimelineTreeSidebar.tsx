// F3#6 — One hierarchical timeline tree (Universal → children) with dropdowns.
// Replaces the flat TimelinePicker dropdown + the second story-only navigator.
import { useState, useMemo, useCallback } from 'react';
import { ChevronRight, Plus, Settings2, BarChart2, Globe, Star, LayoutList } from 'lucide-react';
import type { TimelinesStore, TimelineDefinition, TimelineKind, TimelineSpan } from './timelinesTypes';
import './TimelinePicker.css';

const KIND_ICONS: Record<TimelineKind, React.ReactNode> = {
  story: <BarChart2 size={12} aria-hidden="true" />,
  world: <Globe size={12} aria-hidden="true" />,
  universe: <Star size={12} aria-hidden="true" />,
  custom: <LayoutList size={12} aria-hidden="true" />,
};

const KIND_LABELS: Record<TimelineKind, string> = {
  story: 'Story',
  world: 'World',
  universe: 'Universe',
  custom: 'Custom',
};

export interface TimelineTreeNode {
  timeline: TimelineDefinition;
  depth: number;
  childIds: string[];
}

/** Expand-aware hierarchical rows (parent via span.opensTimelineId). */
export function buildTimelineTreeRows(
  store: TimelinesStore,
  open: Record<string, boolean>,
): TimelineTreeNode[] {
  const byId = new Map(store.timelines.map((t) => [t.id, t]));
  const kids = new Map<string, string[]>();
  const isChild = new Set<string>();

  for (const span of store.spans ?? []) {
    const openId = (span as TimelineSpan).opensTimelineId;
    if (!openId || !byId.has(openId) || !byId.has(span.timelineId)) continue;
    const list = kids.get(span.timelineId) ?? [];
    if (!list.includes(openId)) list.push(openId);
    kids.set(span.timelineId, list);
    isChild.add(openId);
  }

  const roots = store.timelines
    .filter((t) => !isChild.has(t.id))
    .sort((a, b) => {
      const score = (t: TimelineDefinition) => (t.std ? 0 : t.kind === 'universe' ? 1 : 2);
      return score(a) - score(b) || a.name.localeCompare(b.name);
    });

  const rows: TimelineTreeNode[] = [];
  const emit = (id: string, depth: number) => {
    const t = byId.get(id);
    if (!t) return;
    const childIds = kids.get(id) ?? [];
    rows.push({ timeline: t, depth, childIds });
    if (childIds.length > 0 && open[id] !== false) {
      for (const c of childIds) emit(c, depth + 1);
    }
  };
  for (const r of roots) emit(r.id, 0);

  if (rows.length === 0) {
    return store.timelines.map((timeline) => ({ timeline, depth: 0, childIds: [] as string[] }));
  }
  return rows;
}

export interface TimelineTreeSidebarProps {
  store: TimelinesStore;
  onSelect: (timelineId: string) => void;
  onNewTimeline: () => void;
  /** Opens the calendar editor for the given timeline (right-click row) or active timeline (footer). */
  onEditCalendar: (timelineId: string) => void;
  /** Optional story-focus section (books / plotlines) — same sidebar, not a second one. */
  focusSection?: React.ReactNode;
}

export default function TimelineTreeSidebar({
  store,
  onSelect,
  onNewTimeline,
  onEditCalendar,
  focusSection,
}: TimelineTreeSidebarProps) {
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});

  const effectiveOpen = useMemo(() => {
    const base: Record<string, boolean> = { ...openMap };
    // Seed-expand: any parent not yet toggled defaults to open.
    const kids = new Map<string, string[]>();
    for (const span of store.spans ?? []) {
      const openId = span.opensTimelineId;
      if (!openId) continue;
      const list = kids.get(span.timelineId) ?? [];
      if (!list.includes(openId)) list.push(openId);
      kids.set(span.timelineId, list);
    }
    for (const [id, list] of kids) {
      if (list.length > 0 && base[id] === undefined) base[id] = true;
    }
    return base;
  }, [store, openMap]);

  const rows = useMemo(
    () => buildTimelineTreeRows(store, effectiveOpen),
    [store, effectiveOpen],
  );

  const toggle = useCallback((id: string) => {
    setOpenMap((prev) => {
      const currentlyOpen = prev[id] !== false; // undefined defaults to open
      return { ...prev, [id]: !currentlyOpen };
    });
  }, []);

  const active = store.timelines.find((t) => t.id === store.activeTimelineId);

  return (
    <aside className="tlpicker tlpicker--tree" data-testid="timeline-picker" aria-label="Timelines">
      {/* Probe #17/#19 order: Navigator → tree → New → Overview/Plotlines → Edit calendar */}
      <div className="tlpicker__tree-head" data-testid="tl-navigator-head">
        TIMELINE NAVIGATOR
      </div>
      <div className="tlpicker__tree" role="tree" aria-label="Timeline hierarchy" data-testid="tl-tree">
        {rows.map((row) => {
          const t = row.timeline;
          const on = t.id === store.activeTimelineId;
          const hasKids = row.childIds.length > 0;
          const expanded = effectiveOpen[t.id] !== false;
          const isRoot = row.depth === 0 && (Boolean(t.std) || t.kind === 'universe');
          return (
            <div
              key={t.id}
              className={`tlpicker__tree-row${on ? ' tlpicker__tree-row--active' : ''}`}
              style={{ paddingLeft: 6 + row.depth * 13 }}
              role="treeitem"
              aria-selected={on}
              aria-expanded={hasKids ? expanded : undefined}
              data-testid={`timeline-option-${t.id}`}
            >
              <button
                type="button"
                className="tlpicker__tree-twirl"
                aria-label={hasKids ? (expanded ? 'Collapse' : 'Expand') : undefined}
                disabled={!hasKids}
                onClick={(e) => { e.stopPropagation(); if (hasKids) toggle(t.id); }}
                data-testid={`tl-tree-toggle-${t.id}`}
              >
                {hasKids ? (
                  <ChevronRight
                    size={12}
                    className={`tlpicker__chevron${expanded ? ' tlpicker__chevron--open' : ''}`}
                    aria-hidden="true"
                  />
                ) : (
                  <span className="tlpicker__tree-twirl-spacer" />
                )}
              </button>
              <button
                type="button"
                className="tlpicker__tree-pick"
                onClick={() => onSelect(t.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onEditCalendar(t.id);
                }}
                title={isRoot ? 'Standard for everything inside it' : `Open ${t.name} · right-click to edit calendar`}
              >
                <span className="tlpicker__item-icon" aria-hidden="true">{KIND_ICONS[t.kind]}</span>
                <span className="tlpicker__tree-name">{t.name}</span>
                <span className="tlpicker__tree-kind">{KIND_LABELS[t.kind]}</span>
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="tlpicker__new-dashed"
        onClick={onNewTimeline}
        data-testid="timeline-new"
      >
        <Plus size={13} aria-hidden="true" />
        <span>+ New</span>
      </button>

      {focusSection}

      <button
        type="button"
        className="tlpicker__action tlpicker__edit-calendar"
        onClick={() => active && onEditCalendar(active.id)}
        data-testid="timeline-edit-calendar"
      >
        <Settings2 size={13} aria-hidden="true" />
        <span>Edit calendar{active ? '…' : '…'}</span>
      </button>
    </aside>
  );
}
