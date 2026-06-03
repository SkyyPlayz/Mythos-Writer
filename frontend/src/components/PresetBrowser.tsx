import { useEffect, useRef } from 'react';
import {
  BUNDLED_PRESETS,
  TONE_LABELS,
  POV_LABELS,
  TENSE_LABELS,
  LENGTH_LABELS,
  AUDIENCE_LABELS,
  CONTENT_CONSTRAINTS,
} from '../presets';
import './PresetBrowser.css';

interface Props {
  activePresetId: string;
  onApply: (presetId: string) => void;
  onClose: () => void;
}

export default function PresetBrowser({ activePresetId, onApply, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleApply = (presetId: string) => {
    onApply(presetId);
    onClose();
  };

  return (
    <div className="preset-browser-overlay" role="dialog" aria-modal="true" aria-label="Browse writing presets">
      <div
        ref={panelRef}
        className="preset-browser-panel"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="preset-browser-header">
          <h2 className="preset-browser-title">Browse Presets</h2>
          <button
            className="preset-browser-close"
            onClick={onClose}
            aria-label="Close preset browser"
            type="button"
          >
            ✕
          </button>
        </div>
        <p className="preset-browser-intro">Select a preset to see its style parameters and apply it.</p>

        <div className="preset-browser-grid">
          {BUNDLED_PRESETS.map((preset) => {
            const axes = preset.axes;
            const isActive = preset.id === activePresetId;
            const constraintLabels = axes.contentConstraints
              .map((id) => CONTENT_CONSTRAINTS.find((c) => c.id === id)?.label ?? id);
            return (
              <div
                key={preset.id}
                className={`preset-browser-card${isActive ? ' preset-browser-card--active' : ''}`}
                aria-current={isActive ? 'true' : undefined}
              >
                <div className="preset-browser-card-header">
                  <h3 className="preset-browser-card-name">{preset.name}</h3>
                  <span className="preset-browser-card-desc">{preset.description}</span>
                  {isActive && <span className="preset-browser-card-active-badge">Active</span>}
                </div>
                <dl className="preset-browser-axes">
                  <div className="preset-browser-axis">
                    <dt>Genre</dt>
                    <dd>{axes.genre}</dd>
                  </div>
                  <div className="preset-browser-axis">
                    <dt>Tone</dt>
                    <dd>{TONE_LABELS[axes.tone]}</dd>
                  </div>
                  <div className="preset-browser-axis">
                    <dt>POV</dt>
                    <dd>{POV_LABELS[axes.pov]}</dd>
                  </div>
                  <div className="preset-browser-axis">
                    <dt>Tense</dt>
                    <dd>{TENSE_LABELS[axes.tense]}</dd>
                  </div>
                  <div className="preset-browser-axis">
                    <dt>Length</dt>
                    <dd>{LENGTH_LABELS[axes.length]}</dd>
                  </div>
                  <div className="preset-browser-axis">
                    <dt>Audience</dt>
                    <dd>{AUDIENCE_LABELS[axes.audience]}</dd>
                  </div>
                  {constraintLabels.length > 0 && (
                    <div className="preset-browser-axis">
                      <dt>Avoids</dt>
                      <dd>{constraintLabels.join(', ')}</dd>
                    </div>
                  )}
                </dl>
                <button
                  className="preset-browser-apply-btn"
                  onClick={() => handleApply(preset.id)}
                  type="button"
                  aria-label={`Apply ${preset.name} preset`}
                >
                  {isActive ? 'Already active' : 'Apply'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
