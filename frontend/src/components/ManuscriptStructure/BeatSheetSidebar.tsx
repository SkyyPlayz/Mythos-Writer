import { useState, useEffect, type ReactElement } from 'react';
import type { Scene } from '../../types';
import { BEAT_ACTS } from './BEAT_STRUCTURE';
import type { BeatActId } from './BEAT_STRUCTURE';
import './BeatSheetSidebar.css';

export type BeatAssignments = Record<string, string>; // sceneId → beatId

/** Persist beat assignments in localStorage keyed by vault root. */
function loadAssignments(vaultKey: string): BeatAssignments {
  try {
    const raw = localStorage.getItem(`mythos-beats-v1:${vaultKey}`);
    return raw ? (JSON.parse(raw) as BeatAssignments) : {};
  } catch {
    return {};
  }
}


interface BeatSheetSidebarProps {
  scenes: Scene[];
  vaultKey: string;
  /** Controlled from outside: which beatId is "focused" (highlighted in grid) */
  focusedBeatId?: string | null;
  onBeatFocus: (beatId: string | null) => void;
  onAssignmentsChange: (assignments: BeatAssignments) => void;
}

export function BeatSheetSidebar({
  scenes,
  vaultKey,
  focusedBeatId,
  onBeatFocus,
  onAssignmentsChange,
}: BeatSheetSidebarProps): ReactElement {
  const [assignments, setAssignments] = useState<BeatAssignments>(() =>
    loadAssignments(vaultKey),
  );
  const [collapsedActs, setCollapsedActs] = useState<Set<BeatActId>>(new Set());

  // Re-load assignments when vaultKey changes (project switch)
  useEffect(() => {
    const loaded = loadAssignments(vaultKey);
    setAssignments(loaded);
    onAssignmentsChange(loaded);
  }, [vaultKey, onAssignmentsChange]);

  const scenesForBeat = (beatId: string) =>
    scenes.filter((s) => assignments[s.id] === beatId);

  const handleBeatClick = (beatId: string) => {
    onBeatFocus(focusedBeatId === beatId ? null : beatId);
  };

  const toggleAct = (actId: BeatActId) => {
    setCollapsedActs((prev) => {
      const next = new Set(prev);
      if (next.has(actId)) {
        next.delete(actId);
      } else {
        next.add(actId);
      }
      return next;
    });
  };

  return (
    <aside className="beat-sidebar" aria-label="Beat sheet — Save the Cat (3-Act)">
      <div className="beat-sidebar__header">
        {/* Framework picker deferred to v2 pending usage signal */}
        <span className="beat-sidebar__title">Save the Cat (3-Act)</span>
      </div>

      {BEAT_ACTS.map((act) => {
        const isCollapsed = collapsedActs.has(act.id);
        const actSceneCount = act.beats.reduce(
          (sum, b) => sum + scenesForBeat(b.id).length,
          0,
        );

        return (
          <section key={act.id} className={`beat-act beat-act--${act.id}`}>
            <button
              className="beat-act__header"
              onClick={() => toggleAct(act.id)}
              aria-expanded={!isCollapsed}
              aria-controls={`beat-act-${act.id}`}
            >
              <span className="beat-act__chevron" aria-hidden="true">
                {isCollapsed ? '▶' : '▼'}
              </span>
              <span className="beat-act__name">{act.title}</span>
              {actSceneCount > 0 && (
                <span className="beat-act__count" aria-label={`${actSceneCount} scenes assigned`}>
                  {actSceneCount}
                </span>
              )}
            </button>

            {!isCollapsed && (
              <ul id={`beat-act-${act.id}`} className="beat-act__beats" role="list">
                {act.beats.map((beat) => {
                  const assignedScenes = scenesForBeat(beat.id);
                  const isFocused = focusedBeatId === beat.id;

                  return (
                    <li key={beat.id} className={`beat-item${isFocused ? ' beat-item--focused' : ''}`}>
                      <button
                        className="beat-item__label"
                        onClick={() => handleBeatClick(beat.id)}
                        aria-pressed={isFocused}
                        aria-label={`${beat.name}: ${assignedScenes.length} scene${assignedScenes.length !== 1 ? 's' : ''} assigned. Click to highlight.`}
                      >
                        {beat.name}
                      </button>
                      {assignedScenes.length > 0 && (
                        <span
                          className="beat-item__count"
                          aria-hidden="true"
                        >
                          {assignedScenes.length}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      <p className="beat-sidebar__hint">
        Right-click a scene card to assign it to a beat.
      </p>
    </aside>
  );
}

export { loadAssignments };
