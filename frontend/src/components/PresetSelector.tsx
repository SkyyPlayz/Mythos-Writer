import { useState, useRef, useEffect, useCallback } from 'react';
import { BUNDLED_PRESETS } from '../presets';
import type { Preset } from '../presets';
import './PresetSelector.css';

interface Props {
  activePresetId: string;
  onSelect: (presetId: string) => void;
  onCustomize: () => void;
  onBrowse?: () => void;
  compact?: boolean;
}

export default function PresetSelector({
  activePresetId,
  onSelect,
  onCustomize,
  onBrowse,
  compact = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const activePreset = BUNDLED_PRESETS.find((p) => p.id === activePresetId) ?? BUNDLED_PRESETS[0];

  const close = useCallback(() => {
    setOpen(false);
    setFocusedIndex(-1);
    buttonRef.current?.focus();
  }, []);

  const select = useCallback((id: string) => {
    onSelect(id);
    close();
  }, [onSelect, close]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i + 1, BUNDLED_PRESETS.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && focusedIndex >= 0) {
        e.preventDefault();
        select(BUNDLED_PRESETS[focusedIndex].id);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, focusedIndex, select, close]);

  useEffect(() => {
    if (!open) return;
    const idx = BUNDLED_PRESETS.findIndex((p) => p.id === activePresetId);
    setFocusedIndex(idx >= 0 ? idx : 0);
  }, [open, activePresetId]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const focused = listRef.current.querySelectorAll<HTMLLIElement>('[role="option"]')[focusedIndex];
    focused?.scrollIntoView({ block: 'nearest' });
  }, [focusedIndex, open]);

  const renderPresetItem = (preset: Preset, index: number) => {
    const isActive = preset.id === activePresetId;
    const isFocused = index === focusedIndex;
    return (
      <li
        key={preset.id}
        role="option"
        aria-selected={isActive}
        className={`preset-selector-item${isActive ? ' preset-selector-item--active' : ''}${isFocused ? ' preset-selector-item--focused' : ''}`}
        onClick={() => select(preset.id)}
        onMouseEnter={() => setFocusedIndex(index)}
      >
        <span className="preset-selector-check" aria-hidden="true">
          {isActive ? '✓' : ''}
        </span>
        <span className="preset-selector-name">{preset.name}</span>
        <span className="preset-selector-desc">{preset.description}</span>
      </li>
    );
  };

  return (
    <div className={`preset-selector${compact ? ' preset-selector--compact' : ''}`} ref={containerRef}>
      <div className="preset-selector-row">
        <button
          ref={buttonRef}
          className="preset-selector-chip"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`Writing preset: ${activePreset.name}. Click to change.`}
          type="button"
        >
          <span className="preset-selector-chip-name">{activePreset.name}</span>
          <span className="preset-selector-chip-arrow" aria-hidden="true">▾</span>
        </button>
        <button
          className="preset-selector-action-btn"
          onClick={onCustomize}
          aria-label="Customize preset"
          type="button"
          title="Customize this preset for the current session"
        >
          Customize
        </button>
        {onBrowse && (
          <button
            className="preset-selector-action-btn"
            onClick={onBrowse}
            aria-label="Browse all presets"
            type="button"
            title="Browse all available presets"
          >
            Browse
          </button>
        )}
      </div>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          aria-label="Writing presets"
          className="preset-selector-dropdown"
        >
          {BUNDLED_PRESETS.map(renderPresetItem)}
          <li className="preset-selector-divider" role="separator" aria-hidden="true" />
          <li className="preset-selector-disabled-action" aria-disabled="true">
            + Save Custom Preset
          </li>
        </ul>
      )}
    </div>
  );
}
