// Beta 4 M9 — the open comment card (v2 prototype cOpenData 1063–1085,
// state 6502–6510).
//
// A 290px card, sticky at the top-right of the page scroll area, shown while
// a comment is open (prototype cOpen — set by clicking an anchored underline
// or a gutter card). Carries the full card anatomy the M9 spec calls out:
// kind chip (author label per kMeta 6503), close ×, quote ("on “anchor…”",
// clipped at 60), body, the three archive agent actions with their FULL
// labels ("Edit notes to match" / "Suggest story change" / "Ignore"), and a
// footer row with Resolve + the "Show in focus" override toggle.
//
// Presentational like CommentsGutter — mutations flow through callbacks so
// ManuscriptView owns store wiring + toasts.

import {
  AGENT_ACTIONS,
  COMMENT_KIND_META,
  agentActionAvailability,
  clipAnchor,
  type AgentAction,
  type StoryComment,
} from '../comments';
import './CommentsGutter.css';

export interface CommentOpenCardProps {
  comment: StoryComment;
  onClose: () => void;
  onResolve: (comment: StoryComment) => void;
  onAgentAction: (comment: StoryComment, action: AgentAction) => void;
  /** Focus-mode override state + toggle ("Show in focus", prototype cifToggle). */
  commentsInFocus: boolean;
  onToggleCommentsInFocus: () => void;
}

const CLOSE_ICON = (
  <svg
    width="9"
    height="9"
    viewBox="0 0 12 12"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
  </svg>
);

export default function CommentOpenCard({
  comment,
  onClose,
  onResolve,
  onAgentAction,
  commentsInFocus,
  onToggleCommentsInFocus,
}: CommentOpenCardProps) {
  const availability = agentActionAvailability(comment);
  return (
    <div className="msv-copen-wrap">
      <div
        className={`msv-copen msv-copen--${comment.kind}`}
        data-testid="msv-copen"
        role="dialog"
        aria-label={`Comment by ${comment.author}`}
      >
        <div className="msv-copen-head">
          <span className="msv-copen-chip" data-testid="msv-copen-chip">
            {COMMENT_KIND_META[comment.kind].label}
          </span>
          <button
            type="button"
            className="msv-copen-close"
            data-testid="msv-copen-close"
            aria-label="Close comment"
            onClick={onClose}
          >
            {CLOSE_ICON}
          </button>
        </div>
        <div className="msv-copen-anchor">on &ldquo;{clipAnchor(comment.anchor, 60)}&rdquo;</div>
        <div className="msv-copen-text">{comment.text}</div>
        {availability !== 'none' && (
          <div className="msv-copen-actions">
            {AGENT_ACTIONS.map(({ action, label }) => (
              <button
                key={action}
                type="button"
                className={`msv-cmt-act msv-cmt-act--${action} msv-copen-act`}
                data-testid={`msv-copen-act-${action}`}
                disabled={availability !== 'live'}
                title={
                  availability === 'live'
                    ? label
                    : 'Wired when the Archive Agent links a suggestion (continuity scan)'
                }
                onClick={() => onAgentAction(comment, action)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="msv-copen-foot">
          <button
            type="button"
            className="msv-copen-resolve"
            data-testid="msv-copen-resolve"
            onClick={() => onResolve(comment)}
          >
            Resolve
          </button>
          <span className="msv-copen-spacer" />
          <span className="msv-copen-focuslabel">Show in focus</span>
          <button
            type="button"
            className={`msv-cmt-pill${commentsInFocus ? ' msv-cmt-pill--on' : ''}`}
            data-testid="msv-cmt-focus-toggle"
            role="switch"
            aria-checked={commentsInFocus}
            aria-label="Show comments in Focus mode"
            onClick={onToggleCommentsInFocus}
          >
            <span className="msv-cmt-pill-knob" />
          </button>
        </div>
      </div>
    </div>
  );
}
