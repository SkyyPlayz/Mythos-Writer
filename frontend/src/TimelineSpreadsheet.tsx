import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { BookOpen, FileText } from 'lucide-react';
import type { Story, TimelineAIProposal } from './types';
import './TimelineSpreadsheet.css';
import TimelineFilterBar, { type ArcOption, type CharOption, type LocationOption } from './TimelineFilterBar';
import './TimelineFilterBar.css';
import TimelineDetailCard, {
  TimelineSceneContextMenu,
  type TimelineSceneAction,
} from './TimelineDetailCard';
import {
  DEFAULT_FILTERS,
  type TimelineFilters,
  chronologicalSceneIds,
  isSceneHidden,
  sceneOpacity,
  stepFocusedScene,
} from './timelineFilters';
// ─── Display types ───

export interface SpreadsheetScene {
  id: string;
  title: string;
  chapterId: string;
  date: string;
  pov: string;
  arcIds: string[];
  characterIds: string[];
  wordCount: number | null;
  mood: string;
  locationId: string;
}

type ArcMeta = ArcOption;
type CharMeta = CharOption;

export type ColKey = 'date' | 'pov' | 'arc' | 'wordCount' | 'mood' | 'location';
export type SortCol = 'date' | 'pov' | 'arc';
export type GroupBy = 'none' | 'arc' | 'character';

/** Sentinel returned by {@link parseWordCount} when the raw input is not a valid
 *  non-negative integer and must be rejected (no-op) rather than persisted. */
export const WORD_COUNT_INVALID = Symbol('word-count-invalid');

/**
 * Validate a Words-cell string before it is persisted as `wordCount`.
 *
 * SKY-5146 / GH#627: the previous `parseInt(value, 10)` silently accepted
 * partial-numeric text ("12abc" → 12, "5.7" → 5, "5 words" → 5), saving a wrong
 * count. This accepts ONLY a fully-valid non-negative integer string, treats an
 * empty cell as an intentional clear, and rejects everything else (partial
 * numeric, decimals, signs, whitespace).
 *
 * @returns the integer when valid, `undefined` when the field was cleared, or
 *   {@link WORD_COUNT_INVALID} when the input must be rejected.
 */
export function parseWordCount(raw: string): number | undefined | typeof WORD_COUNT_INVALID {
  if (raw === '') return undefined; // empty cell → clear the count
  if (!/^\d+$/.test(raw)) return WORD_COUNT_INVALID; // "12abc" / "5.7" / "-3" / " " → reject
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : WORD_COUNT_INVALID;
}

export interface SceneGroup {
  key: string;
  label: string;
  color?: string;
  scenes: SpreadsheetScene[];
}

// ─── Pure helpers (exported for tests) ───

export function sortScenes(
  scenes: SpreadsheetScene[],
  by: SortCol,
  dir: 'asc' | 'desc',
): SpreadsheetScene[] {
  return [...scenes].sort((a, b) => {
    let cmp = 0;
    if (by === 'date') {
      cmp = a.date.localeCompare(b.date);
    } else if (by === 'pov') {
      cmp = a.pov.localeCompare(b.pov);
    } else if (by === 'arc') {
      cmp = (a.arcIds[0] ?? '').localeCompare(b.arcIds[0] ?? '');
    }
    return dir === 'asc' ? cmp : -cmp;
  });
}

export function groupScenes(
  scenes: SpreadsheetScene[],
  by: 'arc' | 'character',
  arcs: ArcMeta[],
  chars: CharMeta[],
): SceneGroup[] {
  const arcMap = new Map(arcs.map(a => [a.id, a]));
  const charMap = new Map(chars.map(c => [c.id, c]));
  const groups = new Map<string, SceneGroup>();

  function ensure(key: string, label: string, color?: string) {
    if (!groups.has(key)) {
      groups.set(key, { key, label, color, scenes: [] });
    }
  }

  for (const scene of scenes) {
    if (by === 'arc') {
      const keys = scene.arcIds.length ? scene.arcIds : ['__unassigned__'];
      for (const key of keys) {
        const arc = arcMap.get(key);
        ensure(
          key,
          key === '__unassigned__' ? 'No Arc' : (arc?.title ?? key),
          arc?.color,
        );
        groups.get(key)!.scenes.push(scene);
      }
    } else {
      const key = scene.characterIds.length ? scene.characterIds[0] : '__unassigned__';
      const char = charMap.get(key);
      ensure(key, key === '__unassigned__' ? 'No Character' : (char?.name ?? key));
      groups.get(key)!.scenes.push(scene);
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (a.key === '__unassigned__') return 1;
    if (b.key === '__unassigned__') return -1;
    return a.label.localeCompare(b.label);
  });
}

// ─── SKY-796: proposal index ───

/**
 * Map (sceneId → column key → proposal[]). Date, mood, and characters/POV are
 * the only cells the engine can suggest values for; render badges next to
 * those columns and keep the popover anchored to the cell that owns it.
 */
export type ProposalsBySceneAndCol = Map<string, Partial<Record<ColKey, TimelineAIProposal[]>>>;

