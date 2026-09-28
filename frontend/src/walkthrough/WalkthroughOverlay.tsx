import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  WALKTHROUGH_CHAPTERS,
  WALKTHROUGH_STEPS,
  type WalkthroughSide,
  type WalkthroughStep,
} from './walkthroughSteps';
import './WalkthroughOverlay.css';

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface WalkthroughOverlayProps {
  onClose: () => void;
}

function queryTourTarget(step: WalkthroughStep): Element | null {
  const primary = document.querySelector(`[data-tour="${CSS.escape(step.target)}"]`);
  if (primary) return primary;
  if (step.alt) {
    return document.querySelector(`[data-tour="${CSS.escape(step.alt)}"]`);
  }
  return null;
}

function readRect(el: Element | null): TargetRect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 1 && r.height < 1) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

type PlacedSide = Exclude<WalkthroughSide, 'auto'>;

function placeBubble(
  rect: TargetRect | null,
  side: WalkthroughSide,
): { left: number; top: number; arrow: PlacedSide } {
  const bw = 272;
  const bh = 180;
  const pad = 14;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (!rect) {
    return {
      left: Math.max(12, (vw - bw) / 2),
      top: Math.max(12, (vh - bh) / 2),
      arrow: 'top',
    };
  }

  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let chosen: PlacedSide = 'bottom';
  if (side === 'auto') {
    const space: Record<PlacedSide, number> = {
      top: rect.top,
      bottom: vh - (rect.top + rect.height),
      left: rect.left,
      right: vw - (rect.left + rect.width),
    };
    chosen = (Object.entries(space).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'bottom') as PlacedSide;
  } else {
    chosen = side;
  }

  let left = cx - bw / 2;
  let top = rect.top + rect.height + pad;
  let arrow: PlacedSide = 'top';

  switch (chosen) {
    case 'top':
      top = rect.top - bh - pad;
      arrow = 'bottom';
      break;
    case 'bottom':
      top = rect.top + rect.height + pad;
      arrow = 'top';
      break;
    case 'left':
      left = rect.left - bw - pad;
      top = cy - bh / 2;
      arrow = 'right';
      break;
    case 'right':
      left = rect.left + rect.width + pad;
      top = cy - bh / 2;
      arrow = 'left';
      break;
    default: {
      const _exhaustive: never = chosen;
      void _exhaustive;
      break;
    }
  }

  left = Math.min(Math.max(12, left), vw - bw - 12);
  top = Math.min(Math.max(12, top), vh - bh - 12);
  return { left, top, arrow };
}

