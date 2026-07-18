import { useState, useEffect, useCallback } from 'react';
import './TourModal.css';

const TOUR_STEPS = [
  {
    icon: '✏️',
    title: 'Writing Canvas',
    body: 'This is where your story lives. Select a scene from the story navigator on the left to start writing. Your work saves automatically.',
  },
  {
    icon: '📚',
    title: 'Story Navigator',
    body: 'Browse your stories, chapters, and scenes in the left panel. Use the depth slider at the top to navigate between book, chapter, and scene levels.',
  },
  {
    icon: '📝',
    title: 'Notes Vault',
    body: 'The right sidebar gives you access to your Notes Vault — characters, world-building files, and references. Everything links together automatically.',
  },
  {
    icon: '✦',
    title: 'AI Features',
    body: 'Switch to the Brainstorm view to generate ideas with AI. The Writing Coach and Archive agents run in the background, surfacing suggestions and continuity checks.',
  },
  {
    icon: '⌨️',
    title: 'Keyboard Shortcuts',
    body: 'Press ? at any time to see all keyboard shortcuts. Ctrl+Shift+F enters Focus mode. Press this tour button in the toolbar whenever you need a refresher.',
  },
] as const;

interface TourModalProps {
  onClose: () => void;
}

/** Multi-step quick tour modal (SKY-152). Opened from the toolbar ? button. */
export default function TourModal({ onClose }: TourModalProps) {
  const [step, setStep] = useState(0);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowRight' && step < TOUR_STEPS.length - 1) setStep(s => s + 1);
    if (e.key === 'ArrowLeft' && step > 0) setStep(s => s - 1);
  }, [onClose, step]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const current = TOUR_STEPS[step];
  const isLast = step === TOUR_STEPS.length - 1;

  return (
    <div
      className="tour-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Quick tour"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="tour-modal" data-testid="tour-modal">
        <div className="tour-header">
          <span className="tour-step-label">Step {step + 1} of {TOUR_STEPS.length}</span>
          <button
            className="tour-close"
            onClick={onClose}
            aria-label="Close tour"
            data-testid="tour-close"
          >
            ×
          </button>
        </div>

        <div className="tour-body">
          <div className="tour-step-icon" aria-hidden="true">{current.icon}</div>
          <h2 className="tour-step-title">{current.title}</h2>
          <p className="tour-step-body">{current.body}</p>
        </div>

        <div className="tour-dots" aria-label="Tour progress" role="list">
          {TOUR_STEPS.map((_, i) => (
            <button
              key={i}
              className={`tour-dot${i === step ? ' tour-dot--active' : ''}`}
              onClick={() => setStep(i)}
              aria-label={`Go to step ${i + 1}`}
              role="listitem"
            />
          ))}
        </div>

        <div className="tour-actions">
          {step > 0 && (
            <button className="btn-ghost" onClick={() => setStep(s => s - 1)} data-testid="tour-prev">
              ← Previous
            </button>
          )}
          {isLast ? (
            <button className="btn-primary" onClick={onClose} data-testid="tour-done">
              Start writing →
            </button>
          ) : (
            <button className="btn-primary" onClick={() => setStep(s => s + 1)} data-testid="tour-next">
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
