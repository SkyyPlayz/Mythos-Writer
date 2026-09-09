// SKY-11190 (Notes Board 7/9, Iconize colour parity): the closed 24-glyph +
// 8-colour picker used from Board tiles. Writes the {icon, color} form of
// the shared path-keyed .mythos/icons.json store (see vaultIcons.ts), so the
// vault tree, board breadcrumb, and board tiles all render from one map.
import { useCallback, useRef, useState } from 'react';
import type { FC, KeyboardEvent } from 'react';
import { LUCIDE_ICONS } from '../../lucideRegistry';
import { BOARD_ICON_GLYPHS, BOARD_ICON_COLORS, iconRefFor } from './boardIconGlyphs';
import './BoardIconPicker.css';

export interface BoardIconPickerProps {
  currentIcon?: string;
  currentColor?: string;
  onSelect: (icon: string, color: string) => void;
  onClear: () => void;
  onClose: () => void;
}

const DEFAULT_COLOR = BOARD_ICON_COLORS[0].hex;

const BoardIconPicker: FC<BoardIconPickerProps> = ({ currentIcon, currentColor, onSelect, onClear, onClose }) => {
  const overlayRef = useRef<HTMLDivElement>(null);
  // Colour is a modifier picked before the glyph that commits the change —
  // selecting a swatch must not close the picker, so it only updates local
  // pending state; `onSelect` (which the caller uses to commit-and-close)
  // fires on the glyph click, using whichever colour is pending at that time.
  const [pendingColor, setPendingColor] = useState(currentColor ?? DEFAULT_COLOR);
  const activeColor = pendingColor;

  const handleOverlayClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === overlayRef.current) onClose();
  }, [onClose]);

  const handleOverlayKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  return (
    <div
      className="board-icon-picker-overlay"
      onClick={handleOverlayClick}
      onKeyDown={handleOverlayKeyDown}
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="Choose icon and colour"
    >
      <div className="board-icon-picker-modal">
        <div className="board-icon-picker-header">
          <span className="board-icon-picker-title">Icon &amp; Colour</span>
          <button className="board-icon-picker-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="board-icon-picker-colors" role="group" aria-label="Colour">
          {BOARD_ICON_COLORS.map((c) => (
            <button
              key={c.id}
              className={`board-icon-picker-swatch${activeColor === c.hex ? ' selected' : ''}`}
              style={{ backgroundColor: c.hex }}
              onClick={() => setPendingColor(c.hex)}
              aria-label={c.label}
              aria-pressed={activeColor === c.hex}
              title={c.label}
            />
          ))}
        </div>

        <div className="board-icon-picker-grid" role="group" aria-label="Icon">
          {BOARD_ICON_GLYPHS.map((glyph) => {
            const ref = iconRefFor(glyph);
            const Comp = LUCIDE_ICONS[glyph];
            const isSelected = currentIcon === ref;
            return (
              <button
                key={glyph}
                className={`board-icon-picker-cell${isSelected ? ' selected' : ''}`}
                onClick={() => onSelect(ref, activeColor)}
                aria-pressed={isSelected}
                title={glyph}
              >
                {Comp && <Comp size={18} strokeWidth={1.5} color={isSelected ? activeColor : undefined} aria-hidden />}
                <span className="board-icon-picker-label">{glyph}</span>
              </button>
            );
          })}
        </div>

        {currentIcon && (
          <div className="board-icon-picker-footer">
            <button className="board-icon-picker-clear" onClick={onClear}>Remove icon</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default BoardIconPicker;