/** 09 §7 coach-mark walkthrough — bubble z90 + ring z89; Demo-on chrome (not TourModal). */
export default function WalkthroughOverlay({ onClose }: WalkthroughOverlayProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<TargetRect | null>(null);
  const step = WALKTHROUGH_STEPS[stepIndex] ?? WALKTHROUGH_STEPS[0];
  const chapterSteps = useMemo(
    () => WALKTHROUGH_STEPS.map((s, i) => ({ ...s, i })).filter((s) => s.chapter === step.chapter),
    [step.chapter],
  );
  const posInChapter = chapterSteps.findIndex((s) => s.i === stepIndex) + 1;
  const chapterTotal = chapterSteps.length;

  const refresh = useCallback(() => {
    const el = queryTourTarget(step);
    setRect(readRect(el));
  }, [step]);

  useLayoutEffect(() => {
    refresh();
  }, [refresh, stepIndex]);

  useEffect(() => {
    const onResize = () => refresh();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    const id = window.setInterval(refresh, 400);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      window.clearInterval(id);
    };
  }, [refresh]);

  useEffect(() => {
    if (!step.advanceOnClick) return;
    const el = queryTourTarget(step);
    if (!el) return;
    const advance = () => {
      setStepIndex((i) => Math.min(i + 1, WALKTHROUGH_STEPS.length - 1));
    };
    el.addEventListener('click', advance, true);
    return () => el.removeEventListener('click', advance, true);
  }, [step, stepIndex]);

  const bubble = placeBubble(rect, step.side);
  const lost = !rect;
  const isLast = stepIndex >= WALKTHROUGH_STEPS.length - 1;
  const ringPad = 6;

  const goChapter = (chapter: string) => {
    const idx = WALKTHROUGH_STEPS.findIndex((s) => s.chapter === chapter);
    if (idx >= 0) setStepIndex(idx);
  };

  const goNext = () => {
    if (isLast) {
      onClose();
      return;
    }
    setStepIndex((i) => i + 1);
  };

  return (
    <div className="walkthrough-root" data-testid="walkthrough-overlay" aria-live="polite">
      {rect ? (
        <>
          <div className="walkthrough-dim walkthrough-dim--t" style={{ height: Math.max(0, rect.top - ringPad) }} />
          <div
            className="walkthrough-dim walkthrough-dim--b"
            style={{ top: rect.top + rect.height + ringPad }}
          />
          <div
            className="walkthrough-dim walkthrough-dim--l"
            style={{
              top: Math.max(0, rect.top - ringPad),
              height: rect.height + ringPad * 2,
              width: Math.max(0, rect.left - ringPad),
            }}
          />
          <div
            className="walkthrough-dim walkthrough-dim--r"
            style={{
              top: Math.max(0, rect.top - ringPad),
              left: rect.left + rect.width + ringPad,
              height: rect.height + ringPad * 2,
            }}
          />
          <div
            className="walkthrough-ring"
            data-testid="walkthrough-ring"
            style={{
              top: rect.top - ringPad,
              left: rect.left - ringPad,
              width: rect.width + ringPad * 2,
              height: rect.height + ringPad * 2,
            }}
          />
        </>
      ) : null}

      <div
        className="walkthrough-bubble"
        data-testid="walkthrough-bubble"
        data-screen-label="Walkthrough"
        style={{ left: bubble.left, top: bubble.top }}
      >
        <div className={`walkthrough-bubble__arrow walkthrough-bubble__arrow--${bubble.arrow}`} />
        <div className="walkthrough-bubble__head">
          <span className="walkthrough-bubble__chapter">{step.chapter.toUpperCase()}</span>
          <span className="walkthrough-bubble__pos">
            {posInChapter}/{chapterTotal}
          </span>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="walkthrough-bubble__close"
            title="Hide the guide (Demo button brings it back)"
            aria-label="Hide walkthrough"
            data-testid="walkthrough-close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="walkthrough-bubble__text">{step.text}</div>
        {lost ? (
          <button
            type="button"
            className="walkthrough-bubble__go"
            data-testid="walkthrough-take-me"
            onClick={() => {
              const el = queryTourTarget(step);
              el?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
              refresh();
            }}
          >
            Take me there <span className="walkthrough-bubble__nudge">→</span>
          </button>
        ) : null}
        {step.advanceOnClick && !lost ? (
          <div className="walkthrough-bubble__hint">
            <span className="walkthrough-bubble__nudge">→</span>
            Tap the glowing thing to continue
          </div>
        ) : null}
        <div className="walkthrough-bubble__nav">
          <button
            type="button"
            className={`walkthrough-bubble__back${stepIndex === 0 ? ' walkthrough-bubble__back--disabled' : ''}`}
            disabled={stepIndex === 0}
            data-testid="walkthrough-back"
            onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
          >
            ‹ Back
          </button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="walkthrough-bubble__next"
            data-testid="walkthrough-next"
            onClick={goNext}
          >
            {step.advanceOnClick && !isLast ? 'Skip' : isLast ? 'Done' : 'Next'}
          </button>
        </div>
        <div className="walkthrough-bubble__chapters">
          {WALKTHROUGH_CHAPTERS.map((ch) => (
            <button
              key={ch}
              type="button"
              title={ch}
              className={`walkthrough-bubble__chip${ch === step.chapter ? ' walkthrough-bubble__chip--on' : ''}`}
              onClick={() => goChapter(ch)}
            >
              {ch === 'Notes & Boards' ? 'Notes' : ch}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
