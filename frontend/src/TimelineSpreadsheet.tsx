import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Story } from './types';
import './TimelineSpreadsheet.css';

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

interface ArcMeta {
  id: string;
  title: string;
  color: string;
}

interface CharMeta {
  id: string;
  name: string;
}

export type ColKey = 'date' | 'pov' | 'arc' | 'wordCount' | 'mood' | 'location';
export type SortCol = 'date' | 'pov' | 'arc';
export type GroupBy = 'none' | 'arc' | 'character';

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
}

export default function TimelineSpreadsheet({ story }: Props) {
  const [scenes, setScenes] = useState<SpreadsheetScene[]>([]);
  const [arcs, setArcs] = useState<ArcMeta[]>([]);
  const [chars, setChars] = useState<CharMeta[]>([]);
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

  const api = window.api;

  // ─── Load ───

  useEffect(() => {
    if (!story) {
      setScenes([]);
      setArcs([]);
      setSelectedIds(new Set());
      return;
    }
    setLoading(true);
    setError(null);

    Promise.all([
      api.timelineGetScenes(story.id),
      api.timelineListArcs(),
      (api as unknown as { entityList: (type: string) => Promise<{ entities: { id: string; name: string }[] }> })
        .entityList('character'),
    ])
      .then(([scenesResp, arcsResp, charsResp]) => {
        setArcs(
          (arcsResp.arcs ?? []).map(a => ({ id: a.id, title: a.title, color: a.color })),
        );
        const charsAny = charsResp as unknown as { entities?: { id: string; name: string }[] };
        setChars((charsAny.entities ?? []).map(c => ({ id: c.id, name: c.name })));
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
  }, [story]);

  // ─── Sort / group ───

  const sorted = useMemo(
    () => (sortBy ? sortScenes(scenes, sortBy, sortDir) : scenes),
    [scenes, sortBy, sortDir],
  );

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
      e.preventDefault();
      setSelectedIds(prev => {
        const n = new Set(prev);
        if (n.has(sceneId)) n.delete(sceneId);
        else n.add(sceneId);
        return n;
      });
    } else if (!editingCell) {
      setSelectedIds(new Set());
    }
  }, [editingCell]);

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
      const n = parseInt(value, 10);
      payload.timelineMetadata = {
        wordCount: Number.isNaN(n) ? undefined : n,
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
  }, [scenes, api]);

  // ─── Bulk edit ───

  const applyBulkEdit = useCallback(async () => {
    if (selectedIds.size === 0 || !bulkField || !bulkValue) return;
    const ids = Array.from(selectedIds);
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
  }, [selectedIds, bulkField, bulkValue, scenes, api]);

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
      </td>
    );
  }

  function renderRow(scene: SpreadsheetScene) {
    const isSelected = selectedIds.has(scene.id);
    const isSaving = saving.has(scene.id);
    return (
      <tr
        key={scene.id}
        className={`tls-row${isSelected ? ' tls-row--selected' : ''}${isSaving ? ' tls-row--saving' : ''}`}
        onClick={e => handleRowClick(scene.id, e)}
        aria-selected={isSelected}
        data-testid={`row-${scene.id}`}
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
        <div className="tls-empty-icon" aria-hidden="true">📋</div>
        <h2>No Story Selected</h2>
        <p>Select a story from the Editor view to see its scene spreadsheet.</p>
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
        <div className="tls-empty-icon" aria-hidden="true">📄</div>
        <h2>No Scenes Yet</h2>
        <p>Add scenes to <strong>{story.title}</strong> to use the spreadsheet view.</p>
      </div>
    );
  }

  const allSelected = scenes.length > 0 && selectedIds.size === scenes.length;

  return (
    <div className="tls-root">
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

      {/* Table */}
      <div className="tls-scroll">
        <table className="tls-table" role="grid" aria-label={`${story.title} scene spreadsheet`}>
          <thead>
            <tr className="tls-header-row">
              <th className="tls-th tls-th-select">
                <input
                  type="checkbox"
                  className="tls-row-check"
                  checked={allSelected}
                  onChange={e => {
                    if (e.target.checked) setSelectedIds(new Set(scenes.map(s => s.id)));
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
          <tbody>
            {groups.map(group => (
              <>
                {groupBy !== 'none' && (
                  <tr
                    key={`group-${group.key}`}
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
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
