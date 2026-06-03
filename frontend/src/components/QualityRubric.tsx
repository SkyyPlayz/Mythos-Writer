import { useState, useEffect, useRef } from 'react';
import './QualityRubric.css';

interface Props {
  onClose: () => void;
}

type Rating = 1 | 2 | 3;
type Ratings = Record<string, Rating>;

interface Criterion {
  id: string;
  title: string;
  subtitle: string;
  anchors: [string, string, string];
}

const CRITERIA: Criterion[] = [
  {
    id: 'specificity',
    title: '1. Specificity',
    subtitle: 'Concrete details grounded in your world',
    anchors: [
      'Vague, clichéd, or generic phrasing.',
      'Grounded but could be more vivid.',
      'Concrete, precise, and evocative.',
    ],
  },
  {
    id: 'coherence',
    title: '2. Coherence',
    subtitle: 'Consistency with prior context',
    anchors: [
      'Contradicts prior context or breaks established tone.',
      'Mostly coherent but has minor gaps or voice inconsistencies.',
      'Seamlessly fits scene, tone, and character voice.',
    ],
  },
  {
    id: 'genre-fit',
    title: '3. Genre Fit',
    subtitle: 'Authenticity to your chosen genre',
    anchors: [
      'Violates genre conventions or feels out-of-place.',
      "Respects genre conventions but doesn't leverage strengths.",
      'Embraces genre strengths; written with conventions in mind.',
    ],
  },
  {
    id: 'constraint-respect',
    title: '4. Constraint Respect',
    subtitle: 'Honors stated constraints and preset rules',
    anchors: [
      'Violates stated constraints or preset rules.',
      "Respects constraints but doesn't integrate them naturally.",
      'Integrates constraints seamlessly into the suggestion.',
    ],
  },
  {
    id: 'usefulness',
    title: '5. Usefulness as Starter',
    subtitle: 'Can you build on this draft?',
    anchors: [
      'User must rewrite most or all of the suggestion.',
      'User needs to edit parts; some phrasing can be adopted.',
      'User can adopt directly or use as a strong foundation.',
    ],
  },
  {
    id: 'actionability',
    title: '6. Actionability',
    subtitle: 'Advice is specific and immediately applicable',
    anchors: [
      'Advice is vague or hard to apply.',
      'Advice is clear but generic.',
      'Advice is specific and immediately applicable.',
    ],
  },
];

export default function QualityRubric({ onClose }: Props) {
  const [ratings, setRatings] = useState<Ratings>({});
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const ratedCount = Object.keys(ratings).length;
  const avg =
    ratedCount > 0
      ? Object.values(ratings).reduce((s, v) => s + v, 0) / ratedCount
      : null;

  const setRating = (criterionId: string, star: Rating) => {
    setRatings((prev) => {
      if (prev[criterionId] === star) {
        const { [criterionId]: _removed, ...rest } = prev;
        return rest as Ratings;
      }
      return { ...prev, [criterionId]: star };
    });
  };

  return (
    <div
      className="quality-rubric-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Quality rubric — rate this suggestion"
    >
      <div
        ref={dialogRef}
        className="quality-rubric-panel"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="quality-rubric-header">
          <div>
            <h2 className="quality-rubric-title">Rate this suggestion</h2>
            {avg !== null && (
              <p className="quality-rubric-avg" aria-live="polite">
                Score: {avg.toFixed(1)} / 3
                {avg < 2 && ' — consider refining or rejecting'}
              </p>
            )}
          </div>
          <button
            className="quality-rubric-close"
            onClick={onClose}
            aria-label="Close quality rubric"
            type="button"
          >
            ✕
          </button>
        </div>

        <div className="quality-rubric-body">
          <p className="quality-rubric-intro">
            Mark each criterion 1–3 stars. A score ≥ 2.5 signals a useful suggestion.
          </p>

          {CRITERIA.map((criterion) => {
            const current = ratings[criterion.id];
            return (
              <section key={criterion.id} className="rubric-criterion">
                <div className="rubric-criterion-row">
                  <div className="rubric-criterion-info">
                    <h3 className="rubric-criterion-title">{criterion.title}</h3>
                    <p className="rubric-criterion-sub">{criterion.subtitle}</p>
                  </div>
                  <div
                    className="rubric-stars-input"
                    role="group"
                    aria-label={`${criterion.title} rating`}
                  >
                    {([1, 2, 3] as const).map((star) => (
                      <button
                        key={star}
                        className={`rubric-star-btn${current != null && star <= current ? ' rubric-star-btn--active' : ''}`}
                        onClick={() => setRating(criterion.id, star)}
                        type="button"
                        aria-label={`${star} star: ${criterion.anchors[star - 1]}`}
                        aria-pressed={current === star}
                        title={criterion.anchors[star - 1]}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                </div>
                {current != null && (
                  <p className="rubric-criterion-anchor">{criterion.anchors[current - 1]}</p>
                )}
              </section>
            );
          })}

          <section className="rubric-how-to-use">
            <h3 className="rubric-criterion-title">How to use this guide</h3>
            <ul className="rubric-stars-list">
              <li>Mark each criterion above and see the average score.</li>
              <li>If most are at 2–3★, the output is usable; refine it with <strong>Refine</strong> chips if needed.</li>
              <li>If most are at 1★, discard and try again, or use <strong>Refine</strong> to steer.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
