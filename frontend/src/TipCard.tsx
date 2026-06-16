import { useState } from 'react';
import type { WritingAssistantTip, WritingTipCategory } from './hooks/useWritingScheduler';

interface TipCardProps {
  tip: WritingAssistantTip;
  onNote: (tipId: string) => void;
  onIgnore: (tipId: string) => void;
  onReport: (tipId: string) => void;
}

const CATEGORY_LABELS: Record<WritingTipCategory, string> = {
  grammar: 'Grammar',
  pacing: 'Pacing',
  clarity: 'Clarity',
  style: 'Style',
  tone: 'Tone',
};

export function TipCard({ tip, onNote, onIgnore, onReport }: TipCardProps) {
  const [expanded, setExpanded] = useState(false);
  const label = CATEGORY_LABELS[tip.category];

  return (
    <article className="tc-card" data-testid={`tip-card-${tip.id}`}>
      <div className="tc-header-row">
        <span
          className={`tc-category-badge tc-category-badge--${tip.category}`}
          role="img"
          aria-label={`${label} tip`}
        >
          {label}
        </span>
        {tip.sceneAnchor && (
          <span className="tc-anchor" title={tip.sceneAnchor}>
            {tip.sceneAnchor}
          </span>
        )}
      </div>
      <p className={`tc-tip-text${expanded ? ' tc-tip-text--expanded' : ''}`}>{tip.text}</p>
      <button
        type="button"
        className="tc-show-more"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-label={expanded ? 'Show less tip text' : 'Show more tip text'}
      >
        {expanded ? '⌃ Show less' : '⌄ Show more'}
      </button>
      <div className="tc-actions-row" role="group" aria-label="Tip actions">
        <button type="button" className="tc-btn-note" onClick={() => onNote(tip.id)}>
          ✓ Note it
        </button>
        <button
          type="button"
          className="tc-btn-ignore"
          onClick={() => onIgnore(tip.id)}
          aria-label="Ignore tip"
        >
          ✕ Ignore
        </button>
        <button
          type="button"
          className="tc-btn-report"
          onClick={() => onReport(tip.id)}
          aria-label="Report tip"
        >
          ⚑ Report
        </button>
      </div>
    </article>
  );
}
