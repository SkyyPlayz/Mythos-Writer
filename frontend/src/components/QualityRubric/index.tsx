import { useState } from 'react';
import { QUALITY_RUBRIC } from '../../PresetLibrary';
import './index.css';

type RatingMap = Record<string, 1 | 2 | 3>;

interface Props {
  suggestionId: string;
  onClose: () => void;
}

export default function QualityRubric({ suggestionId, onClose }: Props) {
  const [ratings, setRatings] = useState<RatingMap>({});

  const setRating = (criterionId: string, star: 1 | 2 | 3) => {
    setRatings((prev) => ({ ...prev, [criterionId]: star }));
  };

  const ratedCount = Object.keys(ratings).length;
  const avg =
    ratedCount > 0
      ? Object.values(ratings).reduce((s, v) => s + v, 0) / ratedCount
      : null;

  return (
    <div
      className="rubric-panel"
      role="region"
      aria-label={`Quality rubric for suggestion ${suggestionId}`}
    >
      <div className="rubric-header">
        <span className="rubric-title">Rate usefulness</span>
        {avg !== null && (
          <span className="rubric-avg" aria-live="polite">
            Avg: {avg.toFixed(1)} / 3
          </span>
        )}
        <button
          className="rubric-close"
          onClick={onClose}
          type="button"
          aria-label="Close quality rubric"
        >
          ✕
        </button>
      </div>

      <ul className="rubric-list">
        {QUALITY_RUBRIC.map((criterion) => {
          const current = ratings[criterion.id];
          return (
            <li key={criterion.id} className="rubric-criterion">
              <div className="rubric-criterion-name">{criterion.name}</div>
              <div className="rubric-stars" role="group" aria-label={`${criterion.name} rating`}>
                {([1, 2, 3] as const).map((star) => (
                  <button
                    key={star}
                    className={`rubric-star${current === star ? ' rubric-star-active' : ''}`}
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
              {current != null && (
                <span className="rubric-anchor">{criterion.anchors[current - 1]}</span>
              )}
            </li>
          );
        })}
      </ul>

      {avg !== null && avg < 2 && (
        <div className="rubric-flag" role="status" aria-live="polite">
          Low score — consider refining or rejecting this suggestion.
        </div>
      )}
    </div>
  );
}
