// Beta 4 M7 — Page setup popover (§5.1): the compact popover that replaces
// the always-visible width strip. Houses the page-width control (slider +
// numeric input) and, when wired by the shell, the page-style quick-switch
// (Neon/No glow/Scroll/Custom texture/Off) with a texture-upload trigger.
//
// Popover lifecycle (outside click + Escape close, stopPropagation on the
// panel itself) follows the same pattern as WindowChrome's menus.

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { LiquidNeonPageCfg } from '../theme/liquidNeonEngine';
import './PageChrome.css';

const PAGE_STYLE_OPTIONS: Array<[LiquidNeonPageCfg['mode'], string]> = [
  ['neon', 'Neon'],
  ['default', 'No glow'],
  ['scroll', 'Scroll'],
  ['custom', 'Custom texture'],
  ['off', 'Off'],
];

export interface PageChromeProps {
  open: boolean;
  onClose: () => void;
  pageWidth: number;
  min: number;
  max: number;
  onPageWidthChange: (px: number) => void;
  /** Current manuscript page style — omit to hide the style quick-switch entirely. */
  pageStyleMode?: LiquidNeonPageCfg['mode'];
  onPageStyleChange?: (mode: LiquidNeonPageCfg['mode']) => void;
  /** Display name for the chosen custom texture image, if any. */
  textureFileName?: string;
  onPickPageTexture?: () => void;
}

export default function PageChrome({
  open,
  onClose,
  pageWidth,
  min,
  max,
  onPageWidthChange,
  pageStyleMode,
  onPageStyleChange,
  textureFileName,
  onPickPageTexture,
}: PageChromeProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Numeric inputs never fight the user (§1.4): raw draft while focused,
  // commit on blur/Enter, never reformat mid-keystroke.
  const [draft, setDraft] = useState(String(Math.round(pageWidth)));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(String(Math.round(pageWidth)));
  }, [pageWidth, editing]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const commitDraft = (raw: string) => {
    setEditing(false);
    const n = Number(raw);
    if (Number.isFinite(n) && raw !== '') {
      onPageWidthChange(Math.max(min, Math.min(max, Math.round(n))));
    } else {
      setDraft(String(Math.round(pageWidth)));
    }
  };

  return (
    <div
      className="pgc-popover"
      ref={rootRef}
      role="dialog"
      aria-label="Page setup"
      data-testid="page-chrome-popover"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="pgc-title">Page setup</div>
      <div className="pgc-row">
        <input
          type="range"
          min={min}
          max={max}
          value={pageWidth}
          className="pgc-width-slider"
          data-testid="page-chrome-width-slider"
          aria-label="Page width"
          onChange={(e) => onPageWidthChange(Number(e.target.value))}
        />
        <input
          type="text"
          inputMode="numeric"
          className="pgc-width-input"
          data-testid="page-chrome-width-input"
          aria-label="Page width in pixels"
          value={draft}
          onFocus={() => setEditing(true)}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
          onBlur={(e) => commitDraft(e.target.value)}
          onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
              commitDraft((e.target as HTMLInputElement).value);
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'Escape') {
              setDraft(String(Math.round(pageWidth)));
              setEditing(false);
            }
          }}
        />
        <span className="pgc-unit">px</span>
      </div>

      {onPageStyleChange && (
        <>
          <div className="pgc-title pgc-title--sub">Page style</div>
          <div className="pgc-styles" role="group" aria-label="Page style">
            {PAGE_STYLE_OPTIONS.map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={`pgc-style-opt${pageStyleMode === mode ? ' pgc-style-opt--active' : ''}`}
                data-testid={`page-chrome-style-${mode}`}
                aria-pressed={pageStyleMode === mode}
                onClick={() => onPageStyleChange(mode)}
              >
                {label}
              </button>
            ))}
          </div>
          {pageStyleMode === 'custom' && onPickPageTexture && (
            <div className="pgc-row pgc-row--texture">
              <span className="pgc-texture-name" title={textureFileName}>
                {textureFileName || 'No image chosen'}
              </span>
              <button
                type="button"
                className="pgc-texture-btn"
                data-testid="page-chrome-texture-upload"
                onClick={onPickPageTexture}
              >
                Choose image…
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
