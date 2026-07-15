// Beat Sheet right panel — Beta 4 M14 refresh (FULL-SPEC §5.3).
//
// Prototype: "Mythos Writer - Liquid Neon.dc.html" 3108–3134 (rpBeats panel:
// chart icon + "Beat Sheet" + "n / m mapped", gradient progress, act groups
// "ACT I — SETUP", beat rows [pct · name · mapped-scene · green dot], hint
// "…drag scenes onto beats to map them.") + template picker (M14 "beat-sheet
// templates in the right panel"; frameworks from tlTpls 4178–4184).
//
// M14 change: the component is now CONTROLLED — assignments live in
// ManuscriptStructureView (single source of truth for grid, list and panel);
// beat rows accept scene drops (HTML5 dnd, same payload the grid/list drags
// carry) in addition to the Beta 3 right-click context menu.

import { useState, type ReactElement } from 'react';
import type { Scene } from '../../types';
import {
  BEAT_TEMPLATES,
  getBeatTemplate,
  beatsOf,
  type BeatTemplateId,
} from './BEAT_STRUCTURE';
import './BeatSheetSidebar.css';

export type BeatAssignments = Record<string, string>; // sceneId → beatId

/** Load persisted beat assignments (localStorage, keyed by vault root). */
export function loadAssignments(vaultKey: string): BeatAssignments {
  try {
    const raw = localStorage.getItem(`mythos-beats-v1:${vaultKey}`);
    return raw ? (JSON.parse(raw) as BeatAssignments) : {};
  } catch {
    return {};
  }
}

/** Load the persisted beat-sheet template choice (Beta 4 M14). */
export function loadTemplateId(vaultKey: string): BeatTemplateId {
  try {
    const raw = localStorage.getItem(`mythos-beat-template-v1:${vaultKey}`);
    if (raw && BEAT_TEMPLATES.some((t) => t.id === raw)) return raw as BeatTemplateId;
  } catch {
    // localStorage unavailable
  }
  return 'save-the-cat';
}

export function saveTemplateId(vaultKey: string, id: BeatTemplateId): void {
  try {
    localStorage.setItem(`mythos-beat-template-v1:${vaultKey}`, id);
  } catch {
    // ignore
  }
}

interface BeatSheetSidebarProps {
  scenes: Scene[];
  /** Scene→beat assignments (owned by ManuscriptStructureView). */
  assignments: BeatAssignments;
  /** Active beat-sheet template. */
  templateId: BeatTemplateId;
  onTemplateChange: (id: BeatTemplateId) => void;
  /** Controlled from outside: which beatId is "focused" (highlighted in grid) */
  focusedBeatId?: string | null;
  onBeatFocus: (beatId: string | null) => void;
  /** Map a dragged scene onto a beat (drop target path). */
  onAssignScene: (sceneId: string, beatId: string | null) => void;
}

export function BeatSheetSidebar({
  scenes,
  assignments,
  templateId,
  onTemplateChange,
  focusedBeatId,
  onBeatFocus,
  onAssignScene,
}: BeatSheetSidebarProps): ReactElement {
  const [dropBeatId, setDropBeatId] = useState<string | null>(null);

  const template = getBeatTemplate(templateId);
  const templateBeats = beatsOf(template);

  const scenesForBeat = (beatId: string) =>
    scenes.filter((s) => assignments[s.id] === beatId);

  const handleBeatClick = (beatId: string) => {
    onBeatFocus(focusedBeatId === beatId ? null : beatId);
  };

  // Prototype 3113–3115: "n / m mapped" + gradient progress bar
  const mappedBeats = templateBeats.filter((b) => scenesForBeat(b.id).length > 0).length;
  const totalBeats = templateBeats.length;

  return (
    <aside className="beat-sidebar" aria-label={`Beat sheet — ${template.name}`}>
      <div className="beat-sidebar__header">
        <svg
          className="beat-sidebar__icon"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 19V5M4 19h16" />
          <path d="M8 15l3-4 3 2 4-6" />
        </svg>
        <span className="beat-sidebar__title">Beat Sheet</span>
        <span className="beat-sidebar__mapped">
          {mappedBeats} / {totalBeats} mapped
        </span>
      </div>
      <div
        className="beat-sidebar__progress"
        role="progressbar"
        aria-label="Beats mapped"
        aria-valuemin={0}
        aria-valuemax={totalBeats}
        aria-valuenow={mappedBeats}
      >
        <div
          className="beat-sidebar__progress-fill"
          style={{ width: `${Math.round((mappedBeats / totalBeats) * 100)}%` }}
        />
      </div>

      {/* Beta 4 M14 — beat-sheet template picker */}
      <label className="beat-sidebar__template">
        <span className="sr-only">Beat-sheet template</span>
        <select
          className="beat-sidebar__template-select"
          value={templateId}
          onChange={(e) => onTemplateChange(e.target.value as BeatTemplateId)}
        >
          {BEAT_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </label>

      <div className="beat-sidebar__acts">
        {template.acts.map((actSection) => (
          <section key={actSection.id} className={`beat-act beat-act--${actSection.id}`}>
            <div className="beat-act__header">{actSection.title}</div>

            <ul className="beat-act__beats" role="list">
              {actSection.beats.map((beat) => {
                const assignedScenes = scenesForBeat(beat.id);
                const isFocused = focusedBeatId === beat.id;
                const isDropTarget = dropBeatId === beat.id;
                const mappedLabel = assignedScenes.map((s) => s.title).join(' · ');

                return (
                  <li
                    key={beat.id}
                    className={[
                      'beat-item',
                      isFocused ? 'beat-item--focused' : '',
                      isDropTarget ? 'beat-item--drop' : '',
                    ].filter(Boolean).join(' ')}
                    data-testid={`beat-item-${beat.id}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'link';
                      setDropBeatId(beat.id);
                    }}
                    onDragLeave={() => setDropBeatId((prev) => (prev === beat.id ? null : prev))}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDropBeatId(null);
                      const sceneId = e.dataTransfer.getData('text/plain');
                      if (sceneId && scenes.some((s) => s.id === sceneId)) {
                        onAssignScene(sceneId, beat.id);
                      }
                    }}
                  >
                    <span className="beat-item__pct" aria-hidden="true">{beat.pct}</span>
                    <button
                      className="beat-item__label"
                      onClick={() => handleBeatClick(beat.id)}
                      aria-pressed={isFocused}
                      aria-label={`${beat.name}: ${assignedScenes.length} scene${assignedScenes.length !== 1 ? 's' : ''} assigned. Click to highlight.`}
                    >
                      <span className="beat-item__name">{beat.name}</span>
                      {mappedLabel && (
                        <span className="beat-item__scene">{mappedLabel}</span>
                      )}
                    </button>
                    {assignedScenes.length > 0 && (
                      <span className="beat-item__dot" aria-hidden="true" />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        <p className="beat-sidebar__hint">
          {template.name} structure — drag scenes onto beats to map them.
        </p>
      </div>
    </aside>
  );
}
