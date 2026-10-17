import { useCallback, useEffect, useState } from 'react';
import { planNotesFromVault, type PlanNote } from '../pages/SceneCrafter/crafterState';
import './NewStoryModal.css';

export interface NewStoryModalResult {
  title: string;
  linkedPlanNoteIds: string[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (result: NewStoryModalResult) => void;
}

export default function NewStoryModal({ open, onClose, onSubmit }: Props) {
  const [title, setTitle] = useState('Untitled Story');
  const [plans, setPlans] = useState<PlanNote[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingPlans, setLoadingPlans] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle('Untitled Story');
    setSelected(new Set());
    setLoadingPlans(true);
    void (async () => {
      try {
        const listing = await window.api?.listNotesVault?.();
        if (!listing || 'error' in listing) {
          setPlans([]);
          return;
        }
        setPlans(planNotesFromVault(listing.items));
      } catch {
        setPlans([]);
      } finally {
        setLoadingPlans(false);
      }
    })();
  }, [open]);

  const togglePlan = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (!open) return null;

  return (
    <div className="new-story-modal-overlay" role="presentation" onClick={onClose} data-testid="new-story-modal-overlay">
      <div
        className="new-story-modal ln-overlay-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-story-modal-title"
        onClick={(e) => e.stopPropagation()}
        data-testid="new-story-modal"
      >
        <h2 id="new-story-modal-title" className="new-story-modal__title">New story</h2>
        <p className="new-story-modal__hint">
          Name the story and optionally link plan notes from your vault (Plans folder).
        </p>
        <label className="new-story-modal__field">
          <span className="new-story-modal__label">Story title</span>
          <input
            className="new-story-modal__input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            data-testid="new-story-modal-title-input"
            autoFocus
          />
        </label>
        <div className="new-story-modal__plans">
          <div className="new-story-modal__label">Link planned notes</div>
          {loadingPlans && <p className="new-story-modal__muted">Loading plans…</p>}
          {!loadingPlans && plans.length === 0 && (
            <p className="new-story-modal__muted">No plan notes found in Plans/.</p>
          )}
          <ul className="new-story-modal__plan-list">
            {plans.map((plan) => (
              <li key={plan.id}>
                <label className="new-story-modal__plan-row">
                  <input
                    type="checkbox"
                    checked={selected.has(plan.id)}
                    onChange={() => togglePlan(plan.id)}
                    data-testid={`new-story-plan-${plan.id}`}
                  />
                  <span>{plan.t}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        <div className="new-story-modal__actions">
          <button type="button" className="new-story-modal__btn new-story-modal__btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="new-story-modal__btn new-story-modal__btn--primary"
            onClick={() => onSubmit({ title: title.trim() || 'Untitled Story', linkedPlanNoteIds: [...selected] })}
            data-testid="new-story-modal-submit"
          >
            Create story
          </button>
        </div>
      </div>
    </div>
  );
}
