import { useCallback, useEffect, useRef, useState } from 'react';
import './MarginRuler.css';

const WIDTH_MIN = 520;
const WIDTH_MAX = 3000;
const TICK_INTERVAL = 50;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

interface Props {
  widthPx: number;
  onWidthChange: (px: number) => void;
  containerRef?: React.RefObject<HTMLElement>;
}

export default function MarginRuler({ widthPx, onWidthChange, containerRef }: Props) {
  const rulerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  // Clamp on mount/prop change
  const effectiveWidth = clamp(widthPx, WIDTH_MIN, WIDTH_MAX);

  useEffect(() => {
    if (widthPx !== effectiveWidth) {
      onWidthChange(effectiveWidth);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleMouseDown = useCallback((side: 'left' | 'right') => (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(side);
    dragStartX.current = e.clientX;
    dragStartWidth.current = effectiveWidth;
  }, [effectiveWidth]);

  useEffect(() => {
    if (!dragging) return;

    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartX.current;
      // Right handle: outward = wider; Left handle: outward (left) = wider
      const delta = dragging === 'right' ? dx : -dx;
      // Symmetric: each handle moves half, so total width change = 2 * delta
      const newWidth = clamp(dragStartWidth.current + delta * 2, WIDTH_MIN, WIDTH_MAX);
      onWidthChange(Math.round(newWidth));
    };

    const onMouseUp = () => setDragging(null);

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragging, onWidthChange]);

  // Build tick marks
  const containerWidth = containerRef?.current?.clientWidth ?? 800;
  const ticks: number[] = [];
  const tickCount = Math.floor(containerWidth / TICK_INTERVAL) + 1;
  for (let i = 0; i < tickCount; i++) {
    ticks.push(i * TICK_INTERVAL);
  }

  const handleOffsetLeft = (containerWidth - effectiveWidth) / 2;
  const handleOffsetRight = handleOffsetLeft + effectiveWidth;

  return (
    <div
      ref={rulerRef}
      className={`margin-ruler${dragging ? ' margin-ruler--dragging' : ''}`}
      role="presentation"
      aria-label="Page width ruler"
    >
      {/* Tick marks */}
      <div className="margin-ruler__ticks" aria-hidden="true">
        {ticks.map(pos => (
          <div
            key={pos}
            className={`margin-ruler__tick${pos % 100 === 0 ? ' margin-ruler__tick--major' : ''}`}
            style={{ left: pos }}
          />
        ))}
      </div>

      {/* Left handle */}
      <button
        className="margin-ruler__handle margin-ruler__handle--left"
        style={{ left: handleOffsetLeft }}
        onMouseDown={handleMouseDown('left')}
        aria-label={`Left page margin handle. Page width ${effectiveWidth}px`}
        type="button"
      />

      {/* Width readout */}
      <span
        className="margin-ruler__readout"
        aria-live="polite"
        aria-label={`Page width ${effectiveWidth} pixels`}
      >
        {effectiveWidth} px
      </span>

      {/* Right handle */}
      <button
        className="margin-ruler__handle margin-ruler__handle--right"
        style={{ left: handleOffsetRight }}
        onMouseDown={handleMouseDown('right')}
        aria-label={`Right page margin handle. Page width ${effectiveWidth}px`}
        type="button"
      />
    </div>
  );
}