export function indexProposals(proposals: TimelineAIProposal[]): ProposalsBySceneAndCol {
  const out: ProposalsBySceneAndCol = new Map();
  for (const p of proposals) {
    if (p.status !== 'pending') continue;
    const col: ColKey | null =
      p.kind === 'date' ? 'date' :
      p.kind === 'mood' ? 'mood' :
      p.kind === 'characters'
        ? p.value.startsWith('pov:') ? 'pov' : 'pov' // characters proposals attach to POV cell — characters value rolls up there
        : null;
    if (!col) continue;
    const bySceneCol = out.get(p.sceneId) ?? {};
    const arr = bySceneCol[col] ?? [];
    arr.push(p);
    bySceneCol[col] = arr;
    out.set(p.sceneId, bySceneCol);
  }
  return out;
}

// ─── Cell display ───

function ArcPill({ arcId, arcs }: { arcId: string; arcs: ArcMeta[] }) {
  const arc = arcs.find(a => a.id === arcId);
  return (
    <span className="tls-arc-pill">
      <span
        className="tls-arc-dot"
        style={{ background: arc?.color ?? 'var(--color-text-muted)' }}
      />
      {arc?.title ?? arcId}
    </span>
  );
}

// ─── Component ───

interface Props {
  story: Story | null;
  /** SKY-795 §4 — Enter key opens the editor for the keyboard-focused scene. */
  onOpenScene?: (sceneId: string) => void;
}

