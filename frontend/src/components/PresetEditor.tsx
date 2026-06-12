import { useState, useEffect, useRef } from 'react';
import {
  GENRES,
  TONE_VALUES,
  TONE_LABELS,
  POV_VALUES,
  POV_LABELS,
  TENSE_VALUES,
  TENSE_LABELS,
  LENGTH_VALUES,
  LENGTH_LABELS,
  AUDIENCE_VALUES,
  AUDIENCE_LABELS,
  CONTENT_CONSTRAINTS,
  getPresetById,
  getEffectiveAxes,
} from '../presets';
import type { PresetAxes } from '../presets';
import './PresetEditor.css';

interface Props {
  activePresetId: string;
  overrides: Partial<PresetAxes>;
  onApply: (overrides: Partial<PresetAxes>) => void;
  onClose: () => void;
}

export default function PresetEditor({ activePresetId, overrides, onApply, onClose }: Props) {
  const basePreset = getPresetById(activePresetId);
  const initial = getEffectiveAxes(activePresetId, overrides);

  const [axes, setAxes] = useState<PresetAxes>(initial);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFocusRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    firstFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const toggleConstraint = (id: string) => {
    setAxes((prev) => ({
      ...prev,
      contentConstraints: prev.contentConstraints.includes(id)
        ? prev.contentConstraints.filter((c) => c !== id)
        : [...prev.contentConstraints, id],
    }));
  };

  const handleReset = () => setAxes(basePreset.axes);

  const handleApply = () => {
    const diff: Partial<PresetAxes> = {};
    const base = basePreset.axes;
    if (axes.genre !== base.genre) diff.genre = axes.genre;
    if (axes.tone !== base.tone) diff.tone = axes.tone;
    if (axes.pov !== base.pov) diff.pov = axes.pov;
    if (axes.tense !== base.tense) diff.tense = axes.tense;
    if (axes.length !== base.length) diff.length = axes.length;
    if (axes.audience !== base.audience) diff.audience = axes.audience;
    const constraintsChanged =
      JSON.stringify([...axes.contentConstraints].sort()) !==
      JSON.stringify([...base.contentConstraints].sort());
    if (constraintsChanged) diff.contentConstraints = axes.contentConstraints;
    onApply(diff);
    onClose();
  };

  const toneIndex = TONE_VALUES.indexOf(axes.tone);
  const lengthIndex = LENGTH_VALUES.indexOf(axes.length);

  return (
    <div className="preset-editor-overlay" role="dialog" aria-modal="true" aria-label={`Customize preset: ${basePreset.name}`}>
      <div
        ref={dialogRef}
        className="preset-editor-panel"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="preset-editor-header">
          <div>
            <h2 className="preset-editor-title">Customize: {basePreset.name}</h2>
            <p className="preset-editor-subtitle">Changes apply only to this session</p>
          </div>
          <button
            className="preset-editor-close"
            onClick={onClose}
            aria-label="Close preset editor"
            type="button"
          >
            ✕
          </button>
        </div>

        <div className="preset-editor-body">
          <div className="preset-editor-field">
            <label className="preset-editor-label" htmlFor="pe-genre">Genre</label>
            <select
              ref={firstFocusRef}
              id="pe-genre"
              className="preset-editor-select"
              value={axes.genre}
              onChange={(e) => setAxes((prev) => ({ ...prev, genre: e.target.value }))}
            >
              {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>

          <div className="preset-editor-field">
            <label className="preset-editor-label" htmlFor="pe-tone">
              Tone
              <span className="preset-editor-slider-label">
                {TONE_LABELS[axes.tone]}
              </span>
            </label>
            <input
              id="pe-tone"
              type="range"
              className="preset-editor-slider"
              min={0}
              max={TONE_VALUES.length - 1}
              value={toneIndex}
              onChange={(e) => setAxes((prev) => ({ ...prev, tone: TONE_VALUES[+e.target.value] }))}
              aria-valuetext={TONE_LABELS[axes.tone]}
            />
            <div className="preset-editor-slider-range">
              <span>Grim</span>
              <span>Joyful</span>
            </div>
          </div>

          <div className="preset-editor-field">
            <label className="preset-editor-label" htmlFor="pe-pov">POV</label>
            <select
              id="pe-pov"
              className="preset-editor-select"
              value={axes.pov}
              onChange={(e) => setAxes((prev) => ({ ...prev, pov: e.target.value as PresetAxes['pov'] }))}
            >
              {POV_VALUES.map((v) => <option key={v} value={v}>{POV_LABELS[v]}</option>)}
            </select>
          </div>

          <div className="preset-editor-field">
            <label className="preset-editor-label" htmlFor="pe-tense">Tense</label>
            <select
              id="pe-tense"
              className="preset-editor-select"
              value={axes.tense}
              onChange={(e) => setAxes((prev) => ({ ...prev, tense: e.target.value as PresetAxes['tense'] }))}
            >
              {TENSE_VALUES.map((v) => <option key={v} value={v}>{TENSE_LABELS[v]}</option>)}
            </select>
          </div>

          <div className="preset-editor-field">
            <label className="preset-editor-label" htmlFor="pe-length">
              Length
              <span className="preset-editor-slider-label">
                {LENGTH_LABELS[axes.length]}
              </span>
            </label>
            <input
              id="pe-length"
              type="range"
              className="preset-editor-slider"
              min={0}
              max={LENGTH_VALUES.length - 1}
              value={lengthIndex}
              onChange={(e) => setAxes((prev) => ({ ...prev, length: LENGTH_VALUES[+e.target.value] }))}
              aria-valuetext={LENGTH_LABELS[axes.length]}
            />
            <div className="preset-editor-slider-range">
              <span>Concise</span>
              <span>Elaborate</span>
            </div>
          </div>

          <div className="preset-editor-field">
            <label className="preset-editor-label" htmlFor="pe-audience">Audience</label>
            <select
              id="pe-audience"
              className="preset-editor-select"
              value={axes.audience}
              onChange={(e) => setAxes((prev) => ({ ...prev, audience: e.target.value as PresetAxes['audience'] }))}
            >
              {AUDIENCE_VALUES.map((v) => <option key={v} value={v}>{AUDIENCE_LABELS[v]}</option>)}
            </select>
          </div>

          <div className="preset-editor-field">
            <span className="preset-editor-label">Content to Avoid</span>
            <div className="preset-editor-constraints">
              {CONTENT_CONSTRAINTS.map((c) => (
                <label key={c.id} className="preset-editor-checkbox-label">
                  <input
                    type="checkbox"
                    className="preset-editor-checkbox"
                    checked={axes.contentConstraints.includes(c.id)}
                    onChange={() => toggleConstraint(c.id)}
                    aria-label={c.label}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="preset-editor-footer">
          <button
            className="preset-editor-btn preset-editor-btn--primary"
            onClick={handleApply}
            type="button"
          >
            Apply
          </button>
          <button
            className="preset-editor-btn preset-editor-btn--secondary"
            onClick={handleReset}
            type="button"
          >
            Reset
          </button>
          <button
            className="preset-editor-btn preset-editor-btn--tertiary"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
