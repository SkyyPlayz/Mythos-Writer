import { useState } from 'react';

interface BetaReadCommentCardProps {
  comment: BetaReadComment;
  onDismiss: (id: string) => Promise<void> | void;
}

export default function BetaReadCommentCard({ comment, onDismiss }: BetaReadCommentCardProps) {
  const [noted, setNoted] = useState(false);
  const [undoVisible, setUndoVisible] = useState(false);

  if (noted) {
    return (
      <article className="br-comment-card br-comment-card--noted" aria-label="Beta-Read comment noted">
        <button
          className="br-comment-summary"
          type="button"
          onClick={() => setNoted(false)}
          aria-label="Expand noted Beta-Read comment"
        >
          Noted: {comment.anchor_text}
        </button>
      </article>
    );
  }

  const handleDismiss = async () => {
    setUndoVisible(true);
    await onDismiss(comment.id);
  };

  return (
    <article className="br-comment-card" role="article" aria-label="Beta-Read comment">
      <p className="br-anchor-label">Anchor</p>
      <blockquote className="br-anchor-text">{comment.anchor_text}</blockquote>
      <p className="br-comment-text">{comment.comment_text}</p>
      <div className="br-comment-actions">
        <button type="button" className="br-action-btn" onClick={() => setNoted(true)}>
          Note it
        </button>
        <button type="button" className="br-action-btn br-action-btn--danger" onClick={handleDismiss}>
          Dismiss
        </button>
      </div>
      {undoVisible && (
        <p className="br-undo-toast" role="status">
          Comment dismissed.
        </p>
      )}
    </article>
  );
}