export default function TimelineSpreadsheet({ story, onOpenScene }: Props) {
  const [scenes, setScenes] = useState<SpreadsheetScene[]>([]);
  const [arcs, setArcs] = useState<ArcMeta[]>([]);
  const [chars, setChars] = useState<CharMeta[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sortBy, setSortBy] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingCell, setEditingCell] = useState<{ sceneId: string; col: ColKey } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState<Set<string>>(new Set());

  // Bulk edit
  const [bulkField, setBulkField] = useState<ColKey | ''>('');
  const [bulkValue, setBulkValue] = useState('');

  // SKY-796: AI auto-population proposals — pending suggestions surfaced as
  // badges on the date / pov / mood cells. `openProposal` tracks which badge
  // popover is currently expanded so only one accept/reject panel is visible
  // at a time.
  const [proposals, setProposals] = useState<TimelineAIProposal[]>([]);
  const [proposalsLoading, setProposalsLoading] = useState(false);
  const [openProposal, setOpenProposal] = useState<string | null>(null);
  const [resolvingProposal, setResolvingProposal] = useState<string | null>(null);

  // SKY-795 — filter + arc-focus + keyboard nav state
  const [filters, setFilters] = useState<TimelineFilters>(DEFAULT_FILTERS);
  const [focusedSceneId, setFocusedSceneId] = useState<string | null>(null);

  // SKY-793 — hover/detail card + right-click context menu state.
  const [hoveredSceneId, setHoveredSceneId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    sceneId: string;
    x: number;
    y: number;
  } | null>(null);
  /** Stack of prior scene snapshots for local undo/redo of timeline edits (spec §4). */
  const undoStackRef = useRef<SpreadsheetScene[][]>([]);
  const redoStackRef = useRef<SpreadsheetScene[][]>([]);
  const tableScrollRef = useRef<HTMLDivElement>(null);

  const api = window.api;

  // ─── Load ───

  useEffect(() => {
    if (!story) {
      setScenes([]);
      setArcs([]);
      setSelectedIds(new Set());
      setProposals([]);
      return;
    }
    setLoading(true);
    setError(null);

    const entityList = (api as unknown as {
      entityList: (type: string) => Promise<{ entities: { id: string; name: string }[] }>;
    }).entityList;

    Promise.all([
      api.timelineGetScenes(story.id),
      api.timelineListArcs(),
      entityList('character'),
      entityList('location').catch(() => ({ entities: [] })),
      api.timelineProposalsList(story.id).catch(() => ({ proposals: [] })),
    ])
      .then(([scenesResp, arcsResp, charsResp, locsResp, propsResp]) => {
        setProposals(propsResp.proposals ?? []);
        setArcs(
          (arcsResp.arcs ?? []).map(a => ({ id: a.id, title: a.title, color: a.color })),
        );
        const charsAny = charsResp as unknown as { entities?: { id: string; name: string }[] };
        setChars((charsAny.entities ?? []).map(c => ({ id: c.id, name: c.name })));
        const locsAny = locsResp as unknown as { entities?: { id: string; name: string }[] };
        setLocations((locsAny.entities ?? []).map(l => ({ id: l.id, name: l.name })));
        setScenes(
          (scenesResp.scenes ?? []).map(s => ({
            id: s.id,
            title: s.title,
            chapterId: s.chapterId ?? '',
            date: s.chronologicalTime?.date ?? '',
            pov: s.timelineMetadata?.pov ?? '',
            arcIds: s.entityLinks?.arcs ?? [],
            characterIds: s.entityLinks?.characterIds ?? [],
            wordCount: s.timelineMetadata?.wordCount ?? null,
            mood: s.timelineMetadata?.mood ?? '',
            locationId: s.entityLinks?.locationId ?? '',
          })),
        );
      })
      .catch(err => setError(String(err)))
      .finally(() => setLoading(false));
  }, [story, api]);

  // ─── SKY-796: proposal index + actions ───

  const proposalIndex = useMemo(() => indexProposals(proposals), [proposals]);

  const charLookup = useMemo(() => new Map(chars.map(c => [c.id, c.name])), [chars]);

  const generateProposals = useCallback(async () => {
    if (!story) return;
    setProposalsLoading(true);
    setError(null);
    try {
      const resp = await api.timelineProposalsGenerate(story.id);
      setProposals(resp.proposals ?? []);
    } catch (err) {
      setError(String(err));
    } finally {
      setProposalsLoading(false);
    }
  }, [story, api]);

  const resolveProposal = useCallback(async (
    proposalId: string,
    decision: 'accept' | 'reject',
  ) => {
    setResolvingProposal(proposalId);
    setError(null);
    try {
      const resp = await api.timelineProposalResolve(proposalId, decision);
      // Drop the resolved proposal from the in-memory list — pending only.
      setProposals(prev => prev.filter(p => p.id !== proposalId));
      setOpenProposal(prev => (prev === proposalId ? null : prev));
      // If accept applied a value, fold the updated scene back into local state
      // so the row re-renders without an extra round-trip.
      if (decision === 'accept' && resp.scene && !resp.skippedBecauseUserSet) {
        const u = resp.scene;
        setScenes(prev => prev.map(s => s.id === u.id ? {
          ...s,
          date: u.chronologicalTime?.date ?? s.date,
          pov: u.timelineMetadata?.pov ?? s.pov,
          mood: u.timelineMetadata?.mood ?? s.mood,
          characterIds: u.entityLinks?.characterIds ?? s.characterIds,
          locationId: u.entityLinks?.locationId ?? s.locationId,
        } : s));
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setResolvingProposal(null);
    }
  }, [api]);

  // ─── Filter / sort / group ───

  // Date range hides scenes outside [from, to] entirely (spec §2.4). Entity tab and arc focus
  // fade non-matching rows (handled per-row via sceneOpacity), so they stay in the sorted set.
  const dateOnlyFilters = useMemo<TimelineFilters>(
    () => ({ ...DEFAULT_FILTERS, dateFrom: filters.dateFrom, dateTo: filters.dateTo }),
    [filters.dateFrom, filters.dateTo],
  );
  const visibleScenes = useMemo(
    () => scenes.filter(s => !isSceneHidden(s, dateOnlyFilters)),
    [scenes, dateOnlyFilters],
  );

  const sorted = useMemo(
    () => (sortBy ? sortScenes(visibleScenes, sortBy, sortDir) : visibleScenes),
    [visibleScenes, sortBy, sortDir],
  );

  /** Chronological scene-id order used by Tab/Shift+Tab navigation. */
  const chronoIds = useMemo(() => chronologicalSceneIds(visibleScenes), [visibleScenes]);

  const groups = useMemo<SceneGroup[]>(() => {
    if (groupBy === 'none') return [{ key: '__flat__', label: '', scenes: sorted }];
    return groupScenes(sorted, groupBy, arcs, chars);
  }, [sorted, groupBy, arcs, chars]);

  const toggleSort = useCallback((col: SortCol) => {
    setSortBy(prev => {
      if (prev === col) {
        setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
        return col;
      }
      setSortDir('asc');
      return col;
    });
  }, []);

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups(prev => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }, []);

  // ─── Selection ───

  const handleRowClick = useCallback((sceneId: string, e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      // Ctrl/Cmd+Click multi-select (spec §2.4).
      e.preventDefault();
      setSelectedIds(prev => {
        const n = new Set(prev);
        if (n.has(sceneId)) n.delete(sceneId);
        else n.add(sceneId);
        return n;
      });
      setFocusedSceneId(sceneId);
    } else if (!editingCell) {
      // Plain click selects only this row and updates keyboard focus.
      setSelectedIds(new Set([sceneId]));
      setFocusedSceneId(sceneId);
    }
  }, [editingCell]);

  // scenesRef keeps the latest scenes array reachable from stable callbacks (keyboard
  // handlers, undo/redo) without re-binding them on every state change.
  const scenesRef = useRef<SpreadsheetScene[]>(scenes);
  useEffect(() => { scenesRef.current = scenes; }, [scenes]);

  /** Snapshot the current scenes array onto the undo stack before any mutation. */
  const pushUndo = useCallback(() => {
    undoStackRef.current.push(scenesRef.current);
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
    // Any new edit invalidates the redo stack — matches conventional editor behaviour.
    redoStackRef.current = [];
  }, []);

  // ─── Inline edit ───

  const startEdit = useCallback((sceneId: string, col: ColKey, currentValue: string) => {
    setEditingCell({ sceneId, col });
    setEditValue(currentValue);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditValue('');
  }, []);

  const commitEdit = useCallback(async (sceneId: string, col: ColKey, value: string) => {
    setEditingCell(null);
    setEditValue('');

    const scene = scenes.find(s => s.id === sceneId);
    if (!scene) return;

    // SKY-5146 / GH#627: validate word-count BEFORE mutating undo history so a
    // rejected (partial-numeric) entry is a pure no-op that leaves the cell as-is.
    let nextWordCount: number | undefined;
    if (col === 'wordCount') {
      const parsed = parseWordCount(value);
      if (parsed === WORD_COUNT_INVALID) return; // reject: keep the previous value
      nextWordCount = parsed;
    }

    pushUndo();

    const payload: Parameters<typeof api.timelineUpdateScene>[0] = { sceneId };

    if (col === 'date') {
      const trimmed = value.trim();
      if (trimmed) {
        payload.chronologicalTime = {
          date: trimmed,
          isEstimated: false,
          confidence: 1,
          source: 'explicit_marker',
        };
      }
    } else if (col === 'pov') {
      payload.timelineMetadata = {
        pov: value.trim(),
        mood: scene.mood || undefined,
        wordCount: scene.wordCount ?? undefined,
      };
    } else if (col === 'mood') {
      payload.timelineMetadata = {
        mood: value.trim(),
        pov: scene.pov || undefined,
        wordCount: scene.wordCount ?? undefined,
      };
    } else if (col === 'wordCount') {
      payload.timelineMetadata = {
        wordCount: nextWordCount,
        pov: scene.pov || undefined,
        mood: scene.mood || undefined,
      };
    } else if (col === 'location') {
      payload.entityLinks = {
        locationId: value.trim() || undefined,
        arcs: scene.arcIds,
        characterIds: scene.characterIds,
      };
    } else if (col === 'arc') {
      const newArcs = value ? [value] : [];
      payload.entityLinks = {
        arcs: newArcs,
        locationId: scene.locationId || undefined,
        characterIds: scene.characterIds,
      };
    }

    setSaving(prev => new Set(prev).add(sceneId));
    try {
      const resp = await api.timelineUpdateScene(payload);
      const updated = resp.scene;
      setScenes(prev =>
        prev.map(s =>
          s.id === sceneId
            ? {
                ...s,
                date: updated.chronologicalTime?.date ?? s.date,
                pov: updated.timelineMetadata?.pov ?? s.pov,
                arcIds: updated.entityLinks?.arcs ?? s.arcIds,
                characterIds: updated.entityLinks?.characterIds ?? s.characterIds,
                wordCount: updated.timelineMetadata?.wordCount ?? s.wordCount,
                mood: updated.timelineMetadata?.mood ?? s.mood,
                locationId: updated.entityLinks?.locationId ?? s.locationId,
              }
            : s,
        ),
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(prev => {
        const n = new Set(prev);
        n.delete(sceneId);
        return n;
      });
    }
  }, [scenes, api, pushUndo]);

  // ─── Bulk edit ───

  const applyBulkEdit = useCallback(async () => {
    if (selectedIds.size === 0 || !bulkField || !bulkValue) return;
    const ids = Array.from(selectedIds);
    pushUndo();
    setSaving(new Set(ids));
    setError(null);
    try {
      await Promise.all(
        ids.map(async sceneId => {
          const scene = scenes.find(s => s.id === sceneId);
          if (!scene) return;
          const payload: Parameters<typeof api.timelineUpdateScene>[0] = { sceneId };
          if (bulkField === 'arc') {
            payload.entityLinks = {
              arcs: bulkValue ? [bulkValue] : [],
              locationId: scene.locationId || undefined,
              characterIds: scene.characterIds,
            };
          } else if (bulkField === 'pov') {
            payload.timelineMetadata = {
              pov: bulkValue,
              mood: scene.mood || undefined,
              wordCount: scene.wordCount ?? undefined,
            };
          } else if (bulkField === 'mood') {
            payload.timelineMetadata = {
              mood: bulkValue,
              pov: scene.pov || undefined,
              wordCount: scene.wordCount ?? undefined,
            };
          }
          const resp = await api.timelineUpdateScene(payload);
          const updated = resp.scene;
          setScenes(prev =>
            prev.map(s =>
              s.id === sceneId
                ? {
                    ...s,
                    arcIds: updated.entityLinks?.arcs ?? s.arcIds,
                    pov: updated.timelineMetadata?.pov ?? s.pov,
                    mood: updated.timelineMetadata?.mood ?? s.mood,
                  }
                : s,
            ),
          );
        }),
      );
      setSelectedIds(new Set());
      setBulkField('');
      setBulkValue('');
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(new Set());
    }
  }, [selectedIds, bulkField, bulkValue, scenes, api, pushUndo]);

  // ─── SKY-795 §4: keyboard nav, delete, duplicate, undo/redo ───

  /** Clear a scene's chronological date so it stops appearing on the timeline. */
  const removeFromTimeline = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    pushUndo();
    setSaving(new Set(ids));
    try {
      await Promise.all(
        ids.map(async sceneId => {
          await api.timelineUpdateScene({
            sceneId,
            chronologicalTime: { date: '', isEstimated: false, confidence: 1, source: 'explicit_marker' },
          });
        }),
      );
      setScenes(prev => prev.filter(s => !ids.includes(s.id)));
      setSelectedIds(new Set());
      setFocusedSceneId(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(new Set());
    }
  }, [api, pushUndo]);

  /** Clone selected scenes into the same chapter and copy their timeline metadata. */
  const duplicateSelected = useCallback(async (ids: string[]) => {
    if (ids.length === 0 || !story) return;
    pushUndo();
    setSaving(new Set(ids));
    try {
      const sceneCreate = (api as unknown as {
        sceneCreate: (p: { storyId: string; chapterId: string; title: string; order?: number }) => Promise<{ id: string }>;
      }).sceneCreate;
      const newRows: SpreadsheetScene[] = [];
      for (const sourceId of ids) {
        const src = scenesRef.current.find(s => s.id === sourceId);
        if (!src || !src.chapterId) continue;
        const created = await sceneCreate({
          storyId: story.id,
          chapterId: src.chapterId,
          title: `${src.title} (copy)`,
        });
        if (src.date || src.pov || src.mood || src.arcIds.length || src.characterIds.length || src.locationId) {
          await api.timelineUpdateScene({
            sceneId: created.id,
            chronologicalTime: src.date
              ? { date: src.date, isEstimated: false, confidence: 1, source: 'explicit_marker' }
              : undefined,
            entityLinks: {
              arcs: src.arcIds,
              characterIds: src.characterIds,
              locationId: src.locationId || undefined,
            },
            timelineMetadata: {
              pov: src.pov || undefined,
              mood: src.mood || undefined,
              wordCount: src.wordCount ?? undefined,
            },
          });
        }
        newRows.push({ ...src, id: created.id, title: `${src.title} (copy)` });
      }
      setScenes(prev => [...prev, ...newRows]);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(new Set());
    }
  }, [api, story, pushUndo]);

  /** Restore the previous scene snapshot. Edits made while undoing are persisted by re-sending
   *  per-scene payloads so the saved files match the visible state. */
  const persistSnapshot = useCallback(async (snapshot: SpreadsheetScene[]) => {
    setSaving(new Set(snapshot.map(s => s.id)));
    try {
      await Promise.all(
        snapshot.map(s =>
          api.timelineUpdateScene({
            sceneId: s.id,
            chronologicalTime: s.date
              ? { date: s.date, isEstimated: false, confidence: 1, source: 'explicit_marker' }
              : { date: '', isEstimated: false, confidence: 1, source: 'explicit_marker' },
            entityLinks: {
              arcs: s.arcIds,
              characterIds: s.characterIds,
              locationId: s.locationId || undefined,
            },
            timelineMetadata: {
              pov: s.pov || undefined,
              mood: s.mood || undefined,
              wordCount: s.wordCount ?? undefined,
            },
          }).catch(() => undefined),
        ),
      );
    } finally {
      setSaving(new Set());
    }
  }, [api]);

  const undo = useCallback(async () => {
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    redoStackRef.current.push(scenesRef.current);
    setScenes(prev);
    await persistSnapshot(prev);
  }, [persistSnapshot]);

  const redo = useCallback(async () => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(scenesRef.current);
    setScenes(next);
    await persistSnapshot(next);
  }, [persistSnapshot]);

  // Keyboard event handler scoped to the timeline view (root container has tabIndex={0}).
  // Skips when an editable element owns focus so cell editing keeps native key behaviour.
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') {
      return;
    }
    const mod = e.ctrlKey || e.metaKey;

    if (e.key === 'Tab') {
      e.preventDefault();
      const next = stepFocusedScene(focusedSceneId, chronoIds, e.shiftKey ? -1 : 1);
      setFocusedSceneId(next);
      if (next) setSelectedIds(new Set([next]));
      return;
    }
    if (e.key === 'Enter' && focusedSceneId) {
      e.preventDefault();
      onOpenScene?.(focusedSceneId);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && (selectedIds.size > 0 || focusedSceneId)) {
      e.preventDefault();
      const ids = selectedIds.size > 0 ? Array.from(selectedIds) : focusedSceneId ? [focusedSceneId] : [];
      void removeFromTimeline(ids);
      return;
    }
    if (mod && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      setSelectedIds(new Set(visibleScenes.map(s => s.id)));
      return;
    }
    if (mod && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      const ids = selectedIds.size > 0 ? Array.from(selectedIds) : focusedSceneId ? [focusedSceneId] : [];
      void duplicateSelected(ids);
      return;
    }
    if (mod && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
      e.preventDefault();
      void undo();
      return;
    }
    if (mod && ((e.key === 'y' || e.key === 'Y') || ((e.key === 'z' || e.key === 'Z') && e.shiftKey))) {
      e.preventDefault();
      void redo();
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      // Arrow keys pan the scroll container per spec §4.
      e.preventDefault();
      const scroller = tableScrollRef.current;
      if (scroller) {
        scroller.scrollBy({ top: e.key === 'ArrowDown' ? 60 : -60, behavior: 'auto' });
      }
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const scroller = tableScrollRef.current;
      if (scroller) {
        scroller.scrollBy({ left: e.key === 'ArrowRight' ? 80 : -80, behavior: 'auto' });
      }
      return;
    }
  }, [
    chronoIds,
    focusedSceneId,
    selectedIds,
    visibleScenes,
    onOpenScene,
    removeFromTimeline,
    duplicateSelected,
    undo,
    redo,
  ]);

  // Scroll the keyboard-focused row into view whenever it changes.
  useEffect(() => {
    if (!focusedSceneId) return;
    const el = tableScrollRef.current?.querySelector<HTMLElement>(`[data-row-id="${focusedSceneId}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }, [focusedSceneId]);

  // SKY-793 — dispatch a context-menu action to the existing per-cell or per-row
  // handlers so the menu reuses the spreadsheet's edit/delete/duplicate plumbing.
  const handleContextAction = useCallback(
    (sceneId: string, action: TimelineSceneAction) => {
      const scene = scenesRef.current.find(s => s.id === sceneId);
      if (!scene) return;
      switch (action) {
        case 'edit':
          onOpenScene?.(sceneId);
          break;
        case 'delete-from-timeline':
          void removeFromTimeline([sceneId]);
          break;
        case 'duplicate':
          void duplicateSelected([sceneId]);
          break;
        case 'change-pov':
          setSelectedIds(new Set([sceneId]));
          setFocusedSceneId(sceneId);
          startEdit(sceneId, 'pov', scene.pov);
          break;
        case 'change-arc':
          setSelectedIds(new Set([sceneId]));
          setFocusedSceneId(sceneId);
          startEdit(sceneId, 'arc', scene.arcIds[0] ?? '');
          break;
      }
    },
    [onOpenScene, removeFromTimeline, duplicateSelected, startEdit],
  );

  // The "active" detail-card scene: prefer hover, fall back to keyboard-focused
  // row, then to a single selected row. Card state is 'selected' when the user
  // committed to one (kb-focus or 1-up selection) and 'hover' otherwise.
  const detailCardScene = useMemo(() => {
    const id =
      hoveredSceneId ??
      focusedSceneId ??
      (selectedIds.size === 1 ? Array.from(selectedIds)[0] : null);
    if (!id) return null;
    return scenes.find(s => s.id === id) ?? null;
  }, [hoveredSceneId, focusedSceneId, selectedIds, scenes]);

  const detailCardState: 'hover' | 'selected' =
    !hoveredSceneId && (focusedSceneId || selectedIds.size === 1) ? 'selected' : 'hover';

  // ─── Cell renderers ───

  function cellValue(scene: SpreadsheetScene, col: ColKey): string {
    switch (col) {
      case 'date': return scene.date;
      case 'pov': return scene.pov;
      case 'arc': return scene.arcIds.join(',');
      case 'wordCount': return scene.wordCount != null ? String(scene.wordCount) : '';
      case 'mood': return scene.mood;
      case 'location': return scene.locationId;
    }
  }

  function renderCellContent(scene: SpreadsheetScene, col: ColKey) {
    if (col === 'arc') {
      if (!scene.arcIds.length) return <span className="tls-cell-empty">—</span>;
      return (
        <span className="tls-arc-list">
          {scene.arcIds.map(id => <ArcPill key={id} arcId={id} arcs={arcs} />)}
        </span>
      );
    }
    const v = cellValue(scene, col);
    if (!v) return <span className="tls-cell-empty">—</span>;
    return v;
  }

  function renderEditInput(scene: SpreadsheetScene, col: ColKey) {
    if (col === 'arc') {
      return (
        <select
          className="tls-cell-input tls-cell-select"
          autoFocus
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={() => commitEdit(scene.id, col, editValue)}
          onKeyDown={e => {
            if (e.key === 'Enter') commitEdit(scene.id, col, editValue);
            if (e.key === 'Escape') cancelEdit();
          }}
          data-testid={`cell-edit-${scene.id}-arc`}
        >
          <option value="">— No Arc —</option>
          {arcs.map(a => (
            <option key={a.id} value={a.id}>{a.title}</option>
          ))}
        </select>
      );
    }
    return (
      <input
        className="tls-cell-input"
        type={col === 'wordCount' ? 'number' : 'text'}
        autoFocus
        value={editValue}
        onChange={e => setEditValue(e.target.value)}
        onBlur={() => commitEdit(scene.id, col, editValue)}
        onKeyDown={e => {
          if (e.key === 'Enter') commitEdit(scene.id, col, editValue);
          if (e.key === 'Escape') cancelEdit();
        }}
        data-testid={`cell-edit-${scene.id}-${col}`}
      />
    );
  }

  function renderProposalBadge(scene: SpreadsheetScene, col: ColKey) {
    const colProps = proposalIndex.get(scene.id)?.[col];
    if (!colProps || colProps.length === 0) return null;
    // Surface the highest-confidence proposal first.
    const sorted = [...colProps].sort((a, b) => b.confidence - a.confidence);
    return (
      <span className="tls-proposal-stack" data-testid={`proposal-stack-${scene.id}-${col}`}>
        {sorted.map(p => {
          const isOpen = openProposal === p.id;
          const isResolving = resolvingProposal === p.id;
          const displayValue = p.kind === 'characters' && p.value.startsWith('pov:')
            ? (charLookup.get(p.value.slice(4)) ?? p.value.slice(4))
            : p.kind === 'characters'
              ? p.value.split(',').map(id => charLookup.get(id) ?? id).join(', ')
              : p.value;
          return (
            <span key={p.id} className="tls-proposal-wrap">
              <button
                type="button"
                className={`tls-proposal-badge tls-proposal-badge--${p.kind}${isOpen ? ' tls-proposal-badge--open' : ''}`}
                title={`AI ${p.kind}: ${displayValue} — ${p.reason} (${Math.round(p.confidence * 100)}%)`}
                onClick={e => {
                  e.stopPropagation();
                  setOpenProposal(prev => prev === p.id ? null : p.id);
                }}
                aria-expanded={isOpen}
                aria-label={`AI proposal: ${p.kind} ${displayValue}, ${Math.round(p.confidence * 100)}% confidence`}
                data-testid={`proposal-badge-${p.id}`}
                disabled={isResolving}
              >
                <span aria-hidden="true">✨</span>
                <span className="tls-proposal-value">{displayValue}</span>
              </button>
              {isOpen && (
                <span
                  className="tls-proposal-popover"
                  role="dialog"
                  aria-label={`AI ${p.kind} proposal for ${scene.title}`}
                  data-testid={`proposal-popover-${p.id}`}
                  onClick={e => e.stopPropagation()}
                >
                  <span className="tls-proposal-reason">{p.reason}</span>
                  <span className="tls-proposal-confidence">
                    Confidence: {Math.round(p.confidence * 100)}%
                  </span>
                  <span className="tls-proposal-actions">
                    <button
                      type="button"
                      className="tls-proposal-accept"
                      onClick={() => void resolveProposal(p.id, 'accept')}
                      disabled={isResolving}
                      data-testid={`proposal-accept-${p.id}`}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="tls-proposal-reject"
                      onClick={() => void resolveProposal(p.id, 'reject')}
                      disabled={isResolving}
                      data-testid={`proposal-reject-${p.id}`}
                    >
                      Reject
                    </button>
                  </span>
                </span>
              )}
            </span>
          );
        })}
      </span>
    );
  }

  function renderCell(scene: SpreadsheetScene, col: ColKey) {
    const isEditing = editingCell?.sceneId === scene.id && editingCell.col === col;
    return (
      <td
        key={col}
        className={`tls-td tls-td-${col}${isEditing ? ' tls-td--editing' : ''}`}
        onDoubleClick={() => {
          if (!isEditing) startEdit(scene.id, col, cellValue(scene, col));
        }}
        data-testid={`cell-${scene.id}-${col}`}
      >
        {isEditing ? renderEditInput(scene, col) : renderCellContent(scene, col)}
        {!isEditing && renderProposalBadge(scene, col)}
      </td>
    );
  }

  function renderRow(scene: SpreadsheetScene) {
    const isSelected = selectedIds.has(scene.id);
    const isSaving = saving.has(scene.id);
    const isKbFocused = focusedSceneId === scene.id;
    // SKY-795 §2.4 / §3.3 — opacity expresses entity-tab fade (0.3) and arc-focus ghost (0.2).
    const opacity = sceneOpacity(scene, filters);
    return (
      <tr
        key={scene.id}
        className={`tls-row${isSelected ? ' tls-row--selected' : ''}${isSaving ? ' tls-row--saving' : ''}${isKbFocused ? ' tls-row--keyboard-focused' : ''}`}
        onClick={e => handleRowClick(scene.id, e)}
        onMouseEnter={() => setHoveredSceneId(scene.id)}
        onMouseLeave={() =>
          setHoveredSceneId(prev => (prev === scene.id ? null : prev))
        }
        onContextMenu={e => {
          e.preventDefault();
          setContextMenu({ sceneId: scene.id, x: e.clientX, y: e.clientY });
        }}
        aria-selected={isSelected}
        data-testid={`row-${scene.id}`}
        data-row-id={scene.id}
        data-opacity={opacity === 1 ? undefined : String(opacity)}
        id={`tls-row-${scene.id}`}
      >
        <td className="tls-td tls-td-select">
          <input
            type="checkbox"
            className="tls-row-check"
            checked={isSelected}
            onChange={e => {
              setSelectedIds(prev => {
                const n = new Set(prev);
                if (e.target.checked) n.add(scene.id);
                else n.delete(scene.id);
                return n;
              });
            }}
            onClick={e => e.stopPropagation()}
            aria-label={`Select scene ${scene.title}`}
          />
        </td>
        <td className="tls-td tls-td-title" title={scene.title}>
          {isSaving ? <span className="tls-saving-spinner" aria-hidden="true" /> : null}
          {scene.title}
        </td>
        {renderCell(scene, 'date')}
        {renderCell(scene, 'pov')}
        {renderCell(scene, 'arc')}
        {renderCell(scene, 'wordCount')}
        {renderCell(scene, 'mood')}
        {renderCell(scene, 'location')}
      </tr>
    );
  }

  // ─── Header ───

  function SortHeader({ col, label }: { col: SortCol; label: string }) {
    const active = sortBy === col;
    return (
      <th
        className={`tls-th tls-th-${col}${active ? ' tls-th--sorted' : ''}`}
        onClick={() => toggleSort(col)}
        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSort(col); } }}
      >
        {label}
        {active && <span className="tls-sort-icon" aria-hidden="true">{sortDir === 'asc' ? ' ↑' : ' ↓'}</span>}
      </th>
    );
  }

  // ─── Render ───

  if (!story) {
    return (
      <div className="tls-empty">
        <div className="tls-empty-icon" aria-hidden="true"><BookOpen size={40} /></div>
        <h2>Select a story to view its timeline.</h2>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="tls-empty">
        <div className="tls-loading-spinner" role="status" aria-label="Loading scenes" />
      </div>
    );
  }

  if (scenes.length === 0 && !loading) {
    return (
      <div className="tls-empty">
        <div className="tls-empty-icon" aria-hidden="true"><FileText size={40} /></div>
        <h2>Create scenes in your story to see them here.</h2>
      </div>
    );
  }

  const allSelected = visibleScenes.length > 0 && selectedIds.size === visibleScenes.length;

  return (
    <div
      className="tls-root"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="application"
      aria-label="Story timeline — use Tab to cycle scenes, Enter to open, Delete to remove"
      aria-activedescendant={focusedSceneId ? `tls-row-${focusedSceneId}` : undefined}
      data-testid="timeline-spreadsheet-root"
    >
      {/* SKY-795 — Filters + arc focus + date range */}
      <TimelineFilterBar
        filters={filters}
        onFiltersChange={setFilters}
        arcs={arcs}
        characters={chars}
        locations={locations}
      />

      {/* Toolbar */}
      <div className="tls-toolbar" role="toolbar" aria-label="Spreadsheet controls">
        <span className="tls-story-title">{story.title}</span>

        <div className="tls-toolbar-group" role="group" aria-label="Group by">
          <span className="tls-toolbar-label">Group:</span>
          {(['none', 'arc', 'character'] as GroupBy[]).map(g => (
            <button
              key={g}
              className={`tls-toolbar-btn${groupBy === g ? ' active' : ''}`}
              onClick={() => { setGroupBy(g); setCollapsedGroups(new Set()); }}
              aria-pressed={groupBy === g}
            >
              {g === 'none' ? 'None' : g === 'arc' ? 'Arc' : 'Character'}
            </button>
          ))}
        </div>

        {sortBy && (
          <button
            className="tls-toolbar-btn tls-clear-sort"
            onClick={() => setSortBy(null)}
            aria-label="Clear sort"
          >
            Clear Sort
          </button>
        )}

        {/* SKY-796: AI proposals — non-blocking suggestions for date / characters / mood */}
        <button
          className="tls-toolbar-btn tls-ai-suggest-btn"
          onClick={() => void generateProposals()}
          disabled={proposalsLoading}
          aria-label="Generate AI proposals for date, characters, and mood"
          data-testid="ai-suggest-btn"
        >
          {proposalsLoading
            ? 'Scanning…'
            : proposals.length > 0
              ? `AI Suggestions (${proposals.length})`
              : 'Suggest with AI'}
        </button>
      </div>

      {/* Bulk edit bar */}
      {selectedIds.size > 1 && (
        <div className="tls-bulk-bar" role="region" aria-label="Bulk edit">
          <span className="tls-bulk-count">{selectedIds.size} selected</span>
          <select
            className="tls-bulk-field"
            value={bulkField}
            onChange={e => { setBulkField(e.target.value as ColKey | ''); setBulkValue(''); }}
            aria-label="Field to bulk edit"
          >
            <option value="">— Choose field —</option>
            <option value="arc">Arc</option>
            <option value="pov">POV</option>
            <option value="mood">Mood</option>
          </select>
          {bulkField === 'arc' ? (
            <select
              className="tls-bulk-value"
              value={bulkValue}
              onChange={e => setBulkValue(e.target.value)}
              aria-label="Arc to assign"
            >
              <option value="">— No Arc —</option>
              {arcs.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
            </select>
          ) : bulkField ? (
            <input
              className="tls-bulk-input"
              type="text"
              value={bulkValue}
              onChange={e => setBulkValue(e.target.value)}
              placeholder={`New ${bulkField}…`}
              aria-label={`New value for ${bulkField}`}
            />
          ) : null}
          <button
            className="tls-bulk-apply"
            disabled={!bulkField || !bulkValue}
            onClick={() => void applyBulkEdit()}
          >
            Apply
          </button>
          <button
            className="tls-bulk-cancel"
            onClick={() => { setSelectedIds(new Set()); setBulkField(''); setBulkValue(''); }}
          >
            Cancel
          </button>
        </div>
      )}

      {error && (
        <div className="tls-error" role="alert">{error}</div>
      )}

      {/* SKY-793 — detail/hover card (right-side glass panel). */}
      {detailCardScene && (
        <div className="tls-detail-card-mount" aria-live="polite">
          <TimelineDetailCard
            scene={detailCardScene}
            state={detailCardState}
            arcs={arcs}
            characters={chars}
            locations={locations}
            onEdit={id => onOpenScene?.(id)}
            onRequestContextMenu={(id, x, y) =>
              setContextMenu({ sceneId: id, x, y })
            }
          />
        </div>
      )}

      {/* SKY-793 — right-click scene context menu. */}
      {contextMenu && (
        <TimelineSceneContextMenu
          sceneId={contextMenu.sceneId}
          x={contextMenu.x}
          y={contextMenu.y}
          onAction={action => handleContextAction(contextMenu.sceneId, action)}
          onDismiss={() => setContextMenu(null)}
        />
      )}

      {/* Table */}
      <div className="tls-scroll" ref={tableScrollRef}>
        <table className="tls-table" role="grid" aria-label={`${story.title} scene spreadsheet`}>
          <thead>
            <tr className="tls-header-row">
              <th className="tls-th tls-th-select">
                <input
                  type="checkbox"
                  className="tls-row-check"
                  checked={allSelected}
                  onChange={e => {
                    if (e.target.checked) setSelectedIds(new Set(visibleScenes.map(s => s.id)));
                    else setSelectedIds(new Set());
                  }}
                  aria-label="Select all scenes"
                />
              </th>
              <th className="tls-th tls-th-title">Title</th>
              <SortHeader col="date" label="Date" />
              <SortHeader col="pov" label="POV" />
              <SortHeader col="arc" label="Arc" />
              <th className="tls-th tls-th-wordCount">Words</th>
              <th className="tls-th tls-th-mood">Mood</th>
              <th className="tls-th tls-th-location">Location</th>
            </tr>
          </thead>
            {groups.map(group => (
              <tbody key={`group-${group.key}`}>
                {groupBy !== 'none' && (
                  <tr
                    className="tls-group-row"
                    onClick={() => toggleGroup(group.key)}
                    aria-expanded={!collapsedGroups.has(group.key)}
                  >
                    <td className="tls-group-cell" colSpan={8}>
                      <span className="tls-group-toggle" aria-hidden="true">
                        {collapsedGroups.has(group.key) ? '▶' : '▼'}
                      </span>
                      {group.color && (
                        <span
                          className="tls-arc-dot"
                          style={{ background: group.color }}
                          aria-hidden="true"
                        />
                      )}
                      <span className="tls-group-label">{group.label}</span>
                      <span className="tls-group-count">({group.scenes.length})</span>
                    </td>
                  </tr>
                )}
                {!collapsedGroups.has(group.key) && group.scenes.map(s => renderRow(s))}
              </tbody>
            ))}
        </table>
      </div>
    </div>
  );
}
